const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const crypto = require('crypto');

const JOBS_DIR = path.join(__dirname, '..', '..', 'data', 'jobs');

class DiskJobStore extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map();
    this.ephemeralCache = new Map(); 

    if (!fs.existsSync(JOBS_DIR)) {
      fs.mkdirSync(JOBS_DIR, { recursive: true });
    }
    this._loadExistingJobs();
    setInterval(() => this.cleanExpiredJobs(), 15 * 60 * 1000);
  }

  _loadExistingJobs() {
    if (!fs.existsSync(JOBS_DIR)) return;
    const folders = fs.readdirSync(JOBS_DIR);
    for (const folder of folders) {
      const metaPath = path.join(JOBS_DIR, folder, 'metadata.json');
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          this.jobs.set(meta.id, meta);
        } catch (e) {
          console.error(`[DiskJobStore] Erreur chargement metadata pour ${folder}`, e);
        }
      }
    }
  }

  getJobDir(jobId) {
    return path.join(JOBS_DIR, jobId);
  }

  getFilePath(jobId, filename) {
    return path.join(this.getJobDir(jobId), filename);
  }

  async createJob(jobId, filename, type = 'pdf', metadata = {}) {
    const existingJob = this.jobs.get(jobId);
    const jobDir = this.getJobDir(jobId);
    
    if (!fs.existsSync(jobDir)) {
      await fs.promises.mkdir(jobDir, { recursive: true });
    }

    const job = {
      id: jobId,
      filename,
      type, 
      status: 'PROCESSING', 
      phase: 'ANALYSIS',
      
      currentBlock: existingJob?.currentBlock || 0,
      totalBlocks: existingJob?.totalBlocks || 0,
      currentPage: existingJob?.currentPage || 0,
      totalPages: existingJob?.totalPages || 0,
      currentChapter: existingJob?.currentChapter || 0,
      totalChapters: existingJob?.totalChapters || 0,
      
      statusMessage: 'Initialisation du traitement...',
      error: null,
      isQuotaExceeded: false,
      isAuthError: false,

      apiKey: metadata.apiKey || existingJob?.apiKey || null,
      provider: metadata.provider || existingJob?.provider || 'gemini',
      targetLang: metadata.targetLang || existingJob?.targetLang || 'FR',
      sourceLang: metadata.sourceLang || existingJob?.sourceLang || 'auto',
      
      sourceFilePath: null,
      secretToken: existingJob?.secretToken || crypto.randomUUID(),
      profilerSummary: null,
      createdTime: existingJob?.createdTime || Date.now(),
      lastUpdated: Date.now()
    };

    if (metadata.fileBuffer) {
      const sourceExt = type === 'text' ? 'txt' : type;
      job.sourceFilePath = path.join(jobDir, `source.${sourceExt}`);
      await fs.promises.writeFile(job.sourceFilePath, metadata.fileBuffer);
    } else if (existingJob?.sourceFilePath) {
      job.sourceFilePath = existingJob.sourceFilePath;
    }

    this.jobs.set(jobId, job);
    await this._saveJobMetadata(jobId);
    return job;
  }

    async _saveJobMetadata(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    const metaPath = path.join(this.getJobDir(jobId), 'metadata.json');
    try {
      // Ne jamais sérialiser de Buffer brut dans metadata.json (évite des fichiers de 100 Mo)
      const sanitizedJob = { ...job };
      delete sanitizedJob.fileBuffer;
      await fs.promises.writeFile(metaPath, JSON.stringify(sanitizedJob, null, 2));
    } catch (e) {
      console.error(`[DiskJobStore] Impossible de sauvegarder metadata pour ${jobId}`, e);
    }
  }

  async storeJobData(jobId, buffer, metadata = {}) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    
    let sourceFilePath = job.sourceFilePath;
    if (buffer) {
      const sourceExt = job.type === 'text' ? 'txt' : job.type;
      sourceFilePath = path.join(this.getJobDir(jobId), `source.${sourceExt}`);
      await fs.promises.writeFile(sourceFilePath, buffer);
    }

    return this.updateJob(jobId, {
      sourceFilePath,
      ...metadata
    });
  }

  async updateJobApiKey(jobId, newApiKey, newProvider = null) {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    const updates = {
      apiKey: newApiKey,
      status: 'PROCESSING',
      error: null,
      isQuotaExceeded: false,
      isAuthError: false,
      statusMessage: 'Nouvelle cle API appliquee. Reprise de la traduction...'
    };

    if (newProvider) {
      updates.provider = newProvider;
    }

    return this.updateJob(jobId, updates);
  }

  getJob(jobId) {
    let job = this.jobs.get(jobId);
    if (!job && jobId) {
      const metaPath = path.join(JOBS_DIR, jobId, 'metadata.json');
      if (fs.existsSync(metaPath)) {
        try {
          job = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          this.jobs.set(job.id || jobId, job);
        } catch (e) {}
      }
    }
    return job || null;
  }

  getJobWithToken(jobId, secretToken) {
    const job = this.jobs.get(jobId);
    if (job && job.secretToken === secretToken) return job;
    return null;
  }

  async updateJob(jobId, updates) {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    Object.assign(job, updates, { lastUpdated: Date.now() });
    await this._saveJobMetadata(jobId);
    this.emit(`progress:${jobId}`, job);
    return job;
  }

  async setPhase(jobId, phase, message, extraData = {}) {
    return this.updateJob(jobId, { phase, statusMessage: message, ...extraData });
  }

  async setTranslationProgress(jobId, currentBlock, totalBlocks, message) {
    return this.updateJob(jobId, {
      phase: 'TRANSLATION', currentBlock, totalBlocks,
      statusMessage: message || `Traduction : ${currentBlock} / ${totalBlocks} blocs`
    });
  }

  async setPdfReconstructionProgress(jobId, currentPage, totalPages, message) {
    return this.updateJob(jobId, {
      phase: 'RECONSTRUCTION', currentPage, totalPages,
      statusMessage: message || `Reconstruction PDF : page ${currentPage} / ${totalPages}`
    });
 }

  async setWaitingForKey(jobId, currentBlock, totalBlocks, message) {
    return this.updateJob(jobId, {
      status: 'WAITING_FOR_KEY', phase: 'TRANSLATION_PAUSED', currentBlock, totalBlocks,
      statusMessage: message || `Quota cle epuise (${currentBlock}/${totalBlocks} blocs). En attente de la cle suivante...`
    });
  }

  async setEpubReconstructionProgress(jobId, currentChapter, totalChapters, message) {
    return this.updateJob(jobId, {
      phase: 'RECONSTRUCTION', currentChapter, totalChapters,
      statusMessage: message || `Reconstruction EPUB : chapitre ${currentChapter} / ${totalChapters}`
    });
  }

  async setTranslatedBuffer(jobId, buffer, ext) {
    const jobDir = this.getJobDir(jobId);
    if (!fs.existsSync(jobDir)) {
      await fs.promises.mkdir(jobDir, { recursive: true });
    }
    const extName = ext.startsWith('.') ? ext.slice(1) : ext;
    const translatedPath = path.join(jobDir, 'translated.' + extName);
    await fs.promises.writeFile(translatedPath, buffer);
  }

  async getTranslatedBuffer(jobId, ext) {
    const extName = ext.startsWith('.') ? ext.slice(1) : ext;
    const translatedPath = path.join(this.getJobDir(jobId), 'translated.' + extName);
    try {
      return await fs.promises.readFile(translatedPath);
    } catch (e) {
      return null;
    }
  }

  async updateJobProgress(jobId, data = {}) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const updates = {};
    if (data.statusMessage !== undefined) updates.statusMessage = data.statusMessage;
    if (data.progress !== undefined) updates.progress = data.progress;
    if (data.phase !== undefined) updates.phase = data.phase;
    if (data.currentPage !== undefined) updates.currentPage = data.currentPage;
    if (data.totalPages !== undefined) updates.totalPages = data.totalPages;
    if (data.currentBlock !== undefined) updates.currentBlock = data.currentBlock;
    if (data.totalBlocks !== undefined) updates.totalBlocks = data.totalBlocks;
    return this.updateJob(jobId, updates);
  }

  async setTranslatedPdfBuffer(jobId, buffer) {
    return this.setTranslatedBuffer(jobId, buffer, 'pdf');
  }

  async getTranslatedPdfBuffer(jobId) {
    return this.getTranslatedBuffer(jobId, 'pdf');
  }

  async setTranslatedText(jobId, text) {
    const buf = Buffer.isBuffer(text) ? text : Buffer.from(text || '', 'utf8');
    return this.setTranslatedBuffer(jobId, buf, 'txt');
  }

  async getTranslatedText(jobId) {
    const buf = await this.getTranslatedBuffer(jobId, 'txt');
    return buf ? buf.toString('utf8') : null;
  }

  async setTranslatedEpubBuffer(jobId, buffer) {
    return this.setTranslatedBuffer(jobId, buffer, 'epub');
  }

  async getTranslatedEpubBuffer(jobId) {
    return this.getTranslatedBuffer(jobId, 'epub');
  }

  async getSourceFileBuffer(jobId) {
    const job = this.jobs.get(jobId);
    if (job && job.sourceFilePath) {
      try {
        return await fs.promises.readFile(job.sourceFilePath);
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  async failJob(jobId, errorMessage, isQuotaExceeded = false, isAuthError = false) {
    return this.updateJob(jobId, {
      status: isQuotaExceeded || isAuthError ? 'QUOTA_EXCEEDED' : 'FAILED',
      error: errorMessage, isQuotaExceeded, isAuthError,
      statusMessage: `Erreur : ${errorMessage}`
    });
 }

  async completeJob(jobId, profilerSummary = null) {
    return this.updateJob(jobId, {
      status: 'COMPLETED', phase: 'FINALIZATION',
      statusMessage: 'Traitement termine avec succes !', profilerSummary
    });
  }

  async removeJob(jobId) {
    this.jobs.delete(jobId);
    this.removeAllListeners(`progress:${jobId}`);
    const jobDir = this.getJobDir(jobId);
    try {
      if (fs.existsSync(jobDir)) {
        await fs.promises.rm(jobDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.error(`[DiskJobStore] Erreur lors de la suppression de ${jobDir}`, e);
    }
 }

  async cleanExpiredJobs() {
    const now = Date.now();
    const TTL_COMPLETED = 60 * 60 * 1000; // 1 heure
    const TTL_INCOMPLETE = 24 * 60 * 60 * 1000; // 24 heures
    for (const [id, job] of this.jobs.entries()) {
      const isCompletedOrFailed = job.status === 'COMPLETED' || job.status === 'FAILED';
      const ttlMs = isCompletedOrFailed ? TTL_COMPLETED : TTL_INCOMPLETE;
      if (now - job.lastUpdated > ttlMs) {
        console.log(`[DiskJobStore] Purge automatique du job expire : ${id}`);
        await this.removeJob(id);
      }
    }
 }

  async saveJobTranslation(jobId, hash, translatedText, targetLang) {
    const jobDir = this.getJobDir(jobId);
    if (!fs.existsSync(jobDir)) return;
    const transPath = path.join(jobDir, 'translations.json');
    let data = {};
    try {
      if (fs.existsSync(transPath)) {
        data = JSON.parse(fs.readFileSync(transPath, 'utf8'));
      }
    } catch(e) {}
    const key = hash + '_' + targetLang.toUpperCase();
    data[key] = translatedText;
    fs.writeFileSync(transPath, JSON.stringify(data));
    this.saveToMemory(hash, translatedText, targetLang);
  }

  async loadJobTranslations(jobId) {
    const transPath = path.join(this.getJobDir(jobId), 'translations.json');
    try {
      if (fs.existsSync(transPath)) {
        const data = JSON.parse(fs.readFileSync(transPath, 'utf8'));
        for (const key of Object.keys(data)) {
          this.ephemeralCache.set(key, data[key]);
        }
      }
    } catch (e) {}
  }

  findInMemory(hash, targetLang) {
    const key = `${hash}_${targetLang.toUpperCase()}`;
    return this.ephemeralCache.get(key) || null;
  }

  saveToMemory(hash, translatedText, targetLang) {
    const key = `${hash}_${targetLang.toUpperCase()}`;
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
      ephemeralMode: false,
      storageType: 'disk'
    };
  }
}

module.exports = new DiskJobStore();

