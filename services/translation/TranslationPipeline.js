const crypto = require('crypto');
const db = require('../storage/DatabaseService');
const TextSegmenter = require('../optimization/TextSegmenter');
const DocumentCleaner = require('../optimization/DocumentCleaner');
const TranslationMemory = require('../optimization/TranslationMemory');
const QuotaGuard = require('../optimization/QuotaGuard');
const BatchEngine = require('../optimization/BatchEngine');
const TranslationFactory = require('./TranslationFactory');

class TranslationPipeline {
  /**
   * Mode Simulation : Analyse un roman avant traduction sans consommer 1 seul caractère API
   */
  static async analyzeNovel(rawText, filename, targetLang, apiKey = null) {
    const docId = 'doc_' + crypto.createHash('md5').update(filename + Date.now()).digest('hex').substring(0, 12);
    const rawCharacters = rawText.length;

    // 1. Segmentation
    const { chapters, segments } = TextSegmenter.segmentText(rawText, docId);

    // 2. Nettoyage
    const { cleanedSegments, skippedSegments, charactersSaved: cleanSaved } = DocumentCleaner.cleanDocumentSegments(segments);

    // 3. Recherche dans le cache de traduction
    const { cachedSegments, newSegments, charactersSaved: memorySaved } = await TranslationMemory.deduplicateBatch(cleanedSegments, targetLang);

    const totalSegments = segments.length;
    const cachedCount = cachedSegments.length;
    const skippedCount = skippedSegments.length;
    const toTranslateCount = newSegments.length;

    let estimatedCharsToSend = 0;
    for (const s of newSegments) {
      estimatedCharsToSend += s.source_text.length;
    }

    const totalSavedChars = cleanSaved + memorySaved;
    const savingsPercent = rawCharacters > 0 ? ((totalSavedChars / rawCharacters) * 100).toFixed(1) : '0.0';

    // Verification du quota DeepL si clé fournie
    let quotaInfo = null;
    if (apiKey) {
      quotaInfo = await QuotaGuard.getDeepLUsage(apiKey);
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
      quotaInfo
    };
  }

