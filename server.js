require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const TranslationFactory = require('./services/translation/TranslationFactory');

const app = express();
const PORT = process.env.PORT || 3000;

// Multer memory storage (aucun stockage sur disque)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 250 * 1024 * 1024 } // Limit: 250 MB for large PDF Light Novels
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

const TranslationPipeline = require('./services/translation/TranslationPipeline');
const db = require('./services/storage/DatabaseService');
const QuotaGuard = require('./services/optimization/QuotaGuard');

// API Status & Healthcheck Endpoint
app.get('/api/status', async (req, res) => {
  const deeplConfigured = Boolean(process.env.DEEPL_API_KEY && process.env.DEEPL_API_KEY.trim() !== '');
  const stats = await db.getGlobalUsageStats();
  
  res.json({
    status: 'OK',
    service: 'NovelTrad Optimization & DeepL Translation Service',
    deeplConfigured,
    maskedKey: QuotaGuard.maskApiKey(process.env.DEEPL_API_KEY),
    stats
  });
});

// Mode Simulation : Analyser un roman avant traduction (0 caractère API consommé)
app.post('/api/analyze-novel', upload.single('document'), async (req, res) => {
  try {
    const textContent = req.file ? req.file.buffer.toString('utf-8') : req.body.text;
    const filename = req.file ? req.file.originalname : 'novel_sample.txt';
    const { targetLang, apiKey } = req.body;

    if (!textContent || textContent.trim().length === 0) {
      return res.status(400).json({ error: true, message: 'Aucun contenu textuel fourni pour analyse.' });
    }

    const effectiveKey = apiKey || process.env.DEEPL_API_KEY;
    const simulationResult = await TranslationPipeline.analyzeNovel(
      textContent,
      filename,
      targetLang || 'FR',
      effectiveKey
    );

    return res.json(simulationResult);
  } catch (err) {
    console.error('[Analyze Error]', err.message);
    return res.status(500).json({ error: true, message: err.message });
  }
});

// Traitement de Traduction avec Pipeline & Sauvegarde Progressive
app.post('/api/translate-novel', upload.single('document'), async (req, res) => {
  try {
    const textContent = req.file ? req.file.buffer.toString('utf-8') : req.body.text;
    const filename = req.file ? req.file.originalname : 'novel.txt';
    const { docId, targetLang, sourceLang, apiKey, provider } = req.body;

    const effectiveDocId = docId || ('doc_' + Date.now());
    const effectiveKey = apiKey || process.env.DEEPL_API_KEY;

    const translatedText = await TranslationPipeline.processNovel(
      effectiveDocId,
      textContent,
      filename,
      targetLang || 'FR',
      sourceLang || 'auto',
      effectiveKey,
      provider || 'deepl',
      (statusText, percent, docState) => {
        console.log(`[Pipeline Progress] ${percent}% - ${statusText}`);
      }
    );

    if (translatedText === null) {
      return res.json({ status: 'PAUSED', message: 'Traduction mise en pause par l\'utilisateur.' });
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename.replace(/\.[^/.]+$/, "") + '_' + (targetLang || 'FR') + '.txt')}"`);
    return res.send(translatedText);

  } catch (err) {
    console.error('[Translate Error]', err.message);
    return res.status(500).json({ error: true, message: err.message });
  }
});

// Mise en pause de la traduction
app.post('/api/pause-translation/:docId', async (req, res) => {
  const success = await TranslationPipeline.pauseTranslation(req.params.docId);
  return res.json({ success });
});

// Reprise de la traduction
app.post('/api/resume-translation/:docId', async (req, res) => {
  try {
    const doc = await db.getDocument(req.params.docId);
    if (!doc) {
      return res.status(404).json({ error: true, message: 'Document introuvable.' });
    }
    
    const { apiKey, provider } = req.body;
    const effectiveKey = apiKey || process.env.DEEPL_API_KEY;

    const translatedText = await TranslationPipeline.processNovel(
      doc.id,
      '',
      doc.filename,
      'FR',
      'auto',
      effectiveKey,
      provider || 'deepl',
      (statusText, percent) => {
        console.log(`[Resume Progress] ${percent}% - ${statusText}`);
      }
    );

    return res.json({ success: true, status: doc.status });
  } catch (err) {
    return res.status(500).json({ error: true, message: err.message });
  }
});

// Suivi de la progression d'un document
app.get('/api/translation-progress/:docId', async (req, res) => {
  const doc = await db.getDocument(req.params.docId);
  if (!doc) {
    return res.status(404).json({ error: true, message: 'Document introuvable.' });
  }
  const percent = doc.total_segments > 0 ? Math.round((doc.translated_segments / doc.total_segments) * 100) : 0;
  return res.json({ doc, percent });
});

// Statistiques globales du Tableau de Bord
app.get('/api/dashboard-stats', async (req, res) => {
  const stats = await db.getGlobalUsageStats();
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

// Primary PDF Translation Endpoint (Compatibilité ascendante)
app.post('/api/translate-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: true, message: 'Aucun fichier PDF n\'a été fourni.' });
    }

    if (req.file.mimetype !== 'application/pdf' && !req.file.originalname.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ error: true, message: 'Le fichier fourni n\'est pas un document PDF valide.' });
    }

    const { targetLang, sourceLang, apiKey, provider } = req.body;

    if (!targetLang) {
      return res.status(400).json({ error: true, message: 'La langue cible est requise.' });
    }

    console.log(`[Translation] Nouveau document reçu: "${req.file.originalname}" (${(req.file.size / 1024 / 1024).toFixed(2)} MB) -> Cible: ${targetLang}`);

    const translator = TranslationFactory.getProvider(provider);

    const translatedPdfBuffer = await translator.translateDocument(
      req.file.buffer,
      targetLang,
      sourceLang,
      apiKey,
      (statusText, percent) => {
        console.log(`[Progress] ${percent}% - ${statusText}`);
      }
    );

    const originalNameWithoutExt = path.parse(req.file.originalname).name;
    const outputFilename = `${originalNameWithoutExt}_${targetLang.toLowerCase()}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(outputFilename)}"`);
    res.setHeader('Content-Length', translatedPdfBuffer.length);
    
    return res.send(translatedPdfBuffer);

  } catch (error) {
    console.error('[Error] Échec de la traduction:', error.message);
    return res.status(500).json({
      error: true,
      message: error.message || 'Une erreur est survenue lors de la traduction du PDF.'
    });
  }
});

// Dedicated Manga & Webtoon AI Translator Endpoint
const MangaPipeline = require('./services/manga/MangaPipeline');
app.post('/api/manga/translate', upload.single('manga'), async (req, res) => {
  try {
    const { sourceLang, targetLang } = req.body;
    console.log(`[Manga AI] Nouveau manga/webtoon reçu pour traduction (${sourceLang || 'ja'} -> ${targetLang || 'fr'})...`);
    
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

// Fallback pour toutes les routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Démarrage du serveur Express
app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log(` 📖 NovelTrad DeepL PDF Translation App running on http://localhost:${PORT}`);
  console.log(` Clé DeepL configurée dans .env: ${Boolean(process.env.DEEPL_API_KEY) ? QuotaGuard.maskApiKey(process.env.DEEPL_API_KEY) : 'NON (Clé à fournir dans l\'UI)'}`);
  console.log('='.repeat(60));
});

