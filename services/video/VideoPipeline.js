const fs = require('fs');
const path = require('path');
const os = require('os');
const AudioExtractor = require('./AudioExtractor');
const SpeechToText = require('./SpeechToText');
const SubtitleTranslator = require('./SubtitleTranslator');
const SubtitleGenerator = require('./SubtitleGenerator');
const VideoRenderer = require('./VideoRenderer');
const VideoJobStore = require('./VideoJobStore');
const GeminiVideoService = require('./GeminiVideoService');
const PerformanceProfiler = require('../optimization/PerformanceProfiler');

class VideoPipeline {
  /**
   * Pipeline principal de traduction d'une vidéo (Extraction -> Transcription -> Traduction -> SRT)
   */
  static async processVideoTranslation(docId, videoBuffer, filename, targetLang = 'FR', sourceLang = 'EN', provider = 'gemini', apiKey = null, onProgress = null) {
    const profiler = new PerformanceProfiler(docId + '_video');
    VideoJobStore.createJob(docId, filename);

    const tempDir = path.join(os.tmpdir(), `novel_trad_video_${docId}_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const tempVideoPath = path.join(tempDir, `input_${filename}`);
    const tempWavPath = path.join(tempDir, `audio_extracted.wav`);

    try {
      // 1. Sauvegarde éphémère du buffer vidéo d'entrée sur le disque temporaire
      VideoJobStore.setPhase(docId, 'ANALYSIS', 'Analyse du fichier vidéo...');
      if (onProgress) onProgress('Analyse du fichier vidéo...', 5);
      fs.writeFileSync(tempVideoPath, videoBuffer);
      profiler.endStep('1. Analyse & Écriture Temp');

      // 2. Extraction de la piste audio au format WAV 16kHz mono (FFmpeg)
      VideoJobStore.setPhase(docId, 'AUDIO_EXTRACTION', 'Extraction de la piste audio (FFmpeg)...');
      if (onProgress) onProgress('Extraction de la piste audio via FFmpeg...', 15);
      await AudioExtractor.extractAudioToWav(tempVideoPath, tempWavPath);
      profiler.endStep('2. Extraction Audio FFmpeg');

      let translatedSegments = [];

      // Branche 3 & 4 : Gemini API Direct vs Whisper/Legacy
      const providerName = (typeof provider === 'string' ? provider : provider?.getName?.() || '').toLowerCase();
      const isGemini = providerName === 'gemini' || providerName === 'gemini-api' || providerName === 'geminividservice';

      if (isGemini) {
        VideoJobStore.setPhase(docId, 'GEMINI_AI_PROCESSING', 'Traitement IA multimodal direct via Google Gemini API...');
        if (onProgress) onProgress('Transcription & Traduction multimodale par Google Gemini API...', 30);

        const geminiResult = await GeminiVideoService.processVideoWithGemini(
          tempWavPath,
          'audio/wav',
          targetLang,
          sourceLang,
          apiKey,
          (msg, pct) => {
            VideoJobStore.setTranslationProgress(docId, Math.round((pct / 100) * 100), 100, msg);
            if (onProgress) onProgress(msg, pct);
          }
        );

        translatedSegments = geminiResult.segments;
        profiler.endStep('3&4. Multimodal Gemini Processing');

      } else {
        // Mode legacy (Whisper ONNX + SubtitleTranslator)
        VideoJobStore.setPhase(docId, 'TRANSCRIPTION', 'Transcription Speech-to-Text de la piste audio...');
        const transcriptionResult = await SpeechToText.transcribeWav(tempWavPath, (msg, pct) => {
          if (onProgress) onProgress(msg, pct);
        });
        const { segments } = transcriptionResult;
        profiler.endStep('3. Transcription Whisper');

        VideoJobStore.setPhase(docId, 'TRANSLATION', `Traduction de ${segments.length} segments textuels...`, {
          totalSegments: segments.length
        });
        
        translatedSegments = await SubtitleTranslator.translateSegments(
          segments,
          targetLang,
          sourceLang,
          provider,
          apiKey,
          (msg, pct) => {
            VideoJobStore.setTranslationProgress(docId, Math.round(((pct - 60) / 30) * segments.length), segments.length, msg);
            if (onProgress) onProgress(msg, pct);
          }
        );
        profiler.endStep('4. Traduction des Segments');
      }

      // 5. Génération du contenu du fichier de sous-titres .srt
      VideoJobStore.setPhase(docId, 'SRT_GENERATION', 'Génération du fichier de sous-titres SRT final...');
      if (onProgress) onProgress('Génération du fichier de sous-titres SRT...', 95);

      const srtContent = SubtitleGenerator.generateSrtContent(translatedSegments);
      VideoJobStore.setSrtContent(docId, srtContent);
      profiler.endStep('5. Génération Fichier SRT');

      const summary = profiler.getSummary();
      profiler.printSummaryConsole();

      VideoJobStore.completeJob(docId, summary);
      return {
        docId,
        srtContent,
        segmentCount: translatedSegments.length,
        profilerSummary: summary
      };

    } finally {
      // 6. Nettoyage 100% éphémère du répertoire temporaire
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch (cleanErr) {
        console.warn(`[VideoPipeline] Avertissement nettoyage temp (${tempDir}): ${cleanErr.message}`);
      }
    }
  }

  /**
   * Optionnel : Génère la vidéo finale sous-titrée incrustée (MP4)
   */
  static async renderSubtitledVideo(docId, videoBuffer, filename, srtContent, onProgress = null) {
    const profiler = new PerformanceProfiler(docId + '_render');
    const tempDir = path.join(os.tmpdir(), `novel_trad_render_${docId}_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const tempVideoPath = path.join(tempDir, `input_${filename}`);
    const tempSrtPath = path.join(tempDir, `subtitles_fr.srt`);
    const outputVideoPath = path.join(tempDir, `output_subtitled.mp4`);

    try {
      fs.writeFileSync(tempVideoPath, videoBuffer);
      fs.writeFileSync(tempSrtPath, srtContent, 'utf-8');

      VideoJobStore.setPhase(docId, 'VIDEO_RENDERING', 'Incrustation des sous-titres dans la vidéo (FFmpeg)...');
      await VideoRenderer.renderSubtitledVideo(tempVideoPath, tempSrtPath, outputVideoPath, onProgress);

      const renderedBuffer = fs.readFileSync(outputVideoPath);
      VideoJobStore.setVideoBuffer(docId, renderedBuffer);

      profiler.endStep('Rendu FFmpeg Vidéo Incrustée');
      profiler.printSummaryConsole();

      return renderedBuffer;
    } finally {
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch (cleanErr) {}
    }
  }
}

module.exports = VideoPipeline;