  /**
   * Pipeline de Traduction complet avec Pause, Reprise et Sauvegarde immédiate
   */
  static async processNovel(docId, rawText, filename, targetLang, sourceLang = 'auto', apiKey = null, providerName = 'deepl', onProgress = null) {
    const provider = TranslationFactory.getProvider(providerName);

    if (!provider.isAvailable()) {
      throw new Error(`Le fournisseur sélectionné (${provider.getName()}) n'est pas disponible.`);
    }

    // 1. Charger ou créer le document dans la BD
    let doc = await db.getDocument(docId);
    let segments = [];

    if (!doc) {
      const { chapters, segments: rawSegs } = TextSegmenter.segmentText(rawText, docId);
      const { cleanedSegments, skippedSegments, charactersSaved: cleanSaved } = DocumentCleaner.cleanDocumentSegments(rawSegs);

      doc = {
        id: docId,
        filename,
        status: 'PROCESSING',
        total_chapters: chapters.length,
        total_segments: rawSegs.length,
        translated_segments: 0,
        raw_characters: rawText.length,
        cleaned_characters: rawText.length - cleanSaved,
        saved_characters: cleanSaved
      };

      await db.saveDocument(doc);

      for (const ch of chapters) {
        await db.saveChapter(ch);
      }

      await db.saveSegments(skippedSegments);
      await db.saveSegments(cleanedSegments);
    } else {
      doc.status = 'PROCESSING';
      await db.saveDocument(doc);
    }

    // 2. Récupérer tous les segments du document
    segments = await db.getDocumentSegments(docId);

    // 3. Résolution automatique via le Cache (Mémoire de Traduction) pour les PENDING
    const pendingSegs = segments.filter(s => s.status === 'PENDING');
    const { cachedSegments, newSegments, charactersSaved: memorySaved } = await TranslationMemory.deduplicateBatch(pendingSegs, targetLang);

    for (const cSeg of cachedSegments) {
      await db.updateSegmentStatus(cSeg.id, 'TRANSLATED', cSeg.translated_text);
    }

    if (memorySaved > 0) {
      doc.saved_characters = (doc.saved_characters || 0) + memorySaved;
      await db.saveDocument(doc);
    }

    // Mettre à jour la liste des segments à traduire
    segments = await db.getDocumentSegments(docId);
    const remainingToTranslate = segments.filter(s => s.status === 'PENDING' || s.status === 'FAILED');

    if (remainingToTranslate.length === 0) {
      doc.status = 'COMPLETED';
      doc.translated_segments = doc.total_segments;
      await db.saveDocument(doc);
      if (onProgress) onProgress('Traduction terminée (100% issue du cache et nettoyages) !', 100, doc);
      return this.reconstructDocument(docId);
    }

    // 4. Traitement par lots dynamiques via DeepL
    const batches = BatchEngine.createBatches(remainingToTranslate);
    const totalBatches = batches.length;

    for (let bIndex = 0; bIndex < totalBatches; bIndex++) {
      // Re-vérifier l'état du document au cas où l'utilisateur clique sur Pause
      const currentDocState = await db.getDocument(docId);
      if (currentDocState && currentDocState.status === 'PAUSED') {
        console.log(`[Pipeline] Document ${docId} mis en pause par l'utilisateur.`);
        if (onProgress) onProgress('Traduction mise en pause à la demande de l\'utilisateur.', Math.round((bIndex / totalBatches) * 100), currentDocState);
        return null;
      }

      // Vérifier le quota DeepL avant le batch
      if (apiKey) {
        const usageInfo = await QuotaGuard.getDeepLUsage(apiKey);
        const quotaEval = QuotaGuard.evaluateQuotaStatus(usageInfo);

        if (!quotaEval.canProceed) {
          doc.status = 'PAUSED';
          await db.saveDocument(doc);
          const pauseMsg = `Mise en pause automatique : ${quotaEval.message}`;
          if (onProgress) onProgress(pauseMsg, Math.round((bIndex / totalBatches) * 100), doc);
          throw new Error(pauseMsg);
        }
      }

      const batch = batches[bIndex];
      const sourceTexts = batch.map(s => s.source_text);
      const batchCharCount = sourceTexts.join('').length;

      const progressPct = Math.round(((bIndex + 1) / totalBatches) * 100);
      if (onProgress) {
        onProgress(`Traduction du lot ${bIndex + 1}/${totalBatches} (${batch.length} segments, ${batchCharCount} chars)...`, progressPct, doc);
      }

      try {
        const translatedTexts = await provider.translateBatch(sourceTexts, targetLang, sourceLang, apiKey);

        // Sauvegarde immédiate DB + Cache
        for (let i = 0; i < batch.length; i++) {
          const seg = batch[i];
          const transText = translatedTexts[i] || seg.source_text;

          await db.updateSegmentStatus(seg.id, 'TRANSLATED', transText);
          await TranslationMemory.save(seg.source_text, sourceLang, targetLang, transText, provider.getName());
          await db.logCharacterUsage(docId, seg.chapter_id, seg.id, seg.source_text.length, provider.getName(), 'SUCCESS');
        }

        // Mettre à jour le nombre de segments traduits dans le document
        const updatedSegs = await db.getDocumentSegments(docId);
        const translatedCount = updatedSegs.filter(s => s.status === 'TRANSLATED' || s.status === 'SKIPPED').length;
        doc.translated_segments = translatedCount;
        await db.saveDocument(doc);

      } catch (batchErr) {
        console.error(`[Pipeline] Échec du lot ${bIndex + 1}: ${batchErr.message}`);
        for (const seg of batch) {
          await db.updateSegmentStatus(seg.id, 'FAILED', null, batchErr.message);
          await db.logCharacterUsage(docId, seg.chapter_id, seg.id, seg.source_text.length, provider.getName(), 'FAILED');
        }

        if (batchErr.isQuotaExceeded) {
          doc.status = 'PAUSED';
          await db.saveDocument(doc);
          throw batchErr;
        }
      }
    }

    doc.status = 'COMPLETED';
    await db.saveDocument(doc);

    return this.reconstructDocument(docId);
  }

  /**
   * Mettre en pause une traduction
   */
  static async pauseTranslation(docId) {
    const doc = await db.getDocument(docId);
    if (doc) {
      doc.status = 'PAUSED';
      await db.saveDocument(doc);
      return true;
    }
    return false;
  }

  /**
   * Reconstruit le texte final traduit du document
   */
  static async reconstructDocument(docId) {
    const segments = await db.getDocumentSegments(docId);
    const translatedLines = [];

    for (const seg of segments) {
      if (seg.status === 'SKIPPED') {
        continue;
      }
      translatedLines.push(seg.translated_text || seg.source_text);
    }

    return translatedLines.join('\n\n');
  }
}

module.exports = TranslationPipeline;
