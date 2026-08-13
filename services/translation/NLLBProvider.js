const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');
const TranslationProvider = require('./TranslationProvider');

class NLLBProvider extends TranslationProvider {
  constructor() {
    super('NLLB Local');
    this.modelPath = process.env.NLLB_MODEL_PATH || "F:\\Modèles Traduction\\models\\nllb-200-distilled-600M";
    this.baseDir = process.env.NLLB_BASE_DIR || "F:\\Modèles Traduction";
    this.pythonEnv = process.env.NLLB_PYTHON_ENV || "F:\\Modèles Traduction\\environments\\nllb\\Scripts\\python.exe";
    this.port = process.env.NLLB_SERVER_PORT || 5002;
    this.serverUrl = `http://127.0.0.1:${this.port}`;
    this.serverProcess = null;
  }

  getName() {
    return this.name;
  }

  isAvailable() {
    const targetDir = fs.existsSync(this.modelPath) 
      ? this.modelPath 
      : path.join(this.baseDir, 'models', 'nllb-200-distilled-600M');
    
    return fs.existsSync(targetDir);
  }

  async getUsage() {
    const available = this.isAvailable();
    let statusInfo = {
      provider: this.getName(),
      status: available ? 'AVAILABLE' : 'UNAVAILABLE',
      model: 'NLLB-200-distilled-600M',
      path: this.baseDir,
      device: 'CPU',
      apiKeyRequired: false
    };

    if (available) {
      try {
        const res = await axios.get(`${this.serverUrl}/health`, { timeout: 2000 });
        statusInfo.serverRunning = true;
        statusInfo.modelLoaded = res.data.model_loaded;
        statusInfo.device = res.data.device || 'CPU';
      } catch (e) {
        statusInfo.serverRunning = false;
        statusInfo.modelLoaded = false;
      }
    }
    return statusInfo;
  }

