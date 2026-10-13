const axios = require('axios');
const fs = require('fs');

class GeminiVideoService {
  /**
   * Interroge les endpoints Google AI Studio (v1beta & v1) pour obtenir la liste exacte
   * des modèles supportés et autorisés par la clé API fournie.
   */
  static async getAvailableModels(apiKey) {
    const endpoints = [
      { version: 'v1beta', url: `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}` },
      { version: 'v1', url: `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}` }
    ];

    for (const ep of endpoints) {
      try {
        const res = await axios.get(ep.url, { timeout: 10000 });
        if (res.data && Array.isArray(res.data.models)) {
          const validModels = res.data.models
            .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
            .map(m => ({
              name: m.name.replace(/^models\//, ''),
              apiVersion: ep.version
            }));

          if (validModels.length > 0) {
            console.log(`[GeminiVideoService] Modèles valides détectés via API (${ep.version}) :`, validModels.map(m => m.name).join(', '));
            return validModels;
          }
        }
      } catch (err) {
        const msg = err.response?.data?.error?.message || err.message;
        console.warn(`[GeminiVideoService] Information récupération modèles via ${ep.version}: ${msg}`);
      }
    }
    return [];
  }

  /**
   * Nettoie et découpe rigoureusement les segments pour éviter le chevauchement et les pavés de texte.
   */
  static sanitizeSegments(rawSegments) {
    if (!Array.isArray(rawSegments) || rawSegments.length === 0) return [];

    let clean = [];
    let currentId = 1;

    for (let i = 0; i < rawSegments.length; i++) {
      const seg = rawSegments[i];
      let origText = (seg.originalText || seg.text || '').replace(/\r?\n+/g, ' ').trim();
      let transText = (seg.translatedText || seg.text || '').replace(/\r?\n+/g, ' ').trim();

      if (!transText && !origText) continue;

      let start = typeof seg.start === 'number' ? parseFloat(seg.start.toFixed(2)) : 0.0;
      let end = typeof seg.end === 'number' ? parseFloat(seg.end.toFixed(2)) : (start + 3.0);

      // Si le modèle a renvoyé plusieurs phrases regroupées sur un long créneau (> 4s), les scinder
      const sentences = transText.split(/(?<=[.!?])\s+/).filter(Boolean);
      if (sentences.length > 1 && (end - start) > 4.0) {
        const durationPerSentence = (end - start) / sentences.length;
        for (let s = 0; s < sentences.length; s++) {
          const subStart = parseFloat((start + s * durationPerSentence).toFixed(2));
          const subEnd = parseFloat((start + (s + 1) * durationPerSentence - 0.1).toFixed(2));
          clean.push({
            id: currentId++,
            start: subStart,
            end: Math.max(subStart + 1.2, subEnd),
            originalText: origText,
            translatedText: sentences[s].trim()
          });
        }
      } else {
        clean.push({
          id: currentId++,
          start,
          end: Math.max(start + 1.5, end),
          originalText: origText,
          translatedText: transText
        });
      }
    }

    // Deuxième passe : Garantir des horodatages chronologiques stricts sans aucun chevauchement
    for (let j = 0; j < clean.length; j++) {
      if (j > 0) {
        const prevEnd = clean[j - 1].end;
        if (clean[j].start < prevEnd) {
          clean[j].start = parseFloat((prevEnd + 0.1).toFixed(2));
        }
        if (clean[j].end <= clean[j].start) {
          clean[j].end = parseFloat((clean[j].start + 2.5).toFixed(2));
        }
      }
    }

    return clean;
  }

  /**
   * Effectue la transcription audio/vidéo et la traduction directe via l'API Google Gemini.
   */
  static async processVideoWithGemini(mediaPath, mimeType = 'audio/wav', targetLang = 'FR', sourceLang = 'EN', apiKey = null, onProgress = null) {
    const effectiveKey = apiKey || process.env.GEMINI_API_KEY;

    if (!effectiveKey) {
      throw new Error('Clé API Gemini manquante. Veuillez fournir votre clé API Gemini.');
    }

    if (!fs.existsSync(mediaPath)) {
      throw new Error(`Fichier média introuvable au chemin : ${mediaPath}`);
    }

    if (onProgress) onProgress('Détection dynamique des modèles Gemini disponibles...', 15);

    let availableModels = await this.getAvailableModels(effectiveKey);

    if (availableModels.length === 0) {
      availableModels = [
        { name: 'gemini-flash-lite-latest', apiVersion: 'v1beta' },
        { name: 'gemini-flash-latest', apiVersion: 'v1beta' },
        { name: 'gemini-3.6-flash', apiVersion: 'v1beta' },
        { name: 'gemini-3.5-flash', apiVersion: 'v1beta' },
        { name: 'gemini-2.0-flash', apiVersion: 'v1beta' }
      ];
    }

    const preferredPatterns = [
      'gemini-flash-lite-latest',
      'gemini-flash-latest',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-2.0-flash',
      'gemini-1.5-flash-latest',
      'flash'
    ];

    const sortedModels = availableModels.sort((a, b) => {
      const idxA = preferredPatterns.findIndex(p => a.name.toLowerCase() === p.toLowerCase() || a.name.toLowerCase().includes(p.toLowerCase()));
      const idxB = preferredPatterns.findIndex(p => b.name.toLowerCase() === p.toLowerCase() || b.name.toLowerCase().includes(p.toLowerCase()));
      const scoreA = idxA === -1 ? 999 : idxA;
      const scoreB = idxB === -1 ? 999 : idxB;
      return scoreA - scoreB;
    });

    if (onProgress) onProgress('Lecture et encodage du fichier audio/vidéo...', 25);

    const fileBuffer = fs.readFileSync(mediaPath);
    const base64Data = fileBuffer.toString('base64');

    const promptText = `Tu es un sous-titreur et traducteur professionnel expert.
Analyse le fichier média fourni (audio ou vidéo).
1. Transcris et traduis la parole de ${sourceLang} vers ${targetLang}.
2. CONSIGNES STRICTES DE DÉCOUPAGE TEMPOREL ET DE SOUS-TITRAGE :
   - Découpe la parole en segments très courts (1 seule phrase ou 1 proposition courte par segment, 5 à 10 mots maximum).
   - Chaque segment doit durer entre 2.0 et 4.0 secondes.
   - Les horodatages 'start' et 'end' doivent être strictement séquentiels et chronologiques en secondes (start_N >= end_{N-1}).
   - 'translatedText' doit être une chaîne de texte simple SANS SAUTS DE LIGNE (\\n).
   - NE FAIS AUCUN CHEVAUCHEMENT DE TIMESTAMPS.

Retourne STRICTEMENT un tableau JSON d'objets avec la structure exacte suivante :
[
  {
    "id": 1,
    "start": 0.0,
    "end": 3.5,
    "originalText": "Texte parlé original",
    "translatedText": "Texte traduit"
  }
]`;

    let lastError = null;

    for (let i = 0; i < sortedModels.length; i++) {
      const modelObj = sortedModels[i];
      const modelName = modelObj.name;
      const apiVersion = modelObj.apiVersion || 'v1beta';
      const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${effectiveKey}`;

      if (onProgress) {
        onProgress(`Traitement IA multimodal avec le modèle "${modelName}"...`, 40 + Math.min(40, i * 10));
      }

      console.log(`[GeminiVideoService] Essai du modèle "${modelName}" (${apiVersion})...`);

      const requestBody = {
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Data
                }
              },
              {
                text: promptText
              }
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
          headers: { 'Content-Type': 'application/json' },
          timeout: 300000 // 5 minutes max
        });

        if (onProgress) onProgress('Réception et assainissement des sous-titres...', 90);

        const candidates = response.data?.candidates;
        if (!candidates || candidates.length === 0) {
          throw new Error('Réponse vide reçue de l\'API Google Gemini.');
        }

        const textOutput = candidates[0].content?.parts?.[0]?.text;
        if (!textOutput) {
          throw new Error('Aucun texte généré par l\'API Gemini.');
        }

        let rawSegments = [];
        try {
          rawSegments = JSON.parse(textOutput);
        } catch (parseErr) {
          const cleanedText = textOutput.replace(/```json/g, '').replace(/```/g, '').trim();
          rawSegments = JSON.parse(cleanedText);
        }

        if (!Array.isArray(rawSegments)) {
          throw new Error('Le format de réponse de Gemini n\'est pas un tableau JSON de segments.');
        }

        const normalizedSegments = this.sanitizeSegments(rawSegments);

        if (onProgress) onProgress(`Sous-titres Gemini générés et assainis avec succès (${normalizedSegments.length} segments).`, 95);

        return {
          fullText: normalizedSegments.map(s => s.translatedText).join(' '),
          segments: normalizedSegments
        };

      } catch (err) {
        const errorMsg = err.response?.data?.error?.message || err.message;
        console.warn(`[GeminiVideoService] Échec du modèle "${modelName}" : ${errorMsg}`);
        lastError = errorMsg;
      }
    }

    throw new Error(`Erreur API Gemini Video : Impossible d'exécuter la requête avec les modèles Gemini disponibles. Dernier message : ${lastError}`);
  }
}

module.exports = GeminiVideoService;
