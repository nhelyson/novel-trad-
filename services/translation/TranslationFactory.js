const DeepLProvider = require('./DeepLProvider');
const GoogleProvider = require('./GoogleProvider');
const OpenAIProvider = require('./OpenAIProvider');
const NLLBProvider = require('./NLLBProvider');

class TranslationFactory {
  static customProviders = new Map();

  static registerProvider(name, providerInstance) {
    this.customProviders.set(name.toLowerCase(), providerInstance);
  }

  static getProvider(providerName = null) {
    const name = (providerName || process.env.DEFAULT_PROVIDER || 'deepl').toLowerCase();

    if (this.customProviders.has(name)) {
      return this.customProviders.get(name);
    }

    switch (name) {
      case 'deepl':
        return new DeepLProvider();
      case 'google':
        return new GoogleProvider();
      case 'openai':
        return new OpenAIProvider();
      case 'nllb':
      case 'nllblocal':
      case 'nllb local':
      case 'nllb-local':
        return new NLLBProvider();
      default:
        if (process.env.DEFAULT_PROVIDER === 'nllb') {
          return new NLLBProvider();
        }
        return new DeepLProvider();
    }
  }
}

module.exports = TranslationFactory;
