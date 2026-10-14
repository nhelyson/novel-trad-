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

        // [C3]: Direct unified query: local library & catalog handled cleanly
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
    if (series.title) {
        document.title = series.title + ' - Light Novel en Français | NovelTrad';
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
                        seriesBannerEl.style.backgroundImage = "linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, rgba(9,9,11,1) 100%), url('" + dataUrl + "')";
                        seriesBannerEl.style.filter = 'none';
                    }
                }
            }).catch(function() {});
        }
    }

    // Banner (Seamless Full-Width Atmospheric Hero)
    if (seriesBannerEl) {
        var bannerImg = String(series.banner || (series.metadata && series.metadata.banner) || coverUrl || '');
        var hasWideBanner = Boolean(series.banner || (series.metadata && series.metadata.banner));
        
        seriesBannerEl.innerHTML = '';
        var bgDiv = document.createElement('div');
        bgDiv.className = 'series-banner-bg' + (hasWideBanner ? ' is-wide' : ' is-cover');
        bgDiv.style.backgroundImage = bannerImg ? "url('" + bannerImg.replace(/'/g, "\\'") + "')" : 'none';
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
    if (elVolCount) {
      var vCount = (series.volumes && series.volumes.length) || (series.volume_count) || 1;
      elVolCount.textContent = vCount + ' Volume' + (vCount > 1 ? 's' : '');
    }

    // --- Direction C : Sous-titre éditorial alternatif (Romaji / Japonais / Original) ---
    var subTitle = series.title_romaji || series.originalTitle || (series.metadata && (series.metadata.romaji_title || series.metadata.original_title || series.metadata.native_title)) || '';
    var subTitleEl = document.getElementById('seriesSubtitle');
    if (subTitleEl) {
      if (subTitle && subTitle.trim() && subTitle.trim().toLowerCase() !== (series.title || '').trim().toLowerCase()) {
        subTitleEl.textContent = subTitle.trim();
        subTitleEl.classList.remove('hidden');
      } else {
        subTitleEl.textContent = '';
        subTitleEl.classList.add('hidden');
      }
    }



    // --- Direction C : Illustrateur (si présent) ---
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

    // Action buttons in series meta (Ajouter à ma bibliothèque + Commencer la lecture)
    var metaContainer = document.querySelector('.series-page-meta');
    if (metaContainer && !document.getElementById('seriesPageActions')) {
        var actionsDiv = document.createElement('div');
        actionsDiv.id = 'seriesPageActions';
        actionsDiv.className = 'series-page-actions';
        actionsDiv.style.cssText = 'display:flex; gap:12px; margin-top:16px; flex-wrap:wrap;';

        var isWebnovel = series.type === 'webnovel' || (series.chapters && series.chapters.length > 0);
        var readBtnLabel = isWebnovel ? 'Lire le Chapitre 1' : 'Lire le Volume 1';

        actionsDiv.innerHTML = `
            <button id="btnSeriesQuickRead" class="btn-series-hero-primary" type="button">
                <i class="fa-solid fa-book-open-reader"></i> <span>${readBtnLabel}</span>
            </button>
            <button id="btnSeriesBookmark" class="btn-series-hero-secondary" type="button">
                <i class="fa-solid fa-bookmark"></i> <span>Ajouter à ma bibliothèque</span>
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
            quickStartReadingSeries(series);
        };

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
            var mainVols = allVols.filter(function(v) {
                var t = (v.volume_type || 'main').toLowerCase();
                return t === 'main' || t === 'canon' || (!v.volume_type && !String(v.volume_number).includes('.'));
            });
            var sideVols = allVols.filter(function(v) {
                var t = (v.volume_type || '').toLowerCase();
                return t === 'side_story' || t === 'spinoff' || t === 'alternative' || (v.volume_type !== 'main' && String(v.volume_number).includes('.'));
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

            volumesSection.innerHTML = `
                <div class="series-volumes-header">
                    <h3>Volumes disponibles (${allVols.length})</h3>
                    ${tabsHtml}
                </div>
                <div class="series-volumes-grid" id="seriesVolumesGrid"></div>
            `;

            var volumesGrid = document.getElementById('seriesVolumesGrid');
            
            // Wiring des onglets de filtrage de volumes si présents
            var filterTabs = volumesSection.querySelectorAll('.vol-filter-tab');
            if (filterTabs.length > 0) {
                filterTabs.forEach(function(tab) {
                    tab.addEventListener('click', function() {
                        filterTabs.forEach(function(t) { t.classList.remove('active'); });
                        this.classList.add('active');
                        var filter = this.getAttribute('data-filter');
                        var cards = volumesGrid.querySelectorAll('.volume-card');
                        cards.forEach(function(card) {
                            var type = (card.getAttribute('data-volume-type') || 'main').toLowerCase();
                            var shouldShow = true;
                            if (filter === 'main') {
                                shouldShow = (type === 'main' || type === 'canon');
                            } else if (filter === 'side') {
                                shouldShow = (type !== 'main' && type !== 'canon');
                            }
                            card.classList.toggle('vol-card-hidden', !shouldShow);
                        });
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

                    var labelText = vol.title || ('Volume ' + volNum);

                    var volType = (vol.volume_type || (String(volNum).includes('.') ? 'side_story' : 'main')).toLowerCase();
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
            badgeContainer.innerHTML = ''; // Retiré selon demande utilisateur
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
            badgeContainer.innerHTML = ''; // Retiré selon demande utilisateur
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
