const assert = require('assert');

const TextNormalizer = require('../services/optimization/TextNormalizer');
const DocumentCleaner = require('../services/optimization/DocumentCleaner');
const TranslationMemory = require('../services/optimization/TranslationMemory');
const QuotaGuard = require('../services/optimization/QuotaGuard');
const TextSegmenter = require('../services/optimization/TextSegmenter');
const BatchEngine = require('../services/optimization/BatchEngine');
const DiskJobStore = require('../services/storage/DiskJobStore');

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
    const norm1 = TextNormalizer.normalize("Hello world.");
    const norm2 = TextNormalizer.normalize("Hello   world.");
    assert.strictEqual(norm1, norm2, "La normalisation doit fusionner les espaces multiples");

    const hash1 = TextNormalizer.hash(norm1);
    const hash2 = TextNormalizer.hash(norm2);
    assert.strictEqual(hash1, hash2, "Les hashs doivent être identiques");

    await TranslationMemory.save("Hello world.", "EN", "FR", "Bonjour le monde.", "TestProvider");
    const cached = await TranslationMemory.lookup("Hello   world.", "FR");
    assert.ok(cached, "Le résultat doit être trouvé en cache éphémère");
    assert.strictEqual(cached.translatedText, "Bonjour le monde.");
  });

  // --- TEST 2: Même phrase dans deux documents différents ---
  await test('Test 2: Cache éphémère inter-documents', async () => {
    const novelA_text = "She looked at him silently.";
    await TranslationMemory.save(novelA_text, "EN", "FR", "Elle le regarda silencieusement.", "TestProvider");

    const novelB_lookup = await TranslationMemory.lookup("  She looked at him silently.  ", "FR");
    assert.ok(novelB_lookup, "Novel B doit bénéficier du cache créé par Novel A");
    assert.strictEqual(novelB_lookup.translatedText, "Elle le regarda silencieusement.");
  });

  // --- TEST 3: Gestion des jobs éphémères ---
  await test('Test 3: DiskJobStore enregistre et met à jour l\'état temporaire', async () => {
    const testDocId = 'job_test_resume_99';
    DiskJobStore.createJob(testDocId, 'test_novel.txt', 'text');
    DiskJobStore.updateJob(testDocId, { status: 'PAUSED', currentBlock: 3, totalBlocks: 5 });
    
    const loadedJob = DiskJobStore.getJob(testDocId);
    assert.strictEqual(loadedJob.status, 'PAUSED');
    assert.strictEqual(loadedJob.currentBlock, 3);
  });

  // --- TEST 4: Protection du Quota (Seuil 99%) ---
  await test('Test 4: Détection de seuil de quota 99% -> Pause automatique', async () => {
    const fakeUsage99 = { characterCount: 495000, characterLimit: 500000, percentUsed: 99.0 };
    const evalStatus = QuotaGuard.evaluateQuotaStatus(fakeUsage99);
    assert.strictEqual(evalStatus.canProceed, false, "Doit refuser de continuer si >= 99%");
    assert.strictEqual(evalStatus.warningLevel, 'AUTO_STOP_99');
  });

  // --- TEST 5: Gestion d'erreur et Statut FAILED dans DiskJobStore ---
  await test('Test 5: Erreur réseau -> Job marqué FAILED', async () => {
    const testJobId = 'job_err_test_1';
    DiskJobStore.createJob(testJobId, 'doc_test.pdf', 'pdf');
    DiskJobStore.failJob(testJobId, 'Connection timeout');

    const job = DiskJobStore.getJob(testJobId);
    assert.strictEqual(job.status, 'FAILED');
    assert.strictEqual(job.error, 'Connection timeout');
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

