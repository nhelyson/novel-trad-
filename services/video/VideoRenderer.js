const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const AudioExtractor = require('./AudioExtractor');

class VideoRenderer {
  /**
   * Incruste les sous-titres SRT dans une vidéo source MP4 et produit une nouvelle vidéo sous-titrée.
   */
  static async renderSubtitledVideo(inputVideoPath, srtFilePath, outputVideoPath, onProgress = null) {
    if (!fs.existsSync(inputVideoPath)) {
      throw new Error(`Vidéo source introuvable au chemin : ${inputVideoPath}`);
    }
    if (!fs.existsSync(srtFilePath)) {
      throw new Error(`Fichier de sous-titres SRT introuvable au chemin : ${srtFilePath}`);
    }

    const ffmpegBin = AudioExtractor.getFfmpegPath();

    // Normalisation du chemin SRT pour les filtres FFmpeg sur Windows (échappement des deux-points et antislashs)
    const escapedSrtPath = srtFilePath.replace(/\\/g, '/').replace(/:/g, '\\:');

    return new Promise((resolve, reject) => {
      if (onProgress) onProgress('Incrustation des sous-titres français dans la vidéo (FFmpeg)...', 20);

      // Argument FFmpeg pour incrustation élégante (texte blanc, contour noir net, bas de l'écran)
      const args = [
        '-y',
        '-i', inputVideoPath,
        '-vf', `subtitles='${escapedSrtPath}':force_style='FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,MarginV=20,Alignment=2'`,
        '-c:a', 'copy',
        outputVideoPath
      ];

      const proc = spawn(ffmpegBin, args);
      let errorLog = '';

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        errorLog += text;
      });

      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputVideoPath)) {
          if (onProgress) onProgress('Rendu de la vidéo sous-titrée terminé avec succès !', 100);
          resolve(outputVideoPath);
        } else {
          reject(new Error(`Échec du rendu vidéo FFmpeg (code ${code}): ${errorLog.slice(-300)}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Erreur lors du lancement de FFmpeg pour le rendu vidéo : ${err.message}`));
      });
    });
  }
}

module.exports = VideoRenderer;
