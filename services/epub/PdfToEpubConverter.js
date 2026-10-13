const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('jszip');
const { PDFDocument, PDFName } = require('pdf-lib');
const { PDFParse } = require('pdf-parse');

class PdfToEpubConverter {
  /**
   * Dossier où sont stockés les EPUB convertis à partir de PDF
   */
  static getConvertedDir() {
    const dir = path.join(__dirname, '..', '..', 'uploads', 'converted_epubs');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Retourne le chemin du fichier EPUB converti pour une clé de volume donnée
   */
  static getConvertedEpubPath(cleanKey) {
    const base = path.basename(cleanKey).replace(/\.(pdf|epub)$/i, '');
    return path.join(PdfToEpubConverter.getConvertedDir(), `${base}.epub`);
  }

  /**
   * Vérifie si une version EPUB convertie existe déjà en cache
   */
  static isConverted(cleanKey) {
    const targetPath = PdfToEpubConverter.getConvertedEpubPath(cleanKey);
    return fs.existsSync(targetPath) && fs.statSync(targetPath).size > 1024;
  }

  /**
   * Récupère le chemin de l'EPUB converti, ou le convertit à la volée s'il n'existe pas encore
   */
  static async getOrConvertEpub(cleanKey, originalPdfPath, options = {}) {
    const targetPath = PdfToEpubConverter.getConvertedEpubPath(cleanKey);
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 1024) {
      return targetPath;
    }

    if (!fs.existsSync(originalPdfPath)) {
      throw new Error(`Fichier PDF source introuvable: ${originalPdfPath}`);
    }

    const title = options.title || cleanKey.replace(/[-_]+/g, ' ');
    await PdfToEpubConverter.convertPdfToEpub(originalPdfPath, targetPath, {
      title,
      cleanKey,
      ...options
    });

    return targetPath;
  }

  /**
   * Convertit un fichier PDF ou un Buffer PDF en archive EPUB valide
   */
  static async convertPdfToEpub(pdfPathOrBuffer, outputPath = null, options = {}) {
    const t0 = Date.now();
    let pdfBuf;
    if (Buffer.isBuffer(pdfPathOrBuffer)) {
      pdfBuf = pdfPathOrBuffer;
    } else {
      pdfBuf = await fs.promises.readFile(pdfPathOrBuffer);
    }

    const title = options.title || 'Light Novel';
    const author = options.author || 'Auteur Inconnu';
    const bookId = options.cleanKey || crypto.randomUUID();

    // 1. Extraction du texte et pagination via pdf-parse
    const parser = new PDFParse(new Uint8Array(pdfBuf));
    const parsed = await parser.getText();
    const totalPages = parsed.pages ? parsed.pages.length : 0;

    // 2. Extraction des illustrations & couvertures via pdf-lib
    const pdfDoc = await PDFDocument.load(pdfBuf, { ignoreEncryption: true });
    const pageImages = new Map();
    const allImages = [];

    const pageCount = pdfDoc.getPageCount();
    for (let i = 0; i < pageCount; i++) {
      try {
        const page = pdfDoc.getPage(i);
        const xObject = page.node.Resources()?.lookup(PDFName.of('XObject'));
        if (xObject && typeof xObject.entries === 'function') {
          let imgIdx = 0;
          for (const [key, ref] of xObject.entries()) {
            try {
              const obj = pdfDoc.context.lookup(ref);
              const subtype = obj?.dict?.lookup(PDFName.of('Subtype'))?.encodedName;
              if (subtype === '/Image') {
                const bytes = obj.getContents?.();
                if (bytes && bytes.length > 4096) {
                  let ext = 'jpg';
                  if (bytes[0] === 0x89 && bytes[1] === 0x50) ext = 'png';
                  const imgName = `img_p${i + 1}_${++imgIdx}.${ext}`;
                  const item = {
                    name: imgName,
                    buffer: Buffer.from(bytes),
                    ext,
                    pageIndex: i,
                    size: bytes.length
                  };
                  if (!pageImages.has(i)) pageImages.set(i, []);
                  pageImages.get(i).push(item);
                  allImages.push(item);
                }
              }
            } catch (errImg) {}
          }
        }
      } catch (errPage) {}
    }

    // 3. Détection intelligente des chapitres
    const chapterRegex = /^(Prologue|Chapitre\s+\d+|Épilogue|%pilogue|Epilogue|Interlude|Postface|Remerciements|Table\s+des\s+matières|Sommaire|Aperçu|Introduction|Act\s+\d+|Volume\s+\d+|Part\s+\d+|Partie\s+\d+)/i;
    const chapterStarts = [];

    (parsed.pages || []).forEach((p, idx) => {
      const lines = (p.text || '').split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length > 0) {
        const firstLine = lines[0];
        if (chapterRegex.test(firstLine)) {
          let cleanTitle = firstLine.replace(/%pilogue/i, 'Épilogue');
          if (cleanTitle.length > 100) cleanTitle = cleanTitle.substring(0, 100);
          chapterStarts.push({ pageIndex: idx, title: cleanTitle });
        } else if (lines.length > 1 && chapterRegex.test(lines[1])) {
          let cleanTitle = lines[1].replace(/%pilogue/i, 'Épilogue');
          if (cleanTitle.length > 100) cleanTitle = cleanTitle.substring(0, 100);
          chapterStarts.push({ pageIndex: idx, title: cleanTitle });
        }
      }
    });

