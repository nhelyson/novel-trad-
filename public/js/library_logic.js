
// ═══════════════════════════════════════════════════════════════════════════
// NATIVE FILE SYSTEM ACCESS API & LOCAL FOLDER ZERO-COPY ENGINE
// ═══════════════════════════════════════════════════════════════════════════

function parseLocalFilename(filename) {
    let name = filename.replace(/\.(epub|pdf)$/i, '');
    name = name.replace(/\s*\(\d+\)\s*$/, '').trim();
    name = name.replace(/[\s_-]*(?:_fr|-fr|\[fr\]|\(fr\)|vf|french)[\s_-]*/ig, ' ').trim();
    name = name.replace(/\[[^\]]+\]|\([^\)]+\)/g, ' ').replace(/\s{2,}/g, ' ').trim();

    let volumeNumber = null;
    let seriesTitle = name;

    const volMatch = name.match(/[\s\-_]+(?:vol(?:ume)?|tome|v)\.?\s*(\d+(?:\.\d+)?)/i) ||
                     name.match(/[\s\-_]+0*(\d+)\s*$/);
    if (volMatch) {
        volumeNumber = parseFloat(volMatch[1]);
        seriesTitle = name.slice(0, volMatch.index).trim();
    }

    if (!seriesTitle) seriesTitle = name;
    seriesTitle = seriesTitle.replace(/[\s\-_]+$/, '').trim();

    return {
        seriesTitle: seriesTitle || name,
        volumeNumber: volumeNumber,
        volumeTitle: volumeNumber !== null ? ('Volume ' + volumeNumber) : name,
        cleanName: name
    };
}

async function connectLocalFolderNative() {
    if (typeof window.showDirectoryPicker !== 'function') {
        const importFolderInput = document.getElementById('importFolderInput');
        if (importFolderInput) {
            importFolderInput.value = '';
            importFolderInput.click();
        } else {
            alert("Votre navigateur ne supporte pas l'accès direct aux dossiers. Veuillez utiliser Chrome, Edge, Brave ou Opera sur ordinateur.");
        }
        return;
    }

    let dirHandle;
    try {
        dirHandle = await window.showDirectoryPicker({ mode: 'read' });
    } catch (err) {
        if (err.name === 'AbortError') return; // L'utilisateur a cliqué sur Annuler
        console.error('[FolderPicker] Erreur:', err);
        alert("Impossible d'accéder au dossier : " + err.message);
        return;
    }

    if (!dirHandle) return;

    const btnSmartAdd = document.getElementById('btnSmartAdd');
    const origBtnHtml = btnSmartAdd ? btnSmartAdd.innerHTML : '';
    if (btnSmartAdd) {
        btnSmartAdd.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scan de "' + dirHandle.name + '"...';
        btnSmartAdd.disabled = true;
    }

    const smartAddModal = document.getElementById('smartAddModal');
    if (smartAddModal) smartAddModal.classList.add('hidden');
    const foldersModal = document.getElementById('foldersModal');
    if (foldersModal) foldersModal.classList.add('hidden');

    try {
        const foundFiles = [];
        async function scanDir(handle, subPath = '') {
            for await (const entry of handle.values()) {
                if (entry.kind === 'file') {
                    const ext = entry.name.split('.').pop().toLowerCase();
                    if (ext === 'epub' || ext === 'pdf') {
                        foundFiles.push({
                            entry: entry,
                            parentHandle: handle,
                            filename: entry.name,
                            subPath: subPath,
                            format: ext
                        });
                    }
                } else if (entry.kind === 'directory' && !entry.name.startsWith('.') && !entry.name.startsWith('$')) {
                    try {
                        const newSub = subPath ? (subPath + '/' + entry.name) : entry.name;
                        await scanDir(entry, newSub);
                    } catch(e) {}
                }
            }
        }

        await scanDir(dirHandle);

        if (foundFiles.length === 0) {
            alert('Aucun fichier .epub ou .pdf trouvé dans le dossier "' + dirHandle.name + '".');
            return;
        }

        const folderId = 'folder_' + dirHandle.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        await window.libraryDB.saveConnectedFolder({
            id: folderId,
            name: dirHandle.name,
            handle: dirHandle,
            bookCount: foundFiles.length,
            connectedAt: Date.now()
        });

        const seriesGroups = new Map();
        for (const item of foundFiles) {
            const parsed = parseLocalFilename(item.filename);
            let sTitle = parsed.seriesTitle;
            if (item.subPath) {
                const subParts = item.subPath.split('/');
                if (subParts.length > 0 && subParts[0].trim()) {
                    sTitle = subParts[0].trim();
                }
            }

            const seriesKey = sTitle.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
            const seriesId = 'local_series_' + seriesKey;

            if (!seriesGroups.has(seriesId)) {
                seriesGroups.set(seriesId, {
                    id: seriesId,
                    title: sTitle,
                    author: 'Dossier Local : ' + dirHandle.name,
                    cover: '/favicon.svg',
                    isLocalFsSeries: true,
                    folderId: folderId,
                    folderName: dirHandle.name,
                    addedAt: Date.now(),
                    volumes: []
                });
            }

            const sObj = seriesGroups.get(seriesId);
            const bookId = 'local_book_' + encodeURIComponent(folderId + '_' + (item.subPath ? item.subPath + '/' : '') + item.filename);

            const volObj = {
                id: bookId,
                seriesId: seriesId,
                title: parsed.volumeTitle,
                volumeNumber: parsed.volumeNumber,
                filename: item.filename,
                format: item.format,
                isLocalFsBook: true,
                folderId: folderId,
                folderName: dirHandle.name,
                cover: '/favicon.svg',
                progress: 0,
                lastReadDate: 0
            };

            sObj.volumes.push(volObj);

            await window.libraryDB.saveLocalFile({
                id: 'handle_' + bookId,
                type: 'file_handle',
                bookId: bookId,
                handle: item.entry,
                folderId: folderId,
                filename: item.filename
            });

            await window.libraryDB.saveBook(volObj);
        }

        for (const [sId, sData] of seriesGroups) {
            sData.volumes.sort((a, b) => (a.volumeNumber || 0) - (b.volumeNumber || 0));
            await window.libraryDB.saveLocalSeries(sData);
        }

        await initLibrary(true);
        if (typeof loadLinkedFoldersList === 'function') await loadLinkedFoldersList();

        alert('Dossier "' + dirHandle.name + '" connecté avec succès !\n' + foundFiles.length + ' livre(s) détecté(s) dans ' + seriesGroups.size + ' série(s).');

    } catch (scanErr) {
        console.error('[FolderScan] Erreur scan:', scanErr);
        alert('Erreur lors de la lecture des fichiers du dossier : ' + scanErr.message);
    } finally {
        if (btnSmartAdd) {
            btnSmartAdd.innerHTML = origBtnHtml;
            btnSmartAdd.disabled = false;
        }
    }
}
window.connectLocalFolderNative = connectLocalFolderNative;

﻿// library_logic.js - Ultra-Premium Library & Series Engine
let allBooks = [];
let allSeries = [];
let currentFilter = 'all';
let _libraryInitialized = false;

function getGuestSessionId() {
    let gid = localStorage.getItem('noveltrad_guest_id');
    if (!gid || !gid.startsWith('guest_')) {
        gid = 'guest_' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substring(2)));
        localStorage.setItem('noveltrad_guest_id', gid);
    }
    return gid;
}
window.getGuestSessionId = getGuestSessionId;

async function getAuthHeaders(extraHeaders = {}) {
    const headers = { ...extraHeaders };
    try {
        if (window.authManager) {
            if (window.authManager.initPromise) {
                await window.authManager.initPromise;
            }
            const token = await window.authManager.getAccessToken();
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
        }
    } catch (e) {
        console.warn('[Library Auth] Token lookup notice:', e);
    }
    // Option A : Si l'utilisateur n'est pas connecté, transmettre son Guest Session ID unique
    if (!headers['Authorization']) {
        headers['X-Guest-ID'] = getGuestSessionId();
    }
    return headers;
}

