const QuotaGuard = require('../services/optimization/QuotaGuard');
const assert = require('assert');

async function runQuotaGuardTests() {
  console.log('--- TEST 1: QuotaGuard — Providers Locaux & DeepL avec Marge de Sécurité ---');

  // Test 1.1: Provider Local (NLLB) doit TOUJOURS passer sans quota
  const nllbCheck = await QuotaGuard.checkPreTranslationQuota('nllb', null, 5000000, 'pdf');
  assert.strictEqual(nllbCheck.canProceed, true, 'NLLB local ne doit pas être bloqué par QuotaGuard.');
  console.log('✓ Test 1.1 Réussi: Provider local NLLB passe outre la vérification de quota.');

  // Test 1.2: Provider DeepL sans clé API -> Bloqué avec raison explicite
  const missingKeyCheck = await QuotaGuard.checkPreTranslationQuota('deepl', null, 10000, 'pdf');
  assert.strictEqual(missingKeyCheck.canProceed, false);
  assert.strictEqual(missingKeyCheck.reason, 'MISSING_API_KEY');
  console.log('✓ Test 1.2 Réussi: Détection de la clé API manquante.');

  // Test 1.3: Verification Marge de Sécurité (PDF: +10%)
  const mockUsage = { error: false, characterCount: 400000, characterLimit: 500000, charactersRemaining: 100000 };
  const originalGetDeepLUsage = QuotaGuard.getDeepLUsage;
  QuotaGuard.getDeepLUsage = async () => mockUsage;

  try {
    // Document de 95 000 chars -> Avec +10% marge = 104 500 chars > 100 000 restant -> Bloqué !
    const overQuotaCheck = await QuotaGuard.checkPreTranslationQuota('deepl', 'fake-key:fx', 95000, 'pdf');
    assert.strictEqual(overQuotaCheck.canProceed, false, 'Le document doit être bloqué en raison de la marge de sécurité (104 500 > 100 000).');
    assert.strictEqual(overQuotaCheck.reason, 'INSUFFICIENT_QUOTA');
    console.log('✓ Test 1.3 Réussi: Blocage préalable en tenant compte de la marge de sécurité (+10%).');

    // Document de 80 000 chars -> Avec +10% marge = 88 000 chars <= 100 000 restant -> Autorisé !
    const okQuotaCheck = await QuotaGuard.checkPreTranslationQuota('deepl', 'fake-key:fx', 80000, 'pdf');
    assert.strictEqual(okQuotaCheck.canProceed, true);
    console.log('✓ Test 1.4 Réussi: Traduction autorisée lorsque le quota restant est suffisant.');

  } finally {
    QuotaGuard.getDeepLUsage = originalGetDeepLUsage;
  }

  console.log('✅ TOUS LES TESTS QUOTAGUARD ONT RÉUSSI !\n');
}

runQuotaGuardTests().catch(err => {
  console.error('❌ ÉCHEC TEST QUOTAGUARD:', err);
  process.exit(1);
});