    const sections = [];
    if (chapterStarts.length === 0) {
      const chunkSize = 25;
      for (let i = 0; i < totalPages; i += chunkSize) {
        const end = Math.min(i + chunkSize - 1, totalPages - 1);
        sections.push({
          id: `section_${sections.length}`,
          title: `Partie ${sections.length + 1} (Pages ${i + 1} - ${end + 1})`,
          startPageIndex: i,
          endPageIndex: end
        });
      }
    } else {
      if (chapterStarts[0].pageIndex > 0) {
        sections.push({
          id: 'section_0',
          title: 'Illustrations & Introduction',
          startPageIndex: 0,
          endPageIndex: chapterStarts[0].pageIndex - 1
        });
      }

      chapterStarts.forEach((cs, i) => {
        const nextStart = (i + 1 < chapterStarts.length) ? chapterStarts[i + 1].pageIndex : totalPages;
        sections.push({
          id: `section_${sections.length}`,
          title: cs.title,
          startPageIndex: cs.pageIndex,
          endPageIndex: nextStart - 1
        });
      });
    }

    // 4. Construction de l'archive EPUB (JSZip)
    const zip = new JSZip();

    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

    zip.file(
      'META-INF/container.xml',
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n' +
      '  <rootfiles>\n' +
      '    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n' +
      '  </rootfiles>\n' +
      '</container>'
    );

    const cssContent = `@charset "utf-8";
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  line-height: 1.8;
  margin: 4% 6%;
  color: inherit;
  font-size: 1.05rem;
}
h1, h2 {
  font-weight: 700;
  text-align: center;
  margin: 2.5rem 0 1.5rem;
  letter-spacing: -0.02em;
  color: inherit;
}
p {
  margin: 0 0 1.15em 0;
  text-align: justify;
  text-justify: inter-word;
  word-break: break-word;
}
.ln-illustration {
  text-align: center;
  margin: 2.2rem 0;
}
.ln-illustration img {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
}`;
    zip.file('OEBPS/styles/stylesheet.css', cssContent);

    allImages.forEach(img => {
      zip.file(`OEBPS/images/${img.name}`, img.buffer);
    });

