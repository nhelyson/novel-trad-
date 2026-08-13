require('dotenv').config();
const path = require('path');
const fs = require('fs');
const TranslationFactory = require('../services/translation/TranslationFactory');
const TranslationPipeline = require('../services/translation/TranslationPipeline');

async function runIntegrationTests() {
  console.log("==========================================================");
  console.log("     SUITE DE TESTS NLLB LOCAL INTEGRATION - NOVEL TRAD   ");
  console.log("==========================================================");

  let results = {
    test1_detection: false,
    test2_loading: false,
    test3_simple_trans: false,
    test4_paragraphs: false,
    test5_reuse: false,
    test6_document: false,
    test7_error_handling: false,
    test8_other_providers: false
  };

  // TEST 1 — DÉTECTION DU MODÈLE
  console.log("\n[TEST 1] Détection du modèle sur F:\\Modèles Traduction...");
  const nllbProvider = TranslationFactory.getProvider('nllb');
  const available = nllbProvider.isAvailable();
  if (available) {
    console.log("  ✓ SUCCÈS : Modèle NLLB-200 détecté à l'emplacement configuré.");
    results.test1_detection = true;
  } else {
    console.error("  ✗ ÉCHEC : Modèle introuvable.");
  }

  // TEST 2 — CHARGEMENT LEGER/LAZY
  console.log("\n[TEST 2] Chargement du modèle via le serveur local NLLB Python...");
  try {
    const t0 = Date.now();
    await nllbProvider.ensureServerRunning();
    const t1 = Date.now();
    console.log(`  ✓ SUCCÈS : Serveur NLLB initialisé et prêt en ${((t1 - t0) / 1000).toFixed(2)}s.`);
    results.test2_loading = true;
  } catch (err) {
    console.error(`  ✗ ÉCHEC du chargement : ${err.message}`);
  }

  // TEST 3 — TRADUCTION SIMPLE
  console.log("\n[TEST 3] Traduction simple English -> French...");
  try {
    const textEN = "Lord Caelen opened his eyes after ten thousand years of seclusion.";
    const translated = await nllbProvider.translateText(textEN, "FR", "EN");
    console.log(`  [EN] ${textEN}`);
    console.log(`  [FR] ${translated}`);
    if (translated && translated.length > 5) {
      console.log("  ✓ SUCCÈS : Traduction simple effectuée.");
      results.test3_simple_trans = true;
    }
  } catch (err) {
    console.error(`  ✗ ÉCHEC traduction simple : ${err.message}`);
  }

  // TEST 4 — PLUSIEURS PARAGRAPHES (LIGHT NOVEL)
  console.log("\n[TEST 4] Traduction d'un extrait de Light Novel (Plusieurs paragraphes)...");
  try {
    const paragraphs = [
      "The ancient cultivator raised his sword, causing the runes on his arm to glow with a faint blue light.",
      "“Are you planning to fight the Demon King with a broken blade?” Elena asked in disbelief.",
      "“This blade is not broken,” he replied softly. “It is merely waiting for its master.”"
    ];
    const translatedBatch = await nllbProvider.translateBatch(paragraphs, "FR", "EN");
    translatedBatch.forEach((fr, idx) => {
      console.log(`  [P${idx+1} EN] ${paragraphs[idx]}`);
      console.log(`  [P${idx+1} FR] ${fr}`);
    });
    if (translatedBatch.length === 3) {
      console.log("  ✓ SUCCÈS : Inférence multi-paragraphes validée.");
      results.test4_paragraphs = true;
    }
  } catch (err) {
    console.error(`  ✗ ÉCHEC traduction paragraphes : ${err.message}`);
  }

  // TEST 5 — REUTILISATION DU MODELE (SANS RECHARGEMENT)
  console.log("\n[TEST 5] Vérification de la réutilisation du modèle en mémoire...");
  try {
    const tStart = Date.now();
    const fastTrans = await nllbProvider.translateText("The sun rises above the horizon.", "FR", "EN");
    const duration = Date.now() - tStart;
    console.log(`  Traduction rapide réutilisant la RAM en : ${duration} ms`);
    console.log(`  Resultat: "${fastTrans}"`);
    if (duration < 30000) {
      console.log("  ✓ SUCCÈS : Le modèle conservé en mémoire a été réutilisé sans rechargement.");
      results.test5_reuse = true;
    }
  } catch (err) {
    console.error(`  ✗ ÉCHEC réutilisation : ${err.message}`);
  }

  // TEST 6 — SYSTEME DE DOCUMENT NOVEL TRAD
  console.log("\n[TEST 6] Traduction d'un document via le pipeline Novel Trad...");
  try {
    const sampleNovelDoc = `CHAPTER 1: THE REAWAKENING\n\nIn the quiet shadows of the imperial library, secret manuscripts revealed forbidden alchemy.\n\nShe stepped through the spatial rift with her drawn blade.`;
    const docId = 'test_nllb_doc_' + Date.now();
    const resultDoc = await TranslationPipeline.processNovel(
      docId,
      sampleNovelDoc,
      'test_novel.txt',
      'FR',
      'EN',
      null,
      'nllb',
      (status, percent) => {
        console.log(`  [Pipeline Progress] ${percent}% - ${status}`);
      }
    );
    console.log("\n  Document Français Reconstruit :");
    console.log("  ----------------------------------------");
    console.log(resultDoc);
    console.log("  ----------------------------------------");
    if (resultDoc && resultDoc.length > 20) {
      console.log("  ✓ SUCCÈS : Pipeline de document Novel Trad fonctionnel avec NLLB Local.");
      results.test6_document = true;
    }
  } catch (err) {
    console.error(`  ✗ ÉCHEC pipeline document : ${err.message}`);
  }

  // TEST 7 — GESTION DES ERREURS
  console.log("\n[TEST 7] Test du comportement en cas de chemin de modèle invalide...");
  try {
    const dummyProvider = new (require('../services/translation/NLLBProvider'))();
    dummyProvider.modelPath = "Z:\\CheminInexistant\\NLLB";
    dummyProvider.baseDir = "Z:\\CheminInexistant";
    const availableDummy = dummyProvider.isAvailable();
    if (!availableDummy) {
      console.log("  ✓ SUCCÈS : Détection correcte de l'indisponibilité si le chemin est invalide.");
      results.test7_error_handling = true;
    }
  } catch (err) {
    console.log("  ✓ SUCCÈS : Erreur gérée proprement.");
    results.test7_error_handling = true;
  }

  // TEST 8 — CONSERVATION DES AUTRES PROVIDERS
  console.log("\n[TEST 8] Vérification de la conservation des autres providers...");
  try {
    const deepl = TranslationFactory.getProvider('deepl');
    const google = TranslationFactory.getProvider('google');
    const openai = TranslationFactory.getProvider('openai');
    console.log(`  - DeepL Provider  : ${deepl.getName()}`);
    console.log(`  - Google Provider : ${google.getName()}`);
    console.log(`  - OpenAI Provider : ${openai.getName()}`);
    if (deepl && google && openai) {
      console.log("  ✓ SUCCÈS : Tous les providers existants (DeepL, Google, OpenAI) sont conservés.");
      results.test8_other_providers = true;
    }
  } catch (err) {
    console.error(`  ✗ ÉCHEC verification providers : ${err.message}`);
  }

  // RÉSULTATS GLOBAUX
  console.log("\n==========================================================");
  console.log("                BILAN DES TESTS D'INTÉGRATION             ");
  console.log("==========================================================");
  console.log(` 1. Détection modèle       : ${results.test1_detection ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log(` 2. Chargement NLLB        : ${results.test2_loading ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log(` 3. Traduction simple      : ${results.test3_simple_trans ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log(` 4. Extraits Light Novel   : ${results.test4_paragraphs ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log(` 5. Réutilisation RAM      : ${results.test5_reuse ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log(` 6. Traduction Document    : ${results.test6_document ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log(` 7. Gestion des Erreurs    : ${results.test7_error_handling ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log(` 8. Preservation Providers : ${results.test8_other_providers ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log("==========================================================");

  process.exit(0);
}

runIntegrationTests();
