require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const TranslationFactory = require('./services/translation/TranslationFactory');
const TranslationPipeline = require('./services/translation/TranslationPipeline');
const DocumentProcessor = require('./services/pdf/DocumentProcessor');
const EpubProcessor = require('./services/epub/EpubProcessor');
const InMemoryJobStore = require('./services/storage/InMemoryJobStore');
const QuotaGuard = require('./services/optimization/QuotaGuard');

const app = express();
const PORT = process.env.PORT || 3000;

// Multer memory storage (Traitement éphémère sans persistance sur disque)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 250 * 1024 * 1024 } // 250 MB max RAM buffer for large documents
});

// Middlewares
app.use(cors());
app.use(express.json());

// Dedicated SEO & Verification Routes
app.get('/sitemap.xml', (req, res) => {
  res.header('Content-Type', 'application/xml');
  res.sendFile(path.join(__dirname, 'public', 'sitemap.xml'));
});

app.get('/robots.txt', (req, res) => {
  res.header('Content-Type', 'text/plain');
  res.sendFile(path.join(__dirname, 'public', 'robots.txt'));
});

app.get('/google183318dfed3f9f37.html', (req, res) => {
  res.header('Content-Type', 'text/html');
  res.sendFile(path.join(__dirname, 'public', 'google183318dfed3f9f37.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// API Status & Healthcheck Endpoint
app.get('/api/status', async (req, res) => {
  const deeplConfigured = Boolean(process.env.DEEPL_API_KEY && process.env.DEEPL_API_KEY.trim() !== '');
  const stats = InMemoryJobStore.getGlobalStats();
  const nllbProvider = TranslationFactory.getProvider('nllb');
  const nllbStatus = await nllbProvider.getUsage();
  
  res.json({
    status: 'OK',
    service: 'NovelTrad AI Studio & Translation Engine',
    defaultProvider: process.env.DEFAULT_PROVIDER || 'nllb',
    deeplConfigured,
    nllbAvailable: nllbStatus.status === 'AVAILABLE',
    nllbStatus,
    maskedKey: QuotaGuard.maskApiKey(process.env.DEEPL_API_KEY),
    stats
  });
});

// Server-Sent Events (SSE) Stream pour la progression temps réel de la traduction (Sans faux pourcentage)
app.get('/api/translation-events/:jobId', (req, res) => {
  const { jobId } = req.params;
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendUpdate = (job) => {
    res.write(`data: ${JSON.stringify(job)}\n\n`);
  };

  const currentJob = InMemoryJobStore.getJob(jobId);
  if (currentJob) {
    sendUpdate(currentJob);
  }

  const eventName = `progress:${jobId}`;
  InMemoryJobStore.on(eventName, sendUpdate);

  req.on('close', () => {
    InMemoryJobStore.off(eventName, sendUpdate);
  });
});

// Mode Simulation / Analyse Préalable du Document (PDF, EPUB, TXT)
app.post('/api/analyze-novel', upload.single('document'), async (req, res) => {
  try {
    const file = req.file;
    const { targetLang, apiKey, provider } = req.body;
    const effectiveKey = apiKey || process.env.DEEPL_API_KEY;

    if (!file && (!req.body.text || req.body.text.trim().length === 0)) {
      return res.status(400).json({ error: true, message: 'Aucun document ni texte fourni pour analyse.' });
    }

    const filename = file ? file.originalname : 'document.txt';
    const ext = path.extname(filename).toLowerCase();

    if (ext === '.epub') {
      const epubAnalysis = await EpubProcessor.analyze(file.buffer, filename);
      const quotaCheck = await QuotaGuard.checkPreTranslationQuota(
        provider || 'nllb',
        effectiveKey,
        epubAnalysis.totalCharacters,
        'epub'
      );

      return res.json({
        filename,
        fileType: 'EPUB',
        sizeMB: epubAnalysis.sizeMB,
        chapters: epubAnalysis.chapterCount,
        totalCharacters: epubAnalysis.totalCharacters,
        totalTextBlocks: epubAnalysis.totalTextBlocks,
        quotaCheck
      });
    }

    if (ext === '.pdf') {
      const pdfAnalysis = await DocumentAnalyzer.analyze(file.buffer, filename);
      let rawChars = Math.max(1000, pdfAnalysis.pageCount * 2000);
      try {
        const pdfParse = require('pdf-parse');
        const parsed = await pdfParse(file.buffer);
        rawChars = parsed.text.length;
      } catch (e) {}

      const quotaCheck = await QuotaGuard.checkPreTranslationQuota(
        provider || 'nllb',
        effectiveKey,
        rawChars,
        'pdf'
      );

      return res.json({
        filename,
        fileType: 'PDF',
        sizeMB: pdfAnalysis.sizeMB,
        pages: pdfAnalysis.pageCount,
        totalCharacters: rawChars,
        quotaCheck
      });
    }

    // Texte brut par défaut
    const textContent = file ? file.buffer.toString('utf-8') : req.body.text;
    const simulationResult = await TranslationPipeline.analyzeNovel(
      textContent,
      filename,
      targetLang || 'FR',
      effectiveKey,
      provider || 'nllb'
    );

    return res.json(simulationResult);
  } catch (err) {
    console.error('[Analyze Error]', err.message);
    return res.status(500).json({ error: true, message: err.message });
  }
});

// Endpoint unifié pour la Traduction de Documents (PDF & EPUB)
app.post('/api/translate-document', upload.single('document'), async (req, res) => {
  try {
    const file = req.file || req.files?.pdf || req.files?.document;
    if (!file) {
      return res.status(400).json({ error: true, message: 'Aucun fichier n\'a été fourni pour la traduction.' });
    }

    const { jobId, targetLang, sourceLang, apiKey, provider } = req.body;
    const effectiveJobId = jobId || ('job_' + Date.now());
    const effectiveKey = apiKey || process.env.DEEPL_API_KEY;
    const selectedProvider = provider || process.env.DEFAULT_PROVIDER || 'nllb';
    const filename = file.originalname;
    const ext = path.extname(filename).toLowerCase();

    console.log(`[Translate Document] Fichier reçu: "${filename}" (${(file.size / 1024 / 1024).toFixed(2)} MB) -> Format: ${ext.toUpperCase()}`);

    if (ext === '.epub') {
      const translator = TranslationFactory.getProvider(selectedProvider);
      const translatedEpubBuffer = await EpubProcessor.processEpubDocument(
        effectiveJobId,
        file.buffer,
        filename,
        targetLang || 'FR',
        sourceLang || 'auto',
        effectiveKey,
        translator,
        (statusText, pct) => {
          console.log(`[EPUB Progress] ${pct}% - ${statusText}`);
        }
      );

      const originalNameWithoutExt = path.parse(filename).name;
      const outputFilename = `${originalNameWithoutExt}_${(targetLang || 'FR').toLowerCase()}.epub`;

      res.setHeader('Content-Type', 'application/epub+zip');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(outputFilename)}"`);
      res.setHeader('Content-Length', translatedEpubBuffer.length);
      return res.send(translatedEpubBuffer);
    }

    if (ext === '.pdf') {
      const translatedPdfBuffer = await DocumentProcessor.processPdfDocument(
        effectiveJobId,
        file.buffer,
        filename,
        targetLang || 'FR',
        sourceLang || 'auto',
        effectiveKey,
        selectedProvider,
        (statusText, pct) => {
          console.log(`[PDF Progress] ${pct}% - ${statusText}`);
        }
      );

      const originalNameWithoutExt = path.parse(filename).name;
      const outputFilename = `${originalNameWithoutExt}_${(targetLang || 'FR').toLowerCase()}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(outputFilename)}"`);
      res.setHeader('Content-Length', translatedPdfBuffer.length);
      return res.send(translatedPdfBuffer);
    }

    // Traduction de texte brut
    const textContent = file.buffer.toString('utf-8');
    const translatedText = await TranslationPipeline.processNovel(
      effectiveJobId,
      textContent,
      filename,
      targetLang || 'FR',
      sourceLang || 'auto',
      effectiveKey,
      selectedProvider,
      (statusText, pct) => {
        console.log(`[Text Progress] ${pct}% - ${statusText}`);
      }
    );

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(path.parse(filename).name + '_' + (targetLang || 'FR') + '.txt')}"`);
    return res.send(translatedText);

  } catch (error) {
    console.error('[Translation Error]', error.message);
    return res.status(500).json({
      error: true,
      message: error.message || 'Une erreur est survenue pendant la traduction.'
    });
  }
});

// Compatibilité pour l'ancien endpoint PDF (/api/translate-pdf)
app.post('/api/translate-pdf', upload.single('pdf'), async (req, res) => {
  req.file = req.file || req.files?.pdf;
  return app._router.handle({ ...req, url: '/api/translate-document' }, res);
});

// Suivi de progression du job
app.get('/api/translation-progress/:jobId', (req, res) => {
  const job = InMemoryJobStore.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: true, message: 'Job introuvable ou expiré.' });
  }
  return res.json(job);
});

