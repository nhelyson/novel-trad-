const DocumentAnalyzer = require('./DocumentAnalyzer');
const PdfOptimizer = require('./PdfOptimizer');
const PdfSplitter = require('./PdfSplitter');
const PdfReconstructor = require('./PdfReconstructor');
const TranslationFactory = require('../translation/TranslationFactory');
const QuotaGuard = require('../optimization/QuotaGuard');
const PerformanceProfiler = require('../optimization/PerformanceProfiler');
const DiskJobStore = require('../storage/DiskJobStore');
const pdfParse = require('pdf-parse');

class DocumentProcessor {
  /**
   * Traitement intelligent et éphémère d'un document PDF pour la traduction.
   * Mesure chaque étape via PerformanceProfiler et rend compte en temps réel via DiskJobStore.
   */
  static async processPdfDocument(docId, pdfBuffer, filename, targetLang = 'FR', sourceLang = 'auto', apiKey = null, providerName = 'deepl', onProgress = null) {
    const effectiveDocId = docId || ('doc_pdf_' + Date.now());
    const profiler = new PerformanceProfiler(effectiveDocId);
    if (!DiskJobStore.getJob(effectiveDocId)) {
      await DiskJobStore.createJob(effectiveDocId, filename, 'pdf');
    }

    const translator = TranslationFactory.getProvider(providerName);

    // 1. Analyse initiale du document PDF
    DiskJobStore.setPhase(effectiveDocId, 'ANALYSIS', `Analyse du document PDF "${filename}"...`);
    if (onProgress) onProgress(`Analyse du document PDF "${filename}"...`, 2);
    
    const analysis = await DocumentAnalyzer.analyze(pdfBuffer, filename);
    profiler.endStep('1. Analyse PDF');

    // 2. Extraction du texte & Comptage réel des caractères
    DiskJobStore.setPhase(effectiveDocId, 'COUNTING', 'Comptage réel des caractères du document PDF...');
    let rawCharacters = 0;
    try {
      const parsedData = await pdfParse(pdfBuffer);
      rawCharacters = (parsedData.text || '').length;
    } catch (e) {
      // Fallback d'estimation basé sur la taille et le nombre de pages si le PDF est scanné ou protégé
      rawCharacters = Math.max(1000, analysis.pageCount * 2000);
    }
    profiler.endStep('2. Extraction & Comptage');

    // 3. Vérification du Quota DeepL (Si provider === 'deepl')
    DiskJobStore.setPhase(effectiveDocId, 'QUOTA_CHECK', 'Vérification du quota de traduction disponible...');
    const quotaCheck = await QuotaGuard.checkPreTranslationQuota(
      translator.getName(),
      apiKey,
      rawCharacters,
      'pdf'
    );

    if (!quotaCheck.canProceed) {
      DiskJobStore.failJob(effectiveDocId, quotaCheck.message);
      throw new Error(quotaCheck.message);
    }
    profiler.endStep('3. Vérification Quota');

    // 4. Traitement direct vs Mode Gros Document
    let translatedPdfBuffer = null;

    if (analysis.strategy === 'DIRECT') {
      DiskJobStore.setPhase(effectiveDocId, 'TRANSLATION', `Envoi vers ${translator.getName()} (Mode Direct)...`, {
        totalPages: analysis.pageCount
      });
      if (onProgress) onProgress(`Envoi du document PDF vers ${translator.getName()}...`, 10);
      
      translatedPdfBuffer = await translator.translateDocument(pdfBuffer, targetLang, sourceLang, apiKey, (statusMsg, pct) => {
        DiskJobStore.updateJobProgress(effectiveDocId, {
          statusMessage: statusMsg,
          progress: pct,
          phase: 'TRANSLATION'
        });
        if (onProgress) onProgress(statusMsg, pct);
      });
      profiler.endStep('4. Traduction Directe');
    } else {
      // Document > 9.5 Mo -> Optimisation & Découpage en lots
      DiskJobStore.setPhase(effectiveDocId, 'EXTRACTION', `Optimisation & Découpage par lots du PDF...`);
      if (onProgress) onProgress(`Document volumineux (${analysis.sizeMB} Mo). Optimisation et découpage...`, 5);
      
      const optimization = await PdfOptimizer.optimize(pdfBuffer);
      let targetBuffer = optimization.optimizedBuffer;

      if (optimization.isSafeForDeepL) {
        DiskJobStore.setPhase(effectiveDocId, 'TRANSLATION', `Envoi vers ${translator.getName()} (PDF Optimisé)...`, {
          totalPages: analysis.pageCount
        });
        translatedPdfBuffer = await translator.translateDocument(targetBuffer, targetLang, sourceLang, apiKey, onProgress);
        profiler.endStep('4. Traduction PDF Optimisé');
      } else {
        // Découpage en parties logiques
        const splitResult = await PdfSplitter.split(targetBuffer);
        const parts = splitResult.parts;
        const totalParts = parts.length;

        DiskJobStore.setPhase(effectiveDocId, 'TRANSLATION', `Traduction par lot : 0 / ${totalParts} parties`, {
          totalBlocks: totalParts,
          totalPages: analysis.pageCount
        });

        const translatedPartBuffers = [];
        const fs = require('fs');
        const path = require('path');
        const jobDir = DiskJobStore.getJobDir(effectiveDocId);

        for (let i = 0; i < totalParts; i++) {
          const part = parts[i];
          const partNum = i + 1;
          const partFilename = 'part_' + partNum + '.pdf';
          const partFilePath = path.join(jobDir, partFilename);
          
          DiskJobStore.setTranslationProgress(
            effectiveDocId,
            partNum,
            totalParts,
            `Traduction lot : ${partNum} / ${totalParts} (${part.title})`
          );

          let translatedPart;
          if (fs.existsSync(partFilePath)) {
            translatedPart = fs.readFileSync(partFilePath);
            if (onProgress) onProgress(`Lot ${partNum}/${totalParts} (${part.title}) : R�cup�r� du cache (Reprise)`, Math.round(15 + (i / totalParts) * 75 + (100 / 100) * (75 / totalParts)));
          } else {
            translatedPart = await translator.translateDocument(
              part.buffer,
              targetLang,
              sourceLang,
              apiKey,
              (statusText, subPct) => {
                if (onProgress) onProgress(`Lot ${partNum}/${totalParts} (${part.title}) : ${statusText}`, Math.round(15 + (i / totalParts) * 75 + (subPct / 100) * (75 / totalParts)));
              }
            );
            fs.writeFileSync(partFilePath, translatedPart);
          }

          translatedPartBuffers.push(translatedPart);
        }
        profiler.endStep('4. Traduction par Lots');

        // 5. Reconstruction et fusion des lots PDF traduits
        DiskJobStore.setPhase(effectiveDocId, 'RECONSTRUCTION', 'Assemblage et fusion des lots PDF...', {
          totalPages: analysis.pageCount
        });
        if (onProgress) onProgress('Reconstruction et fusion du PDF final...', 92);

        translatedPdfBuffer = await PdfReconstructor.reconstruct(translatedPartBuffers);
        profiler.endStep('5. Reconstruction PDF');
      }
    }

    profiler.endStep('6. Finalisation Buffer');
    const summary = profiler.getSummary();
    profiler.printSummaryConsole();

    DiskJobStore.completeJob(effectiveDocId, summary);
    return translatedPdfBuffer;
  }
}

module.exports = DocumentProcessor;


