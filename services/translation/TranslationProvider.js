/**
 * Interface / Classe de base abstraite pour les fournisseurs de traduction (Strategy Pattern)
 */
class TranslationProvider {
  constructor(name) {
    this.name = name;
  }

  getName() {
    return this.name;
  }

  isAvailable() {
    return true;
  }

  async getUsage(apiKey = null) {
    return null;
  }

  async translateBatch(textsArray, targetLang, sourceLang = null, apiKey = null) {
    throw new Error(`La méthode translateBatch() doit être implémentée par le provider ${this.name}`);
  }

  async translateDocument(pdfBuffer, targetLang, sourceLang = null, apiKey = null, onProgress = null) {
    throw new Error(`La méthode translateDocument() doit être implémentée par le provider ${this.name}`);
  }

  async translateText(text, targetLang, sourceLang = null, apiKey = null) {
    throw new Error(`La méthode translateText() doit être implémentée par le provider ${this.name}`);
  }
}

module.exports = TranslationProvider;

