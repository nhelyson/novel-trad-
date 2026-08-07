const axios = require('axios');
const FormData = require('form-data');
const { PDFDocument } = require('pdf-lib');
const TranslationProvider = require('./TranslationProvider');

class DeepLProvider extends TranslationProvider {
  constructor() {
    super('DeepL');
  }

  getBaseUrl(apiKey, apiType = 'free') {
    // Si la clé finit par ":fx", c'est une clé gratuite DeepL API Free
    if (apiKey && apiKey.endsWith(':fx')) {
      return 'https://api-free.deepl.com/v2';
    }
    return apiType === 'pro' ? 'https://api.deepl.com/v2' : 'https://api-free.deepl.com/v2';
  }

  getEffectiveApiKey(customApiKey) {
    const key = customApiKey || process.env.DEEPL_API_KEY;
    if (!key) {
      throw new Error("Clé API DeepL manquante. Veuillez saisir votre clé API DeepL dans l'interface ou dans le fichier .env (ex: xxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx).");
    }
    return key.trim();
  }

  /**
   * Point d'entrée principal pour la traduction de PDF.
   * Redirige automatiquement les fichiers > 9.5 Mo vers le Mode Gros Document (découpage & fusion).
   */
  async translateDocument(pdfBuffer, targetLang, sourceLang = null, customApiKey = null, onProgress = null) {
    const LARGE_FILE_THRESHOLD = 9.5 * 1024 * 1024; // 9.5 MB threshold for DeepL

    if (pdfBuffer.length > LARGE_FILE_THRESHOLD) {
      console.log(`[DeepLProvider] Gros document détecté (${(pdfBuffer.length / 1024 / 1024).toFixed(2)} MB > 9.5 MB). Activation du Mode Gros Document...`);
      return await this.splitAndTranslateLargePdf(pdfBuffer, targetLang, sourceLang, customApiKey, onProgress);
    }

    try {
      return await this.translateSingleDocumentChunk(pdfBuffer, targetLang, sourceLang, customApiKey, onProgress);
    } catch (err) {
      if (err.message && err.message.toLowerCase().includes('size limit')) {
        console.warn(`[DeepLProvider] Rejet DeepL pour limite de taille. Bascule automatique vers le Mode Gros Document...`);
        return await this.splitAndTranslateLargePdf(pdfBuffer, targetLang, sourceLang, customApiKey, onProgress);
      }
      throw err;
    }
  }

