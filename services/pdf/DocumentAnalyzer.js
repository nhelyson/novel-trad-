const { PDFDocument } = require('pdf-lib');
const { DEEPL_MAX_DOCUMENT_SIZE, DEEPL_SAFE_DOCUMENT_SIZE } = require('../../config/limits');

class DocumentAnalyzer {
  /**
   * Analyse un fichier PDF pour déterminer sa taille, sa structure et la stratégie de traduction.
   */
  static async analyze(pdfBuffer, filename = 'document.pdf') {
    if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
      throw new Error('Aucun contenu de document fourni pour analyse.');
    }

    // Vérification de la signature magique PDF (%PDF-)
    const isPdfMagic = pdfBuffer.slice(0, 5).toString('ascii') === '%PDF-';
    if (!isPdfMagic) {
      throw new Error('Le fichier fourni n\'est pas un document PDF valide.');
    }

    const sizeBytes = pdfBuffer.length;
    const sizeMB = parseFloat((sizeBytes / (1024 * 1024)).toFixed(2));
    
    let pageCount = 0;
    try {
      const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
      pageCount = pdfDoc.getPageCount();
    } catch (err) {
      throw new Error(`Impossible de lire la structure du document PDF : ${err.message}`);
    }

    if (pageCount === 0) {
      throw new Error('Le document PDF fourni ne contient aucune page.');
    }

    const exceedsMaxLimit = sizeBytes > DEEPL_MAX_DOCUMENT_SIZE;
    const exceedsSafeLimit = sizeBytes > DEEPL_SAFE_DOCUMENT_SIZE;

    let strategy = 'DIRECT';
    if (exceedsSafeLimit) {
      strategy = 'OPTIMIZE_FIRST';
    }

    return {
      filename,
      sizeBytes,
      sizeMB,
      pageCount,
      isPdf: true,
      exceedsMaxLimit,
      exceedsSafeLimit,
      strategy
    };
  }
}

module.exports = DocumentAnalyzer;
