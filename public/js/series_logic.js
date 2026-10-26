/**
 * series_logic.js - Interface Dédiée Fiche de Série & Volumes (NovelTrad)
 * Utilisée pour les séries de Ma Bibliothèque ET du Catalogue Public.
 */

document.addEventListener('DOMContentLoaded', async function() {
    // GUARD: only activate if a series ?id= is present in the URL.
    // Without this guard, seriesModule gets shown on every page (index.html, etc.).
    var params = new URLSearchParams(window.location.search);
    var seriesId = params.get('id');
    if (!seriesId && window.location.pathname.startsWith('/series/')) {
        var pathParts = window.location.pathname.split('/').filter(Boolean);
        if (pathParts.length >= 2 && pathParts[0] === 'series') {
            seriesId = decodeURIComponent(pathParts[1]);
        }
    }

    if (!seriesId) {
        // No series id — keep seriesModule hidden and bail out completely
        var sm = document.getElementById('seriesModule');
        if (sm) {
            sm.classList.add('hidden');
            sm.style.display = '';
        }
        return;
    }

    // We have a series id — reveal the module
    var seriesModule = document.getElementById('seriesModule');
    if (seriesModule) {
        seriesModule.classList.remove('hidden');
        seriesModule.style.display = 'block';
    }

    // Nav bindings
    function bindNavBtn(btnId, url) {
        var btn = document.getElementById(btnId);
        if (btn) {
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                window.location.href = url;
            });
        }
    }
    bindNavBtn('tabHomeBtn',       '/index.html');
    bindNavBtn('tabCatalogBtn',    '/index.html#catalog');
    bindNavBtn('tabLibraryBtn',    '/index.html#library');
    bindNavBtn('tabContinueBtn',   '/index.html#continue');
    bindNavBtn('tabFavoritesBtn',  '/index.html#favorites');
    bindNavBtn('tabReadingHistoryBtn', '/index.html#reading-history');
    bindNavBtn('historyBtn',       '/index.html#history');
    bindNavBtn('tabDocsBtn',       '/index.html#docs');
        bindNavBtn('btnBackToLibrary', '/index.html#library');
    initSubmitCatalogModal();

    try {
        var authHeaders = {};
        if (window.authManager) {
            if (window.authManager.initPromise) await window.authManager.initPromise;
            var token = await window.authManager.getAccessToken();
            if (token) authHeaders['Authorization'] = 'Bearer ' + token;
        }

        // Direct query: local library & catalog synchronization
        let data = null;
        if (seriesId && seriesId.startsWith('local_series_')) {
            if (window.libraryDB && typeof window.libraryDB.getLocalSeries === 'function') {
                const localSeries = await window.libraryDB.getLocalSeries(seriesId);
                if (localSeries && localSeries.volumes && localSeries.volumes.length > 0) {
                    await renderSeries(localSeries);
                    return;
                }
            }
        }

        var res = await fetch('/api/series/' + encodeURIComponent(seriesId), { headers: authHeaders });
        if (!res.ok) {
            res = await fetch('/api/catalog/series/' + encodeURIComponent(seriesId));
        }
        if (res.ok) {
            data = await res.json();
        }

        if (data && data.success && data.series) {
            await renderSeries(data.series);
        } else {
            // Repli vers IndexedDB si la série est un dossier connecté local
            if (window.libraryDB && typeof window.libraryDB.getLocalSeries === 'function') {
                const localSeries = await window.libraryDB.getLocalSeries(seriesId);
                if (localSeries && localSeries.volumes && localSeries.volumes.length > 0) {
                    await renderSeries(localSeries);
                    return;
                }
            }
            document.getElementById('seriesSynopsis').innerHTML = '<p style="color:var(--danger);">Série introuvable.</p>';
        }
    } catch (e) {
        console.error('Error fetching series', e);
        document.getElementById('seriesSynopsis').innerHTML = '<p style="color:var(--danger);">Erreur de connexion au serveur.</p>';
    }
});