  /**
   * Traitement intelligent des PDF volumineux par découpage en sous-PDFs,
   * traduction par lots via l'API Document de DeepL, et fusion finale.
   * Conserve 100% des illustrations, de la mise en page et des polices.
   */
  async splitAndTranslateLargePdf(pdfBuffer, targetLang, sourceLang = null, customApiKey = null, onProgress = null) {
    if (onProgress) onProgress('⚡ Mode Gros Document activé : Analyse du PDF et découpage par lots...', 5);

    let srcDoc;
    try {
      srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    } catch (e) {
      throw new Error(`Impossible de lire le document PDF pour le découpage : ${e.message}`);
    }

    const totalPages = srcDoc.getPageCount();
    if (totalPages === 0) {
      throw new Error('Le document PDF fourni ne contient aucune page.');
    }

    // Calcul dynamique du nombre de pages par lot (cible ~6.5 Mo par lot pour marge de sécurité)
    const avgBytesPerPage = pdfBuffer.length / totalPages;
    const targetChunkBytes = 6.5 * 1024 * 1024; // 6.5 MB
    let pagesPerChunk = Math.max(1, Math.floor(targetChunkBytes / avgBytesPerPage));
    pagesPerChunk = Math.min(pagesPerChunk, 35); // Max 35 pages par lot pour réactivité

    const totalBatches = Math.ceil(totalPages / pagesPerChunk);
    console.log(`[DeepLProvider] PDF de ${totalPages} pages découpé en ${totalBatches} lot(s) (~${pagesPerChunk} pages/lot).`);

    const translatedChunkBuffers = [];

    for (let i = 0; i < totalBatches; i++) {
      const startPage = i * pagesPerChunk;
      const endPage = Math.min(totalPages, (i + 1) * pagesPerChunk);
      const batchNum = i + 1;

      const basePercent = Math.round(10 + (i / totalBatches) * 80);
      if (onProgress) {
        onProgress(`[Gros Document] Lot ${batchNum}/${totalBatches} (Pages ${startPage + 1} à ${endPage}) : Préparation...`, basePercent);
      }

      // Création du sous-PDF pour ce lot
      const chunkDoc = await PDFDocument.create();
      const pageIndices = [];
      for (let p = startPage; p < endPage; p++) {
        pageIndices.push(p);
      }

      const copiedPages = await chunkDoc.copyPages(srcDoc, pageIndices);
      copiedPages.forEach(page => chunkDoc.addPage(page));
      const chunkBuffer = Buffer.from(await chunkDoc.save());

      console.log(`[DeepLProvider] Lot ${batchNum}/${totalBatches} prêt: ${(chunkBuffer.length / 1024 / 1024).toFixed(2)} MB, pages ${startPage + 1}-${endPage}`);

      // Envoi du lot à DeepL avec logique de réessai (retry)
      let translatedChunkBuffer = null;
      let lastError = null;
      const maxRetries = 3;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          translatedChunkBuffer = await this.translateSingleDocumentChunk(
            chunkBuffer,
            targetLang,
            sourceLang,
            customApiKey,
            (statusText, subPercent) => {
              const chunkPercent = Math.round(basePercent + (subPercent / 100) * (80 / totalBatches));
              if (onProgress) {
                onProgress(`[Gros Document] Lot ${batchNum}/${totalBatches} (Pages ${startPage + 1}-${endPage}) : ${statusText}`, Math.min(92, chunkPercent));
              }
            }
          );
          break; // Succès
        } catch (retryErr) {
          lastError = retryErr;
          console.warn(`[DeepLProvider] Échec tentative ${attempt}/${maxRetries} pour le lot ${batchNum}: ${retryErr.message}`);
          
          // Si l'erreur est un dépassement de quota (456), il est inutile d'insister
          if (retryErr.isQuotaExceeded || retryErr.message.includes('456') || retryErr.message.includes('Quota')) {
            throw retryErr;
          }

          if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, 2000 * attempt));
          }
        }
      }

      if (!translatedChunkBuffer) {
        throw new Error(`Échec de la traduction du lot ${batchNum}/${totalBatches} (Pages ${startPage + 1} à ${endPage}) après ${maxRetries} tentatives : ${lastError?.message}`);
      }

      translatedChunkBuffers.push(translatedChunkBuffer);
    }

    // Fusion de tous les sous-PDFs traduits
    if (onProgress) onProgress('⚡ Reconstruction et fusion des lots du PDF final (conservation des illustrations)...', 93);
    console.log(`[DeepLProvider] Fusion des ${translatedChunkBuffers.length} sous-PDFs traduits...`);

    const mergedDoc = await PDFDocument.create();

    for (let i = 0; i < translatedChunkBuffers.length; i++) {
      let subDoc;
      try {
        subDoc = await PDFDocument.load(translatedChunkBuffers[i], { ignoreEncryption: true });
      } catch (mergeErr) {
        throw new Error(`Erreur lors du chargement du lot traduit ${i + 1} pour fusion: ${mergeErr.message}`);
      }

      const pagesToCopy = await mergedDoc.copyPages(subDoc, subDoc.getPageIndices());
      pagesToCopy.forEach(page => mergedDoc.addPage(page));
    }

    const finalPdfBuffer = Buffer.from(await mergedDoc.save());
    if (onProgress) onProgress('PDF final assemblé avec succès !', 100);

    console.log(`[DeepLProvider] PDF final reconstruit avec succès (${(finalPdfBuffer.length / 1024 / 1024).toFixed(2)} MB, ${mergedDoc.getPageCount()} pages).`);
    return finalPdfBuffer;
  }

  /**
   * Traduction officielle d'un document PDF (ou chunk PDF) avec l'API DeepL Document Translation.
   * Conserve 100% de la structure graphique, de la pagination et des illustrations.
   */
  async translateSingleDocumentChunk(pdfBuffer, targetLang, sourceLang = null, customApiKey = null, onProgress = null) {
    const apiKey = this.getEffectiveApiKey(customApiKey);
    const baseUrl = this.getBaseUrl(apiKey, process.env.DEEPL_API_TYPE);

    let formattedTargetLang = targetLang.toUpperCase();
    if (formattedTargetLang === 'EN') formattedTargetLang = 'EN-US';
    if (formattedTargetLang === 'PT') formattedTargetLang = 'PT-PT';

    if (onProgress) onProgress('Envoi du document PDF à DeepL...', 10);

    // Helper pour formater les erreurs HTTP DeepL
    const formatDeepLError = (err, context) => {
      const statusCode = err.response?.status;
      if (statusCode === 456 || err.message.includes('456')) {
        const quotaErr = new Error("Quota DeepL dépassé (Erreur 456) : Votre clé API DeepL a atteint sa limite mensuelle de caractères (500 000 caractères pour l'API gratuite). Veuillez vérifier votre compte DeepL ou fournir une clé avec du quota disponible.");
        quotaErr.isQuotaExceeded = true;
        return quotaErr;
      }
      if (statusCode === 403) {
        return new Error("Clé API DeepL invalide ou non autorisée (Erreur 403). Veuillez vérifier votre clé API.");
      }
      const details = err.response?.data?.message || err.message;
      return new Error(`${context} : ${details}`);
    };

    // 1. Soumission du fichier PDF à /v2/document
    const formData = new FormData();
    formData.append('file', pdfBuffer, {
      filename: 'document.pdf',
      contentType: 'application/pdf'
    });
    formData.append('target_lang', formattedTargetLang);
    if (sourceLang && sourceLang !== 'auto') {
      formData.append('source_lang', sourceLang.toUpperCase());
    }

    let uploadRes;
    try {
      uploadRes = await axios.post(`${baseUrl}/document`, formData, {
        headers: {
          ...formData.getHeaders(),
          'Authorization': `DeepL-Auth-Key ${apiKey}`
        },
        timeout: 60000
      });
    } catch (err) {
      throw formatDeepLError(err, "Échec de l'envoi du document à DeepL");
    }

    const { document_id, document_key } = uploadRes.data;
    if (!document_id || !document_key) {
      throw new Error("Réponse d'initialisation de traduction invalide reçue de DeepL.");
    }

    if (onProgress) onProgress('Document reçu. Traduction en cours par DeepL...', 30);

    // 2. Polling de l'état de la traduction (/v2/document/{document_id})
    let isDone = false;
    let attempts = 0;
    const maxAttempts = 120; // 120 * 3s = 6 minutes max

    while (!isDone && attempts < maxAttempts) {
      attempts++;
      await new Promise(r => setTimeout(r, 3000));

      const statusFormData = new FormData();
      statusFormData.append('document_key', document_key);

      let statusRes;
      try {
        statusRes = await axios.post(`${baseUrl}/document/${document_id}`, statusFormData, {
          headers: {
            ...statusFormData.getHeaders(),
            'Authorization': `DeepL-Auth-Key ${apiKey}`
          },
          timeout: 30000
        });
      } catch (err) {
        if (err.response?.status === 456) {
          throw formatDeepLError(err, "Vérification du statut DeepL");
        }
        console.error("Erreur lors de la vérification du statut DeepL:", err.message);
        continue;
      }

      const status = statusRes.data.status;
      const secondsRemaining = statusRes.data.seconds_remaining;

      if (status === 'done') {
        isDone = true;
        if (onProgress) onProgress('Traduction terminée avec succès. Téléchargement du PDF...', 90);
      } else if (status === 'error') {
        const errorDetails = statusRes.data.error_message || "Erreur de traitement interne chez DeepL.";
        throw new Error(`La traduction du document a échoué chez DeepL : ${errorDetails}`);
      } else if (status === 'translating') {
        const progressPercent = Math.min(85, 30 + (attempts * 3));
        const statusText = secondsRemaining ? `Traduction en cours (${secondsRemaining}s restantes)...` : 'Traduction en cours par DeepL...';
        if (onProgress) onProgress(statusText, progressPercent);
      }
    }

    if (!isDone) {
      throw new Error("Le délai d'attente de la traduction du document chez DeepL a expiré.");
    }

    // 3. Téléchargement du PDF traduit (/v2/document/{document_id}/result)
    const resultFormData = new FormData();
    resultFormData.append('document_key', document_key);

    let resultRes;
    try {
      resultRes = await axios.post(`${baseUrl}/document/${document_id}/result`, resultFormData, {
        headers: {
          ...resultFormData.getHeaders(),
          'Authorization': `DeepL-Auth-Key ${apiKey}`
        },
        responseType: 'arraybuffer',
        timeout: 120000
      });
    } catch (err) {
      throw formatDeepLError(err, "Impossible de récupérer le fichier PDF traduit");
    }

    if (onProgress) onProgress('PDF traduit prêt !', 100);
    return Buffer.from(resultRes.data);
  }

  /**
   * Traduction de texte brut via /v2/translate
   */
  async translateText(text, targetLang, sourceLang = null, customApiKey = null) {
    const apiKey = this.getEffectiveApiKey(customApiKey);
    const baseUrl = this.getBaseUrl(apiKey, process.env.DEEPL_API_TYPE);

    let formattedTargetLang = targetLang.toUpperCase();
    if (formattedTargetLang === 'EN') formattedTargetLang = 'EN-US';

    const payload = {
      text: [text],
      target_lang: formattedTargetLang
    };
    if (sourceLang && sourceLang !== 'auto') {
      payload.source_lang = sourceLang.toUpperCase();
    }

    try {
      const res = await axios.post(`${baseUrl}/translate`, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `DeepL-Auth-Key ${apiKey}`
        },
        timeout: 30000
      });

      if (res.data && res.data.translations && res.data.translations[0]) {
        return res.data.translations[0].text;
      }
      throw new Error("Réponse de traduction de texte vide.");
    } catch (err) {
      throw new Error(`Échec de la traduction de texte DeepL : ${err.response?.data?.message || err.message}`);
    }
  }
}

module.exports = DeepLProvider;

