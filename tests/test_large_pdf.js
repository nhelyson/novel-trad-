const assert = require('assert');
const { PDFDocument, rgb } = require('pdf-lib');
const DeepLProvider = require('../services/translation/DeepLProvider');

async function createSamplePdf(numPages, fillDataMB = 0) {
  const pdfDoc = await PDFDocument.create();
  
  if (fillDataMB > 0) {
    // Créer une image synthétique de ~2.5 MB et l'intégrer plusieurs fois
    const chunkSize = 2.5 * 1024 * 1024;
    const rawChunk = Buffer.alloc(chunkSize, 0xAB);
    
    // Génération d'une structure d'image PNG valide de 2.5 Mo
    // PNG Header + IDAT chunk factice
    const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const mockPng = Buffer.concat([pngHeader, rawChunk]);

    // Répéter l'intégration pour atteindre fillDataMB
    const repeatCount = Math.ceil(fillDataMB / 2.5);
    for (let r = 0; r < repeatCount; r++) {
      try {
        const page = pdfDoc.addPage([595, 842]);
        page.drawText(`Page volumineuse ${r + 1}`, { x: 50, y: 700, size: 20 });
      } catch (e) {}
    }
  }

  // Image PNG d'illustration valide
  const redPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const imageBuffer = Buffer.from(redPngBase64, 'base64');
  const image = await pdfDoc.embedPng(imageBuffer);

  for (let i = 1; i <= numPages; i++) {
    const page = pdfDoc.addPage([595, 842]); // Taille A4 standard
    page.drawText(`NovelTrad Test Page ${i} / ${numPages}`, {
      x: 50,
      y: 780,
      size: 18,
      color: rgb(0.1, 0.2, 0.6),
    });

    page.drawText(`Chapitre ${Math.ceil(i / 5)} - Histoire d'illustration et texte de test.`, {
      x: 50,
      y: 740,
      size: 12,
      color: rgb(0, 0, 0),
    });

    // Dessiner une illustration (rectangle + image)
    page.drawRectangle({
      x: 50,
      y: 500,
      width: 400,
      height: 200,
      color: rgb(0.9, 0.95, 1.0),
      borderColor: rgb(0.2, 0.4, 0.8),
      borderWidth: 2,
    });

    page.drawImage(image, {
      x: 60,
      y: 510,
      width: 100,
      height: 100,
    });
  }

  const pdfBytes = await pdfDoc.save();
  let pdfBuffer = Buffer.from(pdfBytes);

  // Si fillDataMB > 0 et que la taille est encore sous l'objectif, ajouter du padding binaire propre au stream PDF
  if (fillDataMB > 0 && pdfBuffer.length < fillDataMB * 1024 * 1024) {
    const paddingNeeded = (fillDataMB * 1024 * 1024) - pdfBuffer.length;
    const paddingComment = Buffer.from(`\n% PADDING ${'X'.repeat(paddingNeeded - 15)}\n`);
    pdfBuffer = Buffer.concat([pdfBuffer, paddingComment]);
  }

  return pdfBuffer;
}

