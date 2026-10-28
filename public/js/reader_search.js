/**
 * reader_search.js - Moteur de recherche et de correction chirurgicale in-place pour NovelTrad
 * Réservé exclusivement aux Admins & Contributeurs (Staff)
 * 
 * Capacités :
 * 1. Recherche ultra-tolérante (phrases, accents, guillemets, tirets, ponctuation, chevrons)
 * 2. Détection automatique du livre et du conteneur (Webnovel ou EPUB ePub.js)
 * 3. Édition chirurgicale in-place :
 *    - Bouton "Corriger" dans la barre de recherche
 *    - Remplacement immédiat dans le document affiché (DOM)
 *    - Sauvegarde automatique master backup (.bak)
 *    - Modification directe et sécurisée du fichier EPUB via JSZip
 * 4. Bouton 1-clic "Restaurer l'original (.bak)" pour annuler toute modification en cas d'erreur
 */

(function() {
  'use strict';

  let searchMatches = []; // [{ id, marks, scrollTarget, targetCtx, rawMatchedText }]
  let currentMatchIdx = -1;
  let searchDebounceTimer = null;
  let isWidgetOpen = false;

  const HIGHLIGHT_CSS = `
    .nt-search-highlight {
      background-color: rgba(245, 158, 11, 0.45) !important;
      color: inherit !important;
      border-radius: 3px !important;
      padding: 1px 2px !important;
      box-shadow: 0 0 6px rgba(245, 158, 11, 0.4) !important;
      transition: background-color 0.15s ease, box-shadow 0.15s ease !important;
    }
    .nt-search-highlight.active {
      background-color: #f59e0b !important;
      color: #000000 !important;
      font-weight: 800 !important;
      box-shadow: 0 0 18px rgba(245, 158, 11, 0.98), 0 0 4px #fbbf24 !important;
      outline: 2px solid #fbbf24 !important;
      border-radius: 4px !important;
    }
    .nt-search-highlight.saved-success {
      background-color: #10b981 !important;
      color: #ffffff !important;
      box-shadow: 0 0 20px rgba(16, 185, 129, 0.95) !important;
      outline: 2px solid #34d399 !important;
    }
  `;

  // --- 1. INJECTION DU STYLE ---
  function injectStyles(targetDoc) {
    const doc = targetDoc || document;
    if (doc.getElementById('ntReaderSearchStyles')) return;
    const style = doc.createElement('style');
    style.id = 'ntReaderSearchStyles';
    style.textContent = HIGHLIGHT_CSS + `
      .nt-reader-search-widget {
        position: fixed !important;
        top: 68px !important;
        right: 24px !important;
        z-index: 2147483647 !important;
        background: #0f1117 !important;
        border: 1px solid rgba(245, 158, 11, 0.5) !important;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.9), 0 0 24px rgba(245, 158, 11, 0.25) !important;
        border-radius: 12px !important;
        padding: 6px 10px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 8px !important;
        box-sizing: border-box !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        animation: ntSearchSlideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
        max-width: 520px !important;
      }
      @keyframes ntSearchSlideIn {
        from { opacity: 0; transform: translateY(-8px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .nt-reader-search-widget.hidden {
        display: none !important;
      }
      .nt-search-bar-row {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
      }
      .nt-search-inner {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
      }
      .nt-search-icon {
        color: #f59e0b !important;
        font-size: 13px !important;
      }
      #ntReaderSearchInput {
        background: rgba(255, 255, 255, 0.08) !important;
        border: 1px solid rgba(255, 255, 255, 0.15) !important;
        border-radius: 6px !important;
        outline: none !important;
        color: #ffffff !important;
        font-family: inherit !important;
        font-size: 13.5px !important;
        width: 230px !important;
        padding: 6px 10px !important;
        box-sizing: border-box !important;
        transition: border-color 0.2s, box-shadow 0.2s !important;
      }
      #ntReaderSearchInput:focus {
        border-color: #f59e0b !important;
        box-shadow: 0 0 12px rgba(245, 158, 11, 0.4) !important;
      }
      .nt-search-counter {
        font-size: 11.5px !important;
        font-weight: 700 !important;
        color: #94a3b8 !important;
        padding: 3px 8px !important;
        border-radius: 4px !important;
        background: rgba(255, 255, 255, 0.07) !important;
        white-space: nowrap !important;
        min-width: 48px !important;
        text-align: center !important;
      }
      .nt-search-counter.has-results {
        color: #000000 !important;
        background: #f59e0b !important;
        font-weight: 800 !important;
      }
      .nt-search-counter.no-results {
        color: #f87171 !important;
        background: rgba(239, 68, 68, 0.16) !important;
      }
      .nt-search-actions {
        display: flex !important;
        align-items: center !important;
        gap: 3px !important;
        border-left: 1px solid rgba(255, 255, 255, 0.12) !important;
        padding-left: 6px !important;
      }
      .nt-search-nav-btn, .nt-search-close-btn, .nt-search-edit-btn {
        background: rgba(255, 255, 255, 0.06) !important;
        border: 1px solid rgba(255, 255, 255, 0.08) !important;
        color: #d4d4d8 !important;
        height: 28px !important;
        border-radius: 6px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        cursor: pointer !important;
        font-size: 12px !important;
        transition: all 0.15s ease !important;
        padding: 0 8px !important;
        gap: 4px !important;
      }
      .nt-search-nav-btn:hover {
        background: rgba(245, 158, 11, 0.25) !important;
        color: #f59e0b !important;
        border-color: rgba(245, 158, 11, 0.4) !important;
      }
      .nt-search-edit-btn {
        background: rgba(245, 158, 11, 0.18) !important;
        border-color: rgba(245, 158, 11, 0.4) !important;
        color: #fbbf24 !important;
        font-weight: 700 !important;
      }
      .nt-search-edit-btn:hover {
        background: #f59e0b !important;
        color: #000000 !important;
      }
      .nt-search-close-btn:hover {
        background: rgba(239, 68, 68, 0.25) !important;
        color: #ef4444 !important;
        border-color: rgba(239, 68, 68, 0.4) !important;
      }

      /* Tiroir de correction */
      .nt-edit-drawer {
        background: rgba(0, 0, 0, 0.4) !important;
        border: 1px solid rgba(245, 158, 11, 0.3) !important;
        border-radius: 8px !important;
        padding: 10px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 8px !important;
      }
      .nt-edit-drawer.hidden {
        display: none !important;
      }
      .nt-edit-drawer-title {
        font-size: 11px !important;
        text-transform: uppercase !important;
        letter-spacing: 0.05em !important;
        color: #fbbf24 !important;
        font-weight: 700 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
      }
      .nt-edit-original-preview {
        font-size: 12px !important;
        color: #94a3b8 !important;
        background: rgba(255, 255, 255, 0.04) !important;
        border-left: 2px solid #ef4444 !important;
        padding: 4px 8px !important;
        border-radius: 0 4px 4px 0 !important;
        max-height: 50px !important;
        overflow-y: auto !important;
        word-break: break-word !important;
      }
      #ntReaderEditTextArea {
        width: 100% !important;
        min-height: 58px !important;
        background: #181b24 !important;
        border: 1px solid rgba(245, 158, 11, 0.4) !important;
        border-radius: 6px !important;
        color: #ffffff !important;
        font-family: inherit !important;
        font-size: 13px !important;
        padding: 6px 8px !important;
        box-sizing: border-box !important;
        resize: vertical !important;
        outline: none !important;
      }
      #ntReaderEditTextArea:focus {
        border-color: #10b981 !important;
        box-shadow: 0 0 10px rgba(16, 185, 129, 0.35) !important;
      }
      .nt-edit-buttons-row {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 6px !important;
      }
      .nt-edit-right-buttons {
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
      }
      .nt-btn-save {
        background: #10b981 !important;
        color: #ffffff !important;
        border: none !important;
        border-radius: 6px !important;
        padding: 6px 12px !important;
        font-size: 12px !important;
        font-weight: 700 !important;
        cursor: pointer !important;
        display: inline-flex !important;
        align-items: center !important;
        gap: 6px !important;
        transition: background 0.15s ease !important;
      }
      .nt-btn-save:hover {
        background: #059669 !important;
      }
      .nt-btn-save:disabled {
        opacity: 0.5 !important;
        cursor: not-allowed !important;
      }
      .nt-btn-cancel {
        background: rgba(255, 255, 255, 0.08) !important;
        color: #d4d4d8 !important;
        border: none !important;
        border-radius: 6px !important;
        padding: 6px 10px !important;
        font-size: 12px !important;
        cursor: pointer !important;
      }
      .nt-btn-cancel:hover {
        background: rgba(255, 255, 255, 0.14) !important;
      }
      .nt-btn-restore {
        background: rgba(239, 68, 68, 0.12) !important;
        color: #f87171 !important;
        border: 1px solid rgba(239, 68, 68, 0.35) !important;
        border-radius: 6px !important;
        padding: 6px 10px !important;
        font-size: 11.5px !important;
        font-weight: 600 !important;
        cursor: pointer !important;
        display: inline-flex !important;
        align-items: center !important;
        gap: 5px !important;
        transition: all 0.15s ease !important;
      }
      .nt-btn-restore:hover {
        background: #ef4444 !important;
        color: #ffffff !important;
      }
      .nt-btn-restore:disabled {
        opacity: 0.5 !important;
        cursor: not-allowed !important;
      }
      .nt-toast-notification {
        position: fixed !important;
        bottom: 30px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        background: #064e3b !important;
        color: #ecfdf5 !important;
        border: 1px solid #10b981 !important;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8), 0 0 20px rgba(16, 185, 129, 0.4) !important;
        padding: 10px 18px !important;
        border-radius: 10px !important;
        font-size: 13.5px !important;
        font-weight: 700 !important;
        z-index: 2147483647 !important;
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        animation: ntToastSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
      }
      @keyframes ntToastSlideUp {
        from { opacity: 0; transform: translate(-50%, 15px); }
        to { opacity: 1; transform: translate(-50%, 0); }
      }
    `;
    (doc.head || doc.body).appendChild(style);
  }

  // --- 2. VÉRIFICATION DU RÔLE (STAFF) ---
  function isStaffUser() {
    try {
      if (window.authManager) {
        if (typeof window.authManager.isContributor === 'function') {
          return window.authManager.isContributor();
        }
        const profile = window.authManager.getProfile ? window.authManager.getProfile() : window.authManager.userProfile;
        const role = ((profile && profile.role) || '').toUpperCase();
        return role === 'ADMIN' || role === 'CONTRIBUTOR';
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // --- 3. DÉTECTION DES CONTENEURS ACTIFS ---
  function getSearchTargets() {
    const targets = [];

    // 1. Webnovel
    const wnContent = document.getElementById('webnovelContent');
    if (wnContent && wnContent.textContent.trim().length > 0) {
      injectStyles(document);
      targets.push({ doc: document, container: wnContent, type: 'webnovel' });
    }

    // 2. EPUB / PDF
    const epubViewer = document.getElementById('readerViewer');
    if (epubViewer) {
      const allIframes = document.querySelectorAll('#readerOverlay iframe, #readerViewer iframe, iframe');
      allIframes.forEach(iframe => {
        const src = (iframe.getAttribute('src') || '').toLowerCase();
        const id = (iframe.id || '').toLowerCase();
        if (src.includes('adsterra') || id.includes('adsterra') || iframe.getAttribute('width') === '300') {
          return;
        }

        try {
          if (iframe.contentDocument && iframe.contentDocument.body) {
            const bodyText = iframe.contentDocument.body.textContent.trim();
            if (bodyText.length > 0) {
              injectStyles(iframe.contentDocument);
              targets.push({
                doc: iframe.contentDocument,
                container: iframe.contentDocument.body,
                iframe: iframe,
                type: 'epub-iframe'
              });
            }
          }
        } catch(e) {}
      });

      const streamContainer = epubViewer.querySelector('.pdf-webtoon-container, .stream-chapters-wrap');
      if (streamContainer && streamContainer.textContent.trim().length > 0) {
        injectStyles(document);
        targets.push({ doc: document, container: streamContainer, type: 'epub-stream' });
      } else if (targets.length === 0 && epubViewer.textContent.trim().length > 0) {
        injectStyles(document);
        targets.push({ doc: document, container: epubViewer, type: 'epub-direct' });
      }
    }

    return targets;
  }

  // --- 4. NORMALISATION 1-POUR-1 (PRÉSERVE LES OFFSETS EXACTS) ---
  function normalize1to1(str) {
    return (str || '')
      .replace(/[\u2018\u2019\u201B`ʼ]/g, "'")
      .replace(/[\u201C\u201D\u00AB\u00BB\u2039\u203A\u300C\u300D]/g, '"')
      .replace(/[\u3008\u3009<>[\](){}]/g, ' ')
      .replace(/[\u2026]/g, '.')
      .replace(/[\u2013\u2014\u2015―–—]/g, '-')
      .replace(/[\u00A0\u202F\t\r\n]/g, ' ')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function buildSearchRegex(query) {
    const norm = normalize1to1(query).trim().toLowerCase();
    const tokens = norm.split(/[^a-z0-9]+/i).filter(t => t.length > 0).map(escapeRegExp);
    if (tokens.length === 0) return null;
    return new RegExp(tokens.join('[^a-z0-9]+'), 'gi');
  }

  // --- 5. NETTOYAGE ---
  function clearHighlights() {
    function cleanDoc(doc) {
      if (!doc) return;
      doc.querySelectorAll('.nt-search-highlight').forEach(m => {
        const parent = m.parentNode;
        if (parent) {
          while (m.firstChild) {
            parent.insertBefore(m.firstChild, m);
          }
          parent.removeChild(m);
          try { parent.normalize(); } catch(e) {}
        }
      });
    }

    cleanDoc(document);
    document.querySelectorAll('iframe').forEach(iframe => {
      try {
        if (iframe.contentDocument) cleanDoc(iframe.contentDocument);
      } catch(e) {}
    });

    searchMatches = [];
    currentMatchIdx = -1;
    updateCounter();
    closeEditDrawer();
  }

  // --- 6. EXTRACTION DES TEXTNODES ---
  function collectTextNodes(rootNode, doc) {
    const textNodes = [];
    const walker = doc.createTreeWalker(
      rootNode,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          if (!node.textContent || node.textContent.length === 0) return NodeFilter.FILTER_REJECT;
          if (node.parentElement && (
            node.parentElement.classList.contains('nt-search-highlight') ||
            node.parentElement.tagName === 'SCRIPT' ||
            node.parentElement.tagName === 'STYLE'
          )) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let n;
    while (n = walker.nextNode()) {
      textNodes.push(n);
    }
    return textNodes;
  }

  // --- 7. MOTEUR DE RECHERCHE ---
  function performSearch(rawQuery) {
    clearHighlights();

    if (!rawQuery || rawQuery.trim().length < 2) {
      updateCounter();
      return;
    }

    const regex = buildSearchRegex(rawQuery);
    if (!regex) {
      updateCounter();
      return;
    }

    const targets = getSearchTargets();
    if (targets.length === 0) {
      updateCounter();
      return;
    }

    let matchGlobalCounter = 0;

    targets.forEach(target => {
      const container = target.container;
      const doc = target.doc || document;

      const textNodes = collectTextNodes(container, doc);
      if (textNodes.length === 0) return;

      let fullRawText = '';
      const nodeMap = [];
      textNodes.forEach(node => {
        const start = fullRawText.length;
        fullRawText += node.textContent;
        const end = fullRawText.length;
        nodeMap.push({ node, start, end });
      });

      const fullNormText = normalize1to1(fullRawText);

      const matches = [];
      let m;
      regex.lastIndex = 0;
      while ((m = regex.exec(fullNormText)) !== null) {
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          rawMatchedText: fullRawText.substring(m.index, m.index + m[0].length),
          matchId: 'nt_m_' + (++matchGlobalCounter)
        });
        if (m[0].length === 0) regex.lastIndex++;
      }

      if (matches.length === 0) return;

      const sortedMatches = [...matches].reverse();

      sortedMatches.forEach(bm => {
        const matchMarks = [];

        nodeMap.forEach(item => {
          const node = item.node;
          const start = item.start;
          const end = item.end;

          if (end > bm.start && start < bm.end) {
            const sliceStart = Math.max(0, bm.start - start);
            const sliceEnd = Math.min(node.textContent.length, bm.end - start);

            if (sliceEnd > sliceStart) {
              const parent = node.parentNode;
              if (!parent) return;

              const rawVal = node.textContent;
              const before = rawVal.substring(0, sliceStart);
              const matchVal = rawVal.substring(sliceStart, sliceEnd);
              const after = rawVal.substring(sliceEnd);

              const frag = doc.createDocumentFragment();
              if (before.length > 0) frag.appendChild(doc.createTextNode(before));

              const markNode = doc.createElement('mark');
              markNode.className = 'nt-search-highlight';
              markNode.dataset.matchId = bm.matchId;
              markNode.textContent = matchVal;
              frag.appendChild(markNode);
              matchMarks.push(markNode);

              if (after.length > 0) frag.appendChild(doc.createTextNode(after));

              parent.replaceChild(frag, node);
              item.node = markNode;
            }
          }
        });

        if (matchMarks.length > 0) {
          searchMatches.unshift({
            id: bm.matchId,
            marks: matchMarks,
            scrollTarget: matchMarks[0],
            rawMatchedText: bm.rawMatchedText,
            doc: doc,
            targetCtx: target
          });
        }
      });
    });

    if (searchMatches.length > 0) {
      currentMatchIdx = 0;
      focusMatch(currentMatchIdx);
    }

    updateCounter();
  }

  // --- 8. COMPTEUR & ÉTAT DES BOUTONS ---
  function updateCounter() {
    const counter = document.getElementById('ntReaderSearchCounter');
    const input = document.getElementById('ntReaderSearchInput');
    const editBtn = document.getElementById('ntReaderEditBtn');
    if (!counter) return;

    const val = input ? input.value.trim() : '';

    if (val.length < 2) {
      counter.textContent = '0/0';
      counter.className = 'nt-search-counter';
      if (editBtn) editBtn.style.display = 'none';
    } else if (searchMatches.length === 0) {
      counter.textContent = '0 trouvé';
      counter.className = 'nt-search-counter no-results';
      if (editBtn) editBtn.style.display = 'none';
    } else {
      counter.textContent = `${currentMatchIdx + 1}/${searchMatches.length}`;
      counter.className = 'nt-search-counter has-results';
      if (editBtn) editBtn.style.display = 'inline-flex';
    }
  }

  // --- 9. FOCUS & DÉFILEMENT ---
  function focusMatch(index) {
    if (searchMatches.length === 0) return;

    if (index < 0) index = searchMatches.length - 1;
    if (index >= searchMatches.length) index = 0;

    document.querySelectorAll('.nt-search-highlight.active').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('iframe').forEach(iframe => {
      try {
        if (iframe.contentDocument) {
          iframe.contentDocument.querySelectorAll('.nt-search-highlight.active').forEach(el => el.classList.remove('active'));
        }
      } catch(e) {}
    });

    currentMatchIdx = index;
    const matchObj = searchMatches[currentMatchIdx];
    if (!matchObj) return;

    matchObj.marks.forEach(m => m.classList.add('active'));

    const scrollEl = matchObj.scrollTarget || matchObj.marks[0];
    const targetCtx = matchObj.targetCtx;

    try {
      scrollEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    } catch(e) {
      scrollEl.scrollIntoView(true);
    }

    if (targetCtx && targetCtx.type === 'epub-iframe' && targetCtx.iframe) {
      try {
        const iframeWin = targetCtx.iframe.contentWindow;
        if (iframeWin) {
          const rect = scrollEl.getBoundingClientRect();
          iframeWin.scrollTo({
            top: (iframeWin.scrollY || 0) + rect.top - 140,
            behavior: 'smooth'
          });
        }
      } catch(e) {}
    }

    const wnScroll = document.getElementById('wnScrollContainer');
    if (wnScroll && targetCtx && targetCtx.type === 'webnovel') {
      try {
        const rect = scrollEl.getBoundingClientRect();
        const containerRect = wnScroll.getBoundingClientRect();
        const offset = rect.top - containerRect.top + wnScroll.scrollTop - 140;
        wnScroll.scrollTo({ top: offset, behavior: 'smooth' });
      } catch(e) {}
    }

    updateCounter();

    const originalPreview = document.getElementById('ntReaderEditOriginalPreview');
    const editArea = document.getElementById('ntReaderEditTextArea');
    if (originalPreview && editArea && !document.getElementById('ntReaderEditDrawer').classList.contains('hidden')) {
      originalPreview.textContent = matchObj.rawMatchedText || '';
      editArea.value = matchObj.rawMatchedText || '';
    }
  }

  function navigateMatches(direction) {
    if (searchMatches.length === 0) return;
    focusMatch(currentMatchIdx + direction);
  }

  // --- 10. TIROIR ET LOGIQUE D'ÉDITION IN-PLACE ---
  function openEditDrawer() {
    if (searchMatches.length === 0 || currentMatchIdx < 0) return;
    const matchObj = searchMatches[currentMatchIdx];
    if (!matchObj) return;

    const drawer = document.getElementById('ntReaderEditDrawer');
    const originalPreview = document.getElementById('ntReaderEditOriginalPreview');
    const editArea = document.getElementById('ntReaderEditTextArea');

    if (drawer && originalPreview && editArea) {
      drawer.classList.remove('hidden');
      originalPreview.textContent = matchObj.rawMatchedText || '';
      editArea.value = matchObj.rawMatchedText || '';
      editArea.focus();
      editArea.select();
      checkBackupStatus();
    }
  }

  function closeEditDrawer() {
    const drawer = document.getElementById('ntReaderEditDrawer');
    if (drawer) drawer.classList.add('hidden');
  }

  function showToastNotification(message) {
    const existing = document.querySelector('.nt-toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'nt-toast-notification';
    toast.innerHTML = `<i class="fa-solid fa-circle-check" style="color:#34d399;"></i> <span>${message}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function resolveActiveBookKey() {
    const book = window.currentBookRef || {};
    const streamMan = window._streamVolumeManifest || {};
    const volCtx = window._activeVolumeContext || {};
    return book.fileKey || book.id || book.filePath || book.file_path || streamMan.fileKey || volCtx.volumeKey || '';
  }

  async function saveCorrection() {
    if (searchMatches.length === 0 || currentMatchIdx < 0) return;
    const matchObj = searchMatches[currentMatchIdx];
    if (!matchObj) return;

    const editArea = document.getElementById('ntReaderEditTextArea');
    const saveBtn = document.getElementById('ntReaderSaveEditBtn');
    if (!editArea || !saveBtn) return;

    const rawOrig = matchObj.rawMatchedText || '';
    const newText = editArea.value.trim();

    if (!newText || newText === rawOrig) {
      closeEditDrawer();
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mise à jour de l\'EPUB...';

    const book = window.currentBookRef || {};
    const fileKey = resolveActiveBookKey();
    const seriesId = (window.currentSeries && window.currentSeries.id) || book.seriesId || '';
    const chapterNum = window.currentChapterNum || book.chapterNumber || 1;

    let chapterHref = '';
    try {
      if (window._currentEpubRendition && window._currentEpubRendition.currentLocation) {
        const loc = window._currentEpubRendition.currentLocation();
        chapterHref = loc && loc.start && loc.start.href ? loc.start.href : '';
      }
    } catch(e) {}

    let token = '';
    try {
      if (window.authManager) {
        if (typeof window.authManager.getAccessToken === 'function') {
          token = await window.authManager.getAccessToken();
        }
        if (!token && window.authManager.currentSession && window.authManager.currentSession.access_token) {
          token = window.authManager.currentSession.access_token;
        }
        if (!token && window.authManager.session && window.authManager.session.access_token) {
          token = window.authManager.session.access_token;
        }
      }
    } catch(e) {}

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      const resp = await fetch('/api/staff/correct-text', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          fileKey,
          originalText: rawOrig,
          correctedText: newText,
          chapterHref,
          seriesId,
          chapterNum
        })
      });

      const resData = await resp.json();

      if (!resp.ok || !resData.success) {
        throw new Error(resData.error || resData.message || 'Erreur lors de la mise à jour.');
      }

      // Remplacer visuellement dans le DOM
      if (matchObj.marks && matchObj.marks.length > 0) {
        const firstMark = matchObj.marks[0];
        firstMark.textContent = newText;
        firstMark.classList.add('saved-success');

        for (let i = 1; i < matchObj.marks.length; i++) {
          matchObj.marks[i].remove();
        }
      }

      matchObj.rawMatchedText = newText;
      closeEditDrawer();
      showToastNotification("Correction enregistrée ! L'EPUB a été mis à jour.");

    } catch (err) {
      console.error('[ReaderSearch] Erreur :', err);
      alert('Impossible de modifier le livre : ' + err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> Enregistrer dans l\'EPUB';
    }
  }

  // --- 11. RESTAURATION AUTOMATIQUE 1-CLIC DE LA SAUVEGARDE ORIGINALE (.bak) ---
  async function restoreOriginalEpub() {
    const fileKey = resolveActiveBookKey();
    if (!fileKey) {
      alert("Identifiant du livre introuvable.");
      return;
    }

    const confirmed = confirm(
      "⚠️ Restaurer la version d'origine du livre ?\n\n" +
      "Toutes les modifications et corrections apportées à cet EPUB seront définitivement annulées et le fichier original (.bak) sera restauré.\n\n" +
      "Le livre redeviendra 100% comme au premier jour. Confirmer ?"
    );

    if (!confirmed) return;

    const restoreBtn = document.getElementById('ntReaderRestoreBtn');
    if (restoreBtn) {
      restoreBtn.disabled = true;
      restoreBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Restauration...';
    }

    let token = '';
    try {
      if (window.authManager) {
        if (typeof window.authManager.getAccessToken === 'function') {
          token = await window.authManager.getAccessToken();
        }
        if (!token && window.authManager.currentSession) {
          token = window.authManager.currentSession.access_token;
        }
      }
    } catch(e) {}

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      const resp = await fetch('/api/staff/restore-epub', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ fileKey })
      });

      const resData = await resp.json();
      if (!resp.ok || !resData.success) {
        throw new Error(resData.error || resData.message || 'Impossible de restaurer la sauvegarde.');
      }

      closeEditDrawer();
      showToastNotification("↺ Version originale restaurée avec succès ! Rechargement du livre...");

      setTimeout(() => {
        window.location.reload();
      }, 1200);

    } catch(err) {
      console.error('[ReaderSearch] Erreur restauration :', err);
      alert("Erreur de restauration : " + err.message);
      if (restoreBtn) {
        restoreBtn.disabled = false;
        restoreBtn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Restaurer l\'original (.bak)';
      }
    }
  }

  // --- 12. CRÉATION DU WIDGET FLOTTANT ---
  function createSearchWidget() {
    let widget = document.getElementById('ntReaderSearchWidget');
    if (widget) return widget;

    widget = document.createElement('div');
    widget.id = 'ntReaderSearchWidget';
    widget.className = 'nt-reader-search-widget hidden';
    widget.setAttribute('role', 'search');
    widget.innerHTML = `
      <div class="nt-search-bar-row">
        <div class="nt-search-inner">
          <i class="fa-solid fa-magnifying-glass nt-search-icon"></i>
          <input 
            type="text" 
            id="ntReaderSearchInput" 
            placeholder="Rechercher une phrase ou faute..." 
            autocomplete="off" 
            spellcheck="false"
          />
          <span id="ntReaderSearchCounter" class="nt-search-counter">0/0</span>
        </div>
        <div class="nt-search-actions">
          <button id="ntReaderSearchPrev" class="nt-search-nav-btn" title="Précédent (Shift+Entrée)">
            <i class="fa-solid fa-chevron-up"></i>
          </button>
          <button id="ntReaderSearchNext" class="nt-search-nav-btn" title="Suivant (Entrée)">
            <i class="fa-solid fa-chevron-down"></i>
          </button>
          <button id="ntReaderEditBtn" class="nt-search-edit-btn" title="Modifier la phrase trouvée" style="display:none;">
            <i class="fa-solid fa-pen-to-square"></i> Corriger
          </button>
          <button id="ntReaderSearchClose" class="nt-search-close-btn" title="Fermer (Échap)">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>

      <!-- Tiroir de modification in-place avec bouton restaurer original -->
      <div id="ntReaderEditDrawer" class="nt-edit-drawer hidden">
        <div class="nt-edit-drawer-title">
          <span><i class="fa-solid fa-pen-nib"></i> Corriger cette phrase dans l'EPUB</span>
          <span style="font-size:10px; color:#94a3b8; text-transform:none;">Édition chirurgicale</span>
        </div>
        <div class="nt-edit-original-preview" id="ntReaderEditOriginalPreview" title="Texte original actuel"></div>
        <textarea id="ntReaderEditTextArea" rows="2" placeholder="Saisir la phrase corrigée..."></textarea>
        <div class="nt-edit-buttons-row">
          <button id="ntReaderRestoreBtn" class="nt-btn-restore" title="Annuler toutes les modifications et revenir à la version .bak originale">
            <i class="fa-solid fa-rotate-left"></i> Restaurer l'original (.bak)
          </button>
          <div class="nt-edit-right-buttons">
            <button id="ntReaderCancelEditBtn" class="nt-btn-cancel">Annuler</button>
            <button id="ntReaderSaveEditBtn" class="nt-btn-save">
              <i class="fa-solid fa-check"></i> Enregistrer dans l'EPUB
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(widget);

    const input = document.getElementById('ntReaderSearchInput');
    const prevBtn = document.getElementById('ntReaderSearchPrev');
    const nextBtn = document.getElementById('ntReaderSearchNext');
    const closeBtn = document.getElementById('ntReaderSearchClose');
    const editBtn = document.getElementById('ntReaderEditBtn');
    const cancelEditBtn = document.getElementById('ntReaderCancelEditBtn');
    const saveEditBtn = document.getElementById('ntReaderSaveEditBtn');
    const restoreBtn = document.getElementById('ntReaderRestoreBtn');

    if (input) {
      input.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
          performSearch(input.value);
        }, 120);
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (e.shiftKey) navigateMatches(-1);
          else navigateMatches(1);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeSearch();
        }
      });
    }

    if (prevBtn) prevBtn.addEventListener('click', (e) => { e.preventDefault(); navigateMatches(-1); });
    if (nextBtn) nextBtn.addEventListener('click', (e) => { e.preventDefault(); navigateMatches(1); });
    if (closeBtn) closeBtn.addEventListener('click', (e) => { e.preventDefault(); closeSearch(); });

    if (editBtn) editBtn.addEventListener('click', (e) => { e.preventDefault(); openEditDrawer(); });
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', (e) => { e.preventDefault(); closeEditDrawer(); });
    if (saveEditBtn) saveEditBtn.addEventListener('click', (e) => { e.preventDefault(); saveCorrection(); });
    if (restoreBtn) restoreBtn.addEventListener('click', (e) => { e.preventDefault(); restoreOriginalEpub(); });

    return widget;
  }

  function openSearch(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const widget = createSearchWidget();
    const input = document.getElementById('ntReaderSearchInput');

    if (widget) {
      widget.classList.remove('hidden');
      widget.style.display = 'flex';
      isWidgetOpen = true;
      if (input) {
        input.focus();
        input.select();
        if (input.value.trim().length >= 2) {
          performSearch(input.value);
        }
      }
    }
  }

  function closeSearch(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const widget = document.getElementById('ntReaderSearchWidget');
    if (widget) {
      widget.classList.add('hidden');
      widget.style.display = 'none';
      isWidgetOpen = false;
    }
    clearHighlights();
  }

  function toggleSearch(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const widget = document.getElementById('ntReaderSearchWidget');
    if (widget && !widget.classList.contains('hidden') && widget.style.display !== 'none') {
      closeSearch(e);
    } else {
      openSearch(e);
    }
  }

  // --- 13. BOUTONS DANS LES BARRES D'OUTILS ---
  function updateToolbarButtons() {
    const isStaff = isStaffUser();

    // 1. Barre Webnovel
    const wnRight = document.querySelector('.wn-toolbar-right');
    if (wnRight) {
      let btn = document.getElementById('btnWnSearchStaff');
      if (isStaff) {
        if (!btn) {
          btn = document.createElement('button');
          btn.id = 'btnWnSearchStaff';
          btn.type = 'button';
          btn.className = 'wn-tool-btn staff-search-btn';
          btn.title = 'Rechercher et corriger une faute (Ctrl+F)';
          btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';
          btn.style.color = '#f59e0b';
          btn.style.cursor = 'pointer';
          btn.addEventListener('click', toggleSearch);
          const reportBtn = document.getElementById('wnReportErrorBtn');
          if (reportBtn) wnRight.insertBefore(btn, reportBtn);
          else wnRight.appendChild(btn);
        }
        btn.style.display = 'inline-flex';
      } else if (btn) {
        btn.style.display = 'none';
      }
    }

    // 2. Barre EPUB / PDF
    const epubRight = document.querySelector('.premium-reader-toolbar .toolbar-right');
    if (epubRight) {
      let btn = document.getElementById('btnEpubSearchStaff');
      if (isStaff) {
        if (!btn) {
          btn = document.createElement('button');
          btn.id = 'btnEpubSearchStaff';
          btn.type = 'button';
          btn.className = 'toolbar-btn staff-search-btn';
          btn.title = 'Rechercher et corriger une faute (Ctrl+F)';
          btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';
          btn.style.color = '#f59e0b';
          btn.style.cursor = 'pointer';
          btn.addEventListener('click', toggleSearch);
          const reportBtn = document.getElementById('readerReportErrorBtn');
          if (reportBtn) epubRight.insertBefore(btn, reportBtn);
          else epubRight.appendChild(btn);
        }
        btn.style.display = 'inline-flex';
      } else if (btn) {
        btn.style.display = 'none';
      }
    }
  }

  // Écoute globale Ctrl+F / Cmd+F
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
      const targets = getSearchTargets();
      if (targets.length > 0 && isStaffUser()) {
        e.preventDefault();
        e.stopPropagation();
        openSearch(e);
      }
    }
  }, true);

  // Initialisation
  document.addEventListener('DOMContentLoaded', () => {
    injectStyles(document);
    createSearchWidget();
    updateToolbarButtons();

    if (window.authManager) {
      if (typeof window.authManager.onAuthStateChange === 'function') {
        window.authManager.onAuthStateChange(() => updateToolbarButtons());
      }
      if (typeof window.authManager.onAuthChange === 'function') {
        window.authManager.onAuthChange(() => updateToolbarButtons());
      }
    }
  });

  const observer = new MutationObserver(() => {
    updateToolbarButtons();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });

  window.readerSearch = {
    open: openSearch,
    close: closeSearch,
    toggle: toggleSearch,
    isStaff: isStaffUser,
    perform: performSearch
  };

})();
