const fs = require('fs');
const path = require('path');
let content = fs.readFileSync('C:/Users/japhet/Downloads/novel_trad/services/storage/DiskJobStore.js', 'utf8');

if (!content.includes('require(\'crypto\')')) {
  content = content.replace('const EventEmitter = require(\'events\');', 'const EventEmitter = require(\'events\');\nconst crypto = require(\'crypto\');');
}

content = content.replace('sourceFilePath: null,', 'sourceFilePath: null,\n      secretToken: existingJob?.secretToken || crypto.randomUUID(),');

if (!content.includes('getJobWithToken')) {
  content = content.replace('getJob(jobId) {\n    return this.jobs.get(jobId) || null;\n  }', 'getJob(jobId) {\n    return this.jobs.get(jobId) || null;\n  }\n\n  getJobWithToken(jobId, secretToken) {\n    const job = this.jobs.get(jobId);\n    if (job && job.secretToken === secretToken) return job;\n    return null;\n  }');
}

content = content.replace(/async cleanExpiredJobs\([\s\S]*?\n  \}/m, 'async cleanExpiredJobs() {\n    const now = Date.now();\n    const TTL_COMPLETED = 60 * 60 * 1000;\n    const TTL_INCOMPLETE = 24 * 60 * 60 * 1000;\n    for (const [id, job] of this.jobs.entries()) {\n      const isCompletedOrFailed = job.status === \'COMPLETED\' || job.status === \'FAILED\';\n      const ttlMs = isCompletedOrFailed ? TTL_COMPLETED : TTL_INCOMPLETE;\n      if (now - job.lastUpdated > ttlMs) {\n        console.log([DiskJobStore] Purge automatique du job expire : );\n        await this.removeJob(id);\n      }\n    }\n  }');

if (!content.includes('saveJobTranslation')) {
  const persistencyCode = 
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
    
    // Also save to RAM cache for fast lookup
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
;
  content = content.replace('findInMemory(hash, targetLang) {', persistencyCode + '\n  findInMemory(hash, targetLang) {');
}

fs.writeFileSync('C:/Users/japhet/Downloads/novel_trad/services/storage/DiskJobStore.js', content);
console.log('Update successful');
