/**
 * reading_resume.js - Synchronisation de progression Cross-Device en temps réel & Bandeau "Reprendre la lecture"
 * NovelTrad (C) 2026
 */
(function() {
  'use strict';

  let syncDebounceTimer = null;
  let activeBannerEl = null;

  // =========================================================================
  // 0. HELPER : IDENTIFIANT D'APPAREIL PERSISTANT POUR INVITÉS (GUEST)
  // =========================================================================
  function getDeviceId() {
    try {
      let did = localStorage.getItem('noveltrad_device_id');
      if (!did || did.length < 8) {
        did = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
        localStorage.setItem('noveltrad_device_id', did);
      }
      return did;
    } catch (e) {
      return 'dev_guest';
    }
  }

  // =========================================================================
  // 1. HELPER : ENVOI DE LA PROGRESSION EN TEMPS RÉEL VERS LE SERVEUR
  // =========================================================================
  window.syncReadingProgressToServer = function(progressRecord) {
    if (!progressRecord) return;

    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(async () => {
      try {
        const auth = window.authManager;
        let token = null;
        if (auth && typeof auth.getAccessToken === 'function') {
          token = await auth.getAccessToken();
        }

        const deviceId = getDeviceId();
        const headers = { 
          'Content-Type': 'application/json',
          'X-Device-Id': deviceId
        };
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const payload = Object.assign({}, progressRecord, { deviceId });

        await fetch('/api/user/reading-progress', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
      } catch (err) {
        // Silently continue (offline first)
      }
    }, 1800);
  };

  // =========================================================================
  // 2. FORMATTAGE DU TEMPS RELATIF
  // =========================================================================
  function formatTimeAgo(timestamp) {
    if (!timestamp) return '';
    try {
      const diffMs = Date.now() - new Date(timestamp).getTime();
      const diffMin = Math.floor(diffMs / (60 * 1000));
      const diffHours = Math.floor(diffMin / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMin < 2) return "À l'instant";
      if (diffMin < 60) return `Il y a ${diffMin} min`;
      if (diffHours < 24) return `Il y a ${diffHours} h`;
      if (diffDays === 1) return "Hier";
      if (diffDays < 7) return `Il y a ${diffDays} jours`;
      return "Récemment";
    } catch(e) {
      return '';
    }
  }

  // =========================================================================
  // 3. VÉRIFICATION ET AFFICHAGE DU BANDEAU "REPRENDRE LA LECTURE"
  // =========================================================================
  async function checkAndDisplayResumeBanner() {
    // Si le lecteur est déjà ouvert ou actif, ne pas afficher
    const readerOverlay = document.getElementById('readerOverlay');
    if (readerOverlay && !readerOverlay.classList.contains('hidden') && readerOverlay.style.display !== 'none') {
      return;
    }

    // Récupérer la dernière progression depuis le serveur (Cross-Device)
    let serverProgress = null;
    try {
      const auth = window.authManager;
      let token = null;
      if (auth && typeof auth.getAccessToken === 'function') {
        token = await auth.getAccessToken();
      }

      const headers = {
        'X-Device-Id': getDeviceId()
      };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      const res = await fetch('/api/user/latest-reading', { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.hasProgress) {
          serverProgress = data.progress;
        }
      }
    } catch (e) {}

    // Récupérer la dernière progression locale IndexedDB
    let localProgress = null;
    try {
      if (window.libraryDB && typeof window.libraryDB.getAllHistory === 'function') {
        const history = await window.libraryDB.getAllHistory();
        if (history && history.length > 0) {
          localProgress = history[0];
        }
      }
    } catch (e) {}

    // Déterminer la progression la plus récente entre le serveur et le local
    let latest = null;
    const serverTime = serverProgress ? (new Date(serverProgress.lastReadAt || serverProgress.updated_at || 0).getTime()) : 0;
    const localTime = localProgress ? (localProgress.lastReadAt || localProgress.lastReadDate || 0) : 0;

    if (serverProgress && serverTime >= localTime) {
      latest = serverProgress;
    } else if (localProgress) {
      latest = localProgress;
    }

    if (!latest) return;

    // Critères d'affichage : lu il y a moins de 14 jours et non terminé à 100%
    const readTimestamp = latest.lastReadAt || latest.lastReadDate || serverTime || localTime;
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    if (Date.now() - readTimestamp > fourteenDaysMs) return;

    const pct = latest.progressPct !== undefined ? latest.progressPct : (latest.progress || 0);
    if (pct >= 100) return; // Déjà fini

    // Respecter le rejet de l'utilisateur pour cette session
    const dismissKey = 'nt_dismissed_resume_' + (latest.bookId || latest.id);
    if (sessionStorage.getItem(dismissKey)) return;

    // Afficher le bandeau
    renderResumeBanner(latest, readTimestamp);
  }

  function renderResumeBanner(item, readTimestamp) {
    if (activeBannerEl) activeBannerEl.remove();

    const banner = document.createElement('div');
    banner.id = 'ntResumeReadingBanner';
    banner.className = 'nt-resume-banner';
    banner.setAttribute('role', 'complementary');
    banner.setAttribute('aria-label', 'Reprendre la lecture');

    const coverUrl = item.cover || '/uploads/covers/default_cover.jpg';
    const titleText = item.title || 'Volume en cours';
    const timeText = formatTimeAgo(readTimestamp);
    const pct = Math.max(1, Math.min(99, Math.round(item.progressPct !== undefined ? item.progressPct : (item.progress || 0))));

    // Extraire le numéro de chapitre ou sous-titre
    let subTitle = '';
    if (item.chapterId || item.chapterNumber) {
      subTitle = `Chapitre ${item.chapterId || item.chapterNumber}`;
    } else if (item.volumeNumber) {
      subTitle = `Tome ${item.volumeNumber}`;
    }

    banner.innerHTML = `
      <div class="nt-resume-inner">
        <!-- Vignette couverture avec effet relief -->
        <div class="nt-resume-cover-wrap">
          <img src="${coverUrl}" alt="Couverture" class="nt-resume-cover" onerror="this.src='/uploads/covers/default_cover.jpg'; this.onerror=null;">
          <div class="nt-resume-play-badge">
            <i class="fa-solid fa-play"></i>
          </div>
        </div>

        <!-- Contenu descriptif -->
        <div class="nt-resume-content">
          <div class="nt-resume-tag-row">
            <span class="nt-resume-pulse-dot"></span>
            <span class="nt-resume-tag">Reprendre votre lecture</span>
            ${timeText ? `<span class="nt-resume-time-pill">${timeText}</span>` : ''}
          </div>
          <h4 class="nt-resume-title" title="${titleText}">${titleText}</h4>
          <div class="nt-resume-meta-row">
            ${subTitle ? `<span class="nt-resume-chapter-name"><i class="fa-solid fa-bookmark"></i> ${subTitle}</span>` : ''}
            <span class="nt-resume-pct-badge">${pct}% lu</span>
          </div>
        </div>

        <!-- Boutons d'action -->
        <div class="nt-resume-actions">
          <button type="button" id="ntBtnResumeRead" class="nt-btn-resume-action" title="Continuer la lecture">
            <i class="fa-solid fa-book-open-reader"></i>
            <span>Reprendre</span>
          </button>
          <button type="button" id="ntBtnDismissResume" class="nt-btn-resume-dismiss" title="Ignorer">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(banner);
    activeBannerEl = banner;

    // Déclencher animation d'entrée
    requestAnimationFrame(() => {
      banner.classList.add('visible');
    });

    // 1. Bouton Ignorer
    const dismissBtn = banner.querySelector('#ntBtnDismissResume');
    if (dismissBtn) {
      dismissBtn.onclick = (e) => {
        e.stopPropagation();
        sessionStorage.setItem('nt_dismissed_resume_' + (item.bookId || item.id), '1');
        banner.classList.remove('visible');
        setTimeout(() => banner.remove(), 350);
      };
    }

    // 2. Bouton Reprendre
    const resumeBtn = banner.querySelector('#ntBtnResumeRead');
    const innerWrap = banner.querySelector('.nt-resume-inner');

    const handleResume = async () => {
      banner.classList.remove('visible');
      setTimeout(() => banner.remove(), 300);

      const format = (item.format || 'epub').toLowerCase();

      // Cas 1 : Webnovel
      if (format === 'webnovel' && typeof window.openWebnovelReader === 'function') {
        const cNum = item.chapterId || (item.position && item.position.chapter) || 1;
        const sPos = (item.position && item.position.scroll) || 0;
        window.openWebnovelReader(item.seriesId, cNum, sPos);
        return;
      }

      // Cas 2 : Volume EPUB / PDF
      if (typeof window.openBookReader === 'function') {
        const bookPayload = {
          id: item.bookId || item.id,
          fileKey: item.bookId || item.id,
          seriesId: item.seriesId || '',
          title: item.title,
          cover: item.cover,
          format: format,
          location: item.position || item.location,
          chapterNumber: item.chapterId || item.volumeNumber || 1,
          volumeNumber: item.volumeNumber || 1
        };
        window.openBookReader(bookPayload);
      } else {
        // Redirection vers series.html si besoin
        if (item.seriesId) {
          window.location.href = `/series.html?id=${encodeURIComponent(item.seriesId)}`;
        }
      }
    };

    if (resumeBtn) resumeBtn.onclick = handleResume;
    if (innerWrap) {
      innerWrap.onclick = (e) => {
        if (!e.target.closest('#ntBtnDismissResume')) {
          handleResume();
        }
      };
    }
  }

  // Rendre la fonction accessible globalement pour les déclencheurs
  window.checkAndDisplayResumeBanner = checkAndDisplayResumeBanner;

  // =========================================================================
  // 4. HOOKS D'INITIALISATION
  // =========================================================================
  document.addEventListener('DOMContentLoaded', () => {
    // Délai pour laisser le temps à la page et IndexedDB de s'initialiser
    setTimeout(checkAndDisplayResumeBanner, 1200);

    // Écouter les changements d'authentification
    if (window.authManager && typeof window.authManager.onAuthStateChange === 'function') {
      window.authManager.onAuthStateChange(() => {
        setTimeout(checkAndDisplayResumeBanner, 1500);
      });
    }

    // Ré-évaluer quand l'utilisateur revient sur l'onglet
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        checkAndDisplayResumeBanner();
      }
    });
  });

})();