function resetLibraryCache() {
    allSeries = [];
    allBooks = [];
    _libraryInitialized = false;
    if (typeof renderLibrary === 'function') renderLibrary([]);
    if (typeof updateLibraryStats === 'function') updateLibraryStats();
    if (typeof updateContinueReadingHero === 'function') updateContinueReadingHero();
    if (typeof updateHomeDashboard === 'function') updateHomeDashboard([], []);
}
window.resetLibraryCache = resetLibraryCache;

let _catalogSeriesCache = null;
async function getCatalogSeriesMap() {
    if (_catalogSeriesCache) return _catalogSeriesCache;
    const map = new Map();
    try {
        const res = await fetch('/api/catalog');
        if (res.ok) {
            const data = await res.json();
            const list = data.novels || data.series || [];
            list.forEach(s => {
                if (s && s.id) map.set(s.id, s);
            });
            _catalogSeriesCache = map;
        }
    } catch (e) {
        console.warn('[Library] Catalog lookup notice:', e);
    }
    return map;
}

async function syncLocalBookmarkedSeriesAndProgress() {
    if (!window.libraryDB) return;
    try {
        if (window.libraryDB.initPromise) {
            await window.libraryDB.initPromise;
        }
        const [savedLibItems, savedFavs, localBooks, catalogMap, connectedLocalSeries] = await Promise.all([
            typeof window.libraryDB.getAllLocalLibrary === 'function' ? window.libraryDB.getAllLocalLibrary() : Promise.resolve([]),
            typeof window.libraryDB.getFavorites === 'function' ? window.libraryDB.getFavorites() : Promise.resolve([]),
            typeof window.libraryDB.getAllBooks === 'function' ? window.libraryDB.getAllBooks() : Promise.resolve([]),
            getCatalogSeriesMap(),
            typeof window.libraryDB.getAllLocalSeries === 'function' ? window.libraryDB.getAllLocalSeries() : Promise.resolve([])
        ]);

        // Injecter les séries issues de dossiers locaux connectés
        if (Array.isArray(connectedLocalSeries)) {
            for (const locSeries of connectedLocalSeries) {
                if (locSeries && locSeries.id && !allSeries.some(s => s.id === locSeries.id)) {
                    allSeries.push(locSeries);
                }
            }
        }

        const savedLibIds = new Set((savedLibItems || []).map(i => (i.id || i.seriesId || '').toLowerCase()).filter(Boolean));
        const favIdsSet = new Set((savedFavs || []).map(f => (f.id || '').toLowerCase()).filter(Boolean));

        // Retirer les séries issues des signets qui ont été supprimées de local_library
        allSeries = allSeries.filter(s => {
            if (s._isBookmarkedCatalogSeries) {
                return savedLibIds.has((s.id || '').toLowerCase());
            }
            return true;
        });

        // Ajouter les séries sauvegardées via "+ Ma bibliothèque" (Slider, Page Série, Catalogue)
        for (const bm of (savedLibItems || [])) {
            const bmId = bm.id || bm.seriesId;
            if (!bmId) continue;

            const alreadyExists = allSeries.some(s => (s.id || '').toLowerCase() === bmId.toLowerCase());
            if (!alreadyExists) {
                const catSeries = catalogMap.get(bmId) || Array.from(catalogMap.values()).find(c => (c.id || '').toLowerCase() === bmId.toLowerCase());
                const coverUrl = bm.cover || bm.coverUrl || catSeries?.cover || catSeries?.cover_url || catSeries?.coverImage || (catSeries?.metadata && catSeries.metadata.cover) || '';
                const authorName = bm.author || catSeries?.author || (catSeries?.metadata && catSeries.metadata.author) || 'Roman / Light Novel';

                let vols = [];
                if (catSeries && Array.isArray(catSeries.volumes) && catSeries.volumes.length > 0) {
                    vols = catSeries.volumes.map(v => ({
                        ...v,
                        id: v.id || (bmId + '_v' + (v.volumeNumber || 1)),
                        title: v.title || v.filename || (bm.title || catSeries.title),
                        format: v.format || (v.file_path && String(v.file_path).toLowerCase().endsWith('.pdf') ? 'pdf' : 'epub'),
                        cover: v.cover || v.cover_url || coverUrl
                    }));
                } else if (Array.isArray(bm.volumes) && bm.volumes.length > 0) {
                    vols = bm.volumes.map(v => ({
                        ...v,
                        format: v.format || 'epub',
                        cover: v.cover || v.cover_url || coverUrl
                    }));
                } else {
                    vols = [{
                        id: bmId + '_vol1',
                        title: (bm.title || catSeries?.title || 'Tome 1'),
                        format: bm.format || 'epub',
                        cover: coverUrl,
                        progress: 0
                    }];
                }

                allSeries.push({
                    id: bmId,
                    title: bm.title || catSeries?.title || bmId,
                    cover: coverUrl,
                    author: authorName,
                    metadata: {
                        ...(catSeries?.metadata || {}),
                        cover: coverUrl,
                        author: authorName
                    },
                    volumes: vols,
                    progress: 0,
                    lastReadDate: bm.addedAt || Date.now(),
                    hasFavorite: favIdsSet.has(bmId.toLowerCase()),
                    _isBookmarkedCatalogSeries: true
                });
            }
        }

        // Réconcilier la progression de lecture et les favoris pour toutes les séries
        const localMap = new Map((localBooks || []).map(b => [b.id, b]));
        const missingBooks = [];

        for (const series of allSeries) {
            let seriesProgress = 0;
            let volumesRead = 0;
            let lastReadDate = series.lastReadDate || 0;
            let hasFavorite = favIdsSet.has((series.id || '').toLowerCase()) || Boolean(series.hasFavorite);

            series.volumes = series.volumes || [];
            for (let i = 0; i < series.volumes.length; i++) {
                const item = series.volumes[i];
                let book = localMap.get(item.id);
                if (!book && !series._isBookmarkedCatalogSeries) {
                    book = {
                        id: item.id,
                        title: item.title || item.filename,
                        format: item.format || item.type || (item.filename && item.filename.endsWith('.pdf') ? 'pdf' : 'epub'),
                        file_path: item.file_path || item.filePath,
                        filePath: item.file_path || item.filePath,
                        fileKey: item.id,
                        progress: 0,
                        location: null,
                        lastReadDate: 0,
                        status: 'new'
                    };
                    missingBooks.push(book);
                }
                const fullBook = book ? { ...item, ...book } : item;
                series.volumes[i] = fullBook;

                if (fullBook.progress > 0) {
                    seriesProgress += fullBook.progress;
                    volumesRead++;
                }
                if (fullBook.lastReadDate && fullBook.lastReadDate > lastReadDate) {
                    lastReadDate = fullBook.lastReadDate;
                }
                if (fullBook.isFavorite) hasFavorite = true;
            }

            series.progress = series.volumes.length > 0 ? (seriesProgress / series.volumes.length) : 0;
            series.lastReadDate = lastReadDate;
            series.hasFavorite = hasFavorite;
        }

        for (const b of missingBooks) {
            window.libraryDB.saveBook(b).catch(() => {});
        }

        allBooks = allSeries.flatMap(s => s.volumes || []);
    } catch (e) {
        console.error('[Library] Error in syncLocalBookmarkedSeriesAndProgress:', e);
    }
}

