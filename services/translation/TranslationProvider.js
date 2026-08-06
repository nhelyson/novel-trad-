/**
 * Interface / Classe de base abstraite pour les fournisseurs de traduction (Strategy Pattern)
 */
class TranslationProvider {
  constructor(name) {
    this.name = name;
  }

  /**
   * Traduit un fichier PDF tout en préservant sa structure et ses illustrations
   * @param {Buffer} pdfBuffer - Le buffer du fichier PDF d'origine
   * @param {string} targetLang - Code de la langue cible (ex: 'FR', 'EN', 'DE', 'ES')
   * @param {string} [sourceLang] - Code optionnel de la langue source
   * @param {string} [apiKey] - Clé API spécifique transmise par le client
   * @param {Function} [onProgress] - Callback de progression (status, percent)
   * @returns {Promise<Buffer>} - Buffer du PDF traduit
   */
  async translateDocument(pdfBuffer, targetLang, sourceLang = null, apiKey = null, onProgress = null) {
    throw new Error(`La méthode translateDocument() doit être implémentée par le provider ${this.name}`);
  }

  /**
   * Traduit du texte brut
   * @param {string} text 
   * @param {string} targetLang 
   * @param {string} [sourceLang] 
   * @param {string} [apiKey] 
   * @returns {Promise<string>}
   */
  async translateText(text, targetLang, sourceLang = null, apiKey = null) {
    throw new Error(`La méthode translateText() doit être implémentée par le provider ${this.name}`);
  }
}

module.exports = TranslationProvider;
