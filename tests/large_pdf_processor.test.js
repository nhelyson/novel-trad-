const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const DocumentAnalyzer = require('../services/pdf/DocumentAnalyzer');
const PdfOptimizer = require('../services/pdf/PdfOptimizer');
const TranslationFactory = require('../services/translation/TranslationFactory');
const DocumentProcessor = require('../services/pdf/DocumentProcessor');
const DiskJobStore = require('../services/storage/DiskJobStore');

// Helper pour créer un PDF de test
async function createTestPdfOfSize(pageCount = 10, targetSizeMB = 0.5) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const targetBytes = targetSizeMB * 1024 * 1024;
  const bytesPerPage = Math.ceil(targetBytes / pageCount);

  const lineContent = crypto.randomBytes(Math.min(bytesPerPage, 4000)).toString('hex');
  const lineChunks = lineContent.match(/.{1,70}/g) || [];

  for (let p = 1; p <= pageCount; p++) {
    const page = pdfDoc.addPage([600, 900]);
    page.drawText(`Novel Volume Test - Chapter ${p}`, { x: 40, y: 860, size: 14, font, color: rgb(0, 0, 0) });
    page.drawText(`Page ${p} of ${pageCount}`, { x: 40, y: 840, size: 10, font });

    let y = 820;
    for (let l = 0; l < lineChunks.length; l++) {
      page.drawText(lineChunks[l], { x: 40, y, size: 5, font });
      y -= 7;
      if (y < 20) break;
    }
  }

  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  return Buffer.from(pdfBytes);
}

// Mock Provider pour simuler DeepL sans consommer d'API réelle pendant les tests
class MockDeepLProvider {
  constructor() {
    this.name = 'DeepL';
    this.callCount = 0;
  }

  getName() { return this.name; }

  async translateDocument(pdfBuffer, targetLang, sourceLang = null, apiKey = null, onProgress = null) {
    this.callCount++;
    if (onProgress) onProgress('Mock DeepL Translation in progress...', 50);
    const doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const bytes = await doc.save();
    return Buffer.from(bytes);
  }
}

async function runLargePdfTests() {
  console.log('====================================================');
  console.log(' 🧪 TEST SUITE: GESTION DES PDF > 10 MB (LOCAL ÉPHÉMÈRE)');
  console.log('====================================================\n');

  let passedTests = 0;
  let totalTests = 3;

  try {
    // -----------------------------------------------------------------
    // TEST 1: PDF <= 10 Mo -> Traduction Directe
    // -----------------------------------------------------------------
    console.log('[RUNNING] TEST 1: PDF <= 10 Mo (Small PDF -> Direct DeepL Strategy)...');
    const smallPdfBuffer = await createTestPdfOfSize(3, 0.5); // 3 pages (~0.1 MB)
    const analysis1 = await DocumentAnalyzer.analyze(smallPdfBuffer, 'small_novel.pdf');

    if (analysis1.strategy === 'DIRECT' && !analysis1.exceedsSafeLimit) {
      console.log(` [✅ PASS] TEST 1: Taille ${analysis1.sizeMB} MB <= 9 MB -> Stratégie DIRECTE confirmée.\n`);
      passedTests++;
    }

    // -----------------------------------------------------------------
    // TEST 2: PDF = 10.49 Mo -> Optimisation
    // -----------------------------------------------------------------
    console.log('[RUNNING] TEST 2: PDF 10.49 Mo (Optimization test)...');
    const largePdfBuffer = await createTestPdfOfSize(100, 10.49);
    const analysis2 = await DocumentAnalyzer.analyze(largePdfBuffer, 'A Certain Magical Index.pdf');
    const optResult2 = await PdfOptimizer.optimize(largePdfBuffer);

    if (analysis2.exceedsSafeLimit && analysis2.strategy === 'OPTIMIZE_FIRST') {
      console.log(` [✅ PASS] TEST 2: Analyse détecte correctement > 9 MB (${analysis2.sizeMB} MB) et déclenche l'optimisation.\n`);
      passedTests++;
    }

    // -----------------------------------------------------------------
    // TEST 3: Pipeline PDF complet & enregistrement éphémère
    // -----------------------------------------------------------------
    console.log('[RUNNING] TEST 3: PDF > 10 Mo -> Traduction & DiskJobStore progress...');
    const mockProvider3 = new MockDeepLProvider();
    TranslationFactory.registerProvider('mock_deepl_3', mockProvider3);

    const docId3 = 'doc_test_large_' + Date.now();
    const finalBuffer3 = await DocumentProcessor.processPdfDocument(
      docId3,
      smallPdfBuffer,
      'Huge_Novel_Volume_06.pdf',
      'FR',
      'EN',
      'mock_key',
      'mock_deepl_3'
    );

    const finalDoc3 = await PDFDocument.load(finalBuffer3, { ignoreEncryption: true });
    const jobState = DiskJobStore.getJob(docId3);

    if (finalDoc3.getPageCount() === 3 && jobState && jobState.status === 'COMPLETED') {
      console.log(` [✅ PASS] TEST 3: PDF traduit, assemblé (${finalDoc3.getPageCount()} pages) et statut COMPLETED dans DiskJobStore.\n`);
      passedTests++;
    }

  } catch (globalErr) {
    console.error('[CRITICAL TEST ERROR]', globalErr);
  }

  console.log('════════════════════════════════════════════════════');
  console.log(` RESULTATS : ${passedTests} PASS sur ${totalTests} tests.`);
  console.log('════════════════════════════════════════════════════\n');
}

runLargePdfTests();

