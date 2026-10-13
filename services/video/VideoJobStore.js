const EventEmitter = require('events');

/**
 * VideoJobStore — Gestionnaire d'état éphémère en mémoire RAM pour les travaux de vidéo
 */
class VideoJobStore extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map();
    this.srtResults = new Map(); // Stocke le texte SRT généré par jobId
    this.videoBuffers = new Map(); // Stocke le buffer MP4 final par jobId
  }

  createJob(jobId, filename) {
    const job = {
      id: jobId,
      filename,
      type: 'video',
      status: 'PROCESSING',
      phase: 'ANALYSIS', // ANALYSIS, AUDIO_EXTRACTION, TRANSCRIPTION, TRANSLATION, SRT_GENERATION, VIDEO_RENDERING, COMPLETED, FAILED
      
      currentSegment: 0,
      totalSegments: 0,
      
      statusMessage: 'Analyse du fichier vidéo...',
      error: null,
      
      profilerSummary: null,
      createdTime: Date.now(),
      lastUpdated: Date.now()
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

  setTranscriptionProgress(jobId, currentSegment, totalSegments, message) {
    return this.updateJob(jobId, {
      phase: 'TRANSCRIPTION',
      currentSegment,
      totalSegments,
      statusMessage: message || `Transcription : ${currentSegment} / ${totalSegments} segments`
    });
  }

  setTranslationProgress(jobId, currentSegment, totalSegments, message) {
    return this.updateJob(jobId, {
      phase: 'TRANSLATION',
      currentSegment,
      totalSegments,
      statusMessage: message || `Traduction : ${currentSegment} / ${totalSegments} segments`
    });
  }

  setSrtContent(jobId, srtContent) {
    this.srtResults.set(jobId, srtContent);
  }

  getSrtContent(jobId) {
    return this.srtResults.get(jobId) || null;
  }

  setVideoBuffer(jobId, buffer) {
    this.videoBuffers.set(jobId, buffer);
  }

  getVideoBuffer(jobId) {
    return this.videoBuffers.get(jobId) || null;
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
      statusMessage: 'Traduction vidéo terminée avec succès !',
      profilerSummary
    });
  }

  removeJob(jobId) {
    this.jobs.delete(jobId);
    this.srtResults.delete(jobId);
    this.videoBuffers.delete(jobId);
    this.removeAllListeners(`progress:${jobId}`);
  }
}

module.exports = new VideoJobStore();
