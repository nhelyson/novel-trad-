const JSZip = require('jszip');
const EpubProcessor = require('../services/epub/EpubProcessor');
const assert = require('assert');

async function createMockEpubBuffer() {
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
    <item id="img1" href="cover.jpg" media-type="image/jpeg"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`);

  // 3. Image factice
  zip.file('OEBPS/cover.jpg', Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]));

  // 4. OEBPS/chapter1.xhtml
  zip.file('OEBPS/chapter1.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 1</title></head>
<body>
  <h1 class="chapter-title" id="title1">Chapter 1: The Beginning</h1>
  <p class="intro">Once upon a time in a faraway novel kingdom.</p>
  <img src="cover.jpg" alt="Cover Image"/>
</body>
</html>`);

  // 5. OEBPS/chapter2.xhtml
  zip.file('OEBPS/chapter2.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 2</title></head>
<body>
  <h1 class="chapter-title">Chapter 2: The Journey</h1>
  <p>The brave knight traveled across the dark forest.</p>
</body>
</html>`);

  return await zip.generateAsync({ type: 'nodebuffer' });
}

async function runEpubTests() {
  console.log('--- TEST 2: Pipeline EPUB — Parsing DOM/XML, Images et Traduction ---');

  const epubBuffer = await createMockEpubBuffer();

  // Test 2.1: Analyse EPUB
  const analysis = await EpubProcessor.analyze(epubBuffer, 'test_novel.epub');
  assert.strictEqual(analysis.chapterCount, 2, 'Doit détecter 2 chapitres.');
  assert(analysis.totalCharacters > 50, 'Doit avoir extrait les caractères.');
  console.log(`✓ Test 2.1 Réussi: Analyse EPUB (${analysis.chapterCount} chapitres, ${analysis.totalCharacters} caractères).`);

  // Test 2.2: Mock Provider de traduction
  const mockProvider = {
    getName: () => 'MockTranslator',
    translateBatch: async (texts) => texts.map(t => `[FR] ${t}`)
  };

  // Test 2.3: Traitement complet de traduction et reconstruction
  const translatedEpubBuffer = await EpubProcessor.processEpubDocument(
    'job_test_epub',
    epubBuffer,
    'test_novel.epub',
    'FR',
    'en',
    null,
    mockProvider
  );

  assert(translatedEpubBuffer.length > 0, 'Le buffer EPUB produit doit être valide.');

  // Test 2.4: Vérification que la structure XHTML et les attributs sont intacts
  const resZip = await JSZip.loadAsync(translatedEpubBuffer);
  const ch1Content = await resZip.file('OEBPS/chapter1.xhtml').async('text');

  assert(ch1Content.includes('class="chapter-title"'), 'Doit conserver la classe CSS.');
  assert(ch1Content.includes('id="title1"'), "Doit conserver l'ID HTML.");
  assert(ch1Content.includes('src="cover.jpg"'), 'Doit conserver la référence image.');
  assert(ch1Content.includes('[FR] Chapter 1: The Beginning'), 'Doit avoir traduit le texte du titre.');
  assert(ch1Content.includes('[FR] Once upon a time'), 'Doit avoir traduit le paragraphe.');

  // Test 2.5: Image conservée dans le zip
  const imgFile = resZip.file('OEBPS/cover.jpg');
  assert(imgFile !== null, "L'image originale doit être conservée intacte.");

  console.log('✓ Test 2.4 Réussi: Conservation stricte des balises, attributs, images et styles XML/HTML sans aucune regex.');
  console.log('✅ TOUS LES TESTS PIPELINE EPUB ONT RÉUSSI !\n');
}

runEpubTests().catch(err => {
  console.error('❌ ÉCHEC TEST EPUB:', err);
  process.exit(1);
});
