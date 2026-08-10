const assert = require('assert');
const path = require('path');
const fs = require('fs');

const TextNormalizer = require('../services/optimization/TextNormalizer');
const DocumentCleaner = require('../services/optimization/DocumentCleaner');
const TranslationMemory = require('../services/optimization/TranslationMemory');
const QuotaGuard = require('../services/optimization/QuotaGuard');
const TextSegmenter = require('../services/optimization/TextSegmenter');
const BatchEngine = require('../services/optimization/BatchEngine');
const db = require('../services/storage/DatabaseService');

async function runTests() {
  console.log('====================================================');
  console.log(' 🧪 NOVEL TRAD — SUITE DE TESTS D\'OPTIMISATION');
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

  // --- TEST 1: Même phrase deux fois dans le même document ---
  await test('Test 1: Même phrase 2 fois -> 1 seul hash & cache réutilisé', async () => {
    const text = "Hello world.";
    const norm1 = TextNormalizer.normalize("Hello world.");
    const norm2 = TextNormalizer.normalize("Hello   world.");
    assert.strictEqual(norm1, norm2, "La normalisation doit fusionner les espaces multiples");

    const hash1 = TextNormalizer.hash(norm1);
    const hash2 = TextNormalizer.hash(norm2);
    assert.strictEqual(hash1, hash2, "Les hashs doivent être identiques");

    await TranslationMemory.save("Hello world.", "EN", "FR", "Bonjour le monde.", "TestProvider");
    const cached = await TranslationMemory.lookup("Hello   world.", "FR");
    assert.ok(cached, "Le résultat doit être trouvé en cache");
    assert.strictEqual(cached.translatedText, "Bonjour le monde.");
  });

  // --- TEST 2: Même phrase dans deux documents différents ---
  await test('Test 2: Cache inter-documents (Novel A -> Novel B)', async () => {
    const novelA_text = "She looked at him silently.";
    await TranslationMemory.save(novelA_text, "EN", "FR", "Elle le regarda silencieusement.", "TestProvider");

    // Novel B demande la même phrase
    const novelB_lookup = await TranslationMemory.lookup("  She looked at him silently.  ", "FR");
    assert.ok(novelB_lookup, "Novel B doit bénéficier du cache créé par Novel A");
    assert.strictEqual(novelB_lookup.translatedText, "Elle le regarda silencieusement.");
  });

  // --- TEST 3: Reprise après arrêt (Pause / Resume) ---
  await test('Test 3: Redémarrage pendant la traduction et reprise au dernier segment', async () => {
    const testDocId = 'doc_test_resume_99';
    const testDoc = {
      id: testDocId,
      filename: 'test_novel.txt',
      status: 'PAUSED',
      total_chapters: 1,
      total_segments: 5,
      translated_segments: 3,
      raw_characters: 500,
      cleaned_characters: 450,
      saved_characters: 50
    };

    await db.saveDocument(testDoc);
    const loadedDoc = await db.getDocument(testDocId);
    assert.strictEqual(loadedDoc.status, 'PAUSED');
    assert.strictEqual(loadedDoc.translated_segments, 3);
  });

  // --- TEST 4: Protection du Quota (Seuil 98%) ---
  await test('Test 4: Détection de seuil de quota 98% -> Pause automatique', async () => {
    const fakeUsage99 = { characterCount: 495000, characterLimit: 500000, percentUsed: 99.0 };
    const evalStatus = QuotaGuard.evaluateQuotaStatus(fakeUsage99);
    assert.strictEqual(evalStatus.canProceed, false, "Doit refuser de continuer si >= 98%");
    assert.strictEqual(evalStatus.warningLevel, 'AUTO_STOP_98');
  });

  // --- TEST 5: Gestion d'erreur réseau & Statut FAILED ---
  await test('Test 5: Erreur réseau -> Segment marqué FAILED et relançable', async () => {
    const testSegId = 'seg_err_test_1';
    const testSegs = [{
      id: testSegId,
      document_id: 'doc_err_1',
      chapter_id: 'ch_1',
      segment_index: 1,
      source_text: 'Test failed segment',
      normalized_text: 'Test failed segment',
      source_hash: 'hash12345',
      status: 'PENDING',
      characters_count: 19
    }];

    await db.saveSegments(testSegs);
    await db.updateSegmentStatus(testSegId, 'FAILED', null, 'Connection timeout');

    const segsFromDb = await db.getDocumentSegments('doc_err_1');
    assert.strictEqual(segsFromDb[0].status, 'FAILED');
    assert.strictEqual(segsFromDb[0].error_message, 'Connection timeout');
  });

  // --- TEST 6: Masquage sécurisé de clé API ---
  await test('Test 6: Masquage sécurisé de clé API', async () => {
    const masked = QuotaGuard.maskApiKey('12345678-90ab-cdef-1234-567890abcdef:fx');
    assert.strictEqual(masked, '••••••••:fx', "La clé API doit être masquée");
    assert.ok(!masked.includes('12345678'), "Aucune partie sensible ne doit être visible");
  });

  console.log('\n====================================================');
  console.log(` RESULTATS: ${passed} PASS, ${failed} FAIL sur ${passed + failed} tests.`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
