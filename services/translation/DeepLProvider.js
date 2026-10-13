const axios = require('axios');
const FormData = require('form-data');
const { PDFDocument } = require('pdf-lib');
const TranslationProvider = require('./TranslationProvider');

class DeepLProvider extends TranslationProvider {
  constructor() {
    super('DeepL');
  }

  getBaseUrl(apiKey, apiType = null) {
    if (!apiKey) return 'https://api-free.deepl.com/v2';
    const trimmed = apiKey.trim();
    
    // Si la clé se termine par ":fx", c'est obligatoirement une clé DeepL API Free
    if (trimmed.endsWith(':fx')) {
      return 'https://api-free.deepl.com/v2';
    }
    
    // Si apiType est explicitement 'free', utiliser free, sinon par défaut pour les clés non-:fx c'est DeepL API Pro
    if (apiType === 'free') {
      return 'https://api-free.deepl.com/v2';
    }
    return 'https://api.deepl.com/v2';
  }

  getEffectiveApiKey(customApiKey) {
    const key = customApiKey || process.env.DEEPL_API_KEY;
    if (!key || key.trim().length === 0) {
      throw new Error("Clé API DeepL manquante. Veuillez saisir votre clé API DeepL (Free ou Pro) dans l'interface.");
    }
    return key.trim();
  }

  formatDeepLError(err, context = 'DeepL API') {
    const statusCode = err.response?.status;
    if (statusCode === 413 || err.message?.includes('413')) {
      const sizeErr = new Error("Taille du fichier excessive pour DeepL (Limite 10 Mo)");
      sizeErr.isPayloadTooLarge = true;
      return sizeErr;
    }
    if (statusCode === 456 || err.message.includes('456')) {
      const quotaErr = new Error("Quota DeepL dépassé (Erreur 456) : Votre clé API DeepL a atteint sa limite mensuelle. Veuillez vérifier votre compte DeepL.");
      quotaErr.isQuotaExceeded = true;
      return quotaErr;
    }
    if (statusCode === 403 || err.message.includes('403')) {
      const authErr = new Error("Clé API DeepL invalide ou non autorisée (Erreur 403) : DeepL a refusé l'accès. Vérifiez le type de clé (Free ou Pro).");
      authErr.isAuthError = true;
      return authErr;
    }
    if (statusCode === 429) {
      return new Error("Trop de requêtes simultanées envoyées à DeepL (Erreur 429). Veuillez patienter quelques instants.");
    }
    const details = err.response?.data?.message || err.message;
    return new Error(`${context} : ${details}`);
  }