// Statistiques globales du Tableau de Bord
app.get('/api/dashboard-stats', async (req, res) => {
  const stats = InMemoryJobStore.getGlobalStats();
  const effectiveKey = req.query.apiKey || process.env.DEEPL_API_KEY;
  let quotaInfo = null;

  if (effectiveKey) {
    quotaInfo = await QuotaGuard.getDeepLUsage(effectiveKey);
  }

  return res.json({
    stats,
    quotaInfo
  });
});

// Dedicated Manga & Webtoon AI Translator Endpoint
const MangaPipeline = require('./services/manga/MangaPipeline');
app.post('/api/manga/translate', upload.single('manga'), async (req, res) => {
  try {
    const { sourceLang, targetLang } = req.body;
    const result = await MangaPipeline.processMangaPage(
      req.file ? req.file.buffer : null,
      sourceLang || 'ja',
      targetLang || 'fr'
    );
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: true, message: err.message });
  }
});

// Fallback pour toutes les routes SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Démarrage du serveur Express
app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log(` 📖 NovelTrad PDF & EPUB Translator running on http://localhost:${PORT}`);
  console.log(` Clé DeepL configurée dans .env: ${Boolean(process.env.DEEPL_API_KEY) ? QuotaGuard.maskApiKey(process.env.DEEPL_API_KEY) : 'NON (Clé à fournir dans l\'UI)'}`);
  console.log('='.repeat(60));
});
