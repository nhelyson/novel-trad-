const TextNormalizer = require('./TextNormalizer');
const db = require('../storage/DatabaseService');

class TranslationMemory {
  /**
   * Recherche un segment dans la mémoire de traduction persistante (cache global)
   */
  static async lookup(sourceText, targetLang) {
    if (!sourceText || typeof sourceText !== 'string') return null;
    const normalized = TextNormalizer.normalize(sourceText);
    const hash = TextNormalizer.hash(sourceText);

    const match = await db.findInMemory(hash, targetLang);
    if (match && match.translated_text) {
      return {
        sourceText,
        normalizedText: normalized,
        sourceHash: hash,
        translatedText: match.translated_text,
        provider: match.provider,
        cached: true
      };
    }
    return null;
  }

  /**
   * Sauvegarde une nouvelle traduction dans la mémoire partagée
   */
  static async save(sourceText, sourceLang, targetLang, translatedText, provider) {
    if (!sourceText || !translatedText) return;
    const normalized = TextNormalizer.normalize(sourceText);
    const hash = TextNormalizer.hash(sourceText);

    await db.saveToMemory(
      hash,
      sourceText,
      normalized,
      sourceLang,
      targetLang,
      translatedText,
      provider
    );
  }

  /**
   * Déduplique un lot de segments avant envoi à DeepL :
   * Separe les segments déjà en cache des nouveaux segments.
   * Retourne { cachedSegments, newSegments, charactersSaved }
   */
  static async deduplicateBatch(segments, targetLang) {
    const cachedSegments = [];
    const newSegments = [];
    let charactersSaved = 0;

    for (const seg of segments) {
      const cached = await this.lookup(seg.source_text, targetLang);
      if (cached) {
        charactersSaved += seg.source_text.length;
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
