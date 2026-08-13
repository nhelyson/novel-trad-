const { PDFDocument } = require('pdf-lib');
const { DEEPL_SAFE_DOCUMENT_SIZE } = require('../../config/limits');

class PdfSplitter {
  /**
   * Découpe intelligemment un PDF volumineux en parties logiques dont chaque buffer est <= DEEPL_SAFE_DOCUMENT_SIZE (9 Mo).
   */
  static async split(pdfBuffer) {
    let srcDoc;
    try {
      srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    } catch (err) {
      throw new Error(`Échec du chargement du PDF pour découpage : ${err.message}`);
    }

    const totalPages = srcDoc.getPageCount();
    if (totalPages === 0) {
      throw new Error('Le document PDF ne contient aucune page à découper.');
    }

    // Calcul de la taille moyenne par page et estimation initiale des pages par lot
    const avgBytesPerPage = pdfBuffer.length / totalPages;
    const targetChunkBytes = 4.5 * 1024 * 1024; // 4.5 MB cible pour marge de sécurité
    let pagesPerChunk = Math.max(1, Math.floor(targetChunkBytes / avgBytesPerPage));
    pagesPerChunk = Math.min(pagesPerChunk, 20); // Cappe à 20 pages max par lot

    // Helper récursif pour s'assurer que chaque sous-PDF est <= DEEPL_SAFE_DOCUMENT_SIZE
    const createSafeSubChunks = async (startP, endP) => {
      const pageCount = endP - startP;
      const chunkDoc = await PDFDocument.create();
      const pageIndices = [];
      for (let p = startP; p < endP; p++) pageIndices.push(p);

      const copiedPages = await chunkDoc.copyPages(srcDoc, pageIndices);
      copiedPages.forEach(page => chunkDoc.addPage(page));
      const buf = Buffer.from(await chunkDoc.save({ useObjectStreams: true }));

      // Si le sous-PDF dépasse la limite sécurisée (9 Mo) et comporte plus d'1 page, le scinder en deux
      if (buf.length > DEEPL_SAFE_DOCUMENT_SIZE && pageCount > 1) {
        const mid = startP + Math.floor(pageCount / 2);
        console.log(`[PdfSplitter] Sous-PDF (pages ${startP + 1}-${endP}) de ${(buf.length / 1024 / 1024).toFixed(2)} Mo > 9 Mo. Scission adaptative...`);
        const left = await createSafeSubChunks(startP, mid);
        const right = await createSafeSubChunks(mid, endP);
        return [...left, ...right];
      }

      return [{ startPage: startP, endPage: endP, buffer: buf, pageCount }];
    };

    const rawBatchesCount = Math.ceil(totalPages / pagesPerChunk);
    const subChunks = [];

    for (let i = 0; i < rawBatchesCount; i++) {
      const startP = i * pagesPerChunk;
      const endP = Math.min(totalPages, (i + 1) * pagesPerChunk);
      const safeParts = await createSafeSubChunks(startP, endP);
      subChunks.push(...safeParts);
    }

    const totalParts = subChunks.length;
    const parts = subChunks.map((chunk, idx) => {
      const partIndex = idx + 1;
      const startPageNum = chunk.startPage + 1;
      const endPageNum = chunk.endPage;
      const title = `Partie ${partIndex}/${totalParts} (Pages ${startPageNum} à ${endPageNum})`;
      const sizeMB = parseFloat((chunk.buffer.length / (1024 * 1024)).toFixed(2));

      return {
        partIndex,
        totalParts,
        startPage: chunk.startPage,
        endPage: chunk.endPage,
        startPageNum,
        endPageNum,
        title,
        sizeBytes: chunk.buffer.length,
        sizeMB,
        buffer: chunk.buffer
      };
    });

    console.log(`[PdfSplitter] PDF de ${totalPages} pages découpé en ${totalParts} partie(s) logiques.`);
    return {
      totalPages,
      totalParts,
      parts
    };
  }
}

module.exports = PdfSplitter;
