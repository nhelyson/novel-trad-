const TranslationProvider = require('./TranslationProvider');
const axios = require('axios');
const https = require('https');
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

class GeminiProvider extends TranslationProvider {
  constructor() {
    super('Gemini API', false);
  }

  static cachedModels = [
    { name: 'gemini-flash-latest', apiVersion: 'v1beta' },
    { name: 'gemini-3.7-flash', apiVersion: 'v1beta' },
    { name: 'gemini-3.5-flash', apiVersion: 'v1beta' }
  ];
  static cachedAt = Date.now();

  static async getAvailableModels(apiKey) {
    if (this.cachedModels && (Date.now() - this.cachedAt < 3600000)) {
      return this.cachedModels;
    }
    this.cachedModels = [
      { name: 'gemini-flash-latest', apiVersion: 'v1beta' },
      { name: 'gemini-3.7-flash', apiVersion: 'v1beta' },
      { name: 'gemini-3.5-flash', apiVersion: 'v1beta' }
    ];
    this.cachedAt = Date.now();
    return this.cachedModels;
  }

  /**
   * Traduit un lot de textes via l'API REST Google Gemini
   */
  async translateBatch(texts, targetLang = 'FR', sourceLang = 'EN', apiKey = null) {
    const effectiveKey = apiKey || process.env.GEMINI_API_KEY;
    if (!effectiveKey) {
      throw new Error('Clé API Gemini manquante. Veuillez saisir votre clé dans l\'interface.');
    }

    if (!texts || texts.length === 0) return [];

    const availableModels = await GeminiProvider.getAvailableModels(effectiveKey);
    const preferredPatterns = ['flash-latest', '3.7-flash', '3.5-flash'];
    const sortedModels = availableModels.sort((a, b) => {
      const idxA = preferredPatterns.findIndex(p => a.name.includes(p));
      const idxB = preferredPatterns.findIndex(p => b.name.includes(p));
      return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
    });

    const promptText = `Tu es un traducteur littéraire expert.
Traduis la liste de phrases suivantes de la langue ${sourceLang} vers la langue ${targetLang}.
Conserve le sens exact, le ton et la fluidité.
Retourne STRICTEMENT un tableau JSON de chaînes de caractères (string array) correspondant exactement dans l'ordre aux phrases transmises.

Phrases à traduire :
${JSON.stringify(texts)}`;

    let lastError = null;

    for (const modelObj of sortedModels) {
      const modelName = modelObj.name;
      const apiVersion = modelObj.apiVersion || 'v1beta';
      const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${effectiveKey}`;

      const requestBody = {
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1
        }
      };

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const response = await axios.post(url, requestBody, {
            httpsAgent,
            headers: { 'Content-Type': 'application/json' },
            timeout: 60000
          });

          const candidates = response.data?.candidates;
          if (!candidates || candidates.length === 0) {
            throw new Error('Réponse vide de l\'API Gemini.');
          }

          const rawText = candidates[0].content?.parts?.[0]?.text;
          let cleaned = (rawText || '').trim();
          if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```\s*$/, '');
          else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\s*/, '').replace(/```\s*$/, '');
          let translatedArray = JSON.parse(cleaned.trim());
          if (!Array.isArray(translatedArray)) {
            throw new Error('La réponse de Gemini n\'est pas un tableau JSON.');
          }

          return translatedArray;
        } catch (err) {
          lastError = err.response?.data?.error?.message || err.message;
          const isTransient = lastError.includes('high demand') || lastError.includes('429') || lastError.includes('503');
          if (isTransient && attempt < 3) {
            await new Promise(r => setTimeout(r, attempt * 800));
            continue;
          }
          break;
        }
      }
    }

    throw new Error(`Erreur API Gemini : ${lastError}`);
  }

  async translateText(text, targetLang = 'FR', sourceLang = 'EN', apiKey = null) {
    const results = await this.translateBatch([text], targetLang, sourceLang, apiKey);
    return results[0] || text;
  }

  async translateDocument(pdfBuffer, targetLang = 'FR', sourceLang = 'auto', apiKey = null, onProgress = null) {
    const pdfParse = require('pdf-parse');
    const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
    if (onProgress) onProgress('Extraction du texte PDF pour Gemini...', 10);
    const parsed = await pdfParse(pdfBuffer);
    const paragraphs = parsed.text.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 0);
    if (onProgress) onProgress('Traduction du contenu par Gemini...', 30);
    const translatedParagraphs = await this.translateBatch(paragraphs, targetLang, sourceLang, apiKey);
    if (onProgress) onProgress('Génération du document PDF traduit...', 85);
    
    const outPdf = await PDFDocument.create();
    const font = await outPdf.embedFont(StandardFonts.Helvetica);
    let page = outPdf.addPage([595, 842]);
    let y = 800;
    for (const para of translatedParagraphs) {
      const words = para.split(/\s+/);
      let currentLine = '';
      for (const w of words) {
        if ((currentLine + ' ' + w).length > 80) {
          if (y < 50) {
            page = outPdf.addPage([595, 842]);
            y = 800;
          }
          const safeText = currentLine.replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
          page.drawText(safeText, { x: 50, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
          y -= 14;
          currentLine = w;
        } else {
          currentLine = currentLine ? currentLine + ' ' + w : w;
        }
      }
      if (currentLine) {
        if (y < 50) {
          page = outPdf.addPage([595, 842]);
          y = 800;
        }
        const safeText = currentLine.replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
        page.drawText(safeText, { x: 50, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
        y -= 20;
      }
    }
    return Buffer.from(await outPdf.save());
  }

  async checkHealth() {
    return !!process.env.GEMINI_API_KEY;
  }

  /**
   * Analyse une planche de manga pour détecter les bulles de dialogue et les traduire
   */
  async translateMangaPage(imageBuffer, mimeType = 'image/jpeg', targetLang = 'FR', sourceLang = 'EN', apiKey = null) {
    const effectiveKey = apiKey || process.env.GEMINI_API_KEY;
    if (!effectiveKey) return [];

    const base64Data = imageBuffer.toString('base64');
    const prompt = `Tu es un traducteur et lettreur expert de manga.
Analyse cette page de manga. Détecte toutes les bulles de dialogue et cartouches de texte.
Pour chaque texte détecté :
1. Détermine sa boîte englobante 2D [ymin, xmin, ymax, xmax] normalisée sur une échelle de 0 à 1000.
2. Extrais le texte original en anglais.
3. Traduis-le en français percutant et naturel, en MAJUSCULES (style manga).
4. Indique si le fond de la bulle est "white" ou "black".

Retourne STRICTEMENT un tableau JSON d'objets suivant ce format :
[
  {
    "box_2d": [ymin, xmin, ymax, xmax],
    "text_en": "original text",
    "text_fr": "TEXTE EN FRANÇAIS",
    "bg_color": "white"
  }
]`;

    const candidates = ['gemini-flash-latest', 'gemini-3.7-flash', 'gemini-3.5-flash'];
    for (const model of candidates) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${effectiveKey}`;
      const requestBody = {
        contents: [
          {
            parts: [
              { inlineData: { mimeType, data: base64Data } },
              { text: prompt }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1
        }
      };

      try {
        const response = await axios.post(url, requestBody, {
          httpsAgent,
          headers: { 'Content-Type': 'application/json' },
          timeout: 60000
        });

        const respCandidates = response.data?.candidates;
        if (!respCandidates || respCandidates.length === 0) continue;

        let rawText = respCandidates[0].content?.parts?.[0]?.text || '';
        let cleaned = rawText.trim();
        if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```\s*$/, '');
        else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\s*/, '').replace(/```\s*$/, '');

        const bubbles = JSON.parse(cleaned);
        return Array.isArray(bubbles) ? bubbles : [];
      } catch (err) {
        console.warn(`[GeminiProvider] Avertissement manga vision (${model}):`, err.response?.data?.error?.message || err.message);
      }
    }
    return [];
  }
}

module.exports = GeminiProvider;