async function initLibrary(force = false) {
    // log silenced' : '');

    if (force) {
        allSeries = [];
        allBooks = [];
        _libraryInitialized = false;
    } else if (_libraryInitialized) {
        await syncLocalBookmarkedSeriesAndProgress();
        renderLibrary(allSeries);
        updateLibraryStats();
        if (typeof updateContinueReadingHero === 'function') updateContinueReadingHero();
        if (typeof updateHomeDashboard === 'function') updateHomeDashboard(allSeries, allBooks);
        setupFiltersAndControls();
        return;
    }

    try {
        const headers = await getAuthHeaders();
        const response = await fetch('/api/library?t=' + Date.now(), { headers });
        if (response.ok) {
            const text = await response.text();
            try {
                const data = JSON.parse(text);
                allSeries = data.library || [];
            } catch (parseErr) {
                console.warn('[Library] Réponse non-JSON reçue pour /api/library');
                allSeries = [];
            }
        } else {
            console.warn('[Library] API /api/library returned HTTP', response.status);
            allSeries = [];
        }

        await syncLocalBookmarkedSeriesAndProgress();
        _libraryInitialized = true;

        updateLibraryStats();
        renderLibrary(allSeries);
        updateHomeDashboard(allSeries, allBooks);
        setupFiltersAndControls();
        setupHomeQuickActions();
        setupFoldersModal();
        setupSmartAddAndDragDrop();
        if (typeof updateContinueReadingHero === 'function') updateContinueReadingHero();
    } catch(err) {
        console.error('[Library] Error initializing:', err);
    }
}

function updateLibraryStats() {
    const totalSeriesEl = document.getElementById('libTotalSeries');
    const totalVolumesEl = document.getElementById('libTotalVolumes');
    const totalReadingEl = document.getElementById('libTotalReading');
    const totalCompletedEl = document.getElementById('libTotalCompleted');

    const countAllEl = document.getElementById('countAll');
    const countReadingEl = document.getElementById('countReading');
    const countFavoritesEl = document.getElementById('countFavorites');
    const countCompletedEl = document.getElementById('countCompleted');
    const countEpubEl = document.getElementById('countEpub');
    const countPdfEl = document.getElementById('countPdf');

    const totalSeries = allSeries.length;
    const totalVols = allBooks.length;
    
    let readingCount = 0;
    let completedCount = 0;
    let favCount = 0;
    let epubCount = 0;
    let pdfCount = 0;

    allSeries.forEach(s => {
        if (s.progress >= 100) completedCount++;
        else if (s.progress > 0) readingCount++;
        if (s.hasFavorite) favCount++;
        if ((s.volumes || []).some(v => v.format === 'epub')) epubCount++;
        if ((s.volumes || []).some(v => v.format === 'pdf')) pdfCount++;
    });

    if (totalSeriesEl) totalSeriesEl.textContent = totalSeries;
    if (totalVolumesEl) totalVolumesEl.textContent = totalVols;
    if (totalReadingEl) totalReadingEl.textContent = readingCount;
    if (totalCompletedEl) totalCompletedEl.textContent = completedCount;

    if (countAllEl) countAllEl.textContent = totalSeries;
    if (countReadingEl) countReadingEl.textContent = readingCount;
    if (countFavoritesEl) countFavoritesEl.textContent = favCount;
    if (countCompletedEl) countCompletedEl.textContent = completedCount;
    if (countEpubEl) countEpubEl.textContent = epubCount;
    if (countPdfEl) countPdfEl.textContent = pdfCount;
}
function renderLibrary(seriesList) {
    const grid = document.getElementById('libraryGrid');
    if(!grid) return;
    grid.innerHTML = '';
    
    const list = seriesList || allSeries || [];

    if (list.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1/-1; padding: 60px 20px; text-align: center; color: var(--text-secondary);">
                <i class="fa-solid fa-book-open" style="font-size: 36px; margin-bottom: 12px; display: block; opacity: 0.4;"></i>
                <h3 style="font-size: 16px; color: var(--text-primary); margin-bottom: 6px;">Aucun roman trouvé</h3>
                <p style="font-size: 13px; max-width: 400px; margin: 0 auto;">Aucune série ne correspond à vos filtres ou votre recherche actuelle.</p>
            </div>
        `;
        return;
    }

    // Reset PDF cover queue on each render (avoids stale elements from previous render)
    pdfCoverQueue = [];

    list.forEach(series => {
        let coverUrl = series.cover || series.cover_url || series.coverImage || series.metadata?.cover || '';
        if (!coverUrl && series.volumes && series.volumes.length > 0) {
            const v0 = series.volumes[0];
            coverUrl = v0.cover || v0.cover_url || `/api/download-job/${encodeURIComponent(v0.id)}/cover`;
        }
        if (!coverUrl) {
            coverUrl = `https://placehold.co/400x600/18181b/ffffff?text=${encodeURIComponent(series.title)}`;
        }

        const volCount = series.volumes ? series.volumes.length : 0;
        const volText = volCount + ' Vol.';
        
        let formatText = 'EPUB';
        const hasEpub = (series.volumes || []).some(v => v.format === 'epub');
        const hasPdf = (series.volumes || []).some(v => v.format === 'pdf');
        if (hasEpub && hasPdf) formatText = 'EPUB • PDF';
        else if (hasPdf) formatText = 'PDF';

        let statusBadge = '';
        if (series.progress >= 100) {
            statusBadge = '<span class="novel-card-badge-status completed">Terminé</span>';
        } else if (series.progress > 0) {
            statusBadge = `<span class="novel-card-badge-status reading">${Math.round(series.progress)}%</span>`;
        }

        const card = document.createElement('div');
        card.className = 'novel-series-card';
        card.dataset.seriesId = series.id;
        card.innerHTML = `
            <div class="novel-card-cover-wrap">
                <img src="${coverUrl}" alt="${series.title}" class="novel-card-cover" loading="lazy" decoding="async" onload="this.classList.add('loaded')" onerror="this.onerror=null;this.src='https://placehold.co/400x600/18181b/ffffff?text=${encodeURIComponent(series.title)}'">
                
                <span class="novel-card-badge-vols">${volText}</span>
                ${statusBadge}

                <button type="button" class="novel-card-fav-btn ${series.hasFavorite ? 'active' : ''}" title="${series.hasFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}">
                    <i class="${series.hasFavorite ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
                </button>

                <div class="novel-card-hover-overlay">
                    <div class="novel-card-play-icon">
                        <i class="fa-solid fa-play"></i>
                    </div>
                </div>

                ${series.progress > 0 ? `
                    <div class="novel-card-progress-bar">
                        <div class="novel-card-progress-fill" style="width: ${series.progress}%;"></div>
                    </div>
                ` : ''}
            </div>

            <div class="novel-card-info">
                <h3 class="novel-card-title" title="${series.title}">${series.title}</h3>
                <div class="novel-card-author">${series.metadata?.author || 'Roman / Light Novel'}</div>
                <div class="novel-card-footer-meta">
                    <span class="novel-card-format-tag">${formatText}</span>
                    <span>${volCount} tome${volCount > 1 ? 's' : ''}</span>
                </div>
            </div>
        `;

        card.addEventListener('click', (e) => {
            if (e.target.closest('.novel-card-fav-btn')) return;
            // Cliquer sur la carte ouvre toujours l'interface détaillée de la série pour voir et choisir les tomes
            openSeriesInfo(series);
        });

        // Clic sur toute la zone de la carte ou sur le survol -> ouvre toujours la fiche de la série pour choisir les tomes
        const playOverlay = card.querySelector('.novel-card-hover-overlay');
        if (playOverlay) {
            playOverlay.addEventListener('click', (e) => {
                e.stopPropagation();
                openSeriesInfo(series);
            });
        }

        const favBtn = card.querySelector('.novel-card-fav-btn');
        if (favBtn) {
            favBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const icon = favBtn.querySelector('i');
                const newFavState = !favBtn.classList.contains('active');

                favBtn.classList.toggle('active', newFavState);
                if (newFavState) {
                    icon.classList.remove('fa-regular');
                    icon.classList.add('fa-solid');
                } else {
                    icon.classList.remove('fa-solid');
                    icon.classList.add('fa-regular');
                }

                series.hasFavorite = newFavState;
                if (window.libraryDB && typeof window.libraryDB.toggleFavorite === 'function') {
                    await window.libraryDB.toggleFavorite({
                        id: series.id,
                        title: series.title,
                        cover: coverUrl,
                        format: 'epub'
                    }).catch(() => {});
                }
                for (const vol of (series.volumes || [])) {
                    vol.isFavorite = newFavState;
                    if (window.libraryDB && !series._isBookmarkedCatalogSeries) {
                        await window.libraryDB.saveBook(vol);
                    }
                }

                updateLibraryStats();

                if (currentFilter === 'favorites' && !newFavState) {
                    card.style.transition = 'opacity 0.25s, transform 0.25s';
                    card.style.opacity = '0';
                    card.style.transform = 'scale(0.9)';
                    setTimeout(() => card.remove(), 250);
                }
            });
        }

        grid.appendChild(card);
    });
}

