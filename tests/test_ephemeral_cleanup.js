const fs = require('fs');
const path = require('path');
const assert = require('assert');
const InMemoryJobStore = require('../services/storage/InMemoryJobStore');

function runEphemeralCleanupTests() {
  console.log('--- TEST 3: Nettoyage Éphémère & Validation Absence SQLite ---');

  // Test 3.1: database.sqlite ne doit PAS exister sur le disque
  const sqlitePath = path.join(__dirname, '..', 'data', 'database.sqlite');
  const sqliteExists = fs.existsSync(sqlitePath);
  assert.strictEqual(sqliteExists, false, 'Le fichier database.sqlite ne doit pas exister.');
  console.log('✓ Test 3.1 Réussi: Aucun fichier database.sqlite sur le disque.');

  // Test 3.2: DatabaseService.js ne doit pas exister
  const dbServicePath = path.join(__dirname, '..', 'services', 'storage', 'DatabaseService.js');
  const dbServiceExists = fs.existsSync(dbServicePath);
  assert.strictEqual(dbServiceExists, false, 'Le fichier DatabaseService.js ne doit pas exister.');
  console.log('✓ Test 3.2 Réussi: Dépendance et service SQLite supprimés.');

  // Test 3.3: Les jobs temporaires dans InMemoryJobStore sont purgés après fin/TTL
  const testJobId = 'job_temp_test';
  InMemoryJobStore.createJob(testJobId, 'novel.pdf', 'pdf');
  assert(InMemoryJobStore.getJob(testJobId) !== null);

  InMemoryJobStore.removeJob(testJobId);
  assert.strictEqual(InMemoryJobStore.getJob(testJobId), null, 'Le job doit être supprimé de la mémoire RAM.');
  console.log('✓ Test 3.3 Réussi: Libération des données temporaires en RAM.');

  // Test 3.4: Fichiers de code et de configuration préservés
  assert(fs.existsSync(path.join(__dirname, '..', 'server.js')), 'server.js doit être conservé.');
  assert(fs.existsSync(path.join(__dirname, '..', 'package.json')), 'package.json doit être conservé.');
  console.log('✓ Test 3.4 Réussi: Les fichiers de code et de configuration de l\'application sont intacts.');

  console.log('✅ TOUS LES TESTS DE NETTOYAGE ÉPHÉMÈRE ONT RÉUSSI !\n');
}

try {
  runEphemeralCleanupTests();
} catch (err) {
  console.error('❌ ÉCHEC TEST NETTOYAGE:', err);
  process.exit(1);
}
