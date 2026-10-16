const CommentService = require('./services/comments/CommentService');

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load .env.local if present (developer overrides), then fallback to .env
const envLocalPath = path.resolve(__dirname, '.env.local');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: true });
}
dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Services & Processors
const TranslationFactory = require('./services/translation/TranslationFactory');
const TranslationPipeline = require('./services/translation/TranslationPipeline');
const DocumentProcessor = require('./services/pdf/DocumentProcessor');
const EpubProcessor = require('./services/epub/EpubProcessor');
const EpubToPdfConverter = require('./services/epub/EpubToPdfConverter');
const DiskJobStore = require('./services/storage/DiskJobStore');
const QuotaGuard = require('./services/optimization/QuotaGuard');
const TextNormalizer = require('./services/library/TextNormalizer');
const AnilistClient = require('./services/api/AnilistClient');
const SynopsisTranslator = require('./services/api/SynopsisTranslator');
const AnilistMetadataTranslator = require('./services/api/AnilistMetadataTranslator');
const CatalogService = require('./services/catalog/CatalogService');

// ── SUPABASE CLIENT & ADMIN USER STORE ──────────────────────────────────────
let supabase = null;
let supabaseAdmin = null;
try {
  const { createClient } = require('@supabase/supabase-js');
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && anonKey) {
    supabase = createClient(supabaseUrl, anonKey);
    console.log('[Server] Client Supabase standard (public) initialisé.');
  }
  if (supabaseUrl && serviceKey) {
    supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    console.log('[Server] Client Supabase Admin (service_role) initialisé avec succès.');
  }
} catch (supaErr) {
  console.warn('[Server] Supabase non initialisé:', supaErr.message);
}

const USERS_ROLES_FILE = path.join(__dirname, 'data', 'users_roles.json');

function loadUsersRoles() {
  if (!fs.existsSync(USERS_ROLES_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(USERS_ROLES_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveUsersRoles(users) {
  try {
    const dir = path.dirname(USERS_ROLES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(USERS_ROLES_FILE, JSON.stringify(users, null, 2), 'utf8');
  } catch (e) {
    console.error('[UsersRoles] Error saving:', e.message);
  }
}

function recordUserActivity(userId, email, role, displayName, avatarUrl) {
  if (!userId) return;
  const users = loadUsersRoles();
  const existing = users.find(u => u.id === userId);
  const now = new Date().toISOString();
  if (existing) {
    if (email) existing.email = email;
    if (displayName) existing.display_name = displayName;
    if (avatarUrl) existing.avatar_url = avatarUrl;
    if (role) existing.role = role;
    existing.last_active = now;
  } else {
    users.push({
      id: userId,
      email: email || '',
      display_name: displayName || (email ? email.split('@')[0] : 'Utilisateur'),
      role: role || 'USER',
      created_at: now,
      last_active: now
    });
  }
  saveUsersRoles(users);
}

let LibraryWatcher = null;
try {
  LibraryWatcher = require('./services/library/LibraryWatcher');
  if (LibraryWatcher && LibraryWatcher.setAnilistTranslator) {
    LibraryWatcher.setAnilistTranslator(AnilistMetadataTranslator);
  }
} catch (e) {
  console.warn('[Server] LibraryWatcher non chargé:', e.message);
}

const app = express();
app.set('trust proxy', 1);

// ── LEVIER 1 : HTTP COMPRESSION (GZIP/DEFLATE) ──
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));
// ── SMART WEBP COVER THUMBNAILS (Ultra-Fast 25-35 Ko for Slow/Mobile Networks) ──
const coversCacheDir = path.join(__dirname, 'uploads', 'cache', 'covers');
if (!fs.existsSync(coversCacheDir)) {
  fs.mkdirSync(coversCacheDir, { recursive: true });
}

app.get('/uploads/covers/:filename', async (req, res, next) => {
  try {
    const filename = path.basename(req.params.filename);
    const origPath = path.join(__dirname, 'uploads', 'covers', filename);

    if (!fs.existsSync(origPath)) return next();

    // Si le client demande expressément l'original non compressé
    if (req.query.original === 'true') return next();

    const targetWidth = parseInt(req.query.w, 10) || 360;
    const cleanBase = filename.replace(/\.[^.]+$/, '');
    const cachedThumbPath = path.join(coversCacheDir, `${targetWidth}_${cleanBase}.webp`);

    // 1. Cache HIT : Envoi ultra-rapide (<1ms)
    if (fs.existsSync(cachedThumbPath)) {
      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return fs.createReadStream(cachedThumbPath).pipe(res);
    }

    // 2. Cache MISS : Génération à la volée via Sharp
    const sharpInstance = typeof sharp === 'function' ? sharp : require('sharp');
    const origBuf = await fs.promises.readFile(origPath);
    const thumbBuf = await sharpInstance(origBuf)
      .resize({ width: targetWidth, withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 })
      .toBuffer();

    fs.promises.writeFile(cachedThumbPath, thumbBuf).catch(() => {});

    res.writeHead(200, {
      'Content-Type': 'image/webp',
      'Content-Length': thumbBuf.length,
      'Cache-Control': 'public, max-age=31536000, immutable'
    });
    return res.end(thumbBuf);
  } catch (err) {
    console.warn('[CoverThumb] Fallback to static:', err.message);
    next();
  }
});


// ── LEVIER 2 : REMOTE WEBP COVER PROXY & CACHE (AniList, Kitsu, MangaDex) ──
const remoteCoversCacheDir = path.join(__dirname, 'uploads', 'cache', 'remote');
if (!fs.existsSync(remoteCoversCacheDir)) {
  fs.mkdirSync(remoteCoversCacheDir, { recursive: true });
}

const ALLOWED_COVER_HOSTS = [
  's4.anilist.co',
  'media.kitsu.app',
  'media.kitsu.io',
  'uploads.mangadex.org',
  'cdn.myanimelist.net'
];

function isAllowedCoverUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_COVER_HOSTS.some(h => host === h || host.endsWith('.' + h));
  } catch(e) {
    return false;
  }
}

app.get('/api/cover-proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('URL de couverture requise');
  }

  // 1. Validation de securite Anti-SSRF
  if (!isAllowedCoverUrl(targetUrl)) {
    return res.redirect(targetUrl);
  }

  const targetWidth = Math.min(800, Math.max(100, parseInt(req.query.w, 10) || 360));
  const crypto = require('crypto');
  const cacheKey = crypto.createHash('md5').update(`${targetWidth}_${targetUrl}`).digest('hex');
  const cachedPath = path.join(remoteCoversCacheDir, `${cacheKey}.webp`);

  // 2. Cache HIT : Envoi immediat en stream
  if (fs.existsSync(cachedPath)) {
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return fs.createReadStream(cachedPath).pipe(res);
  }

  // 3. Cache MISS : Telechargement et conversion WebP Sharp
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout

    const remoteRes = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NovelTrad-Bot/1.0',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });
    clearTimeout(timeoutId);

    if (!remoteRes.ok) {
      console.warn(`[CoverProxy] Erreur distante ${remoteRes.status} pour: ${targetUrl}`);
      return res.redirect(targetUrl);
    }

    const arrayBuffer = await remoteRes.arrayBuffer();
    const imgBuffer = Buffer.from(arrayBuffer);

    const sharpInstance = typeof sharp === 'function' ? sharp : require('sharp');
    const thumbBuf = await sharpInstance(imgBuffer)
      .resize({ width: targetWidth, withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 })
      .toBuffer();

    fs.promises.writeFile(cachedPath, thumbBuf).catch(() => {});

    res.writeHead(200, {
      'Content-Type': 'image/webp',
      'Content-Length': thumbBuf.length,
      'Cache-Control': 'public, max-age=31536000, immutable'
    });
    return res.end(thumbBuf);
  } catch (err) {
    console.warn("[CoverProxy] Fallback redirect vers URL d'origine:", err.message);
    return res.redirect(targetUrl);
  }
});

app.use('/uploads/covers', express.static(path.join(__dirname, 'uploads', 'covers')));
app.use('/uploads/volumes', express.static(path.join(__dirname, 'uploads', 'volumes')));

// ── VOLUME FILE STREAMING ENDPOINT (Anti-IDM Interception & ngrok/Mobile Compatible) ──
app.get('/api/volume-stream/:fileKey', (req, res) => {
    try {
        let key = req.params.fileKey;
        if (!key) return res.status(400).send('Clé de fichier requise');
        
        // Anti path traversal
        key = path.basename(key);
        
        const fullPath = resolveVolumePath(key);
        if (!fullPath || !fs.existsSync(fullPath)) {
            return res.status(404).json({ success: false, error: 'Volume introuvable sur le serveur.' });
        }

        const stat = fs.statSync(fullPath);
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

            if (start >= stat.size || end >= stat.size) {
                res.status(416).setHeader('Content-Range', `bytes */${stat.size}`);
                return res.end();
            }

            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(fullPath, { start, end });
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${stat.size}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': 'application/octet-stream',
                'Cache-Control': 'public, max-age=31536000, immutable',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Range, ngrok-skip-browser-warning, Accept, *',
                'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges'
            });
            file.pipe(res);
        } else {
            const isDownload = req.query.download === '1' || req.query.dl === '1';
            const headers = {
                'Content-Type': 'application/octet-stream',
                'Content-Length': stat.size,
                'Accept-Ranges': 'bytes',
                'Cache-Control': isDownload ? 'no-cache' : 'public, max-age=31536000, immutable',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Range, ngrok-skip-browser-warning, Accept, *',
                'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges'
            };
            if (isDownload) {
                const filename = path.basename(fullPath);
                headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(filename)}"`;
            }
            res.writeHead(200, headers);
            fs.createReadStream(fullPath).pipe(res);
        }
    } catch(err) {
        console.error('[VolumeStream] Error:', err.message);
        if (!res.headersSent) res.status(500).send('Erreur lors de la lecture du volume');
    }
});


// ── EPUB VOLUME ON-DEMAND CHAPTER STREAMING (Ultra-Fast 30 Ko Webnovel Mode) ──
// ── SMART VOLUME RESOLVER (Exact, Prefix & Catalog DB lookup) ──
function resolveVolumePath(fileKey) {
  if (!fileKey) return null;

  // 1. Livres de la Bibliothèque Locale & Dossiers Externes (ID encodé en base64)
  if (fileKey.startsWith('local_') || fileKey.startsWith('external_')) {
    try {
      const b64 = fileKey.replace(/^(local_|external_)/, '');
      const decodedPath = Buffer.from(b64, 'base64').toString('utf8');
      if (fs.existsSync(decodedPath)) return decodedPath;
    } catch(e) {}
  }
  const cleanKey = path.basename(fileKey).replace(/\.(epub|pdf)$/i, '');
  const volumesDir = path.join(__dirname, 'uploads', 'volumes');

  const convertedDir = path.join(__dirname, 'uploads', 'converted_epubs');

  // 1. Direct match with .epub, converted .epub, or .pdf or raw
  let p = path.join(volumesDir, cleanKey);
  if (fs.existsSync(p + '.epub')) return p + '.epub';
  let pConv = path.join(convertedDir, cleanKey + '.epub');
  if (fs.existsSync(pConv)) return pConv;
  if (fs.existsSync(p + '.pdf')) return p + '.pdf';
  if (fs.existsSync(p)) return p;

  // 2. Prefix match in uploads/volumes (e.g. series_vol_3 matches series_vol_3_1789639729947.epub)
  try {
    const files = fs.readdirSync(volumesDir);
    const matched = files.find(f => {
      const base = f.replace(/\.(epub|pdf)$/i, '');
      return base === cleanKey || base.startsWith(cleanKey + '_');
    });
    if (matched) return path.join(volumesDir, matched);
  } catch(e) {}

  // 3. Catalog DB lookup
  try {
    const catPath = path.join(__dirname, 'data', 'catalog_db.json');
    if (fs.existsSync(catPath)) {
      const cat = JSON.parse(fs.readFileSync(catPath, 'utf8'));
      for (const s of (cat.series || [])) {
        for (const v of (s.volumes || [])) {
          if (v.id === cleanKey || v.id?.startsWith(cleanKey) || v.file_path?.includes(cleanKey)) {
            if (v.file_path) {
              const rel = v.file_path.replace(/^\/uploads\/volumes\//, '');
              const fp = path.join(volumesDir, path.basename(rel));
              if (fs.existsSync(fp)) return fp;
            }
          }
        }
      }
    }
  } catch(e) {}

  return null;
}

const volumeChaptersCache = new Map(); // fileKey -> { spineItems, opfDir, zip, fullPath, tocMap }

async function getEpubSpine(fileKey) {
  const cleanKey = (fileKey.startsWith('local_') || fileKey.startsWith('external_'))
    ? fileKey
    : path.basename(fileKey).replace(/\.(epub|pdf)$/i, '');
  if (volumeChaptersCache.has(cleanKey)) {
    return volumeChaptersCache.get(cleanKey);
  }

  let fullPath = resolveVolumePath(cleanKey);
  if (!fullPath || !fs.existsSync(fullPath)) return null;

  // Support transparent PDF -> EPUB fluide avec persistance de cache (0 latence)
  if (fullPath.toLowerCase().endsWith('.pdf')) {
    try {
      const PdfToEpubConverter = require('./services/epub/PdfToEpubConverter');
      fullPath = await PdfToEpubConverter.getOrConvertEpub(cleanKey, fullPath, { cleanKey });
    } catch (convErr) {
      console.error('[EpubSpine] Échec conversion automatique PDF -> EPUB pour ' + cleanKey + ':', convErr.message);
      return null;
    }
  }

  try {
    const JSZip = require('jszip');
    const fileBuffer = await fs.promises.readFile(fullPath);
    const zip = await JSZip.loadAsync(fileBuffer);

    const containerFile = zip.file('META-INF/container.xml');
    if (!containerFile) return null;
    const containerXml = await containerFile.async('string');
    const rootMatch = containerXml.match(/full-path="([^"]+)"/);
    const opfPath = rootMatch ? rootMatch[1] : 'OEBPS/content.opf';
    const opfDir = path.dirname(opfPath);

    const opfFile = zip.file(opfPath);
    if (!opfFile) return null;
    const opfXml = await opfFile.async('string');

    const manifest = {};
    const itemTagRegex = /<item\s+([^>]+?)\/?>/gi;
    let itemMatch;
    while ((itemMatch = itemTagRegex.exec(opfXml)) !== null) {
      const attrs = itemMatch[1];
      const idMatch = attrs.match(/\bid=["']([^"']+)["']/i);
      const hrefMatch = attrs.match(/\bhref=["']([^"']+)["']/i);
      const mediaMatch = attrs.match(/\bmedia-type=["']([^"']+)["']/i);
      if (idMatch && hrefMatch) {
        manifest[idMatch[1]] = {
          href: hrefMatch[1],
          mediaType: mediaMatch ? mediaMatch[1] : ''
        };
      }
    }

    const spineItems = [];
    const spineRegex = /<itemref\s+[^>]*idref=["']([^"']+)["']/gi;
    let m;
    while ((m = spineRegex.exec(opfXml)) !== null) {
      const idref = m[1];
      if (manifest[idref]) {
        const item = manifest[idref];
        if (item.mediaType && (item.mediaType.includes('xml') || item.mediaType.includes('html'))) {
          spineItems.push(item);
        }
      }
    }

    // Extraction des vrais titres de chapitres depuis le Sommaire (toc.ncx ou nav.xhtml)
    const tocMap = {};
    try {
      const ncxFile = zip.file(path.posix.join(opfDir, 'toc.ncx')) ||
                      zip.file('OEBPS/toc.ncx') ||
                      zip.file('toc.ncx') ||
                      Object.values(zip.files).find(f => f.name.endsWith('.ncx'));
      if (ncxFile) {
        const ncxXml = await ncxFile.async('string');
        const navPointRegex = /<navPoint[^>]*>[\s\S]*?<navLabel>\s*<text>([\s\S]*?)<\/text>\s*<\/navLabel>\s*<content\s+src=["']([^"']+)["']/gi;
        let nm;
        while ((nm = navPointRegex.exec(ncxXml)) !== null) {
          const label = nm[1].replace(/<[^>]+>/g, '').trim();
          const src = nm[2].split('#')[0].trim();
          if (label && src) {
            tocMap[src] = label;
            tocMap[path.posix.basename(src)] = label;
          }
        }
      }

      // Fallback EPUB3 Nav (nav.xhtml ou toc.xhtml)
      if (Object.keys(tocMap).length === 0) {
        const navFile = zip.file(path.posix.join(opfDir, 'nav.xhtml')) ||
                        zip.file('OEBPS/nav.xhtml') ||
                        zip.file('nav.xhtml') ||
                        Object.values(zip.files).find(f => f.name.endsWith('nav.xhtml') || f.name.endsWith('toc.xhtml'));
        if (navFile) {
          const navXml = await navFile.async('string');
          const navLinkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
          let am;
          while ((am = navLinkRegex.exec(navXml)) !== null) {
            const rawHref = am[1].split('#')[0].trim();
            const label = am[2].replace(/<[^>]+>/g, '').trim();
            if (label && rawHref && !tocMap[rawHref]) {
              tocMap[rawHref] = label;
              tocMap[path.posix.basename(rawHref)] = label;
            }
          }
        }
      }
    } catch (eToc) {
      console.warn('[EpubSpine] Non-blocking TOC parse warning:', eToc.message);
    }

    const entry = { spineItems, opfDir, zip, fullPath, tocMap };
    volumeChaptersCache.set(cleanKey, entry);
    return entry;
  } catch(e) {
    console.error('[EpubSpine] Parse error for ' + cleanKey + ':', e.message);
    return null;
  }
}

// ── FAST IN-MEMORY RAM CACHE FOR PARSED STREAM CHAPTERS (<1ms) ──
const parsedChaptersCache = new Map();
const MAX_PARSED_CHAPTERS_CACHE = 800;