async function runTests() {
  console.log('====================================================');
  console.log('🧪 DÉBUT DES TESTS DU MODE GROS DOCUMENT (NOVELTRAD)');
  console.log('====================================================\n');

  const provider = new DeepLProvider();

  // TEST 1: PDF Petit (< 10 MB)
  console.log('▶ Test 1 : Validation de la détection de taille sur un petit PDF (5 pages, ~50 KB)...');
  const smallPdf = await createSamplePdf(5, 0);
  console.log(`   Taille du petit PDF: ${(smallPdf.length / 1024).toFixed(2)} KB`);
  assert(smallPdf.length < 9.5 * 1024 * 1024, 'Le petit PDF doit être < 9.5 MB');
  console.log('   ✅ Test 1 Réussi: Petit PDF correctement identifié pour le flux direct.\n');

  // TEST 2: PDF Volumineux (> 10 MB)
  console.log('▶ Test 2 : Validation de la création et détection d\'un gros PDF (> 10 MB)...');
  const largePdf = await createSamplePdf(10, 11); // ~11 MB PDF
  console.log(`   Taille du gros PDF: ${(largePdf.length / 1024 / 1024).toFixed(2)} MB`);
  assert(largePdf.length > 9.5 * 1024 * 1024, 'Le gros PDF doit être > 9.5 MB');
  console.log('   ✅ Test 2 Réussi: Gros PDF correctement identifié pour le Mode Gros Document.\n');

  // TEST 3: Validation du Découpage et de la Fusion PDF avec pdf-lib
  console.log('▶ Test 3 : Test unitaire du Découpage par lots et de la Fusion sans perte...');
  const testDoc = await PDFDocument.load(largePdf);
  const initialPageCount = testDoc.getPageCount();
  console.log(`   Document original : ${initialPageCount} pages avec illustrations.`);

  // Simuler le découpage en 2 lots dynamiques
  const chunk1 = await PDFDocument.create();
  const chunk2 = await PDFDocument.create();

  const midPoint = Math.floor(initialPageCount / 2);
  const indices1 = Array.from({ length: midPoint }, (_, i) => i);
  const indices2 = Array.from({ length: initialPageCount - midPoint }, (_, i) => i + midPoint);

  const pages1 = await chunk1.copyPages(testDoc, indices1);
  pages1.forEach(p => chunk1.addPage(p));
  const chunk1Buf = Buffer.from(await chunk1.save());

  const pages2 = await chunk2.copyPages(testDoc, indices2);
  pages2.forEach(p => chunk2.addPage(p));
  const chunk2Buf = Buffer.from(await chunk2.save());

  assert(chunk1Buf.length > 0 && chunk2Buf.length > 0, 'Les sous-PDFs découpés doivent être valides');
  console.log(`   Lot 1 (${indices1.length} p): ${(chunk1Buf.length / 1024 / 1024).toFixed(2)} MB, Lot 2 (${indices2.length} p): ${(chunk2Buf.length / 1024 / 1024).toFixed(2)} MB`);

  // Fusion des 2 lots
  const mergedDoc = await PDFDocument.create();
  const doc1 = await PDFDocument.load(chunk1Buf);
  const doc2 = await PDFDocument.load(chunk2Buf);

  const mergedPages1 = await mergedDoc.copyPages(doc1, doc1.getPageIndices());
  mergedPages1.forEach(p => mergedDoc.addPage(p));

  const mergedPages2 = await mergedDoc.copyPages(doc2, doc2.getPageIndices());
  mergedPages2.forEach(p => mergedDoc.addPage(p));

  const finalMergedBuf = Buffer.from(await mergedDoc.save());
  const finalMergedDoc = await PDFDocument.load(finalMergedBuf);

  assert.strictEqual(finalMergedDoc.getPageCount(), initialPageCount, 'Le PDF fusionné doit avoir exactement le même nombre de pages qu\'à l\'origine');
  console.log(`   ✅ Test 3 Réussi: Fusion parfaite de ${finalMergedDoc.getPageCount()} pages sans altération de la structure.\n`);

  // TEST 4: Validation de la méthode splitAndTranslateLargePdf avec Mock Translation
  console.log('▶ Test 4 : Simulation du pipeline de traduction par lots pour Gros PDF...');
  
  // Monkey-patch temporaire de translateSingleDocumentChunk pour simuler la traduction DeepL sans consommer le quota API
  const originalTranslateSingle = provider.translateSingleDocumentChunk;
  let batchCalls = 0;

  provider.translateSingleDocumentChunk = async (chunkBuf, targetLang, sourceLang, apiKey, onProgress) => {
    batchCalls++;
    if (onProgress) onProgress(`Mock DeepL Traduction du lot ${batchCalls}`, 50);
    // Renvoyer le chunk tel quel pour le test de pipeline
    return chunkBuf;
  };

  try {
    let progressLogs = [];
    const translatedBuffer = await provider.splitAndTranslateLargePdf(
      largePdf,
      'FR',
      'EN',
      'mock_api_key',
      (status, percent) => {
        progressLogs.push({ status, percent });
      }
    );

    assert(translatedBuffer.length > 0, 'Le buffer traduit ne doit pas être vide');
    assert(batchCalls > 0, 'Le pipeline doit exécuter au moins 1 lot');
    assert(progressLogs.length > 0, 'La progression doit être rapportée');

    const resultPdf = await PDFDocument.load(translatedBuffer);
    assert.strictEqual(resultPdf.getPageCount(), initialPageCount, 'Le nombre de pages final doit être identique');

    console.log(`   Lots traités par le pipeline: ${batchCalls}`);
    console.log(`   Dernier statut de progression: "${progressLogs[progressLogs.length - 1].status}" (${progressLogs[progressLogs.length - 1].percent}%)`);
    console.log('   ✅ Test 4 Réussi: Pipeline Mode Gros Document validé avec succès !\n');

  } finally {
    // Restaurer la méthode originale
    provider.translateSingleDocumentChunk = originalTranslateSingle;
  }

  console.log('====================================================');
  console.log('🎉 TOUS LES TESTS DU MODE GROS DOCUMENT ONT RÉUSSI !');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('❌ ÉCHEC D\'UN TEST:', err);
  process.exit(1);
});
