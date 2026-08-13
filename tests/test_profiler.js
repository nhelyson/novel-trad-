const PerformanceProfiler = require('../services/optimization/PerformanceProfiler');
const assert = require('assert');

async function runProfilerTests() {
  console.log('--- TEST 4: PerformanceProfiler — Mesures Finies du Pipeline ---');

  const profiler = new PerformanceProfiler('job_profiler_test');

  // Étape 1: Simulation Analyse
  await new Promise(r => setTimeout(r, 50));
  profiler.endStep('Analyse Document');

  // Étape 2: Simulation Extraction
  await new Promise(r => setTimeout(r, 100));
  profiler.endStep('Extraction & Comptage');

  // Étape 3: Simulation Traduction
  await new Promise(r => setTimeout(r, 150));
  profiler.endStep('Traduction DeepL');

  // Étape 4: Simulation Reconstruction
  await new Promise(r => setTimeout(r, 80));
  profiler.endStep('Reconstruction PDF');

  const summary = profiler.getSummary();

  assert.strictEqual(summary.jobId, 'job_profiler_test');
  assert(summary.totalMs >= 350, 'Le temps total mesuré doit être >= 350 ms.');
  assert(summary.steps['Analyse Document'].ms >= 40);
  assert(summary.steps['Extraction & Comptage'].ms >= 90);
  assert(summary.steps['Traduction DeepL'].ms >= 140);
  assert(summary.steps['Reconstruction PDF'].ms >= 70);

  console.log('✓ Test 4.1 Réussi: Mesure déterministe de chaque étape du pipeline.');
  profiler.printSummaryConsole();

  console.log('✅ TOUS LES TESTS DE PROFILAGE ONT RÉUSSI !\n');
}

runProfilerTests().catch(err => {
  console.error('❌ ÉCHEC TEST PROFILER:', err);
  process.exit(1);
});
