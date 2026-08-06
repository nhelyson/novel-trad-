const DeepLProvider = require('./DeepLProvider');
const GoogleProvider = require('./GoogleProvider');
const OpenAIProvider = require('./OpenAIProvider');

class TranslationFactory {
  static getProvider(providerName = null) {
    const name = (providerName || process.env.DEFAULT_PROVIDER || 'deepl').toLowerCase();
    
    switch (name) {
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
