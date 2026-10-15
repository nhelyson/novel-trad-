/* ==========================================================================
   NovelTrad AI Studio - Unified Book Reader Module (pdf_reader.js)
   Supports EPUB (ePub.js) & PDF (Mozilla PDF.js) with Paginated & Webtoon scroll,
   Themes (Light, Sepia, Dark), Font scaling, Margins, TOC, and Progress Sync.
   ========================================================================== */

"use strict";

(function () {

  // ---- Shared Reader State -------------------------------------------------
  let currentBookRef = null;
  let currentFormat = "epub"; // "epub" | "pdf"
  let currentTheme = (typeof localStorage !== "undefined" && (localStorage.getItem("noveltrad_global_theme") || localStorage.getItem("noveltrad_reader_theme"))) || "dark";
  let currentFontSize = 100;  // 80 - 150 (%)
  let currentMargin = "5%";   // "0%" | "5%" | "15%"
  let currentReadMode = "paginated"; // "paginated" | "webtoon"

  // PDF-specific
  let pdfDoc = null;
  let currentPage = 1;
  let totalPages = 0;
  let pdfZoom = 1.0;
  let pdfRendering = false;
  let pdfPagePending = null;
  let pdfFitMode = "width"; // "width" | "page"
  let pdfReflowMode = false; // true = Mode Roman (Texte fluide ePub)
  let pdfSpreadMode = "auto"; // "auto" | "single" | "double"
  let pdfSmartZoomed = false;
  let pdfSmartZoomScale = 1.0;
  let pdfSmartPanX = 0;
  let pdfSmartPanY = 0;
  let pdfIllustrationsList = []; // Liste extraite des illustrations du LN

  // EPUB-specific
  window._currentEpubBook = null;
  window._currentEpubRendition = null;

  // ---- PDF.js Worker Configuration ----------------------------------------
  if (typeof pdfjsLib !== "undefined") {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
  }

  // ==========================================================================
  //  URL RESOLUTION HELPER
  // ==========================================================================
    // ==========================================================================
  //  HIGH-SPEED OFFLINE VOLUME CACHE (Cache API) & PREFETCH ENGINE
  // ==========================================================================
  const VOLUME_CACHE_NAME = 'noveltrad-volumes-v1';

  async function getVolumeFromCache(url) {
    if (!('caches' in window)) return null;
    try {
      const cache = await caches.open(VOLUME_CACHE_NAME);
      const match = await cache.match(url);
      if (match) {
        // log silenced
        return await match.arrayBuffer();
      }
    } catch (e) {
      console.warn('[VolumeCache] Cache check notice:', e);
    }
    return null;
  }

  async function saveVolumeToCache(url, buffer) {
    if (!('caches' in window) || !buffer) return;
    try {
      const cache = await caches.open(VOLUME_CACHE_NAME);
      const response = new Response(buffer.slice(0), {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': buffer.byteLength.toString(),
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      });
      await cache.put(url, response);
      // log silenced.toFixed(1)} Mo)`);
    } catch (e) {
      console.warn('[VolumeCache] Cache save notice:', e);
    }
  }

  // Pre-fetch volume in background while user views synopsis / catalog
  window.prefetchBook = async function(book) {
    if (!book) return;
    const fileUrl = buildBookFileUrl(book);
    if (!fileUrl) return;
    if (!('caches' in window)) return;
    try {
      const cache = await caches.open(VOLUME_CACHE_NAME);
      const match = await cache.match(fileUrl);
      if (match) return; // Déjà prêt en cache local
      
      let headers = {
        'ngrok-skip-browser-warning': 'true',
        'Accept': 'application/octet-stream, */*'
      };
      if (window.authManager && typeof window.authManager.getAccessToken === "function") {
        try {
          const token = await window.authManager.getAccessToken();
          if (token) headers["Authorization"] = "Bearer " + token;
        } catch(e) {}
      }
      const resp = await fetch(fileUrl, { headers, priority: 'low' });
      if (resp.ok) {
        const buf = await resp.arrayBuffer();
        await saveVolumeToCache(fileUrl, buf);
        // log silenced
      }
    } catch(e) {}
  };

  function buildBookFileUrl(book) {
    if (!book) return null;
    let raw = book.file_path || book.filePath || book.url;
    if (raw) {
      // 1. Strip absolute protocol & host if pointing to localhost or current origin
      if (raw.startsWith('http://') || raw.startsWith('https://')) {
        try {
          const parsed = new URL(raw);
          raw = parsed.pathname + parsed.search;
        } catch(e) {}
      }
      // 2. Route uploads/volumes through the streaming endpoint without .pdf in URL path
      // to completely prevent IDM (Internet Download Manager) browser interception
      if (raw.includes('/uploads/volumes/')) {
        const fn = raw.split('/uploads/volumes/')[1];
        if (fn) {
          const keyNoExt = fn.replace(/\.(pdf|epub)$/i, '');
          return '/api/volume-stream/' + encodeURIComponent(keyNoExt);
        }
      }
      return raw;
    }

    if (book.id) {
      if (book.id.startsWith("external_") || book.id.startsWith("local_")) {
        return "/api/download-job/" + encodeURIComponent(book.id);
      }
      let history = [];
      try { history = JSON.parse(localStorage.getItem("translationHistory") || "[]"); } catch(e) {}
      const hJob = history.find(j => j.jobId === book.id);
      if (hJob && hJob.secretToken) {
        return "/api/download-job/" + encodeURIComponent(book.id) + "?token=" + hJob.secretToken;
      }
      // Route standard volumes through /api/volume-stream for smart resolution
      return "/api/volume-stream/" + encodeURIComponent(book.id);
    }

    if (book.fullPath) {
      return "/api/download-job/" + encodeURIComponent("external_" + btoa(unescape(encodeURIComponent(book.fullPath))));
    }
    return null;
  }

  // ==========================================================================
  //  UNIFIED OPEN READER (MASTER API)
  // ==========================================================================
  
  // ==========================================================================
  //  IMMERSIVE READER CONTROLLER (Auto-hide Toolbar & Touch Tap Zones)
  // ==========================================================================
  let isToolbarHidden = false;
  let lastScrollY = 0;
  let scrollThreshold = 18;

  window.showReaderToolbar = function() {
    const tb = document.querySelector(".premium-reader-toolbar");
    if (tb && isToolbarHidden) {
      tb.classList.remove("toolbar-autohidden");
      isToolbarHidden = false;
    }
  };

  window.hideReaderToolbar = function() {
    // Guards: do not hide if popover, sidebar, or search is open
    const popover = document.getElementById("readerSettingsMenu");
    if (popover && !popover.classList.contains("hidden")) return;
    const sidebar = document.getElementById("readerSidebar");
    if (sidebar && !sidebar.classList.contains("hidden")) return;
    const searchBar = document.getElementById("readerSearchOverlay");
    if (searchBar && !searchBar.classList.contains("hidden")) return;

    const tb = document.querySelector(".premium-reader-toolbar");
    if (tb && !isToolbarHidden) {
      tb.classList.add("toolbar-autohidden");
      isToolbarHidden = true;
    }
  };

  window.toggleReaderToolbar = function() {
    if (isToolbarHidden) {
      window.showReaderToolbar();
    } else {
      window.hideReaderToolbar();
    }
  };

  function triggerTapFlash(direction) {
    try {
      const flash = document.createElement('div');
      flash.className = 'reader-tap-flash ' + direction;
      flash.innerHTML = direction === 'left' ? '<i class="fa-solid fa-chevron-left"></i>' : '<i class="fa-solid fa-chevron-right"></i>';
      document.body.appendChild(flash);
      setTimeout(() => flash.remove(), 400);
    } catch(e) {}
  }

  function handleReaderScrollEvent(scrollTop) {
    const diff = scrollTop - lastScrollY;
    if (scrollTop <= 30) {
      window.showReaderToolbar();
    } else if (diff > scrollThreshold) {
      // Scrolling down -> hide navbar for immersive reading
      window.hideReaderToolbar();
    } else if (diff < -12) {
      // Scrolling up -> reveal navbar immediately
      window.showReaderToolbar();
    }
    lastScrollY = scrollTop;
  }

  // Attach scroll observer to any active reading container
  window.attachReaderScrollObserver = function(el) {
    if (!el || el._hasScrollObs) return;
    el._hasScrollObs = true;
    el.addEventListener("scroll", function() {
      handleReaderScrollEvent(el.scrollTop);
    }, { passive: true });
  };

  // Setup Touch / Tap Zone listener for seamless mobile & click page turns
  window.initReaderTapZones = function(targetContainer) {
    if (!targetContainer || targetContainer._hasTapZones) return;
    targetContainer._hasTapZones = true;

    let startX = 0, startY = 0, startTime = 0;

    targetContainer.addEventListener('touchstart', function(e) {
      if (e.touches && e.touches.length === 1) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startTime = Date.now();
      }
    }, { passive: true });

    targetContainer.addEventListener('touchend', function(e) {
      if (!e.changedTouches || e.changedTouches.length !== 1) return;
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const elapsed = Date.now() - startTime;
      const distance = Math.hypot(endX - startX, endY - startY);

      // Only handle if it was a quick stationary TAP (< 380ms and < 14px movement)
      if (elapsed > 380 || distance > 14) return;

      const target = e.target;
      // Safety checks: do not intercept interactive elements or image zoom
      if (target.closest('a, button, input, select, textarea, img, image, .lightbox-overlay, .dropdown-container, .premium-popover, .premium-reader-sidebar, #lbOverlay')) {
        return;
      }
      // Check if text is currently selected
      if (window.getSelection && window.getSelection().toString().trim().length > 0) {
        return;
      }

      const w = window.innerWidth;
      if (endX < w * 0.22) {
        // Left 22%: Previous Page
        if (typeof window.handleReaderPrev === "function") {
          window.handleReaderPrev();
          triggerTapFlash('left');
        }
      } else if (endX > w * 0.78) {
        // Right 22%: Next Page
        if (typeof window.handleReaderNext === "function") {
          window.handleReaderNext();
          triggerTapFlash('right');
        }
      } else {
        // Center 56%: Toggle Toolbar
        window.toggleReaderToolbar();
      }
    }, { passive: true });

    // Desktop Mouse Move near top edge (reveal toolbar)
    targetContainer.addEventListener('mousemove', function(e) {
      if (e.clientY <= 36) {
        window.showReaderToolbar();
      }
    }, { passive: true });
  };

  window.openBookReader = async function (book) {
    if (!book) return;
    currentBookRef = book;

    // Si le livre provient d'un dossier local connecté sur ce PC (File System Access Zéro-Copie)
    if (book.isLocalFsBook || (book.id && book.id.startsWith('local_book_'))) {
      try {
        if (window.libraryDB && typeof window.libraryDB.getLocalFile === 'function') {
          const fileRecord = await window.libraryDB.getLocalFile('handle_' + book.id);
          if (fileRecord && fileRecord.handle) {
            let perm = 'granted';
            if (typeof fileRecord.handle.queryPermission === 'function') {
              perm = await fileRecord.handle.queryPermission({ mode: 'read' });
              if (perm !== 'granted' && typeof fileRecord.handle.requestPermission === 'function') {
                perm = await fileRecord.handle.requestPermission({ mode: 'read' });
              }
            }
            if (perm === 'granted') {
              const fileObj = await fileRecord.handle.getFile();
              try {
                book.arrayBuffer = await fileObj.arrayBuffer();
              } catch(e) {}
              const blobUrl = URL.createObjectURL(fileObj);
              book.file_path = blobUrl;
              book.filePath = blobUrl;
              book.url = blobUrl;
            }
          }
        }
      } catch (localFileErr) {
        console.warn('[Reader] Erreur lecture fichier local:', localFileErr);
      }
    }

    // Télémétrie invisible de lecture en coulisses
    try {
      var readSeriesId = book.seriesId || book.series_id;
      if (readSeriesId) {
        var readViewKey = 'nt_silent_read_' + readSeriesId;
        if (!sessionStorage.getItem(readViewKey)) {
          sessionStorage.setItem(readViewKey, '1');
          fetch('/api/catalog/series/' + encodeURIComponent(readSeriesId) + '/view', { method: 'POST' }).catch(function() {});
        }
      }
    } catch(e) {}

    const formatStr = (book.format || book.file_type || "").toLowerCase();
    const filePathStr = (book.file_path || book.filePath || "").toLowerCase();
    const isPdf = formatStr === "pdf" || filePathStr.endsWith(".pdf");

    if (isPdf) {
      book._hasPdfOriginal = true;
      // Stratégie Zéro-Latence : Conversion et streaming ultra-fluide en Mode Roman EPUB
      if (!book._forceRawPdf) {
        try {
          const overlay = document.getElementById("readerOverlay");
          const viewer = document.getElementById("readerViewer");
          const title = document.getElementById("readerTitle");
          if (overlay && viewer) {
            overlay.style.display = "flex";
            if (title) title.textContent = book.title || "Conversion...";
            viewer.innerHTML = `
              <div id="epubLoader" class="pdf-reader-loading-overlay">
                <div class="pdf-loader-card">
                  <div class="pdf-loader-icon-wrap" style="color:var(--primary, #e11d48);">
                    <i class="fa-solid fa-wand-magic-sparkles fa-bounce"></i>
                  </div>
                  <h3 class="pdf-loader-title">${(book.title || 'Volume PDF').replace(/</g, '&lt;')}</h3>
                  <div class="pdf-progress-track">
                    <div id="epubLoaderBar" class="pdf-progress-bar" style="width: 45%;"></div>
                  </div>
                  <p id="epubLoaderStatus" class="pdf-loader-status" style="font-weight: 600; color: #f43f5e;">Optimisation en Mode Roman Fluide (EPUB)...</p>
                  <p style="font-size: 12px; color: #94a3b8; margin-top: 6px;">Découpage des chapitres et extraction des illustrations HD</p>
                </div>
              </div>
            `;
          }

          const fileUrl = buildBookFileUrl(book);
          const fileKey = extractVolumeFileKey(book, fileUrl);
          if (fileKey) {
            const streamCheckResp = await fetch('/api/volume-chapters/' + encodeURIComponent(fileKey), {
              headers: { 'ngrok-skip-browser-warning': 'true' }
            });
            if (streamCheckResp.ok) {
              const manifest = await streamCheckResp.json();
              if (manifest.success && manifest.chapters && manifest.chapters.length > 0) {
                currentFormat = "epub";
                return openEpubReader(book);
              }
            }
          }
        } catch (streamErr) {
          console.warn('[Reader] Fallback vers le lecteur PDF Canvas:', streamErr);
        }
      }
      currentFormat = "pdf";
      book._forceRawPdf = true;
      return window.openPdfReader(book);
    } else {
      currentFormat = "epub";
      return openEpubReader(book);
    }
  };

  // Global openReader bridge for library and home continue banner
  window.openReader = async function (arg1) {
    if (typeof arg1 === "object" && arg1 !== null && arg1.id) {
      if ((!arg1.file_path && !arg1.filePath && !arg1.fileKey) && typeof allBooks !== "undefined" && Array.isArray(allBooks)) {
        const found = allBooks.find(b => b.id === arg1.id);
        if (found) arg1 = { ...found, ...arg1 };
      }
      return window.openBookReader(arg1);
    }
    if (typeof arg1 === "string") {
      if (window.libraryDB && typeof window.libraryDB.getAllBooks === "function") {
        try {
          const books = await window.libraryDB.getAllBooks();
          const found = books.find(b => b.id === arg1);
          if (found) return window.openBookReader(found);
        } catch(e) {}
      }
      const isPdf = arg1.toLowerCase().includes("pdf");
      return window.openBookReader({
        id: arg1,
        title: "Livre " + arg1.substring(0, 8),
        format: isPdf ? "pdf" : "epub"
      });
    }
  };

  // ==========================================================================
  //  STREAMING ENGINE (LNori Architecture - On-Demand Chapter Streaming)
  // ==========================================================================
  window._isStreamVolume = false;
  window._streamVolumeManifest = null;
  window._streamFileKey = null;
  window._streamCurrentChapter = 1;

  function extractVolumeFileKey(book, fileUrl) {
    if (book && book.fileKey) return book.fileKey;
    if (book && book.id && (book.id.startsWith('local_') || book.id.startsWith('external_'))) {
      return book.id;
    }
    let raw = (book && (book.file_path || book.filePath || book.url)) || fileUrl || '';
    if (raw.includes('/volume-stream/')) {
      const parts = raw.split('/volume-stream/');
      if (parts[1]) return decodeURIComponent(parts[1].split('?')[0].replace(/\.(pdf|epub)$/i, ''));
    }
    if (raw.includes('/uploads/volumes/')) {
      const fn = raw.split('/uploads/volumes/')[1];
      if (fn) return decodeURIComponent(fn.split('?')[0].replace(/\.(pdf|epub)$/i, ''));
    }
    if (book && book.id) {
      return book.id.replace(/\.(pdf|epub)$/i, '');
    }
    return null;
  }

  function buildStreamToc(manifest) {
    const tocList = document.getElementById("readerTocList");
    if (!tocList) return;
    tocList.innerHTML = "";
    if (!manifest || !manifest.chapters || manifest.chapters.length === 0) {
      tocList.innerHTML = '<li style="padding:16px;color:#64748b;font-size:13px;text-align:center;"><em>Aucun chapitre disponible</em></li>';
      return;
    }
    manifest.chapters.forEach(ch => {
      const li = document.createElement("li");
      li.className = "toc-item" + (ch.chapterNumber === window._streamCurrentChapter ? " active" : "");
      li.id = "streamTocItem_" + ch.chapterNumber;
      const a = document.createElement("a");
      a.href = "#";
      a.textContent = ch.title || ("Chapitre " + ch.chapterNumber);
      a.onclick = function (e) {
        e.preventDefault();
        loadStreamChapter(ch.chapterNumber);
        const sidebar = document.getElementById("readerSidebar");
        if (sidebar && window.innerWidth < 768) {
          sidebar.classList.add("hidden");
        }
      };
      li.appendChild(a);
      tocList.appendChild(li);
    });
  }

  function updateStreamTocActive(activeNum) {
    document.querySelectorAll("#readerTocList .toc-item").forEach(el => {
      el.classList.remove("active");
    });
    const activeEl = document.getElementById("streamTocItem_" + activeNum);
    if (activeEl) {
      activeEl.classList.add("active");
      try {
        activeEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } catch(e) {}
    }
  }

  let _isStreamChapterLoading = false;
  let _lastReaderNavTimestamp = 0;

  window.streamReaderGoTo = function(chapterNum) {
    loadStreamChapter(chapterNum);
  };

  // ── CONTINUOUS VERTICAL STREAM STATE ──
  let _isAppendingStreamChapter = false;
  let _highestLoadedChapter = 1;
  let _chapterIntersectionObserver = null;
  const _streamChapterMemoryCache = new Map();

  async function fetchStreamChapterData(fileKey, num) {
    const key = `${fileKey}:${num}`;
    if (_streamChapterMemoryCache.has(key)) {
      return _streamChapterMemoryCache.get(key);
    }
    const resp = await fetch('/api/volume-chapters/' + encodeURIComponent(fileKey) + '/' + num, {
      headers: { 'ngrok-skip-browser-warning': 'true' }
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (!data.success || !data.chapter) throw new Error(data.message || 'Données manquantes');
    _streamChapterMemoryCache.set(key, data);
    return data;
  }

  function updateStreamHeaderAndProgress(num, total, manifest) {
    const progressText = document.getElementById("readerProgressText");
    const titleEl = document.getElementById("readerTitle");
    const pct = Math.round((num / total) * 100);

    if (progressText) {
      progressText.textContent = num + " / " + total + " (" + pct + "%)";
    }

    const chMeta = (manifest && manifest.chapters && manifest.chapters.find(c => c.chapterNumber === num)) || { title: "Chapitre " + num };
    if (titleEl && currentBookRef) {
      const baseBookTitle = (currentBookRef.title || "Livre").split(' - Chapitre')[0].split(' - Section')[0];
      titleEl.textContent = baseBookTitle + " - " + chMeta.title;
    }

    updateStreamTocActive(num);

    if (manifest && manifest.fileKey) {
      try {
        localStorage.setItem('reading_chapter_' + manifest.fileKey, num.toString());
        if (currentBookRef) {
          currentBookRef.chapterNumber = num;
          currentBookRef.progress = pct;
          currentBookRef.lastReadDate = Date.now();
          if (window.libraryDB && typeof window.libraryDB.saveBook === "function") {
            window.libraryDB.saveBook(currentBookRef);
          }
        }
      } catch(e) {}
    }
  }

  
  // ==========================================================================
  //  END OF VOLUME COMPLETION & WEBTOON COMMENTS
  // ==========================================================================
  function renderStreamVolumeCompletionAndComments(body, manifest, bookRef) {
    if (!body || !manifest) return;
    if (document.getElementById("streamVolumeCompletionWrap")) return; // Avoid duplicate

    const wrap = document.createElement("div");
    wrap.id = "streamVolumeCompletionWrap";
    wrap.className = "stream-volume-completion-wrap";

    // Detect if next volume is available
    let nextVolumeBook = null;
    try {
      const sId = bookRef ? (bookRef.seriesId || bookRef.series_id) : null;
      const currentVolNum = bookRef ? (bookRef.volumeNumber || bookRef.volume_number) : null;
      if (sId && currentVolNum && typeof allBooks !== 'undefined' && Array.isArray(allBooks)) {
        nextVolumeBook = allBooks.find(b => {
          const bSeries = b.seriesId || b.series_id;
          const bVol = b.volumeNumber || b.volume_number;
          return bSeries === sId && bVol === (currentVolNum + 1);
        });
      }
      if (!nextVolumeBook && typeof currentSeries !== 'undefined' && currentSeries && Array.isArray(currentSeries.volumes)) {
        const nextVol = currentSeries.volumes.find(v => (v.volume_number || v.number) === (currentVolNum + 1));
        if (nextVol) {
          nextVolumeBook = {
            id: nextVol.id || (currentSeries.id + '_vol_' + (currentVolNum + 1)),
            title: currentSeries.title + ' - ' + (nextVol.title || ('Volume ' + (currentVolNum + 1))),
            seriesId: currentSeries.id,
            volumeNumber: currentVolNum + 1,
            format: (nextVol.format || nextVol.file_type || '').toLowerCase() === 'pdf' ? 'pdf' : 'epub',
            file_path: nextVol.file_path || nextVol.filePath,
            cover: nextVol.cover || nextVol.cover_url || currentSeries.cover
          };
        }
      }
    } catch(e) {}

    window._nextVolumeInReader = nextVolumeBook;

    wrap.innerHTML = `
      <div class="stream-book-completed-card">
        <div class="completed-icon"><i class="fa-solid fa-trophy"></i></div>
        <h3>Fin du Volume</h3>
        <p>Vous avez atteint la fin de ce volume. Félicitations pour votre lecture !</p>
        
        <div class="completed-actions-row">
          ${nextVolumeBook ? `
            <button type="button" class="btn-completed-action primary" onclick="if (window._nextVolumeInReader && typeof window.openBookReader === 'function') window.openBookReader(window._nextVolumeInReader);">
              <i class="fa-solid fa-book-open"></i> <span>Volume Suivant</span>
            </button>
          ` : ''}
          <button type="button" class="btn-completed-action secondary" onclick="if (typeof window.closePdfReader === 'function') window.closePdfReader();">
            <i class="fa-solid fa-arrow-left"></i> <span>Fiche du Roman</span>
          </button>
          <button type="button" class="btn-completed-action ghost" onclick="const sc = document.getElementById('streamChapterContainer'); if (sc) sc.scrollTo({ top: 0, behavior: 'smooth' });">
            <i class="fa-solid fa-arrow-up"></i> <span>Haut du volume</span>
          </button>
        </div>
      </div>

      <div id="streamVolumeCommentsMount" class="stream-volume-comments-mount"></div>
    `;

    body.appendChild(wrap);

    // Mount Webtoon Comments (with mobile resilience & retry)
    const fileKey = manifest.fileKey || (bookRef && (bookRef.fileKey || bookRef.id)) || 'vol_' + Date.now();
    const mount = wrap.querySelector("#streamVolumeCommentsMount") || document.getElementById("streamVolumeCommentsMount");

    function tryMountVolumeComments(attempts) {
      const m = wrap.querySelector("#streamVolumeCommentsMount") || document.getElementById("streamVolumeCommentsMount");
      if (!m) return;
      if (typeof window.renderVolumeCommentsSection === 'function') {
        window.renderVolumeCommentsSection(m, fileKey, {
          title: bookRef ? bookRef.title : (manifest.title || 'Volume'),
          seriesId: bookRef ? (bookRef.seriesId || bookRef.series_id) : null,
          volumeNumber: bookRef ? (bookRef.volumeNumber || bookRef.volume_number) : 1,
          totalChapters: manifest.totalChapters
        });
      } else if (attempts > 0) {
        setTimeout(function() {
          tryMountVolumeComments(attempts - 1);
        }, 200);
      }
    }
    tryMountVolumeComments(5);
  }

  async function appendNextStreamChapter() {
    if (_isAppendingStreamChapter || !window._streamVolumeManifest) return;
    const manifest = window._streamVolumeManifest;
    const total = manifest.totalChapters;
    if (_highestLoadedChapter >= total) return;

    _isAppendingStreamChapter = true;
    const nextNum = _highestLoadedChapter + 1;
    const sentinel = document.getElementById("streamChapterSentinel");
    const body = document.getElementById("streamChapterBody");

    if (sentinel) {
      sentinel.innerHTML = `<div class="stream-append-loader"><i class="fa-solid fa-circle-notch fa-spin"></i> Chargement du Chapitre ${nextNum}...</div>`;
    }

    try {
      const data = await fetchStreamChapterData(manifest.fileKey, nextNum);
      const chapter = data.chapter;
      const chMeta = manifest.chapters.find(c => c.chapterNumber === nextNum) || { title: "Chapitre " + nextNum };
      const chapterTitle = (chapter.title || chMeta.title || ('Chapitre ' + nextNum)).replace(/</g, '&lt;');

      const divWrapper = document.createElement("div");
      divWrapper.innerHTML = `
        <div class="stream-chapter-divider">
          <span class="divider-line"></span>
          <span class="divider-pill"><i class="fa-solid fa-book-open"></i> Chapitre ${nextNum}</span>
          <span class="divider-line"></span>
        </div>
        <section class="stream-chapter-section" id="streamChapter_${nextNum}" data-chapter-num="${nextNum}">
          <header class="stream-chapter-header">
            <div class="stream-chapter-badge">Chapitre ${nextNum} sur ${total}</div>
            <h2 class="stream-chapter-title">${chapterTitle}</h2>
          </header>

          <article class="stream-chapter-content">
            ${chapter.content}
          </article>
        </section>
      `;

      if (body) {
        while (divWrapper.firstChild) {
          body.appendChild(divWrapper.firstChild);
        }
      }

      _highestLoadedChapter = nextNum;

      const newSec = document.getElementById(`streamChapter_${nextNum}`);
      if (newSec && _chapterIntersectionObserver) {
        _chapterIntersectionObserver.observe(newSec);
      }

      const art = newSec ? newSec.querySelector('.stream-chapter-content') : null;
      if (art && typeof window.initInlineParagraphComments === 'function') {
        window.initInlineParagraphComments(art, manifest.fileKey, nextNum);
      }

      if (_highestLoadedChapter >= total && body) {
        const finishCard = document.createElement("div");
        finishCard.className = "stream-book-completed-card";
        finishCard.innerHTML = `
          <div class="completed-icon"><i class="fa-solid fa-circle-check"></i></div>
          <h3>Fin du Volume</h3>
          <p>Vous avez atteint la fin de ce volume. Félicitations pour votre lecture !</p>
        `;
        body.appendChild(finishCard);
      }
    } catch (err) {
      console.warn("[Stream Reader] Erreur append chapitre", nextNum, err);
    } finally {
      if (sentinel) sentinel.innerHTML = "";
      _isAppendingStreamChapter = false;
    }
  }

  async function loadStreamChapter(chapterNum) {
    if (!window._streamVolumeManifest) return;
    if (_isStreamChapterLoading) return;
    _isStreamChapterLoading = true;

    if (_chapterIntersectionObserver) {
      _chapterIntersectionObserver.disconnect();
      _chapterIntersectionObserver = null;
    }

    const manifest = window._streamVolumeManifest;
    const total = manifest.totalChapters;
    const num = Math.max(1, Math.min(chapterNum, total));
    window._streamCurrentChapter = num;
    _highestLoadedChapter = num;

    const viewer = document.getElementById("readerViewer");
    if (!viewer) {
      _isStreamChapterLoading = false;
      return;
    }

    const chMeta = manifest.chapters.find(c => c.chapterNumber === num) || { title: "Chapitre " + num };

    viewer.innerHTML = `
      <div id="epubLoader" class="pdf-reader-loading-overlay">
        <div class="pdf-loader-card">
          <div class="pdf-loader-icon-wrap">
            <i class="fa-solid fa-circle-notch fa-spin" style="color:var(--primary, #e11d48);"></i>
          </div>
          <h3 class="pdf-loader-title">${(chMeta.title || '').replace(/</g, '&lt;')}</h3>
          <p class="pdf-loader-status">Chargement ultra-rapide du chapitre...</p>
        </div>
      </div>
    `;

    try {
      const data = await fetchStreamChapterData(manifest.fileKey, num);
      const chapter = data.chapter;
      const chapterTitle = (chapter.title || chMeta.title || ('Chapitre ' + num)).replace(/</g, '&lt;');

      viewer.innerHTML = `
        <div id="streamChapterContainer" class="stream-chapter-container">
          <div class="stream-chapter-body" id="streamChapterBody">
            <section class="stream-chapter-section" id="streamChapter_${num}" data-chapter-num="${num}">
              <header class="stream-chapter-header">
                <div class="stream-chapter-badge">Chapitre ${num} sur ${total}</div>
                <h2 class="stream-chapter-title">${chapterTitle}</h2>
              </header>

              <article class="stream-chapter-content">
                ${chapter.content}
              </article>
            </section>
          </div>
          <div id="streamChapterSentinel" class="stream-chapter-sentinel"></div>
        </div>
      `;

      applyEpubThemeAndSettings();
      syncModeBtn();
      updateReaderFormatControls("epub");

      const cont = document.getElementById("streamChapterContainer");
      if (cont) {
        cont.scrollTop = 0;
        window.attachReaderScrollObserver(cont);

        // Continuous Vertical Infinite Scroll Trigger
        cont.addEventListener("scroll", () => {
          if (_isAppendingStreamChapter) return;
          if (_highestLoadedChapter >= total) return;
          const distanceToBottom = cont.scrollHeight - (cont.scrollTop + cont.clientHeight);
          if (distanceToBottom < 750) {
            appendNextStreamChapter();
          }
        }, { passive: true });
      }

      // Update Toolbar & Header
      updateStreamHeaderAndProgress(num, total, manifest);

      if (num >= total) {
        const stBody = document.getElementById("streamChapterBody");
        if (stBody) {
          renderStreamVolumeCompletionAndComments(stBody, manifest, currentBookRef);
        }
      }

      // IntersectionObserver for active chapter as reader scrolls vertically
      _chapterIntersectionObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const chNum = parseInt(entry.target.getAttribute('data-chapter-num'), 10);
            if (chNum && chNum !== window._streamCurrentChapter) {
              window._streamCurrentChapter = chNum;
              updateStreamHeaderAndProgress(chNum, total, manifest);
            }
          }
        });
      }, {
        root: cont,
        rootMargin: "-15% 0px -65% 0px",
        threshold: 0
      });

      const firstSec = document.getElementById(`streamChapter_${num}`);
      if (firstSec && _chapterIntersectionObserver) {
        _chapterIntersectionObserver.observe(firstSec);
      }

      // In-Line Paragraph Comments Hook
      if (typeof window.initInlineParagraphComments === 'function') {
        const art = document.querySelector('.stream-chapter-content');
        if (art && manifest.fileKey) {
          window.initInlineParagraphComments(art, manifest.fileKey, num);
        }
      }

    } catch (loadErr) {
      console.error("[Stream Reader] Error loading chapter:", loadErr);
      viewer.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--text-secondary);gap:12px;padding:40px;text-align:center;">
          <i class="fa-solid fa-circle-exclamation fa-3x" style="color:#ef4444;"></i>
          <p style="font-size:16px;color:#fff;">Impossible de charger le chapitre ${num}.</p>
          <p style="font-size:13px;color:#94a3b8;max-width:400px;">${(loadErr.message || '').replace(/</g, '&lt;')}</p>
          <button onclick="window.streamReaderGoTo(${num})" class="btn-hero-primary" style="padding: 8px 20px; font-size: 13px; border-radius: 8px; cursor: pointer; margin-top: 8px;">
            <i class="fa-solid fa-rotate-right"></i> Réessayer
          </button>
        </div>
      `;
    } finally {
      _isStreamChapterLoading = false;
    }
  }

  // ==========================================================================
  //  1. EPUB READER ENGINE (ePub.js)
  // ==========================================================================
  async function openEpubReader(book) {
    const overlay = document.getElementById("readerOverlay");
    const viewer = document.getElementById("readerViewer");
    const title = document.getElementById("readerTitle");
    const sidebar = document.getElementById("readerSidebar");
    const pageContainer = document.getElementById("readerPage");

    if (!overlay || !viewer) {
      console.warn("[EPUB Reader] readerOverlay ou readerViewer introuvable dans le DOM.");
      return;
    }

    closeInternalReaders();

    overlay.style.display = "flex";
    if (title) title.textContent = book.title || "EPUB";
    if (pageContainer) pageContainer.classList.remove("pdf-reading-mode");
    if (sidebar) sidebar.classList.add("hidden");

    const bookTitleEscaped = (book.title || "Livre EPUB").replace(/</g, "&lt;");
    viewer.innerHTML = `
      <div id="epubLoader" class="pdf-reader-loading-overlay">
        <div class="pdf-loader-card">
          <div class="pdf-loader-icon-wrap">
            <i class="fa-solid fa-book-open fa-beat-fade"></i>
          </div>
          <h3 class="pdf-loader-title">${bookTitleEscaped}</h3>
          <div class="pdf-progress-track">
            <div id="epubLoaderBar" class="pdf-progress-bar" style="width: 5%;"></div>
          </div>
          <p id="epubLoaderStatus" class="pdf-loader-status">Connexion au livre...</p>
        </div>
      </div>
    `;

    const fileUrl = buildBookFileUrl(book);
    if (!fileUrl) {
      viewer.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#ef4444;gap:12px;">
        <i class="fa-solid fa-circle-exclamation fa-3x"></i>
        <p>Fichier du livre introuvable.</p>
      </div>`;
      return;
    }

    // 1. LNori Architecture : Streaming instantané par chapitres (~30 Ko)
    const fileKey = extractVolumeFileKey(book, fileUrl);
    if (fileKey) {
      try {
        const streamCheckResp = await fetch('/api/volume-chapters/' + encodeURIComponent(fileKey), {
          headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        if (streamCheckResp.ok) {
          const manifest = await streamCheckResp.json();
          if (manifest.success && manifest.chapters && manifest.chapters.length > 0) {
            window._isStreamVolume = true;
            window._streamVolumeManifest = manifest;
            window._streamFileKey = fileKey;

            buildStreamToc(manifest);

            let savedCh = parseInt(localStorage.getItem('reading_chapter_' + fileKey) || (book.chapterNumber ? book.chapterNumber : '1'), 10);
            if (isNaN(savedCh) || savedCh < 1 || savedCh > manifest.totalChapters) {
              savedCh = 1;
            }

            await loadStreamChapter(savedCh);
            return;
          }
        }
      } catch (streamErr) {
        console.warn('[EPUB Reader] Le streaming de chapitres a échoué, repli vers ePub.js complet:', streamErr);
      }
    }

    // 2. Repli standard ePub.js : Téléchargement du volume complet (avec cache local)
    const bar = document.getElementById("epubLoaderBar");
    const status = document.getElementById("epubLoaderStatus");

    // Timeout de sécurité bienveillant (45 secondes au lieu de 4s), affichant un message avec bouton Réessayer en cas de coupure
    let safetyTimeout = setTimeout(() => {
      const loader = document.getElementById("epubLoader");
      if (loader && !window._currentEpubRendition) {
        loader.innerHTML = `
          <div class="pdf-loader-card" style="border: 1px solid rgba(239,68,68,0.3);">
            <div class="pdf-loader-icon-wrap" style="color: #ef4444;">
              <i class="fa-solid fa-triangle-exclamation"></i>
            </div>
            <h3 class="pdf-loader-title">Connexion ralentie</h3>
            <p class="pdf-loader-status" style="margin-bottom: 16px;">Le téléchargement mobile prend plus de temps que prévu.</p>
            <button onclick="window.openBookReader(window.currentBookRef)" class="btn-hero-primary" style="padding: 8px 20px; font-size: 13px; border-radius: 8px; cursor: pointer;">
              <i class="fa-solid fa-rotate-right"></i> Réessayer
            </button>
          </div>
        `;
      }
    }, 45000);

    try {
      if (typeof ePub === "undefined") {
        throw new Error("Moteur ePub.js non chargé.");
      }

      // 1. Vérifier le Cache Local (0 ms si déjà préchargé ou déjà lu)
      let bookData = book.arrayBuffer || await getVolumeFromCache(fileUrl);

      if (bookData) {
        if (status) status.textContent = "Chargement instantané depuis le cache local...";
        if (bar) bar.style.width = "100%";
      } else {
        if (status) status.textContent = "Téléchargement du volume...";

        let headers = {
          'ngrok-skip-browser-warning': 'true',
          'Accept': 'application/octet-stream, application/epub+zip, */*'
        };
        if (window.authManager && typeof window.authManager.getAccessToken === "function") {
          try {
            const token = await window.authManager.getAccessToken();
            if (token) headers["Authorization"] = "Bearer " + token;
          } catch(e) {}
        }

        const resp = await fetch(fileUrl, { headers });
        if (!resp.ok) {
          throw new Error(`Impossible de charger le fichier (HTTP ${resp.status})`);
        }

        const contentLength = +(resp.headers.get('Content-Length') || 0);

        if (resp.body && contentLength > 0) {
          const reader = resp.body.getReader();
          let receivedLength = 0;
          const chunks = [];

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            receivedLength += value.length;
            const pct = Math.min(100, Math.round((receivedLength / contentLength) * 100));
            const mbLoaded = (receivedLength / (1024 * 1024)).toFixed(1);
            const mbTotal = (contentLength / (1024 * 1024)).toFixed(1);
            if (bar) bar.style.width = Math.max(5, pct) + "%";
            if (status) status.textContent = `Téléchargement : ${pct}% (${mbLoaded} Mo / ${mbTotal} Mo)`;
          }

          const allChunks = new Uint8Array(receivedLength);
          let position = 0;
          for (const chunk of chunks) {
            allChunks.set(chunk, position);
            position += chunk.length;
          }
          bookData = allChunks.buffer;
        } else {
          bookData = await resp.arrayBuffer();
        }

        // Sauvegarder immédiatement dans le cache local du navigateur
        await saveVolumeToCache(fileUrl, bookData);
      }

      if (status) status.textContent = "Ouverture des chapitres...";

      const epubBook = ePub(bookData);
      window._currentEpubBook = epubBook;

      const isWebtoon = (currentReadMode === "webtoon");
      const rendition = epubBook.renderTo(viewer, {
        width: "100%",
        height: "100%",
        spread: "none",
        flow: isWebtoon ? "scrolled" : "paginated",
        manager: isWebtoon ? "continuous" : "default"
      });
      window._currentEpubRendition = rendition;

      // Hook automatique sur toutes les illustrations de chapitres ePub.js
      if (rendition.hooks && rendition.hooks.content) {
        rendition.hooks.content.register(function(contents) {
          try {
            const doc = contents.document;
            if (doc) {
              doc.addEventListener('scroll', function() {
                const st = doc.documentElement.scrollTop || doc.body.scrollTop || 0;
                handleReaderScrollEvent(st);
              }, { passive: true });
              doc.addEventListener('mousemove', function(e) {
                if (e.clientY <= 36) window.showReaderToolbar();
              }, { passive: true });
            }
          } catch(e) {}
        });
        rendition.hooks.content.register(function(contents) {
          try {
            const doc = contents.document;
            if (!doc) return;
            const style = doc.createElement('style');
            style.textContent = `
              img, image {
                cursor: zoom-in !important;
                transition: transform 0.18s ease, filter 0.18s ease !important;
                border-radius: 6px !important;
              }
              img:hover, image:hover {
                filter: brightness(1.08) !important;
                box-shadow: 0 4px 20px rgba(225, 29, 72, 0.25) !important;
              }
            `;
            doc.head.appendChild(style);

            doc.addEventListener('click', function(e) {
              const img = e.target.closest('img, image');
              if (img) {
                e.preventDefault();
                e.stopPropagation();
                const rawSrc = img.currentSrc || img.src || (img.href && img.href.baseVal) || img.getAttribute('xlink:href') || img.getAttribute('href');
                let src = rawSrc;
                try {
                  if (rawSrc && !rawSrc.startsWith('blob:') && !rawSrc.startsWith('data:') && !rawSrc.startsWith('http')) {
                    src = new URL(rawSrc, doc.baseURI || doc.location.href).href;
                  }
                } catch(_) {}
                const openFn = window.openIllustrationLightbox || (window.parent && window.parent.openIllustrationLightbox) || (window.top && window.top.openIllustrationLightbox);
                if (src && openFn) {
                  openFn(src, img.alt || '');
                }
              }
            });
          } catch(hookErr) {
            console.warn('[EPUB Rendition Hook]', hookErr);
          }
        });
      }

      rendition.on("rendered", function () {
        clearTimeout(safetyTimeout);
        const loader = document.getElementById("epubLoader");
        if (loader) loader.remove();
      });

      const startLoc = (book.location && typeof book.location === 'string' && book.location.trim()) ? book.location.trim() : undefined;
      try {
        await rendition.display(startLoc);
      } catch (dispErr) {
        console.warn("[EPUB Reader] Échec affichage position sauvegardée, affichage première page:", dispErr);
        await rendition.display();
      }

      clearTimeout(safetyTimeout);
      const loader = document.getElementById("epubLoader");
      if (loader) loader.remove();

      applyEpubThemeAndSettings();
      syncModeBtn();

      rendition.on("relocated", function (location) {
        if (!location || !location.start) return;
        try {
          if (epubBook.locations && epubBook.locations.length() > 0) {
            const pct = epubBook.locations.percentageFromCfi(location.start.cfi);
            const rounded = Math.round(pct * 100);
            updateProgressText(rounded + "%");
            saveEpubProgress(location.start.cfi, rounded);
          }
        } catch(e) {}
      });

      const deferLocGen = window.requestIdleCallback || ((cb) => setTimeout(cb, 1800));
      epubBook.ready.then(() => {
        deferLocGen(() => {
          if (!window._currentEpubBook || window._currentEpubBook !== epubBook) return;
          epubBook.locations.generate(2000).then(() => {
            if (rendition.location && rendition.location.start && epubBook.locations.length() > 0) {
              const pct = epubBook.locations.percentageFromCfi(rendition.location.start.cfi);
              updateProgressText(Math.round(pct * 100) + "%");
            }
          }).catch(() => {});
        });
      });

      buildEpubToc(epubBook);

    } catch (err) {
      clearTimeout(safetyTimeout);
      console.error("[EPUB Reader] Load error:", err);
      viewer.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--text-secondary);gap:12px;padding:40px;text-align:center;">
        <i class="fa-solid fa-circle-exclamation fa-3x" style="color:#ef4444;"></i>
        <p style="font-size:16px;color:#fff;">Impossible de charger ce livre EPUB.</p>
        <p style="font-size:13px;color:#94a3b8;max-width:400px;">${(err.message || '').replace(/</g, '&lt;')}</p>
        <a href="${fileUrl}" download class="btn-hero-primary" style="text-decoration:none;margin-top:8px;">
          <i class="fa-solid fa-download"></i> Télécharger l'EPUB
        </a>
      </div>`;
    }
  }

  // ==========================================================================
  //  EPUB HELPER FUNCTIONS & THEME ENGINE
  // ==========================================================================
  function buildEpubToc(epubBook) {
    if (!epubBook || !epubBook.loaded || !epubBook.loaded.navigation) return;
    epubBook.loaded.navigation.then(nav => {
      renderEpubToc(nav.toc);
    }).catch(e => console.warn("[EPUB TOC]", e));
  }

  function renderEpubToc(tocItems) {
    const tocList = document.getElementById("readerTocList");
    if (!tocList) return;
    tocList.innerHTML = "";
    if (!tocItems || tocItems.length === 0) {
      tocList.innerHTML = '<li style="padding:16px;color:#64748b;font-size:13px;text-align:center;"><em>Aucun sommaire disponible</em></li>';
      return;
    }
    function appendItems(items, parent) {
      items.forEach(item => {
        const li = document.createElement("li");
        li.className = "toc-item";
        const a = document.createElement("a");
        a.href = "#";
        a.textContent = item.label ? item.label.trim() : "Chapitre";
        a.onclick = function (e) {
          e.preventDefault();
          if (window._currentEpubRendition) {
            window._currentEpubRendition.display(item.href);
            const sidebar = document.getElementById("readerSidebar");
            if (sidebar && window.innerWidth < 768) {
              sidebar.classList.add("hidden");
            }
          }
        };
        li.appendChild(a);
        if (item.subitems && item.subitems.length > 0) {
          const subUl = document.createElement("ul");
          subUl.className = "toc-sublist";
          appendItems(item.subitems, subUl);
          li.appendChild(subUl);
        }
        parent.appendChild(li);
      });
    }
    appendItems(tocItems, tocList);
  }

  function saveEpubProgress(cfi, pct) {
    if (!currentBookRef) return;
    currentBookRef.location = cfi;
    currentBookRef.progress = pct;
    currentBookRef.lastReadDate = Date.now();
    if (window.libraryDB && typeof window.libraryDB.saveBook === "function") {
      window.libraryDB.saveBook(currentBookRef);
    }
  }

  function applyEpubThemeAndSettings() {
    const overlay = document.getElementById("readerOverlay");
    if (overlay) {
      overlay.classList.remove("theme-light", "theme-sepia", "theme-dark");
      overlay.classList.add("theme-" + currentTheme);
    }

    const textPercentEl = document.getElementById("textPercent");
    if (textPercentEl) textPercentEl.textContent = currentFontSize + "%";

    // Application dynamique sur le conteneur de streaming LNori
    const streamContainer = document.getElementById("streamChapterContainer");
    if (streamContainer) {
      const baseSize = 17; // Taille de police de référence ePub officiel
      const scaledSize = (1.0625 * (currentFontSize / 100)).toFixed(3);
      const contentEl = streamContainer.querySelector(".stream-chapter-content");
      if (contentEl) {
        contentEl.style.fontSize = scaledSize + "rem";
      } else {
        streamContainer.style.fontSize = (baseSize * (currentFontSize / 100)) + "px";
      }

      const bodyEl = streamContainer.querySelector(".stream-chapter-body");
      if (bodyEl) {
        const maxWidthMap = {
          "0%": "880px",
          "5%": "740px",
          "15%": "620px"
        };
        bodyEl.style.maxWidth = maxWidthMap[currentMargin] || "740px";
      }

      const paddingMap = {
        "0%": "20px 12px 100px 12px",
        "5%": "32px 24px 100px 24px",
        "15%": "40px 48px 100px 48px"
      };
      streamContainer.style.padding = paddingMap[currentMargin] || "32px 24px 100px 24px";

      const colors = {
        light: { text: "#111827" },
        sepia: { text: "#453424" },
        dark:  { text: "#f4f4f5" }
      };
      const c = colors[currentTheme] || colors.dark;
      streamContainer.style.color = c.text;
    }

    if (window._currentEpubRendition && window._currentEpubRendition.themes) {
      const colors = {
        light: { bg: "#ffffff", text: "#1e293b" },
        sepia: { bg: "#f4ecd8", text: "#5b4636" },
        dark:  { bg: "#090a10", text: "#e2e8f0" }
      };
      const c = colors[currentTheme] || colors.dark;
      const paddingHoriz = currentMargin || "5%";

      const themeObj = {
        "body": {
          "background-color": c.bg + " !important",
          "color": c.text + " !important",
          "font-size": currentFontSize + "% !important",
          "line-height": "1.75 !important",
          "padding-left": paddingHoriz + " !important",
          "padding-right": paddingHoriz + " !important",
          "padding-top": "30px !important",
          "padding-bottom": "60px !important"
        },
        "p, div, span, li, a, h1, h2, h3, h4, h5, h6": {
          "color": c.text + " !important",
          "font-size": currentFontSize + "% !important"
        }
      };
      try {
        window._currentEpubRendition.themes.register("userTheme", themeObj);
        window._currentEpubRendition.themes.select("userTheme");
      } catch(e) {}
    }
  }

  function applyPdfThemeAndSettings() {
    const overlay = document.getElementById("readerOverlay");
    if (overlay) {
      overlay.classList.remove("theme-light", "theme-sepia", "theme-dark");
      overlay.classList.add("theme-" + currentTheme);
    }
  }

  // ==========================================================================
  //  2. PDF READER ENGINE (PDF.js) - HIGH PERFORMANCE & CACHED PRE-RENDERING
  // ==========================================================================

  // In-memory page pre-rendering cache for 0ms instantaneous page flips
  const pdfPageCache = new Map(); // pageNum -> { wrapper: HTMLElement, time: number }
  const MAX_PAGE_CACHE = 8;

  function shouldRenderDualSpread() {
    if (pdfSpreadMode === "single") return false;
    if (pdfSpreadMode === "double") return true;
    // Mode Auto : double page si écran >= 992px et format paysage
    return window.innerWidth >= 992 && window.innerWidth > window.innerHeight;
  }

  async function getRenderedPageCanvas(pageNum, container, isDualSpread = false) {
    if (!pdfDoc || pageNum < 1 || pageNum > totalPages) return null;
    const cacheKey = pageNum + "_" + (isDualSpread ? "dual" : "single") + "_" + pdfFitMode + "_" + pdfZoom;
    if (pdfPageCache.has(cacheKey)) {
      const cached = pdfPageCache.get(cacheKey);
      cached.time = Date.now();
      return cached.canvas.cloneNode(true);
    }

    const page = await pdfDoc.getPage(pageNum);
    const baseViewport = page.getViewport({ scale: 1.0 });

    const mainEl = document.getElementById("readerMainContainer") || container.parentElement;
    let availWidth = mainEl ? mainEl.clientWidth : window.innerWidth;
    if (isDualSpread) {
      availWidth = (availWidth / 2) - 8;
    }
    // Prendre un maximum d'espace vertical disponible (barre de 50px)
    const availHeight = Math.max(300, window.innerHeight - 56);

    const scaleW = availWidth / baseViewport.width;
    const scaleH = availHeight / baseViewport.height;

    // Calcul de l'échelle d'ajustement optimal
    let fitScale;
    if (pdfFitMode === "width") {
      fitScale = scaleW;
    } else {
      // Ajustement page entière : prend le maximum sans dépasser
      fitScale = Math.min(scaleW, scaleH);
    }
    const scale = fitScale * pdfZoom;

    // Rendu Retina net
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const viewport = page.getViewport({ scale: scale * dpr });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const cssWidth = Math.round(viewport.width / dpr);
    const cssHeight = Math.round(viewport.height / dpr);
    canvas.style.width = cssWidth + "px";
    canvas.style.height = cssHeight + "px";
    canvas.className = "pdf-page-canvas";
    canvas.dataset.pageNum = pageNum;

    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport: viewport }).promise;

    if (pdfPageCache.size >= MAX_PAGE_CACHE) {
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [k, v] of pdfPageCache.entries()) {
        if (v.time < oldestTime) {
          oldestTime = v.time;
          oldestKey = k;
        }
      }
      if (oldestKey !== null) pdfPageCache.delete(oldestKey);
    }

    pdfPageCache.set(cacheKey, { canvas: canvas, time: Date.now() });
    return canvas;
  }

  async function getRenderedPageWrapper(pageNum, container) {
    const isDual = shouldRenderDualSpread();
    const spreadWrapper = document.createElement("div");
    spreadWrapper.className = "pdf-spread-wrapper" + (isDual ? "" : " single-page-spread");
    spreadWrapper.id = "pdfActiveSpreadWrapper";

    // Si page 1 (couverture d'un LN), BookWalker l'affiche toujours en page simple isolée
    if (!isDual || pageNum === 1 || pageNum >= totalPages) {
      const cv = await getRenderedPageCanvas(pageNum, container, false);
      if (cv) {
        const side = document.createElement("div");
        side.className = "pdf-spread-side single-page";
        side.appendChild(cv);
        spreadWrapper.appendChild(side);
      }
    } else {
      // Affichage double page : Gauche (pageNum) et Droite (pageNum + 1)
      // Dans les livres japonais traduits, la lecture est reliée au centre
      const leftPageNum = pageNum;
      const rightPageNum = pageNum + 1;

      const [cvLeft, cvRight] = await Promise.all([
        getRenderedPageCanvas(leftPageNum, container, true),
        (rightPageNum <= totalPages) ? getRenderedPageCanvas(rightPageNum, container, true) : null
      ]);

      if (cvLeft) {
        const sideLeft = document.createElement("div");
        sideLeft.className = "pdf-spread-side spread-left";
        sideLeft.appendChild(cvLeft);
        spreadWrapper.appendChild(sideLeft);
      }
      if (cvRight) {
        const sideRight = document.createElement("div");
        sideRight.className = "pdf-spread-side spread-right";
        sideRight.appendChild(cvRight);
        spreadWrapper.appendChild(sideRight);
      }
    }

    initSmartZoomOnSpread(spreadWrapper);
    const wrapperKey = "wrap_" + pageNum + "_" + (isDual ? "dual" : "single") + "_" + pdfFitMode + "_" + pdfZoom;
    pdfPageCache.set(wrapperKey, { wrapper: spreadWrapper, time: Date.now() });
    return spreadWrapper;
  }

  // Pre-render adjacent pages in the background
  function prefetchAdjacentPages(pageNum, container) {
    if (!pdfDoc) return;
    const nextP = pageNum + 1;
    const prevP = pageNum - 1;

    setTimeout(() => {
      if (nextP <= totalPages && !pdfPageCache.has(nextP)) {
        getRenderedPageWrapper(nextP, container).catch(() => {});
      }
      if (prevP >= 1 && !pdfPageCache.has(prevP)) {
        getRenderedPageWrapper(prevP, container).catch(() => {});
      }
    }, 60);
  }

  
  window.togglePdfRawMode = function () {
    if (!currentBookRef) return;
    if (currentFormat === "pdf") {
      currentBookRef._forceRawPdf = false;
      window.openBookReader(currentBookRef);
    } else {
      currentBookRef._forceRawPdf = true;
      window.openPdfReader(currentBookRef);
    }
  };

  window.openPdfReader = async function (book) {
    if (book && !book._forceRawPdf && typeof window.openBookReader === 'function') {
      return window.openBookReader(book);
    }
    currentBookRef = book;
    currentPage = book.pdfPage || 1;
    totalPages = 0;
    pdfDoc = null;

    const overlay = document.getElementById("readerOverlay");
    const viewer = document.getElementById("readerViewer");
    const title = document.getElementById("readerTitle");
    const sidebar = document.getElementById("readerSidebar");
    const pageContainer = document.getElementById("readerPage");

    if (!overlay || !viewer) return;

    closeInternalReaders();

    overlay.style.display = "flex";
    if (sidebar) sidebar.classList.add("hidden");
    if (title) title.textContent = book.title || "PDF";
    if (pageContainer) pageContainer.classList.add("pdf-reading-mode");

    const bookTitleEscaped = (book.title || "Document PDF").replace(/</g, "&lt;");
    viewer.innerHTML = `
      <div id="pdfLoader" class="pdf-reader-loading-overlay">
        <div class="pdf-loader-card">
          <div class="pdf-loader-icon-wrap">
            <i class="fa-solid fa-book-open-reader fa-beat-fade"></i>
          </div>
          <h3 class="pdf-loader-title">${bookTitleEscaped}</h3>
          <div class="pdf-progress-track">
            <div id="pdfLoaderBar" class="pdf-progress-bar" style="width: 5%;"></div>
          </div>
          <p id="pdfLoaderStatus" class="pdf-loader-status">Connexion au fichier...</p>
        </div>
      </div>
    `;

    const url = buildBookFileUrl(book);
    if (!url) {
      viewer.innerHTML = '<div style="color:#ef4444;text-align:center;padding:40px;">URL du PDF introuvable.</div>';
      return;
    }

    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

      const bar = document.getElementById("pdfLoaderBar");
      const status = document.getElementById("pdfLoaderStatus");
      if (status) status.textContent = "Téléchargement du livre...";

      // Fetch binary data directly via fetch with chunked progress tracking (bypasses IDM extension & ngrok warnings)
      const resp = await fetch(url, {
        headers: {
          'ngrok-skip-browser-warning': 'true',
          'Accept': 'application/octet-stream, */*'
        }
      });

      if (!resp.ok) {
        throw new Error(`Erreur réseau (HTTP ${resp.status})`);
      }

      const contentLength = +(resp.headers.get('Content-Length') || 0);
      let dataBuffer;

      if (resp.body && contentLength > 0) {
        const reader = resp.body.getReader();
        let receivedLength = 0;
        const chunks = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          receivedLength += value.length;
          const pct = Math.min(100, Math.round((receivedLength / contentLength) * 100));
          const mbLoaded = (receivedLength / (1024 * 1024)).toFixed(1);
          const mbTotal = (contentLength / (1024 * 1024)).toFixed(1);
          if (bar) bar.style.width = Math.max(5, pct) + "%";
          if (status) status.textContent = `Téléchargement : ${pct}% (${mbLoaded} Mo / ${mbTotal} Mo)`;
        }

        const allChunks = new Uint8Array(receivedLength);
        let position = 0;
        for (const chunk of chunks) {
          allChunks.set(chunk, position);
          position += chunk.length;
        }
        dataBuffer = allChunks.buffer;
      } else {
        dataBuffer = await resp.arrayBuffer();
      }

      if (status) status.textContent = "Préparation des pages...";

      // Pass ArrayBuffer directly to PDF.js in-memory parser (0 network calls, 100% reliable)
      const loadingTask = pdfjsLib.getDocument({
        data: dataBuffer
      });

      pdfDoc = await loadingTask.promise;
      totalPages = pdfDoc.numPages;

      if (currentPage > totalPages) currentPage = 1;

      // Reset cache for new document
      pdfPageCache.clear();

      viewer.innerHTML = "";
      syncModeBtn();
      updateReaderFormatControls("pdf");

      if (currentReadMode === "webtoon") {
        await renderPdfWebtoon(viewer);
      } else {
        await renderPdfPage(currentPage, viewer);
      }

      // Découverte en arrière-plan des illustrations du LN
      discoverPdfIllustrations().catch(() => {});

      updatePdfProgress();
      setupPdfScrollTracking(viewer);

    } catch (err) {
      console.error("[PDF Reader] Load error:", err);
      viewer.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--text-secondary);gap:12px;padding:40px;text-align:center;">
        <i class="fa-solid fa-circle-exclamation fa-3x" style="color:#ef4444;"></i>
        <p style="font-size:16px;color:#fff;">Impossible de charger ce PDF en ligne.</p>
        <p style="font-size:13px;color:#94a3b8;max-width:400px;">${(err.message || '').replace(/</g, '&lt;')}</p>
        <a href="${url}" download class="btn-hero-primary" style="text-decoration:none;margin-top:8px;">
          <i class="fa-solid fa-download"></i> Télécharger le PDF
        </a>
      </div>`;
    }
  };

  

  // ==========================================================================
  //  BOOKWALKER SMART ZOOM & PAN CONTROLLER (Double-Click / Double-Tap)
  // ==========================================================================
  function resetPdfSmartZoom() {
    const wrapper = document.getElementById("pdfActiveSpreadWrapper");
    if (wrapper) {
      wrapper.style.transform = "none";
      wrapper.classList.remove("pdf-smart-zoomed");
    }
    pdfSmartZoomed = false;
    pdfSmartZoomScale = 1.0;
    pdfSmartPanX = 0;
    pdfSmartPanY = 0;
  }

  function initSmartZoomOnSpread(wrapper) {
    if (!wrapper) return;
    let lastTapTime = 0;
    let isDragging = false;
    let dragStartX = 0, dragStartY = 0;

    wrapper.addEventListener("dblclick", function(e) {
      if (e.target.closest("button, a, input")) return;
      toggleSmartZoom(e.clientX, e.clientY);
    });

    wrapper.addEventListener("touchend", function(e) {
      const now = Date.now();
      if (now - lastTapTime < 320 && e.changedTouches && e.changedTouches.length === 1) {
        e.preventDefault();
        toggleSmartZoom(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
      }
      lastTapTime = now;
    });

    wrapper.addEventListener("mousedown", function(e) {
      if (!pdfSmartZoomed) return;
      isDragging = true;
      dragStartX = e.clientX - pdfSmartPanX;
      dragStartY = e.clientY - pdfSmartPanY;
      wrapper.style.cursor = "grabbing";
    });

    window.addEventListener("mousemove", function(e) {
      if (!isDragging || !pdfSmartZoomed) return;
      pdfSmartPanX = e.clientX - dragStartX;
      pdfSmartPanY = e.clientY - dragStartY;
      applySmartZoomTransform(wrapper);
    });

    window.addEventListener("mouseup", function() {
      if (isDragging) {
        isDragging = false;
        if (wrapper && pdfSmartZoomed) wrapper.style.cursor = "grab";
      }
    });

    let touchPanStartX = 0, touchPanStartY = 0;
    wrapper.addEventListener("touchstart", function(e) {
      if (pdfSmartZoomed && e.touches.length === 1) {
        touchPanStartX = e.touches[0].clientX - pdfSmartPanX;
        touchPanStartY = e.touches[0].clientY - pdfSmartPanY;
      }
    }, { passive: true });

    wrapper.addEventListener("touchmove", function(e) {
      if (pdfSmartZoomed && e.touches.length === 1) {
        pdfSmartPanX = e.touches[0].clientX - touchPanStartX;
        pdfSmartPanY = e.touches[0].clientY - touchPanStartY;
        applySmartZoomTransform(wrapper);
      }
    }, { passive: true });
  }

  function toggleSmartZoom(clientX, clientY) {
    const wrapper = document.getElementById("pdfActiveSpreadWrapper");
    if (!wrapper) return;

    if (pdfSmartZoomed) {
      resetPdfSmartZoom();
    } else {
      pdfSmartZoomed = true;
      pdfSmartZoomScale = 2.2;
      const rect = wrapper.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      pdfSmartPanX = (centerX - clientX) * 1.2;
      pdfSmartPanY = (centerY - clientY) * 1.2;
      wrapper.classList.add("pdf-smart-zoomed");
      applySmartZoomTransform(wrapper);
    }
  }

  function applySmartZoomTransform(wrapper) {
    if (!wrapper) return;
    wrapper.style.transform = `translate(${pdfSmartPanX}px, ${pdfSmartPanY}px) scale(${pdfSmartZoomScale})`;
  }

  // ==========================================================================
  //  PDF TEXT REFLOW ENGINE (MODE ROMAN FLUIDE TYPE EPUB)
  // ==========================================================================
  function extractPdfParagraphs(textContent) {
    if (!textContent || !textContent.items || textContent.items.length === 0) {
      return [];
    }
    
    // Trier les blocs de texte : d'abord verticalement (haut en bas), puis horizontalement
    const items = textContent.items.slice().sort((a, b) => {
      const yA = a.transform ? a.transform[5] : 0;
      const yB = b.transform ? b.transform[5] : 0;
      if (Math.abs(yA - yB) > 5) {
        return yB - yA;
      }
      const xA = a.transform ? a.transform[4] : 0;
      const xB = b.transform ? b.transform[4] : 0;
      return xA - xB;
    });

    const lines = [];
    let currentLine = "";
    let lastY = null;
    let lastHeight = 12;

    for (const item of items) {
      const str = item.str;
      if (!str) continue;
      const y = item.transform ? item.transform[5] : 0;
      const height = item.transform ? Math.abs(item.transform[3]) : 12;

      if (lastY === null) {
        currentLine = str;
        lastY = y;
        lastHeight = height || 12;
      } else if (Math.abs(y - lastY) > (lastHeight * 0.65)) {
        // Changement de ligne
        if (currentLine.trim()) {
          lines.push({ text: currentLine.trim(), yGap: Math.abs(y - lastY), height: lastHeight });
        }
        currentLine = str;
        lastY = y;
        lastHeight = height || 12;
      } else {
        // Même ligne
        if (!currentLine.endsWith(" ") && !str.startsWith(" ") && !str.match(/^[,\.\?!:;\)\]}]/)) {
          currentLine += " ";
        }
        currentLine += str;
      }
    }
    if (currentLine.trim()) {
      lines.push({ text: currentLine.trim(), yGap: 0, height: lastHeight });
    }

    // Regrouper les lignes en paragraphes de lecture confortables
    const paragraphs = [];
    let currentPara = [];

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      // Si grand saut vertical ou ligne précédente se terminant par un point final / guillemet
      const endsSentence = currentPara.length > 0 && currentPara[currentPara.length - 1].match(/[\.?!»"”]$/);
      if (currentPara.length > 0 && (l.yGap > l.height * 1.4 || (endsSentence && l.yGap > l.height * 1.1))) {
        paragraphs.push(currentPara.join(" "));
        currentPara = [l.text];
      } else {
        currentPara.push(l.text);
      }
    }
    if (currentPara.length > 0) {
      paragraphs.push(currentPara.join(" "));
    }

    return paragraphs;
  }

  async function renderPdfReflow(pageNum, container) {
    if (!pdfDoc) return;
    try {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const paragraphs = extractPdfParagraphs(textContent);

      const reflowWrapper = document.createElement("div");
      reflowWrapper.className = "pdf-reflow-container";
      reflowWrapper.style.paddingLeft = currentMargin || "5%";
      reflowWrapper.style.paddingRight = currentMargin || "5%";

      const contentDiv = document.createElement("div");
      contentDiv.className = "pdf-reflow-content";
      contentDiv.style.fontSize = (currentFontSize || 100) + "%";

      if (paragraphs.length > 0 && paragraphs.join(" ").length > 30) {
        paragraphs.forEach(pText => {
          const p = document.createElement("p");
          p.className = "pdf-reflow-paragraph";
          p.textContent = pText;
          contentDiv.appendChild(p);
        });
        reflowWrapper.appendChild(contentDiv);
      } else {
        // Page d'illustration ou couverture
        const card = document.createElement("div");
        card.className = "pdf-reflow-illustration-card";
        card.innerHTML = '<span class="pdf-reflow-badge"><i class="fa-solid fa-image"></i> Illustration / Page Graphique</span>';
        const pageWrapper = await getRenderedPageWrapper(pageNum, container);
        if (pageWrapper) card.appendChild(pageWrapper.cloneNode(true));
        reflowWrapper.appendChild(card);
      }

      container.replaceChildren(reflowWrapper);
      prefetchAdjacentPages(pageNum, container);
    } catch (err) {
      console.warn("[PDF Reflow] Erreur mode roman, retour page:", err);
      pdfReflowMode = false;
      syncPdfModeUi();
      renderPdfPage(pageNum, container);
    }
  }

  function syncPdfModeUi() {
    const btnQuick = document.getElementById("btnQuickPdfReflow");
    if (btnQuick) {
      if (pdfReflowMode) {
        btnQuick.classList.add("active-reflow");
        btnQuick.innerHTML = '<i class="fa-solid fa-file"></i> <span class="pdf-mode-label">Mode Page</span>';
        btnQuick.title = "Revenir au Mode Page Original";
      } else {
        btnQuick.classList.remove("active-reflow");
        btnQuick.innerHTML = '<i class="fa-solid fa-book-open"></i> <span class="pdf-mode-label">Mode Roman</span>';
        btnQuick.title = "Basculer en Mode Roman (Texte Fluide ePub)";
      }
    }

    const btnPage = document.getElementById("btnPdfModePage");
    const btnReflow = document.getElementById("btnPdfModeReflow");
    if (btnPage && btnReflow) {
      if (pdfReflowMode) {
        btnPage.classList.remove("active");
        btnReflow.classList.add("active");
      } else {
        btnPage.classList.add("active");
        btnReflow.classList.remove("active");
      }
    }

    const btnFitW = document.getElementById("btnPdfFitWidth");
    const btnFitP = document.getElementById("btnPdfFitPage");
    if (btnFitW && btnFitP) {
      if (pdfFitMode === "width") {
        btnFitW.classList.add("active");
        btnFitP.classList.remove("active");
      } else {
        btnFitW.classList.remove("active");
        btnFitP.classList.add("active");
      }
    }
  }

  async function renderPdfPage(pageNum, container) {
    if (!pdfDoc) return;

    if (pdfReflowMode) {
      await renderPdfReflow(pageNum, container);
      return;
    }

    if (pdfRendering) { pdfPagePending = pageNum; return; }
    pdfRendering = true;

    try {
      // 1. Instant swap if cached (0ms transition)
      const isDual = shouldRenderDualSpread();
      const wrapperKey = "wrap_" + pageNum + "_" + (isDual ? "dual" : "single") + "_" + pdfFitMode + "_" + pdfZoom;
      if (pdfPageCache.has(wrapperKey)) {
        const cachedWrapper = pdfPageCache.get(wrapperKey).wrapper;
        container.replaceChildren(cachedWrapper);
        pdfRendering = false;
        prefetchAdjacentPages(pageNum, container);
        return;
      }

      // 2. Off-screen render: keep current page visible without blank white flashing
      let topBar = document.getElementById("pdfPageTopLoader");
      if (!topBar) {
        topBar = document.createElement("div");
        topBar.id = "pdfPageTopLoader";
        topBar.className = "pdf-page-top-loader";
        topBar.innerHTML = '<div class="pdf-top-loader-line"></div>';
        container.appendChild(topBar);
      }
      topBar.style.display = "block";

      const newWrapper = await getRenderedPageWrapper(pageNum, container);
      if (newWrapper) {
        container.replaceChildren(newWrapper);
      }

      if (topBar) topBar.remove();
      prefetchAdjacentPages(pageNum, container);

    } catch (err) {
      console.error("[PDF] Render page error:", err);
    } finally {
      pdfRendering = false;
      if (pdfPagePending !== null) {
        const p = pdfPagePending;
        pdfPagePending = null;
        renderPdfPage(p, container);
      }
    }
  }

  async function renderPdfWebtoon(container) {
    container.innerHTML = "";
    container.classList.add("pdf-webtoon-container");

    for (let i = 1; i <= totalPages; i++) {
      const wrapper = document.createElement("div");
      wrapper.className = "pdf-page-wrapper webtoon-page";
      wrapper.dataset.pageNum = i;

      const skeleton = document.createElement("div");
      skeleton.className = "pdf-page-skeleton";
      skeleton.style.height = "1000px";
      wrapper.appendChild(skeleton);
      container.appendChild(wrapper);
    }

    const mainEl = document.getElementById("readerMainContainer");
    const scrollRoot = mainEl || container;

    const observer = new IntersectionObserver(async function(entries) {
      for (let j = 0; j < entries.length; j++) {
        const entry = entries[j];
        if (!entry.isIntersecting) continue;
        const w = entry.target;
        if (w.dataset.rendered === "true") continue;
        w.dataset.rendered = "true";
        observer.unobserve(w);

        const pageNum = parseInt(w.dataset.pageNum, 10);
        try {
          const page = await pdfDoc.getPage(pageNum);
          const cw = container.clientWidth || window.innerWidth;
          const bv = page.getViewport({ scale: 1 });
          const sc = (cw / bv.width) * pdfZoom;
          
          const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
          const vp = page.getViewport({ scale: sc * dpr });

          const cv = document.createElement("canvas");
          cv.width  = Math.round(vp.width);
          cv.height = Math.round(vp.height);
          cv.style.width = Math.round(vp.width / dpr) + "px";
          cv.style.height = Math.round(vp.height / dpr) + "px";
          cv.className = "pdf-page-canvas";

          const ctx2 = cv.getContext("2d");
          ctx2.imageSmoothingEnabled = true;
          ctx2.imageSmoothingQuality = "high";
          ctx2.fillStyle = "#ffffff";
          ctx2.fillRect(0, 0, cv.width, cv.height);
          await page.render({ canvasContext: ctx2, viewport: vp }).promise;

          w.innerHTML = "";
          w.appendChild(cv);
        } catch (e) {
          console.warn("[PDF Webtoon] Page", pageNum, e);
        }
      }
    }, { rootMargin: "400px 0px", threshold: 0 });

    container.querySelectorAll(".webtoon-page").forEach(w => observer.observe(w));
  }

  window.pdfReaderNext = function () {
    if (!pdfDoc) return;
    const isDual = shouldRenderDualSpread() && !pdfReflowMode && currentReadMode !== "webtoon";
    let step = 1;
    if (isDual) {
      // Si couverture (page 1), on avance à la page 2
      // Ensuite, on avance de 2 en 2
      step = (currentPage === 1) ? 1 : 2;
    }

    if (currentPage < totalPages) {
      currentPage = Math.min(totalPages, currentPage + step);
      resetPdfSmartZoom();
      const viewer = document.getElementById("readerViewer");
      if (currentReadMode === "webtoon") {
        const targetPage = viewer ? viewer.querySelector(`[data-page-num="${currentPage}"]`) : null;
        if (targetPage) targetPage.scrollIntoView({ behavior: 'smooth' });
      } else {
        triggerPageFlipAnim(viewer, "next");
        renderPdfPage(currentPage, viewer);
      }
      updatePdfProgress();
      savePdfProgress();
    }
  };

  window.pdfReaderPrev = function () {
    if (!pdfDoc) return;
    const isDual = shouldRenderDualSpread() && !pdfReflowMode && currentReadMode !== "webtoon";
    let step = 1;
    if (isDual) {
      step = (currentPage <= 3) ? 1 : 2;
    }

    if (currentPage > 1) {
      currentPage = Math.max(1, currentPage - step);
      resetPdfSmartZoom();
      const viewer = document.getElementById("readerViewer");
      if (currentReadMode === "webtoon") {
        const targetPage = viewer ? viewer.querySelector(`[data-page-num="${currentPage}"]`) : null;
        if (targetPage) targetPage.scrollIntoView({ behavior: 'smooth' });
      } else {
        triggerPageFlipAnim(viewer, "prev");
        renderPdfPage(currentPage, viewer);
      }
      updatePdfProgress();
      savePdfProgress();
    }
  };

  function triggerPageFlipAnim(container, direction) {
    if (!container) return;
    const animClass = direction === "next" ? "pdf-page-flipping-next" : "pdf-page-flipping-prev";
    container.classList.remove("pdf-page-flipping-next", "pdf-page-flipping-prev");
    void container.offsetWidth; // Reflow trigger
    container.classList.add(animClass);
    setTimeout(() => container.classList.remove(animClass), 240);
  }

  function updatePdfProgress() {
    const isDual = shouldRenderDualSpread() && !pdfReflowMode && currentReadMode !== "webtoon";
    if (isDual && currentPage > 1 && (currentPage + 1) <= totalPages) {
      updateProgressText(currentPage + "-" + (currentPage + 1) + " / " + totalPages);
    } else {
      updateProgressText(currentPage + " / " + totalPages);
    }
  }

  function savePdfProgress() {
    if (!currentBookRef || !totalPages) return;
    const pct = Math.round((currentPage / totalPages) * 100);
    currentBookRef.pdfPage = currentPage;
    currentBookRef.progress = pct;
    currentBookRef.lastReadDate = Date.now();
    if (window.libraryDB && typeof window.libraryDB.saveBook === "function") {
      window.libraryDB.saveBook(currentBookRef);
    }
  }

  function setupPdfScrollTracking(container) {
    const mainEl = document.getElementById("readerMainContainer");
    const scrollTarget = mainEl || container;
    scrollTarget.addEventListener("scroll", function() {
      if (currentReadMode !== "webtoon" || !pdfDoc) return;
      const wrappers = container.querySelectorAll(".webtoon-page");
      const rootRect = scrollTarget.getBoundingClientRect();
      for (let k = wrappers.length - 1; k >= 0; k--) {
        const r = wrappers[k].getBoundingClientRect();
        if (r.top <= rootRect.top + 200) {
          currentPage = parseInt(wrappers[k].dataset.pageNum, 10);
          updatePdfProgress();
          savePdfProgress();
          break;
        }
      }
    }, { passive: true });
  }


  // ==========================================================================
  //  LIGHT NOVEL ILLUSTRATIONS DISCOVERY & DRAWER GALLERY
  // ==========================================================================
  async function discoverPdfIllustrations() {
    if (!pdfDoc) return;
    pdfIllustrationsList = [];
    const maxScanPages = Math.min(totalPages, 60);

    // Les LN ont systématiquement leurs frontispices couleurs dans les 1 à 6 premières pages
    for (let p = 1; p <= maxScanPages; p++) {
      try {
        const page = await pdfDoc.getPage(p);
        const text = await page.getTextContent();
        const totalChars = (text.items || []).reduce((acc, it) => acc + (it.str || "").length, 0);

        // Page avec moins de 80 caractères = illustration, carte ou couverture !
        if (totalChars < 80) {
          pdfIllustrationsList.push({
            pageNum: p,
            title: p === 1 ? "Couverture" : ("Illustration " + pdfIllustrationsList.length)
          });
        }
      } catch(e) {}
    }
    renderIllustrationsDrawer();
  }

  async function renderIllustrationsDrawer() {
    const body = document.getElementById("pdfGalleryBody");
    if (!body) return;
    if (pdfIllustrationsList.length === 0) {
      body.innerHTML = `<div style="grid-column:1/-1;padding:24px;text-align:center;color:#94a3b8;font-size:13px;">
        <i class="fa-solid fa-circle-info" style="margin-right:6px;"></i> Aucune illustration pleine page détectée.
      </div>`;
      return;
    }

    body.innerHTML = "";
    for (const item of pdfIllustrationsList) {
      const card = document.createElement("div");
      card.className = "pdf-gallery-card";
      card.title = `Sauter à la page ${item.pageNum}`;

      const badge = document.createElement("span");
      badge.className = "pdf-gallery-badge";
      badge.textContent = `P. ${item.pageNum}`;

      const skeleton = document.createElement("div");
      skeleton.style.cssText = "width:100%;height:100%;background:rgba(255,255,255,0.06);";
      card.appendChild(skeleton);
      card.appendChild(badge);
      body.appendChild(card);

      // Rendu miniature en tâche de fond
      (async function(pNum, cEl, skEl) {
        try {
          const page = await pdfDoc.getPage(pNum);
          const vp = page.getViewport({ scale: 0.28 });
          const thumbCanvas = document.createElement("canvas");
          thumbCanvas.width = Math.round(vp.width);
          thumbCanvas.height = Math.round(vp.height);
          const ctx = thumbCanvas.getContext("2d", { alpha: false });
          await page.render({ canvasContext: ctx, viewport: vp }).promise;

          const img = document.createElement("img");
          img.src = thumbCanvas.toDataURL("image/jpeg", 0.85);
          img.alt = item.title;
          skEl.replaceWith(img);

          cEl.onclick = function() {
            currentPage = pNum;
            const viewer = document.getElementById("readerViewer");
            if (viewer) renderPdfPage(currentPage, viewer);
            updatePdfProgress();
            savePdfProgress();
            window.closePdfGallery();
          };
        } catch(e) {}
      })(item.pageNum, card, skeleton);
    }
  }

  window.openPdfGallery = function() {
    const drawer = document.getElementById("pdfGalleryDrawer");
    const backdrop = document.getElementById("pdfGalleryBackdrop");
    if (drawer) drawer.classList.add("open");
    if (backdrop) backdrop.classList.add("open");
  };

  window.closePdfGallery = function() {
    const drawer = document.getElementById("pdfGalleryDrawer");
    const backdrop = document.getElementById("pdfGalleryBackdrop");
    if (drawer) drawer.classList.remove("open");
    if (backdrop) backdrop.classList.remove("open");
  };

  // ==========================================================================
  //  3. SHARED TOOLBAR & CONTROLS
  // ==========================================================================
  function updateProgressText(text) {
    const el = document.getElementById("readerProgressText");
    if (el) el.textContent = text;
  }

  function closeInternalReaders() {
    updateReaderFormatControls("closed");
    _isStreamChapterLoading = false;
    _lastReaderNavTimestamp = 0;
    window._isStreamVolume = false;
    window._streamVolumeManifest = null;
    window._streamFileKey = null;
    if (pdfDoc) {
      try { pdfDoc.destroy(); } catch(e) {}
      pdfDoc = null;
    }
    if (window._currentEpubBook) {
      try { window._currentEpubBook.destroy(); } catch(e) {}
      window._currentEpubBook = null;
      window._currentEpubRendition = null;
    }
  }

  window.closePdfReader = function () {
    if (window.ReaderAudio && typeof window.ReaderAudio.stop === 'function') {
      window.ReaderAudio.stop();
    }
    closeInternalReaders();
    const overlay = document.getElementById("readerOverlay");
    const viewer = document.getElementById("readerViewer");
    const pageContainer = document.getElementById("readerPage");
    if (overlay) overlay.style.display = "none";
    if (viewer) viewer.innerHTML = "";
    if (pageContainer) pageContainer.classList.remove("pdf-reading-mode");
    currentBookRef = null;
    totalPages = 0;

    if (typeof updateLibraryStats === "function") updateLibraryStats();
    if (typeof updateContinueReadingHero === "function") updateContinueReadingHero();
  };

  
  function updateReaderFormatControls(format) {
    currentFormat = format;
    const isPdf = (format === "pdf");

    // Bouton de bascule Mode Roman Fluide <-> Mode PDF Original
    const popModeSwitch = document.getElementById("popoverPdfModeSwitchRow");
    const textModeSwitch = document.getElementById("textTogglePdfMode");
    const iconModeSwitch = document.getElementById("iconTogglePdfMode");
    if (popModeSwitch) {
      if (currentBookRef && currentBookRef._hasPdfOriginal) {
        popModeSwitch.style.display = "flex";
        if (textModeSwitch) {
          textModeSwitch.textContent = isPdf ? "Mode Roman (Fluide)" : "Mode PDF Original";
        }
        if (iconModeSwitch) {
          iconModeSwitch.className = isPdf ? "fa-solid fa-book-open" : "fa-solid fa-file-pdf";
        }
      } else {
        popModeSwitch.style.display = "none";
      }
    }

    // Lignes d'options PDF dans la modale d'apparence (Aa) (PDF UNIQUEMENT)
    const popGallery = document.getElementById("popoverPdfIllustrationsRow");
    if (popGallery) {
      popGallery.style.display = isPdf ? "flex" : "none";
    }

    const popPdfFit = document.getElementById("popoverPdfFitRow");
    if (popPdfFit) {
      popPdfFit.style.display = isPdf ? "flex" : "none";
    }

    const popPdfSpread = document.getElementById("popoverPdfSpreadRow");
    if (popPdfSpread) {
      popPdfSpread.style.display = isPdf ? "flex" : "none";
    }

    // Ligne de taille de police dans la modale d'apparence (Aa)
    const fontRow = document.getElementById("popoverFontRow");
    if (fontRow) {
      fontRow.style.display = isPdf ? "flex" : "flex";
    }

    // Ligne de marges dans la modale d'apparence (Aa) : réservée à l'EPUB
    const marginRow = document.getElementById("popoverMarginRow");
    if (marginRow) {
      marginRow.style.display = isPdf ? "none" : "flex";
    }
  }

  function syncModeBtn() {
    const btn = document.getElementById("readerModeBtn");
    if (!btn) return;
    const iconEl = btn.querySelector("i");
    const labelEl = btn.querySelector(".mode-label");
    if (currentReadMode === "webtoon") {
      btn.dataset.mode = "webtoon";
      if (iconEl) iconEl.className = "fa-solid fa-scroll";
      if (labelEl) labelEl.textContent = "Webtoon";
    } else {
      btn.dataset.mode = "paginated";
      if (iconEl) iconEl.className = "fa-solid fa-file-lines";
      if (labelEl) labelEl.textContent = "Paginé";
    }
  }

  // Prev & Next Dispatcher
  function handleReaderPrev() {
    const now = Date.now();
    if (now - _lastReaderNavTimestamp < 260) return;
    _lastReaderNavTimestamp = now;

    if (window._isStreamVolume) {
      if (window._streamVolumeManifest && window._streamCurrentChapter > 1) {
        loadStreamChapter(window._streamCurrentChapter - 1);
      }
    } else if (pdfDoc) {
      window.pdfReaderPrev();
    } else if (window._currentEpubRendition) {
      window._currentEpubRendition.prev();
    }
  }

  function handleReaderNext() {
    const now = Date.now();
    if (now - _lastReaderNavTimestamp < 260) return;
    _lastReaderNavTimestamp = now;

    if (window._isStreamVolume) {
      if (window._streamVolumeManifest && window._streamCurrentChapter < window._streamVolumeManifest.totalChapters) {
        loadStreamChapter(window._streamCurrentChapter + 1);
      }
    } else if (pdfDoc) {
      window.pdfReaderNext();
    } else if (window._currentEpubRendition) {
      window._currentEpubRendition.next();
    }
  }

  window.handleReaderPrev = handleReaderPrev;
  window.handleReaderNext = handleReaderNext;

  // DOM Event Listeners
  
  // Download Current Active Volume
  window.downloadCurrentVolume = function () {
    if (!currentBookRef) {
      alert("Aucun volume actif à télécharger.");
      return;
    }

    // 1. Direct file URL if already built
    let fileUrl = buildBookFileUrl(currentBookRef);
    if (!fileUrl && currentBookRef.file_path) fileUrl = currentBookRef.file_path;
    if (!fileUrl && currentBookRef.filePath) fileUrl = currentBookRef.filePath;

    const ext = (currentFormat === 'pdf' || (currentBookRef.format === 'pdf')) ? '.pdf' : '.epub';
    const safeTitle = ((currentBookRef.title || 'Volume').replace(/[^a-zA-Z0-9_\u00C0-\u017F\s-]/g, '').trim()) || 'Volume';
    const downloadFilename = safeTitle.endsWith(ext) ? safeTitle : (safeTitle + ext);

    if (fileUrl) {
      const sep = fileUrl.includes('?') ? '&' : '?';
      const dlUrl = fileUrl.includes('download=') ? fileUrl : (fileUrl + sep + 'download=1');
      const a = document.createElement('a');
      a.href = dlUrl;
      a.download = downloadFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    // 2. Fallback via fileKey or ID
    const fileKey = (currentBookRef && currentBookRef.fileKey) || (window._streamVolumeManifest && window._streamVolumeManifest.fileKey) || (currentBookRef && currentBookRef.id);
    if (fileKey) {
      const dlUrl = '/api/volume-stream/' + encodeURIComponent(fileKey) + '?download=1';
      const a = document.createElement('a');
      a.href = dlUrl;
      a.download = downloadFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    alert("Le lien de téléchargement direct n'a pas pu être résolu pour ce volume.");
  };

  document.addEventListener("DOMContentLoaded", function () {
    const readerOverlayEl = document.getElementById("readerOverlay");
    if (readerOverlayEl) {
      window.initReaderTapZones(readerOverlayEl);
      window.attachReaderScrollObserver(document.getElementById("readerMainContainer"));
    }
    const closeBtn = document.getElementById("closeReaderBtn");
    const downloadBtn = document.getElementById("readerDownloadBtn");
    if (downloadBtn) {
      downloadBtn.addEventListener("click", function() {
        if (typeof window.openDownloadSponsorModal === "function") {
          window.openDownloadSponsorModal();
        } else if (typeof window.downloadCurrentVolume === "function") {
          window.downloadCurrentVolume();
        }
      });
    }
    const prevBtn = document.getElementById("readerPrevBtn");
    const nextBtn = document.getElementById("readerNextBtn");
    const toggleSidebarBtn = document.getElementById("toggleSidebarBtn");
    const sidebar = document.getElementById("readerSidebar");
    const modeBtn = document.getElementById("readerModeBtn");
    const settingsToggle = document.getElementById("readerSettingsToggle");
    const settingsMenu = document.getElementById("readerSettingsMenu");
    const fullscreenBtn = document.getElementById("readerFullscreenBtn");
    const btnTextMinus = document.getElementById("btnTextMinus");
    const btnTextPlus = document.getElementById("btnTextPlus");

    if (closeBtn) {
      closeBtn.addEventListener("click", window.closePdfReader);
    }

    if (prevBtn) {
      prevBtn.addEventListener("click", handleReaderPrev);
    }

    if (nextBtn) {
      nextBtn.addEventListener("click", handleReaderNext);
    }

    if (toggleSidebarBtn && sidebar) {
      toggleSidebarBtn.addEventListener("click", function () {
        sidebar.classList.toggle("hidden");
      });
    }

    if (settingsToggle && settingsMenu) {
      settingsToggle.addEventListener("click", function (e) {
        e.stopPropagation();
        settingsMenu.classList.toggle("hidden");
      });
      document.addEventListener("click", function (e) {
        if (!settingsToggle.contains(e.target) && !settingsMenu.contains(e.target)) {
          settingsMenu.classList.add("hidden");
        }
      });
    }

    // Font size controls
    if (btnTextMinus) {
      btnTextMinus.addEventListener("click", function () {
        if (currentFontSize > 70) {
          currentFontSize -= 10;
          const textPercent = document.getElementById("textPercent");
          if (textPercent) textPercent.textContent = currentFontSize + "%";
          if (currentFormat === "pdf") {
            if (pdfReflowMode) {
              const reflowContent = document.querySelector(".pdf-reflow-content");
              if (reflowContent) reflowContent.style.fontSize = currentFontSize + "%";
            } else {
              pdfZoom = Math.max(0.6, pdfZoom - 0.1);
              pdfPageCache.clear();
              const v = document.getElementById("readerViewer");
              if (currentReadMode === "webtoon") renderPdfWebtoon(v);
              else renderPdfPage(currentPage, v);
            }
          } else {
            applyEpubThemeAndSettings();
          }
        }
      });
    }

    if (btnTextPlus) {
      btnTextPlus.addEventListener("click", function () {
        if (currentFontSize < 180) {
          currentFontSize += 10;
          const textPercent = document.getElementById("textPercent");
          if (textPercent) textPercent.textContent = currentFontSize + "%";
          if (currentFormat === "pdf") {
            if (pdfReflowMode) {
              const reflowContent = document.querySelector(".pdf-reflow-content");
              if (reflowContent) reflowContent.style.fontSize = currentFontSize + "%";
            } else {
              pdfZoom = Math.min(2.5, pdfZoom + 0.1);
              pdfPageCache.clear();
              const v = document.getElementById("readerViewer");
              if (currentReadMode === "webtoon") renderPdfWebtoon(v);
              else renderPdfPage(currentPage, v);
            }
          } else {
            applyEpubThemeAndSettings();
          }
        }
      });
    }

    // Margins buttons
    document.querySelectorAll(".margin-btn").forEach(btn => {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".margin-btn").forEach(b => b.classList.remove("active"));
        this.classList.add("active");
        currentMargin = this.dataset.margin || "5%";
        if (currentFormat === "epub") {
          applyEpubThemeAndSettings();
        }
      });
    });

    // Theme buttons (EPUB & PDF)
    document.querySelectorAll(".theme-btn").forEach(btn => {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".theme-btn").forEach(b => b.classList.remove("active"));
        this.classList.add("active");
        currentTheme = this.dataset.theme || "dark";
        applyEpubThemeAndSettings();
        applyPdfThemeAndSettings();
      });
    });

    // Mode Toggle (Paginated vs Webtoon)
    if (modeBtn) {
      modeBtn.addEventListener("click", function () {
        currentReadMode = (currentReadMode === "paginated" ? "webtoon" : "paginated");
        syncModeBtn();

        if (window._isStreamVolume) {
          loadStreamChapter(window._streamCurrentChapter);
        } else if (currentFormat === "epub" && currentBookRef) {
          openEpubReader(currentBookRef);
        } else if (currentFormat === "pdf" && pdfDoc) {
          const v = document.getElementById("readerViewer");
          v.className = (currentReadMode === "webtoon" ? "pdf-webtoon-container" : "epub-viewer-container");
          if (currentReadMode === "webtoon") renderPdfWebtoon(v);
          else renderPdfPage(currentPage, v);
        }
      });
    }

    // Fullscreen
    if (fullscreenBtn) {
      fullscreenBtn.addEventListener("click", function () {
        const overlay = document.getElementById("readerOverlay");
        if (!document.fullscreenElement) {
          if (overlay && overlay.requestFullscreen) overlay.requestFullscreen();
        } else {
          if (document.exitFullscreen) document.exitFullscreen();
        }
      });
    }

    // PDF Reflow Mode & Fit Controls
    const btnQuickPdf = document.getElementById("btnQuickPdfReflow");
    if (btnQuickPdf) {
      btnQuickPdf.addEventListener("click", function() {
        pdfReflowMode = !pdfReflowMode;
        syncPdfModeUi();
        const v = document.getElementById("readerViewer");
        if (pdfDoc && v) {
          if (currentReadMode === "webtoon") {
            currentReadMode = "paginated";
            syncModeBtn();
          }
          renderPdfPage(currentPage, v);
        }
      });
    }

    const btnPdfPage = document.getElementById("btnPdfModePage");
    if (btnPdfPage) {
      btnPdfPage.addEventListener("click", function() {
        pdfReflowMode = false;
        syncPdfModeUi();
        const v = document.getElementById("readerViewer");
        if (pdfDoc && v) renderPdfPage(currentPage, v);
      });
    }

    const btnPdfReflow = document.getElementById("btnPdfModeReflow");
    if (btnPdfReflow) {
      btnPdfReflow.addEventListener("click", function() {
        pdfReflowMode = true;
        syncPdfModeUi();
        const v = document.getElementById("readerViewer");
        if (pdfDoc && v) {
          if (currentReadMode === "webtoon") {
            currentReadMode = "paginated";
            syncModeBtn();
          }
          renderPdfPage(currentPage, v);
        }
      });
    }

    const btnFitW = document.getElementById("btnPdfFitWidth");
    if (btnFitW) {
      btnFitW.addEventListener("click", function() {
        pdfFitMode = "width";
        pdfPageCache.clear();
        syncPdfModeUi();
        const v = document.getElementById("readerViewer");
        if (pdfDoc && v) renderPdfPage(currentPage, v);
      });
    }

    const btnFitP = document.getElementById("btnPdfFitPage");
    if (btnFitP) {
      btnFitP.addEventListener("click", function() {
        pdfFitMode = "page";
        pdfPageCache.clear();
        syncPdfModeUi();
        const v = document.getElementById("readerViewer");
        if (pdfDoc && v) renderPdfPage(currentPage, v);
      });
    }

    // BookWalker Spread Mode controls (Auto / Single / Double)
    const btnSpreadAuto = document.getElementById("btnPdfSpreadAuto");
    const btnSpreadSingle = document.getElementById("btnPdfSpreadSingle");
    const btnSpreadDouble = document.getElementById("btnPdfSpreadDouble");

    function syncSpreadButtons() {
      [btnSpreadAuto, btnSpreadSingle, btnSpreadDouble].forEach(b => b && b.classList.remove("active"));
      if (pdfSpreadMode === "auto" && btnSpreadAuto) btnSpreadAuto.classList.add("active");
      if (pdfSpreadMode === "single" && btnSpreadSingle) btnSpreadSingle.classList.add("active");
      if (pdfSpreadMode === "double" && btnSpreadDouble) btnSpreadDouble.classList.add("active");
    }

    if (btnSpreadAuto) {
      btnSpreadAuto.addEventListener("click", function() {
        pdfSpreadMode = "auto";
        pdfPageCache.clear();
        syncSpreadButtons();
        const v = document.getElementById("readerViewer");
        if (pdfDoc && v) renderPdfPage(currentPage, v);
      });
    }

    if (btnSpreadSingle) {
      btnSpreadSingle.addEventListener("click", function() {
        pdfSpreadMode = "single";
        pdfPageCache.clear();
        syncSpreadButtons();
        const v = document.getElementById("readerViewer");
        if (pdfDoc && v) renderPdfPage(currentPage, v);
      });
    }

    if (btnSpreadDouble) {
      btnSpreadDouble.addEventListener("click", function() {
        pdfSpreadMode = "double";
        pdfPageCache.clear();
        syncSpreadButtons();
        const v = document.getElementById("readerViewer");
        if (pdfDoc && v) renderPdfPage(currentPage, v);
        updatePdfProgress();
      });
    }

    if (btnSpreadAuto) {
      const origHandler = btnSpreadAuto.onclick;
      btnSpreadAuto.addEventListener("click", function() {
        updatePdfProgress();
      });
    }

    if (btnSpreadSingle) {
      btnSpreadSingle.addEventListener("click", function() {
        updatePdfProgress();
      });
    }

    const btnMenuGallery = document.getElementById("btnMenuPdfGallery");
    if (btnMenuGallery) {
      btnMenuGallery.addEventListener("click", function() {
        const settingsMenu = document.getElementById("readerSettingsMenu");
        if (settingsMenu) settingsMenu.classList.add("hidden");
        window.openPdfGallery();
      });
    }

    // Galerie d'illustrations du Light Novel
    const btnGallery = document.getElementById("btnQuickPdfGallery");
    const galleryCloseBtn = document.getElementById("pdfGalleryCloseBtn");
    const galleryBackdrop = document.getElementById("pdfGalleryBackdrop");

    if (btnGallery) {
      btnGallery.addEventListener("click", window.openPdfGallery);
    }
    if (galleryCloseBtn) {
      galleryCloseBtn.addEventListener("click", window.closePdfGallery);
    }
    if (galleryBackdrop) {
      galleryBackdrop.addEventListener("click", window.closePdfGallery);
    }

    // Responsive resize listener pour adapter le double spread automatiquement
    window.addEventListener("resize", function() {
      if (currentFormat === "pdf" && pdfDoc && !pdfReflowMode && currentReadMode !== "webtoon") {
        clearTimeout(window._pdfResizeTimer);
        window._pdfResizeTimer = setTimeout(() => {
          pdfPageCache.clear();
          const v = document.getElementById("readerViewer");
          if (v) renderPdfPage(currentPage, v);
        }, 150);
      }
    });

    // Keyboard Shortcuts
    document.addEventListener("keydown", function (e) {
      const overlay = document.getElementById("readerOverlay");
      if (!overlay || overlay.style.display === "none") return;
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

      if (e.key === "ArrowLeft") {
        handleReaderPrev();
      } else if (e.key === "ArrowRight" || e.key === " ") {
        handleReaderNext();
      } else if (e.key === "Escape") {
        window.closePdfReader();
      } else if (e.key === "f" || e.key === "F") {
        if (!document.fullscreenElement) {
          if (overlay.requestFullscreen) overlay.requestFullscreen();
        } else {
          if (document.exitFullscreen) document.exitFullscreen();
        }
      }
    });

    // ========================================================================
    // MOBILE HORIZONTAL TOUCH GESTURES (SWIPE NAVIGATION)
    // ========================================================================
    let touchStartX = null;
    let touchStartY = null;
    let touchStartTime = 0;

    const mainReaderArea = document.getElementById("readerViewer") || overlay;

    if (mainReaderArea) {
      mainReaderArea.addEventListener("touchstart", function(e) {
        if (!e.touches || e.touches.length !== 1) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
      }, { passive: true });

      mainReaderArea.addEventListener("touchend", function(e) {
        if (touchStartX === null || !e.changedTouches || e.changedTouches.length === 0) return;
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const deltaX = touchEndX - touchStartX;
        const deltaY = touchEndY - touchStartY;
        const deltaTime = Date.now() - touchStartTime;

        touchStartX = null;
        touchStartY = null;

        // Validation intelligente du geste de glissement latéral :
        // 1. Durée < 600ms (flick franc, pas un appui prolongé)
        // 2. Déplacement horizontal >= 60px
        // 3. Dominance latérale (|deltaX| > |deltaY| * 1.5) pour préserver le défilement vertical du texte
        if (window._isStreamVolume) return; // In continuous vertical stream mode, avoid horizontal gestures
        if (deltaTime < 600 && Math.abs(deltaX) >= 60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
          if (deltaX < 0) {
            // Glissement de droite à gauche -> Chapitre Suivant
            if (navigator.vibrate) try { navigator.vibrate(12); } catch(ev) {}
            showSwipeToast("Chapitre Suivant →");
            handleReaderNext();
          } else {
            // Glissement de gauche à droite -> Chapitre Précédent
            if (navigator.vibrate) try { navigator.vibrate(12); } catch(ev) {}
            showSwipeToast("← Chapitre Précédent");
            handleReaderPrev();
          }
        }
      }, { passive: true });
    }

    function showSwipeToast(label) {
      const parentOverlay = document.getElementById("readerOverlay") || document.body;
      let toast = document.getElementById("readerSwipeToast");
      if (!toast) {
        toast = document.createElement("div");
        toast.id = "readerSwipeToast";
        toast.className = "reader-swipe-toast";
        parentOverlay.appendChild(toast);
      }
      toast.textContent = label;
      toast.classList.add("visible");
      clearTimeout(toast._timer);
      toast._timer = setTimeout(() => {
        toast.classList.remove("visible");
      }, 750);
    }


  // ==========================================================================
  //  ILLUSTRATION LIGHTBOX (FULLSCREEN MODAL ZOOM VIEWER)
  // ==========================================================================
  let currentZoom = 1;
  let isPanning = false;
  let startPanX = 0;
  let startPanY = 0;
  let currentTranslateX = 0;
  let currentTranslateY = 0;

  function initIllustrationLightbox() {
    let lb = document.getElementById('illustrationLightbox');
    if (lb) return lb;

    lb = document.createElement('div');
    lb.id = 'illustrationLightbox';
    lb.className = 'illustration-lightbox-overlay';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-label', "Visionneuse d'illustration");

    lb.innerHTML = `
      <div class="lightbox-toolbar">
        <div class="lightbox-info">
          <span class="lightbox-title"><i class="fa-solid fa-image" style="color:#fb7185;"></i> Illustration</span>
        </div>
        <div class="lightbox-actions">
          <button type="button" class="lightbox-btn" id="lbZoomOutBtn" title="Dézoomer (-)">
            <i class="fa-solid fa-magnifying-glass-minus"></i>
          </button>
          <button type="button" class="lightbox-btn" id="lbZoomResetBtn" title="Réinitialiser la taille (100%)">
            <span id="lbZoomLevelText">100%</span>
          </button>
          <button type="button" class="lightbox-btn" id="lbZoomInBtn" title="Zoomer (+)">
            <i class="fa-solid fa-magnifying-glass-plus"></i>
          </button>
          <a href="#" class="lightbox-btn" id="lbDownloadBtn" download="illustration.jpg" target="_blank" rel="noopener noreferrer" title="Ouvrir en qualité originale">
            <i class="fa-solid fa-arrow-up-right-from-square"></i>
          </a>
          <button type="button" class="lightbox-btn lightbox-close-btn" id="lbCloseBtn" title="Fermer (Échap)">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>

      <div class="lightbox-stage" id="lbStage">
        <div class="lightbox-img-wrapper" id="lbImgWrapper">
          <img id="lbImg" src="" alt="Illustration grand format" draggable="false">
        </div>
      </div>

      <div class="lightbox-hint">
        <span><i class="fa-solid fa-magnifying-glass"></i> Clic ou molette pour zoomer • Glisser pour déplacer • <kbd>Échap</kbd> ou clic à côté pour fermer</span>
      </div>
    `;

    document.body.appendChild(lb);

    const stage = document.getElementById('lbStage');
    const wrapper = document.getElementById('lbImgWrapper');
    const img = document.getElementById('lbImg');
    const closeBtn = document.getElementById('lbCloseBtn');
    const zoomInBtn = document.getElementById('lbZoomInBtn');
    const zoomOutBtn = document.getElementById('lbZoomOutBtn');
    const zoomResetBtn = document.getElementById('lbZoomResetBtn');
    const zoomText = document.getElementById('lbZoomLevelText');

    function updateTransform(withTransition = true) {
      if (!wrapper) return;
      if (withTransition) {
        wrapper.style.transition = 'transform 0.18s cubic-bezier(0.16, 1, 0.3, 1)';
      } else {
        wrapper.style.transition = 'none';
      }
      wrapper.style.transform = `translate(${currentTranslateX}px, ${currentTranslateY}px) scale(${currentZoom})`;
      if (zoomText) zoomText.textContent = Math.round(currentZoom * 100) + '%';
      if (img) {
        if (currentZoom > 1.05) {
          img.classList.add('is-zoomed');
          if (stage) stage.style.cursor = 'grab';
        } else {
          img.classList.remove('is-zoomed');
          if (stage) stage.style.cursor = 'default';
        }
      }
    }

    function setZoom(newZoom, withTransition = true) {
      currentZoom = Math.max(0.6, Math.min(4.0, newZoom));
      if (currentZoom <= 1.05) {
        currentTranslateX = 0;
        currentTranslateY = 0;
      }
      updateTransform(withTransition);
    }

    if (zoomInBtn) zoomInBtn.onclick = (e) => { e.stopPropagation(); setZoom(currentZoom + 0.35); };
    if (zoomOutBtn) zoomOutBtn.onclick = (e) => { e.stopPropagation(); setZoom(currentZoom - 0.35); };
    if (zoomResetBtn) zoomResetBtn.onclick = (e) => { e.stopPropagation(); setZoom(1.0); };
    if (closeBtn) closeBtn.onclick = (e) => { e.stopPropagation(); window.closeIllustrationLightbox(); };

    if (stage) {
      stage.onclick = (e) => {
        if (e.target === stage || e.target === wrapper) {
          window.closeIllustrationLightbox();
        }
      };

      stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.2 : -0.2;
        setZoom(currentZoom + delta);
      }, { passive: false });

      stage.addEventListener('mousedown', (e) => {
        if (currentZoom <= 1.05) return;
        isPanning = true;
        startPanX = e.clientX - currentTranslateX;
        startPanY = e.clientY - currentTranslateY;
        stage.style.cursor = 'grabbing';
      });

      let initialTouchDist = 0;
      let initialZoom = 1;
      stage.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1 && currentZoom > 1.05) {
          isPanning = true;
          startPanX = e.touches[0].clientX - currentTranslateX;
          startPanY = e.touches[0].clientY - currentTranslateY;
        } else if (e.touches.length === 2) {
          isPanning = false;
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          initialTouchDist = Math.hypot(dx, dy);
          initialZoom = currentZoom;
        }
      }, { passive: true });

      stage.addEventListener('touchmove', (e) => {
        if (isPanning && e.touches.length === 1) {
          currentTranslateX = e.touches[0].clientX - startPanX;
          currentTranslateY = e.touches[0].clientY - startPanY;
          updateTransform(false);
        } else if (e.touches.length === 2 && initialTouchDist > 0) {
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const dist = Math.hypot(dx, dy);
          const factor = dist / initialTouchDist;
          setZoom(initialZoom * factor, false);
        }
      }, { passive: true });

      stage.addEventListener('touchend', () => {
        isPanning = false;
        initialTouchDist = 0;
      }, { passive: true });
    }

    if (img) {
      img.onclick = (e) => {
        e.stopPropagation();
        if (currentZoom > 1.1) {
          setZoom(1.0);
        } else {
          setZoom(2.0);
        }
      };
    }

    window.addEventListener('mousemove', (e) => {
      if (!isPanning) return;
      currentTranslateX = e.clientX - startPanX;
      currentTranslateY = e.clientY - startPanY;
      updateTransform(false);
    });

    window.addEventListener('mouseup', () => {
      if (isPanning) {
        isPanning = false;
        if (stage) stage.style.cursor = currentZoom > 1.05 ? 'grab' : 'default';
      }
    });

    window.addEventListener('keydown', (e) => {
      const activeLb = document.getElementById('illustrationLightbox');
      if (!activeLb || !activeLb.classList.contains('active')) return;
      if (e.key === 'Escape') {
        window.closeIllustrationLightbox();
      } else if (e.key === '+' || e.key === '=') {
        setZoom(currentZoom + 0.3);
      } else if (e.key === '-' || e.key === '_') {
        setZoom(currentZoom - 0.3);
      } else if (e.key === '0') {
        setZoom(1.0);
      }
    });

    return lb;
  }

  window.openIllustrationLightbox = function(src, alt = '') {
    if (!src) return;
    const lb = initIllustrationLightbox();
    const img = document.getElementById('lbImg');
    const dlBtn = document.getElementById('lbDownloadBtn');

    currentZoom = 1;
    currentTranslateX = 0;
    currentTranslateY = 0;

    if (img) {
      img.src = src;
      img.alt = alt || "Illustration grand format";
    }
    if (dlBtn) {
      dlBtn.href = src;
    }

    lb.style.display = 'flex';
    requestAnimationFrame(() => {
      lb.classList.add('active');
    });

    const wrapper = document.getElementById('lbImgWrapper');
    if (wrapper) wrapper.style.transform = 'translate(0px, 0px) scale(1)';
    const zoomText = document.getElementById('lbZoomLevelText');
    if (zoomText) zoomText.textContent = '100%';
  };

  window.closeIllustrationLightbox = function() {
    const lb = document.getElementById('illustrationLightbox');
    if (!lb) return;
    lb.classList.remove('active');
    setTimeout(() => {
      if (!lb.classList.contains('active')) {
        lb.style.display = 'none';
        const img = document.getElementById('lbImg');
        if (img) img.src = '';
      }
    }, 220);
  };

  // Delegated click listener for direct DOM images in Stream Reader, Webnovel and PDF
  document.addEventListener('click', function(e) {
    const reader = e.target.closest('#readerOverlay, #webnovelReaderOverlay');
    if (!reader) return;

    // Must be an illustration image in the text/chapter content
    const img = e.target.closest('.stream-chapter-content img, .stream-chapter-content image, .epub-viewer-container img, .epub-viewer-container image, #webnovelContent img, .wn-content-wrap img, .pdf-page-canvas img');
    if (img) {
      e.preventDefault();
      e.stopPropagation();
      const src = img.currentSrc || img.src || img.getAttribute('xlink:href') || img.getAttribute('href');
      if (src && window.openIllustrationLightbox) {
        window.openIllustrationLightbox(src, img.alt || '');
      }
    }
  });

  });


  // Download Sponsor Modal (Rewarded Step)
  let _downloadCountdownInterval = null;

  window.openDownloadSponsorModal = function () {
    if (!currentBookRef) {
      alert("Aucun volume actif à télécharger.");
      return;
    }

    let modal = document.getElementById("downloadSponsorModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "downloadSponsorModal";
      modal.className = "download-sponsor-overlay";
      modal.innerHTML = `
        <div class="download-sponsor-card" role="dialog" aria-modal="true" aria-labelledby="downloadSponsorBookTitle">
          <button class="download-sponsor-close" id="closeDownloadSponsorBtn" title="Fermer" aria-label="Fermer">
            <i class="fa-solid fa-xmark"></i>
          </button>
          
          <div class="download-sponsor-header">
            <div class="download-sponsor-badge">
              <i class="fa-solid fa-file-arrow-down"></i> TÉLÉCHARGEMENT HORS-LIGNE
            </div>
            <h3 class="download-sponsor-title" id="downloadSponsorBookTitle">Tome Complet</h3>
            <p class="download-sponsor-desc">
              NovelTrad est <strong>gratuit et sans pub</strong> pendant la lecture. Soutenez la plateforme quelques secondes pour débloquer votre téléchargement.
            </p>
          </div>

          <div class="download-sponsor-ad-frame">
            <iframe id="adsterraIframeSlot" width="300" height="250" frameborder="0" scrolling="no" style="border:none;border-radius:8px;overflow:hidden;background:#090a0d;display:block;margin:0 auto;"></iframe>
          </div>

          <div class="download-sponsor-footer">
            <div class="download-timer-pill" id="downloadTimerPill">
              <i class="fa-solid fa-clock"></i> Déblocage dans <span id="downloadTimerSec">8</span>s...
            </div>
            <button id="downloadConfirmBtn" class="download-sponsor-btn" disabled>
              <i class="fa-solid fa-spinner fa-spin"></i> Préparation (8s)...
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      // Close handlers
      const closeBtn = modal.querySelector("#closeDownloadSponsorBtn");
      if (closeBtn) {
        closeBtn.addEventListener("click", window.closeDownloadSponsorModal);
      }
      modal.addEventListener("click", function(e) {
        if (e.target === modal) window.closeDownloadSponsorModal();
      });
      document.addEventListener("keydown", function(e) {
        if (e.key === "Escape" && modal.classList.contains("active")) {
          window.closeDownloadSponsorModal();
        }
      });
    }

    const titleEl = modal.querySelector("#downloadSponsorBookTitle");
    const safeTitle = (currentBookRef && currentBookRef.title) || "Volume";
    const ext = (currentFormat === 'pdf' || (currentBookRef && currentBookRef.format === 'pdf')) ? 'PDF' : 'EPUB';
    if (titleEl) {
      titleEl.textContent = safeTitle + ' (' + ext + ')';
    }

    // Refresh Adsterra iframe to trigger a fresh view
    const adIframe = modal.querySelector("#adsterraIframeSlot");
    if (adIframe) {
      adIframe.src = "/ads/adsterra_300x250.html?t=" + Date.now();
    }

    // Reset button & timer state
    const timerPill = modal.querySelector("#downloadTimerPill");
    const confirmBtn = modal.querySelector("#downloadConfirmBtn");
    if (timerPill) {
      timerPill.innerHTML = '<i class="fa-solid fa-clock"></i> Déblocage dans <span id="downloadTimerSec">8</span>s...';
    }
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.className = "download-sponsor-btn";
      confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Préparation (8s)...';
      confirmBtn.onclick = null;
    }

    // Show modal
    modal.style.display = "flex";
    requestAnimationFrame(() => modal.classList.add("active"));

    // Start 5 second countdown
    if (_downloadCountdownInterval) clearInterval(_downloadCountdownInterval);
    let secondsLeft = 8;

    _downloadCountdownInterval = setInterval(() => {
      secondsLeft--;
      const secSpan = modal.querySelector("#downloadTimerSec");
      if (secSpan) secSpan.textContent = secondsLeft;

      if (confirmBtn && secondsLeft > 0) {
        confirmBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Préparation (${secondsLeft}s)...`;
      }

      if (secondsLeft <= 0) {
        clearInterval(_downloadCountdownInterval);
        _downloadCountdownInterval = null;

        if (timerPill) {
          timerPill.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#10b981;"></i> Fichier prêt au téléchargement !';
        }
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.className = "download-sponsor-btn ready";
          confirmBtn.innerHTML = '<i class="fa-solid fa-download"></i> Lancer le Téléchargement';
          confirmBtn.onclick = function() {
            window.closeDownloadSponsorModal();
            if (typeof window.downloadCurrentVolume === "function") {
              window.downloadCurrentVolume();
            }
          };
        }
      }
    }, 1000);
  };

  window.closeDownloadSponsorModal = function () {
    const modal = document.getElementById("downloadSponsorModal");
    if (modal) {
      modal.classList.remove("active");
      setTimeout(() => {
        if (!modal.classList.contains("active")) {
          modal.style.display = "none";
        }
      }, 250);
    }
    if (_downloadCountdownInterval) {
      clearInterval(_downloadCountdownInterval);
      _downloadCountdownInterval = null;
    }
  };


})();
