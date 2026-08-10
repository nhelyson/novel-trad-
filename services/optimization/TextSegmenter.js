const crypto = require('crypto');
const TextNormalizer = require('./TextNormalizer');

class TextSegmenter {
  /**
   * Découpe un texte brut de roman en structure Chapitres / Segments
   */
  static segmentText(rawText, docId) {
    if (!rawText || typeof rawText !== 'string') {
      return { chapters: [], segments: [] };
    }

    const lines = rawText.split(/\r?\n/);
    const chapters = [];
    const segments = [];

    let currentChapterIndex = 1;
    let currentChapterTitle = 'Chapitre 1';
    let currentChapterId = `${docId}_ch${currentChapterIndex}`;

    chapters.push({
      id: currentChapterId,
      document_id: docId,
      chapter_index: currentChapterIndex,
      title: currentChapterTitle
    });

    let globalSegmentIndex = 0;
    let paragraphBuffer = [];

    const flushParagraph = () => {
      if (paragraphBuffer.length === 0) return;
      const paragraphText = paragraphBuffer.join(' ').trim();
      paragraphBuffer = [];

      if (paragraphText.length === 0) return;

      // Découper les gros paragraphes en sous-segments (~400 chars max)
      const subSegments = this.splitParagraphToSubSegments(paragraphText);

      for (const subText of subSegments) {
        globalSegmentIndex++;
        const normalized = TextNormalizer.normalize(subText);
        const hash = TextNormalizer.hash(subText);
        const segId = `${docId}_seg${globalSegmentIndex}`;

        segments.push({
          id: segId,
          document_id: docId,
          chapter_id: currentChapterId,
          segment_index: globalSegmentIndex,
          source_text: subText,
          normalized_text: normalized,
          source_hash: hash,
          translated_text: null,
          status: 'PENDING',
          error_message: null,
          characters_count: subText.length
        });
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Détection de nouveau chapitre
      const isChapterTitle = /^(chapitre|chapter|tome|act|partie)\s+\d+$/i.test(line) || /^(chapitre|chapter)\s+[ivxlcdm]+$/i.test(line);

      if (isChapterTitle && paragraphBuffer.length === 0) {
        currentChapterIndex++;
        currentChapterTitle = line;
        currentChapterId = `${docId}_ch${currentChapterIndex}`;

        chapters.push({
          id: currentChapterId,
          document_id: docId,
          chapter_index: currentChapterIndex,
          title: currentChapterTitle
        });
        continue;
      }

      if (line.length === 0) {
        flushParagraph();
      } else {
        paragraphBuffer.push(line);
      }
    }

    flushParagraph();

    return { chapters, segments };
  }

  /**
   * Découpe un long paragraphe par phrases (~400 chars max par segment)
   */
  static splitParagraphToSubSegments(paragraphText, maxChars = 400) {
    if (paragraphText.length <= maxChars) {
      return [paragraphText];
    }

    // Séparation par ponctuation de fin de phrase
    const sentences = paragraphText.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [paragraphText];
    const chunks = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > maxChars && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += sentence;
      }
    }

    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }
}

module.exports = TextSegmenter;
