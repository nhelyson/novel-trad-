const crypto = require('crypto');

class TextNormalizer {
  /**
   * Normalise légèrement le texte source pour la détection de doublons :
   * - Trim début et fin
   * - Unification des espaces insécables Unicode (\u00A0, \u200B, etc.)
   * - Réduction des espaces et tabulations multiples consécutifs en un seul espace
   * - Conservation intégrale de la ponctuation, des apostrophes, majuscules et accents.
   */
  static normalize(text) {
    if (!text || typeof text !== 'string') return '';

    return text
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // Supprime les espaces invisibles de largeur zéro
      .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ') // Remplace les espaces spéciaux par espace standard
      .replace(/[ \t]+/g, ' ') // Réduit plusieurs espaces/tabs consécutifs en un seul
      .replace(/\r\n/g, '\n') // Standardise les fins de lignes Windows en Unix
      .trim();
  }

  /**
   * Génère un Hash SHA-256 stable à partir du texte normalisé
   */
  static hash(text) {
    const normalized = this.normalize(text);
    return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
  }
}

module.exports = TextNormalizer;