async function openSeriesInfo(series) {
    window.location.href = `/series.html?id=${encodeURIComponent(series.id)}`;
}
function updateContinueReadingHero() {
    const hero = document.getElementById('continueReadingHero');
    if(!hero) return;
    
    let latest = null;
    let maxDate = 0;
    allBooks.forEach(b => {
        if(b.lastReadDate && b.lastReadDate > maxDate) {
            maxDate = b.lastReadDate;
            latest = b;
        }
    });

    if(latest) {
        hero.classList.remove('hidden');
        const heroTitle = hero.querySelector('#spotlightTitle') || hero.querySelector('.spotlight-title');
        const heroFormat = document.getElementById('heroFormat');
        const heroProgressFill = document.getElementById('heroProgressFill');
        const heroProgressText = document.getElementById('heroProgressText');
        const heroCover = document.getElementById('heroCover');
        const heroLastRead = document.getElementById('heroLastRead');
        const spotlightBackdrop = document.getElementById('spotlightBackdrop');
        const btn = document.getElementById('heroContinueBtn');

        if (heroTitle) heroTitle.textContent = latest.title;
        if (heroFormat) heroFormat.textContent = (latest.format || 'EPUB').toUpperCase();
        if (heroProgressFill) heroProgressFill.style.width = (latest.progress || 0) + '%';
        if (heroProgressText) heroProgressText.textContent = Math.round(latest.progress || 0) + '%';
        
        const coverUrl = `/api/download-job/${latest.id}/cover`;
        if (heroCover) {
            heroCover.src = coverUrl;
            heroCover.onerror = function() { this.src='https://placehold.co/400x600/18181b/ffffff?text=' + encodeURIComponent(latest.title); };
        }
        if (spotlightBackdrop) {
            spotlightBackdrop.style.backgroundImage = `url('${coverUrl}')`;
        }
        if (heroLastRead && latest.lastReadDate) {
            const date = new Date(latest.lastReadDate);
            heroLastRead.textContent = `Lu le ${date.toLocaleDateString('fr-FR')}`;
        }

        if (btn) btn.onclick = () => {
            const fullVol = (allBooks && allBooks.find(b => b.id === latest.id)) || latest;
            openReader(fullVol);
        };
    } else {
        hero.classList.add('hidden');
    }
}