  /**
   * Traduction de lots de textes via /v2/translate (Text API)
   * Auto-détecte l'endpoint Free / Pro et gère le basculement si 403.
   */
  async translateBatch(textsArray, targetLang, sourceLang = null, customApiKey = null) {
    if (!textsArray || !Array.isArray(textsArray) || textsArray.length === 0) {
      return [];
    }

    const apiKey = this.getEffectiveApiKey(customApiKey);
    let baseUrl = this.getBaseUrl(apiKey, process.env.DEEPL_API_TYPE);

    let formattedTargetLang = targetLang.toUpperCase();
    if (formattedTargetLang === 'EN') formattedTargetLang = 'EN-US';
    if (formattedTargetLang === 'PT') formattedTargetLang = 'PT-PT';

    const payload = {
      text: textsArray,
      target_lang: formattedTargetLang
    };

    if (sourceLang && sourceLang !== 'auto') {
      payload.source_lang = sourceLang.toUpperCase();
    }

    const executeRequest = async (url) => {
      return await axios.post(`${url}/translate`, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `DeepL-Auth-Key ${apiKey}`
        },
        timeout: 45000
      });
    };

    try {
      let res;
      try {
        res = await executeRequest(baseUrl);
      } catch (firstErr) {
        // En cas de 403, essayer avec l'autre URL (Free vs Pro)
        if (firstErr.response?.status === 403) {
          const alternateUrl = baseUrl.includes('api-free') ? 'https://api.deepl.com/v2' : 'https://api-free.deepl.com/v2';
          console.warn(`[DeepLProvider] HTTP 403 sur ${baseUrl}. Tentative de basculement vers ${alternateUrl}...`);
          res = await executeRequest(alternateUrl);
        } else {
          throw firstErr;
        }
      }

      if (res.data && res.data.translations) {
        return res.data.translations.map(t => t.text);
      }
      throw new Error("Réponse vide reçue de l'API DeepL.");
    } catch (err) {
      throw this.formatDeepLError(err, "Échec de la traduction par lot DeepL");
    }
  }

  /**
   * Traduction de texte brut via /v2/translate
   */
  async translateText(text, targetLang, sourceLang = null, customApiKey = null) {
    const results = await this.translateBatch([text], targetLang, sourceLang, customApiKey);
    return results[0] || text;
  }

  /**
   * Point d'entrée principal pour la traduction de PDF (Document API).
   */
  async translateDocument(pdfBuffer, targetLang, sourceLang = null, customApiKey = null, onProgress = null) {
    const LARGE_FILE_THRESHOLD = 8.0 * 1024 * 1024;
    if (pdfBuffer.length > LARGE_FILE_THRESHOLD) {
      return await this.splitAndTranslateLargePdf(pdfBuffer, targetLang, sourceLang, customApiKey, onProgress);
    }

    try {
      return await this.translateSingleDocumentChunk(pdfBuffer, targetLang, sourceLang, customApiKey, onProgress);
    } catch (err) {
      if (err.isPayloadTooLarge || (err.message && (err.message.toLowerCase().includes('size limit') || err.message.toLowerCase().includes('exceeds') || err.message.includes('413')))) {
        return await this.splitAndTranslateLargePdf(pdfBuffer, targetLang, sourceLang, customApiKey, onProgress);
      }
      throw err;
    }
  }

  async splitAndTranslateLargePdf(pdfBuffer, targetLang, sourceLang = null, customApiKey = null, onProgress = null) {
    if (onProgress) onProgress('⚡ Mode Gros Document activé : Découpage du PDF...', 5);

    let srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const totalPages = srcDoc.getPageCount();
    if (totalPages === 0) throw new Error('Le document PDF fourni ne contient aucune page.');

    const avgBytesPerPage = pdfBuffer.length / totalPages;
    let pagesPerChunk = Math.max(1, Math.floor((4.0 * 1024 * 1024) / avgBytesPerPage));
    pagesPerChunk = Math.min(pagesPerChunk, 15);

    const allChunks = [];
    const rawBatchesCount = Math.ceil(totalPages / pagesPerChunk);
    for (let i = 0; i < rawBatchesCount; i++) {
      const startP = i * pagesPerChunk;
      const endP = Math.min(totalPages, (i + 1) * pagesPerChunk);
      
      const chunkDoc = await PDFDocument.create();
      const pageIndices = [];
      for (let p = startP; p < endP; p++) pageIndices.push(p);
      const copiedPages = await chunkDoc.copyPages(srcDoc, pageIndices);
      copiedPages.forEach(page => chunkDoc.addPage(page));
      const buf = Buffer.from(await chunkDoc.save());

      allChunks.push({ startPage: startP, endPage: endP, buffer: buf });
    }

    const totalBatches = allChunks.length;
    const translatedChunkBuffers = [];

    for (let i = 0; i < totalBatches; i++) {
      const chunkItem = allChunks[i];
      const batchNum = i + 1;
      const basePercent = Math.round(10 + (i / totalBatches) * 80);

      if (onProgress) {
        onProgress(`[Gros Document] Lot ${batchNum}/${totalBatches} (Pages ${chunkItem.startPage + 1}-${chunkItem.endPage})...`, basePercent);
      }

      const translatedChunkBuffer = await this.translateSingleDocumentChunk(
        chunkItem.buffer,
        targetLang,
        sourceLang,
        customApiKey,
        (statusText, subPercent) => {
          const chunkPercent = Math.round(basePercent + (subPercent / 100) * (80 / totalBatches));
          if (onProgress) onProgress(`[Gros Document] Lot ${batchNum}/${totalBatches} : ${statusText}`, Math.min(92, chunkPercent));
        }
      );

      translatedChunkBuffers.push(translatedChunkBuffer);
    }

    if (onProgress) onProgress('⚡ Fusion et assemblage du PDF final...', 93);
    const mergedDoc = await PDFDocument.create();
    for (const chunkBuf of translatedChunkBuffers) {
      const subDoc = await PDFDocument.load(chunkBuf, { ignoreEncryption: true });
      const pagesToCopy = await mergedDoc.copyPages(subDoc, subDoc.getPageIndices());
      pagesToCopy.forEach(page => mergedDoc.addPage(page));
    }

    const finalPdfBuffer = Buffer.from(await mergedDoc.save());
    if (onProgress) onProgress('PDF final assemblé avec succès !', 100);
    return finalPdfBuffer;
  }

  async translateSingleDocumentChunk(pdfBuffer, targetLang, sourceLang = null, customApiKey = null, onProgress = null) {
    const apiKey = this.getEffectiveApiKey(customApiKey);
    let baseUrl = this.getBaseUrl(apiKey, process.env.DEEPL_API_TYPE);

    let formattedTargetLang = targetLang.toUpperCase();
    if (formattedTargetLang === 'EN') formattedTargetLang = 'EN-US';
    if (formattedTargetLang === 'PT') formattedTargetLang = 'PT-PT';

    if (onProgress) onProgress('Envoi du document PDF à DeepL...', 10);

    const formData = new FormData();
    formData.append('file', pdfBuffer, { filename: 'document.pdf', contentType: 'application/pdf' });
    formData.append('target_lang', formattedTargetLang);
    if (sourceLang && sourceLang !== 'auto') {
      formData.append('source_lang', sourceLang.toUpperCase());
    }

    let uploadRes;
    try {
      try {
        uploadRes = await axios.post(`${baseUrl}/document`, formData, {
          headers: { ...formData.getHeaders(), 'Authorization': `DeepL-Auth-Key ${apiKey}` },
          timeout: 60000
        });
      } catch (firstErr) {
        if (firstErr.response?.status === 403) {
          baseUrl = baseUrl.includes('api-free') ? 'https://api.deepl.com/v2' : 'https://api-free.deepl.com/v2';
          console.warn(`[DeepLProvider] HTTP 403 Document sur URL initiale. Reprise sur ${baseUrl}...`);
          
          const retryFormData = new FormData();
          retryFormData.append('file', pdfBuffer, { filename: 'document.pdf', contentType: 'application/pdf' });
          retryFormData.append('target_lang', formattedTargetLang);
          if (sourceLang && sourceLang !== 'auto') retryFormData.append('source_lang', sourceLang.toUpperCase());

          uploadRes = await axios.post(`${baseUrl}/document`, retryFormData, {
            headers: { ...retryFormData.getHeaders(), 'Authorization': `DeepL-Auth-Key ${apiKey}` },
            timeout: 60000
          });
        } else {
          throw firstErr;
        }
      }
    } catch (err) {
      throw this.formatDeepLError(err, "Échec de l'envoi du document à DeepL");
    }

    const { document_id, document_key } = uploadRes.data;
    if (!document_id || !document_key) throw new Error("Réponse de traduction invalide reçue de DeepL.");

    if (onProgress) onProgress('Document reçu. Traduction en cours par DeepL...', 30);

    let isDone = false;
    let attempts = 0;
    const maxAttempts = 800; // Jusqu'à 40 minutes pour les gros volumes de 200+ pages

    while (!isDone && attempts < maxAttempts) {
      attempts++;
      await new Promise(r => setTimeout(r, 3000));

      const statusFormData = new FormData();
      statusFormData.append('document_key', document_key);

      let statusRes;
      try {
        statusRes = await axios.post(`${baseUrl}/document/${document_id}`, statusFormData, {
          headers: { ...statusFormData.getHeaders(), 'Authorization': `DeepL-Auth-Key ${apiKey}` },
          timeout: 30000
        });
      } catch (err) {
        throw this.formatDeepLError(err, "Vérification du statut DeepL");
      }

      const status = statusRes.data.status;
      const secondsRemaining = statusRes.data.seconds_remaining;

      if (status === 'done') {
        isDone = true;
        if (onProgress) onProgress('Traduction terminée chez DeepL. Téléchargement du document...', 92);
      } else if (status === 'error') {
        throw new Error(`La traduction du document a échoué chez DeepL : ${statusRes.data.error_message || 'Erreur interne'}`);
      } else if (status === 'translating') {
        let msg = 'Traduction en cours par DeepL...';
        if (typeof secondsRemaining === 'number' && secondsRemaining > 0) {
          if (secondsRemaining > 60) {
            msg = `Traduction par DeepL (~ ${Math.ceil(secondsRemaining / 60)} min restantes)...`;
          } else {
            msg = `Traduction par DeepL (~ ${secondsRemaining}s restantes)...`;
          }
        }
        // Progression fluide de 20% à 90%
        const progressPercent = Math.min(90, 20 + Math.round((attempts / 120) * 70));
        if (onProgress) onProgress(msg, progressPercent);
      } else if (status === 'queued') {
        if (onProgress) onProgress('Document placé en file d\'attente DeepL...', 15);
      }
    }

    if (!isDone) throw new Error("Délai d'attente dépassé pour la traduction DeepL (document volumineux).");

    const resultFormData = new FormData();
    resultFormData.append('document_key', document_key);

    let resultRes;
    try {
      resultRes = await axios.post(`${baseUrl}/document/${document_id}/result`, resultFormData, {
        headers: { ...resultFormData.getHeaders(), 'Authorization': `DeepL-Auth-Key ${apiKey}` },
        responseType: 'arraybuffer',
        timeout: 120000
      });
    } catch (err) {
      throw this.formatDeepLError(err, "Impossible de récupérer le fichier traduit");
    }

    if (onProgress) onProgress('PDF traduit prêt !', 100);
    return Buffer.from(resultRes.data);
  }

  async getUsage(customApiKey = null) {
    const apiKey = this.getEffectiveApiKey(customApiKey);
    const QuotaGuard = require('../optimization/QuotaGuard');
    return await QuotaGuard.getDeepLUsage(apiKey);
  }
}

module.exports = DeepLProvider;
