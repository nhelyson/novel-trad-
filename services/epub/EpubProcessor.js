const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const QuotaGuard = require('../optimization/QuotaGuard');
const PerformanceProfiler = require('../optimization/PerformanceProfiler');
const InMemoryJobStore = require('../storage/InMemoryJobStore');

class EpubProcessor {
  /**
   * Helper de normalisation de chemin pour la recherche de fichiers dans JSZip
   */
  static getZipFile(zip, filePath) {
    if (!filePath) return null;
    let cleanPath = decodeURIComponent(filePath).replace(/\\/g, '/').replace(/^\.\//, '');
    let file = zip.file(cleanPath);
    if (file) return file;

    // Recherche insensible à la casse si le nom exact est légèrement différent
    const lowerPath = cleanPath.toLowerCase();
    for (const relativePath of Object.keys(zip.files)) {
      if (relativePath.toLowerCase() === lowerPath) {
        return zip.files[relativePath];
      }
    }
    return null;
  }

  /**
   * Nettoie le code XHTML en remplaçant les entités HTML non-XML par leur équivalent UTF-8
   * afin que le parseur XML @xmldom/xmldom ne plante pas sur &nbsp;, &rsquo;, &ldquo;, &mdash;, etc.
   */
  static preprocessXhtmlEntities(htmlText) {
    if (!htmlText) return '';
    return htmlText
      .replace(/&nbsp;/g, '&#160;')
      .replace(/&rsquo;/g, '’')
      .replace(/&lsquo;/g, '‘')
      .replace(/&ldquo;/g, '“')
      .replace(/&rdquo;/g, '”')
      .replace(/&mdash;/g, '—')
      .replace(/&ndash;/g, '–')
      .replace(/&hellip;/g, '…')
      .replace(/&copy;/g, '©')
      .replace(/&reg;/g, '®');
  }

  /**
   * Extrait les métadonnées et le nombre de caractères d'un fichier EPUB
   */
  static async analyze(epubBuffer, filename = 'document.epub') {
    const profiler = new PerformanceProfiler('epub_analyze');
    const zip = await JSZip.loadAsync(epubBuffer);
    
    // 1. Trouver le chemin du fichier OPF via META-INF/container.xml
    const containerFile = this.getZipFile(zip, 'META-INF/container.xml');
    if (!containerFile) {
      throw new Error("Fichier EPUB invalide : 'META-INF/container.xml' est introuvable.");
    }
    
    const containerXml = await containerFile.async('text');
    const containerDoc = new DOMParser({ onError: () => {} }).parseFromString(containerXml, 'text/xml');
    const rootfileEl = containerDoc.getElementsByTagName('rootfile')[0];
    if (!rootfileEl) {
      throw new Error("Fichier EPUB invalide : élément 'rootfile' introuvable dans container.xml.");
    }
    
    const opfPath = rootfileEl.getAttribute('full-path');
    const opfFile = this.getZipFile(zip, opfPath);
    if (!opfFile) {
      throw new Error(`Fichier OPF introuvable au chemin : ${opfPath}`);
    }

    const opfXml = await opfFile.async('text');
    const opfDoc = new DOMParser({ onError: () => {} }).parseFromString(opfXml, 'text/xml');
    
    // 2. Extraire la liste des chapitres du Manifest & Spine
    const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) : '';
    const manifestItems = {};
    const itemEls = opfDoc.getElementsByTagName('item');
    for (let i = 0; i < itemEls.length; i++) {
      const id = itemEls[i].getAttribute('id');
      const href = itemEls[i].getAttribute('href');
      const mediaType = itemEls[i].getAttribute('media-type');
      manifestItems[id] = { href, mediaType };
    }

    const spineItemrefEls = opfDoc.getElementsByTagName('itemref');
    const chapterPaths = [];
    for (let i = 0; i < spineItemrefEls.length; i++) {
      const idref = spineItemrefEls[i].getAttribute('idref');
      if (manifestItems[idref]) {
        const rawHref = manifestItems[idref].href;
        const fullHref = opfDir ? `${opfDir}/${rawHref}` : rawHref;
        chapterPaths.push(fullHref);
      }
    }

    // 3. Compter les caractères réels dans tous les nœuds texte XHTML
    let totalCharacters = 0;
    let totalTextBlocks = 0;

    for (const chPath of chapterPaths) {
      const htmlFile = this.getZipFile(zip, chPath);
      if (!htmlFile) continue;

      const rawHtml = await htmlFile.async('text');
      const cleanHtml = this.preprocessXhtmlEntities(rawHtml);
      const doc = new DOMParser({ onError: () => {} }).parseFromString(cleanHtml, 'text/html');
      
      const textNodes = this.extractTextNodes(doc.documentElement || doc);
      for (const node of textNodes) {
        const text = (node.nodeValue || '').trim();
        if (text.length > 0) {
          totalCharacters += text.length;
          totalTextBlocks++;
        }
      }
    }

    profiler.endStep('Analysis');

    return {
      filename,
      sizeBytes: epubBuffer.length,
      sizeMB: parseFloat((epubBuffer.length / (1024 * 1024)).toFixed(2)),
      chapterCount: chapterPaths.length,
      totalCharacters,
      totalTextBlocks,
      isEpub: true,
      opfPath,
      chapterPaths,
      profilerSummary: profiler.getSummary()
    };
  }

