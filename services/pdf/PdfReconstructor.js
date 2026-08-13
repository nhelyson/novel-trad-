const { PDFDocument } = require('pdf-lib');

class PdfReconstructor {
  /**
   * Reconstruit et fusionne un tableau de sous-PDFs traduits en un document PDF final unifié.
   */
  static async reconstruct(translatedPartBuffers) {
    if (!Array.isArray(translatedPartBuffers) || translatedPartBuffers.length === 0) {
      throw new Error('Aucune partie de document fournie pour la reconstruction.');
    }

    if (translatedPartBuffers.length === 1) {
      return Buffer.isBuffer(translatedPartBuffers[0]) 
        ? translatedPartBuffers[0] 
        : Buffer.from(translatedPartBuffers[0]);
    }

    try {
      const mergedDoc = await PDFDocument.create();

      for (let i = 0; i < translatedPartBuffers.length; i++) {
        const partBuffer = translatedPartBuffers[i];
        if (!partBuffer || partBuffer.length === 0) {
          throw new Error(`Le lot traduit ${i + 1} est vide.`);
        }

        const subDoc = await PDFDocument.load(partBuffer, { ignoreEncryption: true });
        const copiedPages = await mergedDoc.copyPages(subDoc, subDoc.getPageIndices());
        copiedPages.forEach(page => mergedDoc.addPage(page));
      }

      const mergedBytes = await mergedDoc.save({ useObjectStreams: true });
      const finalBuffer = Buffer.from(mergedBytes);
      console.log(`[PdfReconstructor] Document PDF final reconstruit (${translatedPartBuffers.length} parties, ${mergedDoc.getPageCount()} pages, ${(finalBuffer.length / 1024 / 1024).toFixed(2)} Mo).`);
      return finalBuffer;
    } catch (err) {
      throw new Error(`Erreur lors de la reconstruction et fusion du PDF final : ${err.message}`);
    }
  }
}

module.exports = PdfReconstructor;