function setupFiltersAndControls() {
    const searchInput = document.getElementById('librarySearchInput');
    const searchDropdown = document.getElementById('librarySearchDropdown');
    const sortSelect = document.getElementById('librarySortSelect');
    const pills = document.querySelectorAll('.lib-tab, .lib-pill, .btn-sub-sidebar');
    
    const btnViewGrid = document.getElementById('btnViewGrid');
    const btnViewList = document.getElementById('btnViewList');
    const libraryGrid = document.getElementById('libraryGrid');

    if(btnViewGrid && btnViewList && libraryGrid) {
        btnViewGrid.onclick = () => {
            libraryGrid.classList.remove('list-view');
            btnViewGrid.classList.add('active');
            btnViewList.classList.remove('active');
        };
        btnViewList.onclick = () => {
            libraryGrid.classList.add('list-view');
            btnViewList.classList.add('active');
            btnViewGrid.classList.remove('active');
        };
    }

    pills.forEach(pill => {
        pill.onclick = () => {
            pills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            currentFilter = pill.dataset.filter;
            applyFilters();
        };
    });

    function applyFilters() {
        let filtered = [...allSeries];
        
        // Filter purely by category tabs (Tous, EPUB, PDF, En cours, Terminés, Favoris)
        if(currentFilter === 'epub') {
            filtered = filtered.filter(s => (s.volumes || []).some(v => v.format === 'epub'));
        } else if(currentFilter === 'pdf') {
            filtered = filtered.filter(s => (s.volumes || []).some(v => v.format === 'pdf'));
        } else if(currentFilter === 'reading') {
            filtered = filtered.filter(s => s.progress > 0 && s.progress < 100);
        } else if(currentFilter === 'completed') {
            filtered = filtered.filter(s => s.progress >= 100);
        } else if(currentFilter === 'favorites') {
            filtered = filtered.filter(s => s.hasFavorite);
        }

        if(sortSelect) {
            const sortVal = sortSelect.value;
            if(sortVal === 'lastRead') {
                filtered.sort((a,b) => (b.lastReadDate || 0) - (a.lastReadDate || 0));
            } else if(sortVal === 'title') {
                filtered.sort((a,b) => a.title.localeCompare(b.title));
            } else if(sortVal === 'progress') {
                filtered.sort((a,b) => (b.progress || 0) - (a.progress || 0));
            } else if(sortVal === 'added') {
                filtered.sort((a,b) => b.id.localeCompare(a.id));
            }
        }

        renderLibrary(filtered);
    }

    if(sortSelect) {
        sortSelect.onchange = applyFilters;
    }

    // === SEARCH MODAL / DROPDOWN HANDLER ===
    if(searchInput && searchDropdown) {
        searchInput.oninput = (e) => {
            const q = e.target.value.toLowerCase().trim();
            
            searchDropdown.innerHTML = '';
            if (q === '') {
                searchDropdown.classList.add('hidden');
                return;
            }
            
            // 1. Search matching series
            const matchedSeries = allSeries.filter(s => 
                s.title.toLowerCase().includes(q) || 
                (s.metadata?.author && s.metadata.author.toLowerCase().includes(q)) ||
                (s.metadata?.genres && s.metadata.genres.some(g => g.toLowerCase().includes(q)))
            ).slice(0, 5);

            // 2. Search matching books/volumes
            const matchedBooks = allBooks.filter(b => 
                b.title.toLowerCase().includes(q)
            ).slice(0, 5);

            if(matchedSeries.length === 0 && matchedBooks.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'search-dropdown-empty';
                empty.innerHTML = '<i class="fa-solid fa-magnifying-glass" style="opacity:0.4; margin-right:8px;"></i> Aucun résultat pour "<strong>' + encodeURIComponent(q) + '</strong>"';
                searchDropdown.appendChild(empty);
            } else {
                // Header for Series results
                if(matchedSeries.length > 0) {
                    const seriesHeader = document.createElement('div');
                    seriesHeader.className = 'search-dropdown-section-title';
                    seriesHeader.innerHTML = '<i class="fa-solid fa-layer-group"></i> Séries & Collections';
                    searchDropdown.appendChild(seriesHeader);

                    matchedSeries.forEach(series => {
                        const item = document.createElement('div');
                        item.className = 'search-dropdown-item';
                        
                        let coverUrl = series.metadata?.cover || '';
                        if (!coverUrl && series.volumes && series.volumes.length > 0) {
                            coverUrl = `/api/download-job/${encodeURIComponent(series.volumes[0].id)}/cover`;
                        }
                        if (!coverUrl) {
                            coverUrl = `https://placehold.co/40x60/18181b/ffffff?text=${encodeURIComponent(series.title)}`;
                        }
                        
                        const img = document.createElement('img');
                        img.src = coverUrl;
                        img.onerror = () => { img.src = 'https://placehold.co/40x60/18181b/ffffff?text=?'; };
                        
                        const info = document.createElement('div');
                        info.className = 'search-dropdown-info';
                        info.innerHTML = `
                            <div class="search-dropdown-title">${series.title}</div>
                            <div class="search-dropdown-meta">
                                <span>${series.metadata?.author || 'Roman'}</span>
                                <span class="search-dropdown-tag">${series.volumes.length} tome${series.volumes.length > 1 ? 's' : ''}</span>
                            </div>
                        `;
                        
                        item.appendChild(img);
                        item.appendChild(info);
                        item.addEventListener('click', () => {
                            searchDropdown.classList.add('hidden');
                            searchInput.value = '';
                            openSeriesInfo(series);
                        });
                        
                        searchDropdown.appendChild(item);
                    });
                }

                // Header for Individual Books / Volumes
                if(matchedBooks.length > 0) {
                    const booksHeader = document.createElement('div');
                    booksHeader.className = 'search-dropdown-section-title';
                    booksHeader.innerHTML = '<i class="fa-solid fa-book"></i> Volumes & Documents';
                    searchDropdown.appendChild(booksHeader);

                    matchedBooks.forEach(book => {
                        const item = document.createElement('div');
                        item.className = 'search-dropdown-item';
                        
                        const img = document.createElement('img');
                        img.src = `/api/download-job/${encodeURIComponent(book.id)}/cover`;
                        img.onerror = () => { img.src = 'https://placehold.co/40x60/18181b/ffffff?text=?'; };
                        
                        const info = document.createElement('div');
                        info.className = 'search-dropdown-info';
                        info.innerHTML = `
                            <div class="search-dropdown-title">${book.title}</div>
                            <div class="search-dropdown-meta">
                                <span class="search-dropdown-tag format">${(book.format||'EPUB').toUpperCase()}</span>
                                ${book.progress > 0 ? `<span class="search-dropdown-progress">${book.progress}%</span>` : ''}
                            </div>
                        `;
                        
                        item.appendChild(img);
                        item.appendChild(info);
                        item.addEventListener('click', () => {
                            searchDropdown.classList.add('hidden');
                            searchInput.value = '';
                            const fullVol = (allBooks && allBooks.find(b => b.id === book.id)) || book;
                            openReader(fullVol);
                        });
                        
                        searchDropdown.appendChild(item);
                    });
                }
            }
            searchDropdown.classList.remove('hidden');
        };

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if(searchDropdown && !searchInput.contains(e.target) && !searchDropdown.contains(e.target)) {
                searchDropdown.classList.add('hidden');
            }
        });

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && searchDropdown && !searchDropdown.classList.contains('hidden')) {
                searchDropdown.classList.add('hidden');
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === '/' && document.activeElement !== searchInput && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
            e.preventDefault();
            if (searchInput) searchInput.focus();
        }
    });
}
function updateHomeDashboard(seriesList, booksList) {
    const sList = seriesList || allSeries || [];
    const bList = booksList || allBooks || [];

    const homeResumeCard = document.getElementById('homeResumeCard');
    if (homeResumeCard) {
        let latest = null;
        let maxDate = 0;
        bList.forEach(b => {
            if (b.lastReadDate && b.lastReadDate > maxDate) {
                maxDate = b.lastReadDate;
                latest = b;
            }
        });

        if (latest) {
            homeResumeCard.classList.remove('hidden');
            const titleEl = document.getElementById('homeResumeTitle');
            const formatEl = document.getElementById('homeResumeFormat');
            const fillEl = document.getElementById('homeResumeProgressFill');
            const textEl = document.getElementById('homeResumeProgressText');
            const coverEl = document.getElementById('homeResumeCover');
            const btnEl = document.getElementById('homeResumeBtn');

            if (titleEl) titleEl.textContent = latest.title;
            if (formatEl) formatEl.textContent = `${(latest.format || 'EPUB').toUpperCase()} "¢ EN COURS DE LECTURE`;
            if (fillEl) fillEl.style.width = (latest.progress || 0) + '%';
            if (textEl) textEl.textContent = Math.round(latest.progress || 0) + '%';
            if (coverEl) {
                coverEl.src = `/api/download-job/${latest.id}/cover`;
                coverEl.onerror = function() {
                    this.onerror = null;
                    this.src = 'https://placehold.co/400x600/18181b/ffffff?text=' + encodeURIComponent(latest.title);
                };
            }
            if (btnEl) {
                btnEl.onclick = () => {
                    const fullVol = (allBooks && allBooks.find(b => b.id === latest.id)) || latest;
                    openReader(fullVol);
                };
            }
        } else {
            homeResumeCard.classList.add('hidden');
        }
    }

    const featuredGrid = document.getElementById('homeFeaturedGrid');
    if (featuredGrid) {
        featuredGrid.innerHTML = '';
        if (sList.length === 0) {
            featuredGrid.innerHTML = `
                <div class="home-featured-loading">
                    <i class="fa-solid fa-book-bookmark" style="font-size: 24px; margin-bottom: 8px; display: block; opacity: 0.5;"></i>
                    Aucune série dans la bibliothèque pour le moment.<br>
                    <span style="font-size: 12px; color: var(--text-tertiary);">Ajoutez votre premier roman ou dossier pour commencer !</span>
                </div>
            `;
        } else {
            const featuredSeries = sList.slice(0, 6);
            featuredSeries.forEach(series => {
                const card = document.createElement('div');
                card.className = 'home-featured-card';

                let coverUrl = series.metadata?.cover || '';
                if (!coverUrl && series.volumes && series.volumes.length > 0) {
                    coverUrl = `/api/download-job/${series.volumes[0].id}/cover`;
                }
                if (!coverUrl) {
                    coverUrl = `https://placehold.co/400x600/18181b/ffffff?text=${encodeURIComponent(series.title)}`;
                }

                const volCount = series.volumes ? series.volumes.length : 0;
                const volText = volCount + ' Vol.';

                card.innerHTML = `
                    <div class="home-featured-cover-wrap">
                        <img src="${coverUrl}" alt="${series.title}" class="home-featured-cover" loading="lazy" onerror="this.onerror=null;this.src='https://placehold.co/400x600/18181b/ffffff?text=${encodeURIComponent(series.title)}'">
                        <span class="home-featured-badge">${volText}</span>
                    </div>
                    <div class="home-featured-info">
                        <div class="home-featured-title" title="${series.title}">${series.title}</div>
                        <div class="home-featured-meta">${series.metadata?.author || 'Roman / Manga'}</div>
                    </div>
                `;

                card.addEventListener('click', () => {
                    openSeriesInfo(series);
                });

                featuredGrid.appendChild(card);
            });
        }
    }
}

function setupHomeQuickActions() {
    const btnDocs = document.getElementById('homeBtnStartTranslate');
    const cardDocs = document.getElementById('homeCardDocs');
    const tabDocsBtn = document.getElementById('tabDocsBtn');

    const btnLib = document.getElementById('homeBtnOpenLibrary');
    const cardLib = document.getElementById('homeCardLibrary');
    const btnAllSeries = document.getElementById('homeViewAllSeriesBtn');
    const tabLibraryBtn = document.getElementById('tabLibraryBtn');

            
    if (btnDocs && tabDocsBtn) btnDocs.onclick = () => tabDocsBtn.click();
    if (cardDocs && tabDocsBtn) cardDocs.onclick = () => tabDocsBtn.click();

    if (btnLib && tabLibraryBtn) btnLib.onclick = () => tabLibraryBtn.click();
    if (cardLib && tabLibraryBtn) cardLib.onclick = () => tabLibraryBtn.click();
    if (btnAllSeries && tabLibraryBtn) btnAllSeries.onclick = () => tabLibraryBtn.click();

        }