app.get('/api/volume-chapters/:fileKey', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    const fileKey = req.params.fileKey;
    const epub = await getEpubSpine(fileKey);
    if (!epub) return res.status(404).json({ success: false, message: 'Volume introuvable.' });

    const chapters = epub.spineItems.map((item, idx) => {
      const cleanHref = path.posix.basename(item.href);
      const title = (epub.tocMap && (epub.tocMap[item.href] || epub.tocMap[cleanHref])) || `Section ${idx + 1}`;
      return {
        chapterNumber: idx + 1,
        title: title,
        href: item.href
      };
    });

    res.json({ success: true, totalChapters: chapters.length, chapters, fileKey });
  } catch (err) {
    console.error('[VolumeChapters] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/volume-chapters/:fileKey/:chapterNum', async (req, res) => {
  try {
    const { fileKey, chapterNum } = req.params;
    const num = parseInt(chapterNum, 10);
    const cacheKey = `${fileKey}:${num}`;

    // 1. Cache HIT RAM instantané (<1ms, 0 I/O disque)
    if (parsedChaptersCache.has(cacheKey)) {
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      return res.json(parsedChaptersCache.get(cacheKey));
    }
    const epub = await getEpubSpine(fileKey);
    if (!epub) return res.status(404).json({ success: false, message: 'Volume introuvable.' });

    const item = epub.spineItems[num - 1];
    if (!item) return res.status(404).json({ success: false, message: 'Chapitre introuvable.' });

    const fullHref = epub.opfDir === '.' ? item.href : `${epub.opfDir}/${item.href}`.replace(/\/+/g, '/');
    const chapterFile = epub.zip.file(fullHref) || epub.zip.file(item.href) || epub.zip.file(path.posix.basename(item.href));
    if (!chapterFile) return res.status(404).json({ success: false, message: 'Fichier de chapitre introuvable dans le volume.' });

    let rawHtml = await chapterFile.async('string');

    // Nettoyer les balises d'entête pour ne garder que le corps de lecture
    let bodyContent = rawHtml;
    const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      bodyContent = bodyMatch[1];
    }

    // Réécrire les chemins d'images relatifs pour chargement différé (lazy loading unitaire)
    const chapterDir = path.dirname(fullHref);
    bodyContent = bodyContent.replace(/<img([^>]+)src=["']([^"']+)["']/gi, (match, before, src) => {
      if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) return match;
      let cleanSrc = src;
      try { cleanSrc = decodeURIComponent(src); } catch(e) {}
      const resolvedImgPath = path.posix.normalize(path.posix.join(chapterDir, cleanSrc));
      return `<img${before}src="/api/volume-images/${encodeURIComponent(fileKey)}?img=${encodeURIComponent(resolvedImgPath)}" loading="lazy"`;
    });

    // Réécrire également les balises SVG <image xlink:href="..." /> et <image href="..." />
    bodyContent = bodyContent.replace(/<image([^>]+)(xlink:href|href)=["']([^"']+)["']/gi, (match, before, attrName, src) => {
      if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) return match;
      let cleanSrc = src;
      try { cleanSrc = decodeURIComponent(src); } catch(e) {}
      const resolvedImgPath = path.posix.normalize(path.posix.join(chapterDir, cleanSrc));
      return `<image${before}${attrName}="/api/volume-images/${encodeURIComponent(fileKey)}?img=${encodeURIComponent(resolvedImgPath)}"`;
    });

    // Titre de chapitre officiel depuis le TOC ou détection intelligente
    const cleanHref = path.posix.basename(item.href);
    let chapterTitle = (epub.tocMap && (epub.tocMap[item.href] || epub.tocMap[cleanHref]));
    if (!chapterTitle) {
      const hMatch = bodyContent.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
      if (hMatch) {
        const cleanH = hMatch[1].replace(/<[^>]+>/g, '').trim();
        if (cleanH && cleanH.length < 120) {
          chapterTitle = cleanH;
        }
      }
    }
    if (!chapterTitle) {
      chapterTitle = `Chapitre ${num}`;
    }

    const responsePayload = {
      success: true,
      totalChapters: epub.spineItems.length,
      currentChapter: num,
      chapter: {
        chapterNumber: num,
        title: chapterTitle,
        content: bodyContent
      }
    };

    // Stockage en RAM cache avec éviction LRU douce
    if (parsedChaptersCache.size >= MAX_PARSED_CHAPTERS_CACHE) {
      const oldestKey = parsedChaptersCache.keys().next().value;
      parsedChaptersCache.delete(oldestKey);
    }
    parsedChaptersCache.set(cacheKey, responsePayload);

    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.json(responsePayload);
  } catch (err) {
    console.error('[VolumeChapter] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── EPUB VOLUME IMAGES WITH SHARP WEBP ON-THE-FLY CACHE ──
const sharp = require('sharp');
const nodeCrypto = require('crypto');
const webpCacheDir = path.join(__dirname, 'uploads', 'cache', 'webp');
if (!fs.existsSync(webpCacheDir)) {
  fs.mkdirSync(webpCacheDir, { recursive: true });
}

app.get('/api/volume-images/:fileKey', async (req, res) => {
  try {
    const fileKey = req.params.fileKey;
    const imgPath = req.query.img;
    if (!imgPath) return res.status(400).send('Chemin image requis');

    const hash = nodeCrypto.createHash('md5').update(fileKey + ':' + imgPath).digest('hex');
    const cachedFilePath = path.join(webpCacheDir, `${hash}.webp`);

    // 1. Cache HIT : Envoi instantané du WebP pré-généré (1ms)
    if (fs.existsSync(cachedFilePath)) {
      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return fs.createReadStream(cachedFilePath).pipe(res);
    }

    // 2. Cache MISS : Extraction de l'image de l'EPUB
    const epub = await getEpubSpine(fileKey);
    if (!epub) return res.status(404).send('Volume introuvable');

    let cleanImgPath = path.posix.normalize(imgPath);
    let decodedImgPath = cleanImgPath;
    try { decodedImgPath = decodeURIComponent(cleanImgPath); } catch(e) {}
    let decodedBase = path.basename(decodedImgPath);

    const imgFile = epub.zip.file(decodedImgPath) ||
                    epub.zip.file(cleanImgPath) ||
                    epub.zip.file(imgPath) ||
                    epub.zip.file(decodedBase) ||
                    epub.zip.file(path.basename(imgPath)) ||
                    Object.values(epub.zip.files).find(f => {
                      const base = path.basename(f.name);
                      return base === decodedBase || base === path.basename(imgPath) || f.name.endsWith(decodedBase);
                    });
    if (!imgFile) return res.status(404).send('Image introuvable');

    const origBuffer = await imgFile.async('nodebuffer');
    const ext = path.extname(imgPath).toLowerCase();

    // SVG ou GIF : servir tels quels
    if (ext === '.svg' || ext === '.gif') {
      const mime = ext === '.svg' ? 'image/svg+xml' : 'image/gif';
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': origBuffer.length,
        'Cache-Control': 'public, max-age=31536000, immutable'
      });
      return res.end(origBuffer);
    }

    // Conversion ultra-rapide en WebP optimisé (90% plus léger)
    try {
      const webpBuffer = await sharp(origBuffer)
        .resize({ width: 1600, withoutEnlargement: true })
        .webp({ quality: 80, effort: 4 })
        .toBuffer();

      // Sauvegarde asynchrone sur disque pour les prochaines requêtes
      fs.promises.writeFile(cachedFilePath, webpBuffer).catch(e => {
        console.warn('[WebPCache] Write warning:', e.message);
      });

      res.writeHead(200, {
        'Content-Type': 'image/webp',
        'Content-Length': webpBuffer.length,
        'Cache-Control': 'public, max-age=31536000, immutable'
      });
      return res.end(webpBuffer);
    } catch (sharpErr) {
      console.warn('[VolumeImage] Sharp fallback:', sharpErr.message);
      const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp'
      };
      res.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'image/jpeg',
        'Content-Length': origBuffer.length,
        'Cache-Control': 'public, max-age=31536000, immutable'
      });
      return res.end(origBuffer);
    }
  } catch (err) {
    console.error('[VolumeImage] Error:', err.message);
    res.status(500).send(err.message);
  }
});


const PORT = process.env.PORT || 3000;

// Multer memory storage (Traitement éphémère sans persistance sur disque)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100 MB max RAM buffer sécurisé
});

// ── MULTER CONFIG FOR NOVEL VOLUMES (.EPUB / .PDF) ───────────────────────────
const volumeUploadDir = path.join(__dirname, 'uploads', 'volumes');
if (!fs.existsSync(volumeUploadDir)) {
    fs.mkdirSync(volumeUploadDir, { recursive: true });
}

const volumeStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, volumeUploadDir),
    filename: (req, file, cb) => {
        const novelId = (req.params.id || 'novel').replace(/[^a-zA-Z0-9_-]/g, '_');
        const volNum = (req.body.volume_number || '1').toString().replace(/[^0-9]/g, '');
        const ext = path.extname(file.originalname).toLowerCase();
        const unique = Date.now();
        cb(null, `${novelId}_vol_${volNum || '1'}_${unique}${ext}`);
    }
});

const uploadVolume = multer({
    storage: volumeStorage,
    limits: { fileSize: 200 * 1024 * 1024 }, // 200MB max per volume
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.epub', '.pdf', '.zip'].includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Format de fichier non supporté. Veuillez sélectionner un fichier .epub ou .pdf.'));
        }
    }
});


// ── SÉCURITÉ & OPTIMISATIONS HARDENING ──────────────────────────────────────────
// 1. En-têtes HTTP de sécurité avec Helmet (configuré souple pour ne casser aucun CDN/image/font)
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
  frameguard: { action: 'sameorigin' }
}));

// 2. Compression HTTP Gzip/Brotli (réduit la taille des JSON et assets statiques de 70-80%)
app.use(compression({
  filter: (req, res) => {
    // Ne JAMAIS compresser ni mettre en tampon les flux Server-Sent Events (SSE) ni les flux binaires
    if (
      req.headers.accept === 'text/event-stream' ||
      req.path.startsWith('/api/translation-events') ||
      req.path.startsWith('/api/library/events') ||
      req.path.startsWith('/api/volume-stream') ||
      req.path.includes('/download')
    ) {
      return false;
    }
    return compression.filter(req, res);
  },
  threshold: 1024
}));

// 3. Limitation de débit (Rate Limiting) protecteur et invisible pour l'utilisateur légitime
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 350, // 350 requêtes/min par IP (très large, aucune gêne)
  standardHeaders: true,
  legacyHeaders: false
});
app.use(globalLimiter);

// Limiteur ciblé recherche métadonnées (protège quotas AniList / Google)
const metadataLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Trop de requêtes de métadonnées. Veuillez patienter une minute.' }
});

// Limiteur ciblé traductions lourdes
const translateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Limite de traductions atteinte. Veuillez patienter quelques minutes.' }
});

// Limiteur interface contribution
const contributorLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Trop de requêtes contributeur. Veuillez patienter un instant.' }
});

// Middlewares avec taille de body contrôlée (anti-bombes JSON)
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Dedicated SEO & Verification Routes
app.get('/sitemap.xml', (req, res) => {
  try {
    const data = CatalogService.loadData();
    const seriesList = (data && Array.isArray(data.series)) ? data.series : [];
    const publishedSeries = seriesList.filter(s => s.publication_status === 'PUBLISHED');

    const baseUrl = 'https://novel-trad.online';
    const now = new Date().toISOString().split('T')[0];

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    // Page d\'accueil
    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}/</loc>\n`;
    xml += `    <lastmod>${now}</lastmod>\n`;
    xml += '    <changefreq>daily</changefreq>\n';
    xml += '    <priority>1.0</priority>\n';
    xml += '  </url>\n';


    // Toutes les séries publiées
    for (const s of publishedSeries) {
      let lastmod = now;
      const rawDate = s.updated_at || s.created_at || (s.releaseDate ? new Date(s.releaseDate).getTime() : 0);
      if (rawDate) {
        try {
          const d = new Date(typeof rawDate === 'number' ? rawDate : rawDate);
          if (!isNaN(d.getTime())) {
            lastmod = d.toISOString().split('T')[0];
          }
        } catch (e) {}
      }

      xml += '  <url>\n';
      xml += `    <loc>${baseUrl}/series.html?id=${encodeURIComponent(s.id)}</loc>\n`;
      xml += `    <lastmod>${lastmod}</lastmod>\n`;
      xml += '    <changefreq>weekly</changefreq>\n';
      xml += '    <priority>0.8</priority>\n';
      xml += '  </url>\n';
    }

    xml += '</urlset>';

    res.header('Content-Type', 'application/xml; charset=utf-8');
    res.header('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  } catch (err) {
    console.error('[SEO] Erreur génération sitemap:', err);
    res.sendFile(path.join(__dirname, 'public', 'sitemap.xml'));
  }
});

// SSR SEO & Open Graph Injection pour les fiches de séries
app.get(['/series.html', '/series/:id'], (req, res, next) => {
  const seriesId = req.query.id || req.params.id;
  if (!seriesId) return next();

  try {
    const series = CatalogService.getSeries(seriesId);
    const seriesHtmlPath = path.join(__dirname, 'public', 'series.html');
    if (!fs.existsSync(seriesHtmlPath)) return next();

    let html = fs.readFileSync(seriesHtmlPath, 'utf8');
    if (series && series.title) {
      const pageTitle = `${series.title} - Light Novel en Français | NovelTrad`;
      const cleanSynopsis = (series.synopsis || `Lisez ${series.title} traduit en français sur NovelTrad.`)
        .replace(/<[^>]*>/g, '')
        .replace(/"/g, '&quot;')
        .slice(0, 250);
      const coverUrl = series.cover_url || series.cover || '/favicon.svg';
      const fullCoverUrl = coverUrl.startsWith('http') ? coverUrl : `https://novel-trad.online${coverUrl.startsWith('/') ? '' : '/'}${coverUrl}`;
      const canonicalUrl = `https://novel-trad.online/series.html?id=${encodeURIComponent(series.id)}`;

      const metaTags = `
  <title>${pageTitle}</title>
  <meta name="description" content="${cleanSynopsis}">
  <link rel="canonical" href="${canonicalUrl}">
  <!-- Open Graph (Facebook, Discord, etc.) -->
  <meta property="og:type" content="book">
  <meta property="og:site_name" content="NovelTrad">
  <meta property="og:title" content="${pageTitle}">
  <meta property="og:description" content="${cleanSynopsis}">
  <meta property="og:image" content="${fullCoverUrl}">
  <meta property="og:url" content="${canonicalUrl}">
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${pageTitle}">
  <meta name="twitter:description" content="${cleanSynopsis}">
  <meta name="twitter:image" content="${fullCoverUrl}">
`;

      html = html.replace(/<title>.*?<\/title>/i, metaTags);
    }

    res.header('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (err) {
    console.warn('[SEO] Erreur injection meta series:', err.message);
    next();
  }
});

app.get('/robots.txt', (req, res) => {
  res.header('Content-Type', 'text/plain');
  res.sendFile(path.join(__dirname, 'public', 'robots.txt'));
});

app.get('/google183318dfed3f9f37.html', (req, res) => {
  res.header('Content-Type', 'text/html');
  res.sendFile(path.join(__dirname, 'public', 'google183318dfed3f9f37.html'));
});

// Dev: Disable caching for static files so client always gets latest HTML/JS/CSS
// Serve favicon cleanly to prevent 404 in console
app.get('/favicon.ico', (req, res) => {
  const iconPath = path.join(__dirname, 'public', 'favicon.svg');
  if (fs.existsSync(iconPath)) {
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.sendFile(iconPath);
  }
  res.status(204).end();
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    const lower = filePath.toLowerCase();
    // Les librairies tierces minifiées, polices et images sont mises en cache pour accélérer drastiquement le mobile
    if (
      lower.endsWith('.min.js') || 
      lower.endsWith('.woff2') || 
      lower.endsWith('.woff') || 
      lower.endsWith('.ttf') || 
      lower.endsWith('.svg') || 
      lower.endsWith('.png') || 
      lower.endsWith('.jpg') || 
      lower.endsWith('.jpeg') || 
      lower.endsWith('.webp')
    ) {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable'); // 7 jours
    } else {
      // Les pages HTML et scripts d'application restent sans cache pour garantir la mise à jour immédiate du dev
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
  }
}));

// ==========================================================================
// STATUS & SUPABASE PUBLIC CONFIG ENDPOINTS
// ==========================================================================

app.get('/api/status', async (req, res) => {
  const deeplConfigured = Boolean(process.env.DEEPL_API_KEY && process.env.DEEPL_API_KEY.trim() !== '');
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim() !== '');
  const stats = DiskJobStore.getGlobalStats();
  res.json({
    status: 'OK',
    service: 'NovelTrad AI Studio & Translation Engine',
    defaultProvider: process.env.DEFAULT_PROVIDER || 'gemini',
    deeplConfigured,
    geminiConfigured,
    maskedKey: QuotaGuard.maskApiKey(process.env.DEEPL_API_KEY),
    stats
  });
});

