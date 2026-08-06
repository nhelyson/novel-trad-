const TranslationProvider = require('./TranslationProvider');

class GoogleProvider extends TranslationProvider {
  constructor() {
    super('Google');
  }

  async translateDocument(pdfBuffer, targetLang, sourceLang = null, apiKey = null, onProgress = null) {
    throw new Error("Le module Google Cloud Translation Document API n'est pas configuré. Veuillez utiliser le fournisseur DeepL.");
  }

  async translateText(text, targetLang, sourceLang = null, apiKey = null) {
    throw new Error("Le module Google Cloud Translation API n'est pas configuré. Veuillez utiliser le fournisseur DeepL.");
  }
}

module.exports = GoogleProvider;