async function loadLinkedFoldersList() {
    const listEl = document.getElementById('linkedFoldersList');
    const countEl = document.getElementById('foldersCount');

    if (listEl) {
        listEl.innerHTML = '<div style="color: var(--text-secondary); font-size: 13px; padding: 12px;"><i class="fa-solid fa-spinner fa-spin"></i> Chargement des dossiers...</div>';
    }

    try {
        let localFolders = [];
        if (window.libraryDB && typeof window.libraryDB.getConnectedFolders === 'function') {
            localFolders = await window.libraryDB.getConnectedFolders();
        }

        let serverPaths = [];
        const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        if (isLocalHost) {
            try {
                const headers = await getAuthHeaders();
                const res = await fetch('/api/library/paths?t=' + Date.now(), { headers });
                const data = await res.json();
                serverPaths = (data.paths || []).map(item => {
                    if (typeof item === 'string') return { path: item, exists: true, bookCount: 0, isServer: true };
                    return { ...item, isServer: true };
                });
            } catch (e) {}
        }

        const totalCount = localFolders.length + serverPaths.length;
        if (countEl) countEl.textContent = totalCount;

        if (!listEl) return;

        if (totalCount === 0) {
            listEl.innerHTML = `
                <div style="color: var(--text-secondary); font-size: 13px; text-align: center; padding: 20px; background: var(--bg-elevated); border: 1px dashed var(--border-color); border-radius: var(--radius-md);">
                    <i class="fa-solid fa-folder-open" style="font-size: 24px; opacity: 0.4; margin-bottom: 8px; display: block;"></i>
                    Aucun dossier connecté pour le moment.
                </div>
            `;
            return;
        }

        listEl.innerHTML = '';

        // 1. Afficher d'abord les dossiers locaux du PC
        for (const folder of localFolders) {
            const item = document.createElement('div');
            item.className = 'linked-folder-item';
            item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-sm); gap: 10px; transition: border-color 0.2s;';
            item.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px; overflow: hidden; min-width: 0; flex: 1;">
                    <i class="fa-solid fa-laptop" style="color: #60a5fa; font-size: 18px; flex-shrink: 0;"></i>
                    <div style="display: flex; flex-direction: column; min-width: 0; overflow: hidden;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <strong style="font-size: 13px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${folder.name}</strong>
                            <span style="font-size: 11px; background: rgba(59,130,246,0.15); color: #93c5fd; padding: 1px 6px; border-radius: 4px; font-weight: 600;">PC Local</span>
                            <span style="font-size: 11px; background: rgba(167,139,250,0.15); color: #c4b5fd; padding: 1px 6px; border-radius: 4px; font-weight: 600;">${folder.bookCount || 0} livre(s)</span>
                        </div>
                        <span style="font-size: 11.5px; color: var(--text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Zéro-Copie &bull; Lu directement depuis ce PC</span>
                    </div>
                </div>
                <button type="button" class="btn btn-icon-glass btn-sm btn-remove-local-folder" title="Délier ce dossier" style="flex-shrink: 0; color: #ef4444;">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            `;
            const remBtn = item.querySelector('.btn-remove-local-folder');
            if (remBtn) {
                remBtn.onclick = async () => {
                    if (!confirm(`Délier le dossier local "${folder.name}" de votre bibliothèque ?\n(Vos fichiers sur votre PC restent intacts).`)) return;
                    remBtn.disabled = true;
                    remBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                    await window.libraryDB.removeConnectedFolder(folder.id);
                    await loadLinkedFoldersList();
                    await initLibrary(true);
                };
            }
            listEl.appendChild(item);
        }

        // 2. Afficher les dossiers serveur si présents
        for (const entry of serverPaths) {
            const folderPath = entry.path;
            const bookCount = entry.bookCount || 0;
            const folderName = folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath;
            const item = document.createElement('div');
            item.className = 'linked-folder-item';
            item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-sm); gap: 10px; transition: border-color 0.2s;';
            item.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px; overflow: hidden; min-width: 0; flex: 1;">
                    <i class="fa-solid fa-folder-tree" style="color: #a78bfa; font-size: 18px; flex-shrink: 0;"></i>
                    <div style="display: flex; flex-direction: column; min-width: 0; overflow: hidden;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <strong style="font-size: 13px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${folderName}</strong>
                            <span style="font-size: 11px; background: rgba(167,139,250,0.15); color: #c4b5fd; padding: 1px 6px; border-radius: 4px; font-weight: 600;">${bookCount} livre(s)</span>
                        </div>
                        <span style="font-size: 11.5px; color: var(--text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${folderPath}">${folderPath}</span>
                    </div>
                </div>
                <button type="button" class="btn btn-icon-glass btn-sm btn-remove-folder" title="Délier ce dossier" style="flex-shrink: 0; color: #ef4444;">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            `;
            const removeBtn = item.querySelector('.btn-remove-folder');
            if (removeBtn) {
                removeBtn.onclick = async () => {
                    if (!confirm(`Délier le dossier "${folderName}" de votre bibliothèque ?`)) return;
                    removeBtn.disabled = true;
                    removeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                    try {
                        const delHeaders = await getAuthHeaders({ 'Content-Type': 'application/json' });
                        await fetch('/api/library/remove-path', {
                            method: 'POST',
                            headers: delHeaders,
                            body: JSON.stringify({ folderPath: folderPath })
                        });
                        await loadLinkedFoldersList();
                        await initLibrary(true);
                    } catch (e) {
                        alert('Erreur lors de la suppression.');
                    }
                };
            }
            listEl.appendChild(item);
        }
    } catch (e) {
        if (listEl) listEl.innerHTML = '<div style="color: #ef4444; font-size: 13px; padding: 12px;">Erreur de chargement des dossiers liés.</div>';
    }
}

let currentExplorePath = '';

