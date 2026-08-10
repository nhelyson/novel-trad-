class DocumentCleaner {
  /**
   * Analyse un segment de texte et retourne son niveau de répétitivité / inutilité pour la traduction
   * Niveaux de confiance :
   * - SAFE : Élément 100% non traduisible (numéro de page, ISBN pur, ligne d'espacement)
   * - LIKELY : Métadonnées répétitives (copyright, en-tête d'éditeur)
   * - UNCERTAIN : Texte ambigu ou incertain -> CONSERVÉ PAR SÉCURITÉ
   */
  static evaluateSegment(text) {
    if (!text || typeof text !== 'string') {
      return { confidence: 'SAFE', shouldSkip: true, reason: 'Vide' };
    }

    const trimmed = text.trim();

    if (trimmed.length === 0) {
      return { confidence: 'SAFE', shouldSkip: true, reason: 'Ligne vide' };
    }

    // 1. Détection des numéros de pages seuls (ex: "Page 12", "- 14 -", "12 / 300")
    if (/^(page\s*)?\d{1,4}(\s*\/\s*\d{1,4})?$/i.test(trimmed) || /^[-–—]\s*\d{1,4}\s*[-–—]$/.test(trimmed)) {
      return { confidence: 'SAFE', shouldSkip: true, reason: 'Numéro de page' };
    }

    // 2. Détection d'ISBN
    if (/^ISBN[-:]?\s*97[89][-\s]?\d{1,5}[-\s]?\d{1,7}[-\s]?\d{1,7}[-\s]?[\dX]$/i.test(trimmed)) {
      return { confidence: 'SAFE', shouldSkip: true, reason: 'Numéro ISBN' };
    }

    // 3. Sommaire avec pointillés (ex: "Chapitre 1 ................. 15")
    if (/\.{4,}\s*\d+$/.test(trimmed)) {
      return { confidence: 'SAFE', shouldSkip: true, reason: 'Ligne de sommaire bruits' };
    }

    // 4. Mention de Copyright standard
    if (/^(copyright\s*©|all rights reserved|tous droits réservés)/i.test(trimmed)) {
      return { confidence: 'LIKELY', shouldSkip: true, reason: 'Page de copyright' };
    }

    // Par défaut : UNCERTAIN -> Toujours conserver pour traduction
    return { confidence: 'UNCERTAIN', shouldSkip: false, reason: 'Texte régulier' };
  }

  /**
   * Filtre et nettoie la liste des segments bruts d'un document.
   * Retourne { cleanedSegments, skippedSegments, charactersSaved }
   */
  static cleanDocumentSegments(rawSegments) {
    const cleanedSegments = [];
    const skippedSegments = [];
    let charactersSaved = 0;

    for (const seg of rawSegments) {
      const evalResult = this.evaluateSegment(seg.text);

      if (evalResult.shouldSkip && evalResult.confidence !== 'UNCERTAIN') {
        charactersSaved += seg.text.length;
        skippedSegments.push({
          ...seg,
          status: 'SKIPPED',
          skipReason: evalResult.reason,
          confidence: evalResult.confidence
        });
      } else {
        cleanedSegments.push({
          ...seg,
          status: 'PENDING'
        });
      }
    }

    return {
      cleanedSegments,
      skippedSegments,
      charactersSaved
    };
  }
}

module.exports = DocumentCleaner;