  async ensureServerRunning() {
    if (!this.isAvailable()) {
      throw new Error(`Le modèle NLLB local est introuvable à l'emplacement : ${this.baseDir}`);
    }

    try {
      await axios.get(`${this.serverUrl}/health`, { timeout: 1500 });
      return true;
    } catch (err) {
      console.log(`[NLLBProvider] Démarrage du serveur NLLB Python (${this.pythonEnv})...`);
    }

    const scriptPath = path.join(__dirname, 'nllb_server.py');
    const env = { ...process.env, NLLB_SERVER_PORT: String(this.port), NLLB_MODEL_PATH: this.modelPath };

    this.serverProcess = spawn(this.pythonEnv, [scriptPath], {
      env,
      stdio: 'inherit',
      detached: false
    });

    this.serverProcess.on('error', (err) => {
      console.error('[NLLBProvider] Erreur lors du lancement du processus Python:', err);
    });

    const maxWait = 45000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const res = await axios.get(`${this.serverUrl}/health`, { timeout: 1000 });
        if (res.data && res.data.status === 'OK') {
          console.log('[NLLBProvider] Serveur Python NLLB démarré et opérationnel !');
          return true;
        }
      } catch (e) {
        // Attente du démarrage
      }
    }

    throw new Error("Impossible d'initialiser le serveur local NLLB Python après 15 secondes.");
  }

  mapLanguageCode(langCode, isSource = false) {
    if (!langCode) return isSource ? 'eng_Latn' : 'fra_Latn';
    
    const clean = langCode.trim().toUpperCase();
    const map = {
      'FR': 'fra_Latn',
      'FRENCH': 'fra_Latn',
      'FR-FR': 'fra_Latn',
      'EN': 'eng_Latn',
      'ENGLISH': 'eng_Latn',
      'EN-US': 'eng_Latn',
      'EN-GB': 'eng_Latn',
      'ES': 'spa_Latn',
      'SPANISH': 'spa_Latn',
      'DE': 'ger_Latn',
      'GERMAN': 'ger_Latn',
      'IT': 'ita_Latn',
      'ITALIAN': 'ita_Latn',
      'PT': 'por_Latn',
      'PORTUGUESE': 'por_Latn',
      'NL': 'nld_Latn',
      'DUTCH': 'nld_Latn',
      'JA': 'jpn_Jpan',
      'JAPANESE': 'jpn_Jpan',
      'ZH': 'zho_Hans',
      'CHINESE': 'zho_Hans',
      'AUTO': 'eng_Latn'
    };

    return map[clean] || (clean.length === 8 && clean.includes('_') ? clean.toLowerCase() : (isSource ? 'eng_Latn' : 'fra_Latn'));
  }

  /**
   * Extraction intelligente et filtrée du texte lisible à partir d'un Buffer PDF
   * Élimine les flux binaires, bruits d'objets PDF et balises non lisibles.
   */
  extractCleanTextFromPdf(pdfBuffer) {
    const raw = pdfBuffer.toString('latin1');
    
    const tjRegex = /\(([^()]{2,})\)\s*Tj/g;
    const tjBracketRegex = /\[((?:\([^()]*\)\s*[-0-9\s]*)+)\]\s*TJ/gi;
    
    let match;
    const extractedStrings = [];

    while ((match = tjRegex.exec(raw)) !== null) {
      const str = match[1].replace(/\\([()\\])/g, '$1').trim();
      if (str.length > 2 && /[a-zA-Z0-9éèàùâêîôûç]/.test(str)) {
        extractedStrings.push(str);
      }
    }

    while ((match = tjBracketRegex.exec(raw)) !== null) {
      const inner = match[1];
      const subMatches = inner.match(/\(([^()]+)\)/g);
      if (subMatches) {
        const combined = subMatches.map(s => s.slice(1, -1).replace(/\\([()\\])/g, '$1')).join('');
        if (combined.trim().length > 2 && /[a-zA-Z0-9éèàùâêîôûç]/.test(combined)) {
          extractedStrings.push(combined.trim());
        }
      }
    }

    // Extraction de secours si le PDF est au format texte pur ou ASCII non compressé
    if (extractedStrings.length < 5) {
      const lines = raw.split(/[\r\n]+/);
      for (const line of lines) {
        const clean = line.replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ').trim();
        if (
          clean.length >= 15 && 
          !clean.includes('endstream') && 
          !clean.includes('endobj') && 
          !clean.startsWith('/') && 
          !clean.startsWith('<<') && 
          !clean.startsWith('>>') &&
          /[a-zA-Z]{3,}/.test(clean)
        ) {
          extractedStrings.push(clean);
        }
      }
    }

    // Regrouper les fragments textuels en paragraphes cohérents (~300 chars max par bloc)
    const paragraphs = [];
    let currentPara = [];
    let currentLen = 0;

    for (const str of extractedStrings) {
      currentPara.push(str);
      currentLen += str.length;
      if (currentLen >= 300 || str.endsWith('.') || str.endsWith('!') || str.endsWith('?')) {
        const fullP = currentPara.join(' ').replace(/\s+/g, ' ').trim();
        if (fullP.length > 5) {
          paragraphs.push(fullP);
        }
        currentPara = [];
        currentLen = 0;
      }
    }

    if (currentPara.length > 0) {
      const fullP = currentPara.join(' ').replace(/\s+/g, ' ').trim();
      if (fullP.length > 5) {
        paragraphs.push(fullP);
      }
    }

    return paragraphs;
  }

  async translateBatch(textsArray, targetLang, sourceLang = null, apiKey = null) {
    if (!textsArray || !Array.isArray(textsArray) || textsArray.length === 0) {
      return [];
    }

    await this.ensureServerRunning();

    const formattedTarget = this.mapLanguageCode(targetLang, false);
    const formattedSource = this.mapLanguageCode(sourceLang, true);

    try {
      const response = await axios.post(`${this.serverUrl}/translate`, {
        texts: textsArray,
        target_lang: formattedTarget,
        source_lang: formattedSource
      }, {
        timeout: 600000 // 10 minutes par requête
      });

      if (response.data && response.data.success && Array.isArray(response.data.translations)) {
        return response.data.translations;
      }
      throw new Error(response.data?.error || "Erreur inconnue du serveur NLLB.");
    } catch (err) {
      console.error('[NLLBProvider] Échec de traduction:', err.message);
      throw new Error(`Erreur NLLB Local : ${err.response?.data?.error || err.message}`);
    }
  }

  async translateText(text, targetLang, sourceLang = null, apiKey = null) {
    const results = await this.translateBatch([text], targetLang, sourceLang, apiKey);
    return results[0] || text;
  }

  /**
   * Traduction de document (Text / PDF Buffer) avec découpage en mini-lots sécurisés
   */
  async translateDocument(docBuffer, targetLang, sourceLang = null, apiKey = null, onProgress = null) {
    if (onProgress) onProgress('Initialisation de NLLB Local...', 5);
    await this.ensureServerRunning();

    const isPdf = docBuffer.slice(0, 5).toString('ascii') === '%PDF-';
    let cleanTextParagraphs = [];

    if (isPdf) {
      if (onProgress) onProgress('Extraction et filtrage du texte du document PDF...', 10);
      cleanTextParagraphs = this.extractCleanTextFromPdf(docBuffer);
    } else {
      const textContent = docBuffer.toString('utf-8');
      cleanTextParagraphs = textContent.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
    }

    if (cleanTextParagraphs.length === 0) {
      throw new Error("Aucun contenu textuel lisible n'a pu être extrait du document.");
    }

    const totalParagraphs = cleanTextParagraphs.length;
    if (onProgress) onProgress(`Début de la traduction NLLB Local (${totalParagraphs} paragraphes)...`, 15);

    const translatedParagraphs = [];
    const BATCH_SIZE = 5; // 5 paragraphes par lot HTTP (durée ~5-10s par lot)

    for (let i = 0; i < totalParagraphs; i += BATCH_SIZE) {
      const batch = cleanTextParagraphs.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(totalParagraphs / BATCH_SIZE);
      const percent = Math.min(95, Math.round(15 + (i / totalParagraphs) * 80));

      if (onProgress) {
        onProgress(`Traduction NLLB Local (Lot ${batchNum}/${totalBatches} - Paragraphes ${i + 1}/${totalParagraphs})...`, percent);
      }

      console.log(`[NLLBProvider] Traduction Lot ${batchNum}/${totalBatches} (${batch.length} paragraphes)...`);
      const translatedBatch = await this.translateBatch(batch, targetLang, sourceLang);
      translatedParagraphs.push(...translatedBatch);
    }

    if (onProgress) onProgress('Traduction du document terminée avec succès !', 100);
    return Buffer.from(translatedParagraphs.join('\n\n'), 'utf-8');
  }
}

module.exports = NLLBProvider;