async function navigateFs(dirPath) {
    const inputPath = document.getElementById('inputFolderPath');
    const driveBtns = document.getElementById('fsDriveButtons');
    const parentBtn = document.getElementById('btnFsParentDir');
    const bookBadge = document.getElementById('fsBookCountBadge');
    const folderBadge = document.getElementById('fsFolderCountBadge');
    const folderGrid = document.getElementById('fsFolderGrid');
    const feedback = document.getElementById('folderAddFeedback');

    if (feedback) feedback.classList.add('hidden');
    if (folderGrid) folderGrid.innerHTML = '<div style="color: var(--text-tertiary); font-size: 12px; padding: 12px; grid-column: 1/-1;"><i class="fa-solid fa-spinner fa-spin"></i> Chargement...</div>';

    try {
        const url = dirPath ? `/api/library/explore-fs?dir=${encodeURIComponent(dirPath)}` : '/api/library/explore-fs';
        const res = await fetch(url);
        const data = await res.json();

        if (!data.success) {
            if (folderGrid) folderGrid.innerHTML = `<div style="color:#ef4444; font-size:12px; padding:12px; grid-column: 1/-1;">${data.message || 'Erreur d\'accès'}</div>`;
            return;
        }

        currentExplorePath = data.currentPath;
        if (inputPath) inputPath.value = currentExplorePath;

        // Render drive buttons
        if (driveBtns && data.drives) {
            driveBtns.innerHTML = '';
            data.drives.forEach(drive => {
                const dBtn = document.createElement('button');
                dBtn.type = 'button';
                dBtn.className = 'btn btn-secondary btn-sm';
                dBtn.style.cssText = 'padding: 3px 8px; font-size: 11px; font-weight: 600;';
                dBtn.textContent = drive;
                if (currentExplorePath.toUpperCase().startsWith(drive.toUpperCase())) {
                    dBtn.style.borderColor = '#a78bfa';
                    dBtn.style.color = '#c4b5fd';
                }
                dBtn.onclick = () => navigateFs(drive);
                driveBtns.appendChild(dBtn);
            });
        }

        // Parent button
        if (parentBtn) {
            if (data.parentPath) {
                parentBtn.disabled = false;
                parentBtn.style.opacity = '1';
                parentBtn.onclick = () => navigateFs(data.parentPath);
            } else {
                parentBtn.disabled = true;
                parentBtn.style.opacity = '0.4';
                parentBtn.onclick = null;
            }
        }

        // Badges
        if (bookBadge) {
            if (data.bookCount > 0) {
                bookBadge.innerHTML = `<i class="fa-solid fa-book-open" style="color: #4ade80;"></i> <strong style="color: #4ade80;">${data.bookCount} livre(s)</strong> (EPUB / PDF) détecté(s)`;
            } else {
                bookBadge.innerHTML = '<i class="fa-solid fa-folder"></i> 0 livre dans ce dossier';
            }
        }
        if (folderBadge) {
            folderBadge.textContent = `${data.folders.length} sous-dossier(s)`;
        }

        // Folders list
        if (folderGrid) {
            if (data.folders.length === 0) {
                folderGrid.innerHTML = '<div style="color: var(--text-tertiary); font-size: 12px; padding: 12px; grid-column: 1/-1; text-align: center;">Aucun sous-dossier.</div>';
            } else {
                folderGrid.innerHTML = '';
                data.folders.forEach(folderName => {
                    const item = document.createElement('div');
                    item.style.cssText = 'display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer; transition: all 0.15s; font-size: 12px; color: var(--text-primary); user-select: none; overflow: hidden;';
                    item.innerHTML = `
                        <i class="fa-solid fa-folder" style="color: #60a5fa; font-size: 13px; flex-shrink: 0;"></i>
                        <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${folderName}">${folderName}</span>
                    `;
                    item.onmouseover = () => {
                        item.style.background = 'rgba(255,255,255,0.08)';
                        item.style.borderColor = 'rgba(255,255,255,0.2)';
                    };
                    item.onmouseout = () => {
                        item.style.background = 'var(--bg-card)';
                        item.style.borderColor = 'var(--border-color)';
                    };
                    item.onclick = () => {
                        const separator = currentExplorePath.endsWith('\\') || currentExplorePath.endsWith('/') ? '' : '\\';
                        navigateFs(currentExplorePath + separator + folderName);
                    };
                    folderGrid.appendChild(item);
                });
            }
        }

    } catch (e) {
        if (folderGrid) folderGrid.innerHTML = '<div style="color:#ef4444; font-size:12px; padding:12px; grid-column: 1/-1;">Erreur de connexion.</div>';
    }
}

function setupFoldersModal() {
    const btnManage = document.getElementById('btnManageFolders');
    const modal = document.getElementById('foldersModal');
    const closeBtn = document.getElementById('closeFoldersModal');
    const doneBtn = document.getElementById('btnDoneFoldersModal');
    const addBtn = document.getElementById('btnAddFolderPath');
    const inputPath = document.getElementById('inputFolderPath');
    const feedback = document.getElementById('folderAddFeedback');

    if (!modal) return;

    function openModal() {
        modal.classList.remove('hidden');
        if (feedback) feedback.classList.add('hidden');
        loadLinkedFoldersList();

        const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const fsCard = modal.querySelector('.fs-explorer-card');
        const manualBox = document.getElementById('inputFolderPath')?.closest('div');
        if (!isLocalHost) {
            if (fsCard) fsCard.style.display = 'none';
            if (manualBox) manualBox.style.display = 'none';
        } else {
            if (fsCard) fsCard.style.display = 'flex';
            if (manualBox) manualBox.style.display = 'block';
            navigateFs(currentExplorePath || '');
        }
    }

    function closeModal() {
        modal.classList.add('hidden');
    }

    if (btnManage) btnManage.onclick = openModal;
    if (closeBtn) closeBtn.onclick = closeModal;
    if (doneBtn) doneBtn.onclick = closeModal;

    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };

    if (inputPath) {
        inputPath.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                navigateFs(inputPath.value.trim());
            }
        });
    }

    if (addBtn && inputPath) {
        addBtn.onclick = async () => {
            const folderPath = inputPath.value.trim();
            if (!folderPath) {
                if (feedback) {
                    feedback.textContent = 'Veuillez saisir ou choisir un chemin de dossier.';
                    feedback.style.color = '#ef4444';
                    feedback.classList.remove('hidden');
                }
                return;
            }

            const origText = addBtn.innerHTML;
            addBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Liaison...';
            addBtn.disabled = true;

            try {
                const addHeaders = await getAuthHeaders({ 'Content-Type': 'application/json' });
                const res = await fetch('/api/library/add-path', {
                    method: 'POST',
                    headers: addHeaders,
                    body: JSON.stringify({ folderPath })
                });
                const data = await res.json();

                if (data.success) {
                    if (feedback) {
                        feedback.textContent = data.message;
                        feedback.style.color = '#4ade80';
                        feedback.classList.remove('hidden');
                    }
                    await loadLinkedFoldersList();
                    await initLibrary(true);
                } else {
                    if (feedback) {
                        feedback.textContent = data.message || 'Erreur lors de l ajout.';
                        feedback.style.color = '#ef4444';
                        feedback.classList.remove('hidden');
                    }
                }
            } catch (err) {
                if (feedback) {
                    feedback.textContent = 'Erreur de connexion au serveur.';
                    feedback.style.color = '#ef4444';
                    feedback.classList.remove('hidden');
                }
            } finally {
                addBtn.innerHTML = origText;
                addBtn.disabled = false;
            }
        };
    }
}

async function triggerNativeFolderPicker() {
    const isMobile = () => ('ontouchstart' in window) || (window.innerWidth <= 768);
    const importFilesInput = document.getElementById('importFilesInput');

    const smartAddModal = document.getElementById('smartAddModal');
    if (smartAddModal) smartAddModal.classList.add('hidden');

    // Sur mobile, ouvrir le sélecteur de fichiers
    if (isMobile() && importFilesInput) {
        importFilesInput.value = '';
        importFilesInput.click();
        return;
    }

    // Sur Desktop, utiliser l'API File System Access native si supportée (Zéro-Copie direct)
    if (typeof window.showDirectoryPicker === 'function') {
        return connectLocalFolderNative();
    }

    // Repli webkitdirectory
    const importFolderInput = document.getElementById('importFolderInput');
    if (importFolderInput) {
        importFolderInput.value = '';
        importFolderInput.click();
    } else {
        const foldersModal = document.getElementById('foldersModal');
        if (foldersModal) {
            foldersModal.classList.remove('hidden');
            if (typeof loadLinkedFoldersList === 'function') await loadLinkedFoldersList();
        }
    }
}

const browseNativeFolder = triggerNativeFolderPicker;
window.triggerNativeFolderPicker = triggerNativeFolderPicker;
window.browseNativeFolder = triggerNativeFolderPicker;


async function triggerNativeFilePicker() {
    const actionFiles = document.getElementById('actionPickFiles');
    const setBtnState = (loading) => {
        if (actionFiles) {
            actionFiles.style.opacity = loading ? '0.6' : '1';
            actionFiles.style.pointerEvents = loading ? 'none' : 'auto';
        }
    };

    setBtnState(true);
    try {
        const token = window.authManager ? await window.authManager.getAccessToken() : null;
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/api/library/browse-native-files', { 
            method: 'POST',
            headers
        });
        const data = await res.json();
        if (data.success) {
            await initLibrary(true);
            const smartAddModal = document.getElementById('smartAddModal');
            if (smartAddModal) smartAddModal.classList.add('hidden');
        } else if (data.message && data.message !== 'Sélection annulée.' && !data.message.includes('indisponible')) {
            alert(data.message);
        } else if (data.message && data.message.includes('indisponible')) {
            // Fallback mobile ou environnement non-Windows
            const importFilesInput = document.getElementById('importFilesInput');
            if (importFilesInput) {
                importFilesInput.value = '';
                importFilesInput.click();
            }
        }
    } catch (e) {
        console.error('Native file browse error:', e);
        const importFilesInput = document.getElementById('importFilesInput');
        if (importFilesInput) {
            importFilesInput.value = '';
            importFilesInput.click();
        }
    } finally {
        setBtnState(false);
    }
}
window.triggerNativeFilePicker = triggerNativeFilePicker;

