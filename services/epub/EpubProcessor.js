const path = require('path');
const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const QuotaGuard = require('../optimization/QuotaGuard');
const PerformanceProfiler = require('../optimization/PerformanceProfiler');
const TranslationMemory = require('../optimization/TranslationMemory');
const DiskJobStore = require('../storage/DiskJobStore');

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
    DiskJobStore.createJob(docId, filename, 'epub');

    // 1. Analyse préalable
    DiskJobStore.setPhase(docId, 'ANALYSIS', 'Analyse de la structure EPUB...');
    if (onProgress) onProgress('Analyse de la structure EPUB...', 2);
    
    const analysis = await this.analyze(epubBuffer, filename);
    profiler.endStep('1. Analyse EPUB');

    // 2. Vérification du Quota DeepL (Si provider === 'deepl')
    DiskJobStore.setPhase(docId, 'QUOTA_CHECK', 'Vérification du quota de traduction...');
    const quotaCheck = await QuotaGuard.checkPreTranslationQuota(
      provider ? provider.getName() : 'gemini',
      apiKey,
      analysis.totalCharacters,
      'epub'
    );

    if (!quotaCheck.canProceed) {
      DiskJobStore.failJob(docId, quotaCheck.message);
      throw new Error(quotaCheck.message);
    }
    profiler.endStep('2. Vérification Quota');

    // 3. Chargement de l'archive EPUB (JSZip)
    DiskJobStore.setPhase(docId, 'EXTRACTION', 'Extraction du contenu XHTML...');
    const zip = await JSZip.loadAsync(epubBuffer);
    const { chapterPaths } = analysis;
    const totalChapters = chapterPaths.length;
    profiler.endStep('3. Extraction XHTML');

    // 4. Extraction de tous les nœuds textuels et préparation des blocs
    DiskJobStore.setPhase(docId, 'SEGMENTATION', 'Découpage des nœuds textuels...');
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
    DiskJobStore.setPhase(docId, 'TRANSLATION', `Traduction de ${grandTotalBlocks} blocs textuels...`, {
      totalBlocks: grandTotalBlocks,
      totalChapters
    });

    let translatedBlocksCount = 0;
    const isGemini = provider && (provider.getName() || '').toLowerCase().includes('gemini');
    const batchSize = isGemini ? 75 : 25;

    for (let cIdx = 0; cIdx < chapterData.length; cIdx++) {
      const { validNodes } = chapterData[cIdx];
      if (validNodes.length === 0) continue;

      for (let i = 0; i < validNodes.length; i += batchSize) {
        const currentJobState = DiskJobStore.getJob(docId);
        const activeApiKey = currentJobState?.apiKey || apiKey;

        const nodeBatch = validNodes.slice(i, i + batchSize);
        const sourceTexts = nodeBatch.map(n => n.nodeValue.trim());
        const translatedTexts = new Array(sourceTexts.length);
        const toTranslateIndices = [];
        const toTranslateTexts = [];

        // 1. Recherche dans la mémoire éphémère (0 caractère API consommé sur le repêchage)
        for (let idx = 0; idx < sourceTexts.length; idx++) {
          const cached = await TranslationMemory.lookup(sourceTexts[idx], targetLang);
          if (cached) {
            translatedTexts[idx] = cached.translatedText;
          } else {
            toTranslateIndices.push(idx);
            toTranslateTexts.push(sourceTexts[idx]);
          }
        }

        // 2. Envoi uniquement des segments manquants à l'API
        if (toTranslateTexts.length > 0 && provider) {
          try {
            const batchResults = await provider.translateBatch(toTranslateTexts, targetLang, sourceLang, activeApiKey);
            for (let k = 0; k < toTranslateIndices.length; k++) {
              const originalIdx = toTranslateIndices[k];
              const transResult = batchResults[k] || toTranslateTexts[k];
              translatedTexts[originalIdx] = transResult;
              await TranslationMemory.save(docId, sourceTexts[originalIdx], sourceLang, targetLang, transResult, provider.getName());
            }
          } catch (err) {
            console.error(`[EpubProcessor] ERREUR TRADUCTION LOT : ${err.message}`);
            const isQuota = Boolean(err.isQuotaExceeded || err.message?.includes('Quota') || err.message?.includes('456'));
            if (isQuota) {
              console.warn(`[EpubProcessor] Quota clé atteint à ${translatedBlocksCount} / ${grandTotalBlocks} blocs. Pause pour relais...`);
              DiskJobStore.setWaitingForKey(
                docId,
                translatedBlocksCount,
                grandTotalBlocks,
                `Quota de la clé 1 atteint à ${translatedBlocksCount}/${grandTotalBlocks} blocs. Entrez la clé 2 pour poursuivre...`
              );
              
              const partialErr = new Error(`Quota de la clé 1 épuisé (${translatedBlocksCount} / ${grandTotalBlocks} blocs traduits). Saisissez la clé 2 pour continuer.`);
              partialErr.isQuotaExceeded = true;
              partialErr.isPartial = true;
              partialErr.currentBlock = translatedBlocksCount;
              partialErr.totalBlocks = grandTotalBlocks;
              throw partialErr;
            }
            const isAuth = Boolean(err.isAuthError || err.message?.includes('403') || err.message?.includes('invalide'));
            DiskJobStore.failJob(docId, err.message, isQuota, isAuth);
            throw new Error(`Erreur lors de la traduction par DeepL/Moteur : ${err.message}`);
          }
        }

        // 3. Ré-injection dans les nœuds textuels DOM exacts
        for (let j = 0; j < nodeBatch.length; j++) {
          const originalText = nodeBatch[j].nodeValue;
          const leadingSpace = (originalText.match(/^\s*/) || [''])[0];
          const trailingSpace = (originalText.match(/\s*$/) || [''])[0];
          const transText = translatedTexts[j] || sourceTexts[j];
          
          nodeBatch[j].nodeValue = `${leadingSpace}${transText}${trailingSpace}`;
        }

        translatedBlocksCount += nodeBatch.length;

        DiskJobStore.setTranslationProgress(
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

    // 5b. Traduction des planches Manga (si le moteur le supporte, ex: Gemini Vision)
    if (provider && typeof provider.translateMangaPage === 'function') {
      try {
        const MangaPipeline = require('../manga/MangaPipeline');
        const processedImages = new Set();
        const currentJob = DiskJobStore.getJob(docId);
        const mangaApiKey = currentJob?.apiKey || apiKey;

        for (let cIdx = 0; cIdx < chapterData.length; cIdx++) {
          const { chPath, doc, validNodes } = chapterData[cIdx];
          const imgEls = doc.getElementsByTagName('img');
          const svgImgEls = doc.getElementsByTagName('image');
          const allImgEls = [...Array.from(imgEls || []), ...Array.from(svgImgEls || [])];

          // Détection d'une page principalement graphique (peu de texte DOM mais avec illustration)
          if (allImgEls.length > 0 && validNodes.length <= 8) {
            for (const el of allImgEls) {
              const src = el.getAttribute('src') || el.getAttribute('xlink:href') || el.getAttribute('href');
              if (!src) continue;
              const cleanSrc = src.split('#')[0].split('?')[0];
              const imgFullPath = path.posix.normalize(path.posix.join(path.posix.dirname(chPath), cleanSrc));

              if (processedImages.has(imgFullPath)) continue;
              processedImages.add(imgFullPath);

              const imgFile = this.getZipFile(zip, imgFullPath);
              if (imgFile) {
                const origBuffer = await imgFile.async('nodebuffer');
                if (origBuffer && origBuffer.length > 15000) {
                  DiskJobStore.updateJobProgress(docId, {
                    statusMessage: `Analyse & lettrage Manga : ${path.posix.basename(imgFullPath)}...`
                  });
                  const translatedImgBuffer = await MangaPipeline.processMangaPage(
                    origBuffer,
                    sourceLang,
                    targetLang,
                    mangaApiKey
                  );
                  if (translatedImgBuffer && translatedImgBuffer.length > 0 && translatedImgBuffer !== origBuffer) {
                    zip.file(imgFile.name, translatedImgBuffer);
                  }
                }
              }
            }
          }
        }
      } catch (errManga) {
        console.warn('[EpubProcessor] Avertissement non-bloquant analyse manga vision:', errManga.message);
      }
    }

    // 6. Reconstruction de l'EPUB (Chapitre par Chapitre)
    DiskJobStore.setPhase(docId, 'RECONSTRUCTION', 'Reconstruction du fichier EPUB final...', {
      totalChapters
    });

    const serializer = new XMLSerializer();

    for (let cIdx = 0; cIdx < chapterData.length; cIdx++) {
      const { chPath, doc } = chapterData[cIdx];
      const serializedXml = serializer.serializeToString(doc);
      
      // Remplacement du fichier dans l'archive JSZip
      zip.file(chPath, serializedXml);

      const chNum = cIdx + 1;
      DiskJobStore.setEpubReconstructionProgress(
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
    DiskJobStore.setPhase(docId, 'FINALIZATION', 'Packaging du document EPUB final...');
    const finalEpubBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });
    profiler.endStep('7. Génération Buffer Final');

    const summary = profiler.getSummary();
    profiler.printSummaryConsole();

    DiskJobStore.completeJob(docId, summary);
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

  /**
   * Extrait la couverture (cover image) d'un fichier EPUB
   * @param {Buffer} epubBuffer
   * @returns {Promise<{ buffer: Buffer, mediaType: string, path: string } | null>}
   */
    static async extractCover(epubBuffer) {
    if (!epubBuffer || epubBuffer.length === 0) return null;
    try {
      const zip = await JSZip.loadAsync(epubBuffer);

      // Helper pour trouver un fichier dans le zip (insensible à la casse et tolérant aux slashes)
      const findZipFile = (targetPath) => {
        if (!targetPath) return null;
        if (zip.file(targetPath)) return zip.file(targetPath);
        const clean = targetPath.toLowerCase().replace(/^\/+|\/+$/g, '');
        return Object.values(zip.files).find(f => {
          const fn = f.name.toLowerCase().replace(/^\/+|\/+$/g, '');
          return fn === clean;
        }) || null;
      };

      // 1. Trouver container.xml -> chemin OPF
      let opfPath = 'content.opf';
      const containerFile = findZipFile('META-INF/container.xml');
      if (containerFile) {
        const containerXml = await containerFile.async('text');
        const cDoc = new DOMParser({ onError: () => {} }).parseFromString(containerXml, 'text/xml');
        const rootfile = cDoc.getElementsByTagName('rootfile')[0];
        if (rootfile && rootfile.getAttribute('full-path')) {
          opfPath = rootfile.getAttribute('full-path');
        }
      }

      const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) : '';
      const opfFile = findZipFile(opfPath);

      // Collecte multi-critères des candidats pour la couverture
      const candidates = [];

      if (opfFile) {
        const opfXml = await opfFile.async('text');
        const opfDoc = new DOMParser({ onError: () => {} }).parseFromString(opfXml, 'text/xml');

        const items = {};
        const itemEls = opfDoc.getElementsByTagName('item');
        for (let i = 0; i < itemEls.length; i++) {
          const el = itemEls[i];
          const id = el.getAttribute('id') || '';
          const href = el.getAttribute('href') || '';
          const mediaType = el.getAttribute('media-type') || '';
          const properties = el.getAttribute('properties') || '';
          items[id] = { href, mediaType, properties };

          // Priorité 1 : EPUB 3 properties="cover-image"
          if (properties.includes('cover-image')) {
            candidates.push({ href, priority: 1, mediaType });
          }
        }

        // Priorité 2 : EPUB 2 <meta name="cover" content="item_id"/>
        const metaEls = opfDoc.getElementsByTagName('meta');
        for (let i = 0; i < metaEls.length; i++) {
          if (metaEls[i].getAttribute('name') === 'cover') {
            const coverId = metaEls[i].getAttribute('content');
            if (coverId && items[coverId]) {
              candidates.push({ href: items[coverId].href, priority: 2, mediaType: items[coverId].mediaType });
            }
          }
        }

        // Priorité 3 & 4 : Items manifest contenant "cover", "front" ou "title"
        for (const id of Object.keys(items)) {
          const it = items[id];
          if (it.mediaType.startsWith('image/')) {
            if (/cover/i.test(id) || /cover/i.test(it.href)) {
              candidates.push({ href: it.href, priority: 3, mediaType: it.mediaType });
            } else if (/front/i.test(id) || /front/i.test(it.href) || /title/i.test(it.href)) {
              candidates.push({ href: it.href, priority: 4, mediaType: it.mediaType });
            }
          }
        }
      }

      // Priorité 5 : Fichiers image du ZIP contenant cover/front/titlepage
      const zipImgNames = Object.keys(zip.files).filter(name => {
        const l = name.toLowerCase();
        return (l.endsWith('.jpg') || l.endsWith('.jpeg') || l.endsWith('.png') || l.endsWith('.webp')) && !zip.files[name].dir;
      });

      for (const name of zipImgNames) {
        const l = name.toLowerCase();
        if (l.includes('cover')) {
          candidates.push({ href: name, priority: 5 });
        } else if (l.includes('front') || l.includes('titlepage')) {
          candidates.push({ href: name, priority: 6 });
        }
      }

      // Priorité 7 : Premier fichier image quelconque dans l'EPUB
      if (zipImgNames.length > 0) {
        candidates.push({ href: zipImgNames[0], priority: 7 });
      }

      // Trier les candidats par priorité croissante
      candidates.sort((a, b) => a.priority - b.priority);

      // Helper pour résoudre le vrai fichier dans le zip (essaie chemin relatif OPF, brut, et basename)
      const resolveFileInZip = (rawHref) => {
        if (!rawHref) return null;
        // 1. Essai brut
        let f = findZipFile(rawHref);
        if (f && !f.dir) return f;

        // 2. Essai avec opfDir
        if (opfDir) {
          const full = (opfDir + '/' + rawHref).replace(/\/+/g, '/');
          f = findZipFile(full);
          if (f && !f.dir) return f;
        }

        // 3. Essai par nom de base (ex: Cover1.png)
        const baseName = path.basename(rawHref).toLowerCase();
        return Object.values(zip.files).find(entry => {
          if (entry.dir) return false;
          const en = entry.name.toLowerCase();
          return en === baseName || en.endsWith('/' + baseName);
        }) || null;
      };

      // Parcourir les candidats jusqu'à trouver le premier fichier réel existant
      for (const cand of candidates) {
        const zipEntry = resolveFileInZip(cand.href);
        if (zipEntry) {
          const buffer = await zipEntry.async('nodebuffer');
          if (buffer && buffer.length > 500) {
            let mediaType = cand.mediaType || 'image/jpeg';
            const lower = zipEntry.name.toLowerCase();
            if (lower.endsWith('.png')) mediaType = 'image/png';
            else if (lower.endsWith('.webp')) mediaType = 'image/webp';
            else if (lower.endsWith('.gif')) mediaType = 'image/gif';
            else if (lower.endsWith('.svg')) mediaType = 'image/svg+xml';
            else mediaType = 'image/jpeg';

            return { buffer, mediaType, path: zipEntry.name };
          }
        }
      }

      return null;
    } catch (e) {
      console.warn('[EpubProcessor.extractCover] Erreur:', e.message);
      return null;
    }
  }
}

module.exports = EpubProcessor;
