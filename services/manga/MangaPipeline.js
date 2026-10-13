const sharp = require('sharp');
const GeminiProvider = require('../translation/GeminiProvider');

/**
 * Moteur IA & Service de Traduction Manga / Planches graphiques
 */
class MangaPipeline {
  /**
   * Traite une page de manga : détection des bulles + traduction + lettrage sur l'image
   */
  static async processMangaPage(imageBuffer, sourceLang = 'EN', targetLang = 'FR', apiKey = null) {
    if (!imageBuffer || imageBuffer.length < 500) return imageBuffer;

    try {
      const gemini = new GeminiProvider();
      const mimeType = imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50 ? 'image/png' : 'image/jpeg';
      
      const bubbles = await gemini.translateMangaPage(imageBuffer, mimeType, targetLang, sourceLang, apiKey);
      if (!bubbles || bubbles.length === 0) {
        return imageBuffer;
      }

      console.log(`[MangaPipeline] ${bubbles.length} bulles traduites incrustées sur la planche.`);
      const translatedImage = await this.renderTranslatedPage(imageBuffer, bubbles);
      return translatedImage;
    } catch (err) {
      console.warn('[MangaPipeline] Avertissement traitement page manga:', err.message);
      return imageBuffer;
    }
  }

  /**
   * Incruste les bulles traduites sur l'image via Sharp et composition SVG
   */
  static async renderTranslatedPage(imageBuffer, bubbles) {
    const meta = await sharp(imageBuffer).metadata();
    const width = meta.width || 1200;
    const height = meta.height || 1800;

    const svgElements = [];

    for (const b of bubbles) {
      if (!b.box_2d || b.box_2d.length < 4 || !b.text_fr) continue;

      const top = Math.round((b.box_2d[0] / 1000) * height);
      const left = Math.round((b.box_2d[1] / 1000) * width);
      const bHeight = Math.max(20, Math.round(((b.box_2d[2] - b.box_2d[0]) / 1000) * height));
      const bWidth = Math.max(30, Math.round(((b.box_2d[3] - b.box_2d[1]) / 1000) * width));

      const cx = left + Math.round(bWidth / 2);
      const cy = top + Math.round(bHeight / 2);
      const rx = Math.max(10, Math.round(bWidth / 2) - 4);
      const ry = Math.max(10, Math.round(bHeight / 2) - 4);

      const isDark = b.bg_color === 'black';
      const bgColor = isDark ? '#050505' : '#ffffff';
      const textColor = isDark ? '#ffffff' : '#111111';

      // 1. Fond de bulle pour effacer l'anglais
      svgElements.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${bgColor}" />`);

      // 2. Découpage du texte en lignes adaptées
      const words = b.text_fr.split(/\s+/).filter(w => w.length > 0);
      let fontSize = Math.max(10, Math.min(22, Math.round(bHeight / 5)));
      
      if (words.join(' ').length > 40 && fontSize > 12) {
        fontSize = Math.max(10, fontSize - 3);
      }

      const maxCharsPerLine = Math.max(8, Math.round((bWidth * 0.75) / (fontSize * 0.6)));
      const lines = [];
      let currentLine = '';

      for (const w of words) {
        if ((currentLine + ' ' + w).trim().length > maxCharsPerLine) {
          if (currentLine) lines.push(currentLine.trim());
          currentLine = w;
        } else {
          currentLine = (currentLine + ' ' + w).trim();
        }
      }
      if (currentLine) lines.push(currentLine.trim());

      const lineHeight = Math.round(fontSize * 1.25);
      const totalTextHeight = lines.length * lineHeight;
      let startY = cy - Math.round(totalTextHeight / 2) + Math.round(fontSize * 0.85);

      for (let i = 0; i < lines.length; i++) {
        const lineY = startY + (i * lineHeight);
        const escapedText = lines[i]
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');

        svgElements.push(`<text x="${cx}" y="${lineY}" font-family="sans-serif, Arial, 'Anime Ace'" font-size="${fontSize}" font-weight="bold" fill="${textColor}" text-anchor="middle">${escapedText}</text>`);
      }
    }

    if (svgElements.length === 0) return imageBuffer;

    const svgXml = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      ${svgElements.join('\n')}
    </svg>`;

    const format = meta.format === 'png' ? 'png' : 'jpeg';
    let pipeline = sharp(imageBuffer).composite([{ input: Buffer.from(svgXml), top: 0, left: 0 }]);
    if (format === 'png') {
      return await pipeline.png({ compressionLevel: 8 }).toBuffer();
    } else {
      return await pipeline.jpeg({ quality: 92 }).toBuffer();
    }
  }
}

module.exports = MangaPipeline;