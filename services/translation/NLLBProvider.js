const TranslationProvider = require('./TranslationProvider');

class NLLBProvider extends TranslationProvider {
  constructor() {
    super('NLLB (Local Engine)');
  }

  getName() {
    return this.name;
  }

  isAvailable() {
    return false;
  }

  async getUsage() {
    return {
      status: 'UNAVAILABLE',
      message: 'Moteur NLLB-200 local non installé (Espace disque insuffisant).'
    };
  }

  async translateBatch(textsArray, targetLang, sourceLang = null, apiKey = null) {
    throw new Error("NLLB Moteur Local Non Installé : L'espace disque actuel est insuffisant pour héberger le modèle NLLB-200-distilled-600M. Veuillez utiliser DeepL.");
  }

  async translateDocument(pdfBuffer, targetLang, sourceLang = null, apiKey = null, onProgress = null) {
    throw new Error("NLLB Moteur Local Non Installé : L'espace disque actuel est insuffisant pour héberger le modèle NLLB-200-distilled-600M. Veuillez utiliser DeepL.");
  }

  async translateText(text, targetLang, sourceLang = null, apiKey = null) {
    throw new Error("NLLB Moteur Local Non Installé : L'espace disque actuel est insuffisant pour héberger le modèle NLLB-200-distilled-600M. Veuillez utiliser DeepL.");
  }
}

module.exports = NLLBProvider;
