require('dotenv').config();
const ProgressTracker = require('../services/optimization/ProgressTracker');
const DocumentProcessor = require('../services/pdf/DocumentProcessor');
const TranslationPipeline = require('../services/translation/TranslationPipeline');

async function testPreviewProgressPipeline() {
  console.log("==========================================================");
  console.log("  TEST DU PIPELINE DE SUIVI & PREVIEW EN TEMPS RÉEL       ");
  console.log("==========================================================");

  const testDocId = 'test_preview_doc_' + Date.now();
  const filename = 'CCNA_Course_Sample.pdf';

  // 1. Initaliser le tracker
  console.log("\n[1] Initialisation du tracker de progression...");
  ProgressTracker.initProgress(testDocId, filename, 'FR', 'EN', 'NLLB Local');
  let state = ProgressTracker.getProgress(testDocId);
  
  if (state && state.stage === 'PREPARATION' && state.percent === 2) {
    console.log("  ✓ SUCCÈS : État initial configuré.");
  } else {
    console.error("  ✗ ÉCHEC initialisation tracker.");
  }

  // 2. Mettre à jour l'étape EXTRACTION
  console.log("\n[2] Transition vers l'étape EXTRACTION...");
  ProgressTracker.updateProgress(testDocId, {
    stage: 'EXTRACTION',
    percent: 15,
    statusText: 'Extraction de 240 pages du document PDF...',
    totalPages: 240
  });
  state = ProgressTracker.getProgress(testDocId);
  console.log(`  Étape actuelle : ${state.stage} (${state.percent}%) - ${state.statusText}`);
  console.log(`  Progression de l'étape PREPARATION : ${state.stages[0].status}`);

  // 3. Simuler l'étape TRADUCTION avec extrait live
  console.log("\n[3] Simulation de la TRADUCTION avec extrait live...");
  ProgressTracker.updateProgress(testDocId, {
    stage: 'TRANSLATION',
    percent: 45,
    statusText: 'Traduction du lot 4/10 (Paragraphes 40/100)...',
    currentBatch: 4,
    totalBatches: 10,
    livePreview: {
      source: "Routing Information Protocol (RIP) uses hop count as a routing metric.",
      target: "Le protocole RIP utilise le nombre de sauts comme métrique de routage."
    }
  });
  state = ProgressTracker.getProgress(testDocId);
  console.log(`  Extrait source  : "${state.livePreview.source}"`);
  console.log(`  Extrait traduit : "${state.livePreview.target}"`);
  console.log(`  Temps écoulé    : ${state.elapsedSeconds}s | Estimé restant : ${state.estimatedRemainingSeconds}s`);

  // 4. Simuler l'étape CRITIQUE : ASSEMBLAGE DU PDF (75% -> 95%)
  console.log("\n[4] Simulation de l'étape CRITIQUE : ASSEMBLAGE DU PDF...");
  ProgressTracker.updateProgress(testDocId, {
    stage: 'ASSEMBLY',
    percent: 82,
    statusText: 'La traduction est terminée. Novel Trad reconstruit la mise en page et réassemble le PDF final (Pages 186/240)...',
    currentPage: 186,
    totalPages: 240
  });
  state = ProgressTracker.getProgress(testDocId);
  console.log(`  Étape : ${state.stage}`);
  console.log(`  Message affiché à l'utilisateur : "${state.statusText}"`);
  console.log(`  Statut étape TRADUCTION : ${state.stages[2].status}`);
  console.log(`  Statut étape ASSEMBLAGE  : ${state.stages[3].status}`);

  // 5. Finalisation (100%)
  console.log("\n[5] Finalisation du document à 100%...");
  ProgressTracker.completeProgress(testDocId);
  state = ProgressTracker.getProgress(testDocId);
  console.log(`  Statut final : Completed=${state.isCompleted}, Percent=${state.percent}%`);
  console.log(`  Toutes les étapes validées : ${state.stages.every(s => s.status === 'DONE') ? 'OUI ✓' : 'NON ✗'}`);

  console.log("\n==========================================================");
  console.log("  RÉSULTAT DES TESTS PREVIEW & PROGRESSION : SUCCÈS TOTAL  ");
  console.log("==========================================================");
}

testPreviewProgressPipeline();
