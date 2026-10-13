const fs = require('fs');
const path = require('path');
const os = require('os');
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');
const PerformanceProfiler = require('../optimization/PerformanceProfiler');
const DiskJobStore = require('../storage/DiskJobStore');

class EpubToPdfConverter {
  /**
   * Localise le chemin de l'exécutable Microsoft Edge ou Chrome sur le système Windows
   */
  static getSystemBrowserExecutablePath() {
    const candidatePaths = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.CHROME_BIN,
      process.env.EDGE_BIN
    ].filter(Boolean);

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    throw new Error("Aucun navigateur compatible (Microsoft Edge ou Google Chrome) n'a été trouvé sur ce système pour effectuer la conversion PDF.");
  }

  /**
   * Helper de recherche de fichier dans l'archive JSZip
   */
  static getZipFile(zip, filePath) {
    if (!filePath) return null;
    let cleanPath = decodeURIComponent(filePath).replace(/\\/g, '/').replace(/^\.\//, '');
    let file = zip.file(cleanPath);
    if (file) return file;

    const lowerPath = cleanPath.toLowerCase();
    for (const relativePath of Object.keys(zip.files)) {
      if (relativePath.toLowerCase() === lowerPath) {
        return zip.files[relativePath];
      }
    }
    return null;
  }

  /**
   * Convertit un Buffer EPUB (déjà traduit) en document PDF
   */
  static async convertEpubToPdf(docId, epubBuffer, filename = 'document_traduit.epub', onProgress = null) {
    const profiler = new PerformanceProfiler(docId + '_pdf_conv');
    const tempDir = path.join(os.tmpdir(), `novel_trad_pdf_${docId}_${Date.now()}`);

    DiskJobStore.setPhase(docId, 'CONVERSION_PDF', 'Préparation de la conversion EPUB vers PDF...');
    if (onProgress) onProgress('Préparation de la conversion EPUB ➔ PDF...', 5);

    try {
      // 1. Décompression de l'archive EPUB dans un dossier temporaire
      fs.mkdirSync(tempDir, { recursive: true });
      const zip = await JSZip.loadAsync(epubBuffer);

      for (const [relativePath, fileObj] of Object.entries(zip.files)) {
        if (fileObj.dir) continue;
        const targetPath = path.join(tempDir, relativePath);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        const contentBuffer = await fileObj.async('nodebuffer');
        fs.writeFileSync(targetPath, contentBuffer);
      }
      profiler.endStep('1. Extraction Fichiers Temp');

      // 2. Analyse de container.xml et content.opf pour extraire les chapitres dans l'ordre
      DiskJobStore.setPhase(docId, 'CONVERSION_PDF', 'Analyse du Manifest & Spine EPUB...');
      const containerFile = this.getZipFile(zip, 'META-INF/container.xml');
      if (!containerFile) throw new Error("Fichier EPUB invalide : 'META-INF/container.xml' est introuvable.");

      const containerXml = await containerFile.async('text');
      const containerDoc = new DOMParser({ onError: () => {} }).parseFromString(containerXml, 'text/xml');
      const rootfileEl = containerDoc.getElementsByTagName('rootfile')[0];
      const opfPath = rootfileEl ? rootfileEl.getAttribute('full-path') : 'OEBPS/content.opf';

      const opfFile = this.getZipFile(zip, opfPath);
      if (!opfFile) throw new Error(`Fichier OPF introuvable au chemin : ${opfPath}`);

      const opfXml = await opfFile.async('text');
      const opfDoc = new DOMParser({ onError: () => {} }).parseFromString(opfXml, 'text/xml');

      const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) : '';
      const manifestItems = {};
      const itemEls = opfDoc.getElementsByTagName('item');
      for (let i = 0; i < itemEls.length; i++) {
        const id = itemEls[i].getAttribute('id');
        const href = itemEls[i].getAttribute('href');
        const mediaType = itemEls[i].getAttribute('media-type');
        manifestItems[id] = { href, mediaType };
      }

      const spineEls = opfDoc.getElementsByTagName('itemref');
      const chapterPaths = [];
      for (let i = 0; i < spineEls.length; i++) {
        const idref = spineEls[i].getAttribute('idref');
        if (manifestItems[idref]) {
          const rawHref = manifestItems[idref].href;
          const fullHref = opfDir ? `${opfDir}/${rawHref}` : rawHref;
          chapterPaths.push(fullHref);
        }
      }
      profiler.endStep('2. Spine EPUB');

      // 3. Assemblage du Document HTML Maître pour l'impression PDF
      DiskJobStore.setPhase(docId, 'CONVERSION_PDF', `Assemblage de ${chapterPaths.length} chapitres HTML...`, {
        totalChapters: chapterPaths.length
      });

      const masterHtmlParts = [];
      masterHtmlParts.push(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <style>
    @page {
      size: A4;
      margin: 20mm 15mm 20mm 15mm;
      @bottom-center {
        content: counter(page);
        font-family: sans-serif;
        font-size: 9pt;
        color: #6b7280;
      }
    }
    body {
      font-family: 'Inter', 'Georgia', 'Times New Roman', serif;
      font-size: 11.5pt;
      line-height: 1.65;
      color: #111827;
      margin: 0;
      padding: 0;
    }
    .epub-chapter {
      page-break-before: always;
      clear: both;
    }
    .epub-chapter:first-of-type {
      page-break-before: avoid;
    }
    h1, h2, h3, h4, h5, h6 {
      font-family: 'Outfit', 'Helvetica Neue', 'Arial', sans-serif;
      color: #1f2937;
      line-height: 1.3;
      page-break-after: avoid;
      break-after: avoid;
      margin-top: 1.5em;
      margin-bottom: 0.6em;
    }
    h1 { font-size: 20pt; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; text-align: center; }
    h2 { font-size: 16pt; }
    h3 { font-size: 13pt; }
    p {
      margin-top: 0;
      margin-bottom: 0.8em;
      text-align: justify;
      text-justify: inter-word;
    }
    img {
      max-width: 95%;
      max-height: 800px;
      height: auto;
      display: block;
      margin: 20px auto;
      object-fit: contain;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    blockquote {
      margin: 1.2em 0;
      padding-left: 15px;
      border-left: 3px solid #6366f1;
      color: #4b5563;
      font-style: italic;
    }
  </style>
</head>
<body>`);

      const totalCh = chapterPaths.length;
      for (let cIdx = 0; cIdx < totalCh; cIdx++) {
        const chPath = chapterPaths[cIdx];
        const fullAbsPath = path.join(tempDir, chPath);

        if (!fs.existsSync(fullAbsPath)) continue;

        let chHtml = fs.readFileSync(fullAbsPath, 'utf-8');
        // Remplacer les entités HTML et extraire le contenu dans <body>
        const bodyMatch = chHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        let innerBody = bodyMatch ? bodyMatch[1] : chHtml;

        // Corriger le chemin des images vers l'URL file:/// du dossier temporaire
        const chDir = path.dirname(fullAbsPath);
        innerBody = innerBody.replace(/(<img[^>]+src=["'])([^"']+)["']/gi, (match, prefix, src) => {
          if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) {
            return match;
          }
          const absImgPath = path.resolve(chDir, src);
          const fileUrl = 'file:///' + absImgPath.replace(/\\/g, '/');
          return `${prefix}${fileUrl}"`;
        });

        const chNum = cIdx + 1;
        masterHtmlParts.push(`<div class="epub-chapter" id="chapter_${chNum}">${innerBody}</div>`);

        DiskJobStore.setEpubReconstructionProgress(
          docId,
          chNum,
          totalCh,
          `Génération PDF : chapitre ${chNum} / ${totalCh}`
        );

        if (onProgress) {
          onProgress(`Génération PDF : chapitre ${chNum} / ${totalCh}`, Math.round(10 + (chNum / totalCh) * 70));
        }
      }

      masterHtmlParts.push(`</body></html>`);
      const masterHtml = masterHtmlParts.join('\n');
      const masterHtmlPath = path.join(tempDir, 'master_print.html');
      fs.writeFileSync(masterHtmlPath, masterHtml, 'utf-8');
      profiler.endStep('3. Assemblage HTML');

      // 4. Rendu PDF via Puppeteer Core & Edge/Chrome Local
      DiskJobStore.setPhase(docId, 'CONVERSION_PDF', 'Lancement du moteur de rendu PDF local...');
      if (onProgress) onProgress('Rendu du document PDF via le navigateur local...', 85);

      const puppeteerModule = await import('puppeteer-core');
      const puppeteer = puppeteerModule.default || puppeteerModule;
      const executablePath = this.getSystemBrowserExecutablePath();
      const browser = await puppeteer.launch({
        executablePath,
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--allow-file-access-from-files'
        ]
      });

      let pdfBuffer = null;
      try {
        const page = await browser.newPage();
        const masterFileUrl = 'file:///' + masterHtmlPath.replace(/\\/g, '/');
        await page.goto(masterFileUrl, { waitUntil: 'networkidle0', timeout: 60000 });

        pdfBuffer = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
          displayHeaderFooter: true,
          headerTemplate: '<div></div>',
          footerTemplate: '<div style="font-size: 8pt; font-family: sans-serif; color: #9ca3af; width: 100%; text-align: center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
        });
      } finally {
        await browser.close();
      }

      profiler.endStep('4. Rendu PDF Puppeteer');

      const summary = profiler.getSummary();
      profiler.printSummaryConsole();

      DiskJobStore.setPhase(docId, 'FINALIZATION', 'Conversion PDF terminée avec succès !');
      if (onProgress) onProgress('Conversion PDF terminée avec succès !', 100);

      return Buffer.from(pdfBuffer);

    } finally {
      // 5. Nettoyage éphémère garanti du dossier temporaire
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch (cleanErr) {
        console.warn(`[EpubToPdfConverter] Avertissement nettoyage dossier temp (${tempDir}): ${cleanErr.message}`);
      }
    }
  }
}

module.exports = EpubToPdfConverter;

