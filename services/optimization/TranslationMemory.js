const TextNormalizer = require('./TextNormalizer');
const InMemoryJobStore = require('../storage/InMemoryJobStore');

class TranslationMemory {
  /**
   * Recherche un segment dans la mémoire de traduction éphémère (RAM uniquement)
   */
  static async lookup(sourceText, targetLang) {
    if (!sourceText || typeof sourceText !== 'string') return null;
    const normalized = TextNormalizer.normalize(sourceText);
    const hash = TextNormalizer.hash(sourceText);

    const match = InMemoryJobStore.findInMemory(hash, targetLang);
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

  /**
   * Sauvegarde une nouvelle traduction dans la mémoire éphémère de session
   */
  static async save(sourceText, sourceLang, targetLang, translatedText, provider) {
    if (!sourceText || !translatedText) return;
    const hash = TextNormalizer.hash(sourceText);
    InMemoryJobStore.saveToMemory(hash, translatedText, targetLang);
  }

  /**
   * Déduplique un lot de segments avant envoi à DeepL :
   * Separe les segments déjà en mémoire des nouveaux segments.
   * Retourne { cachedSegments, newSegments, charactersSaved }
   */
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

    return {
      cachedSegments,
      newSegments,
      charactersSaved
    };
  }
}

module.exports = TranslationMemory;
