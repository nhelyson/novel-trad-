const axios = require('axios');
const FormData = require('form-data');
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

  getEffectiveApiKey(customKey) {
    const key = customKey || process.env.DEEPL_API_KEY;
    if (!key) {
      throw new Error("Clé API DeepL manquante. Veuillez saisir votre clé API DeepL dans l'interface ou dans le fichier .env (ex: xxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx).");
    }
    return key.trim();
  }

  /**
   * Traduction officielle du document PDF avec l'API DeepL Document Translation.
   * Conserve 100% de la structure graphique, de la pagination et des illustrations.
   */
  async translateDocument(pdfBuffer, targetLang, sourceLang = null, customApiKey = null, onProgress = null) {
    const apiKey = this.getEffectiveApiKey(customApiKey);
    const baseUrl = this.getBaseUrl(apiKey, process.env.DEEPL_API_TYPE);

    // Normalisation des codes de langue pour DeepL (ex: 'fr' -> 'FR', 'en' -> 'EN-US')
    let formattedTargetLang = targetLang.toUpperCase();
    if (formattedTargetLang === 'EN') formattedTargetLang = 'EN-US';
    if (formattedTargetLang === 'PT') formattedTargetLang = 'PT-PT';

    if (onProgress) onProgress('Envoi du document PDF à DeepL...', 10);

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
      const errorMsg = err.response?.data?.message || err.message;
      throw new Error(`Échec de l'envoi du document à DeepL : ${errorMsg}`);
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
      throw new Error(`Impossible de récupérer le fichier PDF traduit : ${err.message}`);
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
