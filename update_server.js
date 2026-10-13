const fs = require('fs');
let content = fs.readFileSync('C:/Users/japhet/Downloads/novel_trad/server.js', 'utf8');

// 1. Add secretToken to translate-document error response
content = content.replace(/jobId: effectiveJobId\s*\n\s*\}/m, "jobId: effectiveJobId,\n      secretToken: DiskJobStore.getJob(effectiveJobId)?.secretToken\n    }");

// 2. Add X-Secret-Token to headers
content = content.replace(/res\.setHeader\('X-Job-Id', effectiveJobId\);/g, "res.setHeader('X-Job-Id', effectiveJobId);\n      res.setHeader('X-Secret-Token', DiskJobStore.getJob(effectiveJobId)?.secretToken || '');");

// 3. Add History & Resume routes
if (!content.includes('/api/history')) {
  const newRoutes = `

// ==========================================================================
// TRANSLATION HISTORY & RESUME ROUTES
// ==========================================================================

app.post('/api/history', (req, res) => {
  const { jobs } = req.body;
  if (!jobs || !Array.isArray(jobs)) {
    return res.status(400).json({ error: true, message: 'Format de requete invalide.' });
  }

  const history = [];
  for (const j of jobs) {
    const job = DiskJobStore.getJobWithToken(j.jobId, j.secretToken);
    if (job) {
      history.push({
        jobId: job.id,
        filename: job.filename,
        status: job.status,
        phase: job.phase,
        currentBlock: job.currentBlock,
        totalBlocks: job.totalBlocks,
        progress: job.totalBlocks > 0 ? Math.round((job.currentBlock / job.totalBlocks) * 100) : 0,
        statusMessage: job.statusMessage,
        lastUpdated: job.lastUpdated,
        canResume: ['WAITING_FOR_KEY', 'QUOTA_EXCEEDED', 'PAUSED'].includes(job.status) || (job.status === 'PROCESSING' && Date.now() - job.lastUpdated > 5000)
      });
    }
  }

  return res.json({ jobs: history });
});

app.post('/api/resume-translation', async (req, res) => {
  const { jobId, secretToken, deeplApiKey } = req.body;
  
  if (!jobId || !secretToken) {
    return res.status(400).json({ error: true, message: 'Identifiants de session manquants.' });
  }

  const job = DiskJobStore.getJobWithToken(jobId, secretToken);
  if (!job) {
    return res.status(404).json({ error: true, message: 'Job introuvable ou vous n\\'etes pas autorise.' });
  }

  if (job.status === 'COMPLETED') {
    return res.status(400).json({ error: true, message: 'Ce job est deja termine.' });
  }

  const effectiveKey = deeplApiKey || job.apiKey || process.env.DEEPL_API_KEY;

  if (effectiveKey && (job.provider || 'nllb') === 'deepl') {
    // Determine remaining chars to translate approx
    const remainingBlocks = job.totalBlocks - job.currentBlock;
    const approxChars = remainingBlocks > 0 ? remainingBlocks * 500 : 1000;
    
    const quotaCheck = await QuotaGuard.checkPreTranslationQuota('deepl', effectiveKey, approxChars, job.type);
    if (!quotaCheck.canProceed) {
      return res.status(403).json({ error: true, message: 'Quota DeepL insuffisant pour cette cle.' });
    }
  }

  await DiskJobStore.updateJobApiKey(jobId, effectiveKey);
  await DiskJobStore.loadJobTranslations(jobId);

  // Restart the process asynchronously so we don't block the HTTP request for the whole file
  // The frontend should reconnect to SSE to get the updates and download when completed!
  setTimeout(async () => {
    try {
      let finalBuffer = null;
      if (job.type === 'epub') {
        const fileBuffer = await DiskJobStore.getSourceFileBuffer(jobId);
        const translator = TranslationFactory.getProvider(job.provider);
        finalBuffer = await EpubProcessor.processEpubDocument(
          jobId, fileBuffer, job.filename, job.targetLang, job.sourceLang, effectiveKey, translator
        );
        await DiskJobStore.setTranslatedEpubBuffer(jobId, finalBuffer);
      } else if (job.type === 'pdf') {
        const fileBuffer = await DiskJobStore.getSourceFileBuffer(jobId);
        finalBuffer = await DocumentProcessor.processPdfDocument(
          jobId, fileBuffer, job.filename, job.targetLang, job.sourceLang, effectiveKey, job.provider
        );
        // PdfProcessor doesn't have an equivalent setTranslatedPdfBuffer, let's create one or save to disk.
        // Actually the best is to just save it inside the job folder manually here
        const fs = require('fs');
        const path = require('path');
        fs.writeFileSync(path.join(DiskJobStore.getJobDir(jobId), 'translated.pdf'), finalBuffer);
      }
    } catch(err) {
      console.error('[Resume Error]', err);
      const isQuota = Boolean(err.isQuotaExceeded || err.message?.includes('456'));
      const isAuth = Boolean(err.isAuthError || err.message?.includes('403'));
      if (!err.isPartial) DiskJobStore.failJob(jobId, err.message, isQuota, isAuth);
    }
  }, 1000);

  return res.json({ success: true, message: 'Traduction reprise avec succes.', jobId });
});

app.get('/api/download-job/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const secretToken = req.query.token;
  const job = DiskJobStore.getJobWithToken(jobId, secretToken);
  
  if (!job || job.status !== 'COMPLETED') {
    return res.status(404).json({ error: true, message: 'Fichier introuvable ou incomplet.' });
  }

  const fs = require('fs');
  const path = require('path');
  const jobDir = DiskJobStore.getJobDir(jobId);
  const ext = job.type === 'epub' ? 'epub' : 'pdf';
  const outPath = path.join(jobDir, 'translated.' + ext);
  
  if (!fs.existsSync(outPath)) {
    return res.status(404).json({ error: true, message: 'Fichier physique introuvable.' });
  }
  
  res.setHeader('Content-Disposition', \`attachment; filename="\${encodeURIComponent(job.filename.replace('.'+ext, '_trad.'+ext))}"\`);
  const buf = fs.readFileSync(outPath);
  return res.send(buf);
});
`;

  content = content.replace('// Démarrage du serveur Express', newRoutes + '\n// Démarrage du serveur Express');
}

fs.writeFileSync('C:/Users/japhet/Downloads/novel_trad/server.js', content);
