const EventEmitter = require('events');

/**
 * InMemoryJobStore — Gestionnaire d'état éphémère en mémoire RAM
 * Stocke uniquement l'avancement temporaire des traductions en cours pour l'UI et les événements SSE.
 * Ne conserve AUCUN contenu de roman ni fichier après fin de traitement ou expiration.
 */
class InMemoryJobStore extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map();
    // In-memory ephemeral session translation cache (cleared on server restart or after TTL)
    this.ephemeralCache = new Map(); 
    
    // Nettoyage automatique des vieux jobs toutes les 15 minutes (TTL 1 heure)
    setInterval(() => this.cleanExpiredJobs(), 15 * 60 * 1000);
  }

  createJob(jobId, filename, type = 'pdf') {
    const job = {
      id: jobId,
      filename,
      type, // 'pdf', 'epub', 'text'
      status: 'PROCESSING', // PROCESSING, PAUSED, COMPLETED, FAILED
      phase: 'ANALYSIS', // ANALYSIS, EXTRACTION, COUNTING, SEGMENTATION, QUOTA_CHECK, TRANSLATION, RECONSTRUCTION, FINALIZATION, CLEANUP
      
      // Métriques de progression réelles (Zéro pourcentage artificiel)
      currentBlock: 0,
      totalBlocks: 0,
      currentPage: 0,
      totalPages: 0,
      currentChapter: 0,
      totalChapters: 0,
      
      statusMessage: 'Initialisation du traitement...',
      error: null,
      
      // Profilage des temps en ms
      profilerSummary: null,
      
      createdTime: Date.now(),
      lastUpdated: Date.now(),
      listeners: []
    };

    this.jobs.set(jobId, job);
    return job;
  }

  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  updateJob(jobId, updates) {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    Object.assign(job, updates, { lastUpdated: Date.now() });

    // Émettre l'événement de mise à jour pour le streaming SSE
    this.emit(`progress:${jobId}`, job);
    return job;
  }

  setPhase(jobId, phase, message, extraData = {}) {
    return this.updateJob(jobId, {
      phase,
      statusMessage: message,
      ...extraData
    });
  }

  setTranslationProgress(jobId, currentBlock, totalBlocks, message) {
    return this.updateJob(jobId, {
      phase: 'TRANSLATION',
      currentBlock,
      totalBlocks,
      statusMessage: message || `Traduction : ${currentBlock} / ${totalBlocks} blocs`
    });
  }

  setPdfReconstructionProgress(jobId, currentPage, totalPages, message) {
    return this.updateJob(jobId, {
      phase: 'RECONSTRUCTION',
      currentPage,
      totalPages,
      statusMessage: message || `Reconstruction PDF : page ${currentPage} / ${totalPages}`
    });
  }

  setEpubReconstructionProgress(jobId, currentChapter, totalChapters, message) {
    return this.updateJob(jobId, {
      phase: 'RECONSTRUCTION',
      currentChapter,
      totalChapters,
      statusMessage: message || `Reconstruction EPUB : chapitre ${currentChapter} / ${totalChapters}`
    });
  }

  failJob(jobId, errorMessage) {
    return this.updateJob(jobId, {
      status: 'FAILED',
      error: errorMessage,
      statusMessage: `Erreur : ${errorMessage}`
    });
  }

  completeJob(jobId, profilerSummary = null) {
    return this.updateJob(jobId, {
      status: 'COMPLETED',
      phase: 'FINALIZATION',
      statusMessage: 'Traduction terminée avec succès !',
      profilerSummary
    });
  }

  // --- Nettoyage éphémère ---
  removeJob(jobId) {
    this.jobs.delete(jobId);
    this.removeAllListeners(`progress:${jobId}`);
  }

  cleanExpiredJobs(ttlMs = 60 * 60 * 1000) {
    const now = Date.now();
    for (const [id, job] of this.jobs.entries()) {
      if (now - job.lastUpdated > ttlMs) {
        console.log(`[InMemoryJobStore] Purge automatique du job expiré : ${id}`);
        this.removeJob(id);
      }
    }
  }

  // --- Mémoire éphémère de traduction (Session RAM uniquement) ---
  findInMemory(hash, targetLang) {
    const key = `${hash}_${targetLang.toUpperCase()}`;
    return this.ephemeralCache.get(key) || null;
  }

  saveToMemory(hash, translatedText, targetLang) {
    const key = `${hash}_${targetLang.toUpperCase()}`;
    // Limite de sécurité à 10 000 entrées pour éviter de saturer la RAM
    if (this.ephemeralCache.size > 10000) {
      const firstKey = this.ephemeralCache.keys().next().value;
      this.ephemeralCache.delete(firstKey);
    }
    this.ephemeralCache.set(key, translatedText);
  }

  getGlobalStats() {
    return {
      activeJobs: this.jobs.size,
      cacheEntries: this.ephemeralCache.size,
      ephemeralMode: true
    };
  }
}

module.exports = new InMemoryJobStore();