    sections.forEach(sec => {
      let bodyHtml = `<header class="chapter-header"><h1>${escapeXml(sec.title)}</h1></header>\n`;

      for (let pIdx = sec.startPageIndex; pIdx <= sec.endPageIndex; pIdx++) {
        // Illustrations sur cette page
        if (pageImages.has(pIdx)) {
          pageImages.get(pIdx).forEach(img => {
            bodyHtml += `<div class="ln-illustration"><img src="../images/${img.name}" alt="Illustration page ${pIdx + 1}" /></div>\n`;
          });
        }

        const pageData = parsed.pages ? parsed.pages[pIdx] : null;
        const pageText = pageData ? pageData.text : '';
        if (pageText) {
          const paragraphs = reconstructParagraphs(pageText, sec.title);
          paragraphs.forEach(p => {
            if (p === sec.title) return;
            const isDialogue = /^[«—–"“]/.test(p);
            const cls = isDialogue ? ' class="dialogue"' : '';
            bodyHtml += `<p${cls}>${escapeXml(p)}</p>\n`;
          });
        }
      }

      const xhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${escapeXml(sec.title)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/stylesheet.css" />
</head>
<body>
  ${bodyHtml}
</body>
</html>`;
      zip.file(`OEBPS/text/${sec.id}.xhtml`, xhtml);
    });

    let manifestItems = '    <item id="css" href="styles/stylesheet.css" media-type="text/css"/>\n';
    manifestItems += '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n';
    manifestItems += '    <item id="nav" href="text/nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n';

    allImages.forEach((img, idx) => {
      const mime = img.ext === 'png' ? 'image/png' : 'image/jpeg';
      const isCover = (idx === 0) ? ' properties="cover-image"' : '';
      manifestItems += `    <item id="img_${idx}" href="images/${img.name}" media-type="${mime}"${isCover}/>\n`;
    });

    sections.forEach(sec => {
      manifestItems += `    <item id="${sec.id}" href="text/${sec.id}.xhtml" media-type="application/xhtml+xml"/>\n`;
    });

    let spineItems = '';
    sections.forEach(sec => {
      spineItems += `    <itemref idref="${sec.id}"/>\n`;
    });

    const opf = `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" unique-identifier="pub-id" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:identifier id="pub-id">urn:uuid:${bookId}</dc:identifier>
    <dc:language>fr</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
    ${allImages.length > 0 ? '<meta name="cover" content="img_0"/>' : ''}
  </metadata>
  <manifest>
${manifestItems}  </manifest>
  <spine toc="ncx">
${spineItems}  </spine>
</package>`;
    zip.file('OEBPS/content.opf', opf);

    let navPoints = '';
    sections.forEach((sec, idx) => {
      navPoints += `    <navPoint id="nav_${idx}" playOrder="${idx + 1}">
      <navLabel><text>${escapeXml(sec.title)}</text></navLabel>
      <content src="text/${sec.id}.xhtml"/>
    </navPoint>\n`;
    });
    const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${bookId}"/>
    <meta name="dtb:depth" content="1"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
${navPoints}  </navMap>
</ncx>`;
    zip.file('OEBPS/toc.ncx', ncx);

    let navList = '';
    sections.forEach(sec => {
      navList += `        <li><a href="${sec.id}.xhtml">${escapeXml(sec.title)}</a></li>\n`;
    });
    const navXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Sommaire</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Sommaire</h1>
    <ol>
${navList}    </ol>
  </nav>
</body>
</html>`;
    zip.file('OEBPS/text/nav.xhtml', navXhtml);

    const epubBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    if (outputPath) {
      const outDir = path.dirname(outputPath);
      if (!fs.existsSync(outDir)) {
        await fs.promises.mkdir(outDir, { recursive: true });
      }
      await fs.promises.writeFile(outputPath, epubBuffer);
    }

    console.log(`[PdfToEpubConverter] Conversion terminée en ${Date.now() - t0}ms (${(epubBuffer.length / (1024 * 1024)).toFixed(2)} Mo, ${sections.length} sections, ${allImages.length} images)`);
    return epubBuffer;
  }
}

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}


function reconstructParagraphs(rawPageText, chapterTitle) {
  if (!rawPageText) return [];

  let text = rawPageText.trim();
  if (chapterTitle && text.startsWith(chapterTitle)) {
    text = text.slice(chapterTitle.length).trim();
  }

  // Supprimer les numéros de page isolés en bas
  text = text.replace(/(^|\n)\s*\d{1,4}\s*(\n|$)/g, '\n');

  // Séparer les répliques de dialogue qui pourraient être collées
  text = text.replace(/»\s*«/g, '»\n\n«');
  text = text.replace(/»\s*([A-ZÀ-ÖØ-ß])/g, '»\n\n$1');
  text = text.replace(/([.!?…])\s*(«)/g, '$1\n\n$2');

  const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const paragraphs = [];
  let currentP = '';

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const isDialogue = /^[«—–"“-]/.test(line);

    if (isDialogue) {
      if (currentP) {
        paragraphs.push(currentP.trim());
        currentP = '';
      }
      currentP = line;
    } else {
      const prevEndsSentence = /[.!?…»”]$/.test(currentP);
      if (currentP && prevEndsSentence && (/^[A-ZÀ-ÖØ-ß]/.test(line) && line.length > 20 && !currentP.endsWith('...'))) {
        if (currentP.length > 100) {
          paragraphs.push(currentP.trim());
          currentP = line;
          continue;
        }
      }

      if (!currentP) {
        currentP = line;
      } else {
        if (currentP.endsWith('-') || currentP.endsWith('—')) {
          currentP = currentP.slice(0, -1) + line;
        } else {
          currentP += ' ' + line;
        }
      }
    }
  }

  if (currentP) {
    paragraphs.push(currentP.trim());
  }

  return paragraphs;
}

module.exports = PdfToEpubConverter;