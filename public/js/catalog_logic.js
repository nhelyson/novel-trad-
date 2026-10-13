/**
 * NovelTrad - Catalog Lnori Controller
 * Inspiré de lnori.com/library :
 * - Recherche instantanée & panneau déroulant rétractable (Tools Panel)
 * - Filtres par Genre, Origine (JP/KR/CN), Format et Tri
 * - Bandeau dynamique de tags actifs
 * - Grille adaptative avec Flyout Popover directionnel intelligent (.popup-left / .popup-right)
 */
"use strict";

(function() {
    let allExploreList = [];
    let searchDebounce = null;
    const exploreCache = new Map();
    const CACHE_TTL = 60000; // 60 secondes de validité cache

    let catalogState = {
        q: '',
        genre: 'all',
        status: 'all',
        format: 'all',
        origin: 'all',
        sort: 'popular',
        page: 1,
        limit: 40
    };

    window.initCatalog = async function() {
        // log silenced
        setupCatalogControls();
        readParamsFromHash();
        await loadCatalogExplore();
    };

    window.applyCatalogFilters = function(filters = {}) {
        if (filters.q !== undefined) {
            catalogState.q = filters.q;
            const inp = document.getElementById('navGlobalSearchInput');
            if (inp) inp.value = filters.q;
        }
        if (filters.genre !== undefined) {
            catalogState.genre = filters.genre;
            const sel = document.getElementById('catalogGenreSelect');
            if (sel) sel.value = filters.genre;
        }
        if (filters.origin !== undefined) {
            catalogState.origin = filters.origin;
            const sel = document.getElementById('catalogOriginSelect');
            if (sel) sel.value = filters.origin;
        }
        if (filters.format !== undefined) {
            catalogState.format = filters.format;
            const sel = document.getElementById('catalogFormatSelect');
            if (sel) sel.value = filters.format;
        }
        if (filters.status !== undefined) {
            catalogState.status = filters.status;
            const sel = document.getElementById('catalogStatusSelect');
            if (sel) sel.value = filters.status;
        }
        if (filters.sort !== undefined) {
            const s = filters.sort;
            catalogState.sort = (s === 'title' ? 'az' : s);
            const sel = document.getElementById('catalogSortSelect');
            if (sel) sel.value = (s === 'title' ? 'az' : s);
        }
        return loadCatalogExplore();
    };

    function readParamsFromHash() {
        const hash = window.location.hash || '';
        if (!hash.includes('?')) return false;
        const qStr = hash.split('?')[1] || '';
        const params = new URLSearchParams(qStr);
        let changed = false;

        if (params.has('q') || params.has('search')) {
            const val = params.get('q') || params.get('search') || '';
            catalogState.q = val;
            const inp = document.getElementById('navGlobalSearchInput');
            if (inp) inp.value = val;
            changed = true;
        }
        if (params.has('genre')) {
            catalogState.genre = params.get('genre') || 'all';
            const sel = document.getElementById('catalogGenreSelect');
            if (sel) sel.value = catalogState.genre;
            changed = true;
        }
        if (params.has('origin')) {
            catalogState.origin = params.get('origin') || 'all';
            const sel = document.getElementById('catalogOriginSelect');
            if (sel) sel.value = catalogState.origin;
            changed = true;
        }
        if (params.has('format')) {
            catalogState.format = params.get('format') || 'all';
            const sel = document.getElementById('catalogFormatSelect');
            if (sel) sel.value = catalogState.format;
            changed = true;
        }
        if (params.has('status')) {
            catalogState.status = params.get('status') || 'all';
            const sel = document.getElementById('catalogStatusSelect');
            if (sel) sel.value = catalogState.status;
            changed = true;
        }
        if (params.has('sort')) {
            const s = params.get('sort');
            catalogState.sort = (s === 'title' ? 'az' : s);
            const sel = document.getElementById('catalogSortSelect');
            if (sel) sel.value = (s === 'title' ? 'az' : s);
            changed = true;
        }
        return changed;
    }

    // Listen to hash changes on window
    window.addEventListener('hashchange', () => {
        if (window.location.hash.startsWith('#catalog')) {
            readParamsFromHash();
            loadCatalogExplore();
        }
    });

    function setupCatalogControls() {
        // Barre de recherche unifiée (depuis la Navbar style Lnori)
        const searchInput = document.getElementById('navGlobalSearchInput');
        const searchClearBtn = document.getElementById('navSearchClearBtn');
        const surpriseBtn = document.getElementById('catalogSurpriseBtn');
        const toggleFilterBtn = document.getElementById('catalogFilterToggleBtn');
        const mobileToggleBtn = document.getElementById('catalogMobileFilterToggleBtn');
        const toolsPanel = document.getElementById('catalogToolsPanel');

        // Toggle Tools Panel
        const togglePanel = () => {
            const catalogModule = document.getElementById('catalogModule');
            const tabCatalogBtn = document.getElementById('tabCatalogBtn');
            if (catalogModule && catalogModule.classList.contains('hidden')) {
                if (tabCatalogBtn) tabCatalogBtn.click();
            }
            if (toolsPanel) {
                const isOpen = toolsPanel.classList.toggle('open');
                if (toggleFilterBtn) toggleFilterBtn.classList.toggle('active', isOpen);
                if (mobileToggleBtn) mobileToggleBtn.classList.toggle('active', isOpen);
            }
        };

        if (toggleFilterBtn) toggleFilterBtn.onclick = togglePanel;
        if (mobileToggleBtn) mobileToggleBtn.onclick = togglePanel;

        // Live Search Input (Source unique : Navbar)
        if (searchInput) {
            searchInput.oninput = () => {
                const q = searchInput.value.trim();
                catalogState.q = q;
                if (searchClearBtn) {
                    searchClearBtn.classList.toggle('hidden', q.length === 0);
                }
                
                // Si on n'est pas sur le catalogue, basculer immédiatement
                const catalogModule = document.getElementById('catalogModule');
                const tabCatalogBtn = document.getElementById('tabCatalogBtn');
                if (catalogModule && catalogModule.classList.contains('hidden') && q.length > 0) {
                    if (tabCatalogBtn) tabCatalogBtn.click();
                }

                clearTimeout(searchDebounce);
                searchDebounce = setTimeout(() => {
                    loadCatalogExplore();
                }, 200);
            };
        }

        // Clear Search
        if (searchClearBtn && searchInput) {
            searchClearBtn.onclick = () => {
                searchInput.value = '';
                catalogState.q = '';
                searchClearBtn.classList.add('hidden');
                loadCatalogExplore();
            };
        }

        // Surprise Me
        if (surpriseBtn) {
            surpriseBtn.onclick = () => {
                if (allExploreList && allExploreList.length > 0) {
                    const random = allExploreList[Math.floor(Math.random() * allExploreList.length)];
                    if (random && random.id) {
                        surpriseBtn.classList.add('rolling');
                        setTimeout(() => {
                            window.location.href = `/series.html?id=${encodeURIComponent(random.id)}`;
                        }, 250);
                    }
                }
            };
        }

        // Select Filters
        bindSelect('catalogGenreSelect', 'genre');
        bindSelect('catalogOriginSelect', 'origin');
        bindSelect('catalogFormatSelect', 'format');
        bindSelect('catalogStatusSelect', 'status');
        bindSelect('catalogSortSelect', 'sort');
    }

    function bindSelect(elementId, stateKey) {
        const el = document.getElementById(elementId);
        if (el) {
            el.onchange = () => {
                catalogState[stateKey] = el.value;
                loadCatalogExplore();
            };
        }
    }

    window.reloadCatalog = function(forceRefresh = false) { 
        if (forceRefresh) exploreCache.clear();
        return loadCatalogExplore(); 
    };

    async function loadCatalogExplore() {
        const grid = document.getElementById('catalogGrid');
        const countEl = document.getElementById('catalogResultsCount');

        renderActiveFilters();

        // Sync URL with active filters for shareable/bookmarkable links
        try {
            const urlParams = new URLSearchParams();
            if (catalogState.q) urlParams.set('q', catalogState.q);
            if (catalogState.genre !== 'all') urlParams.set('genre', catalogState.genre);
            if (catalogState.origin !== 'all') urlParams.set('origin', catalogState.origin);
            if (catalogState.format !== 'all') urlParams.set('format', catalogState.format);
            if (catalogState.status !== 'all') urlParams.set('status', catalogState.status);
            if (catalogState.sort !== 'popular') urlParams.set('sort', catalogState.sort);
            const qStr = urlParams.toString();
            const newHash = '#catalog' + (qStr ? '?' + qStr : '');
            if (window.location.hash.startsWith('#catalog') && window.location.hash !== newHash) {
                history.replaceState(null, '', newHash);
            }
        } catch (_) {}

        const params = new URLSearchParams({
            q: catalogState.q,
            genre: catalogState.genre,
            status: catalogState.status,
            format: catalogState.format,
            origin: catalogState.origin,
            sort: catalogState.sort,
            page: catalogState.page,
            limit: catalogState.limit
        });
        const cacheKey = params.toString();

        // 1. VÉRIFICATION DU CACHE SESSION CLIENT (Affichage 0 ms)
        const cached = exploreCache.get(cacheKey);
        const now = Date.now();
        let renderedFromCache = false;

        if (cached && cached.data && cached.data.success) {
            allExploreList = cached.data.series || [];
            if (countEl) countEl.textContent = `${cached.data.total} roman${cached.data.total > 1 ? 's' : ''}`;
            if (grid) renderCatalogGrid(allExploreList, grid);
            renderedFromCache = true;

            // Si les données en cache sont encore très fraîches (< 60s), pas besoin de refaire de requête
            if (now - cached.timestamp < CACHE_TTL) {
                return;
            }
        }

        // 2. ÉTAT DE CHARGEMENT SANS FLICKER
        if (!renderedFromCache && grid) {
            // Affichage de cartes skeletons élégantes plutôt qu'un spinner bloquant
            let skeletons = '';
            for (let i = 0; i < 12; i++) {
                skeletons += '<div class="catalog-skeleton-card" style="aspect-ratio: 2/3; border-radius: 14px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);"></div>';
            }
            grid.innerHTML = skeletons;
        }

        // 3. REQUÊTE RÉSEAU
        try {
            const res = await fetch(`/api/catalog/explore?${cacheKey}`);
            const data = await res.json();

            if (data.success) {
                exploreCache.set(cacheKey, { data, timestamp: Date.now() });
                const list = data.series || [];
                allExploreList = list;
                if (countEl) countEl.textContent = `${data.total} roman${data.total > 1 ? 's' : ''}`;
                if (grid) renderCatalogGrid(list, grid);
            }
        } catch (e) {
            console.error('[Catalog] Erreur chargement catalogue:', e);
            if (!renderedFromCache && grid) {
                grid.innerHTML = '<p class="text-danger" style="grid-column: 1/-1; text-align: center; padding: 40px;">Erreur de connexion au catalogue.</p>';
            }
        }
    }

    function renderCatalogGrid(list, container) {
        if (!container) return;
        container.innerHTML = '';

        if (list.length === 0) {
            container.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px;">
                    <div style="font-size: 36px; color: #64748b; margin-bottom: 12px;"><i class="fa-solid fa-book-open"></i></div>
                    <h3 style="color: #ffffff; margin-bottom: 8px;">Aucun roman trouvé</h3>
                    <p style="color: #94a3b8; font-size: 14px; margin-bottom: 20px;">Aucune œuvre ne correspond à vos critères de recherche.</p>
                    <button type="button" class="btn btn-secondary btn-sm" id="btnResetFilters">
                        <i class="fa-solid fa-rotate-left"></i> Réinitialiser les filtres
                    </button>
                </div>
            `;
            const rBtn = document.getElementById('btnResetFilters');
            if (rBtn) rBtn.onclick = resetAllFilters;
            return;
        }

        list.forEach(series => {
            const cardWrap = document.createElement('div');
            cardWrap.className = 'lnori-card-wrapper';

            const rawCover = series.cover || '';
            const coverSrc = rawCover ? (rawCover.startsWith('http') ? `/api/cover-proxy?url=${encodeURIComponent(rawCover)}&w=360` : rawCover) : 'https://placehold.co/400x600/18181b/ffffff?text=Cover';
            const isWebnovel = series.type === 'webnovel' || (series.formats || []).includes('webnovel');
            const formatBadge = isWebnovel ? 'Webnovel' : (series.formats ? series.formats.join('/') : 'EPUB');
            const volCount = series.volume_count || (series.volumes ? series.volumes.length : 1);
            const genres = (series.genres_fr || series.genres || []).slice(0, 3);

            let originTag = 'JP';
            if ((series.origin || '').includes('Corée')) originTag = 'KR';
            else if ((series.origin || '').includes('Chine')) originTag = 'CN';

            cardWrap.innerHTML = `
                <div class="lnori-card">
                    <div class="lnori-card-cover-box">
                        <span class="lnori-card-format-tag">${originTag}</span>
                        <img src="${coverSrc}" alt="${series.title}" loading="lazy" decoding="async" onload="this.classList.add('loaded')" onerror="this.onerror=null;this.src='https://placehold.co/400x600/18181b/ffffff?text=${encodeURIComponent(series.title)}'">
                        <span class="lnori-card-vol-badge">${volCount} Vol.</span>
                    </div>
                    <div class="lnori-card-info">
                        <div class="lnori-card-title" title="${series.title}">${series.title}</div>
                        <div class="lnori-card-sub">${series.author || 'Auteur Inconnu'}</div>
                    </div>
                </div>

                <!-- POPOVER FLOTTANT DIRECTIONNEL LNORI -->
                <div class="lnori-card-popup">
                    <div class="popup-header">
                        <div class="popup-tags-row">
                            <span class="popup-pill">${originTag}</span>
                            <span class="popup-pill popup-vol-pill"><i class="fa-solid fa-book"></i> ${volCount} Vol.</span>
                        </div>
                        <h4 class="popup-title">${series.title}</h4>
                        <span class="popup-author">${series.author || 'Auteur Inconnu'}</span>
                    </div>

                    <div class="popup-genres">
                        ${genres.map(g => `<span class="popup-genre-badge">${g}</span>`).join('')}
                    </div>

                    <p class="popup-synopsis">${series.synopsis_fr || series.synopsis || 'Découvrez cette histoire captivante sur NovelTrad.'}</p>

                    <div class="popup-actions">
                        <button type="button" class="popup-btn-primary btn-open-series">
                            <i class="fa-solid fa-book-open"></i> Lire maintenant
                        </button>
                        <button type="button" class="popup-btn-icon btn-popup-bookmark" title="Ajouter à mes favoris">
                            <i class="fa-solid fa-bookmark"></i>
                        </button>
                    </div>
                </div>
            `;

            // Détection automatique de direction gauche/droite pour éviter tout débordement d'écran
            cardWrap.addEventListener('mouseenter', () => {
                const rect = cardWrap.getBoundingClientRect();
                const center = rect.left + rect.width / 2;
                if (center > window.innerWidth / 2) {
                    cardWrap.classList.add('popup-right');
                    cardWrap.classList.remove('popup-left');
                } else {
                    cardWrap.classList.add('popup-left');
                    cardWrap.classList.remove('popup-right');
                }
            });

            const openAction = () => {
                window.location.href = `/series.html?id=${encodeURIComponent(series.id)}`;
            };

            cardWrap.querySelector('.lnori-card').onclick = openAction;
            cardWrap.querySelector('.btn-open-series').onclick = openAction;

            const bookmarkBtn = cardWrap.querySelector('.btn-popup-bookmark');
            if (bookmarkBtn) {
                bookmarkBtn.onclick = (e) => {
                    e.stopPropagation();
                    quickBookmarkSeries(series, bookmarkBtn);
                };
            }

            container.appendChild(cardWrap);
        });
    }

    function renderActiveFilters() {
        const rail = document.getElementById('catalogActiveRail');
        const badge = document.getElementById('catalogFilterBadge');
        if (!rail) return;

        const chips = [];

        if (catalogState.q) chips.push({ label: `"${catalogState.q}"`, key: 'q' });
        if (catalogState.genre !== 'all') chips.push({ label: catalogState.genre, key: 'genre' });
        if (catalogState.origin !== 'all') chips.push({ label: catalogState.origin, key: 'origin' });
        if (catalogState.format !== 'all') chips.push({ label: catalogState.format.toUpperCase(), key: 'format' });
        if (catalogState.status !== 'all') chips.push({ label: catalogState.status === 'releasing' ? 'En cours' : 'Terminé', key: 'status' });
        if (catalogState.sort !== 'popular') {
            let sortLbl = 'Mieux notés';
            if (catalogState.sort === 'latest') sortLbl = 'Plus récents';
            else if (catalogState.sort === 'az' || catalogState.sort === 'title') sortLbl = 'A-Z';
            chips.push({ label: sortLbl, key: 'sort' });
        }

        // Mettre à jour les badges des boutons filtres (desktop et mobile)
        const filterCount = chips.length;
        const allBadges = [
            document.getElementById('catalogFilterCountBadge'),
            document.getElementById('catalogMobileFilterCountBadge'),
            document.getElementById('catalogFilterBadge'),
            document.getElementById('catalogMobileFilterBadge')
        ];
        allBadges.forEach(b => {
            if (b) {
                b.textContent = filterCount;
                b.classList.toggle('hidden', filterCount === 0);
            }
        });

        if (chips.length === 0) {
            rail.classList.add('hidden');
            rail.innerHTML = '';
            return;
        }

        rail.classList.remove('hidden');
        rail.innerHTML = `
            <span class="active-rail-label"><i class="fa-solid fa-filter"></i> Filtres :</span>
            ${chips.map(c => `
                <button type="button" class="active-chip" data-key="${c.key}">
                    <span>${c.label}</span>
                    <i class="fa-solid fa-xmark"></i>
                </button>
            `).join('')}
            <button type="button" class="btn-clear-all-chips" id="btnClearAllChips">
                Effacer tout
            </button>
        `;

        rail.querySelectorAll('.active-chip').forEach(btn => {
            btn.onclick = () => {
                const key = btn.dataset.key;
                if (key === 'q') {
                    catalogState.q = '';
                    const inp = document.getElementById('navGlobalSearchInput');
                    if (inp) inp.value = '';
                } else if (key === 'genre') {
                    catalogState.genre = 'all';
                    const sel = document.getElementById('catalogGenreSelect');
                    if (sel) sel.value = 'all';
                } else if (key === 'origin') {
                    catalogState.origin = 'all';
                    const sel = document.getElementById('catalogOriginSelect');
                    if (sel) sel.value = 'all';
                } else if (key === 'format') {
                    catalogState.format = 'all';
                    const sel = document.getElementById('catalogFormatSelect');
                    if (sel) sel.value = 'all';
                } else if (key === 'status') {
                    catalogState.status = 'all';
                    const sel = document.getElementById('catalogStatusSelect');
                    if (sel) sel.value = 'all';
                } else if (key === 'sort') {
                    catalogState.sort = 'popular';
                    const sel = document.getElementById('catalogSortSelect');
                    if (sel) sel.value = 'popular';
                }
                loadCatalogExplore();
            };
        });

        const clearBtn1 = document.getElementById('btnClearAllChips');
        if (clearBtn1) clearBtn1.onclick = resetAllFilters;
        const clearBtn2 = document.getElementById('catalogClearAllFiltersBtn');
        if (clearBtn2) clearBtn2.onclick = resetAllFilters;
    }

    function resetAllFilters() {
        catalogState.q = '';
        catalogState.genre = 'all';
        catalogState.origin = 'all';
        catalogState.format = 'all';
        catalogState.status = 'all';
        catalogState.sort = 'popular';

        const inp = document.getElementById('navGlobalSearchInput');
        if (inp) inp.value = '';
        const clr = document.getElementById('navSearchClearBtn');
        if (clr) clr.classList.add('hidden');

        ['catalogGenreSelect', 'catalogOriginSelect', 'catalogFormatSelect', 'catalogStatusSelect'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = 'all';
        });
        const sortSel = document.getElementById('catalogSortSelect');
        if (sortSel) sortSel.value = 'popular';

        loadCatalogExplore();
    }

    async function quickBookmarkSeries(series, buttonEl) {
        if (!series || !series.id || !window.libraryDB) return;
        const auth = window.authManager || window.supabaseAuthManager;
        const isLogged = Boolean(auth?.currentUser);
        if (!isLogged) {
            if (auth && typeof auth.showToast === 'function') {
                auth.showToast('Connectez-vous pour ajouter « ' + (series.title || 'ce roman') + ' » à votre bibliothèque personnelle !');
            }
            if (typeof window.openAuthModal === 'function') window.openAuthModal('login');
            return;
        }
        try {
            const inLib = await window.libraryDB.isInLocalLibrary(series.id);
            if (inLib) {
                await window.libraryDB.removeFromLocalLibrary(series.id);
                if (buttonEl) buttonEl.innerHTML = '<i class="fa-solid fa-bookmark"></i>';
                if (auth && auth.showToast) auth.showToast('« ' + (series.title || 'Roman') + ' » retiré de votre bibliothèque.');
            } else {
                await window.libraryDB.addToLocalLibrary({
                    id: series.id,
                    seriesId: series.id,
                    title: series.title,
                    cover: series.cover || series.cover_url || series.coverImage || (series.metadata && series.metadata.cover) || '',
                    author: series.author || (series.metadata && series.metadata.author) || 'Roman / Light Novel',
                    genres: series.genres_fr || series.genres || [],
                    synopsis: series.synopsis_fr || series.synopsis || '',
                    volumes: series.volumes || [],
                    format: 'epub'
                });
                if (buttonEl) buttonEl.innerHTML = '<i class="fa-solid fa-check text-accent-emerald"></i>';
                if (auth && auth.showToast) auth.showToast('« ' + (series.title || 'Roman') + ' » ajouté à votre bibliothèque !');
            }
            if (typeof window.initLibrary === 'function') window.initLibrary(true);
        } catch (e) {
            console.warn('[Catalog] Error bookmarking:', e);
        }
    }
})();
