const TextNormalizer = require('./TextNormalizer');
const DiskJobStore = require('../storage/DiskJobStore');

class TranslationMemory {
  static async lookup(sourceText, targetLang) {
    if (!sourceText || typeof sourceText !== 'string') return null;
    const normalized = TextNormalizer.normalize(sourceText);
    const hash = TextNormalizer.hash(sourceText);

    const match = DiskJobStore.findInMemory(hash, targetLang);
    if (match) {
      return {
        sourceText,
        normalizedText: normalized,
        sourceHash: hash,
        translatedText: match,
        cached: true
      };
    }
    return null;
  }

  static async save(jobId, sourceText, sourceLang, targetLang, translatedText, provider) {
    if (!sourceText || !translatedText) return;
    const hash = TextNormalizer.hash(sourceText);
    if (jobId) {
      await DiskJobStore.saveJobTranslation(jobId, hash, translatedText, targetLang);
    } else {
      DiskJobStore.saveToMemory(hash, translatedText, targetLang);
    }
  }

  static async deduplicateBatch(segments, targetLang) {
    const cachedSegments = [];
    const newSegments = [];
    let charactersSaved = 0;

    for (const seg of segments) {
      const cached = await this.lookup(seg.source_text || seg.text, targetLang);
      if (cached) {
        charactersSaved += (seg.source_text || seg.text || '').length;
        cachedSegments.push({
          ...seg,
          translated_text: cached.translatedText,
          status: 'TRANSLATED',
          fromCache: true
        });
      } else {
        newSegments.push(seg);
      }
    }

    return { cachedSegments, newSegments, charactersSaved };
  }
}

module.exports = TranslationMemory;
