const TranslationFactory = require('../translation/TranslationFactory');

class SubtitleTranslator {
  /**
   * Traduit une liste de segments audio ({ id, start, end, text }) de l'anglais vers le français
   */
  static async translateSegments(segments, targetLang = 'FR', sourceLang = 'EN', providerName = 'gemini', apiKey = null, onProgress = null) {
    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return [];
    }

    let provider;
    if (typeof providerName === 'object' && providerName !== null && typeof providerName.translateBatch === 'function') {
      provider = providerName;
    } else {
      provider = TranslationFactory.getProvider(providerName || 'gemini');
    }

    const batchSize = 20;
    const totalSegments = segments.length;
    const translatedSegments = [];

    let processedCount = 0;

    for (let i = 0; i < totalSegments; i += batchSize) {
      const batch = segments.slice(i, i + batchSize);
      const sourceTexts = batch.map(s => s.text);

      let translatedTexts = sourceTexts;
      try {
        translatedTexts = await provider.translateBatch(sourceTexts, targetLang, sourceLang, apiKey);
      } catch (err) {
        console.error(`[SubtitleTranslator] Erreur de traduction sur un lot : ${err.message}`);
        translatedTexts = sourceTexts;
      }

      for (let j = 0; j < batch.length; j++) {
        translatedSegments.push({
          id: batch[j].id,
          start: batch[j].start,
          end: batch[j].end,
          originalText: batch[j].text,
          translatedText: (translatedTexts && translatedTexts[j]) ? translatedTexts[j] : batch[j].text
        });
      }

      processedCount += batch.length;

      if (onProgress) {
        onProgress(`Traduction des sous-titres : ${processedCount} / ${totalSegments} segments`, Math.round(60 + (processedCount / totalSegments) * 30));
      }
    }

    return translatedSegments;
  }
}

module.exports = SubtitleTranslator;
