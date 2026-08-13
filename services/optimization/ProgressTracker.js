/**
/**
 * Service de Suivi et de Progression en Temps Réel (ProgressTracker)
 * Centralise et calcule les événements du pipeline de traduction de Novel Trad.
 */
class ProgressTracker {
  static progressMap = new Map();

  /**
   * Initialise le suivi pour un document
   */
  static initProgress(docId, filename, targetLang, sourceLang = 'auto', providerName = 'deepl') {
    const initialState = {
      docId,
      filename,
      targetLang,
      sourceLang,
      provider: providerName,
      stage: 'PREPARATION',
      stageName: 'Préparation & Analyse',
      percent: 2,
      statusText: `Analyse et préparation du document "${filename}"...`,
      currentBatch: 0,
      totalBatches: 0,
      currentSegment: 0,
      totalSegments: 0,
      currentPage: 0,
      totalPages: 0,
      currentPart: 0,
      totalParts: 0,
      livePreview: null,
      startTime: Date.now(),
      lastUpdateTime: Date.now(),
      elapsedSeconds: 0,
      estimatedRemainingSeconds: null,
      isCompleted: false,
      isFailed: false,
      error: null,
      stages: [
        { key: 'PREPARATION', label: 'Préparation & Analyse', status: 'ACTIVE', subtext: 'Vérification du document...' },
        { key: 'EXTRACTION', label: 'Extraction du texte', status: 'PENDING', subtext: 'Filtrage et découpage...' },
        { key: 'TRANSLATION', label: 'Traduction du contenu', status: 'PENDING', subtext: 'Inférence des segments...' },
        { key: 'ASSEMBLY', label: 'Assemblage & Reconstruction PDF', status: 'PENDING', subtext: 'Mise en page & fusion...' },
        { key: 'FINALIZATION', label: 'Finalisation', status: 'PENDING', subtext: 'Génération du fichier final...' }
      ]
    };

    this.progressMap.set(docId, initialState);
    return initialState;
  }

  /**
   * Mettre à jour l'étape et la progression globale
   */
  static updateProgress(docId, updateData = {}) {
    let state = this.progressMap.get(docId);
    if (!state) {
      state = this.initProgress(docId, updateData.filename || 'document.pdf', updateData.targetLang || 'FR');
    }

    const now = Date.now();
    state.lastUpdateTime = now;
    state.elapsedSeconds = Math.max(0, Math.floor((now - state.startTime) / 1000));

    // Mettre à jour les champs transmis
    if (updateData.stage) state.stage = updateData.stage;
    if (updateData.statusText) state.statusText = updateData.statusText;
    if (typeof updateData.percent === 'number') state.percent = Math.min(100, Math.max(0, updateData.percent));
    
    if (typeof updateData.currentBatch === 'number') state.currentBatch = updateData.currentBatch;
    if (typeof updateData.totalBatches === 'number') state.totalBatches = updateData.totalBatches;
    if (typeof updateData.currentSegment === 'number') state.currentSegment = updateData.currentSegment;
    if (typeof updateData.totalSegments === 'number') state.totalSegments = updateData.totalSegments;
    if (typeof updateData.currentPage === 'number') state.currentPage = updateData.currentPage;
    if (typeof updateData.totalPages === 'number') state.totalPages = updateData.totalPages;
    if (typeof updateData.currentPart === 'number') state.currentPart = updateData.currentPart;
    if (typeof updateData.totalParts === 'number') state.totalParts = updateData.totalParts;
    
    if (updateData.livePreview) state.livePreview = updateData.livePreview;

    // Calcul de l'estimation du temps restant
    if (state.percent > 5 && state.percent < 98 && state.elapsedSeconds > 2) {
      const rate = state.percent / state.elapsedSeconds; // % par seconde
      const remainingPct = 100 - state.percent;
      state.estimatedRemainingSeconds = Math.max(2, Math.round(remainingPct / rate));
    } else if (state.percent >= 98) {
      state.estimatedRemainingSeconds = 2;
    }

    // Mise à jour des statuts des étapes du pipeline
    const stageOrder = ['PREPARATION', 'EXTRACTION', 'TRANSLATION', 'ASSEMBLY', 'FINALIZATION'];
    const currentStageIndex = stageOrder.indexOf(state.stage);

    state.stages.forEach((st, idx) => {
      if (idx < currentStageIndex) {
        st.status = 'DONE';
      } else if (idx === currentStageIndex) {
        st.status = 'ACTIVE';
        st.subtext = state.statusText;
      } else {
        st.status = 'PENDING';
      }
    });

    if (state.percent === 100 || updateData.isCompleted) {
      state.isCompleted = true;
      state.stage = 'FINALIZATION';
      state.stageName = 'Terminé';
      state.percent = 100;
      state.estimatedRemainingSeconds = 0;
      state.stages.forEach(st => st.status = 'DONE');
    }

    if (updateData.error) {
      state.isFailed = true;
      state.error = updateData.error;
      state.statusText = `Erreur : ${updateData.error}`;
      if (currentStageIndex >= 0) {
        state.stages[currentStageIndex].status = 'FAILED';
      }
    }

    this.progressMap.set(docId, state);
    return state;
  }

  /**
   * Récupérer l'état de progression d'un document
   */
  static getProgress(docId) {
    return this.progressMap.get(docId) || null;
  }

  /**
   * Marquer le document comme terminé
   */
  static completeProgress(docId, finalStatusText = 'Document traduit et réassemblé avec succès !') {
    return this.updateProgress(docId, {
      stage: 'FINALIZATION',
      percent: 100,
      statusText: finalStatusText,
      isCompleted: true
    });
  }

  /**
   * Marquer le document comme échoué
   */
  static failProgress(docId, errorMsg) {
    return this.updateProgress(docId, {
      isFailed: true,
      error: errorMsg
    });
  }
}

module.exports = ProgressTracker;
