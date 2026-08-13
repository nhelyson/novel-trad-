const crypto = require('crypto');
const TextSegmenter = require('../optimization/TextSegmenter');
const DocumentCleaner = require('../optimization/DocumentCleaner');
const TranslationMemory = require('../optimization/TranslationMemory');
const QuotaGuard = require('../optimization/QuotaGuard');
const BatchEngine = require('../optimization/BatchEngine');
const TranslationFactory = require('./TranslationFactory');
const PerformanceProfiler = require('../optimization/PerformanceProfiler');
const InMemoryJobStore = require('../storage/InMemoryJobStore');

class TranslationPipeline {
  /**
   * Mode Simulation : Analyser un roman brut avant traduction sans consommer 1 seul caractère API
   */
  static async analyzeNovel(rawText, filename, targetLang, apiKey = null, providerName = 'deepl') {
    const docId = 'doc_' + crypto.createHash('md5').update(filename + Date.now()).digest('hex').substring(0, 12);
    const rawCharacters = (rawText || '').length;

    // 1. Segmentation
    const { chapters, segments } = TextSegmenter.segmentText(rawText, docId);

    // 2. Nettoyage
    const { cleanedSegments, skippedSegments, charactersSaved: cleanSaved } = DocumentCleaner.cleanDocumentSegments(segments);

    // 3. Recherche dans le cache éphémère
    const { cachedSegments, newSegments, charactersSaved: memorySaved } = await TranslationMemory.deduplicateBatch(cleanedSegments, targetLang);

    const totalSegments = segments.length;
    const cachedCount = cachedSegments.length;
    const skippedCount = skippedSegments.length;
    const toTranslateCount = newSegments.length;

    let estimatedCharactersToSend = 0;
    for (const s of newSegments) {
      estimatedCharactersToSend += (s.source_text || s.text || '').length;
    }

    const totalSavedChars = cleanSaved + memorySaved;
    const savingsPercent = rawCharacters > 0 ? ((totalSavedChars / rawCharacters) * 100).toFixed(1) : '0.0';

    // 4. Évaluation du Quota DeepL si provider === 'deepl'
    let quotaEval = null;
    if (apiKey && (providerName || 'deepl').toLowerCase() === 'deepl') {
      quotaEval = await QuotaGuard.checkPreTranslationQuota('deepl', apiKey, estimatedCharactersToSend, 'text');
    }

    return {
      docId,
      filename,
      rawCharacters,
      cleanedCharacters: rawCharacters - cleanSaved,
      totalSegments,
      skippedSegmentsCount: skippedCount,
      cachedSegmentsCount: cachedCount,
      toTranslateCount,
      estimatedCharactersToSend,
      totalCharactersSaved: totalSavedChars,
      savingsPercent,
      quotaInfo: quotaEval
    };
  }

