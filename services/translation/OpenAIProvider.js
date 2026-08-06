const TranslationProvider = require('./TranslationProvider');

class OpenAIProvider extends TranslationProvider {
  constructor() {
    super('OpenAI');
  }

  async translateDocument(pdfBuffer, targetLang, sourceLang = null, apiKey = null, onProgress = null) {
    throw new Error("Le module OpenAI Document API n'est pas configuré. Veuillez utiliser le fournisseur DeepL pour la préservation exacte des PDF.");
  }

  async translateText(text, targetLang, sourceLang = null, apiKey = null) {
    throw new Error("Le module OpenAI Text Translation n'est pas configuré. Veuillez utiliser le fournisseur DeepL.");
  }
}

module.exports = OpenAIProvider;
