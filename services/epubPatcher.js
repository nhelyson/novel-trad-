const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

/**
 * Service de correction sécurisée des fichiers EPUB (in-place avec backup .bak)
 */
class EpubPatcher {
  /**
   * Échappe une chaîne pour utilisation dans un RegExp
   */
  static escapeRegExp(str) {
    return (str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Construit un regex tolérant pour retrouver une phrase dans du code XHTML brut
   */
  static buildXhtmlSearchRegex(rawPhrase) {
    const clean = (rawPhrase || '')
      .replace(/[\u200B\u200C\u200D\uFEFF\u00AD\u2060]/g, ' ')
      .replace(/[\u2018\u2019\u201B`ʼ]/g, "'")
      .replace(/[\u201C\u201D\u00AB\u00BB\u2039\u203A\u300C\u300D]/g, '"')
      .replace(/[\u3008\u3009<>[\](){}]/g, ' ')
      .replace(/[\u00A0\u202F\u2009\u2002\u2003\t\r\n]/g, ' ')
      .trim();

    const words = clean.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return null;

    const wordPatterns = words.map(w => {
      let p = EpubPatcher.escapeRegExp(w);
      p = p.replace(/'/g, "('|’|&rsquo;|&#39;|&#x27;)");
      p = p.replace(/"/g, '("|«|»|“|”|&laquo;|&raquo;|&quot;)');
      p = p.replace(/(œ|oe)/gi, "(œ|oe|&oelig;|&OElig;)");
      p = p.replace(/(æ|ae)/gi, "(æ|ae|&aelig;|&AElig;)");
      return p;
    });

    const separator = '(\\s|<[^>]+>|&nbsp;|&#160;|&#8239;|&shy;|&#173;)+';
    return new RegExp(wordPatterns.join(separator), 'gi');
  }

  /**
   * Vérifie si une sauvegarde (.bak) existe pour ce fichier
   */
  static hasBackup(fullPath) {
    if (!fullPath) return false;
    return fs.existsSync(fullPath + '.bak');
  }

  /**
   * Restaure la version originale (.bak) en écrasant la version modifiée
   */
  static async restoreBackup(fullPath) {
    if (!fullPath || !fs.existsSync(fullPath)) {
      throw new Error(`Fichier EPUB introuvable au chemin : ${fullPath}`);
    }

    const backupPath = fullPath + '.bak';
    if (!fs.existsSync(backupPath)) {
      throw new Error("Aucune sauvegarde originale (.bak) n'a été trouvée pour ce livre.");
    }

    // Copie inverse : du .bak vers le .epub actif
    fs.copyFileSync(backupPath, fullPath);
    console.log(`[EpubPatcher] ↺ Fichier original restauré avec succès : ${fullPath}`);

    return {
      success: true,
      message: "L'EPUB original a été restauré avec succès à partir de sa sauvegarde."
    };
  }

  /**
   * Corrige une phrase dans un fichier EPUB physique
   */
  static async patchFile(fullPath, originalText, correctedText, options = {}) {
    if (!fullPath || !fs.existsSync(fullPath)) {
      throw new Error(`Fichier EPUB introuvable au chemin : ${fullPath}`);
    }

    if (!originalText || !correctedText) {
      throw new Error("L'ancien texte et le nouveau texte sont requis.");
    }

    const cleanOrig = String(originalText).trim();
    const cleanSpaceOrig = cleanOrig.replace(/\s+/g, ' ');

    console.log(`[EpubPatcher] Recherche de la phrase : "${cleanOrig.substring(0, 60)}"`);
    console.log(`[EpubPatcher] Remplacement par : "${String(correctedText).substring(0, 60)}"`);

    // 1. Sauvegarde automatique master backup (.bak) avant toute écriture
    const backupPath = fullPath + '.bak';
    if (!fs.existsSync(backupPath)) {
      try {
        fs.copyFileSync(fullPath, backupPath);
        console.log(`[EpubPatcher] 🛡️ Sauvegarde de sécurité créée : ${backupPath}`);
      } catch (err) {
        console.warn(`[EpubPatcher] Impossible de créer la sauvegarde :`, err.message);
      }
    }

    // 2. Ouvrir l'archive EPUB avec JSZip
    const fileBuffer = fs.readFileSync(fullPath);
    const zip = await JSZip.loadAsync(fileBuffer);

    // 3. Lister tous les fichiers de contenu HTML/XHTML
    const allFiles = Object.keys(zip.files);
    const contentFiles = allFiles.filter(f => f.endsWith('.xhtml') || f.endsWith('.html') || f.endsWith('.htm'));

    if (contentFiles.length === 0) {
      throw new Error("Aucun fichier HTML/XHTML trouvé dans l'archive EPUB.");
    }

    // Prioriser le chapitre courant si chapterHref est fourni
    if (options.chapterHref) {
      const href = options.chapterHref.replace(/^\/+/, '');
      const idx = contentFiles.findIndex(f => f.endsWith(href) || href.endsWith(f));
      if (idx !== -1) {
        const [priority] = contentFiles.splice(idx, 1);
        contentFiles.unshift(priority);
      }
    }

    let modifiedCount = 0;
    const modifiedFiles = [];

    const xhtmlRegex = EpubPatcher.buildXhtmlSearchRegex(cleanOrig);

    for (const filename of contentFiles) {
      const fileEntry = zip.files[filename];
      if (fileEntry.dir) continue;

      let content = await fileEntry.async('text');
      let wasModified = false;

      // Niveau 1 : Correspondance exacte directe
      if (content.includes(cleanOrig)) {
        content = content.split(cleanOrig).join(correctedText);
        wasModified = true;
      } 
      // Niveau 2 : Correspondance avec espaces normalisés simples
      else if (content.includes(cleanSpaceOrig)) {
        content = content.split(cleanSpaceOrig).join(correctedText);
        wasModified = true;
      }
      // Niveau 3 & 4 : Correspondance tolérante au XHTML (balises, apostrophes, entités)
      else if (xhtmlRegex) {
        xhtmlRegex.lastIndex = 0;
        const match = xhtmlRegex.exec(content);
        if (match) {
          const matchedString = match[0];
          content = content.replace(matchedString, correctedText);
          wasModified = true;
        }
      }

      if (wasModified) {
        zip.file(filename, content);
        modifiedCount++;
        modifiedFiles.push(filename);
        console.log(`[EpubPatcher] ✅ Modifié dans le fichier : ${filename}`);
        break;
      }
    }

    if (modifiedCount === 0) {
      throw new Error("La phrase à corriger n'a pas été trouvée dans les chapitres de l'EPUB.");
    }

    // 4. Respect strict de la norme EPUB (mimetype non compressé au début)
    if (zip.file('mimetype')) {
      zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    }

    // 5. Générer le nouveau buffer EPUB
    const newBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    // 6. Écriture atomique sécurisée sur le disque
    fs.writeFileSync(fullPath, newBuffer);
    console.log(`[EpubPatcher] 🚀 Fichier EPUB enregistré avec succès : ${fullPath}`);

    return {
      success: true,
      modifiedFiles,
      backupPath
    };
  }
}

module.exports = EpubPatcher;
