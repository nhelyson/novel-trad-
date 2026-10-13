const DeepLProvider = require('./DeepLProvider');
const GoogleProvider = require('./GoogleProvider');
const OpenAIProvider = require('./OpenAIProvider');
const GeminiProvider = require('./GeminiProvider');

class TranslationFactory {
  static customProviders = new Map();

  static registerProvider(name, providerInstance) {
    this.customProviders.set(name.toLowerCase(), providerInstance);
  }

  static getProvider(providerName = null) {
    const name = (providerName || process.env.DEFAULT_PROVIDER || 'gemini').toLowerCase();

    if (this.customProviders.has(name)) {
      return this.customProviders.get(name);
    }

    switch (name) {
      case 'gemini':
      case 'gemini-api':
        return new GeminiProvider();
      case 'deepl':
        return new DeepLProvider();
      case 'google':
        return new GoogleProvider();
      case 'openai':
        return new OpenAIProvider();
      default:
                return new DeepLProvider();
    }
  }
}

module.exports = TranslationFactory;