  /**
   * Pipeline de Traduction de texte éphémère (sans stockage SQLite sur disque)
   */
  static async processNovel(docId, rawText, filename, targetLang, sourceLang = 'auto', apiKey = null, providerName = 'deepl', onProgress = null) {
    const profiler = new PerformanceProfiler(docId);
    InMemoryJobStore.createJob(docId, filename, 'text');

    const provider = TranslationFactory.getProvider(providerName);
    if (!provider.isAvailable()) {
      throw new Error(`Le fournisseur sélectionné (${provider.getName()}) n'est pas disponible.`);
    }

    // 1. Segmentation
    InMemoryJobStore.setPhase(docId, 'SEGMENTATION', 'Découpage du texte en chapitres et segments...');
    const { chapters, segments: rawSegs } = TextSegmenter.segmentText(rawText, docId);
    profiler.endStep('1. Découpage');

    // 2. Nettoyage & Filtrage
    InMemoryJobStore.setPhase(docId, 'EXTRACTION', 'Nettoyage et normalisation des segments...');
    const { cleanedSegments, skippedSegments, charactersSaved: cleanSaved } = DocumentCleaner.cleanDocumentSegments(rawSegs);
    profiler.endStep('2. Nettoyage');

    // 3. Vérification du Quota DeepL (Si provider === 'deepl')
    InMemoryJobStore.setPhase(docId, 'QUOTA_CHECK', 'Vérification du quota de traduction...');
    const quotaCheck = await QuotaGuard.checkPreTranslationQuota(
      provider.getName(),
      apiKey,
      rawText.length,
      'text'
    );

    if (!quotaCheck.canProceed) {
      InMemoryJobStore.failJob(docId, quotaCheck.message);
      throw new Error(quotaCheck.message);
    }
    profiler.endStep('3. Vérification Quota');

    // 4. Résolution via la mémoire de traduction éphémère
    const { cachedSegments, newSegments, charactersSaved: memorySaved } = await TranslationMemory.deduplicateBatch(cleanedSegments, targetLang);

    // Dictionnaire des résultats traduits
    const translatedResultsMap = new Map();
    for (const cSeg of cachedSegments) {
      translatedResultsMap.set(cSeg.id, cSeg.translated_text);
    }

    // 5. Traitement des nouveaux segments par lots
    InMemoryJobStore.setPhase(docId, 'TRANSLATION', `Traduction de ${newSegments.length} segments...`, {
      totalBlocks: newSegments.length
    });

    const batches = BatchEngine.createBatches(newSegments);
    const totalBatches = batches.length;
    let translatedCount = cachedSegments.length;

    for (let bIndex = 0; bIndex < totalBatches; bIndex++) {
      const currentJobState = InMemoryJobStore.getJob(docId);
      if (currentJobState && currentJobState.status === 'PAUSED') {
        console.log(`[Pipeline] Job ${docId} mis en pause.`);
        return null;
      }

      const batch = batches[bIndex];
      const sourceTexts = batch.map(s => s.source_text || s.text || '');

      try {
        const translatedTexts = await provider.translateBatch(sourceTexts, targetLang, sourceLang, apiKey);

        for (let i = 0; i < batch.length; i++) {
          const seg = batch[i];
          const srcText = sourceTexts[i];
          const transText = translatedTexts[i] || srcText;

          translatedResultsMap.set(seg.id, transText);
          await TranslationMemory.save(srcText, sourceLang, targetLang, transText, provider.getName());
          translatedCount++;
        }

        InMemoryJobStore.setTranslationProgress(
          docId,
          translatedCount,
          rawSegs.length,
          `Traduction : ${translatedCount} / ${rawSegs.length} blocs`
        );

        if (onProgress) {
          onProgress(`Traduction : ${translatedCount} / ${rawSegs.length} blocs`, Math.round((translatedCount / rawSegs.length) * 100));
        }

      } catch (batchErr) {
        console.error(`[Pipeline] Échec lot ${bIndex + 1}: ${batchErr.message}`);
        if (batchErr.isQuotaExceeded) {
          InMemoryJobStore.failJob(docId, batchErr.message);
          throw batchErr;
        }
      }
    }
    profiler.endStep('4. Traduction Moteur');

    // 6. Reconstruction du texte final traduit
    InMemoryJobStore.setPhase(docId, 'FINALIZATION', 'Reconstruction du roman final...');
    const translatedLines = [];
    for (const seg of rawSegs) {
      if (skippedSegments.some(s => s.id === seg.id)) {
        continue;
      }
      const transText = translatedResultsMap.get(seg.id) || seg.source_text || '';
      translatedLines.push(transText);
    }
    profiler.endStep('5. Reconstruction Textuelle');

    const finalResultText = translatedLines.join('\n\n');
    const summary = profiler.getSummary();
    profiler.printSummaryConsole();

    InMemoryJobStore.completeJob(docId, summary);
    return finalResultText;
  }
}

module.exports = TranslationPipeline;
