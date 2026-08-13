const { PDFDocument } = require('pdf-lib');
const { DEEPL_SAFE_DOCUMENT_SIZE } = require('../../config/limits');

class PdfOptimizer {
  /**
   * Optimise un PDF de façon non-agressive (re-compression des streams d'objets, nettoyage de métadonnées).
   */
  static async optimize(pdfBuffer) {
    const beforeBytes = pdfBuffer.length;
    const beforeSizeMB = parseFloat((beforeBytes / (1024 * 1024)).toFixed(2));

    try {
      // Chargement du document PDF
      const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });

      // Re-sauvegarde avec optimisation des object streams
      const optimizedBytes = await pdfDoc.save({ useObjectStreams: true });
      const optimizedBuffer = Buffer.from(optimizedBytes);
      const afterBytes = optimizedBuffer.length;
      const afterSizeMB = parseFloat((afterBytes / (1024 * 1024)).toFixed(2));

      const reductionBytes = beforeBytes - afterBytes;
      const reductionPercent = parseFloat(((reductionBytes / beforeBytes) * 100).toFixed(1));
      const isSafeForDeepL = afterBytes <= DEEPL_SAFE_DOCUMENT_SIZE;

      return {
        success: true,
        optimizedBuffer,
        beforeBytes,
        afterBytes,
        beforeSizeMB,
        afterSizeMB,
        reductionPercent,
        isSafeForDeepL
      };
    } catch (err) {
      console.warn('[PdfOptimizer] Échec de l\'optimisation non-agressive:', err.message);
      return {
        success: false,
        optimizedBuffer: pdfBuffer,
        beforeBytes,
        afterBytes: beforeBytes,
        beforeSizeMB,
        afterSizeMB: beforeSizeMB,
        reductionPercent: 0,
        isSafeForDeepL: beforeBytes <= DEEPL_SAFE_DOCUMENT_SIZE,
        error: err.message
      };
    }
  }
}

module.exports = PdfOptimizer;