async function uploadFilesToLibrary(fileList) {
    if (!fileList || fileList.length === 0) return;
    
    const validFiles = Array.from(fileList).filter(f => {
        const name = f.name.toLowerCase();
        return name.endsWith('.epub') || name.endsWith('.pdf');
    });

    if (validFiles.length === 0) {
        alert("Aucun fichier .epub ou .pdf détecté dans la sélection.");
        return;
    }

    const btnSmartAdd = document.getElementById('btnSmartAdd');
    const origHtml = btnSmartAdd ? btnSmartAdd.innerHTML : '';
    if (btnSmartAdd) {
        btnSmartAdd.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Ajout (${validFiles.length})...`;
        btnSmartAdd.disabled = true;
    }

    try {
        const formData = new FormData();
        validFiles.forEach(f => formData.append('files', f));

        const uploadHeaders = await getAuthHeaders();
        const res = await fetch('/api/library/upload-files', {
            method: 'POST',
            headers: uploadHeaders,
            body: formData
        });
        const data = await res.json();

        if (data.success) {
            await initLibrary(true);
        } else {
            alert(data.message || "Erreur lors de l'importation.");
        }
    } catch (e) {
        console.error("Upload error:", e);
        alert("Erreur lors de l'envoi des fichiers au serveur.");
    } finally {
        if (btnSmartAdd) {
            btnSmartAdd.innerHTML = origHtml;
            btnSmartAdd.disabled = false;
        }
    }
}


function setupSmartAddAndDragDrop() {
    const btnSmartAdd = document.getElementById('btnSmartAdd');
    const smartAddModal = document.getElementById('smartAddModal');
    const closeSmartAdd = document.getElementById('closeSmartAddModal');

    const actionBrowseNative = document.getElementById('actionBrowseNative');
    const actionPickFiles = document.getElementById('actionPickFiles');
    const actionPickFolder = document.getElementById('actionPickFolder');

    const importFilesInput = document.getElementById('importFilesInput');
    const importFolderInput = document.getElementById('importFolderInput');

    const isMobile = () => ('ontouchstart' in window) || (window.innerWidth <= 768);

    if (btnSmartAdd) {
        btnSmartAdd.onclick = () => {
            if (isMobile() && importFilesInput) {
                importFilesInput.value = '';
                importFilesInput.click();
            } else if (smartAddModal) {
                smartAddModal.classList.remove('hidden');
            }
        };
    }

    if (closeSmartAdd && smartAddModal) {
        closeSmartAdd.onclick = () => smartAddModal.classList.add('hidden');
        smartAddModal.onclick = (e) => {
            if (e.target === smartAddModal) smartAddModal.classList.add('hidden');
        };
    }

    // Direct Windows Explorer Folder Picker (Zero copy - direct path link)
    if (actionBrowseNative) {
        actionBrowseNative.onclick = () => {
            triggerNativeFolderPicker();
        };
    }

    // Direct Windows Explorer File Picker (Zero-copy direct file link)
    if (actionPickFiles) {
        actionPickFiles.onclick = () => {
            if (smartAddModal) smartAddModal.classList.add('hidden');
            triggerNativeFilePicker();
        };
    }

    // Direct Folder Picker
    if (actionPickFolder) {
        actionPickFolder.onclick = () => {
            if (smartAddModal) smartAddModal.classList.add('hidden');
            const foldersModal = document.getElementById('foldersModal');
            if (foldersModal) {
                foldersModal.classList.remove('hidden');
                if (typeof loadLinkedFoldersList === 'function') loadLinkedFoldersList();
                if (typeof navigateFs === 'function') navigateFs(currentExplorePath || '');
            }
        };
    }

    if (importFilesInput) {
        importFilesInput.onchange = (e) => {
            uploadFilesToLibrary(e.target.files);
            importFilesInput.value = '';
        };
    }

    if (importFolderInput) {
        importFolderInput.onchange = async (e) => {
            const files = Array.from(e.target.files || []);
            importFolderInput.value = '';
            if (files.length === 0) return;

            const validFiles = files.filter(f => {
                const name = f.name.toLowerCase();
                return name.endsWith('.epub') || name.endsWith('.pdf');
            });

            // Extraire le nom du dossier racine depuis webkitRelativePath
            const firstWithRelative = files.find(f => f.webkitRelativePath);
            const folderName = firstWithRelative
                ? firstWithRelative.webkitRelativePath.split('/')[0]
                : 'light novel';

            const sampleFiles = validFiles.slice(0, 5).map(f => f.name);

            const btnSmartAdd = document.getElementById('btnSmartAdd');
            const origHtml = btnSmartAdd ? btnSmartAdd.innerHTML : '';
            if (btnSmartAdd) {
                btnSmartAdd.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Connexion Zéro Copie...`;
                btnSmartAdd.disabled = true;
            }

            try {
                const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
                const res = await fetch('/api/library/resolve-and-link-folder', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ folderName, sampleFiles })
                });
                const data = await res.json();

                if (data.success) {
                    if (typeof loadLinkedFoldersList === 'function') await loadLinkedFoldersList();
                    await initLibrary(true);
                } else {
                    // Fallback vers l'explorateur visuel si le dossier n'est pas dans un emplacement standard
                    const foldersModal = document.getElementById('foldersModal');
                    if (foldersModal) {
                        foldersModal.classList.remove('hidden');
                        if (typeof navigateFs === 'function') navigateFs(folderName);
                    }
                }
            } catch (err) {
                console.error("Link folder error:", err);
            } finally {
                if (btnSmartAdd) {
                    btnSmartAdd.innerHTML = origHtml;
                    btnSmartAdd.disabled = false;
                }
            }
        };
    }

    const libModule = document.getElementById('libraryModule');
    const dropOverlay = document.getElementById('libraryDropOverlay');

    if (libModule && dropOverlay) {
        let dragCounter = 0;

        window.addEventListener('dragenter', (e) => {
            if (!libModule.classList.contains('hidden') && libModule.style.display !== 'none') {
                dragCounter++;
                dropOverlay.classList.remove('hidden');
            }
        });

        window.addEventListener('dragleave', (e) => {
            if (!libModule.classList.contains('hidden') && libModule.style.display !== 'none') {
                dragCounter--;
                if (dragCounter <= 0) {
                    dragCounter = 0;
                    dropOverlay.classList.add('hidden');
                }
            }
        });

        window.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        window.addEventListener('drop', (e) => {
            e.preventDefault();
            dragCounter = 0;
            dropOverlay.classList.add('hidden');
            if (!libModule.classList.contains('hidden') && libModule.style.display !== 'none') {
                // Mode Zéro Copie : Au lieu d'uploader et dupliquer les fichiers sur le disque,
                // orienter vers le sélecteur natif Zéro Copie
                if (window.authManager && typeof window.authManager.showToast === 'function') {
                    window.authManager.showToast("Mode Zéro Copie : Choisissez votre dossier pour le connecter sans consommer d'espace disque.");
                }
                triggerNativeFolderPicker();
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setupFoldersModal();
    setupSmartAddAndDragDrop();
    // Note: initLibrary() is called by app.js tab click handlers, not on DOMContentLoaded
    // to avoid fetching while module is hidden. Pre-fetch silently in background:
    getAuthHeaders().then(headers => {
        return fetch('/api/library?t=' + Date.now(), { headers });
    }).then(r => r.json()).then(data => {
        if (data && data.library) {
            allSeries = data.library;
            allBooks = allSeries.flatMap(s => s.volumes || []);
            _libraryInitialized = true;
            updateHomeDashboard(allSeries, allBooks);
        }
    }).catch(() => {});
});