async function renderSeries(series) {
    window.currentSeries = series;
    if (series.title) {
        document.title = series.title + ' - Light Novel en Français | NovelTrad';
        try {
          const descEl = document.getElementById('metaSeriesDescription') || document.querySelector('meta[name="description"]');
          const cleanDesc = (series.synopsis || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
          const shortDesc = cleanDesc.length > 155 ? (cleanDesc.substring(0, 152) + '...') : (cleanDesc || 'Lisez ' + series.title + ' en français sur NovelTrad.');
          if (descEl) descEl.setAttribute('content', shortDesc);
          
          const ogDesc = document.getElementById('ogSeriesDescription');
          if (ogDesc) ogDesc.setAttribute('content', shortDesc);
          const twDesc = document.getElementById('twSeriesDescription');
          if (twDesc) twDesc.setAttribute('content', shortDesc);
          
          const ogTitle = document.getElementById('ogSeriesTitle');
          if (ogTitle) ogTitle.setAttribute('content', series.title + ' | NovelTrad');
          const twTitle = document.getElementById('twSeriesTitle');
          if (twTitle) twTitle.setAttribute('content', series.title + ' | NovelTrad');

          // Dynamically enrich Schema.org with Book metadata for Google rich results
          const jsonLdTag = document.getElementById('jsonLdSeries');
          if (jsonLdTag) {
            jsonLdTag.textContent = JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Book",
              "name": series.title,
              "url": window.location.href,
              "description": shortDesc,
              "inLanguage": "fr",
              "image": series.cover || "https://novel-trad.online/icons/icon-512x512.png",
              "publisher": {
                "@type": "Organization",
                "name": "NovelTrad",
                "alternateName": ["novel-trad", "NovelTrad Online"],
                "url": "https://novel-trad.online/"
              }
            });
          }
        } catch(e) {}
    }
    document.getElementById('seriesTitle').textContent = series.title;
    checkAndRenderCatalogStatus(series);

    // --- Cover & Banner ---
    var firstVol = series.volumes && series.volumes.length > 0 ? series.volumes[0] : null;
    var coverUrl = series.cover || (series.metadata && series.metadata.cover) || '';
    if (!coverUrl && firstVol) {
        if (firstVol.cover || firstVol.cover_url) {
            coverUrl = firstVol.cover || firstVol.cover_url;
        } else if (firstVol.id) {
            coverUrl = '/api/download-job/' + encodeURIComponent(firstVol.id) + '/cover';
        }
    }

    var seriesCoverEl = document.getElementById('seriesCover');
    var seriesBannerEl = document.getElementById('seriesBanner');

    if (seriesCoverEl) {
        seriesCoverEl.src = coverUrl;
        seriesCoverEl.onerror = function() {
            this.onerror = null;
            this.src = 'https://placehold.co/400x600/18181b/ffffff?text=' + encodeURIComponent(series.title);
        };

        if (firstVol && firstVol.format === 'pdf' && typeof window.generatePdfCoverDataUrl === 'function') {
            window.generatePdfCoverDataUrl(firstVol.id).then(function(dataUrl) {
                if (dataUrl && seriesCoverEl.isConnected) {
                    seriesCoverEl.src = dataUrl;
                    if (seriesBannerEl) {
                        var currentBg = seriesBannerEl.querySelector('.series-banner-bg');
                        if (currentBg && !currentBg.classList.contains('is-wide')) {
                            currentBg.style.backgroundImage = "url('" + dataUrl + "')";
                        }
                    }
                }
            }).catch(function() {});
        }
    }

    // Banner (Seamless Full-Width Atmospheric Hero - Style AniList / Crunchyroll)
    if (seriesBannerEl) {
        var rawBanner = String(series.banner || (series.metadata && series.metadata.banner) || '');
        var effectiveCover = coverUrl || series.cover || (series.metadata && series.metadata.cover) || '';
        
        // Vraie bannière panoramique : différente de la jaquette et pas un asset portrait (/cover/)
        var isRealWide = Boolean(
            rawBanner && 
            rawBanner !== effectiveCover && 
            !rawBanner.includes('/cover/large/') && 
            !rawBanner.includes('/cover/medium/') &&
            !rawBanner.includes('/covers/')
        );
        
        var bannerImg = isRealWide ? rawBanner : effectiveCover;
        
        seriesBannerEl.innerHTML = '';
        var bgDiv = document.createElement('div');
        bgDiv.className = 'series-banner-bg ' + (isRealWide ? 'is-wide' : 'is-ambient-glow');
        if (bannerImg) {
            bgDiv.style.backgroundImage = "url('" + bannerImg.replace(/'/g, "\\'") + "')";
        }
        seriesBannerEl.appendChild(bgDiv);
        
        var overlayDiv = document.createElement('div');
        overlayDiv.className = 'series-banner-overlay';
        seriesBannerEl.appendChild(overlayDiv);
    }
    // Author & Status
    var author = (series.author && series.author !== 'null') ? series.author : ((series.metadata && series.metadata.author) || 'Inconnu');
    var status = (series.status_fr && series.status_fr !== 'null' && series.status_fr !== 'undefined') ? series.status_fr : ((series.metadata && (series.metadata.status_fr || series.metadata.status)) || series.status || 'En cours');
    var authorEl = document.getElementById('seriesAuthor');
    if (authorEl) authorEl.textContent = author;

    // Status avec pastille indicateur moderne
    var statusEl = document.getElementById('seriesStatus');
    if (statusEl) {
      var isCompleted = /termin|complete/i.test(status);
      var dotClass = isCompleted ? 'completed' : 'ongoing';
      statusEl.innerHTML = '<span class="status-indicator-dot ' + dotClass + '"></span><span id="seriesStatusText">' + status + '</span>';
    }

    var elVolCount = document.getElementById('seriesVolCount');
    if (series.is_original) {
      // 1. Marque-page sur la couverture
      var coverWrap = document.querySelector('.series-page-cover-wrap');
      if (coverWrap && !coverWrap.querySelector('.card-bookmark-ribbon')) {
        var ribbon = document.createElement('div');
        ribbon.className = 'card-bookmark-ribbon';
        ribbon.title = 'Création Originale';
        ribbon.innerHTML = '<i class="fa-solid fa-feather-pointed"></i><span>ORIGINAL</span>';
        coverWrap.appendChild(ribbon);
      }

      // 2. Badge certifié dans les métadonnées de l'en-tête
      var catalogBadgeContainer = document.getElementById('seriesCatalogBadge');
      if (catalogBadgeContainer && !document.getElementById('badgeSeriesOriginalCreation')) {
        var origPill = document.createElement('span');
        origPill.id = 'badgeSeriesOriginalCreation';
        origPill.className = 'series-badge-original-creation';
        origPill.innerHTML = '<i class="fa-solid fa-feather-pointed"></i> Création Originale';
        catalogBadgeContainer.appendChild(origPill);
      }
    }

    if (series.allow_download === false) {
      var headerActions = document.querySelector('.series-actions') || document.querySelector('.series-meta-row');
      var existingExcl = document.getElementById('badgeSeriesExclusiveOnline');
      if (!existingExcl && headerActions) {
        var exclPill = document.createElement('span');
        exclPill.id = 'badgeSeriesExclusiveOnline';
        exclPill.className = 'series-badge-exclusive';
        exclPill.innerHTML = '<i class="fa-solid fa-lock"></i> Lecture en ligne exclusive';
        headerActions.appendChild(exclPill);
      }
    }
    if (elVolCount) {
      var isChap = series.unit_type === 'chapter';
      var vCount = (Array.isArray(series.volumes) && series.volumes.length > 0) ? series.volumes.length : (series.volume_count || 1);
      var unitText = isChap ? 'Chapitre' : 'Volume';
      elVolCount.textContent = vCount + ' ' + unitText + (vCount > 1 ? 's' : '');
    }

    // Sous-titre éditorial alternatif (Romaji / Original)
    // --- Titre alternatif masqué sur l'interface série (réservé en interne pour le rollback de recherche) ---
    var subTitleEl = document.getElementById('seriesSubtitle');
    if (subTitleEl) {
      subTitleEl.textContent = '';
      subTitleEl.classList.add('hidden');
    }



    // Illustrateur (si présent)
    var illu = series.illustrator || (series.metadata && series.metadata.illustrator) || '';
    var illuItem = document.getElementById('seriesIllustratorItem');
    var illuEl = document.getElementById('seriesIllustrator');
    if (illuItem && illuEl) {
      if (illu && illu !== 'null' && illu.trim()) {
        illuEl.textContent = illu.trim();
        illuItem.classList.remove('hidden');
      } else {
        illuItem.classList.add('hidden');
      }
    }

    // Ambient glow sous la couverture (dérivé de la cover)
    var coverGlow = document.getElementById('seriesCoverGlow');
    if (coverGlow && coverUrl) {
      coverGlow.style.backgroundImage = 'url("' + coverUrl.replace(/"/g, '\\"') + '")';
    }

    // Télémétrie invisible des lectures en coulisses (anti-spam par session)
    try {
      var silentViewKey = 'nt_silent_view_' + series.id;
      if (!sessionStorage.getItem(silentViewKey)) {
        sessionStorage.setItem(silentViewKey, '1');
        fetch('/api/catalog/series/' + encodeURIComponent(series.id) + '/view', { method: 'POST' }).catch(function() {});
      }
    } catch(e) {}

    // Synopsis
    var synopsisEl = document.getElementById('seriesSynopsis');
    var syn = series.synopsis_fr || (series.metadata && series.metadata.synopsis_fr) || series.synopsis || (series.metadata && series.metadata.synopsis) || '';
    if (syn) {
        synopsisEl.innerHTML = '<p>' + syn + '</p>';
    } else {
        synopsisEl.innerHTML = '<p>Recherche du synopsis...</p>';
    }

    // Tags / Genres
    var tagsContainer = document.getElementById('seriesTags');
    if (tagsContainer) {
        tagsContainer.innerHTML = '';
        var genresList = series.genres_fr || (series.metadata && series.metadata.genres_fr) || series.genres || (series.metadata && series.metadata.genres) || [];
        if (genresList.length > 0) {
            genresList.forEach(function(g) {
                var span = document.createElement('span');
                span.className = 'series-tag';
                span.textContent = g;
                tagsContainer.appendChild(span);
            });
        }
    }

    // Action buttons in series meta (Ajouter à ma bibliothèque + Lecture intelligente + Partager)
    var metaContainer = document.querySelector('.series-page-meta');
    if (metaContainer && !document.getElementById('seriesPageActions')) {
        var actionsDiv = document.createElement('div');
        actionsDiv.id = 'seriesPageActions';
        actionsDiv.className = 'series-page-actions';
        actionsDiv.style.cssText = 'display:flex; gap:12px; margin-top:16px; flex-wrap:wrap; align-items:center;';

        var isWebnovel = series.type === 'webnovel' || (series.chapters && series.chapters.length > 0);
        var isChapMode = series.unit_type === 'chapter' || isWebnovel;
        var unitWord = isChapMode ? 'Chapitre' : 'Volume';
        var readBtnLabel = 'Lire le ' + unitWord + ' 1';

        // Détection de progression existante (Lecture intelligente)
        var lastReadBook = null;
        try {
            if (window.libraryDB && typeof window.libraryDB.getAllHistory === 'function') {
                var hist = await window.libraryDB.getAllHistory();
                if (Array.isArray(hist) && hist.length > 0) {
                    lastReadBook = hist.find(function(h) {
                        return (h.seriesId && h.seriesId === series.id) ||
                               (h.series_id && h.series_id === series.id) ||
                               (h.bookId && h.bookId.startsWith(series.id + '_')) ||
                               (h.id && h.id.startsWith(series.id + '_'));
                    });
                }
            }
        } catch(eHist) {}

        var resumeVolNum = lastReadBook ? (lastReadBook.volumeNumber || lastReadBook.volume_number || 1) : 1;
        var resumeProgress = lastReadBook ? Math.round(lastReadBook.progress || 0) : 0;
        var hasResume = Boolean(lastReadBook && (resumeVolNum > 1 || resumeProgress > 0));

        var primaryBtnHtml = '';
        if (hasResume) {
            primaryBtnHtml = `
                <button id="btnSeriesQuickRead" class="btn-series-hero-primary is-resume" type="button" title="Reprendre votre lecture en cours">
                    <i class="fa-solid fa-play"></i>
                    <div class="btn-resume-content">
                        <span class="btn-resume-label">Reprendre : ${unitWord} ${resumeVolNum}</span>
                        <span class="btn-resume-sub">${resumeProgress > 0 ? resumeProgress + '% lu' : 'En cours'}</span>
                    </div>
                </button>
                <button id="btnSeriesRestart" class="btn-series-hero-restart" type="button" title="Recommencer depuis le début (${unitWord} 1)">
                    <i class="fa-solid fa-rotate-left"></i>
                </button>
            `;
        } else {
            primaryBtnHtml = `
                <button id="btnSeriesQuickRead" class="btn-series-hero-primary" type="button">
                    <i class="fa-solid fa-book-open-reader"></i> <span>${readBtnLabel}</span>
                </button>
            `;
        }

        actionsDiv.innerHTML = `
            ${primaryBtnHtml}
            <button id="btnSeriesBookmark" class="btn-series-hero-secondary" type="button">
                <i class="fa-solid fa-bookmark"></i> <span>Ajouter à ma bibliothèque</span>
            </button>
            <button id="btnSeriesShare" class="btn-series-hero-secondary btn-share" type="button" title="Partager cette œuvre">
                <i class="fa-solid fa-share-nodes"></i> <span>Partager</span>
            </button>
        `;

        // Interactive bookmark button state
        var bookmarkBtn = actionsDiv.querySelector('#btnSeriesBookmark');
        if (bookmarkBtn && window.libraryDB) {
            window.libraryDB.isInLocalLibrary(series.id).then(function(inLib) {
                if (inLib) {
                    bookmarkBtn.classList.add('in-library');
                    bookmarkBtn.innerHTML = '<i class="fa-solid fa-check"></i> <span>Dans ma bibliothèque</span>';
                }
            }).catch(function() {});

            bookmarkBtn.onclick = async function(e) {
                e.stopPropagation();

                // Restriction Incitative Invité : connexion requise pour sauvegarder dans la bibliothèque
                var auth = window.authManager || window.supabaseAuthManager;
                var isLogged = Boolean(auth?.currentUser);

                if (!isLogged) {
                    if (auth && typeof auth.showToast === 'function') {
                        auth.showToast('Connectez-vous pour ajouter « ' + (series.title || 'ce roman') + ' » à votre bibliothèque personnelle !');
                    }
                    if (typeof window.openAuthModal === 'function') {
                        window.openAuthModal('login');
                    } else if (auth && typeof auth.openModal === 'function') {
                        auth.openModal('login');
                    } else {
                        var authModal = document.getElementById('authModal');
                        if (authModal) {
                            authModal.classList.remove('hidden');
                            authModal.style.display = 'flex';
                        }
                    }
                    return;
                }

                try {
                    var inLib = await window.libraryDB.isInLocalLibrary(series.id);
                    if (inLib) {
                        await window.libraryDB.removeFromLocalLibrary(series.id);
                        bookmarkBtn.classList.remove('in-library');
                        bookmarkBtn.innerHTML = '<i class="fa-solid fa-bookmark"></i> <span>Ajouter à ma bibliothèque</span>';
                        if (window.authManager && window.authManager.showToast) {
                            window.authManager.showToast('Roman retiré de votre bibliothèque.');
                        }
                    } else {
                        await window.libraryDB.addToLocalLibrary({
                            id: series.id,
                            seriesId: series.id,
                            title: series.title,
                            cover: coverUrl || series.cover || (series.metadata && series.metadata.cover) || '',
                            author: author || series.author || 'Roman / Light Novel',
                            genres: series.genres_fr || series.genres || [],
                            synopsis: syn || series.synopsis_fr || series.synopsis || '',
                            volumes: series.volumes || [],
                            format: 'epub'
                        });
                        bookmarkBtn.classList.add('in-library');
                        bookmarkBtn.innerHTML = '<i class="fa-solid fa-check"></i> <span>Dans ma bibliothèque</span>';
                        if (window.authManager && window.authManager.showToast) {
                            window.authManager.showToast('Roman ajouté à votre bibliothèque !');
                        }
                    }
                    if (typeof window.initLibrary === 'function') {
                        window.initLibrary(true);
                    } else if (typeof updateLibraryStats === 'function') {
                        updateLibraryStats();
                    }
                } catch(err) {
                    console.warn('[SeriesBookmark]', err);
                }
            };
        }

        metaContainer.appendChild(actionsDiv);

        // Bind Quick Read
        document.getElementById('btnSeriesQuickRead').onclick = function() {
            if (hasResume && lastReadBook) {
                // Ouvrir directement le tome en cours de lecture
                if (typeof window.openBookReader === 'function') {
                    window.openBookReader(lastReadBook);
                    return;
                }
            }
            quickStartReadingSeries(series);
        };

        // Bind Recommencer depuis le début
        var restartBtn = document.getElementById('btnSeriesRestart');
        if (restartBtn) {
            restartBtn.onclick = function() {
                quickStartReadingSeries(series);
            };
        }

        // Bind Bouton Partager
        var shareBtn = document.getElementById('btnSeriesShare');
        if (shareBtn) {
            shareBtn.onclick = async function() {
                var shareUrl = window.location.href;
                var shareTitle = (series.title || 'NovelTrad') + ' - Light Novel VF';
                var shareText = 'Découvrez ' + (series.title || 'ce roman') + ' en lecture libre sur NovelTrad !';

                if (navigator.share) {
                    try {
                        await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
                        return;
                    } catch(e) {}
                }

                // Fallback copie presse-papier
                try {
                    await navigator.clipboard.writeText(shareUrl);
                    if (window.authManager && typeof window.authManager.showToast === 'function') {
                        window.authManager.showToast('Lien du roman copié dans le presse-papier !');
                    } else {
                        var toast = document.getElementById('seriesToast');
                        if (toast) {
                            toast.textContent = 'Lien copié dans le presse-papier !';
                            toast.classList.add('show');
                            setTimeout(function() { toast.classList.remove('show'); }, 2500);
                        }
                    }
                } catch(err) {
                    prompt('Copiez ce lien :', shareUrl);
                }
            };
        }

// Bookmark handler cleanly handled above with Auth protection
    }

    // === VOLUMES OR CHAPTERS SECTION ===
    var isWebnovel = series.type === 'webnovel' || (series.chapters && series.chapters.length > 0);
    var volumesSection = document.querySelector('.series-volumes-section');

    if (volumesSection) {
        if (isWebnovel) {
            // WEBNOVEL CHAPTERS LIST
            volumesSection.innerHTML = `
                <h3>Chapitres Disponibles (${(series.chapters || []).length})</h3>
                <div class="sheet-chapters-list" id="seriesChaptersList" style="margin-top:16px;">
                    ${(series.chapters || []).map(function(ch) {
                        return `
                            <div class="sheet-chapter-row" data-series="${series.id}" data-chapter="${ch.chapterNumber}">
                                <div class="sheet-chapter-info">
                                    <span class="sheet-chapter-num">Ch. ${ch.chapterNumber}</span>
                                    <span class="sheet-chapter-name">${ch.title}</span>
                                </div>
                                <button class="btn btn-sm btn-primary btn-read-chapter"><i class="fa-solid fa-book-open"></i> Lire</button>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;

            // Bind chapter clicks
            volumesSection.querySelectorAll('.sheet-chapter-row').forEach(function(row) {
                row.querySelector('.btn-read-chapter').onclick = function() {
                    var sid = row.getAttribute('data-series');
                    var cnum = row.getAttribute('data-chapter');
                    if (typeof window.openWebnovelReader === 'function') {
                        window.openWebnovelReader(sid, cnum);
                    }
                };
            });

        } else {
            // LIGHT NOVEL VOLUMES GRID AVEC SUPPORT DES TYPES DE VOLUMES
            var allVols = series.volumes || [];

            // Tri chronologique sécurisé des tomes
            var parseVolSort = function(v) {
                if (v.sort_order !== undefined) return Number(v.sort_order);
                var numStr = String(v.volume_number || v.volumeNumber || v.number || 1).trim().replace(',', '.');
                var partMatch = numStr.match(/(\d+(?:\.\d+)?)\s*(?:part(?:ie)?|pt|p|\-|\/)\s*(\d+)/i);
                if (partMatch) {
                    return parseFloat(partMatch[1]) + (parseFloat(partMatch[2]) / 100);
                }
                var floatMatch = numStr.match(/\d+(?:\.\d+)?/);
                return floatMatch ? parseFloat(floatMatch[0]) : 1;
            };
            allVols.sort(function(a, b) { return parseVolSort(a) - parseVolSort(b); });

            var mainVols = allVols.filter(function(v) {
                var t = (v.volume_type || 'main').toLowerCase();
                return t === 'main' || t === 'canon';
            });
            var sideVols = allVols.filter(function(v) {
                var t = (v.volume_type || '').toLowerCase();
                return t === 'side_story' || t === 'spinoff' || t === 'alternative';
            });

            var tabsHtml = '';
            if (sideVols.length > 0) {
                tabsHtml = `
                    <div class="series-volume-filter-tabs">
                        <button class="vol-filter-tab active" data-filter="all">Tous les volumes (${allVols.length})</button>
                        <button class="vol-filter-tab" data-filter="main">Histoire Principale (${mainVols.length})</button>
                        <button class="vol-filter-tab" data-filter="side">Hors-séries & Spin-offs (${sideVols.length})</button>
                    </div>
                `;
            }

            var showVolToolbar = allVols.length >= 6;
            var volToolbarHtml = showVolToolbar ? `
                <div class="series-volumes-toolbar">
                    <div class="vol-search-input-wrap">
                        <i class="fa-solid fa-magnifying-glass"></i>
                        <input type="text" id="inputVolSearch" class="vol-search-input" placeholder="Filtrer..." autocomplete="off">
                    </div>
                    <button type="button" id="btnToggleSortVols" class="btn-vol-sort" title="Inverser l'ordre des tomes">
                        <i class="fa-solid fa-arrow-down-1-9" id="iconSortVols"></i>
                    </button>
                </div>
            ` : '';

            volumesSection.innerHTML = `
                <div class="series-volumes-header">
                    <div class="series-volumes-title-group">
                        <h3>${series.unit_type === 'chapter' ? 'Chapitres disponibles' : 'Volumes disponibles'} (${allVols.length})</h3>
                        ${tabsHtml}
                    </div>
                    ${volToolbarHtml}
                </div>
                <div class="series-volumes-grid" id="seriesVolumesGrid"></div>
            `;

            var volumesGrid = document.getElementById('seriesVolumesGrid');
            
            // Wiring unifié du filtrage et recherche rapide de tomes
            var currentTabFilter = 'all';

            function applyVolumeFilters() {
                var q = (inputSearch ? inputSearch.value || '' : '').trim().toLowerCase();
                var cleanQ = q.replace(/^(?:tome|volume|vol|chapitre|chap|t|v)\.?\s*/i, '').trim();
                var cards = volumesGrid.querySelectorAll('.volume-card');
                var visibleCount = 0;

                cards.forEach(function(card) {
                    var type = (card.getAttribute('data-volume-type') || 'main').toLowerCase();
                    var title = (card.querySelector('.volume-title')?.textContent || '').toLowerCase();
                    var num = String(card.getAttribute('data-vol-num') || '').toLowerCase();

                    // Filtrage par onglet (Tous / Principal / Hors-séries)
                    var matchesTab = true;
                    if (currentTabFilter === 'main') {
                        matchesTab = (type === 'main' || type === 'canon');
                    } else if (currentTabFilter === 'side') {
                        matchesTab = (type !== 'main' && type !== 'canon');
                    }

                    // Filtrage par recherche texte
                    var matchesSearch = true;
                    if (q) {
                        matchesSearch = title.includes(q) || 
                                        num === q || 
                                        (cleanQ && num === cleanQ) ||
                                        ('volume ' + num).includes(q) || 
                                        ('tome ' + num).includes(q) ||
                                        ('chapitre ' + num).includes(q) ||
                                        (cleanQ && title.includes(cleanQ));
                    }

                    var isVisible = matchesTab && matchesSearch;
                    card.classList.toggle('vol-card-hidden', !isVisible);
                    if (isVisible) visibleCount++;
                });

                // Message d'état si aucun résultat
                var emptyMsg = volumesGrid.querySelector('.vol-search-empty-msg');
                if (visibleCount === 0) {
                    if (!emptyMsg) {
                        emptyMsg = document.createElement('div');
                        emptyMsg.className = 'vol-search-empty-msg';
                        emptyMsg.style.cssText = 'grid-column: 1 / -1; padding: 36px 20px; text-align: center; color: var(--text-secondary); font-size: 14px;';
                        emptyMsg.innerHTML = '<i class="fa-solid fa-magnifying-glass" style="margin-bottom: 8px; font-size: 22px; opacity: 0.5; display:block;"></i> Aucun volume ne correspond à votre recherche.';
                        volumesGrid.appendChild(emptyMsg);
                    }
                    emptyMsg.style.display = 'block';
                } else if (emptyMsg) {
                    emptyMsg.style.display = 'none';
                }
            }

            var inputSearch = volumesSection.querySelector('#inputVolSearch');
            if (inputSearch) {
                inputSearch.addEventListener('input', applyVolumeFilters);
                inputSearch.addEventListener('keydown', function(e) {
                    if (e.key === 'Escape') {
                        this.value = '';
                        applyVolumeFilters();
                    }
                });
            }

            // Wiring de l'inversion de l'ordre de tri (Tome 1->N ou N->1)
            var btnSort = volumesSection.querySelector('#btnToggleSortVols');
            var isAscending = true;
            if (btnSort) {
                btnSort.addEventListener('click', function() {
                    isAscending = !isAscending;
                    var icon = document.getElementById('iconSortVols');
                    if (icon) {
                        icon.className = isAscending ? 'fa-solid fa-arrow-down-1-9' : 'fa-solid fa-arrow-down-9-1';
                    }
                    var cards = Array.from(volumesGrid.querySelectorAll('.volume-card'));
                    cards.reverse().forEach(function(card) {
                        volumesGrid.appendChild(card);
                    });
                });
            }

            // Wiring des onglets de filtrage
            var filterTabs = volumesSection.querySelectorAll('.vol-filter-tab');
            if (filterTabs.length > 0) {
                filterTabs.forEach(function(tab) {
                    tab.addEventListener('click', function() {
                        filterTabs.forEach(function(t) { t.classList.remove('active'); });
                        this.classList.add('active');
                        currentTabFilter = this.getAttribute('data-filter') || 'all';
                        applyVolumeFilters();
                    });
                });
            }

            // Préchargement intelligent en arrière-plan du Volume 1 (ou premier volume disponible)
            if (typeof window.prefetchBook === 'function' && Array.isArray(series.volumes) && series.volumes.length > 0) {
                setTimeout(function() {
                    try {
                        var firstVolume = series.volumes[0];
                        window.prefetchBook(firstVolume);
                    } catch(e) {}
                }, 1500);
            }

            if (volumesGrid && series.volumes) {
                series.volumes.forEach(function(vol) {
                    var volNum = vol.volume_number || vol.number || vol.volumeNumber || 1;
                    var formatStr = (vol.format || vol.file_type || (vol.filename ? vol.filename.split('.').pop() : (vol.file_name ? vol.file_name.split('.').pop() : 'epub'))).toLowerCase();
                    var isPdf = formatStr === 'pdf';
                    var volCard = document.createElement('div');
                    volCard.className = 'volume-card';

                    // Direct cover resolution: extracted cover -> novel cover -> placeholder
                    var volCoverUrl = vol.cover || vol.cover_url || vol.coverUrl;
                    if (!volCoverUrl && vol.id && !vol.id.includes('_vol_') && !vol.id.startsWith('local_')) {
                        volCoverUrl = '/api/download-job/' + encodeURIComponent(vol.id) + '/cover';
                    }
                    if (!volCoverUrl) {
                        volCoverUrl = series.cover || (series.metadata && series.metadata.cover) || '';
                    }

                    var progressPct = vol.progress || 0;
                    var progressHtml = progressPct > 0
                        ? '<div class="volume-progress-bar"><div class="volume-progress-fill" style="width:' + progressPct + '%;"></div></div>'
                        : '';

                    var isChapMode = series.unit_type === 'chapter';
                    var labelText = vol.title || ((isChapMode ? 'Chapitre ' : 'Volume ') + volNum);
                    if (isChapMode && labelText.toLowerCase().startsWith('volume ')) {
                        labelText = labelText.replace(/^volume\s+/i, 'Chapitre ');
                    }

                    var volType = (vol.volume_type || 'main').toLowerCase();
                    volCard.className = 'volume-card modern-vol-card';
                    volCard.setAttribute('data-vol-num', volNum);
                    volCard.setAttribute('data-volume-type', volType);

                    var badgeRowHtml = '';
                    var badgesHtml = '';
                    if (volType === 'spinoff') {
                        badgesHtml += '<span class="volume-pill-tag spinoff">Spin-off</span>';
                    } else if (volType === 'side_story') {
                        badgesHtml += '<span class="volume-pill-tag sidestory">Hors-série</span>';
                    }
                    if (progressPct > 0) {
                        badgesHtml += '<span class="volume-pct-tag"><i class="fa-regular fa-bookmark"></i> ' + progressPct + '%</span>';
                    }
                    if (badgesHtml) {
                        badgeRowHtml = '<div class="volume-badge-row">' + badgesHtml + '</div>';
                    }

                    volCard.innerHTML = `
                        <div class="volume-cover-wrap">
                            <div class="volume-book-spine"></div>
                            <img src="${volCoverUrl}" alt="${labelText.replace(/"/g, '&quot;')}" class="volume-cover" loading="lazy" decoding="async" onload="this.classList.add('loaded')">
                            <div class="volume-glass-overlay"></div>
                            <div class="volume-hover-action">
                                <button class="btn-read-volume" type="button" aria-label="Lire">
                                    <i class="fa-solid fa-book-open-reader"></i>
                                    <span>Lire</span>
                                </button>
                            </div>
                            ${progressHtml}
                        </div>
                        <div class="volume-info">
                            ${badgeRowHtml}
                            <div class="volume-title" title="${labelText.replace(/"/g, '&quot;')}">${labelText}</div>

                        </div>
                    `;

                    var imgEl = volCard.querySelector('.volume-cover');
                    imgEl.onerror = function() {
                        this.onerror = null;
                        if (series.cover && series.cover !== this.src) {
                            this.src = series.cover;
                        } else {
                            this.src = 'https://placehold.co/200x300/18181b/ffffff?text=Volume+' + volNum;
                        }
                    };

                    // Click -> Open standard reader with complete file & metadata context
                    volCard.addEventListener('click', function() {
                        var rawPath = vol.file_path || vol.filePath || '';
                        var fileKey = rawPath.replace(/^.*[\/\\]/, '').replace(/\.(epub|pdf)$/i, '');
                        var bookPayload = {
                            ...vol,
                            id: vol.id || (`${series.id}_vol_${volNum}`),
                            title: `${series.title} - ${labelText}`,
                            seriesId: series.id,
                            volumeNumber: volNum,
                            fileKey: fileKey,
                            format: isPdf ? 'pdf' : 'epub',
                            allow_download: (series.allow_download !== false),
                            file_path: vol.file_path || vol.filePath,
                            filePath: vol.file_path || vol.filePath,
                            fullPath: vol.fullPath || null,
                            cover: volCoverUrl || vol.cover || series.cover,
                            isLocalFsBook: vol.isLocalFsBook || series.isLocalFsSeries || (vol.id && vol.id.startsWith('local_'))
                        };

                        if (typeof window.openBookReader === 'function') {
                            window.openBookReader(bookPayload);
                        } else if (typeof window.openPdfReader === 'function') {
                            window.openPdfReader(bookPayload);
                        }
                    });

                    volumesGrid.appendChild(volCard);
                });
            }
        }
    }

    // Fetch AniList/Cascade metadata if synopsis is still missing
    if (!series.synopsis_fr && (!series.metadata || !series.metadata.synopsis_fr)) {
        try {
            var metaRes = await fetch('/api/series/' + encodeURIComponent(series.id) + '/metadata?title=' + encodeURIComponent(series.title));
            var metaData = await metaRes.json();
            if (metaData.success && metaData.metadata) {
                series.metadata = metaData.metadata;
                await renderSeries(series);
            }
        } catch (e) {
            console.error('Failed to fetch series metadata', e);
        }
    }

    // Rendu dynamique de la section "Vous aimerez aussi"
    renderSeriesRecommendations(series);
}

/**
 * Rendu épuré des recommandations de séries similaires
 */
async function renderSeriesRecommendations(currentSeries) {
    var recSection = document.getElementById('seriesRecommendationsSection');
    var recGrid = document.getElementById('seriesRecommendationsGrid');
    if (!recSection || !recGrid || !currentSeries) return;

    try {
        var isMature = (currentSeries.is_mature === true);
        var catalogData = null;

        if (isMature) {
            var res = await fetch('/api/catalog?mature=true');
            if (res.ok) {
                var json = await res.json();
                catalogData = json.novels || json.series || [];
            }
        } else {
            if (typeof window.allBooks !== 'undefined' && Array.isArray(window.allBooks) && window.allBooks.length > 0) {
                catalogData = window.allBooks.filter(function(s) { return s && s.is_mature !== true; });
            } else {
                var res = await fetch('/api/catalog');
                if (res.ok) {
                    var json = await res.json();
                    catalogData = json.novels || json.series || [];
                }
            }
        }

        var currentId = String(currentSeries.id || '').toLowerCase();
        var currentGenres = (currentSeries.genres_fr || currentSeries.genres || []).map(function(g) { 
            return String(g).trim().toLowerCase(); 
        });

        // Filtrer pour exclure la série actuelle ET respecter le cloisonnement mature / tout-public
        var candidates = (Array.isArray(catalogData) ? catalogData : []).filter(function(s) { 
            if (!s || String(s.id || '').toLowerCase() === currentId) return false;
            return isMature ? (s.is_mature === true) : (s.is_mature !== true);
        });

        if (candidates.length === 0) {
            if (isMature) {
                recGrid.innerHTML = `
                    <div style="grid-column: 1 / -1; background: linear-gradient(135deg, rgba(225, 29, 72, 0.08) 0%, rgba(10, 10, 20, 0.6) 100%); border: 1px solid rgba(225, 29, 72, 0.25); border-radius: 14px; padding: 28px 24px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                        <div style="width: 46px; height: 46px; border-radius: 50%; background: rgba(225, 29, 72, 0.15); color: #f43f5e; display: inline-flex; align-items: center; justify-content: center; font-size: 20px; margin-bottom: 12px; border: 1px solid rgba(225, 29, 72, 0.3);">
                            <i class="fa-solid fa-fire"></i>
                        </div>
                        <h4 style="color: #ffffff; font-family: Outfit, sans-serif; font-size: 1.15rem; font-weight: 700; margin-bottom: 6px;">Vous avez dévoré cette œuvre ?</h4>
                        <p style="color: #94a3b8; font-size: 0.9rem; max-width: 480px; margin: 0 auto 16px; line-height: 1.5;">D'autres récits sombres et exclusifs pour public averti sont actuellement en cours de préparation par la communauté.</p>
                        <a href="/mature.html" style="display: inline-flex; align-items: center; gap: 8px; background: #e11d48; color: #ffffff; text-decoration: none; padding: 9px 18px; border-radius: 9999px; font-weight: 700; font-size: 0.85rem; box-shadow: 0 2px 10px rgba(225,29,72,0.4); transition: transform 0.2s ease;">
                            <i class="fa-solid fa-fire"></i> Revenir au Classement Mature (+18)
                        </a>
                    </div>
                `;
                recSection.classList.remove('hidden');
                recSection.style.display = 'block';
            } else {
                recSection.classList.add('hidden');
            }
            return;
        }

        // Attribution d'un score de similarité selon les genres communs
        candidates.forEach(function(s) {
            var gList = (s.genres_fr || s.genres || []).map(function(g) { 
                return String(g).trim().toLowerCase(); 
            });
            var matches = 0;
            if (currentGenres.length > 0) {
                matches = gList.filter(function(g) { return currentGenres.includes(g); }).length;
            }
            s._matchScore = matches;
        });

        // Tri par pertinence (score élevé en premier), puis par nombre de tomes
        candidates.sort(function(a, b) { 
            if ((b._matchScore || 0) !== (a._matchScore || 0)) {
                return (b._matchScore || 0) - (a._matchScore || 0);
            }
            var countA = (Array.isArray(a.volumes) && a.volumes.length > 0) ? a.volumes.length : (a.volume_count || 1);
            var countB = (Array.isArray(b.volumes) && b.volumes.length > 0) ? b.volumes.length : (b.volume_count || 1);
            return countB - countA;
        });

        var topRecs = candidates.slice(0, 6);

        if (topRecs.length === 0) {
            recSection.classList.add('hidden');
            return;
        }

        recGrid.innerHTML = topRecs.map(function(rec) {
            var rTitle = (rec.title || 'Roman').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            var rCover = rec.cover || (rec.metadata && rec.metadata.cover) || '';
            var rGenre = (rec.genres_fr && rec.genres_fr[0]) || (rec.genres && rec.genres[0]) || (isMature ? 'Mature +18' : 'Light Novel');
            var rCount = (Array.isArray(rec.volumes) && rec.volumes.length > 0) ? rec.volumes.length : (rec.volume_count || 1);
            var isChap = rec.unit_type === 'chapter';
            var countLabel = rCount + ' ' + (isChap ? (rCount > 1 ? 'Chapitres' : 'Chapitre') : (rCount > 1 ? 'Volumes' : 'Volume'));
            var recUrl = 'series.html?id=' + encodeURIComponent(rec.id);

            return `
                <a href="${recUrl}" class="recom-card">
                    <div class="recom-cover-wrap">
                        <img src="${rCover}" alt="${rTitle}" class="recom-cover" loading="lazy">
                        <span class="recom-badge">${countLabel}</span>
                    </div>
                    <div class="recom-info">
                        <span class="recom-genre">${rGenre}</span>
                        <h4 class="recom-title" title="${rTitle}">${rTitle}</h4>
                    </div>
                </a>
            `;
        }).join('');

        // Attachement sécurisé du fallback d'image en JavaScript
        recGrid.querySelectorAll('.recom-cover').forEach(function(img) {
            img.onerror = function() {
                this.onerror = null;
                this.src = 'https://placehold.co/200x300/18181b/ffffff?text=NovelTrad';
            };
        });

        recSection.classList.remove('hidden');
        recSection.style.display = 'block';
    } catch(err) {
        console.warn('[Recommendations] Non-blocking warning:', err);
        recSection.classList.add('hidden');
    }
}

function quickStartReadingSeries(series) {
    var isWebnovel = series.type === 'webnovel' || (series.chapters && series.chapters.length > 0);
    if (isWebnovel) {
        if (typeof window.openWebnovelReader === 'function') {
            window.openWebnovelReader(series.id, 1);
        }
    } else {
        var firstVol = (series.volumes || [])[0];
        if (firstVol) {
            var volNum = firstVol.volume_number || firstVol.number || 1;
            var formatStr = (firstVol.format || firstVol.file_type || '').toLowerCase();
            var isPdf = formatStr === 'pdf';
            var bookPayload = {
                id: firstVol.id || (`${series.id}_vol_${volNum}`),
                title: `${series.title} - ${firstVol.title || ('Volume ' + volNum)}`,
                seriesId: series.id,
                volumeNumber: volNum,
                format: isPdf ? 'pdf' : 'epub',
                file_path: firstVol.file_path || firstVol.filePath,
                filePath: firstVol.file_path || firstVol.filePath,
                cover: firstVol.cover || firstVol.cover_url || series.cover
            };

            if (typeof window.openBookReader === 'function') {
                window.openBookReader(bookPayload);
            } else if (typeof window.openPdfReader === 'function') {
                window.openPdfReader(bookPayload);
            }
        }
    }
}

function showToast(message) {
    var toast = document.getElementById('seriesToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'seriesToast';
        toast.className = 'catalog-toast';
        document.body.appendChild(toast);
    }
    toast.innerHTML = '<i class="fa-solid fa-circle-check"></i> ' + message;
    toast.classList.add('show');
    setTimeout(function() { toast.classList.remove('show'); }, 3500);
}


  // Mobile drawer support in series.html
  const topnavHamburger = document.getElementById('topnavHamburger');
  const navMobileDrawer = document.getElementById('navMobileDrawer');
  const navMobileCloseBtn = document.getElementById('navMobileCloseBtn');
  const navMobileBackdrop = document.getElementById('navMobileBackdrop');
  const navMobileSearchToggle = document.getElementById('navMobileSearchToggle');
  const navMobileSearchInput = document.getElementById('navMobileSearchInput');
  const navGlobalSearchInput = document.getElementById('navGlobalSearchInput');

  function openMobileDrawer() {
    if (navMobileDrawer) navMobileDrawer.classList.add('open');
  }

  function closeMobileDrawer() {
    if (navMobileDrawer) navMobileDrawer.classList.remove('open');
  }

  if (topnavHamburger) topnavHamburger.addEventListener('click', openMobileDrawer);
  if (navMobileCloseBtn) navMobileCloseBtn.addEventListener('click', closeMobileDrawer);
  if (navMobileBackdrop) navMobileBackdrop.addEventListener('click', closeMobileDrawer);

  if (navMobileSearchToggle) {
    navMobileSearchToggle.addEventListener('click', () => {
      openMobileDrawer();
      setTimeout(() => {
        if (navMobileSearchInput) navMobileSearchInput.focus();
      }, 300);
    });
  }

  // Bind mobile items in series.html
  function bindMobSeries(id, url) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => { window.location.href = url; });
  }

  bindMobSeries('mobileHomeBtn', '/index.html');
  bindMobSeries('mobileCatalogBtn', '/index.html#catalog');
  bindMobSeries('mobilePlanningBtn', '/index.html#planning');
  bindMobSeries('mobileContinueBtn', '/index.html#continue');
  bindMobSeries('mobileLibraryBtn', '/index.html#library');
  bindMobSeries('mobileFavoritesBtn', '/index.html#favorites');
  bindMobSeries('mobileReadingHistoryBtn', '/index.html#reading-history');
  bindMobSeries('mobileDocsBtn', '/index.html#docs');
    bindMobSeries('mobileHistoryBtn', '/index.html#history');

  if (navGlobalSearchInput) {
    navGlobalSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = encodeURIComponent(navGlobalSearchInput.value.trim());
        if (q) window.location.href = '/index.html#catalog?search=' + q;
      }
    });
  }

  if (navMobileSearchInput) {
    navMobileSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = encodeURIComponent(navMobileSearchInput.value.trim());
        if (q) window.location.href = '/index.html#catalog?search=' + q;
      }
    });
  }