app.get('/api/config/supabase', (req, res) => {
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const publishableKey = (process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();

  // Strict Security Check: NEVER expose secret / service_role keys to frontend
  if (publishableKey.startsWith('sb_secret_') || publishableKey.toLowerCase().includes('service_role')) {
    console.error('CRITICAL SECURITY WARNING: A secret Supabase key was placed in public env variables. It will NOT be exposed to frontend.');
    return res.status(500).json({
      success: false,
      configured: false,
      error: 'Invalid key type: Secret/Service keys must NEVER be exposed to the client.'
    });
  }

  const configured = Boolean(supabaseUrl && publishableKey);
  res.json({
    success: true,
    configured: configured,
    supabaseUrl: supabaseUrl,
    supabasePublishableKey: publishableKey
  });
});

// ==========================================================================
// TRANSLATION ENGINE & SSE PROGRESS
// ==========================================================================

app.get('/api/translation-events/:jobId', (req, res) => {
  const { jobId } = req.params;
  
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendUpdate = (job) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(job)}\n\n`);
      if (typeof res.flush === 'function') {
        res.flush();
      }
    }
  };

  // Envoi d'un keep-alive immédiat pour établir le canal SSE sans délai
  res.write(': keepalive\n\n');
  if (typeof res.flush === 'function') res.flush();

  const currentJob = DiskJobStore.getJob(jobId);
  if (currentJob) {
    sendUpdate(currentJob);
  }

  const eventName = `progress:${jobId}`;
  DiskJobStore.on(eventName, sendUpdate);

  req.on('close', () => {
    DiskJobStore.off(eventName, sendUpdate);
  });
});

app.post('/api/analyze-novel', translateLimiter, upload.single('document'), async (req, res) => {
  try {
    const file = req.file;
    const { targetLang, apiKey, provider } = req.body;
    const effectiveKey = apiKey || (provider === 'gemini' ? process.env.GEMINI_API_KEY : (provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.DEEPL_API_KEY));

    if (!file && (!req.body.text || req.body.text.trim().length === 0)) {
      return res.status(400).json({ error: true, message: 'Aucun document ni texte fourni pour analyse.' });
    }

    const filename = file ? file.originalname : 'document.txt';
    const ext = path.extname(filename).toLowerCase();

    if (ext === '.epub') {
      const epubAnalysis = await EpubProcessor.analyze(file.buffer, filename);
      const quotaCheck = await QuotaGuard.checkPreTranslationQuota(
        provider || 'gemini',
        effectiveKey,
        epubAnalysis.totalCharacters,
        'epub'
      );

      return res.json({
        filename,
        fileType: 'EPUB',
        sizeMB: epubAnalysis.sizeMB,
        chapters: epubAnalysis.chapterCount,
        totalCharacters: epubAnalysis.totalCharacters,
        totalTextBlocks: epubAnalysis.totalTextBlocks,
        quotaCheck
      });
    }

    if (ext === '.pdf') {
      let rawChars = 5000;
      try {
        const pdfParse = require('pdf-parse');
        const parsed = await pdfParse(file.buffer);
        rawChars = parsed.text.length;
      } catch (e) {}

      const quotaCheck = await QuotaGuard.checkPreTranslationQuota(
        provider || 'gemini',
        effectiveKey,
        rawChars,
        'pdf'
      );

      return res.json({
        filename,
        fileType: 'PDF',
        sizeMB: (file.size / 1024 / 1024).toFixed(2),
        totalCharacters: rawChars,
        quotaCheck
      });
    }

    const rawText = file ? file.buffer.toString('utf-8') : req.body.text;
    const quotaCheck = await QuotaGuard.checkPreTranslationQuota(
      provider || 'gemini',
      effectiveKey,
      rawText.length,
      'txt'
    );

    return res.json({
      filename,
      fileType: 'TXT',
      sizeMB: (Buffer.byteLength(rawText) / 1024 / 1024).toFixed(2),
      totalCharacters: rawText.length,
      quotaCheck
    });

  } catch (err) {
    console.error('[Analyze Error]', err.message);
    return res.status(500).json({ error: true, message: err.message });
  }
});

function startBackgroundTranslation(jobId, ext, fileBuffer, filename, targetLang, sourceLang, effectiveKey, selectedProvider) {
  setImmediate(async () => {
    try {
      if (ext === '.epub') {
        const translator = TranslationFactory.getProvider(selectedProvider);
        const translatedEpubBuffer = await EpubProcessor.processEpubDocument(
          jobId,
          fileBuffer,
          filename,
          targetLang || 'FR',
          sourceLang || 'auto',
          effectiveKey,
          translator,
          (statusText, pct) => {
            DiskJobStore.updateJobProgress(jobId, { statusMessage: statusText, progress: pct });
          }
        );
        await DiskJobStore.setTranslatedEpubBuffer(jobId, translatedEpubBuffer);
      } else if (ext === '.pdf') {
        const translatedPdfBuffer = await DocumentProcessor.processPdfDocument(
          jobId,
          fileBuffer,
          filename,
          targetLang || 'FR',
          sourceLang || 'auto',
          effectiveKey,
          selectedProvider,
          (statusText, pct) => {
            DiskJobStore.updateJobProgress(jobId, { statusMessage: statusText, progress: pct });
          }
        );
        await DiskJobStore.setTranslatedPdfBuffer(jobId, translatedPdfBuffer);
      } else {
        const textContent = fileBuffer.toString('utf-8');
        const translatedText = await TranslationPipeline.processNovel(
          jobId,
          textContent,
          filename,
          targetLang || 'FR',
          sourceLang || 'auto',
          effectiveKey,
          selectedProvider,
          (statusText, pct) => {
            DiskJobStore.updateJobProgress(jobId, { statusMessage: statusText, progress: pct });
          }
        );
        await DiskJobStore.setTranslatedText(jobId, translatedText);
      }

      const finalJob = DiskJobStore.getJob(jobId);
      if (finalJob && finalJob.status !== 'QUOTA_EXCEEDED' && finalJob.status !== 'PAUSED' && finalJob.status !== 'WAITING_FOR_KEY') {
        await DiskJobStore.completeJob(jobId);
      }
    } catch (err) {
      console.error(`[Background Translation Error: ${jobId}]`, err.message);
      const isQuota = Boolean(err.isQuotaExceeded || err.message?.toLowerCase().includes('quota') || err.message?.toLowerCase().includes('456'));
      const isAuth = Boolean(err.isAuthError || err.message?.toLowerCase().includes('403') || err.message?.toLowerCase().includes('invalide'));
      const isWaiting = Boolean(err.isPartial || err.message?.toLowerCase().includes('456'));

      let finalStatus = 'FAILED';
      if (isQuota) finalStatus = 'QUOTA_EXCEEDED';
      if (isWaiting) finalStatus = 'WAITING_FOR_KEY';

      await DiskJobStore.updateJob(jobId, {
        status: finalStatus,
        statusMessage: `Erreur : ${err.message}`,
        error: err.message,
        isQuotaExceeded: isQuota || isWaiting
      });
    }
  });
}

app.post('/api/translate-document', translateLimiter, upload.single('document'), async (req, res) => {
  try {
    const file = req.file || req.files?.pdf || req.files?.document;
    const { targetLang, sourceLang, apiKey, provider, jobId } = req.body;
    const selectedProvider = provider || process.env.DEFAULT_PROVIDER || 'gemini';
    let fallbackKey = process.env.DEEPL_API_KEY;
    if (selectedProvider === 'gemini' || selectedProvider === 'gemini-api') {
      fallbackKey = process.env.GEMINI_API_KEY;
    } else if (selectedProvider === 'openai') {
      fallbackKey = process.env.OPENAI_API_KEY;
    }
    const effectiveKey = apiKey || fallbackKey;

    if (!file && (!req.body.text || req.body.text.trim().length === 0)) {
      return res.status(400).json({ error: true, message: 'Aucun document ni texte fourni.' });
    }

    const filename = file ? file.originalname : 'document.txt';
    const ext = path.extname(filename).toLowerCase();
    const effectiveJobId = jobId || ('job_' + Date.now());
    const fileBuffer = file ? file.buffer : Buffer.from(req.body.text, 'utf-8');

    await DiskJobStore.createJob(
      effectiveJobId,
      filename,
      ext === '.epub' ? 'epub' : (ext === '.pdf' ? 'pdf' : 'txt'),
      {
        apiKey: effectiveKey,
        provider: selectedProvider,
        targetLang: targetLang || 'FR',
        sourceLang: sourceLang || 'auto',
        fileBuffer
      }
    );

    const jobInfo = DiskJobStore.getJob(effectiveJobId);
    res.status(202).json({
      success: true,
      jobId: effectiveJobId,
      secretToken: jobInfo?.secretToken || ''
    });

    startBackgroundTranslation(
      effectiveJobId,
      ext,
      fileBuffer,
      filename,
      targetLang,
      sourceLang,
      effectiveKey,
      selectedProvider
    );

  } catch (err) {
    console.error('[Translation Startup Error]', err.message);
    res.status(500).json({ error: true, message: err.message });
  }
});

app.post('/api/translate-pdf', upload.single('pdf'), async (req, res) => {
  req.file = req.file || req.files?.pdf;
  return app._router.handle({ ...req, url: '/api/translate-document' }, res);
});

app.post('/api/update-job-key', async (req, res) => {
  const { jobId, apiKey, provider } = req.body;
  if (!jobId || !apiKey) {
    return res.status(400).json({ error: true, message: 'jobId et apiKey requis.' });
  }
  const job = DiskJobStore.getJob(jobId);
  if (!job) {
    return res.status(404).json({ error: true, message: 'Job introuvable.' });
  }
  await DiskJobStore.updateJobApiKey(jobId, apiKey, provider);
  res.json({ success: true, message: 'Clé API mise à jour pour le job.' });
});

app.post('/api/resume-translation', async (req, res) => {
  try {
    const { jobId, provider } = req.body;
    const submittedKey = (req.body.apiKey || req.body.deeplApiKey || '').trim();
    if (!jobId) {
      return res.status(400).json({ error: true, message: 'jobId requis.' });
    }
    const job = DiskJobStore.getJob(jobId);
    if (!job) {
      return res.status(404).json({ error: true, message: 'Job introuvable.' });
    }

    const effectiveKey = submittedKey || job.apiKey;
    const effectiveProvider = provider || job.provider || 'deepl';
    await DiskJobStore.updateJobApiKey(jobId, effectiveKey, effectiveProvider);
    await DiskJobStore.updateJob(jobId, {
      status: 'PROCESSING',
      phase: 'TRANSLATION',
      statusMessage: 'Reprise de la traduction...',
      error: null,
      isQuotaExceeded: false,
      isAuthError: false
    });

    const sourceBuffer = await DiskJobStore.getSourceFileBuffer(jobId);
    if (!sourceBuffer) {
      return res.status(400).json({ error: true, message: 'Fichier source introuvable pour la reprise.' });
    }

    const ext = job.type === 'epub' ? '.epub' : (job.type === 'pdf' ? '.pdf' : '.txt');
    startBackgroundTranslation(jobId, ext, sourceBuffer, job.filename, job.targetLang, job.sourceLang, effectiveKey, effectiveProvider);

    res.json({ success: true, message: 'Traduction reprise avec succès.' });
  } catch (err) {
    console.error('[Resume Error]', err.message);
    res.status(500).json({ error: true, message: err.message });
  }
});

app.post('/api/convert-epub-to-pdf', upload.single('document'), async (req, res) => {
  try {
    let epubBuffer = req.file ? req.file.buffer : null;
    const { jobId } = req.body;
    if (!epubBuffer && jobId) {
      epubBuffer = await DiskJobStore.getTranslatedEpubBuffer(jobId);
    }
    if (!epubBuffer) {
      return res.status(400).json({ error: true, message: 'Fichier EPUB manquant.' });
    }

    const pdfBuffer = await EpubToPdfConverter.convertEpubToPdf(jobId || ('conv_' + Date.now()), epubBuffer, 'document_traduit.epub', (statusText, pct) => {
      if (jobId) {
        DiskJobStore.updateJobProgress(jobId, { statusMessage: statusText, progress: pct });
      }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="converted.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[Convert EPUB to PDF Error]', err.message);
    res.status(500).json({ error: true, message: err.message });
  }
});

app.get('/api/translation-progress/:jobId', (req, res) => {
  const job = DiskJobStore.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: true, message: 'Job introuvable ou expiré.' });
  }
  return res.json(job);
});

app.get('/api/dashboard-stats', async (req, res) => {
  const stats = DiskJobStore.getGlobalStats();
  const effectiveKey = req.query.apiKey || process.env.DEEPL_API_KEY;
  let quotaInfo = null;
  if (effectiveKey) {
    quotaInfo = await QuotaGuard.getDeepLUsage(effectiveKey);
  }
  res.json({ stats, quotaInfo });
});

app.post('/api/history', async (req, res) => {
  try {
    const { jobs = [] } = req.body;
    const validJobs = [];

    for (const j of jobs) {
      if (!j.jobId || !j.secretToken) continue;
      const jobData = DiskJobStore.getJob(j.jobId);
      if (jobData && jobData.secretToken === j.secretToken) {
        validJobs.push({
          jobId: jobData.id,
          filename: jobData.filename,
          status: jobData.status,
          statusMessage: jobData.statusMessage,
          progress: jobData.progress || 0,
          currentBlock: jobData.currentBlock || 0,
          totalBlocks: jobData.totalBlocks || 0,
          lastUpdated: jobData.lastUpdated,
          canResume: (jobData.status === 'QUOTA_EXCEEDED' || jobData.status === 'WAITING_FOR_KEY' || jobData.status === 'PAUSED' || jobData.status === 'FAILED')
        });
      }
    }

    validJobs.sort((a, b) => b.lastUpdated - a.lastUpdated);
    res.json({ jobs: validJobs });
  } catch (error) {
    res.status(500).json({ error: true, message: error.message });
  }
});

// ==========================================================================
// ZERO-COPY UNIVERSAL LIBRARY ENGINE (DESKTOP & MOBILE)
// ==========================================================================

// Multi-tenant Local Library Storage (Partitionné par userId, Guest-First)
function getLibraryStore() {
  const pathsFile = path.join(__dirname, 'data', 'library_paths.json');
  if (!fs.existsSync(pathsFile)) return { users: { guest: { folders: [], files: [] } } };
  try {
    const raw = fs.readFileSync(pathsFile, 'utf8').replace(/^\uFEFF/, '').trim();
    if (!raw) return { users: { guest: { folders: [], files: [] } } };
    const parsed = JSON.parse(raw);

    if (parsed && parsed.users && typeof parsed.users === 'object') {
      if (!parsed.users.guest) parsed.users.guest = { folders: [], files: [] };
      return parsed;
    }

    // Auto-migration depuis l'ancien format plat
    const legacyFolders = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.folders) ? parsed.folders : []);
    const legacyFiles = Array.isArray(parsed.files) ? parsed.files : [];
    return {
      users: {
        guest: { folders: legacyFolders, files: legacyFiles }
      }
    };
  } catch (e) {
    console.error('[Library Paths] Error parsing library_paths.json:', e.message);
    return { users: { guest: { folders: [], files: [] } } };
  }
}

function saveLibraryStore(store) {
  const pathsFile = path.join(__dirname, 'data', 'library_paths.json');
  try {
    fs.writeFileSync(pathsFile, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {
    console.error('[Library Paths] Error saving library_paths.json:', e.message);
  }
}

function getLibraryRegistry(userId = 'guest') {
  const effectiveUser = userId || 'guest';
  const store = getLibraryStore();
  if (!store.users[effectiveUser]) {
    store.users[effectiveUser] = { folders: [], files: [] };
    saveLibraryStore(store);
  }
  return {
    folders: Array.isArray(store.users[effectiveUser].folders) ? store.users[effectiveUser].folders : [],
    files: Array.isArray(store.users[effectiveUser].files) ? store.users[effectiveUser].files : []
  };
}

function saveLibraryRegistry(userId = 'guest', registry) {
  // Support legacy signature saveLibraryRegistry(registry)
  if (typeof userId === 'object' && registry === undefined) {
    registry = userId;
    userId = 'guest';
  }
  const effectiveUser = userId || 'guest';
  const store = getLibraryStore();
  store.users[effectiveUser] = {
    folders: Array.isArray(registry.folders) ? registry.folders : [],
    files: Array.isArray(registry.files) ? registry.files : []
  };
  saveLibraryStore(store);

  // Mettre à jour Chokidar avec l'ensemble des dossiers uniques de tous les utilisateurs
  if (LibraryWatcher && LibraryWatcher.updateWatchedFolders) {
    const allUnique = new Set();
    Object.values(store.users).forEach(u => {
      (u.folders || []).forEach(f => allUnique.add(f));
    });
    LibraryWatcher.updateWatchedFolders(Array.from(allUnique));
  }
}

async function getUserIdFromRequest(req) {
  try {
    if (typeof authenticateUser === 'function') {
      const user = await authenticateUser(req);
      if (user && user.id) return user.id;
    }
  } catch (e) {}
  // Option A : Isolation par Guest Session UUID unique par appareil/navigateur
  const guestHeader = (req.headers['x-guest-id'] || req.query.guestId || '').toString().trim();
  if (guestHeader && /^guest_[a-zA-Z0-9_-]+$/.test(guestHeader)) {
    return guestHeader;
  }
  return 'guest';
}

function scanDirectoryFiles(dirPath, maxDepth = 4, currentDepth = 0) {
  let results = [];
  if (!fs.existsSync(dirPath) || currentDepth > maxDepth) return results;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !entry.name.startsWith('$') && entry.name !== 'node_modules') {
          results = results.concat(scanDirectoryFiles(fullPath, maxDepth, currentDepth + 1));
        }
      } else if (entry.isFile()) {
        const lower = entry.name.toLowerCase();
        if (lower.endsWith('.epub') || lower.endsWith('.pdf')) {
          results.push({
            filename: entry.name,
            fullPath: fullPath,
            hasPdf: lower.endsWith('.pdf')
          });
        }
      }
    }
  } catch (err) {
    console.warn(`[Library Scan] Erreur lecture dossier ${dirPath}:`, err.message);
  }
  return results;
}

// Library SSE events
app.get('/api/library/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(': keepalive\n\n');
  if (typeof res.flush === 'function') res.flush();
  if (LibraryWatcher && LibraryWatcher.addClient) {
    LibraryWatcher.addClient(res);
  }
});

app.get('/api/library/paths', async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  const registry = getLibraryRegistry(userId);
  const enrichedFolders = registry.folders.map(p => {
    const exists = fs.existsSync(p);
    const bookCount = exists ? scanDirectoryFiles(p).length : 0;
    return { path: p, exists, bookCount, name: path.basename(p) };
  });
  const enrichedFiles = registry.files.map(p => {
    const exists = fs.existsSync(p);
    return { path: p, exists, filename: path.basename(p) };
  });
  res.json({ success: true, paths: enrichedFolders, folders: enrichedFolders, files: enrichedFiles });
});

// 1. Upload de fichiers / dossiers vers la bibliothèque locale (Partitionné par utilisateur)
app.post('/api/library/upload-files', upload.array('files'), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, message: 'Aucun fichier reçu.' });
    }

    const userId = await getUserIdFromRequest(req);
    const userLibDir = path.join(__dirname, 'data', 'local_library', userId);
    if (!fs.existsSync(userLibDir)) {
      fs.mkdirSync(userLibDir, { recursive: true });
    }

    let savedCount = 0;
    for (const file of files) {
      const originalName = path.basename(file.originalname);
      const ext = path.extname(originalName).toLowerCase();
      if (ext === '.epub' || ext === '.pdf') {
        const destPath = path.join(userLibDir, originalName);
        fs.writeFileSync(destPath, file.buffer);
        savedCount++;
      }
    }

    if (LibraryWatcher && LibraryWatcher.broadcast) {
      LibraryWatcher.broadcast('library-updated', { type: 'files-uploaded', userId, count: savedCount });
    }

    res.json({
      success: true,
      message: `${savedCount} livre(s) importé(s) dans votre bibliothèque avec succès !`,
      savedCount
    });
  } catch (err) {
    console.error('[Library Upload Error]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Ajout volontaire et privé d'un document traduit dans la bibliothèque de l'utilisateur
app.post('/api/library/add-job-to-library', async (req, res) => {
  try {
    const { jobId } = req.body;
    if (!jobId) return res.status(400).json({ success: false, message: 'jobId requis.' });
    const job = DiskJobStore.getJob(jobId);
    if (!job || job.status !== 'COMPLETED') {
      return res.status(404).json({ success: false, message: 'Traduction introuvable ou non terminée.' });
    }
    const userId = await getUserIdFromRequest(req);
    const userLibDir = path.join(__dirname, 'data', 'local_library', userId);
    if (!fs.existsSync(userLibDir)) fs.mkdirSync(userLibDir, { recursive: true });

    const ext = job.type === 'epub' ? 'epub' : (job.type === 'pdf' ? 'pdf' : 'txt');
    const translatedBuffer = await DiskJobStore.getTranslatedBuffer(jobId, ext);
    if (!translatedBuffer) {
      return res.status(400).json({ success: false, message: 'Fichier traduit manquant sur le disque.' });
    }

    const safeOriginalName = job.filename ? path.basename(job.filename).replace(/\.[^/.]+$/, '') : `novel_${jobId}`;
    const targetLang = (job.targetLang || 'fr').toLowerCase();
    const targetFilename = `${safeOriginalName}_${targetLang}.${ext}`;
    const destPath = path.join(userLibDir, targetFilename);
    fs.writeFileSync(destPath, translatedBuffer);

    if (LibraryWatcher && LibraryWatcher.broadcast) {
      LibraryWatcher.broadcast('library-updated', { type: 'book-added', userId, filename: targetFilename });
    }
    res.json({ success: true, message: 'Livre ajouté avec succès à votre bibliothèque !', filename: targetFilename });
  } catch (err) {
    console.error('[AddJobToLibrary Error]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. Sélecteur natif Windows de dossier (FolderBrowserDialog)
app.post('/api/library/browse-native-folder', async (req, res) => {
  try {
    const { execFile } = require('child_process');
    if (process.platform === 'win32') {
      const scriptPath = path.join(__dirname, 'scripts', 'pick_folder.ps1');
      execFile('powershell.exe', ['-STA', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { timeout: 300000 }, async (err, stdout, stderr) => {
        if (err || stderr) console.log('[browse-native-folder] Notice:', err ? err.message : '', stderr || '');
        if (err || !stdout || !stdout.trim()) {
          return res.json({ success: false, message: 'Sélection annulée.' });
        }
        
        // Extraire toutes les lignes candidates et chercher un dossier réel existant
        const candidates = stdout.split(/\r?\n/).map(l => l.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
        const selectedFolder = candidates.reverse().find(p => {
          try {
            return fs.existsSync(p) && fs.statSync(p).isDirectory();
          } catch (e) {
            return false;
          }
        });

        if (!selectedFolder) {
          console.warn('[browse-native-folder] Dossier non validé à partir de la sortie:', stdout);
          return res.json({ success: false, message: 'Dossier introuvable.' });
        }

        const userId = await getUserIdFromRequest(req);
        const registry = getLibraryRegistry(userId);
        if (!registry.folders.includes(selectedFolder)) {
          registry.folders.push(selectedFolder);
          saveLibraryRegistry(userId, registry);
          if (LibraryWatcher) {
            LibraryWatcher.updateWatchedFolders(registry.folders);
            LibraryWatcher.broadcast('library-updated', { type: 'folder-linked', folder: selectedFolder });
          }
        }

        const bookCount = scanDirectoryFiles(selectedFolder).length;
        res.json({
          success: true,
          folderPath: selectedFolder,
          bookCount,
          message: `Dossier "${path.basename(selectedFolder)}" connecté (${bookCount} livre(s) détecté(s)) !`
        });
      });
    } else {
      res.json({ success: false, message: 'Sélecteur natif Windows indisponible sur cet OS.' });
    }
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur lors de l'ouverture du sélecteur." });
  }
});

// 3. Sélecteur natif Windows de fichiers (OpenFileDialog Multi-Sélection)
app.post('/api/library/browse-native-files', async (req, res) => {
  try {
    const { execFile } = require('child_process');
    if (process.platform === 'win32') {
      const scriptPath = path.join(__dirname, 'scripts', 'pick_files.ps1');
      execFile('powershell.exe', ['-STA', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { timeout: 300000 }, async (err, stdout, stderr) => {
        if (err || !stdout || !stdout.trim()) {
          return res.json({ success: false, message: 'Sélection annulée.' });
        }
        const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) {
          return res.json({ success: false, message: 'Aucun fichier sélectionné.' });
        }

        const userId = await getUserIdFromRequest(req);
        const registry = getLibraryRegistry(userId);
        let addedCount = 0;
        for (const filePath of lines) {
          if (fs.existsSync(filePath) && !registry.files.includes(filePath)) {
            const ext = path.extname(filePath).toLowerCase();
            if (ext === '.epub' || ext === '.pdf') {
              registry.files.push(filePath);
              addedCount++;
            }
          }
        }

        if (addedCount > 0) {
          saveLibraryRegistry(userId, registry);
          if (LibraryWatcher) {
            LibraryWatcher.broadcast('library-updated', { type: 'files-linked', count: addedCount });
          }
        }

        res.json({
          success: true,
          addedCount,
          message: `${addedCount} fichier(s) lié(s) à la bibliothèque avec succès !`
        });
      });
    } else {
      res.json({ success: false, message: 'Sélecteur natif Windows indisponible sur cet OS.' });
    }
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur lors de l'ouverture du sélecteur." });
  }
});

// Résolution automatique et liaison de dossier en Zéro Copie via sélecteur HTML5 webkitdirectory
app.post('/api/library/resolve-and-link-folder', async (req, res) => {
  try {
    const { folderName, sampleFiles } = req.body;
    if (!folderName || typeof folderName !== 'string') {
      return res.status(400).json({ success: false, message: 'Nom de dossier requis.' });
    }

    const cleanFolderName = path.basename(folderName.trim());
    const userProfile = process.env.USERPROFILE || process.env.HOME || 'C:\\';
    
    // Racines usuelles (Standard, OneDrive, Profil et Disques)
    const commonRoots = [
      path.join(userProfile, 'Downloads'),
      path.join(userProfile, 'Téléchargements'),
      path.join(userProfile, 'Documents'),
      path.join(userProfile, 'Desktop'),
      path.join(userProfile, 'Bureau'),
      path.join(userProfile, 'OneDrive', 'Documents'),
      path.join(userProfile, 'OneDrive', 'Desktop'),
      path.join(userProfile, 'OneDrive', 'Bureau'),
      path.join(userProfile, 'OneDrive'),
      userProfile,
      'C:\\',
      'D:\\'
    ];

    let matchedPath = null;
    let bestMatch = null;

    // 1. Recherche directe dans les dossiers usuels
    for (const root of commonRoots) {
      if (!fs.existsSync(root)) continue;
      const candidate = path.join(root, cleanFolderName);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
          bestMatch = candidate;
          if (sampleFiles && Array.isArray(sampleFiles) && sampleFiles.length > 0) {
            const filesInCandidate = fs.readdirSync(candidate);
            const hasMatch = sampleFiles.some(f => filesInCandidate.includes(f));
            if (hasMatch) {
              matchedPath = candidate;
              break;
            }
          } else {
            matchedPath = candidate;
            break;
          }
        }
      } catch (e) {}
    }

    // Si pas de correspondance exacte d'échantillon, mais qu'un dossier du même nom existe dans Downloads/Documents
    if (!matchedPath && bestMatch) {
      matchedPath = bestMatch;
    }

    // 2. Recherche à 1 niveau de profondeur dans Téléchargements et Documents
    if (!matchedPath) {
      for (const root of [path.join(userProfile, 'Downloads'), path.join(userProfile, 'Documents')]) {
        if (!fs.existsSync(root)) continue;
        try {
          const subdirs = fs.readdirSync(root, { withFileTypes: true });
          for (const s of subdirs) {
            if (s.isDirectory()) {
              const candidate = path.join(root, s.name, cleanFolderName);
              if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
                matchedPath = candidate;
                break;
              }
            }
          }
        } catch (e) {}
        if (matchedPath) break;
      }
    }

    if (!matchedPath) {
      return res.json({
        success: false,
        notFound: true,
        message: `Dossier "${cleanFolderName}" introuvable automatiquement dans vos dossiers usuels.`
      });
    }

    const userId = await getUserIdFromRequest(req);
    const registry = getLibraryRegistry(userId);
    if (!registry.folders.includes(matchedPath)) {
      registry.folders.push(matchedPath);
      saveLibraryRegistry(userId, registry);
      if (LibraryWatcher) {
        LibraryWatcher.updateWatchedFolders(registry.folders);
        LibraryWatcher.broadcast('library-updated', { type: 'folder-linked', folder: matchedPath });
      }
    }

    const bookCount = scanDirectoryFiles(matchedPath).length;
    res.json({
      success: true,
      folderPath: matchedPath,
      bookCount,
      message: `Dossier "${cleanFolderName}" connecté avec succès (${bookCount} livre(s) détecté(s)) !`
    });
  } catch (err) {
    console.error('[ResolveAndLinkFolder Error]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/library/add-path', async (req, res) => {
  let { folderPath } = req.body;
  if (!folderPath || typeof folderPath !== 'string') {
    return res.status(400).json({ success: false, message: 'Chemin de dossier requis.' });
  }
  folderPath = folderPath.trim();
  if (!fs.existsSync(folderPath)) {
    return res.status(400).json({ success: false, message: "Ce dossier n'existe pas ou n'est pas accessible." });
  }

  const userId = await getUserIdFromRequest(req);
  const registry = getLibraryRegistry(userId);
  if (!registry.folders.includes(folderPath)) {
    registry.folders.push(folderPath);
    saveLibraryRegistry(userId, registry);
    if (LibraryWatcher) {
      LibraryWatcher.updateWatchedFolders(registry.folders);
      LibraryWatcher.broadcast('library-updated', { type: 'folder-linked', folder: folderPath });
    }
  }

  const bookCount = scanDirectoryFiles(folderPath).length;
  res.json({ success: true, message: `Dossier lié avec succès (${bookCount} livre(s) détecté(s)) !`, registry });
});

app.post('/api/library/remove-path', async (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath) return res.status(400).json({ success: false, message: 'Chemin requis.' });
  
  const userId = await getUserIdFromRequest(req);
  const registry = getLibraryRegistry(userId);
  registry.folders = registry.folders.filter(p => p !== folderPath);
  saveLibraryRegistry(userId, registry);
  if (LibraryWatcher) {
    LibraryWatcher.updateWatchedFolders(registry.folders);
    LibraryWatcher.broadcast('library-updated', { type: 'folder-unlinked', folder: folderPath });
  }

  res.json({ success: true, message: 'Dossier détaché de la bibliothèque.' });
});

app.post('/api/library/remove-file', async (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ success: false, message: 'Chemin requis.' });

  const userId = await getUserIdFromRequest(req);
  const registry = getLibraryRegistry(userId);
  registry.files = registry.files.filter(f => f !== filePath);
  saveLibraryRegistry(userId, registry);
  if (LibraryWatcher) {
    LibraryWatcher.broadcast('library-updated', { type: 'file-unlinked', file: filePath });
  }

  res.json({ success: true, message: 'Fichier détaché de la bibliothèque.' });
});

// 4. Adoption automatique des dossiers Guest lors de la connexion (Option 2)
app.post('/api/library/adopt-guest', async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId || userId === 'guest' || userId.startsWith('guest_')) {
      return res.json({ success: true, message: 'Aucun compte connecté pour adopter les dossiers.' });
    }

    const db = getLibraryStore();
    const guestHeader = (req.headers['x-guest-id'] || req.body.guestId || '').toString().trim();
    
    // Identifier les clés invités à adopter (guest session spécifique + guest legacy)
    const guestKeys = new Set(['guest']);
    if (guestHeader && /^guest_[a-zA-Z0-9_-]+$/.test(guestHeader)) {
      guestKeys.add(guestHeader);
    }

    if (!db.users[userId]) {
      db.users[userId] = { folders: [], files: [] };
    }

    let adoptedCount = 0;
    for (const gKey of guestKeys) {
      const gReg = db.users[gKey];
      if (gReg) {
        (gReg.folders || []).forEach(f => {
          if (!db.users[userId].folders.includes(f)) {
            db.users[userId].folders.push(f);
            adoptedCount++;
          }
        });
        (gReg.files || []).forEach(f => {
          if (!db.users[userId].files.includes(f)) {
            db.users[userId].files.push(f);
            adoptedCount++;
          }
        });
        // Purger le conteneur invité adopté
        delete db.users[gKey];
      }
    }

    saveLibraryStore(db);
    console.log(`[Library] ${adoptedCount} dossier(s)/fichier(s) invité adoptés par le compte ${userId}`);
    res.json({ success: true, adoptedCount, userFolders: db.users[userId]?.folders || [] });
  } catch (err) {
    console.error('[AdoptGuest Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/library/explore-fs', (req, res) => {
  try {
    let targetDir = (req.query.dir || '').trim();
    const userProfile = process.env.USERPROFILE || process.env.HOME || 'C:\\';

    if (!targetDir) {
      const dl = path.join(userProfile, 'Downloads');
      targetDir = fs.existsSync(dl) ? dl : userProfile;
    }

    const drives = [];
    if (process.platform === 'win32') {
      ['C', 'D', 'E', 'F', 'G', 'H'].forEach(d => {
        const root = d + ':\\';
        try {
          if (fs.existsSync(root)) drives.push(root);
        } catch(e) {}
      });
    }

    if (!fs.existsSync(targetDir)) {
      targetDir = userProfile;
    }

    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    const folders = [];
    let bookCount = 0;

    for (const entry of entries) {
      try {
        if (entry.isDirectory() && !entry.name.startsWith('$') && !entry.name.startsWith('.')) {
          folders.push(entry.name);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (ext === '.epub' || ext === '.pdf') {
            bookCount++;
          }
        }
      } catch(e) {}
    }

    folders.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const parentDir = path.dirname(targetDir);

    res.json({
      success: true,
      currentPath: targetDir,
      parentPath: parentDir !== targetDir ? parentDir : null,
      drives,
      folders,
      bookCount
    });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

async function generateLibrary(userId = 'guest') {
  const effectiveUser = userId || 'guest';
  const allJobs = Array.from(DiskJobStore.jobs.values());
  const registry = getLibraryRegistry(effectiveUser);
  const seriesMap = new Map();
  
  function addVolume(fileData) {
    const parsed = TextNormalizer.parseFilename(fileData.filename);
    const seriesId = TextNormalizer.generateSeriesId(parsed.seriesTitle);
    
    if (!seriesMap.has(seriesId)) {
      let metaObj = { author: '', genres: [], status: '', synopsis: '', cover: null, banner: null };
      try {
        const scPath = path.join(__dirname, 'data', 'series_cache.json');
        if (fs.existsSync(scPath)) {
          const sCache = JSON.parse(fs.readFileSync(scPath, 'utf8'));
          const entry = sCache[seriesId] || Object.values(sCache).find(s => s && s.title && s.title.toLowerCase() === parsed.seriesTitle.toLowerCase());
          if (entry) {
            metaObj = {
              author: entry.author || '',
              genres: entry.genres || [],
              status: entry.status || '',
              synopsis: entry.synopsis || '',
              cover: entry.cover || null,
              banner: entry.banner || null
            };
          }
        }
      } catch(e) {}

      seriesMap.set(seriesId, {
        id: seriesId,
        title: parsed.seriesTitle,
        cover: metaObj.cover,
        banner: metaObj.banner,
        metadata: metaObj,
        volumes: []
      });
    }
    
    const series = seriesMap.get(seriesId);
    const format = fileData.hasPdf ? 'pdf' : 'epub';
    const isFrench = /[\s_-]*(?:_fr|-fr|\[fr\]|\(fr\)|vf|french)[\s_-]*/i.test(fileData.filename) || (fileData.isJob && fileData.jobData && fileData.jobData.targetLang === 'fr');
    
    const volKey = (parsed.volumeNumber !== null && parsed.volumeNumber !== undefined)
      ? `vol_${parsed.volumeNumber}`
      : `name_${TextNormalizer.generateSeriesId(parsed.cleanName)}`;
    
    const existingVol = series.volumes.find(v => v.volKey === volKey);
    
    if (!existingVol) {
      const coverUrl = `/api/download-job/${encodeURIComponent(fileData.id)}/cover`;
      series.volumes.push({
        id: fileData.id,
        volKey: volKey,
        title: parsed.volumeNumber !== null ? `Volume ${parsed.volumeNumber}` : parsed.cleanName,
        volumeNumber: parsed.volumeNumber,
        format: format,
        file: fileData.filename,
        fullPath: fileData.fullPath || null,
        cover: coverUrl,
        createdAt: fileData.createdAt,
        originalJob: fileData.isJob ? fileData.jobData : null,
        targetLang: isFrench ? 'fr' : (fileData.isJob ? fileData.jobData?.targetLang : 'Original'),
        filename: fileData.filename,
        hasTranslatedEpub: format === 'epub' && isFrench,
        hasPdf: format === 'pdf',
        isFrench: isFrench
      });
    } else {
      if (isFrench && !existingVol.isFrench) {
        existingVol.id = fileData.id;
        existingVol.format = format;
        existingVol.file = fileData.filename;
        existingVol.filename = fileData.filename;
        existingVol.isFrench = true;
        existingVol.targetLang = 'fr';
        existingVol.cover = `/api/download-job/${encodeURIComponent(fileData.id)}/cover`;
        if (fileData.isJob) {
          existingVol.originalJob = fileData.jobData;
        }
      }
      if (format === 'epub') existingVol.hasTranslatedEpub = existingVol.hasTranslatedEpub || isFrench;
      if (format === 'pdf') existingVol.hasPdf = true;
      if (fileData.createdAt && (!existingVol.createdAt || fileData.createdAt > existingVol.createdAt)) {
        existingVol.createdAt = fileData.createdAt;
      }
    }
  }

  // Note: Les jobs de traduction privés ne sont plus automatiquement injectés dans la bibliothèque.
  // L'ajout d'une œuvre traduite se fait volontairement par l'utilisateur via le bouton "+ Ajouter à ma bibliothèque".

  // B. Local Library directory (Strictement partitionné par utilisateur)
  const userLibDir = path.join(__dirname, 'data', 'local_library', effectiveUser);
  if (fs.existsSync(userLibDir)) {
    const localFiles = scanDirectoryFiles(userLibDir, 2);
    for (const item of localFiles) {
      try {
        const stats = fs.statSync(item.fullPath);
        addVolume({
          id: 'local_' + Buffer.from(item.fullPath).toString('base64'),
          filename: item.filename,
          fullPath: item.fullPath,
          createdAt: stats.mtimeMs,
          hasPdf: item.hasPdf,
          isJob: false
        });
      } catch(e) {}
    }
  }

  // C. Dossiers surveillés (récursif, 0 copie)
  for (const folder of registry.folders) {
    if (!fs.existsSync(folder)) continue;
    const detectedFiles = scanDirectoryFiles(folder, 4);
    for (const item of detectedFiles) {
      try {
        const stats = fs.statSync(item.fullPath);
        addVolume({
          id: 'external_' + Buffer.from(item.fullPath).toString('base64'),
          filename: item.filename,
          fullPath: item.fullPath,
          createdAt: stats.mtimeMs,
          hasPdf: item.hasPdf,
          isJob: false
        });
      } catch(e) {}
    }
  }

  // D. Fichiers individuels
  for (const filePath of registry.files) {
    if (!fs.existsSync(filePath)) continue;
    const filename = path.basename(filePath);
    const lower = filename.toLowerCase();
    if (lower.endsWith('.epub') || lower.endsWith('.pdf')) {
      try {
        const stats = fs.statSync(filePath);
        addVolume({
          id: 'external_' + Buffer.from(filePath).toString('base64'),
          filename: filename,
          fullPath: filePath,
          createdAt: stats.mtimeMs,
          hasPdf: lower.endsWith('.pdf'),
          isJob: false
        });
      } catch(e) {}
    }
  }

  const librarySeries = Array.from(seriesMap.values());
  librarySeries.forEach(series => {
    series.volumes.sort((a, b) => {
      if (a.volumeNumber !== null && b.volumeNumber !== null) return a.volumeNumber - b.volumeNumber;
      return b.createdAt - a.createdAt;
    });
    if (AnilistClient.cache[series.id]) {
      series.metadata = AnilistClient.cache[series.id];
    }
  });

  librarySeries.sort((a, b) => a.title.localeCompare(b.title));
  return librarySeries;
}

// 1. GET /api/library : Liste complète des séries de la bibliothèque
app.get('/api/library', async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    const library = await generateLibrary(userId);
    res.json({ success: true, library });
  } catch(e) {
    console.error('[API Library Error]', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// 2. GET /api/series/:id : Détails d'une série (Bibliothèque locale OU Catalogue)
app.get('/api/series/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = await getUserIdFromRequest(req);
    const library = await generateLibrary(userId);
    let series = library.find(s => s.id === id || s.id.toLowerCase() === id.toLowerCase());

    // Canonical slug fallback if id had volume suffix (e.g. agents-of-the-four-seasons-v02-...)
    if (!series) {
      try {
        const parsed = TextNormalizer.parseFilename(id);
        const canonId = TextNormalizer.generateSeriesId(parsed.seriesTitle);
        series = library.find(s => s.id === canonId || s.id.toLowerCase() === canonId.toLowerCase());
      } catch(e) {}
    }

    // Sécurité & Confidentialité: Pas de recherche croisée dans les bibliothèques privées des autres utilisateurs

    // Fallback: Catalogue public (filtré par droits d'accès)
    if (!series && typeof CatalogService !== 'undefined') {
      const authUser = await authenticateUser(req);
      series = CatalogService.getSeries(id, authUser);
      if (!series) {
        try {
          const parsed = TextNormalizer.parseFilename(id);
          const canonId = TextNormalizer.generateSeriesId(parsed.seriesTitle);
          series = CatalogService.getSeries(canonId, authUser);
        } catch(e) {}
      }
    }

    if (series) {
      let catalogStatus = null;
      let catalogRejectionReason = null;
      if (typeof CatalogService !== 'undefined') {
        const catSeries = CatalogService.getSeries(series.id);
        if (catSeries) {
          catalogStatus = catSeries.publication_status || 'PUBLISHED';
          catalogRejectionReason = catSeries.rejection_reason || null;
        }
      }
      series.catalogStatus = catalogStatus;
      series.catalogRejectionReason = catalogRejectionReason;
      res.json({ success: true, series });
    } else {
      res.status(404).json({ success: false, message: 'Série introuvable' });
    }
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 3. GET /api/series/:id/metadata : Récupération cascade AniList / Kitsu / MangaDex
app.get('/api/series/:id/metadata', async (req, res) => {
  try {
    const { id } = req.params;
    const title = req.query.title || id;
    let metadata = AnilistClient.cache[id];
    if (!metadata) {
      metadata = await AnilistMetadataTranslator.get(id, title);
    }
    res.json({ success: true, metadata });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ==========================================================================
// CATALOG API ROUTES (Guest First & Discovery)
// ==========================================================================

// GET /api/catalog - Full catalog list for admin and hub (Filtrage de publication sécurisé)
app.get('/api/catalog', async (req, res) => {
  try {
    const data = CatalogService.loadData();
    let novels = data.series || [];
    // Si l'utilisateur demande explicitement le statut complet et est admin
    const authUser = await authenticateUser(req);
    const isAdmin = authUser && authUser.role === 'ADMIN';
    if (!isAdmin || req.query.all !== 'true') {
      novels = novels.filter(s => (s.publication_status || 'PUBLISHED').toUpperCase() === 'PUBLISHED');
    }
    res.json({ success: true, novels });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/catalog/series/:id/toggle-featured', async (req, res) => {
  try {
    const authUser = await authenticateUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: 'Authentification requise.' });
    }
    const { id } = req.params;
    const series = CatalogService.getSeries(id, authUser);
    if (!series) return res.status(404).json({ success: false, message: 'Série non trouvée.' });

    const role = (authUser.role || '').toUpperCase();
    const isAdmin = role === 'ADMIN' || (authUser.email || '').toLowerCase() === 'admin@noveltrad.com';

    if (!isAdmin) {
      return res.status(403).json({ success: false, message: 'Action strictement réservée aux administrateurs.' });
    }

    const result = CatalogService.toggleFeatured(id);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/catalog/featured', (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    const featured = CatalogService.getFeatured();
    res.json({ success: true, featured });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/catalog/explore', (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    const { q, genre, status, format, origin, sort, page, limit } = req.query;
    const result = CatalogService.getExplore({ q, genre, status, format, origin, sort, page, limit });
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/catalog/series/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const authUser = await authenticateUser(req);
    const series = CatalogService.getSeries(id, authUser);
    if (series) {
      return res.json({ success: true, inCatalog: true, series });
    }
    // Si la série n'est pas dans le catalogue public (ex: livre local de l'utilisateur),
    // on renvoie une réponse positive avec inCatalog: false pour éviter de polluer la console avec un 404
    return res.json({ success: true, inCatalog: false, series: null, message: 'Série non présente dans le catalogue public (bibliothèque locale)' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/catalog/series/:id/chapters/:num', (req, res) => {
  try {
    const { id, num } = req.params;
    const chapter = CatalogService.getChapter(id, num);
    if (chapter) {
      res.json({ success: true, chapter });
    } else {
      res.status(404).json({ success: false, message: 'Chapitre introuvable' });
    }
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/catalog/series/:id/like', (req, res) => {
  try {
    const { id } = req.params;
    const likes = CatalogService.likeSeries(id);
    res.json({ success: true, likes });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});


// =============================================================================
// NOVELTRAD — EDITORIAL & PLANNING API ENDPOINTS
// =============================================================================
const EDITORIAL_DB_PATH = path.join(__dirname, 'data/editorial_db.json');

function loadEditorialDb() {
  try {
    if (!fs.existsSync(EDITORIAL_DB_PATH)) {
      return { news: [], schedule: [] };
    }
    return JSON.parse(fs.readFileSync(EDITORIAL_DB_PATH, 'utf8'));
  } catch(e) {
    console.error('[EditorialDB] Error reading DB:', e);
    return { news: [], schedule: [] };
  }
}

function saveEditorialDb(data) {
  try {
    fs.writeFileSync(EDITORIAL_DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch(e) {
    console.error('[EditorialDB] Error writing DB:', e);
    return false;
  }
}

// GET /api/editorial/schedule
app.get('/api/editorial/schedule', (req, res) => {
  try {
    const db = loadEditorialDb();
    res.json({ success: true, schedule: db.schedule || [] });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// PUT /api/editorial/schedule/:id (Toggle status or update release)
app.put('/api/editorial/schedule/:id', async (req, res) => {
  try {
    const authUser = await authenticateUser(req);
    if (!authUser || (!authUser.is_admin && !authUser.is_contributor && authUser.role !== 'ADMIN' && authUser.role !== 'CONTRIBUTOR')) {
      return res.status(403).json({ success: false, message: 'Accès non autorisé.' });
    }
    const db = loadEditorialDb();
    if (!db.schedule) db.schedule = [];
    const itemIndex = db.schedule.findIndex(s => s.id === req.params.id);
    if (itemIndex === -1) {
      return res.status(404).json({ success: false, message: 'Entrée non trouvée.' });
    }
    const current = db.schedule[itemIndex];
    if (!authUser.is_admin && current.createdBy && current.createdBy !== authUser.id) {
      return res.status(403).json({ success: false, message: 'Permission refusée.' });
    }

    const { status, statusLabel, releaseDate, time, volumeOrChapter, seriesTitle, team, coverUrl, type } = req.body;
    if (status !== undefined) current.status = status;
    if (statusLabel !== undefined) current.statusLabel = statusLabel;
    else if (status === 'released') current.statusLabel = 'Disponible !';
    else if (status === 'upcoming') current.statusLabel = 'À paraître';

    if (releaseDate !== undefined) {
      current.releaseDate = releaseDate;
      const d = new Date(releaseDate + 'T00:00:00');
      if (!isNaN(d.getTime())) {
        current.dayOfWeek = d.getDay();
        const daysFr = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
        current.dayName = daysFr[d.getDay()];
      }
    }
    if (time !== undefined) current.time = time;
    if (volumeOrChapter !== undefined) current.volumeOrChapter = volumeOrChapter;
    if (seriesTitle !== undefined) current.seriesTitle = seriesTitle;
    if (team !== undefined) current.team = team;
    if (coverUrl !== undefined) current.coverUrl = coverUrl;
    if (type !== undefined) current.type = type;
    current.updatedAt = new Date().toISOString();

    db.schedule[itemIndex] = current;
    saveEditorialDb(db);
    res.json({ success: true, scheduleItem: current });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/editorial/news
app.get('/api/editorial/news', (req, res) => {
  try {
    const db = loadEditorialDb();
    res.json({ success: true, news: db.news || [] });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/editorial/schedule (Admin or Contributor)
app.post('/api/editorial/schedule', async (req, res) => {
  try {
    const authUser = await authenticateUser(req);
    if (!authUser || (!authUser.is_admin && !authUser.is_contributor && authUser.role !== 'ADMIN' && authUser.role !== 'CONTRIBUTOR')) {
      return res.status(403).json({ success: false, message: 'Accès réservé aux contributeurs et administrateurs.' });
    }
    const { seriesId, seriesTitle, volumeOrChapter, type, dayOfWeek, dayName, time, status, statusLabel, team, coverUrl, releaseDate } = req.body;
    if (!seriesTitle || !volumeOrChapter) {
      return res.status(400).json({ success: false, message: 'Titre de la série et volume/chapitre requis.' });
    }
    const db = loadEditorialDb();
    if (!db.schedule) db.schedule = [];

    let computedDay = Number(dayOfWeek) || 0;
    let computedDayName = dayName || 'Lundi';
    let finalReleaseDate = releaseDate || '';

    if (finalReleaseDate) {
      const d = new Date(finalReleaseDate + 'T00:00:00');
      if (!isNaN(d.getTime())) {
        computedDay = d.getDay();
        const daysFr = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
        computedDayName = daysFr[d.getDay()];
      }
    } else {
      // Default to upcoming date for this dayOfWeek
      const now = new Date();
      const currentDay = now.getDay();
      const diff = (computedDay - currentDay + 7) % 7;
      const targetDate = new Date(now.getTime() + diff * 86400000);
      finalReleaseDate = targetDate.toISOString().split('T')[0];
    }
    
    const newEntry = {
      id: 'sched_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      seriesId: seriesId || '',
      seriesTitle,
      volumeOrChapter,
      type: type || 'light_novel',
      releaseDate: finalReleaseDate,
      dayOfWeek: computedDay,
      dayName: computedDayName,
      time: time || '18:00',
      status: status || 'upcoming',
      statusLabel: statusLabel || (status === 'released' ? 'Disponible !' : 'À paraître'),
      team: team || (authUser.user_metadata?.full_name || authUser.email || 'Contributeur'),
      coverUrl: coverUrl || '',
      createdBy: authUser.id,
      updatedAt: new Date().toISOString()
    };
    db.schedule.push(newEntry);
    saveEditorialDb(db);
    res.json({ success: true, scheduleItem: newEntry });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// DELETE /api/editorial/schedule/:id (Admin or Creator)
app.delete('/api/editorial/schedule/:id', async (req, res) => {
  try {
    const authUser = await authenticateUser(req);
    if (!authUser || (!authUser.is_admin && !authUser.is_contributor && authUser.role !== 'ADMIN' && authUser.role !== 'CONTRIBUTOR')) {
      return res.status(403).json({ success: false, message: 'Accès non autorisé.' });
    }
    const db = loadEditorialDb();
    const itemIndex = (db.schedule || []).findIndex(s => s.id === req.params.id);
    if (itemIndex === -1) {
      return res.status(404).json({ success: false, message: 'Entrée non trouvée.' });
    }
    if (!authUser.is_admin && db.schedule[itemIndex].createdBy !== authUser.id) {
      return res.status(403).json({ success: false, message: 'Seul le créateur ou un administrateur peut supprimer cette programmation.' });
    }
    db.schedule.splice(itemIndex, 1);
    saveEditorialDb(db);
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/editorial/news (Admin only)
app.post('/api/editorial/news', async (req, res) => {
  try {
    const authUser = await authenticateUser(req);
    if (!authUser || (!authUser.is_admin && authUser.role !== 'ADMIN')) {
      return res.status(403).json({ success: false, message: 'Seul un administrateur peut publier des actualités.' });
    }
    const { title, category, excerpt, content, imageUrl, pinned, seriesId } = req.body;
    if (!title || !content) {
      return res.status(400).json({ success: false, message: 'Titre et contenu obligatoires.' });
    }
    const db = loadEditorialDb();
    if (!db.news) db.news = [];
    const newArticle = {
      id: 'news_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      title,
      category: category || 'Annonce',
      excerpt: excerpt || content.substring(0, 150) + '...',
      content,
      imageUrl: imageUrl || '',
      pinned: Boolean(pinned),
      seriesId: seriesId || null,
      author: authUser.user_metadata?.full_name || authUser.email || 'Équipe NovelTrad',
      authorRole: 'admin',
      createdAt: new Date().toISOString()
    };
    db.news.unshift(newArticle);
    saveEditorialDb(db);
    res.json({ success: true, news: newArticle });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// PUT /api/editorial/news/:id (Admin only: update article or toggle pinned)
app.put('/api/editorial/news/:id', async (req, res) => {
  try {
    const authUser = await authenticateUser(req);
    if (!authUser || (!authUser.is_admin && authUser.role !== 'ADMIN')) {
      return res.status(403).json({ success: false, message: 'Seul un administrateur peut modifier des actualités.' });
    }
    const db = loadEditorialDb();
    if (!db.news) db.news = [];
    const itemIndex = db.news.findIndex(n => n.id === req.params.id);
    if (itemIndex === -1) {
      return res.status(404).json({ success: false, message: 'Article non trouvé.' });
    }
    const current = db.news[itemIndex];
    const { title, category, excerpt, content, imageUrl, pinned, seriesId } = req.body;
    if (title !== undefined) current.title = title;
    if (category !== undefined) current.category = category;
    if (excerpt !== undefined) current.excerpt = excerpt;
    if (content !== undefined) current.content = content;
    if (imageUrl !== undefined) current.imageUrl = imageUrl;
    if (pinned !== undefined) current.pinned = Boolean(pinned);
    if (seriesId !== undefined) current.seriesId = seriesId;
    current.updatedAt = new Date().toISOString();

    db.news[itemIndex] = current;
    saveEditorialDb(db);
    res.json({ success: true, news: current });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// DELETE /api/editorial/news/:id (Admin only)
app.delete('/api/editorial/news/:id', async (req, res) => {
  try {
    const authUser = await authenticateUser(req);
    if (!authUser || (!authUser.is_admin && authUser.role !== 'ADMIN')) {
      return res.status(403).json({ success: false, message: 'Seul un administrateur peut supprimer des actualités.' });
    }
    const db = loadEditorialDb();
    const itemIndex = (db.news || []).findIndex(n => n.id === req.params.id);
    if (itemIndex === -1) {
      return res.status(404).json({ success: false, message: 'Article non trouvé.' });
    }
    db.news.splice(itemIndex, 1);
    saveEditorialDb(db);
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/catalog/series/:id/view', async (req, res) => {
  try {
    const { id } = req.params;
    const views = CatalogService.incrementViews(id);
    if (supabase && id) {
      try {
        await supabase.from('series_views').upsert({
          series_id: String(id),
          views: Number(views) || 1,
          updated_at: new Date().toISOString()
        }, { onConflict: 'series_id' });
      } catch (supaErr) {
        // Silent catch for Supabase sync
      }
    }
    res.json({ success: true, views });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Cache mémoire pour les couvertures extraites (accélération 0ms)
const CoverCache = new Map();

// ==========================================================================
// UNIFIED FILE & COVER SERVING (Local Library, Catalog, Jobs & External)
// ==========================================================================

app.get(['/api/download-job/:jobId', '/api/download-job/:jobId/*'], async (req, res) => {
  const rawParam = req.params.jobId || '';
  const subPath = req.params[0] || '';
  if (subPath && !subPath.startsWith('cover')) {
    return res.status(404).send('Sub-resource non servie');
  }
  const isCoverRequest = req.url.includes('/cover') || rawParam.endsWith('/cover');
  
  // Nettoyer l'ID en retirant le suffixe /cover éventuel
  let jobId = rawParam.split('/')[0];
  if (jobId.endsWith('/cover')) jobId = jobId.replace(/\/cover$/, '');
  
  const decodedJobId = decodeURIComponent(jobId);
  const cleanId = rawParam.replace(/\/cover\/?$/, '');
  const decodedCleanId = decodeURIComponent(cleanId);

  // A. Traitement dédié aux REQUÊTES DE COUVERTURE (/cover)
  if (isCoverRequest) {
    // 1. Vérification dans le cache mémoire
    if (CoverCache.has(jobId)) {
      const cached = CoverCache.get(jobId);
      res.setHeader('Content-Type', cached.mediaType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(cached.buffer);
    }

    // 2. Si c'est un Job avec couverture URL externe
    const job = DiskJobStore.getJob(jobId);
    if (job && job.cover && /^https?:\/\//i.test(job.cover)) {
      return res.redirect(job.cover);
    }

    // 3. Résolution du fichier source sur disque
    let targetFilePath = null;

    // Fichier externe en Base64
    if (jobId.startsWith('external_')) {
      try {
        const base64Part = jobId.replace('external_', '');
        const p = Buffer.from(base64Part, 'base64').toString('utf8');
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          targetFilePath = p;
        }
      } catch(e) {}
    }

    // Fichier local utilisateur en Base64
    if (jobId.startsWith('local_')) {
      try {
        const base64Part = jobId.replace('local_', '');
        const p = Buffer.from(base64Part, 'base64').toString('utf8');
        const allowedBase = path.resolve(__dirname, 'data', 'local_library');
        const resolvedP = path.resolve(p);
        if (resolvedP.startsWith(allowedBase) && fs.existsSync(resolvedP) && fs.statSync(resolvedP).isFile()) {
          targetFilePath = resolvedP;
        }
      } catch(e) {}
    }

    // Fichier dans data/local_library
    if (!targetFilePath) {
      for (const candidate of [cleanId, decodedCleanId, jobId, decodedJobId]) {
        if (!candidate) continue;
        const p = path.join(__dirname, 'data', 'local_library', candidate);
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          targetFilePath = p;
          break;
        }
      }
    }

    // Fichier dans data/catalog
    if (!targetFilePath) {
      for (const candidate of [cleanId, decodedCleanId, jobId, decodedJobId]) {
        if (!candidate) continue;
        const p = path.join(__dirname, 'data', 'catalog', candidate);
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          targetFilePath = p;
          break;
        }
      }
    }

    // Fichier dans data/jobs
    if (!targetFilePath && job) {
      const jobEpub = path.join(__dirname, 'data', 'jobs', jobId, 'translated.epub');
      const jobSrcEpub = path.join(__dirname, 'data', 'jobs', jobId, 'source.epub');
      if (fs.existsSync(jobEpub)) targetFilePath = jobEpub;
      else if (fs.existsSync(jobSrcEpub)) targetFilePath = jobSrcEpub;
    }

    // 4a. Extraction de couverture si le fichier est un EPUB
    if (targetFilePath && targetFilePath.toLowerCase().endsWith('.epub')) {
      try {
        const epubBuffer = fs.readFileSync(targetFilePath);
        const cover = await EpubProcessor.extractCover(epubBuffer);
        if (cover && cover.buffer) {
          let outBuf = cover.buffer;
          let mime = cover.mediaType;
          try {
            const sharpInstance = typeof sharp === 'function' ? sharp : require('sharp');
            outBuf = await sharpInstance(cover.buffer)
              .resize({ width: 360, withoutEnlargement: true })
              .webp({ quality: 80, effort: 4 })
              .toBuffer();
            mime = 'image/webp';
          } catch(e) {}

          if (CoverCache.size > 300) {
            const firstKey = CoverCache.keys().next().value;
            CoverCache.delete(firstKey);
          }
          CoverCache.set(jobId, { buffer: outBuf, mediaType: mime });

          res.setHeader('Content-Type', mime);
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          return res.send(outBuf);
        }
      } catch (err) {
        console.warn('[Cover Extraction Error]', err.message);
      }
    }

    // 4b. Extraction de couverture si le fichier est un PDF
    if (targetFilePath && targetFilePath.toLowerCase().endsWith('.pdf')) {
      try {
        const { PDFDocument, PDFName, PDFRawStream } = require('pdf-lib');
        const pdfBuffer = fs.readFileSync(targetFilePath);
        const pdfDoc = await PDFDocument.load(pdfBuffer, { updateMetadata: false });
        const maxPages = Math.min(3, pdfDoc.getPageCount());
        let largestImg = null;
        for (let pIdx = 0; pIdx < maxPages; pIdx++) {
          const page = pdfDoc.getPage(pIdx);
          const resources = page.node.Resources();
          if (!resources) continue;
          const xObject = resources.lookup(PDFName.of('XObject'));
          if (!xObject) continue;
          for (const k of xObject.keys()) {
            const obj = xObject.lookup(k);
            if (obj instanceof PDFRawStream) {
              const filter = obj.dict.lookup(PDFName.of('Filter'));
              if (filter && filter.value() === '/DCTDecode') {
                if (!largestImg || obj.contents.length > largestImg.length) {
                  largestImg = obj.contents;
                }
              }
            }
          }
          if (largestImg && largestImg.length > 20000) break;
        }

        if (largestImg) {
          const sharpInstance = typeof sharp === 'function' ? sharp : require('sharp');
          const webpBuf = await sharpInstance(largestImg)
            .resize({ width: 360, withoutEnlargement: true })
            .webp({ quality: 80, effort: 4 })
            .toBuffer();

          if (CoverCache.size > 300) {
            const firstKey = CoverCache.keys().next().value;
            CoverCache.delete(firstKey);
          }
          CoverCache.set(jobId, { buffer: webpBuf, mediaType: 'image/webp' });

          res.setHeader('Content-Type', 'image/webp');
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          return res.send(webpBuf);
        }
      } catch (pdfErr) {
        console.warn('[PDF Cover Extraction Error]', pdfErr.message);
      }
    }

    // 5. Fallback Métadonnées Série (Cache Local series_cache.json -> AniList / Kitsu)
    try {
      const parsed = TextNormalizer.parseFilename(decodedCleanId || decodedJobId);
      const seriesId = TextNormalizer.generateSeriesId(parsed.seriesTitle);

      // A. Vérifier dans data/series_cache.json
      const seriesCachePath = path.join(__dirname, 'data', 'series_cache.json');
      if (fs.existsSync(seriesCachePath)) {
        try {
          const sCache = JSON.parse(fs.readFileSync(seriesCachePath, 'utf8'));
          const entry = sCache[seriesId] || Object.values(sCache).find(s => s && s.title && s.title.toLowerCase() === parsed.seriesTitle.toLowerCase());
          if (entry && entry.cover && /^https?:\/\//i.test(entry.cover)) {
            return res.redirect(`/api/cover-proxy?url=${encodeURIComponent(entry.cover)}`);
          }
        } catch(e) {}
      }

      // B. Vérifier cache mémoire Anilist
      const meta = AnilistClient.cache[seriesId];
      if (meta && meta.cover && /^https?:\/\//i.test(meta.cover)) {
        return res.redirect(`/api/cover-proxy?url=${encodeURIComponent(meta.cover)}`);
      }
    } catch(e) {}

    return res.status(404).json({ error: true, message: 'Couverture introuvable.' });
  }

  // B. Fichier externe en Base64 (Zero-copy)
  if (jobId.startsWith('external_')) {
    try {
      const base64Part = jobId.replace('external_', '');
      const filePath = Buffer.from(base64Part, 'base64').toString('utf8');
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const allowedExts = ['.pdf', '.epub', '.txt'];
        if (!allowedExts.includes(ext)) {
          return res.status(403).json({ error: true, message: 'Type de fichier non autorisé.' });
        }
        if (ext === '.pdf') res.setHeader('Content-Type', 'application/pdf');
        if (ext === '.epub') res.setHeader('Content-Type', 'application/epub+zip');
        if (ext === '.txt') res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent(path.basename(filePath)) + '"');
        return res.sendFile(filePath);
      }
    } catch(e) {}
  }

  // B.2 Fichier local utilisateur en Base64
  if (jobId.startsWith('local_')) {
    try {
      const base64Part = jobId.replace('local_', '');
      const filePath = Buffer.from(base64Part, 'base64').toString('utf8');
      const allowedBase = path.resolve(__dirname, 'data', 'local_library');
      const resolvedP = path.resolve(filePath);
      if (resolvedP.startsWith(allowedBase) && fs.existsSync(resolvedP) && fs.statSync(resolvedP).isFile()) {
        const ext = path.extname(resolvedP).toLowerCase();
        if (ext === '.pdf') res.setHeader('Content-Type', 'application/pdf');
        if (ext === '.epub') res.setHeader('Content-Type', 'application/epub+zip');
        res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent(path.basename(resolvedP)) + '"');
        return res.sendFile(resolvedP);
      }
    } catch(e) {}
  }

  // C. Fichier dans data/local_library
  for (const candidate of [cleanId, decodedCleanId, rawParam, decodeURIComponent(rawParam), jobId, decodedJobId]) {
    if (!candidate) continue;
    const safeCandidate = path.basename(candidate);
    const localLibFile = path.join(__dirname, 'data', 'local_library', safeCandidate);
    if (fs.existsSync(localLibFile) && fs.statSync(localLibFile).isFile()) {
      const ext = path.extname(localLibFile).toLowerCase();
      if (ext === '.pdf') res.setHeader('Content-Type', 'application/pdf');
      if (ext === '.epub') res.setHeader('Content-Type', 'application/epub+zip');
      res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent(candidate) + '"');
      return res.sendFile(localLibFile);
    }
  }

  // D. Fichier dans data/catalog
  for (const candidate of [cleanId, decodedCleanId, rawParam, decodeURIComponent(rawParam), jobId, decodedJobId]) {
    if (!candidate) continue;
    const safeCatalogCandidate = path.basename(candidate);
    const catalogFile = path.join(__dirname, 'data', 'catalog', safeCatalogCandidate);
    if (fs.existsSync(catalogFile) && fs.statSync(catalogFile).isFile()) {
      const ext = path.extname(catalogFile).toLowerCase();
      if (ext === '.pdf') res.setHeader('Content-Type', 'application/pdf');
      if (ext === '.epub') res.setHeader('Content-Type', 'application/epub+zip');
      res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent(candidate) + '"');
      return res.sendFile(catalogFile);
    }
  }

  // E. Translation download jobs
  const job = DiskJobStore.getJob(jobId);
  if (job) {
    // Sécurisation accès : vérification du secretToken ou rôle ADMIN
    const requestedToken = req.query.token || req.headers['x-secret-token'];
    let authorized = false;

    if (requestedToken && job.secretToken && requestedToken === job.secretToken) {
      authorized = true;
    }

    if (!authorized) {
      try {
        const user = await authenticateUser(req);
        if (user && user.role === 'ADMIN') {
          authorized = true;
        }
      } catch (e) {}
    }

    if (!authorized) {
      return res.status(403).json({ error: true, message: 'Accès refusé. Jeton secret de traduction invalide ou manquant.' });
    }

    const ext = job.type === 'pdf' ? '.pdf' : (job.type === 'epub' ? '.epub' : '.txt');
    const buffer = await DiskJobStore.getTranslatedBuffer(jobId, ext);
    if (buffer) {
      let mimeType = 'text/plain';
      if (ext === '.pdf') mimeType = 'application/pdf';
      if (ext === '.epub') mimeType = 'application/epub+zip';
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent(job.filename || 'document') + '"');
      return res.send(buffer);
    }
  }

  return res.status(404).json({ error: true, message: 'Fichier introuvable.' });
});

// Fallback pour toutes les routes SPA

// =============================================================================
// NOVELTRAD D4 — SECURE API ENDPOINTS: CONTRIBUTOR STUDIO & ADMINISTRATION
// =============================================================================

// Helper: Cryptographically Verify Supabase JWT & Extract User Profile from Authorization Header
async function authenticateUser(req) {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.substring(7).trim();
    if (!token) return null;

    try {
        if (!supabase) {
            console.warn('[AuthMiddleware] Supabase client non initialisé');
            return null;
        }

        // 1. Validation cryptographique officielle auprès de Supabase
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data || !data.user) {
            return null;
        }

        const user = data.user;
        const userEmail = (user.email || '').toLowerCase();

        // 2. Détermination du rôle vérifié en temps réel : Supabase Cloud en autorité prioritaire absolue
        let userRole = 'USER';
        let displayName = user.user_metadata?.display_name || user.user_metadata?.full_name || (user.email ? user.email.split('@')[0] : 'Utilisateur');
        let avatarUrl = user.user_metadata?.avatar_url || '';

        let roleFoundInSupabase = false;
        const clientForProfiles = supabaseAdmin || supabase;

        // PRIORITÉ 1 (Source de vérité absolue) : Interroger la table profiles de Supabase Cloud
        if (clientForProfiles) {
            try {
                const { data: profData, error: profErr } = await clientForProfiles
                    .from('profiles')
                    .select('role, display_name, avatar_url')
                    .eq('id', user.id)
                    .single();
                if (!profErr && profData) {
                    if (profData.role) {
                        userRole = profData.role.toUpperCase();
                        roleFoundInSupabase = true;
                    }
                    if (profData.display_name) {
                        displayName = profData.display_name;
                    }
                    if (profData.avatar_url) {
                        avatarUrl = profData.avatar_url;
                    }
                }
            } catch (supaErr) {
                console.warn('[AuthMiddleware] Supabase profiles query notice:', supaErr.message);
            }
        }

        // PRIORITÉ 2 (Filet de sécurité / Secours local si Supabase est hors-ligne)
        const localUsers = loadUsersRoles();
        const foundLocal = localUsers.find(u => u.id === user.id || (u.email && u.email.toLowerCase() === userEmail));

        if (!roleFoundInSupabase && foundLocal) {
            if (foundLocal.role) {
                userRole = foundLocal.role.toUpperCase();
            }
            if (foundLocal.display_name && !displayName) {
                displayName = foundLocal.display_name;
            }
            if (foundLocal.avatar_url && !avatarUrl) {
                avatarUrl = foundLocal.avatar_url;
            }
        }

        // PRIORITÉ 3 : Métadonnées Supabase Auth de secours
        if (!roleFoundInSupabase && (!foundLocal || !foundLocal.role)) {
            if (user.app_metadata?.role) {
                userRole = user.app_metadata.role.toUpperCase();
            } else if (user.user_metadata?.role) {
                userRole = user.user_metadata.role.toUpperCase();
            }
        }

        // Seul l'administrateur officiel configuré ou rôle ADMIN confirmé en base
        if (userEmail === 'admin@noveltrad.com' || userEmail === 'japhetikoume@gmail.com' || userEmail === 'ikoumejaphet@gmail.com') {
            userRole = 'ADMIN';
        }

        const roleUpper = (userRole || 'USER').toUpperCase();
        const isAdmin = (roleUpper === 'ADMIN');
        const isContributor = (roleUpper === 'CONTRIBUTOR') || isAdmin;

        const userObj = {
            id: user.id,
            email: user.email || '',
            role: userRole,
            is_admin: isAdmin,
            is_contributor: isContributor,
            display_name: displayName,
            avatar_url: avatarUrl
        };

        try {
            recordUserActivity(userObj.id, userObj.email, userObj.role, userObj.display_name, userObj.avatar_url);
        } catch(e) {}

        return userObj;
    } catch (e) {
        console.warn('[AuthMiddleware] Erreur vérification token:', e.message);
        return null;
    }
}

// ── 1. ROLE & AUTHENTICATION MIDDLEWARES ─────────────────────────────────

async function requireAuth(req, res, next) {
    const user = await authenticateUser(req);
    if (!user) {
        return res.status(401).json({ success: false, error: 'Authentification requise.' });
    }
    req.user = user;
    next();
}

async function requireContributor(req, res, next) {
    const user = await authenticateUser(req);
    if (!user) {
        return res.status(401).json({ success: false, error: 'Authentification requise.' });
    }
    const role = (user.role || 'USER').toUpperCase();
    if (role !== 'CONTRIBUTOR' && role !== 'ADMIN') {
        return res.status(403).json({ success: false, error: 'Accès refusé. Rôle Contributeur ou Admin requis.' });
    }
    req.user = user;
    next();
}

async function requireAdmin(req, res, next) {
    const user = await authenticateUser(req);
    if (!user) {
        return res.status(401).json({ success: false, error: 'Authentification requise.' });
    }
    const role = (user.role || 'USER').toUpperCase();
    if (role !== 'ADMIN') {
        return res.status(403).json({ success: false, error: 'Accès réservé aux Administrateurs.' });
    }
    req.user = user;
    next();
}

// GET /api/auth/profile - Fetch verified profile & role of current authenticated user
app.get('/api/auth/profile', requireAuth, (req, res) => {
    res.json({
        success: true,
        user: {
            id: req.user.id,
            email: req.user.email,
            display_name: req.user.display_name,
            avatar_url: req.user.avatar_url || '',
            role: req.user.role
        }
    });
});

// PUT /api/auth/profile - Update display_name & avatar_url of current authenticated user
app.put('/api/auth/profile', requireAuth, async (req, res) => {
    try {
        let { display_name, avatar_url } = req.body || {};
        const userId = req.user.id;
        const userEmail = req.user.email || '';

        // 1. Sanitize & validate display_name
        let cleanDisplayName = undefined;
        if (display_name !== undefined) {
            cleanDisplayName = String(display_name).trim().replace(/[<>]/g, '');
            if (cleanDisplayName.length < 2 || cleanDisplayName.length > 32) {
                return res.status(400).json({
                    success: false,
                    error: 'Le pseudonyme doit comporter entre 2 et 32 caractères.'
                });
            }
        }

        // 2. Validate avatar_url
        let cleanAvatarUrl = undefined;
        if (avatar_url !== undefined) {
            cleanAvatarUrl = String(avatar_url).trim();
            if (cleanAvatarUrl.length > 500) {
                return res.status(400).json({
                    success: false,
                    error: 'L\'URL d\'avatar ne doit pas dépasser 500 caractères.'
                });
            }
        }

        const updates = {};
        if (cleanDisplayName !== undefined) updates.display_name = cleanDisplayName;
        if (cleanAvatarUrl !== undefined) updates.avatar_url = cleanAvatarUrl;
        updates.updated_at = new Date().toISOString();

        // 3. Update Supabase profiles table if available
        const clientForProfiles = supabaseAdmin || supabase;
        if (clientForProfiles) {
            try {
                await clientForProfiles
                    .from('profiles')
                    .upsert({ id: userId, email: userEmail, ...updates }, { onConflict: 'id' });
            } catch (err) {
                console.warn('[ProfileUpdate] Supabase profiles warning:', err.message);
            }
        }

        // 4. Update Supabase auth user_metadata if admin client available
        if (supabaseAdmin && supabaseAdmin.auth?.admin) {
            try {
                await supabaseAdmin.auth.admin.updateUserById(userId, {
                    user_metadata: { ...updates }
                });
            } catch (err) {
                console.warn('[ProfileUpdate] Supabase auth metadata warning:', err.message);
            }
        }

        // 5. Update local users_roles.json
        const localUsers = loadUsersRoles();
        let target = localUsers.find(u => u.id === userId || (u.email && u.email.toLowerCase() === userEmail.toLowerCase()));
        if (target) {
            if (cleanDisplayName !== undefined) target.display_name = cleanDisplayName;
            if (cleanAvatarUrl !== undefined) target.avatar_url = cleanAvatarUrl;
            target.updated_at = new Date().toISOString();
        } else {
            target = {
                id: userId,
                email: userEmail,
                display_name: cleanDisplayName || (userEmail ? userEmail.split('@')[0] : 'Lecteur'),
                avatar_url: cleanAvatarUrl || '',
                role: req.user.role || 'USER',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            localUsers.push(target);
        }
        saveUsersRoles(localUsers);

        console.log(`[ProfileUpdate] Profil mis à jour pour ${userEmail}: pseudo="${cleanDisplayName || target.display_name}", avatar="${cleanAvatarUrl || target.avatar_url}"`);

        res.json({
            success: true,
            message: 'Profil mis à jour avec succès.',
            user: {
                id: userId,
                email: userEmail,
                display_name: cleanDisplayName !== undefined ? cleanDisplayName : (target.display_name || ''),
                avatar_url: cleanAvatarUrl !== undefined ? cleanAvatarUrl : (target.avatar_url || ''),
                role: req.user.role
            }
        });
    } catch (e) {
        console.error('[ProfileUpdate Error]', e);
        res.status(500).json({ success: false, error: e.message });
    }
});



// GET /api/proxy-image - Safe image proxy for Canvas quote cards to avoid CORS tainting
app.get('/api/proxy-image', async (req, res) => {
  try {
    const rawUrl = req.query.url;
    if (!rawUrl || (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://'))) {
      return res.status(400).send('URL d\'image invalide.');
    }
    const response = await fetch(rawUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    if (!response.ok) return res.status(response.status).send('Erreur chargement image distante.');
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (e) {
    res.status(500).send('Erreur proxy image: ' + e.message);
  }
});

// =============================================================================
// IN-LINE PARAGRAPH COMMENTS API (PHASE 2)
// =============================================================================

// GET /api/comments/counts - Get count of comments per paragraph
app.get('/api/comments/counts', async (req, res) => {
  try {
    const { bookKey, chapter } = req.query;
    if (!bookKey) return res.status(400).json({ success: false, error: 'bookKey requis.' });
    const counts = await CommentService.getCounts(bookKey, chapter);
    res.json({ success: true, counts });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/comments/:bookKey/:paragraphId - Get comments for a specific paragraph
app.get('/api/comments/:bookKey/:paragraphId', async (req, res) => {
  try {
    const { bookKey, paragraphId } = req.params;
    const comments = await CommentService.getComments(bookKey, paragraphId);
    res.json({ success: true, comments });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/comments/:commentId/like - Like or unlike a comment
app.post('/api/comments/:commentId/like', async (req, res) => {
  try {
    const { commentId } = req.params;
    let user = null;
    try {
      user = await authenticateUser(req);
    } catch (e) {}

    const userIdentifier = user ? user.id : (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'guest');
    const result = await CommentService.toggleLike(commentId, userIdentifier);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// DELETE /api/comments/:commentId - Delete comment (Author or Admin)
app.delete('/api/comments/:commentId', requireAuth, async (req, res) => {
  try {
    const { commentId } = req.params;
    const result = await CommentService.deleteComment(commentId, req.user);
    res.json({ success: true });
  } catch (e) {
    res.status(403).json({ success: false, error: e.message });
  }
});

// POST /api/comments/:bookKey/:paragraphId - Post a comment on a paragraph
app.post('/api/comments/:bookKey/:paragraphId', async (req, res) => {
  try {
    const { bookKey, paragraphId } = req.params;
    const { content, is_spoiler, visitor_name, excerpt } = req.body || {};

    let user = null;
    try {
      user = await authenticateUser(req);
    } catch (e) {}

    let userId, userName, userAvatar, userRole;
    if (user) {
      userId = user.id;
      userName = user.display_name || (user.email ? user.email.split('@')[0] : 'Lecteur');
      userAvatar = user.avatar_url || '';
      userRole = user.role || 'USER';
    } else {
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
      const ipHash = Buffer.from(clientIp).toString('hex').slice(-4);
      userId = 'guest_' + ipHash;
      userName = visitor_name ? String(visitor_name).trim().slice(0, 24) : 'Lecteur#' + ipHash;
      userAvatar = '';
      userRole = 'GUEST';
    }

    const comment = await CommentService.addComment({
      bookKey,
      paragraphId,
      excerpt: String(excerpt || '').slice(0, 300),
      userId,
      userName,
      userAvatar,
      userRole,
      content,
      isSpoiler: Boolean(is_spoiler)
    });

    res.json({ success: true, comment });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});



// ── 2. CONTRIBUTOR STUDIO ENDPOINTS ──────────────────────────────────────────

// GET /api/metadata/search - Search Light Novel metadata via Cascade APIs (AniList / Kitsu / MangaDex)
app.get('/api/metadata/search', metadataLimiter, async (req, res) => {
    try {
        const query = (req.query.q || req.query.query || '').trim();
        if (!query) {
            return res.status(400).json({ success: false, error: 'Paramètre de recherche q requis.' });
        }

        console.log('[MetadataSearch] Recherche pour :', query);
        console.log('[MetadataSearch] Recherche LIVE pour :', query);
        const metadata = await AnilistMetadataTranslator.searchLive(query);

        if (!metadata || metadata.notFound) {
            return res.status(404).json({ success: false, error: 'Aucune correspondance trouvée sur les APIs.' });
        }

        const candidates = metadata.candidates || [metadata];
        res.json({ success: true, metadata, candidates });
    } catch (e) {
        console.error('[MetadataSearch] Erreur:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});


// GET /api/contributor/catalog-search - Rechercher une œuvre publiée pour y ajouter des tomes
app.get('/api/contributor/catalog-search', requireContributor, (req, res) => {
    try {
        const q = (req.query.q || '').trim().toLowerCase();
        const catService = CatalogService;
        const data = catService.loadData();
        const published = (data.series || []).filter(s => (s.publication_status || 'PUBLISHED').toUpperCase() === 'PUBLISHED');

        let results = published;
        if (q) {
            results = published.filter(s => 
                (s.title || '').toLowerCase().includes(q) ||
                (s.author || '').toLowerCase().includes(q) ||
                (s.originalTitle || '').toLowerCase().includes(q)
            );
        }
        const sample = results.slice(0, 30).map(s => ({
            id: s.id,
            title: s.title,
            author: s.author,
            cover: s.cover,
            volumeCount: (s.volumes || []).length,
            volumes: (s.volumes || []).map(v => ({
                volume_number: v.volume_number || v.volumeNumber || 1,
                title: v.title || `Volume ${v.volume_number || 1}`,
                uploaded_by_name: v.uploaded_by_name || 'Équipe principale'
            }))
        }));
        res.json({ success: true, novels: sample });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/contributor/novels - List contributor's novels
app.get('/api/contributor/novels', requireContributor, async (req, res) => {
    try {
        const catService = CatalogService;
        const data = catService.loadData();
        const userEmail = (req.user.email || '').toLowerCase().trim();
        const userId = req.user.id;
        const isAdmin = (req.user.role || '').toUpperCase() === 'ADMIN' || userEmail === 'admin@noveltrad.com';

        const list = (data.series || []).filter(s => {
            const creatorId = s.created_by;
            const creatorEmail = (s.created_by_email || '').toLowerCase().trim();

            // 1. Direct match by creator user id
            if (creatorId && creatorId === userId) return true;
            // 2. Direct match by creator email
            if (creatorEmail && userEmail && creatorEmail === userEmail) return true;
            // 3. For admin@noveltrad.com or ADMIN role:
            // Match any novels published by admin (5657d33e-952c-43d6-a222-8842b026699b, admin-uuid-123, admin@noveltrad.com)
            if (isAdmin) {
                if (creatorId === '5657d33e-952c-43d6-a222-8842b026699b' || creatorId === 'admin-uuid-123') return true;
                if (creatorEmail === 'admin@noveltrad.com') return true;
                return true; // Admin in contributor space can view and manage all catalog novels
            }
            return false;
        });

        console.log(`[ContributorAPI] ${list.length} romans retournés pour ${userEmail} (ID: ${userId}, Role: ${req.user.role})`);
        res.json({ success: true, novels: list });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/contributor/novels - Create a novel in DRAFT status
app.post('/api/contributor/novels', contributorLimiter, requireContributor, async (req, res) => {
    try {
        const { title, title_romaji, originalTitle, author, illustrator, translator, origin, type, genres, tags, synopsis, cover, banner, publication_status } = req.body;
        if (!title || !author) {
            return res.status(400).json({ success: false, error: 'Le titre et l\'auteur sont obligatoires.' });
        }

        const catService = CatalogService;
        const data = catService.loadData();

        // Protection anti-doublon (détection de double-clic rapide sous 15 secondes)
        const trimmedTitle = title.trim().toLowerCase();
        const trimmedAuthor = author.trim().toLowerCase();
        const existingRecent = (data.series || []).find(s => 
            s.title && s.title.trim().toLowerCase() === trimmedTitle &&
            s.author && s.author.trim().toLowerCase() === trimmedAuthor &&
            s.created_by === req.user.id &&
            (Date.now() - (s.created_at || 0)) < 15000
        );
        if (existingRecent) {
            console.log('[Contributor] Doublon évité (double-clic détecté):', existingRecent.id, existingRecent.title);
            return res.json({ success: true, novel: existingRecent, isDuplicateAvoided: true });
        }

        // Détection de roman existant dans le catalogue public (invitation à enrichir plutôt que cloner)
        const existingPublished = (data.series || []).find(s => 
            (s.publication_status || 'PUBLISHED').toUpperCase() === 'PUBLISHED' &&
            s.title && s.title.trim().toLowerCase() === trimmedTitle &&
            (!req.body.id || s.id !== req.body.id)
        );
        if (existingPublished && req.body.force_create !== true) {
            return res.status(409).json({
                success: false,
                isExistingDuplicate: true,
                existingNovel: {
                    id: existingPublished.id,
                    title: existingPublished.title,
                    author: existingPublished.author,
                    volumeCount: (existingPublished.volumes || []).length,
                    cover: existingPublished.cover
                },
                error: `Ce roman ("${existingPublished.title}") existe déjà sur NovelTrad avec ${(existingPublished.volumes || []).length} volume(s). Vous pouvez y ajouter vos volumes directement !`
            });
        }

        const novelId = title.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') + '-' + Date.now().toString(36);

        const newNovel = {
            id: novelId,
            title: title.trim(),
            title_romaji: (title_romaji || originalTitle || '').trim(),
            originalTitle: (originalTitle || title_romaji || '').trim(),
            author: author.trim(),
            illustrator: (illustrator || '').trim(),
            translator: (translator || '').trim(),
            origin: origin || 'Japon (Light Novel)',
            type: type || 'light_novel',
            status: 'releasing',
            status_fr: 'En cours',
            publication_status: publication_status || 'DRAFT',
            genres: Array.isArray(genres) ? genres : (genres ? [genres] : ['Fantaisie']),
            genres_fr: Array.isArray(genres) ? genres : (genres ? [genres] : ['Fantaisie']),
            tags: Array.isArray(tags) ? tags : (tags ? [tags] : []),
            synopsis: synopsis || '',
            synopsis_fr: synopsis || '',
            cover: cover || 'https://placehold.co/400x600/18181b/ffffff?text=' + encodeURIComponent(title),
            banner: banner || cover || '',
            featured: false,
            rating: 4.8,
            views: 0,
            likes: 0,
            formats: ['epub'],
            volumes: [],
            chapters: [],
            created_by: req.user.id,
            created_by_email: req.user.email,
            created_at: Date.now(),
            updated_at: Date.now()
        };

        data.series.unshift(newNovel);
        catService.saveData();

        console.log('[Contributor] Nouveau novel créé:', novelId, 'Status:', newNovel.publication_status, 'par:', req.user.email);
        res.json({ success: true, novel: newNovel });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

const handleUpdateNovel = async (novelId, req, res) => {
    try {
        if (!novelId) return res.status(400).json({ success: false, error: 'ID du roman requis.' });

        const { title, title_romaji, author, illustrator, synopsis, genres, tags, cover, publication_status } = req.body;

        const catService = CatalogService;
        const data = catService.loadData();
        const novel = (data.series || []).find(s => s.id === novelId);

        if (!novel) return res.status(404).json({ success: false, error: 'Roman introuvable.' });
        const isOwnerOrAdmin = (!novel.created_by || novel.created_by === req.user.id || req.user.role === 'ADMIN');
        const isPublishedCatalog = (novel.publication_status || 'PUBLISHED').toUpperCase() === 'PUBLISHED';

        // Un contributeur peut ajouter un tome à son propre roman OU à un roman déjà publié au catalogue
        if (!isOwnerOrAdmin && !isPublishedCatalog) {
            return res.status(403).json({ success: false, error: 'Ce roman n\'est pas encore publié au catalogue pour accepter des contributions externes.' });
        }

        if (title) novel.title = title.trim();
        if (title_romaji !== undefined) novel.title_romaji = title_romaji;
        if (author) novel.author = author.trim();
        if (illustrator !== undefined) novel.illustrator = illustrator;
        if (synopsis !== undefined) { novel.synopsis = synopsis; novel.synopsis_fr = synopsis; }
        if (genres) { novel.genres = Array.isArray(genres) ? genres : [genres]; novel.genres_fr = novel.genres; }
        if (tags) novel.tags = Array.isArray(tags) ? tags : [tags];
        if (cover) novel.cover = cover;
        if (publication_status) novel.publication_status = publication_status;
        novel.updated_at = Date.now();

        catService.saveData();
        console.log('[Contributor] Roman mis à jour:', novelId);
        res.json({ success: true, novel });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// PUT /api/contributor/novels/:id - Update contributor's novel (ID in URL param)
// FIX [M3]: Added :id URL param route — frontend uses PUT /api/contributor/novels/:id
app.put('/api/contributor/novels/:id', requireContributor, async (req, res) => {
    return handleUpdateNovel(req.params.id || req.body.id, req, res);
});

// PUT /api/contributor/novels (legacy - body-based ID for backwards compat)
app.put('/api/contributor/novels', requireContributor, async (req, res) => {
    const novelId = req.body.id;
    if (!novelId) return res.status(400).json({ success: false, error: 'ID du roman requis (body.id).' });
    return handleUpdateNovel(novelId, req, res);
});

// POST /api/contributor/novels/:id/submit - Submit novel for review
app.post('/api/contributor/novels/:id/submit', requireContributor, async (req, res) => {
    try {
        const catService = CatalogService;
        const data = catService.loadData();
        const novel = (data.series || []).find(s => s.id === req.params.id);

        if (!novel) return res.status(404).json({ success: false, error: 'Roman introuvable.' });
        if (novel.created_by && novel.created_by !== req.user.id && req.user.role !== 'ADMIN') {
            return res.status(403).json({ success: false, error: 'Non autorisé à modifier ce roman.' });
        }

        novel.publication_status = 'PENDING_REVIEW';
        novel.submitted_at = Date.now();
        novel.updated_at = Date.now();
        if (novel.rejection_reason) {
            novel.previous_rejection_reason = novel.rejection_reason;
            novel.rejection_reason = null;
        }
        catService.saveData();

        if (supabase) {
            try {
                await supabase.from('catalog_novels').update({
                    publication_status: 'PENDING_REVIEW',
                    rejection_reason: null,
                    updated_at: new Date().toISOString()
                }).eq('id', req.params.id);
            } catch (supaErr) {
                console.warn('[ContributorSubmit] Supabase sync notice:', supaErr.message);
            }
        }

        console.log('[Contributor] Roman soumis pour validation:', novel.id);
        res.json({ success: true, novel });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/contributor/novels/:id/volumes - Add/Upload volume to novel
app.post('/api/contributor/novels/:id/volumes', contributorLimiter, requireContributor, uploadVolume.single('file'), async (req, res) => {
    try {
        const { volume_number, title, release_date } = req.body;
        const catService = CatalogService;
        const data = catService.loadData();
        const novel = (data.series || []).find(s => s.id === req.params.id);

        if (!novel) return res.status(404).json({ success: false, error: 'Roman introuvable.' });
        if (novel.created_by && novel.created_by !== req.user.id && req.user.role !== 'ADMIN') {
            return res.status(403).json({ success: false, error: 'Non autorisé à modifier ce roman.' });
        }

        if (!novel.volumes) novel.volumes = [];
        // FIX [Mo4]: Validate volume_number is a valid integer
        const volNumInt = parseInt(volume_number || '1', 10);
        if (isNaN(volNumInt) || volNumInt < 1 || volNumInt > 9999) {
            return res.status(400).json({ success: false, error: 'Numéro de volume invalide. Doit être un entier entre 1 et 9999.' });
        }
        
        // Build file info & extract cover if uploaded
        let fileInfo = null;
        let extractedCoverUrl = null;

        if (req.file) {
            const ext = path.extname(req.file.originalname).toLowerCase();
            const formatStr = ext.replace('.', '').toUpperCase();

            // Extract cover image from EPUB
            if (ext === '.epub') {
                try {
                    const epubBuffer = fs.readFileSync(req.file.path);
                    const coverData = await EpubProcessor.extractCover(epubBuffer);
                    if (coverData && coverData.buffer) {
                        const coverDir = path.join(__dirname, 'uploads', 'covers');
                        if (!fs.existsSync(coverDir)) fs.mkdirSync(coverDir, { recursive: true });
                        const coverExt = coverData.mediaType === 'image/png' ? '.png' : (coverData.mediaType === 'image/webp' ? '.webp' : '.jpg');
                        const coverFileName = `${novel.id}_vol_${volNumInt}_${Date.now()}${coverExt}`;
                        fs.writeFileSync(path.join(coverDir, coverFileName), coverData.buffer);
                        extractedCoverUrl = `/uploads/covers/${coverFileName}`;
                        console.log(`[Contributor] Couverture extraite pour le volume ${volNumInt}: ${extractedCoverUrl}`);
                    }
                } catch (covErr) {
                    console.warn('[Contributor] Impossible d\'extraire la cover de l\'EPUB:', covErr.message);
                }
            }

            fileInfo = {
                file_path: '/uploads/volumes/' + req.file.filename,
                file_name: req.file.originalname,
                file_size: req.file.size,
                file_type: formatStr,
                format: formatStr.toLowerCase(),
                uploaded_at: Date.now(),
                ...(extractedCoverUrl ? { cover: extractedCoverUrl, cover_url: extractedCoverUrl } : {})
            };
        }

        const volType = (req.body.volume_type || 'main').toLowerCase();
        const volGroup = (req.body.volume_group || '').trim();
        const cleanGroupSlug = volGroup.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-');

        // Generate unique identifier depending on volume type so Side Stories & Spin-offs NEVER collide with Main Story
        let volIdSuffix = `vol_${volNumInt}`;
        if (volType === 'side_story') {
            volIdSuffix = `side_vol_${volNumInt}`;
        } else if (volType === 'spinoff') {
            volIdSuffix = `spinoff_${cleanGroupSlug || 'spin'}_vol_${volNumInt}`;
        } else if (volType === 'alternative') {
            volIdSuffix = `alt_${cleanGroupSlug || 'whatif'}_vol_${volNumInt}`;
        }

        const newVolume = {
            id: `${novel.id}_${volIdSuffix}`,
            volume_number: volNumInt,
            volumeNumber: volNumInt,
            title: (title || (volType === 'side_story' ? `Side Story ${volNumInt}` : (volType === 'spinoff' ? `Spin-off ${volNumInt}` : `Volume ${volNumInt}`))).trim(),
            release_date: release_date || new Date().toISOString().split('T')[0],
            volume_type: volType,
            volume_group: volGroup,
            uploaded_by: req.user.id,
            uploaded_by_email: req.user.email || '',
            uploaded_by_name: req.user.name || (req.user.email ? req.user.email.split('@')[0] : 'Contributeur'),
            created_at: Date.now(),
            ...(fileInfo || {})
        };

        // Uniqueness check compound by (volume_type + volume_group + volume_number)
        const existingIdx = novel.volumes.findIndex(v => {
            const vt = (v.volume_type || 'main').toLowerCase();
            const vg = (v.volume_group || '').trim().toLowerCase();
            const vn = parseFloat(v.volume_number || v.number || 0);
            return vt === volType && vg === volGroup.toLowerCase() && vn === volNumInt;
        });

        if (existingIdx >= 0) {
            const existingVol = novel.volumes[existingIdx];
            // Protection anti-écrasement : impossible d'écraser le volume d'un tiers sans être admin ou créateur du roman
            if (existingVol.uploaded_by && existingVol.uploaded_by !== req.user.id && !isOwnerOrAdmin) {
                return res.status(403).json({ 
                    success: false, 
                    error: `Le ${newVolume.title} a déjà été publié par un autre traducteur (${existingVol.uploaded_by_name || 'un tiers'}). Vous ne pouvez pas l'écraser.` 
                });
            }
            novel.volumes[existingIdx] = {
                ...novel.volumes[existingIdx],
                ...newVolume,
                ...(fileInfo ? fileInfo : {}),
                ...(extractedCoverUrl ? { cover: extractedCoverUrl, cover_url: extractedCoverUrl } : {})
            };
        } else {
            novel.volumes.push(newVolume);
        }

        // Sort volumes: Main story first, then side stories, then spinoffs & alternatives, ordered by volume number
        novel.volumes.sort((a, b) => {
            const typeRank = { main: 1, side_story: 2, spinoff: 3, alternative: 4 };
            const rankA = typeRank[(a.volume_type || 'main').toLowerCase()] || 1;
            const rankB = typeRank[(b.volume_type || 'main').toLowerCase()] || 1;
            if (rankA !== rankB) return rankA - rankB;
            return (parseFloat(a.volume_number || a.number || 0)) - (parseFloat(b.volume_number || b.number || 0));
        });
        novel.volume_count = novel.volumes.length;
        novel.updated_at = Date.now();
        catService.saveData();

        console.log(`[Contributor] Volume ${volNumInt} enregistré pour "${novel.title}"`);
        res.json({ success: true, volume: newVolume, volumes: novel.volumes });
    } catch (e) {
        console.error('[Contributor] Erreur upload volume:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// DELETE /api/contributor/novels/:id/volumes/:volNum - Delete volume from novel
app.delete('/api/contributor/novels/:id/volumes/:volNum', requireContributor, async (req, res) => {
    try {
        const catService = CatalogService;
        const data = catService.loadData();
        const novel = (data.series || []).find(s => s.id === req.params.id);

        if (!novel) return res.status(404).json({ success: false, error: 'Roman introuvable.' });
        const volNumInt = parseInt(req.params.volNum, 10);
        if (!novel.volumes) novel.volumes = [];

        const targetVol = novel.volumes.find(v => (v.volume_number === volNumInt || v.number === volNumInt));
        if (!targetVol) {
            return res.status(404).json({ success: false, error: 'Volume introuvable.' });
        }

        const isOwnerOrAdmin = (!novel.created_by || novel.created_by === req.user.id || req.user.role === 'ADMIN');
        const isVolumeUploader = targetVol.uploaded_by && targetVol.uploaded_by === req.user.id;

        if (!isOwnerOrAdmin && !isVolumeUploader) {
            return res.status(403).json({ success: false, error: 'Vous ne pouvez pas supprimer un volume publié par un autre traducteur.' });
        }

        // If file exists on disk, delete it
        if (targetVol.file_path) {
            try {
                const fullDiskPath = path.join(__dirname, targetVol.file_path.replace(/^\//, ''));
                if (fs.existsSync(fullDiskPath)) {
                    fs.unlinkSync(fullDiskPath);
                    console.log('[Contributor] Fichier volume supprimé:', fullDiskPath);
                }
            } catch (fileErr) {
                console.warn('[Contributor] Impossible de supprimer le fichier volume:', fileErr.message);
            }
        }

        // FIX [M6]: Also delete extracted cover image from uploads/covers/
        const coverPath = targetVol.cover || targetVol.cover_url;
        if (coverPath && coverPath.startsWith('/uploads/covers/')) {
            try {
                const fullCoverPath = path.join(__dirname, coverPath.replace(/^\//, ''));
                if (fs.existsSync(fullCoverPath)) {
                    fs.unlinkSync(fullCoverPath);
                    console.log('[Contributor] Couverture supprimée:', fullCoverPath);
                }
            } catch (covErr) {
                console.warn('[Contributor] Impossible de supprimer la couverture:', covErr.message);
            }
        }

        novel.volumes = novel.volumes.filter(v => (v.volume_number !== volNumInt && v.number !== volNumInt));
        novel.volume_count = novel.volumes.length;
        novel.updated_at = Date.now();
        catService.saveData();

        console.log(`[Contributor] Volume ${volNumInt} supprimé du roman "${novel.title}"`);
        res.json({ success: true, volumes: novel.volumes });
    } catch (e) {
        console.error('[Contributor] Erreur suppression volume:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// DELETE /api/contributor/novels/:id - Delete a novel and its volumes/files
app.delete('/api/contributor/novels/:id', contributorLimiter, requireContributor, async (req, res) => {
    try {
        const catService = CatalogService;
        const data = catService.loadData();
        const novelIndex = (data.series || []).findIndex(s => s.id === req.params.id);

        if (novelIndex === -1) {
            return res.status(404).json({ success: false, error: 'Roman introuvable.' });
        }

        const novel = data.series[novelIndex];
        if (novel.created_by && novel.created_by !== req.user.id && req.user.role !== 'ADMIN') {
            return res.status(403).json({ success: false, error: 'Non autorisé à supprimer ce roman.' });
        }

        // Clean up files of volumes if any
        if (Array.isArray(novel.volumes)) {
            for (const v of novel.volumes) {
                if (v.file_path) {
                    try {
                        const fp = path.join(__dirname, v.file_path.replace(/^\//, ''));
                        if (fs.existsSync(fp)) fs.unlinkSync(fp);
                    } catch (err) {}
                }
                const cov = v.cover || v.cover_url;
                if (cov && cov.startsWith('/uploads/covers/')) {
                    try {
                        const cp = path.join(__dirname, cov.replace(/^\//, ''));
                        if (fs.existsSync(cp)) fs.unlinkSync(cp);
                    } catch (err) {}
                }
            }
        }

        // Remove novel from data.series
        data.series.splice(novelIndex, 1);
        catService.saveData();

        console.log(`[Contributor] Roman supprimé avec succès: "${novel.title}" (${novel.id}) par ${req.user.email}`);
        res.json({ success: true, message: 'Roman supprimé avec succès.' });
    } catch (e) {
        console.error('[Contributor] Erreur suppression roman:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ── 3. ADMINISTRATION ENDPOINTS ──────────────────────────────────────────────

// GET /api/admin/pending - Get queue of novels awaiting moderation

// =============================================================================
// NOVELTRAD — PASSERELLE BIBLIOTHÈQUE LOCALE ➔ CATALOGUE PUBLIC (SOUMISSION)
// =============================================================================
app.post('/api/library/submit-to-catalog', requireAuth, async (req, res) => {
  try {
    const { seriesId, volumeNumbers, title, author, synopsis, reviewNotes } = req.body;
    if (!seriesId) {
      return res.status(400).json({ success: false, error: 'Identifiant de série (seriesId) requis.' });
    }

    // Récupérer la série depuis la bibliothèque de l'utilisateur connecté
    const userLibrary = await generateLibrary(req.user.id);
    let localSeries = userLibrary.find(s => s.id === seriesId || s.id.toLowerCase() === seriesId.toLowerCase());
    
    // Fallback: vérifier dans la bibliothèque guest si non trouvé
    if (!localSeries) {
      const guestLib = await generateLibrary('guest');
      localSeries = guestLib.find(s => s.id === seriesId || s.id.toLowerCase() === seriesId.toLowerCase());
    }

    if (!localSeries) {
      return res.status(404).json({ success: false, error: 'Série introuvable dans votre bibliothèque locale.' });
    }

    const catService = CatalogService;
    const catalogData = catService.loadData();
    if (!catalogData.series) catalogData.series = [];

    // Préparer les répertoires d'upload
    const volumesDir = path.join(__dirname, 'uploads', 'volumes');
    const coversDir = path.join(__dirname, 'uploads', 'covers');
    if (!fs.existsSync(volumesDir)) fs.mkdirSync(volumesDir, { recursive: true });
    if (!fs.existsSync(coversDir)) fs.mkdirSync(coversDir, { recursive: true });

    // Filtrer les volumes à publier
    const targetVolumes = (localSeries.volumes || []).filter(v => {
      if (!Array.isArray(volumeNumbers) || volumeNumbers.length === 0) return true;
      const vNum = v.volumeNumber !== null && v.volumeNumber !== undefined ? v.volumeNumber : parseInt(v.title.replace(/\D+/g, ''), 10);
      return volumeNumbers.includes(vNum);
    });

    if (targetVolumes.length === 0) {
      return res.status(400).json({ success: false, error: 'Aucun volume disponible à soumettre pour cette série.' });
    }

    const submittedVolumes = [];

    for (const vol of targetVolumes) {
      const vNum = vol.volumeNumber !== null && vol.volumeNumber !== undefined ? vol.volumeNumber : 1;
      
      // Trouver le chemin physique du fichier source
      let sourcePhysicalPath = vol.fullPath;
      if (!sourcePhysicalPath && vol.id && vol.id.startsWith('external_')) {
        try {
          const b64 = vol.id.replace('external_', '');
          sourcePhysicalPath = Buffer.from(b64, 'base64').toString('utf8');
        } catch(e) {}
      }
      if (!sourcePhysicalPath && vol.filename) {
        const checkLocal = path.join(__dirname, 'data', 'local_library', vol.filename);
        if (fs.existsSync(checkLocal)) sourcePhysicalPath = checkLocal;
      }

      if (!sourcePhysicalPath || !fs.existsSync(sourcePhysicalPath)) {
        console.warn('[SubmitToCatalog] Fichier source introuvable pour le volume:', vol.title, sourcePhysicalPath);
        continue;
      }

      const ext = path.extname(sourcePhysicalPath).toLowerCase();
      const formatStr = ext.replace('.', '').toUpperCase();
      const destVolumeName = `pub_${Date.now()}_vol_${vNum}_${path.basename(sourcePhysicalPath)}`;
      const destVolumePath = path.join(volumesDir, destVolumeName);

      // Copier le fichier physique dans le stockage serveur
      fs.copyFileSync(sourcePhysicalPath, destVolumePath);
      const stat = fs.statSync(destVolumePath);
      const volumePublicUrl = `/uploads/volumes/${destVolumeName}`;

      // Extraire ou préparer la couverture du volume
      let volumeCoverUrl = null;
      if (ext === '.epub') {
        try {
          const epubBuf = fs.readFileSync(destVolumePath);
          const covData = await EpubProcessor.extractCover(epubBuf);
          if (covData && covData.buffer) {
            const covExt = covData.mediaType === 'image/png' ? '.png' : (covData.mediaType === 'image/webp' ? '.webp' : '.jpg');
            const covFileName = `cov_${seriesId}_vol_${vNum}_${Date.now()}${covExt}`;
            fs.writeFileSync(path.join(coversDir, covFileName), covData.buffer);
            volumeCoverUrl = `/uploads/covers/${covFileName}`;
          }
        } catch(covErr) {
          console.warn('[SubmitToCatalog] Couverture non extraite de l\'EPUB:', covErr.message);
        }
      }

      submittedVolumes.push({
        id: `${seriesId}_vol_${vNum}`,
        volume_number: vNum,
        volumeNumber: vNum,
        title: (vol.title || `Volume ${vNum}`).trim(),
        file_path: volumePublicUrl,
        file_name: path.basename(sourcePhysicalPath),
        file_size: stat.size,
        file_type: formatStr,
        format: formatStr.toLowerCase(),
        created_at: Date.now(),
        ...(volumeCoverUrl ? { cover: volumeCoverUrl, cover_url: volumeCoverUrl } : {})
      });
    }

    if (submittedVolumes.length === 0) {
      return res.status(500).json({ success: false, error: 'Impossible de copier les fichiers des volumes sélectionnés.' });
    }

    // Couverture principale de la série
    const mainCover = submittedVolumes[0]?.cover || localSeries.metadata?.cover || localSeries.cover || null;
    const resolvedTitle = (title || localSeries.title || 'Roman sans titre').trim();
    const resolvedAuthor = (author || localSeries.metadata?.author || 'Auteur Inconnu').trim();
    const resolvedSynopsis = synopsis || localSeries.metadata?.synopsis_fr || localSeries.metadata?.synopsis || 'Synopsis à venir.';

    // Vérifier si la série existe déjà dans le catalogue
    let existingIndex = catalogData.series.findIndex(s => s.id === seriesId);
    let catalogEntry;

    if (existingIndex >= 0) {
      catalogEntry = catalogData.series[existingIndex];
      // Si existant, mettre à jour avec les nouveaux volumes et repasser en PENDING_REVIEW
      catalogEntry.title = resolvedTitle;
      catalogEntry.author = resolvedAuthor;
      catalogEntry.synopsis = resolvedSynopsis;
      catalogEntry.synopsis_fr = resolvedSynopsis;
      if (mainCover) catalogEntry.cover = mainCover;
      catalogEntry.publication_status = 'PENDING_REVIEW';
      catalogEntry.review_notes = reviewNotes || catalogEntry.review_notes || '';
      catalogEntry.updated_at = Date.now();
      
      // Fusionner les volumes sans écraser aveuglément
      const mergedVolumes = [...(catalogEntry.volumes || [])];
      for (const sVol of submittedVolumes) {
        const eVolIdx = mergedVolumes.findIndex(v => v.volume_number === sVol.volume_number);
        if (eVolIdx >= 0) {
          mergedVolumes[eVolIdx] = { ...mergedVolumes[eVolIdx], ...sVol };
        } else {
          mergedVolumes.push(sVol);
        }
      }
      mergedVolumes.sort((a, b) => (a.volume_number || 0) - (b.volume_number || 0));
      catalogEntry.volumes = mergedVolumes;
      catalogEntry.volume_count = mergedVolumes.length;
      catalogData.series[existingIndex] = catalogEntry;
    } else {
      catalogEntry = {
        id: seriesId,
        title: resolvedTitle,
        author: resolvedAuthor,
        synopsis: resolvedSynopsis,
        synopsis_fr: resolvedSynopsis,
        cover: mainCover,
        banner: localSeries.metadata?.banner || null,
        genres: localSeries.metadata?.genres || ['Light Novel'],
        genres_fr: localSeries.metadata?.genres || ['Light Novel'],
        tags: [],
        rating: 4.5,
        views: 0,
        likes: 0,
        formats: ['epub'],
        volumes: submittedVolumes,
        volume_count: submittedVolumes.length,
        chapters: [],
        publication_status: 'PENDING_REVIEW', // EN ATTENTE MODÉRATION
        created_by: req.user.id,
        created_by_email: req.user.email,
        review_notes: reviewNotes || '',
        created_at: Date.now(),
        updated_at: Date.now()
      };
      catalogData.series.push(catalogEntry);
    }

    catService.saveData(catalogData);

    console.log('[SubmitToCatalog] Roman soumis avec succès:', seriesId, 'par:', req.user.email, `(${submittedVolumes.length} tome(s))`);
    res.json({
      success: true,
      message: 'Roman soumis avec succès ! Il sera examiné par un administrateur avant publication.',
      novel: catalogEntry
    });
  } catch (err) {
    console.error('[SubmitToCatalog Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/pending - Get queue of novels awaiting moderation
app.get('/api/admin/pending', requireAdmin, async (req, res) => {
    try {
        let supaPending = [];
        if (supabase) {
            try {
                const { data, error } = await supabase
                    .from('catalog_novels')
                    .select('*')
                    .eq('publication_status', 'PENDING_REVIEW');
                if (!error && Array.isArray(data)) {
                    supaPending = data;
                }
            } catch (err) {
                console.warn('[AdminPending] Supabase query notice:', err.message);
            }
        }

        const catService = CatalogService;
        const data = catService.loadData();
        const localPending = (data.series || []).filter(s => (s.publication_status || '').toUpperCase() === 'PENDING_REVIEW');

        const map = new Map();
        localPending.forEach(n => map.set(n.id, n));
        supaPending.forEach(n => {
            const existing = map.get(n.id) || {};
            const mergedVolumes = (Array.isArray(n.volumes) && n.volumes.length > 0) ? n.volumes : (existing.volumes || []);
            map.set(n.id, { ...existing, ...n, volumes: mergedVolumes });
        });

        const pending = Array.from(map.values());
        res.json({ success: true, pending });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/admin/novels/:id/approve - Approve novel into catalog
app.post('/api/admin/novels/:id/approve', requireAdmin, async (req, res) => {
    try {
        const catService = CatalogService;
        const data = catService.loadData();
        const novel = (data.series || []).find(s => s.id === req.params.id);

        if (novel) {
            novel.publication_status = 'PUBLISHED';
            novel.reviewed_by = req.user.id;
            novel.approved_at = Date.now();
            novel.updated_at = Date.now();
            catService.saveData();
        }

        if (supabase) {
            try {
                await supabase.from('catalog_novels').update({
                    publication_status: 'PUBLISHED',
                    reviewed_by: req.user.id,
                    updated_at: new Date().toISOString()
                }).eq('id', req.params.id);
            } catch (e) {
                console.warn('[AdminApprove] Supabase sync notice:', e.message);
            }
        }

        console.log('[Admin] Roman approuvé et publié:', req.params.id);
        res.json({ success: true, novel: novel || { id: req.params.id, publication_status: 'PUBLISHED' } });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/admin/novels/:id/reject - Reject novel back to DRAFT with feedback
app.post('/api/admin/novels/:id/reject', requireAdmin, async (req, res) => {
    try {
        const { review_notes } = req.body;
        const catService = CatalogService;
        const data = catService.loadData();
        const novel = (data.series || []).find(s => s.id === req.params.id);

        if (novel) {
            novel.publication_status = 'DRAFT';
            novel.rejection_reason = review_notes || 'Informations non conformes.';
            novel.reviewed_by = req.user.id;
            novel.updated_at = Date.now();
            catService.saveData();
        }

        if (supabase) {
            try {
                await supabase.from('catalog_novels').update({
                    publication_status: 'DRAFT',
                    rejection_reason: review_notes || 'Informations non conformes.',
                    reviewed_by: req.user.id,
                    updated_at: new Date().toISOString()
                }).eq('id', req.params.id);
            } catch (e) {
                console.warn('[AdminReject] Supabase sync notice:', e.message);
            }
        }

        console.log('[Admin] Roman rejeté vers Brouillon:', req.params.id);
        res.json({ success: true, novel: novel || { id: req.params.id, publication_status: 'DRAFT' } });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// PUT /api/admin/novels/:id/status - Change status directly
app.put('/api/admin/novels/:id/status', requireAdmin, async (req, res) => {
    try {
        const { status } = req.body;
        const catService = CatalogService;
        const data = catService.loadData();
        const novel = (data.series || []).find(s => s.id === req.params.id);

        if (novel) {
            novel.publication_status = status || 'PUBLISHED';
            novel.updated_at = Date.now();
            catService.saveData();
        }

        if (supabase) {
            try {
                await supabase.from('catalog_novels').update({
                    publication_status: status || 'PUBLISHED',
                    updated_at: new Date().toISOString()
                }).eq('id', req.params.id);
            } catch (e) {
                console.warn('[AdminStatus] Supabase sync notice:', e.message);
            }
        }

        res.json({ success: true, novel: novel || { id: req.params.id, publication_status: status } });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/admin/users - List users for role management
app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        let supaUsers = [];
        if (supabase) {
            // A. Tenter la lecture depuis la table profiles
            try {
                const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
                if (!error && Array.isArray(data)) {
                    supaUsers = data.map(p => ({
                        id: p.id,
                        email: p.email,
                        display_name: p.display_name || (p.email ? p.email.split('@')[0] : 'Utilisateur'),
                        role: (p.role || 'USER').toUpperCase(),
                        created_at: p.created_at || new Date().toISOString()
                    }));
                }
            } catch (supaErr) {
                console.warn('[AdminUsers] Supabase profiles notice:', supaErr.message);
            }

            // B. Tenter auth.admin.listUsers() si SUPABASE_SERVICE_ROLE_KEY est fourni
            if (process.env.SUPABASE_SERVICE_ROLE_KEY && supabase.auth?.admin) {
                try {
                    const { data: authData, error: authErr } = await supabase.auth.admin.listUsers();
                    if (!authErr && authData && Array.isArray(authData.users)) {
                        authData.users.forEach(u => {
                            supaUsers.push({
                                id: u.id,
                                email: u.email,
                                display_name: u.user_metadata?.display_name || u.user_metadata?.full_name || (u.email ? u.email.split('@')[0] : 'Utilisateur'),
                                role: (u.app_metadata?.role || u.user_metadata?.role || 'USER').toUpperCase(),
                                created_at: u.created_at || new Date().toISOString()
                            });
                        });
                    }
                } catch (authListErr) {}
            }
        }

        const localUsers = loadUsersRoles();
        const userMap = new Map();

        localUsers.forEach(u => userMap.set(u.id, u));
        supaUsers.forEach(u => {
            const existing = userMap.get(u.id);
            if (existing) {
                // Conserver le rôle promu (CONTRIBUTOR ou ADMIN) attribué par l'admin
                const effectiveRole = (existing.role && existing.role !== 'USER') ? existing.role : (u.role || 'USER');
                userMap.set(u.id, { ...existing, ...u, role: effectiveRole });
            } else {
                userMap.set(u.id, u);
            }
        });

        // C. Extraire également les contributeurs et utilisateurs du catalogue
        try {
            const catData = CatalogService.loadData();
            (catData.series || []).forEach(s => {
                if (s.created_by && !userMap.has(s.created_by)) {
                    userMap.set(s.created_by, {
                        id: s.created_by,
                        email: s.created_by_email || '',
                        display_name: s.created_by_email ? s.created_by_email.split('@')[0] : 'Contributeur',
                        role: 'CONTRIBUTOR',
                        created_at: s.created_at ? new Date(s.created_at).toISOString() : new Date().toISOString()
                    });
                }
            });
        } catch (catErr) {}

        // Ensure current admin user is always in the list
        if (!userMap.has(req.user.id)) {
            userMap.set(req.user.id, {
                id: req.user.id,
                email: req.user.email,
                display_name: req.user.email ? req.user.email.split('@')[0] : 'Admin',
                role: req.user.role || 'ADMIN',
                created_at: new Date().toISOString()
            });
        }

        const mergedUsers = Array.from(userMap.values());
        saveUsersRoles(mergedUsers);

        res.json({ success: true, users: mergedUsers });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// PUT /api/admin/users/:id/role - Update user role
app.put('/api/admin/users/:id/role', requireAdmin, async (req, res) => {
    try {
        const { role } = req.body;
        const validRoles = ['USER', 'CONTRIBUTOR', 'ADMIN'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ success: false, error: 'Rôle invalide.' });
        }

        // 1. Mettre à jour Supabase Cloud avec le client Admin (bypasses RLS en toute sécurité)
        if (supabaseAdmin) {
            try {
                const { data: upData, error: upErr } = await supabaseAdmin
                    .from('profiles')
                    .update({ role, updated_at: new Date().toISOString() })
                    .eq('id', req.params.id)
                    .select();
                if (upErr) {
                    console.warn('[Admin] Supabase profiles update error:', upErr.message);
                } else {
                    console.log('[Admin] Supabase Cloud profiles table mis à jour:', req.params.id, '->', role);
                }
            } catch (e) {
                console.warn('[Admin] Supabase profiles update notice:', e.message);
            }

            if (supabaseAdmin.auth?.admin) {
                try {
                    await supabaseAdmin.auth.admin.updateUserById(req.params.id, {
                        app_metadata: { role },
                        user_metadata: { role }
                    });
                    console.log('[Admin] Supabase Auth metadata mis à jour:', req.params.id, '->', role);
                } catch (e) {
                    console.warn('[Admin] Supabase auth metadata notice:', e.message);
                }
            }
        } else if (supabase) {
            try {
                await supabase.from('profiles').update({ role }).eq('id', req.params.id);
            } catch (e) {}
        }

        // 2. Sauvegarde persistante dans localUsers
        const localUsers = loadUsersRoles();
        const target = localUsers.find(u => u.id === req.params.id);
        if (target) {
            target.role = role;
            target.updated_at = new Date().toISOString();
        } else {
            localUsers.push({
                id: req.params.id,
                email: req.body.email || '',
                role: role,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            });
        }
        saveUsersRoles(localUsers);

        console.log('[Admin] Rôle utilisateur mis à jour avec succès:', req.params.id, '->', role);
        res.json({ success: true, userId: req.params.id, role });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/admin/stats - Global administration metrics
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
        const catService = CatalogService;
        const data = catService.loadData();
        const allNovels = data.series || [];

        let totalUsersCount = 1;
        let contributorsCount = 0;
        const localUsers = loadUsersRoles();
        if (localUsers.length > 0) {
            totalUsersCount = localUsers.length;
            contributorsCount = localUsers.filter(u => u.role === 'CONTRIBUTOR' || u.role === 'ADMIN').length;
        }

        if (supabase) {
            try {
                const { count, error } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
                if (!error && typeof count === 'number' && count > 0) {
                    totalUsersCount = count;
                }
            } catch (e) {}
        }

        const stats = {
            totalNovels: allNovels.length,
            publishedNovels: allNovels.filter(s => s.publication_status === 'PUBLISHED').length,
            pendingReviews: allNovels.filter(s => s.publication_status === 'PENDING_REVIEW').length,
            draftNovels: allNovels.filter(s => s.publication_status === 'DRAFT').length,
            unknownStatus: allNovels.filter(s => !s.publication_status).length,
            totalUsers: totalUsersCount,
            totalContributors: contributorsCount
        };

        res.json({ success: true, stats });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ── CUSTOM 404 ROUTE & SMART 404 HANDLER ──
app.get('/404', (req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Middleware 404 global pour toute route non résolue
app.use((req, res) => {
  // 1. Requêtes API non trouvées -> JSON 404 structuré
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      success: false,
      error: 'Route API introuvable',
      path: req.originalUrl,
      status: 404
    });
  }

  // 2. Fichiers statiques manquants (images, CSS, JS, polices)
  const ext = path.extname(req.path).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.css', '.js', '.map', '.woff', '.woff2', '.ttf'].includes(ext)) {
    return res.status(404).send('Fichier introuvable');
  }

  // 3. Navigation Web -> Page d'erreur 404 personnalisée NovelTrad
  res.status(404);
  const custom404Path = path.join(__dirname, 'public', '404.html');
  if (fs.existsSync(custom404Path)) {
    return res.sendFile(custom404Path);
  }
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Démarrage du serveur Express
app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log(` 📖 NovelTrad PDF & EPUB Translator running on http://localhost:${PORT}`);
  console.log(` Clé DeepL configurée dans .env: ${Boolean(process.env.DEEPL_API_KEY) ? QuotaGuard.maskApiKey(process.env.DEEPL_API_KEY) : 'NON (Clé à fournir dans l\'UI)'}`);
  console.log('='.repeat(60));
  const reg = getLibraryRegistry();
  if (LibraryWatcher && LibraryWatcher.init) {
    LibraryWatcher.init(reg.folders);
  }
});
