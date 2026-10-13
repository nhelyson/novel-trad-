/**
 * webnovel_reader.js - Liseuse Webnovel Dédiée pour NovelTrad (Guest First)
 * Permet la lecture fluide en ligne par chapitres défilants avec :
 * - Navigation Chapitre Précédent / Suivant / Sommaire
 * - Réglage précis de la taille de police et interligne
 * - Thèmes Clair, Sépia, Sombre
 * - Sauvegarde & Restauration automatique de la position dans IndexedDB
 */

"use strict";

(function() {
    let currentSeries = null;
    let currentChapterNum = 1;
    let currentChapterData = null;
    let scrollDebounceTimer = null;

    let readerSettings = {
        theme: 'dark',
        fontSize: 18,
        lineHeight: 1.8,
        fontFamily: 'Inter, sans-serif'
    };

    // Load saved preferences
    async function loadSettings() {
        if (window.libraryDB) {
            const saved = await window.libraryDB.getPreferences();
            if (saved && saved.webnovel) {
                readerSettings = { ...readerSettings, ...saved.webnovel };
            }
        }
    }

    function applySettings() {
        const overlay = document.getElementById('webnovelReaderOverlay');
        const content = document.getElementById('webnovelContent');
        if (!overlay || !content) return;

        // Theme
        overlay.setAttribute('data-theme', readerSettings.theme);

        // Font
        content.style.fontSize = readerSettings.fontSize + 'px';
        content.style.lineHeight = readerSettings.lineHeight;
        content.style.fontFamily = readerSettings.fontFamily;

        // Update UI controls
        const fontDisplay = document.getElementById('wnFontSizeDisplay');
        if (fontDisplay) fontDisplay.textContent = readerSettings.fontSize + 'px';

        document.querySelectorAll('.wn-theme-btn').forEach(btn => {
            if (btn.getAttribute('data-theme') === readerSettings.theme) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    async function saveSettings() {
        if (window.libraryDB) {
            const allPrefs = (await window.libraryDB.getPreferences()) || {};
            allPrefs.webnovel = readerSettings;
            await window.libraryDB.savePreferences(allPrefs);
        }
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================
    // API Dédiée : Lecture Rapide par Chapitre pour Volume EPUB (Mode Éco 30 Ko)
    window.openVolumeWebnovelReader = async function(volumeKey, chapterNum = 1, volumeTitle = '') {
        await loadSettings();
        currentChapterNum = parseInt(chapterNum) || 1;

        const overlay = document.getElementById('webnovelReaderOverlay');
        const titleEl = document.getElementById('wnReaderTitle');
        const chapterTitleEl = document.getElementById('wnChapterTitle');
        const contentEl = document.getElementById('webnovelContent');
        const loader = document.getElementById('wnLoader');

        if (!overlay || !contentEl) return;

        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        applySettings();

        if (loader) loader.style.display = 'flex';
        contentEl.innerHTML = '';
        if (titleEl) titleEl.textContent = volumeTitle || 'Lecture Rapide';

        window._activeVolumeContext = {
            isVolume: true,
            volumeKey: volumeKey,
            volumeTitle: volumeTitle || 'Volume'
        };

        try {
            await loadVolumeChapter(volumeKey, currentChapterNum);
        } catch (err) {
            console.error('[VolumeWebnovel] Error:', err);
            if (loader) loader.style.display = 'none';
            contentEl.innerHTML = `<div class="wn-error-msg"><i class="fa-solid fa-circle-exclamation"></i> Impossible de charger ce chapitre.<br><small>${err.message}</small></div>`;
        }
    };

    async function loadVolumeChapter(volumeKey, chapterNum) {
        currentChapterNum = parseInt(chapterNum);
        const contentEl = document.getElementById('webnovelContent');
        const chapterTitleEl = document.getElementById('wnChapterTitle');
        const loader = document.getElementById('wnLoader');
        const scrollContainer = document.getElementById('wnScrollContainer');

        if (loader) loader.style.display = 'flex';

        const cleanKey = volumeKey.replace(/\.(epub|pdf)$/i, '').replace(/^.*[/\\]/, '');
        const res = await fetch(`/api/volume-chapters/${encodeURIComponent(cleanKey)}/${currentChapterNum}`);
        const data = await res.json();

        if (loader) loader.style.display = 'none';

        if (data.success && data.chapter) {
            currentChapterData = data.chapter;
            window._activeVolumeContext.totalChapters = data.totalChapters || 1;
            if (chapterTitleEl) chapterTitleEl.textContent = data.chapter.title || `Chapitre ${currentChapterNum}`;

            contentEl.innerHTML = `
                <div class="wn-chapter-header">
                    <span class="wn-series-badge"><i class="fa-solid fa-bolt" style="color:#e11d48;"></i> ${window._activeVolumeContext.volumeTitle} (Mode Rapide)</span>
                    <h2>${data.chapter.title}</h2>
                </div>
                <div class="wn-chapter-text">${data.chapter.content}</div>
                <div class="wn-chapter-footer">
                    <div class="wn-nav-buttons">
                        <button id="wnFooterPrevBtn" class="btn btn-secondary" ${currentChapterNum <= 1 ? 'disabled' : ''}>
                            <i class="fa-solid fa-arrow-left"></i> Précédent
                        </button>
                        <button id="wnFooterNextBtn" class="btn btn-primary" ${currentChapterNum >= (data.totalChapters || 1) ? 'disabled' : ''}>
                            Suivant <i class="fa-solid fa-arrow-right"></i>
                        </button>
                    </div>
                </div>
            `;

            const prevBtn = document.getElementById('wnFooterPrevBtn');
            const nextBtn = document.getElementById('wnFooterNextBtn');
            if (prevBtn) prevBtn.onclick = () => {
                if (currentChapterNum > 1) loadVolumeChapter(cleanKey, currentChapterNum - 1);
            };
            if (nextBtn) nextBtn.onclick = () => {
                if (currentChapterNum < (data.totalChapters || 1)) loadVolumeChapter(cleanKey, currentChapterNum + 1);
            };

            if (scrollContainer) scrollContainer.scrollTop = 0;

            // Mettre à jour le pourcentage
            const progText = document.getElementById('wnProgressText');
            if (progText && data.totalChapters > 0) {
                progText.textContent = Math.round((currentChapterNum / data.totalChapters) * 100) + '%';
            }
        } else {
            throw new Error(data.message || 'Chapitre introuvable');
        }
    }

    window.openWebnovelReader = async function(seriesId, chapterNum = 1, initialScroll = 0) {
        await loadSettings();
        currentChapterNum = parseInt(chapterNum) || 1;

        const overlay = document.getElementById('webnovelReaderOverlay');
        const titleEl = document.getElementById('wnReaderTitle');
        const chapterTitleEl = document.getElementById('wnChapterTitle');
        const contentEl = document.getElementById('webnovelContent');
        const loader = document.getElementById('wnLoader');

        if (!overlay || !contentEl) {
            console.error('[WebnovelReader] Overlay element not found in DOM');
            return;
        }

        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        applySettings();

        if (loader) loader.style.display = 'flex';
        contentEl.innerHTML = '';

        try {
            // 1. Fetch Series Info (to get chapter count and TOC)
            const seriesRes = await fetch(`/api/catalog/series/${encodeURIComponent(seriesId)}`);
            const seriesData = await seriesRes.json();
            if (seriesData.success && seriesData.series) {
                currentSeries = seriesData.series;
                if (titleEl) titleEl.textContent = currentSeries.title;
            }

            // 2. Fetch Chapter Content
            await loadChapter(currentChapterNum, initialScroll);

        } catch (err) {
            console.error('[WebnovelReader] Error opening chapter:', err);
            if (loader) loader.style.display = 'none';
            contentEl.innerHTML = `<div class="wn-error-msg"><i class="fa-solid fa-circle-exclamation"></i> Impossible de charger ce chapitre.<br><small>${err.message}</small></div>`;
        }
    };

    async function loadChapter(chapterNum, targetScroll = 0) {
        currentChapterNum = parseInt(chapterNum);
        const contentEl = document.getElementById('webnovelContent');
        const chapterTitleEl = document.getElementById('wnChapterTitle');
        const loader = document.getElementById('wnLoader');
        const scrollContainer = document.getElementById('wnScrollContainer');

        if (loader) loader.style.display = 'flex';

        try {
            const res = await fetch(`/api/catalog/series/${encodeURIComponent(currentSeries.id)}/chapters/${currentChapterNum}`);
            const data = await res.json();

            if (loader) loader.style.display = 'none';

            if (data.success && data.chapter) {
                currentChapterData = data.chapter;
                if (chapterTitleEl) chapterTitleEl.textContent = data.chapter.title || `Chapitre ${currentChapterNum}`;

                contentEl.innerHTML = `
                    <div class="wn-chapter-header">
                        <span class="wn-series-badge">${currentSeries ? currentSeries.title : 'Webnovel'}</span>
                        <h2>${data.chapter.title}</h2>
                    </div>
                    <div class="wn-chapter-text">${data.chapter.content}</div>
                    <div class="wn-chapter-footer">
                        <div class="wn-nav-buttons">
                            <button id="wnFooterPrevBtn" class="btn btn-secondary" ${currentChapterNum <= 1 ? 'disabled' : ''}>
                                <i class="fa-solid fa-arrow-left"></i> Chapitre Précédent
                            </button>
                            <button id="wnFooterNextBtn" class="btn btn-primary" ${hasMoreChapters() ? '' : 'disabled'}>
                                Chapitre Suivant <i class="fa-solid fa-arrow-right"></i>
                            </button>
                        </div>
                    </div>
                `;

                // Bind footer nav
                const prevBtn = document.getElementById('wnFooterPrevBtn');
                const nextBtn = document.getElementById('wnFooterNextBtn');
                if (prevBtn) prevBtn.onclick = () => prevChapter();
                if (nextBtn) nextBtn.onclick = () => nextChapter();

                // Restore scroll or scroll to top
                if (scrollContainer) {
                    if (targetScroll > 0) {
                        scrollContainer.scrollTop = targetScroll;
                    } else {
                        scrollContainer.scrollTop = 0;
                    }
                }

                updateTopNavState();

                // In-Line Paragraph Comments Hook
                if (typeof window.initInlineParagraphComments === 'function') {
                    const txtEl = document.querySelector('.wn-chapter-text');
                    if (txtEl && currentSeries) {
                        const bookKey = currentSeries.id + '_wn';
                        window.initInlineParagraphComments(txtEl, bookKey, currentChapterNum);
                    }
                }
                saveCurrentProgress(0);

            } else {
                contentEl.innerHTML = `<div class="wn-error-msg"><i class="fa-solid fa-book-open"></i> Ce chapitre n'est pas encore disponible.</div>`;
            }
        } catch (e) {
            if (loader) loader.style.display = 'none';
            contentEl.innerHTML = `<div class="wn-error-msg"><i class="fa-solid fa-triangle-exclamation"></i> Erreur de chargement du chapitre.</div>`;
        }
    }

    function hasMoreChapters() {
        if (!currentSeries || !currentSeries.chapters) return false;
        return currentSeries.chapters.some(c => c.chapterNumber === currentChapterNum + 1);
    }

    function updateTopNavState() {
        const prevBtn = document.getElementById('wnTopPrevBtn');
        const nextBtn = document.getElementById('wnTopNextBtn');
        if (prevBtn) prevBtn.disabled = currentChapterNum <= 1;
        if (nextBtn) nextBtn.disabled = !hasMoreChapters();
    }

    function nextChapter() {
        if (hasMoreChapters()) {
            loadChapter(currentChapterNum + 1, 0);
        }
    }

    function prevChapter() {
        if (currentChapterNum > 1) {
            loadChapter(currentChapterNum - 1, 0);
        }
    }

    function closeReader() {
        window._activeVolumeContext = null;
        const overlay = document.getElementById('webnovelReaderOverlay');
        if (overlay) overlay.style.display = 'none';
        document.body.style.overflow = '';
    }

    // =========================================================================
    // PROGRESS TRACKING & INDEXEDDB AUTO-SAVE (DEBOUNCED)
    // =========================================================================
    function saveCurrentProgress(scrollPos) {
        if (!currentSeries) return;

        const totalChapters = (currentSeries.chapters || []).length || 1;
        const chapterPct = Math.round(((currentChapterNum - 1) / totalChapters) * 100);

        if (window.libraryDB) {
            window.libraryDB.saveProgress({
                bookId: `webnovel_${currentSeries.id}`,
                seriesId: currentSeries.id,
                chapterId: currentChapterNum,
                title: `${currentSeries.title} - Ch. ${currentChapterNum}`,
                format: 'webnovel',
                cover: currentSeries.cover || '',
                position: {
                    chapter: currentChapterNum,
                    scroll: scrollPos
                },
                progressPct: chapterPct,
                status: chapterPct >= 100 ? 'completed' : 'reading'
            });
        }
    }

    // =========================================================================
    // EVENT LISTENERS & DOM BINDINGS
    // =========================================================================
    document.addEventListener('DOMContentLoaded', () => {
        // Scroll Container tracking
        const scrollContainer = document.getElementById('wnScrollContainer');
        if (scrollContainer) {
            scrollContainer.addEventListener('scroll', () => {
                clearTimeout(scrollDebounceTimer);
                scrollDebounceTimer = setTimeout(() => {
                    const scrollPos = scrollContainer.scrollTop;
                    const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
                    const scrollRatio = maxScroll > 0 ? (scrollPos / maxScroll) : 0;
                    
                    const progressEl = document.getElementById('wnProgressText');
                    if (progressEl) {
                        const pct = Math.round(scrollRatio * 100);
                        progressEl.textContent = `${pct}%`;
                    }

                    saveCurrentProgress(scrollPos);
                }, 300);
            });
        }

        // Topbar buttons
        const closeBtn = document.getElementById('wnCloseBtn');
        if (closeBtn) closeBtn.onclick = closeReader;

        const topPrevBtn = document.getElementById('wnTopPrevBtn');
        if (topPrevBtn) topPrevBtn.onclick = prevChapter;

        const topNextBtn = document.getElementById('wnTopNextBtn');
        if (topNextBtn) topNextBtn.onclick = nextChapter;

        // Font Size +/-
        const fontMinusBtn = document.getElementById('wnFontMinusBtn');
        const fontPlusBtn = document.getElementById('wnFontPlusBtn');
        if (fontMinusBtn) {
            fontMinusBtn.onclick = () => {
                if (readerSettings.fontSize > 13) {
                    readerSettings.fontSize -= 1;
                    applySettings();
                    saveSettings();
                }
            };
        }
        if (fontPlusBtn) {
            fontPlusBtn.onclick = () => {
                if (readerSettings.fontSize < 32) {
                    readerSettings.fontSize += 1;
                    applySettings();
                    saveSettings();
                }
            };
        }

        // Theme buttons
        document.querySelectorAll('.wn-theme-btn').forEach(btn => {
            btn.onclick = () => {
                const theme = btn.getAttribute('data-theme');
                if (theme) {
                    readerSettings.theme = theme;
                    applySettings();
                    saveSettings();
                }
            };
        });

        // TOC Popover
        const tocBtn = document.getElementById('wnTocBtn');
        const tocPopover = document.getElementById('wnTocPopover');
        if (tocBtn && tocPopover) {
            tocBtn.onclick = (e) => {
                e.stopPropagation();
                tocPopover.classList.toggle('hidden');
                if (!tocPopover.classList.contains('hidden')) {
                    renderTocList();
                }
            };
            document.addEventListener('click', (e) => {
                if (!tocPopover.contains(e.target) && e.target !== tocBtn) {
                    tocPopover.classList.add('hidden');
                }
            });
        }

        function renderTocList() {
            const listEl = document.getElementById('wnTocList');
            if (!listEl || !currentSeries) return;
            listEl.innerHTML = '';
            (currentSeries.chapters || []).forEach(ch => {
                const li = document.createElement('li');
                li.className = ch.chapterNumber === currentChapterNum ? 'active' : '';
                li.innerHTML = `<span>${ch.title || `Chapitre ${ch.chapterNumber}`}</span>`;
                li.onclick = () => {
                    tocPopover.classList.add('hidden');
                    loadChapter(ch.chapterNumber, 0);
                };
                listEl.appendChild(li);
            });
        }
    });


    // Illustration Lightbox delegation on webnovel content
    document.addEventListener('DOMContentLoaded', () => {
        const wnContent = document.getElementById('webnovelContent');
        if (wnContent) {
            wnContent.addEventListener('click', (e) => {
                const img = e.target.closest('img, image');
                if (img) {
                    const src = img.currentSrc || img.src || img.getAttribute('xlink:href') || img.getAttribute('href');
                    if (src && typeof window.openIllustrationLightbox === 'function') {
                        e.preventDefault();
                        e.stopPropagation();
                        window.openIllustrationLightbox(src, img.alt || '');
                    }
                }
            });
        }
    });

})();