// =============================================================================
// NOVELTRAD — WORKFLOW SOUMISSION AU CATALOGUE PUBLIC
// =============================================================================
let currentSeriesObject = null;

async function checkAndRenderCatalogStatus(series) {
    currentSeriesObject = series;
    const badgeContainer = document.getElementById('seriesCatalogBadge');
    const btnSubmit = document.getElementById('btnOpenSubmitCatalog');
    if (!badgeContainer || !btnSubmit) return;

    badgeContainer.innerHTML = '';
    btnSubmit.classList.add('hidden');

    // Vérifier si la série est locale (possède des volumes locaux ou external_)
    const hasLocalVolumes = Array.isArray(series.volumes) && series.volumes.some(v => v.id && (v.id.startsWith('external_') || v.id.startsWith('local_') || v.file || v.file_path));

    // Si c'est une œuvre locale liée depuis un dossier PC : on lit directement en local, JAMAIS d'appel réseau au catalogue public
    if (hasLocalVolumes) {
        if (series.catalogStatus === 'PENDING_REVIEW') {
            badgeContainer.innerHTML = '<span class="status-pill pending"><i class="fa-solid fa-clock-rotate-left"></i> En attente de validation</span>';
        } else if (series.catalogStatus === 'PUBLISHED') {
            badgeContainer.innerHTML = ''; 
        } else if (series.catalogStatus === 'DRAFT' && series.catalogRejectionReason) {
            badgeContainer.innerHTML = '<span class="status-pill rejected" title="' + (series.catalogRejectionReason || '').replace(/"/g, '&quot;') + '"><i class="fa-solid fa-triangle-exclamation"></i> Modifications demandées</span>';
            btnSubmit.innerHTML = '<i class="fa-solid fa-rotate-right"></i> <span>Re-soumettre au Catalogue</span>';
            btnSubmit.classList.remove('hidden');
        } else {
            // Œuvre privée locale : bouton pour proposer au catalogue si souhaité
            btnSubmit.classList.remove('hidden');
        }
        return;
    }

    // Sinon (série venant exclusivement du catalogue public)
    if (series.catalogStatus) {
        if (series.catalogStatus === 'PENDING_REVIEW') {
            badgeContainer.innerHTML = '<span class="status-pill pending"><i class="fa-solid fa-clock-rotate-left"></i> En attente de validation</span>';
        } else if (series.catalogStatus === 'PUBLISHED') {
            badgeContainer.innerHTML = ''; 
        }
        return;
    }
}

function initSubmitCatalogModal() {
    const modal = document.getElementById('submitToCatalogModal');
    const btnOpen = document.getElementById('btnOpenSubmitCatalog');
    const btnClose = document.getElementById('submitCatalogCloseBtn');
    const btnCancel = document.getElementById('btnCancelSubmitCatalog');
    const form = document.getElementById('submitCatalogForm');
    const errorEl = document.getElementById('submitCatalogError');

    if (!modal || !btnOpen) return;

    const openModal = async () => {
        // Vérifier que l'utilisateur est connecté
        if (!window.authManager || !window.authManager.currentUser) {
            const authModal = document.getElementById('authModal');
            if (authModal) {
                authModal.classList.remove('hidden');
                if (window.authManager && window.authManager.showToast) {
                    window.authManager.showToast('Veuillez vous connecter pour proposer ce roman à la communauté.');
                }
            }
            return;
        }

        if (!currentSeriesObject) return;

        // Remplir les données de prévisualisation
        const titleEl = document.getElementById('submitModalTitle');
        const authorEl = document.getElementById('submitModalAuthor');
        const volCountEl = document.getElementById('submitModalVolCount');
        const coverEl = document.getElementById('submitModalCover');
        const checklistEl = document.getElementById('submitVolumesChecklist');

        const seriesTitle = currentSeriesObject.title || 'Sans titre';
        const seriesAuthor = currentSeriesObject.author || (currentSeriesObject.metadata && currentSeriesObject.metadata.author) || 'Auteur inconnu';
        const volumes = currentSeriesObject.volumes || [];

        if (titleEl) titleEl.textContent = seriesTitle;
        if (authorEl) authorEl.innerHTML = '<i class="fa-solid fa-pen-nib"></i> ' + seriesAuthor;
        if (volCountEl) volCountEl.innerHTML = '<i class="fa-solid fa-book"></i> <span>' + volumes.length + ' volume(s) disponible(s)</span>';

        const coverSrc = currentSeriesObject.cover || (currentSeriesObject.metadata && currentSeriesObject.metadata.cover) || (volumes[0] && (volumes[0].cover || volumes[0].cover_url)) || '';
        if (coverEl) coverEl.src = coverSrc;

        // Générer la checklist des volumes
        if (checklistEl) {
            checklistEl.innerHTML = '';
            volumes.forEach(vol => {
                const vNum = vol.volumeNumber !== null && vol.volumeNumber !== undefined ? vol.volumeNumber : 1;
                const vTitle = vol.title || ('Volume ' + vNum);
                const itemDiv = document.createElement('label');
                itemDiv.className = 'submit-vol-check-item';
                itemDiv.innerHTML = '<input type="checkbox" name="volumes" value="' + vNum + '" checked> <span>' + vTitle + '</span>';
                checklistEl.appendChild(itemDiv);
            });
        }

        if (errorEl) {
            errorEl.textContent = '';
            errorEl.classList.add('hidden');
        }

        modal.classList.remove('hidden');
    };

    const closeModal = () => {
        modal.classList.add('hidden');
    };

    btnOpen.addEventListener('click', openModal);
    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnCancel) btnCancel.addEventListener('click', closeModal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!currentSeriesObject) return;

            const checkedBoxes = modal.querySelectorAll('input[name="volumes"]:checked');
            const selectedVolumeNumbers = Array.from(checkedBoxes).map(cb => parseInt(cb.value, 10));

            if (selectedVolumeNumbers.length === 0) {
                if (errorEl) {
                    errorEl.textContent = 'Veuillez sélectionner au moins un volume à partager.';
                    errorEl.classList.remove('hidden');
                }
                return;
            }

            const reviewNotes = (document.getElementById('submitReviewNotes')?.value || '').trim();
            const btnSubmit = document.getElementById('btnConfirmSubmitCatalog');
            const origHtml = btnSubmit ? btnSubmit.innerHTML : '';
            if (btnSubmit) {
                btnSubmit.disabled = true;
                btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Envoi en cours...';
            }

            try {
                const token = await window.authManager.getAccessToken();
                const res = await fetch('/api/library/submit-to-catalog', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { 'Authorization': 'Bearer ' + token } : {})
                    },
                    body: JSON.stringify({
                        seriesId: currentSeriesObject.id,
                        volumeNumbers: selectedVolumeNumbers,
                        reviewNotes: reviewNotes
                    })
                });

                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.error || 'Erreur lors de la soumission du roman.');
                }

                closeModal();
                if (window.authManager && window.authManager.showToast) {
                    window.authManager.showToast('🎉 Roman soumis pour validation par un administrateur !');
                }

                // Actualiser le statut
                await checkAndRenderCatalogStatus(currentSeriesObject);
            } catch (err) {
                console.error('[Submit Error]', err);
                if (errorEl) {
                    errorEl.textContent = err.message;
                    errorEl.classList.remove('hidden');
                }
            } finally {
                if (btnSubmit) {
                    btnSubmit.disabled = false;
                    btnSubmit.innerHTML = origHtml;
                }
            }
        });
    }
}
