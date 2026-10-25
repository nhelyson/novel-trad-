/**
 * NovelTrad - Showcase Deck & Home Presentation Controller
 * Manages hero slider, 3D deck interactions, and section flyout popovers.
 */
(function() {
  'use strict';

  let heroItems = [];
  let currentSlide = 0;
  let heroTimer = null;
  let isInitialized = false;

  const HomeLnoriManager = {
    async init(force = false) {
      if (isInitialized && !force) {
        this.updateResumeCard();
        return;
      }
      
      isInitialized = true;

      await this.loadHeroData();
      await this.loadSectionsData();
      this.updateResumeCard();
      this.setupStudioShortcuts();
    },

    // -----------------------------------------------------------------------
    // A. HERO SECTION & 3D STACK
    // -----------------------------------------------------------------------
    async reloadAllData() {
      await this.loadHeroData();
      await this.loadSectionsData();
    },

    async loadHeroData() {
      try {
        const res = await fetch('/api/catalog/featured');
        const data = await res.json();
        if (data.success && Array.isArray(data.featured) && data.featured.length > 0) {
          heroItems = data.featured;
        }
      } catch (e) {
        console.warn('[HomeLnori] Erreur /api/catalog/featured:', e);
      }

      // Si moins de 5 items, compléter avec l'exploration générale jusqu'à exactement 5
      if (heroItems.length < 5) {
        try {
          const res = await fetch('/api/catalog/explore?limit=12');
          const data = await res.json();
          if (data.success && Array.isArray(data.series)) {
            for (const s of data.series) {
              if (heroItems.length >= 5) break;
              if (!heroItems.some(h => h.id === s.id)) {
                heroItems.push(s);
              }
            }
          }
        } catch (e) {}
      }

      heroItems = heroItems.slice(0, 5);
      if (heroItems.length === 0) return;

      this.initDeckCards();
      this.renderHeroControls();
      this.updateHeroContent(heroItems[0], false);
      this.startTimer();

      const heroCard = document.getElementById('homeLnoriHero');
      if (heroCard) {
        heroCard.addEventListener('mouseenter', () => this.stopTimer());
        heroCard.addEventListener('mouseleave', () => this.startTimer());
      }
    },

initDeckCards() {
      const stack = document.getElementById('homeHeroStack');
      if (!stack || heroItems.length === 0) return;

      stack.innerHTML = '';
      const total = heroItems.length;

      heroItems.forEach((novel, idx) => {
        const card = document.createElement('div');
        card.className = `hero-carousel-card card-${idx}`;
        card.dataset.index = idx.toString();
        card.dataset.id = novel.id || '';
        card.dataset.title = novel.title || 'Roman';
        card.dataset.author = novel.author || 'Auteur inconnu';
        card.dataset.synopsis = novel.synopsis_fr || novel.synopsis || '';
        card.dataset.genres = JSON.stringify(novel.genres_fr || novel.genres || []);
        card.dataset.banner = novel.banner || novel.cover || '';
        card.dataset.cover = novel.cover || '';
        card.dataset.isOriginal = String(!!novel.is_original);
        card.setAttribute('aria-hidden', String(idx !== 0));

        const rawHeroCover = novel.cover || '';
        const coverSrc = rawHeroCover ? (rawHeroCover.startsWith('http') ? `/api/cover-proxy?url=${encodeURIComponent(rawHeroCover)}&w=480` : rawHeroCover) : 'https://placehold.co/400x600/18181b/ffffff?text=Couverture';
        card.innerHTML = `
          <div class="card-inner">
            ${novel.is_original ? '<div class="card-bookmark-ribbon" title="Création Originale"><i class="fa-solid fa-feather-pointed"></i><span>ORIGINAL</span></div>' : ''}
            <img src="${coverSrc}" alt="${novel.title || ''}" loading="${idx === 0 ? 'eager' : 'lazy'}" decoding="async" onload="this.classList.add('loaded')">
            <div class="card-shine-glare"></div>
          </div>
        `;

        // Clic sur la carte : la carte du dessus est jetée comme dans un jeu de cartes
        card.addEventListener('click', (e) => {
          e.stopPropagation();
          this.nextSlide();
          this.startTimer();
        });

        stack.appendChild(card);
      });
    },

    isAnimating: false,

    nextSlide() {
      const stack = document.getElementById('homeHeroStack');
      const total = heroItems.length;
      if (this.isAnimating || !stack || total === 0) return;
      this.isAnimating = true;

      const cardsMap = {};
      for (let o = 0; o < total; o++) {
        const c = stack.querySelector(`.card-${o}`);
        if (c) cardsMap[o] = c;
      }

      const topCard = cardsMap[0];
      const nextCard = cardsMap[1];
      if (!topCard || !nextCard) {
        this.isAnimating = false;
        return;
      }

      // 1. Synchronisation IMMÉDIATE du texte éditorial & pilule
      this.syncContentFromCard(nextCard);

      // 2. Retirer immédiatement card-0 de l'ancienne carte et lui assigner card-discard
      topCard.classList.remove('card-0');
      topCard.classList.add('card-discard');
      topCard.style.zIndex = '60';

      const isSmall = window.innerWidth <= 768;
      topCard.style.transform = isSmall 
        ? 'translate(35px, -70px) rotate(10deg) scale(0.85)' 
        : 'translate(55px, -110px) rotate(12deg) scale(0.82)';
      topCard.style.opacity = '0';
      topCard.style.filter = 'blur(10px)';

      // 3. SIMULTANÉMENT (0.00ms) : Toutes les autres cartes avancent d'un rang !
      // La nouvelle carte 1 devient IMMÉDIATEMENT la SEULE carte-0 au même instant que le titre change !
      for (let t = 1; t < total; t++) {
        if (cardsMap[t]) {
          cardsMap[t].classList.remove(`card-${t}`);
          cardsMap[t].classList.add(`card-${t - 1}`);
          cardsMap[t].setAttribute('aria-hidden', String((t - 1) !== 0));
        }
      }

      // 4. À la fin de la transition (700ms), replacer discrètement l'ancienne carte au fond
      setTimeout(() => {
        if (topCard) {
          topCard.classList.remove('card-discard');
          topCard.classList.add(`card-${total - 1}`);
          topCard.setAttribute('aria-hidden', 'true');
          topCard.style.transform = '';
          topCard.style.opacity = '';
          topCard.style.filter = '';
          topCard.style.zIndex = '';
        }
        this.isAnimating = false;
      }, 700);
    },

    prevSlide() {
      const stack = document.getElementById('homeHeroStack');
      const total = heroItems.length;
      if (this.isAnimating || !stack || total === 0) return;
      this.isAnimating = true;

      const cardsMap = {};
      for (let o = 0; o < total; o++) {
        const c = stack.querySelector(`.card-${o}`);
        if (c) cardsMap[o] = c;
      }

      const bottomCard = cardsMap[total - 1];
      if (!bottomCard) {
        this.isAnimating = false;
        return;
      }

      // 1. Synchronisation IMMÉDIATE du texte éditorial
      this.syncContentFromCard(bottomCard);

      // 2. La carte du fond vole vers le dessus du paquet
      bottomCard.style.transition = 'none';
      bottomCard.style.zIndex = '60';
      const isSmall = window.innerWidth <= 768;
      bottomCard.style.transform = isSmall
        ? 'translate(45px, -50px) rotate(10deg) scale(0.85)'
        : 'translate(65px, -110px) rotate(12deg) scale(0.82)';
      bottomCard.style.opacity = '0';
      bottomCard.style.filter = 'blur(10px)';

      void bottomCard.offsetWidth; // force reflow

      // 3. Décaler toutes les autres cartes vers l'arrière
      for (let t = total - 2; t >= 0; t--) {
        if (cardsMap[t]) {
          cardsMap[t].classList.remove(`card-${t}`);
          cardsMap[t].classList.add(`card-${t + 1}`);
          cardsMap[t].setAttribute('aria-hidden', 'true');
        }
      }

      // 4. Faire atterrir la nouvelle carte sur le dessus (card-0)
      bottomCard.style.transition = '';
      bottomCard.classList.remove(`card-${total - 1}`);
      bottomCard.classList.add('card-0');
      bottomCard.setAttribute('aria-hidden', 'false');
      bottomCard.style.transform = '';
      bottomCard.style.opacity = '';
      bottomCard.style.filter = '';

      setTimeout(() => {
        if (bottomCard) {
          bottomCard.style.zIndex = '';
        }
        this.isAnimating = false;
      }, 700);
    },

    goToIndex(targetOriginalIndex) {
      const stack = document.getElementById('homeHeroStack');
      const total = heroItems.length;
      if (this.isAnimating || !stack || total === 0) return;

      const targetCard = stack.querySelector(`.hero-carousel-card[data-index="${targetOriginalIndex}"]`);
      if (!targetCard || targetCard.classList.contains('card-0')) return;

      let currentPos = 0;
      for (let k = 0; k < total; k++) {
        if (targetCard.classList.contains(`card-${k}`)) {
          currentPos = k;
          break;
        }
      }
      if (currentPos === 0) return;

      this.isAnimating = true;
      const cardsMap = {};
      for (let o = 0; o < total; o++) {
        const c = stack.querySelector(`.card-${o}`);
        if (c) cardsMap[o] = c;
      }

      // Synchronisation immédiate du texte
      this.syncContentFromCard(targetCard);

      const topCard = cardsMap[0];
      const isSmall = window.innerWidth <= 768;
      if (topCard) {
        topCard.style.zIndex = '60';
        topCard.style.transform = isSmall
          ? 'translate(35px, -70px) rotate(10deg) scale(0.85)'
          : 'translate(55px, -110px) rotate(12deg) scale(0.82)';
        topCard.style.opacity = '0';
        topCard.style.filter = 'blur(10px)';
      }

      // Décaler immédiatement toutes les autres cartes
      for (let t = 1; t < total; t++) {
        if (cardsMap[t]) {
          const r = (t - currentPos + total) % total;
          cardsMap[t].classList.remove(`card-${t}`);
          cardsMap[t].classList.add(`card-${r}`);
          cardsMap[t].setAttribute('aria-hidden', String(r !== 0));
        }
      }

      setTimeout(() => {
        if (topCard) {
          const r = (0 - currentPos + total) % total;
          topCard.classList.remove('card-0');
          topCard.classList.add(`card-${r}`);
          topCard.setAttribute('aria-hidden', String(r !== 0));
          topCard.style.transform = '';
          topCard.style.opacity = '';
          topCard.style.filter = '';
          topCard.style.zIndex = '';
        }
        this.isAnimating = false;
      }, 700);
    },

    syncContentFromCard(cardEl) {
      if (!cardEl || !cardEl.dataset) return;
      const origIdx = parseInt(cardEl.dataset.index, 10) || 0;
      currentSlide = origIdx;

      let genres = [];
      try {
        genres = JSON.parse(cardEl.dataset.genres || '[]');
      } catch (e) {}

      const item = {
        id: cardEl.dataset.id,
        title: cardEl.dataset.title,
        author: cardEl.dataset.author,
        synopsis: cardEl.dataset.synopsis,
        genres: genres,
        banner: cardEl.dataset.banner,
        cover: cardEl.dataset.cover,
        is_original: cardEl.dataset.isOriginal === 'true'
      };

      this.updateHeroContent(item, true);
      this.updatePillDots();
    },

        updateHeroContent(item, animate = true) {
      if (!item) return;

      // 1. Ambient Background Glow
      const ambient = document.getElementById('homeHeroAmbient');
      if (ambient) {
        const coverUrl = item.banner || item.cover || '';
        ambient.style.backgroundImage = coverUrl ? `url('${coverUrl}')` : 'none';
        if (animate) {
          ambient.classList.remove('ambient-animate');
          void ambient.offsetWidth;
          ambient.classList.add('ambient-animate');
        }
      }

      // 2. Textes & Métadonnées
      const titleEl = document.getElementById('heroTitle');
      const authorEl = document.getElementById('heroAuthor');
      const genresEl = document.getElementById('heroGenres');
      const synopsisEl = document.getElementById('heroSynopsis');
      const readBtn = document.getElementById('heroReadBtn');
      const bookmarkBtn = document.getElementById('heroBookmarkBtn');

      if (titleEl) titleEl.textContent = item.title || 'Roman sans titre';
      if (authorEl) authorEl.textContent = item.author || 'Auteur Inconnu';

      if (genresEl) {
        genresEl.innerHTML = '';
        const genres = (item.genres_fr || item.genres || []).slice(0, 4);
        if (item.is_original) {
          const origSpan = document.createElement('span');
          origSpan.className = 'hero-genre-tag hero-badge-original';
          origSpan.innerHTML = '<i class="fa-solid fa-feather-pointed"></i> CRÉATION ORIGINALE';
          genresEl.appendChild(origSpan);
        }
        genres.forEach(g => {
          const span = document.createElement('span');
          span.className = 'hero-genre-tag';
          span.textContent = g;
          genresEl.appendChild(span);
        });
      }

      if (synopsisEl) {
        synopsisEl.textContent = item.synopsis_fr || item.synopsis || 'Découvrez ce roman captivant sur NovelTrad.';
      }

      if (readBtn) {
        readBtn.onclick = () => {
          if (item.id) {
            window.location.href = `/series.html?id=${encodeURIComponent(item.id)}`;
          }
        };
      }

      if (bookmarkBtn) {
        bookmarkBtn.onclick = (e) => {
          e.stopPropagation();
          this.quickBookmark(item, bookmarkBtn);
        };
        if (window.libraryDB && item.id) {
          window.libraryDB.isInLocalLibrary(item.id).then(inLib => {
            this.updateBookmarkBtnState(bookmarkBtn, inLib);
          }).catch(() => {});
        }
      }

      if (animate) {
        const detailsEl = document.querySelector('.home-hero-details');
        if (detailsEl) {
          detailsEl.classList.remove('hero-slide-enter');
          void detailsEl.offsetWidth;
          detailsEl.classList.add('hero-slide-enter');
        }
      }
    },

    updatePillDots() {
      const dots = document.querySelectorAll('.hero-pill-dot');
      dots.forEach((dot, idx) => {
        dot.classList.toggle('active', idx === currentSlide);
      });
    },

    renderHeroControls() {
      const pillsContainer = document.getElementById('homeHeroPills');
      if (pillsContainer) {
        pillsContainer.innerHTML = '';
        heroItems.forEach((_, idx) => {
          const pill = document.createElement('button');
          pill.className = `hero-pill-dot ${idx === currentSlide ? 'active' : ''}`;
          pill.setAttribute('aria-label', `Slide ${idx + 1}`);
          pill.onclick = () => {
            this.goToIndex(idx);
            this.startTimer();
          };
          pillsContainer.appendChild(pill);
        });
      }

      const prevBtn = document.getElementById('homeHeroPrev');
      const nextBtn = document.getElementById('homeHeroNext');
      if (prevBtn) prevBtn.onclick = () => { this.prevSlide(); this.startTimer(); };
      if (nextBtn) nextBtn.onclick = () => { this.nextSlide(); this.startTimer(); };

      // Avancement interactif au clic sur la pile
      const stackEl = document.getElementById('homeHeroStack');
      const heroEl = document.getElementById('homeLnoriHero');
      const touchTarget = stackEl || heroEl;

      if ('IntersectionObserver' in window && heroEl && !heroEl.dataset.observerBound) {
        heroEl.dataset.observerBound = 'true';
        const obs = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              HomeLnoriManager.startTimer();
            } else {
              HomeLnoriManager.stopTimer();
            }
          });
        }, { threshold: 0.1 });
        obs.observe(heroEl);
      }

      if (touchTarget && !touchTarget.dataset.swipeBound) {
        touchTarget.dataset.swipeBound = 'true';
        let touchStartX = 0;
        let touchStartY = 0;
        touchTarget.addEventListener('touchstart', (e) => {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
        }, { passive: true });

        touchTarget.addEventListener('touchend', (e) => {
          const touchEndX = e.changedTouches[0].clientX;
          const touchEndY = e.changedTouches[0].clientY;
          const diffX = touchEndX - touchStartX;
          const diffY = touchEndY - touchStartY;

          if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 40) {
            if (diffX < 0) {
              this.nextSlide();
            } else {
              this.prevSlide();
            }
            this.startTimer();
          }
        }, { passive: true });
      }
    },

    startTimer() {
      this.stopTimer();
      heroTimer = setInterval(() => {
        this.nextSlide();
      }, 6000);
    },

    stopTimer() {
      if (heroTimer) {
        clearInterval(heroTimer);
        heroTimer = null;
      }
    },

    // -----------------------------------------------------------------------
    // B. SECTIONS DE SÉRIES AVEC FLYOUT POPOVER
    // -----------------------------------------------------------------------
    async loadSectionsData() {
      try {
        const res = await fetch('/api/catalog/explore?limit=100');
        const data = await res.json();
        if (data.success && Array.isArray(data.series)) {
          const list = data.series;
          
          // 1. DERNIÈRES SORTIES & NOUVEAUTÉS
          const getReleaseTime = (s) => {
            let t = s.approved_at || s.created_at || (s.releaseDate ? new Date(s.releaseDate).getTime() : 0) || 0;
            if (Array.isArray(s.volumes) && s.volumes.length > 0) {
              for (const v of s.volumes) {
                const vt = v.uploaded_at || v.created_at || (v.release_date ? new Date(v.release_date).getTime() : 0) || 0;
                if (vt > t) t = vt;
              }
            }
            return t;
          };
          const latestSelection = [...list].sort((a, b) => getReleaseTime(b) - getReleaseTime(a));
          this.renderLnoriGrid('homeLatestGrid', latestSelection.slice(0, 20));

          // 2. TENDANCES (Vues réelles pondérées par la vélocité récente, sans points magiques)
          const getTrendingScore = (s) => {
            const views = s.views || 0;
            // Une série sans aucune vue ne peut mathématiquement pas être une tendance
            if (views === 0) return 0;

            const relTime = getReleaseTime(s);
            const daysAgo = Math.max(0, (Date.now() - relTime) / (1000 * 60 * 60 * 24));
            // Multiplicateur doux : de x1.8 aujourd'hui à x1.0 après 30 jours
            const recencyMultiplier = daysAgo < 30 ? (1 + ((30 - daysAgo) / 30) * 0.8) : 1.0;
            const ratingBonus = (parseFloat(s.rating) || 4.0) * 0.5;
            return (views * recencyMultiplier) + ratingBonus;
          };

          const trendingSelection = [...list]
            .filter(s => (s.views || 0) > 0)
            .sort((a, b) => getTrendingScore(b) - getTrendingScore(a))
            .slice(0, 10);

          if (trendingSelection.length < 4) {
            // Fallback gracieux pour catalogue neuf
            const fallback = [...list]
              .sort((a, b) => (b.views || 0) - (a.views || 0) || (b.rating || 0) - (a.rating || 0))
              .slice(0, 10);
            this.renderLnoriGrid('homeTrendingGrid', fallback);
          } else {
            this.renderLnoriGrid('homeTrendingGrid', trendingSelection);
          }

          // 3. CHEFS-D'ŒUVRE MIEUX NOTÉS
          const topRated = [...list].sort((a, b) => {
            const rA = parseFloat(a.rating) || 4.5;
            const rB = parseFloat(b.rating) || 4.5;
            return rB - rA;
          }).slice(0, 10);
          this.renderLnoriGrid('homeTopRatedGrid', topRated);
        }
      } catch (e) {
        console.warn('[HomeLnori] Erreur sections explore:', e);
      }
    },

    renderLnoriGrid(containerId, seriesList) {
      const container = document.getElementById(containerId);
      if (!container) return;

      container.innerHTML = '';
      if (!seriesList || seriesList.length === 0) {
        container.innerHTML = '<div style="grid-column: 1/-1; color:#94a3b8; padding:20px;">Aucun roman pour le moment.</div>';
        return;
      }

      seriesList.forEach(series => {
        const wrap = document.createElement('div');
        wrap.className = 'lnori-card-wrapper';

        const rawGridCover = series.cover || '';
        const coverSrc = rawGridCover ? (rawGridCover.startsWith('http') ? `/api/cover-proxy?url=${encodeURIComponent(rawGridCover)}&w=360` : rawGridCover) : 'https://placehold.co/400x600/18181b/ffffff?text=Cover';
        const volCount = (Array.isArray(series.volumes) && series.volumes.length > 0) ? series.volumes.length : (series.volume_count || 1);
        const genres = (series.genres_fr || series.genres || []).slice(0, 3);

        let originTag = 'JP';
        const origStr = (series.origin || '').toLowerCase();
        if (origStr.includes('corée') || origStr.includes('coree') || origStr.includes('kr')) originTag = 'KR';
        else if (origStr.includes('chine') || origStr.includes('cn')) originTag = 'CN';
        else if (origStr.includes('france') || origStr.includes('fr') || origStr.includes('original')) originTag = 'FR';
        else if (origStr.includes('inter') || origStr.includes('us') || origStr.includes('en')) originTag = 'INT';

        wrap.innerHTML = `
          <div class="lnori-card">
            <div class="lnori-card-cover-box">
              ${series.is_original ? '<div class="card-bookmark-ribbon" title="Création Originale"><i class="fa-solid fa-feather-pointed"></i><span>ORIGINAL</span></div>' : ''}
              <img src="${coverSrc}" alt="${series.title}" loading="lazy" decoding="async" onload="this.classList.add('loaded')" onerror="this.onerror=null;this.src='https://placehold.co/400x600/18181b/ffffff?text=${encodeURIComponent(series.title)}'">
              <span class="lnori-card-vol-badge">${volCount} Vol.</span>
            </div>
            <div class="lnori-card-info">
              <div class="lnori-card-title" title="${series.title}">${series.title}</div>
              <div class="lnori-card-sub">${series.author || 'Auteur Inconnu'}</div>
            </div>
          </div>

          <!-- POPOVER FLOTTANT DETAILS -->
          <div class="lnori-card-popup">
            <div class="popup-header">
              <div class="popup-tags-row">
                <span class="popup-pill ${originTag.toLowerCase()}">${originTag}</span>
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

        const openAction = () => {
          window.location.href = `/series.html?id=${encodeURIComponent(series.id)}`;
        };

        const cardEl = wrap.querySelector('.lnori-card');
        const readBtn = wrap.querySelector('.btn-open-series');
        if (cardEl) cardEl.onclick = openAction;
        if (readBtn) readBtn.onclick = openAction;

        const bookmarkBtn = wrap.querySelector('.btn-popup-bookmark');
        if (bookmarkBtn) {
          bookmarkBtn.onclick = (e) => {
            e.stopPropagation();
            this.quickBookmark(series, bookmarkBtn);
          };
        }

        container.appendChild(wrap);
      });
    },

    updateResumeCard() {
      const banner = document.getElementById('homeResumeBanner');
      if (!banner) return;

      const booksList = window.allBooks || [];
      let latest = null;
      let maxDate = 0;

      booksList.forEach(b => {
        if (b.lastReadDate && b.lastReadDate > maxDate) {
          maxDate = b.lastReadDate;
          latest = b;
        }
      });

      if (latest) {
        banner.classList.remove('hidden');
        banner.style.display = 'flex';

        const coverEl = document.getElementById('resumeCoverImg');
        const titleEl = document.getElementById('resumeTitle');
        const barEl = document.getElementById('resumeProgressBar');
        const percentEl = document.getElementById('resumePercentText');
        const btnEl = document.getElementById('resumeActionBtn');

        if (titleEl) titleEl.textContent = latest.title;
        const prog = Math.round(latest.progress || 0);
        if (barEl) barEl.style.width = `${prog}%`;
        if (percentEl) percentEl.textContent = `${prog}%`;

        if (coverEl) {
          coverEl.src = `/api/download-job/${latest.id}/cover`;
          coverEl.onerror = function() {
            this.onerror = null;
            this.src = 'https://placehold.co/400x600/18181b/ffffff?text=' + encodeURIComponent(latest.title);
          };
        }

        if (btnEl) {
          btnEl.onclick = () => {
            if (typeof window.openReader === 'function') {
              window.openReader(latest);
            }
          };
        }
      } else {
        banner.classList.add('hidden');
        banner.style.display = 'none';
      }
    },

    // -----------------------------------------------------------------------
    // D. RACCOURCIS DES STUDIOS
    // -----------------------------------------------------------------------
            setupStudioShortcuts() {
      const docCard = document.getElementById('studioCardDoc');
      const libCard = document.getElementById('studioCardLib');

      if (docCard) {
        docCard.onclick = () => {
          const btn = document.getElementById('tabDocsBtn');
          if (btn) btn.click();
        };
      }
      if (libCard) {
        libCard.onclick = () => {
          const btn = document.getElementById('tabLibraryBtn');
          if (btn) btn.click();
        };
      }
    },

    async quickBookmark(series, buttonEl) {
      if (!series || !series.id || !window.libraryDB) return;

      // Restriction Incitative Invité : connexion obligatoire pour ajouter à la bibliothèque
      const auth = window.authManager || window.supabaseAuthManager;
      const isLogged = Boolean(auth?.currentUser);

      if (!isLogged) {
        if (auth && typeof auth.showToast === 'function') {
          auth.showToast('Connectez-vous pour ajouter « ' + (series.title || 'ce roman') + ' » à votre bibliothèque personnelle !');
        }
        if (typeof window.openAuthModal === 'function') {
          window.openAuthModal('login');
        } else if (auth && typeof auth.openModal === 'function') {
          auth.openModal('login');
        } else {
          const authModal = document.getElementById('authModal');
          if (authModal) {
            authModal.classList.remove('hidden');
            authModal.style.display = 'flex';
          }
        }
        return;
      }

      try {
        const inLib = await window.libraryDB.isInLocalLibrary(series.id);
        if (inLib) {
          await window.libraryDB.removeFromLocalLibrary(series.id);
          this.updateBookmarkBtnState(buttonEl, false);
          if (window.authManager && window.authManager.showToast) {
            window.authManager.showToast('« ' + (series.title || 'Roman') + ' » retiré de votre bibliothèque.');
          }
        } else {
          await window.libraryDB.addToLocalLibrary({
            id: series.id,
            seriesId: series.id,
            title: series.title,
            cover: series.cover || series.cover_url || series.coverImage || (series.metadata && series.metadata.cover) || series.banner || '',
            author: series.author || (series.metadata && series.metadata.author) || 'Roman / Light Novel',
            genres: series.genres_fr || series.genres || [],
            synopsis: series.synopsis_fr || series.synopsis || '',
            volumes: series.volumes || [],
            format: 'epub'
          });
          this.updateBookmarkBtnState(buttonEl, true);
          if (window.authManager && window.authManager.showToast) {
            window.authManager.showToast('« ' + (series.title || 'Roman') + ' » ajouté à votre bibliothèque !');
          }
        }
        if (typeof window.initLibrary === 'function') {
          window.initLibrary(true);
        } else if (typeof updateLibraryStats === 'function') {
          updateLibraryStats();
        }
      } catch (err) {
        console.warn('[HomeHero] Erreur quickBookmark:', err);
      }
    },

    updateBookmarkBtnState(btn, isInLib) {
      if (!btn) return;
      if (isInLib) {
        btn.classList.add('in-library');
        btn.innerHTML = '<i class="fa-solid fa-check"></i> <span>Dans ma bibliothèque</span>';
      } else {
        btn.classList.remove('in-library');
        btn.innerHTML = '<i class="fa-solid fa-bookmark"></i> <span>+ Ma bibliothèque</span>';
      }
    }
  };

  window.HomeLnoriManager = HomeLnoriManager;
  window.HomeLnori = HomeLnoriManager;

  // Initialiser au chargement du DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => HomeLnoriManager.init());
  } else {
    HomeLnoriManager.init();
  }
})();
