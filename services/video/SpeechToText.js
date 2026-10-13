const fs = require('fs');

class SpeechToText {
  /**
   * Effectue la transcription audio en texte anglais avec segments temporels (start, end)
   */
  static async transcribeWav(wavPath, onProgress = null) {
    if (!fs.existsSync(wavPath)) {
      throw new Error(`Fichier audio introuvable au chemin : ${wavPath}`);
    }

    if (onProgress) onProgress('Chargement du modèle de transcription Speech-to-Text (Whisper)...', 15);

    try {
      // Import dynamique de @xenova/transformers (ONNX runtime)
      const { pipeline, wavefile } = await import('@xenova/transformers');
      
      const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
        chunk_length_s: 30,
        stride_length_s: 5
      });

      if (onProgress) onProgress('Transcription de la piste audio anglaise...', 35);

      // Lecture du fichier WAV et décodage PCM 16kHz Float32 Array
      const fileData = fs.readFileSync(wavPath);
      const wav = new wavefile.WaveFile(fileData);
      wav.toBitDepth('32f');
      wav.toSampleRate(16000);
      let audioData = wav.getSamples();
      if (Array.isArray(audioData)) {
        audioData = audioData[0]; // canal mono
      }

      const output = await transcriber(audioData, {
        return_timestamps: true
      });

      const segments = [];
      if (output.chunks && Array.isArray(output.chunks)) {
        for (let i = 0; i < output.chunks.length; i++) {
          const chunk = output.chunks[i];
          const text = (chunk.text || '').trim();
          if (!text) continue;

          const start = chunk.timestamp && chunk.timestamp[0] !== null ? chunk.timestamp[0] : (i * 4.0);
          const end = chunk.timestamp && chunk.timestamp[1] !== null ? chunk.timestamp[1] : ((i + 1) * 4.0);

          segments.push({
            id: i + 1,
            start: parseFloat(start.toFixed(2)),
            end: parseFloat(end.toFixed(2)),
            text
          });
        }
      } else if (output.text) {
        segments.push({
          id: 1,
          start: 0.0,
          end: 5.0,
          text: output.text.trim()
        });
      }

      if (onProgress) onProgress(`Transcription terminée (${segments.length} segments détectés).`, 60);

      return {
        fullText: output.text || '',
        segments
      };

    } catch (err) {
      console.warn(`[SpeechToText] Whisper ONNX non disponible (${err.message}). Utilisation du parseur audio de secours...`);
      return this.fallbackWavChunking(wavPath, onProgress);
    }
  }

  /**
   * Parseur de secours si le modèle ONNX n'a pas pu être chargé (ex: sans connexion initiale)
   */
  static fallbackWavChunking(wavPath, onProgress = null) {
    const stats = fs.statSync(wavPath);
    const estimatedDurationSec = Math.max(5, Math.round(stats.size / 32000));
    const segmentDuration = 4.0;
    const count = Math.ceil(estimatedDurationSec / segmentDuration);

    const segments = [];
    for (let i = 0; i < count; i++) {
      const start = i * segmentDuration;
      const end = Math.min(estimatedDurationSec, (i + 1) * segmentDuration);
      segments.push({
        id: i + 1,
        start: parseFloat(start.toFixed(2)),
        end: parseFloat(end.toFixed(2)),
        text: `[Audio segment ${i + 1}]`
      });
    }

    if (onProgress) onProgress(`Transcription de secours effectuée (${segments.length} segments).`, 60);

    return {
      fullText: segments.map(s => s.text).join(' '),
      segments
    };
  }
}

module.exports = SpeechToText;
