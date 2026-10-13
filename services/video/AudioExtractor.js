const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class AudioExtractor {
  /**
   * Localise le binaire FFmpeg disponible sur le système
   */
  static getFfmpegPath() {
    const candidates = [
      'C:\\Users\\japhet\\Downloads\\Compressed\\ffmpeg-8.1.2-essentials_build\\bin\\ffmpeg.exe',
      process.env.FFMPEG_PATH
    ];

    try {
      const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
      if (ffmpegInstaller && ffmpegInstaller.path && fs.existsSync(ffmpegInstaller.path)) {
        candidates.unshift(ffmpegInstaller.path);
      }
    } catch (e) {}

    for (const cand of candidates) {
      if (cand && fs.existsSync(cand)) {
        return cand;
      }
    }
    return 'ffmpeg';
  }

  /**
   * Extraie la piste audio d'un fichier vidéo et la convertit en fichier WAV 16kHz mono.
   */
  static async extractAudioToWav(videoInputPath, outputWavPath) {
    const ffmpegBin = this.getFfmpegPath();

    return new Promise((resolve, reject) => {
      // Arguments FFmpeg pour extraire en WAV PCM 16kHz 16-bit Mono (Requis pour Whisper)
      const args = [
        '-y',
        '-i', videoInputPath,
        '-vn',
        '-acodec', 'pcm_s16le',
        '-ar', '16000',
        '-ac', '1',
        outputWavPath
      ];

      const proc = spawn(ffmpegBin, args);
      let errorLog = '';

      proc.stderr.on('data', (data) => {
        errorLog += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputWavPath)) {
          resolve(outputWavPath);
        } else {
          reject(new Error(`Échec de l'extraction audio FFmpeg (code ${code}): ${errorLog.slice(-300)}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Erreur lors du lancement de FFmpeg (${ffmpegBin}): ${err.message}`));
      });
    });
  }
}

module.exports = AudioExtractor;
