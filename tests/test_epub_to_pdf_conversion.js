const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const JSZip = require('jszip');
const { PDFDocument } = require('pdf-lib');
const EpubProcessor = require('../services/epub/EpubProcessor');
const EpubToPdfConverter = require('../services/epub/EpubToPdfConverter');
const DiskJobStore = require('../services/storage/DiskJobStore');

async function createMockEpubWithImagesAndCss() {
  const zip = new JSZip();

  // 1. META-INF/container.xml
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
   <rootfiles>
      <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
   </rootfiles>
</container>`);

  // 2. OEBPS/content.opf
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <manifest>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>
    <item id="img1" href="cover.jpg" media-type="image/jpeg"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`);

  // 3. Style CSS
  zip.file('OEBPS/style.css', `
    body { font-family: sans-serif; color: #333; }
    h1 { color: #4f46e5; border-bottom: 1px solid #ccc; }
    p { line-height: 1.5; text-indent: 1.5em; }
  `);

  // 4. Image JPEG factice (1x1 pixel JPEG)
  const jpegHeader = Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00,
    0xFF, 0xDB, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C,
    0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12, 0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
    0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29, 0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27,
    0x39, 0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01,
    0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0xFF, 0xDA, 0x00, 0x08, 0x01,
    0x01, 0x00, 0x00, 0x3F, 0x00, 0xD2, 0xCF, 0x20, 0xFF, 0xD9
  ]);
  zip.file('OEBPS/cover.jpg', jpegHeader);

  // 5. OEBPS/chapter1.xhtml
  zip.file('OEBPS/chapter1.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>Chapitre 1</title>
  <link rel="stylesheet" href="style.css" type="text/css"/>
</head>
<body>
  <h1>Chapitre 1 : L'Aventure Commence</h1>
  <p>Ceci est le premier paragraphe du roman traduit.</p>
  <img src="cover.jpg" alt="Couverture du Livre"/>
</body>
</html>`);

  // 6. OEBPS/chapter2.xhtml
  zip.file('OEBPS/chapter2.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>Chapitre 2</title>
  <link rel="stylesheet" href="style.css" type="text/css"/>
</head>
<body>
  <h1>Chapitre 2 : La Forêt Sombre</h1>
  <p>Le chevalier continua son chemin à travers la forêt.</p>
</body>
</html>`);

  return await zip.generateAsync({ type: 'nodebuffer' });
}

async function runEpubToPdfTests() {
  console.log('====================================================');
  console.log(' 🧪 TEST SUITE: CONVERSION EPUB TRADUIT -> PDF');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(title, fn) {
    try {
      await fn();
      console.log(` [✅ PASS] ${title}`);
      passed++;
    } catch (err) {
      console.error(` [❌ FAIL] ${title}`);
      console.error(`          -> Error: ${err.message}`);
      failed++;
    }
  }

  const originalEpubBuffer = await createMockEpubWithImagesAndCss();
  const originalEpubHash = require('crypto').createHash('sha256').update(originalEpubBuffer).digest('hex');

  // TEST 1: EPUB Traduit -> PDF Conversion
  let translatedEpubBuffer = null;
  const docId = 'job_test_conv_' + Date.now();

  await test('Test 1: Traduction EPUB -> Génération de l\'EPUB Traduit en mémoire RAM', async () => {
    const mockProvider = {
      getName: () => 'MockTranslator',
      translateBatch: async (texts) => texts.map(t => `[FR] ${t}`)
    };

    translatedEpubBuffer = await EpubProcessor.processEpubDocument(
      docId,
      originalEpubBuffer,
      'original.epub',
      'FR',
      'en',
      null,
      mockProvider
    );

    assert(translatedEpubBuffer && translatedEpubBuffer.length > 0, "L'EPUB traduit doit être généré.");
    DiskJobStore.setTranslatedEpubBuffer(docId, translatedEpubBuffer);
  });

  // TEST 2: L'EPUB Original doit rester 100% Inchangé
  await test('Test 2: L\'EPUB original reste strictement inchangé (Hash SHA-256 identique)', async () => {
    const currentHash = require('crypto').createHash('sha256').update(originalEpubBuffer).digest('hex');
    assert.strictEqual(currentHash, originalEpubHash, "L'EPUB original n'a pas dû être altéré.");
  });

  // TEST 3: EPUB Traduit -> Conversion PDF
  let convertedPdfBuffer = null;
  await test('Test 3: Conversion optionnelle EPUB Traduit -> PDF (Puppeteer & Browser Local)', async () => {
    convertedPdfBuffer = await EpubToPdfConverter.convertEpubToPdf(
      docId,
      translatedEpubBuffer,
      'original_FR.epub'
    );

    assert(convertedPdfBuffer && convertedPdfBuffer.length > 0, "Le buffer PDF converti doit être valide.");
    
    // Vérification de la signature magique PDF (%PDF-)
    const isPdfMagic = convertedPdfBuffer.slice(0, 5).toString('ascii') === '%PDF-';
    assert.strictEqual(isPdfMagic, true, "Le fichier généré doit commencer par la signature PDF %PDF-.");

    const pdfDoc = await PDFDocument.load(convertedPdfBuffer, { ignoreEncryption: true });
    assert(pdfDoc.getPageCount() >= 1, "Le document PDF doit contenir au moins 1 page.");
  });

  // TEST 4: L'EPUB traduit reste disponible au téléchargement même après la conversion PDF
  await test('Test 4: L\'EPUB traduit reste stocké en RAM et téléchargeable', async () => {
    const ramEpub = DiskJobStore.getTranslatedEpubBuffer(docId);
    assert.ok(ramEpub, "L'EPUB traduit doit rester en mémoire RAM après conversion PDF.");
    assert.strictEqual(ramEpub.length, translatedEpubBuffer.length);
  });

  // TEST 5: Échec volontaire de la conversion PDF -> L'EPUB traduit reste préservé !
  await test('Test 5: Échec de conversion PDF -> L\'EPUB traduit reste intact et disponible', async () => {
    const invalidDocId = 'job_invalid_pdf_' + Date.now();
    try {
      await EpubToPdfConverter.convertEpubToPdf(invalidDocId, Buffer.from("INVALID EPUB DATA"));
      assert.fail("Aurait dû lever une erreur sur des données EPUB invalides.");
    } catch (err) {
      // Succès: L'erreur est bien attrapée
      assert(err.message.length > 0);
    }

    // L'EPUB traduit du job principal (docId) reste intact !
    const ramEpubStillAvailable = DiskJobStore.getTranslatedEpubBuffer(docId);
    assert.ok(ramEpubStillAvailable, "L'échec d'une conversion ne doit jamais détruire l'EPUB traduit existant.");
  });

  // TEST 6: Nettoyage des dossiers temporaires du disque
  await test('Test 6: Nettoyage garanti — Aucun dossier temporaire de conversion ne reste sur le disque', async () => {
    const tempDir = os.tmpdir();
    const items = fs.readdirSync(tempDir);
    const residualConvDirs = items.filter(name => name.startsWith(`novel_trad_pdf_${docId}`));
    assert.strictEqual(residualConvDirs.length, 0, "Tous les dossiers temporaires de conversion doivent avoir été nettoyés.");
  });

  console.log('\n====================================================');
  console.log(` RESULTATS: ${passed} PASS, ${failed} FAIL sur ${passed + failed} tests.`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runEpubToPdfTests().catch(err => {
  console.error('❌ ÉCHEC SUITE DE TESTS CONVERSION EPUB->PDF:', err);
  process.exit(1);
});