  /**
   * Traite la traduction d'un EPUB complet
   */
  static async processEpubDocument(docId, epubBuffer, filename, targetLang = 'FR', sourceLang = 'auto', apiKey = null, provider = null, onProgress = null) {
    const profiler = new PerformanceProfiler(docId);
    InMemoryJobStore.createJob(docId, filename, 'epub');

    // 1. Analyse préalable
    InMemoryJobStore.setPhase(docId, 'ANALYSIS', 'Analyse de la structure EPUB...');
    if (onProgress) onProgress('Analyse de la structure EPUB...', 2);
    
    const analysis = await this.analyze(epubBuffer, filename);
    profiler.endStep('1. Analyse EPUB');

    // 2. Vérification du Quota DeepL (Si provider === 'deepl')
    InMemoryJobStore.setPhase(docId, 'QUOTA_CHECK', 'Vérification du quota de traduction...');
    const quotaCheck = await QuotaGuard.checkPreTranslationQuota(
      provider ? provider.getName() : 'nllb',
      apiKey,
      analysis.totalCharacters,
      'epub'
    );

    if (!quotaCheck.canProceed) {
      InMemoryJobStore.failJob(docId, quotaCheck.message);
      throw new Error(quotaCheck.message);
    }
    profiler.endStep('2. Vérification Quota');

    // 3. Chargement de l'archive EPUB (JSZip)
    InMemoryJobStore.setPhase(docId, 'EXTRACTION', 'Extraction du contenu XHTML...');
    const zip = await JSZip.loadAsync(epubBuffer);
    const { chapterPaths } = analysis;
    const totalChapters = chapterPaths.length;
    profiler.endStep('3. Extraction XHTML');

    // 4. Extraction de tous les nœuds textuels et préparation des blocs
    InMemoryJobStore.setPhase(docId, 'SEGMENTATION', 'Découpage des nœuds textuels...');
    const chapterData = [];
    let grandTotalBlocks = 0;

    for (let cIdx = 0; cIdx < chapterPaths.length; cIdx++) {
      const chPath = chapterPaths[cIdx];
      const htmlFile = this.getZipFile(zip, chPath);
      if (!htmlFile) continue;

      const rawHtml = await htmlFile.async('text');
      const cleanHtml = this.preprocessXhtmlEntities(rawHtml);
      const parser = new DOMParser({ onError: () => {} });
      const doc = parser.parseFromString(cleanHtml, 'application/xhtml+xml');

      const textNodes = this.extractTextNodes(doc.documentElement || doc);
      const validNodes = textNodes.filter(n => n.nodeValue && n.nodeValue.trim().length > 0);

      grandTotalBlocks += validNodes.length;
      chapterData.push({
        chPath,
        doc,
        validNodes
      });
    }
    profiler.endStep('4. Découpage Blocs');

    // 5. Traduction Bloc par Bloc
    InMemoryJobStore.setPhase(docId, 'TRANSLATION', `Traduction de ${grandTotalBlocks} blocs textuels...`, {
      totalBlocks: grandTotalBlocks,
      totalChapters
    });

    let translatedBlocksCount = 0;
    const batchSize = 25;

    for (let cIdx = 0; cIdx < chapterData.length; cIdx++) {
      const { validNodes } = chapterData[cIdx];
      if (validNodes.length === 0) continue;

      for (let i = 0; i < validNodes.length; i += batchSize) {
        const nodeBatch = validNodes.slice(i, i + batchSize);
        const sourceTexts = nodeBatch.map(n => n.nodeValue.trim());

        let translatedTexts = sourceTexts;
        if (provider) {
          try {
            translatedTexts = await provider.translateBatch(sourceTexts, targetLang, sourceLang, apiKey);
          } catch (err) {
            console.error(`[EpubProcessor] ERREUR TRADUCTION SUR UN LOT : ${err.message}`);
            InMemoryJobStore.failJob(docId, err.message);
            throw new Error(`Erreur lors de la traduction par DeepL/Moteur : ${err.message}`);
          }
        }

        // Ré-injection dans les nœuds textuels DOM exacts sans modifier les balises HTML
        for (let j = 0; j < nodeBatch.length; j++) {
          const originalText = nodeBatch[j].nodeValue;
          const leadingSpace = (originalText.match(/^\s*/) || [''])[0];
          const trailingSpace = (originalText.match(/\s*$/) || [''])[0];
          const transText = translatedTexts[j] || sourceTexts[j];
          
          nodeBatch[j].nodeValue = `${leadingSpace}${transText}${trailingSpace}`;
        }

        translatedBlocksCount += nodeBatch.length;

        InMemoryJobStore.setTranslationProgress(
          docId,
          translatedBlocksCount,
          grandTotalBlocks,
          `Traduction : ${translatedBlocksCount} / ${grandTotalBlocks} blocs`
        );

        if (onProgress) {
          onProgress(`Traduction : ${translatedBlocksCount} / ${grandTotalBlocks} blocs`, Math.round((translatedBlocksCount / grandTotalBlocks) * 100));
        }
      }
    }
    profiler.endStep('5. Traduction Moteur');

    // 6. Reconstruction de l'EPUB (Chapitre par Chapitre)
    InMemoryJobStore.setPhase(docId, 'RECONSTRUCTION', 'Reconstruction du fichier EPUB final...', {
      totalChapters
    });

    const serializer = new XMLSerializer();

    for (let cIdx = 0; cIdx < chapterData.length; cIdx++) {
      const { chPath, doc } = chapterData[cIdx];
      const serializedXml = serializer.serializeToString(doc);
      
      // Remplacement du fichier dans l'archive JSZip
      zip.file(chPath, serializedXml);

      const chNum = cIdx + 1;
      InMemoryJobStore.setEpubReconstructionProgress(
        docId,
        chNum,
        totalChapters,
        `Reconstruction EPUB : chapitre ${chNum} / ${totalChapters}`
      );

      if (onProgress) {
        onProgress(`Reconstruction EPUB : chapitre ${chNum} / ${totalChapters}`, Math.round((chNum / totalChapters) * 100));
      }
    }
    profiler.endStep('6. Reconstruction EPUB');

    // 7. Génération de l'archive EPUB finale
    InMemoryJobStore.setPhase(docId, 'FINALIZATION', 'Packaging du document EPUB final...');
    const finalEpubBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });
    profiler.endStep('7. Génération Buffer Final');

    const summary = profiler.getSummary();
    profiler.printSummaryConsole();

    InMemoryJobStore.completeJob(docId, summary);
    return finalEpubBuffer;
  }

  /**
   * Traverse de façon récursive le DOM pour extraire les nœuds textuels légitimes.
   */
  static extractTextNodes(node, textNodes = []) {
    if (!node) return textNodes;
    const nodeType = node.nodeType;

    // Node.TEXT_NODE === 3
    if (nodeType === 3) {
      textNodes.push(node);
      return textNodes;
    }

    // Node.ELEMENT_NODE === 1
    if (nodeType === 1) {
      const tagName = (node.tagName || '').toLowerCase();
      if (['script', 'style', 'head', 'noscript', 'title', 'svg'].includes(tagName)) {
        return textNodes;
      }

      for (let child = node.firstChild; child; child = child.nextSibling) {
        this.extractTextNodes(child, textNodes);
      }
    }

    return textNodes;
  }
}

module.exports = EpubProcessor;
