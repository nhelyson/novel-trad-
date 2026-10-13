const axios = require('axios');
const assert = require('assert');

async function testLiveServerEndpoints() {
  console.log('================================================================');
  console.log(' 🌐 TEST ENDPOINTS SERVEUR NOVEL TRAD (http://localhost:3000)');
  console.log('================================================================\n');

  // 1. Dashboard Stats avec Clé Invalide
  console.log('1. Test /api/dashboard-stats (Clé Invalide)...');
  const res1 = await axios.get('http://localhost:3000/api/dashboard-stats?apiKey=invalidKey123:fx');
  assert.strictEqual(res1.data.quotaInfo.error, true);
  assert.strictEqual(res1.data.quotaInfo.reason, 'INVALID_API_KEY');
  console.log('✓ Endpoint /api/dashboard-stats gère correctement la clé invalide sans faire planter le serveur.');

  // 2. Dashboard Stats sans clé (Local stats)
  console.log('\n2. Test /api/dashboard-stats (Sans clé)...');
  const res2 = await axios.get('http://localhost:3000/api/dashboard-stats');
  assert.ok(res2.data.stats !== undefined);
  console.log('✓ Endpoint /api/dashboard-stats retourne les statistiques locales sans erreur.');

  console.log('\n✅ TOUS LES TESTS D\'INTEGRATION DU SERVEUR ONT REUSSI !');
}

testLiveServerEndpoints().catch(err => {
  console.error('❌ Erreur d\'intégration :', err.message);
  process.exit(1);
});
