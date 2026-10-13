class SubtitleGenerator {
  /**
   * Formate un nombre de secondes en horodatage SRT standard (00:00:00,000)
   */
  static formatSrtTimestamp(seconds) {
    const secNum = parseFloat(seconds) || 0;
    const hours = Math.floor(secNum / 3600);
    const minutes = Math.floor((secNum % 3600) / 60);
    const secs = Math.floor(secNum % 60);
    const millis = Math.round((secNum % 1) * 1000);

    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    const ss = String(secs).padStart(2, '0');
    const mmm = String(millis).padStart(3, '0');

    return `${hh}:${mm}:${ss},${mmm}`;
  }

  /**
   * Génère le contenu au format sous-titres .srt à partir de la liste des segments traduits
   */
  static generateSrtContent(translatedSegments) {
    if (!translatedSegments || !Array.isArray(translatedSegments) || translatedSegments.length === 0) {
      return '';
    }

    const srtBlocks = [];

    for (let i = 0; i < translatedSegments.length; i++) {
      const seg = translatedSegments[i];
      const index = i + 1;
      const startTime = this.formatSrtTimestamp(seg.start);
      const endTime = this.formatSrtTimestamp(seg.end);
      
      let rawText = (seg.translatedText || seg.originalText || '').replace(/\r?\n+/g, ' ').trim();

      // Formater la ligne si elle est très longue (> 55 car) en 2 lignes max équilibrées
      if (rawText.length > 55) {
        const words = rawText.split(' ');
        const mid = Math.ceil(words.length / 2);
        rawText = words.slice(0, mid).join(' ') + '\n' + words.slice(mid).join(' ');
      }

      srtBlocks.push(`${index}\n${startTime} --> ${endTime}\n${rawText}\n`);
    }

    return srtBlocks.join('\n');
  }
}

module.exports = SubtitleGenerator;
