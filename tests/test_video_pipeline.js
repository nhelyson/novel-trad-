const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const AudioExtractor = require('../services/video/AudioExtractor');
const SpeechToText = require('../services/video/SpeechToText');
const SubtitleTranslator = require('../services/video/SubtitleTranslator');
const SubtitleGenerator = require('../services/video/SubtitleGenerator');
const VideoRenderer = require('../services/video/VideoRenderer');
const VideoPipeline = require('../services/video/VideoPipeline');
const GeminiVideoService = require('../services/video/GeminiVideoService');

async function runVideoPipelineTests() {
  console.log('====================================================');
  console.log(' 🧪 TEST SUITE: MODULE INDÉPENDANT TRADUCTION VIDÉO');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(title, fn) {
    try {
      await fn();
      console.log(` [✅ PASS] ${title}`);
      passed++;
    } catch (err) {
      console.error(` [❌ FAIL] ${title}`);
      console.error(`          -> Error: ${err.message}`);
      failed++;
    }
  }

  // 1. Détection du binaire FFmpeg local
  await test('Test 1: Détection automatique du binaire FFmpeg local', async () => {
    const ffmpegBin = AudioExtractor.getFfmpegPath();
    assert.ok(ffmpegBin, "Le binaire FFmpeg doit être résolu.");
    console.log(`          -> FFmpeg résolu sur : ${ffmpegBin}`);
  });

  // 2. Horodatage SRT (Format: 00:00:00,000)
  await test('Test 2: Validation du formatage des horodatages SRT (00:00:00,000)', async () => {
    const timestamp1 = SubtitleGenerator.formatSrtTimestamp(1.234);
    assert.strictEqual(timestamp1, '00:00:01,234');

    const timestamp2 = SubtitleGenerator.formatSrtTimestamp(3665.500);
    assert.strictEqual(timestamp2, '01:01:05,500');
  });

  // 3. Traduction de segments
  const mockSegments = [
    { id: 1, start: 1.0, end: 4.5, text: "Hello, welcome to this video." },
    { id: 2, start: 5.0, end: 8.2, text: "Today we will translate videos automatically." }
  ];

  await test('Test 3: Traduction des segments anglais -> français', async () => {
    const mockProvider = {
      getName: () => 'MockTranslator',
      translateBatch: async (texts) => texts.map(t => t.replace("Hello, welcome to this video.", "Bonjour, bienvenue dans cette vidéo.").replace("Today we will translate videos automatically.", "Aujourd'hui nous allons traduire des vidéos automatiquement."))
    };

    const translated = await SubtitleTranslator.translateSegments(mockSegments, 'FR', 'EN', mockProvider, null);
    assert.strictEqual(translated.length, 2);
    assert.strictEqual(translated[0].translatedText, "Bonjour, bienvenue dans cette vidéo.");
    assert.strictEqual(translated[0].start, 1.0);
    assert.strictEqual(translated[0].end, 4.5);
  });

  // 4. Validation du formatage .srt
  await test('Test 4: Génération conforme du fichier de sous-titres .srt', async () => {
    const translatedSegments = [
      { id: 1, start: 1.0, end: 4.5, originalText: "Hello", translatedText: "Bonjour, bienvenue." },
      { id: 2, start: 5.0, end: 8.2, originalText: "Welcome", translatedText: "Aujourd'hui nous parlons de..." }
    ];

    const srtContent = SubtitleGenerator.generateSrtContent(translatedSegments);
    assert.ok(srtContent.includes('1\n00:00:01,000 --> 00:00:04,500\nBonjour, bienvenue.'));
    assert.ok(srtContent.includes('2\n00:00:05,000 --> 00:00:08,200\nAujourd\'hui nous parlons de...'));
  });

  // 5. Validation du pipeline direct Google Gemini API
  await test('Test 5: Pipeline direct Google Gemini API (Multimodal)', async () => {
    const mockVideoBuffer = Buffer.from("MOCK_VIDEO_BINARY_DATA_MP4");

    const originalExtract = AudioExtractor.extractAudioToWav;
    const originalGemini = GeminiVideoService.processVideoWithGemini;

    AudioExtractor.extractAudioToWav = async (input, output) => {
      fs.writeFileSync(output, Buffer.from("RIFF....WAVEfmt "));
      return output;
    };

    GeminiVideoService.processVideoWithGemini = async () => ({
      fullText: "Bienvenue sur NovelTrad via Gemini AI",
      segments: [
        { id: 1, start: 0.0, end: 4.0, originalText: "Welcome to NovelTrad via Gemini AI", translatedText: "Bienvenue sur NovelTrad via Gemini AI" }
      ]
    });

    try {
      const docId = 'job_video_gemini_test_' + Date.now();
      const result = await VideoPipeline.processVideoTranslation(
        docId,
        mockVideoBuffer,
        'test_gemini.mp4',
        'FR',
        'EN',
        'gemini',
        'mock_gemini_key',
        null
      );

      assert.ok(result.srtContent.includes('Bienvenue sur NovelTrad via Gemini AI'), "Le fichier SRT doit contenir la traduction produite par Gemini.");
      assert.strictEqual(result.segmentCount, 1);
    } finally {
      AudioExtractor.extractAudioToWav = originalExtract;
      GeminiVideoService.processVideoWithGemini = originalGemini;
    }
  });

  // 6. Nettoyage 100% éphémère du disque
  await test('Test 6: Nettoyage éphémère garanti (aucun fichier temporaire restant)', async () => {
    const tempDir = os.tmpdir();
    const items = fs.readdirSync(tempDir);
    const residualVideoDirs = items.filter(name => name.startsWith('novel_trad_video_') || name.startsWith('novel_trad_render_'));
    assert.strictEqual(residualVideoDirs.length, 0, "Tous les dossiers temporaires vidéo doivent avoir été supprimés.");
  });

  console.log('\n====================================================');
  console.log(` RESULTATS: ${passed} PASS, ${failed} FAIL sur ${passed + failed} tests.`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runVideoPipelineTests().catch(err => {
  console.error('❌ ÉCHEC SUITE DE TESTS VIDÉO:', err);
  process.exit(1);
});

