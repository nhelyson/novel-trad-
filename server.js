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
  limits: { fileSize: 50 * 1024 * 1024 } // Limit: 50 MB
});

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Status & Healthcheck Endpoint
app.get('/api/status', (req, res) => {
  const deeplConfigured = Boolean(process.env.DEEPL_API_KEY && process.env.DEEPL_API_KEY.trim() !== '');
  res.json({
    status: 'OK',
    service: 'NovelTrad DeepL PDF Translation Service',
    deeplConfigured,
    defaultProvider: process.env.DEFAULT_PROVIDER || 'deepl'
  });
});

// Primary PDF Translation Endpoint
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

    // Obtenir le fournisseur de traduction (DeepL par défaut)
    const translator = TranslationFactory.getProvider(provider);

    // Démarrer la traduction du document PDF
    const translatedPdfBuffer = await translator.translateDocument(
      req.file.buffer,
      targetLang,
      sourceLang,
      apiKey,
      (statusText, percent) => {
        console.log(`[Progress] ${percent}% - ${statusText}`);
      }
    );

    // Formater le nom de fichier de sortie
    const originalNameWithoutExt = path.parse(req.file.originalname).name;
    const outputFilename = `${originalNameWithoutExt}_${targetLang.toLowerCase()}.pdf`;

    // Renvoyer le PDF traduit en flux binaire direct
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

// Fallback pour toutes les routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Démarrage du serveur Express
app.listen(PORT, () => {
  console.log('=' * 60);
  console.log(` 📖 NovelTrad DeepL PDF Translation App running on http://localhost:${PORT}`);
  console.log(` Clé DeepL configurée dans .env: ${Boolean(process.env.DEEPL_API_KEY) ? 'OUI' : 'NON (Clé à fournir dans l\'UI)'}`);
  console.log('=' * 60);
});
