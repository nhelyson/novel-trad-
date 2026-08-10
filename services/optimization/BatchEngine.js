class BatchEngine {
  /**
   * Regroupe les segments en lots dynamiques respectant les limites DeepL :
   * - Max 40 segments par lot
   * - Max 15 000 caractères par lot
   */
  static createBatches(segments, maxSegmentsPerBatch = 40, maxCharsPerBatch = 15000) {
    const batches = [];
    let currentBatch = [];
    let currentChars = 0;

    for (const seg of segments) {
      const segLength = seg.source_text ? seg.source_text.length : 0;

      if (
        currentBatch.length >= maxSegmentsPerBatch ||
        (currentChars + segLength > maxCharsPerBatch && currentBatch.length > 0)
      ) {
        batches.push(currentBatch);
        currentBatch = [];
        currentChars = 0;
      }

      currentBatch.push(seg);
      currentChars += segLength;
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return batches;
  }
}

module.exports = BatchEngine;
