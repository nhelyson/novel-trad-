/**
 * NovelTrad - Module Dédié Actualités & Annonces Officielles
 * Conçu selon les inspirations mondiales (Wuxiaworld, Royal Road, Tapas, BookWalker)
 * - 0 fuite de données privées / Sanitisation stricte des auteurs
 * - 3D Book Showcase avec jaquette officielle des Light Novels liés
 * - Micro-interactions soignées et typographie éditoriale haute lisibilité
 */

(function() {
  'use strict';

  const state = {
    news: [],
    catalogSeries: [],
    activeCategory: 'all', // 'all' | 'Sortie' | 'Annonce' | 'Mise à jour' | 'Communauté'
    selectedArticle: null,
    isLoading: false,
    isInitialized: false
  };

  /**
   * Sécurisation absolue : empêche toute fuite d'adresse email
   */
  function formatAuthorName(rawAuthor) {
    if (!rawAuthor || typeof rawAuthor !== 'string') return 'Équipe NovelTrad';
    const trimmed = rawAuthor.trim();
    if (trimmed.includes('@') || trimmed.includes('.com') || trimmed.includes('.fr') || trimmed.includes('http')) {
      return 'Équipe NovelTrad';
    }
    return trimmed;
  }

  function formatDateFr(isoDate) {
    if (!isoDate) return '';
    try {
      const d = new Date(isoDate);
      if (isNaN(d.getTime())) return isoDate;
      return d.toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
    } catch(e) {
      return isoDate;
    }
  }

  function formatRelativeDate(isoDate) {
    if (!isoDate) return '';
    try {
      const now = Date.now();
      const time = new Date(isoDate).getTime();
      const diffSec = Math.floor((now - time) / 1000);
      if (diffSec < 3600) return 'Récemment';
      const diffDays = Math.floor(diffSec / 86400);
      if (diffDays === 0) return "Aujourd'hui";
      if (diffDays === 1) return 'Hier';
      if (diffDays < 7) return `Il y a ${diffDays} jours`;
      return formatDateFr(isoDate);
    } catch(e) {
      return formatDateFr(isoDate);
    }
  }

  function estimateReadingTime(text) {
    if (!text) return '1 min de lecture';
    const words = text.trim().split(/\s+/).length;
    const minutes = Math.max(1, Math.ceil(words / 190));
    return `${minutes} min de lecture`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getCategoryBadge(cat) {
    const c = (cat || 'Annonce').trim();
    const cLower = c.toLowerCase();
    if (cLower.includes('sortie') || cLower.includes('tome') || cLower.includes('volume')) {
      return { label: 'Sortie de Tome', class: 'news-cat-release', icon: 'fa-book-bookmark' };
    }
    if (cLower.includes('mise à jour') || cLower.includes('patch') || cLower.includes('update')) {
      return { label: 'Mise à jour', class: 'news-cat-update', icon: 'fa-wand-magic-sparkles' };
    }
    if (cLower.includes('communauté') || cLower.includes('event') || cLower.includes('concours')) {
      return { label: 'Communauté', class: 'news-cat-community', icon: 'fa-users' };
    }
    return { label: 'Annonce', class: 'news-cat-announcement', icon: 'fa-bullhorn' };
  }

  function findRelatedSeries(seriesId) {
    if (!seriesId || !Array.isArray(state.catalogSeries)) return null;
    const target = String(seriesId).toLowerCase().trim();
    return state.catalogSeries.find(s => 
      (s.id && String(s.id).toLowerCase() === target) ||
      (s.slug && String(s.slug).toLowerCase() === target)
    ) || null;
  }

  async function loadData() {
    if (state.isLoading) return;
    state.isLoading = true;
    renderLoadingState();

    try {
      const [newsRes, catRes] = await Promise.allSettled([
        fetch('/api/editorial/news'),
        fetch('/api/catalog')
      ]);

      if (newsRes.status === 'fulfilled' && newsRes.value.ok) {
        const data = await newsRes.value.json();
        state.news = data.news || [];
      } else {
        state.news = [];
      }

      if (catRes.status === 'fulfilled' && catRes.value.ok) {
        const catData = await catRes.value.json();
        state.catalogSeries = catData.novels || catData.series || [];
      }
    } catch(err) {
      console.warn('[NewsManager] Erreur chargement:', err);
    } finally {
      state.isLoading = false;
      render();
    }
  }

  function renderLoadingState() {
    const grid = document.getElementById('newsArticlesGrid');
    const hero = document.getElementById('newsHeroCard');
    if (!grid) return;
    grid.innerHTML = `
      <div class="news-skeleton-card"></div>
      <div class="news-skeleton-card"></div>
      <div class="news-skeleton-card"></div>
    `;
    if (hero) {
      hero.innerHTML = '<div class="news-skeleton-hero"></div>';
    }
  }

  function render() {
    const heroContainer = document.getElementById('newsHeroContainer');
    const heroCard = document.getElementById('newsHeroCard');
    const grid = document.getElementById('newsArticlesGrid');
    const emptyNotice = document.getElementById('newsEmptyNotice');

    if (!grid) return;

    let filtered = [...state.news];
    if (state.activeCategory !== 'all') {
      const activeNorm = state.activeCategory.toLowerCase();
      filtered = filtered.filter(item => {
        const cat = (item.category || 'Annonce').toLowerCase();
        return cat.includes(activeNorm);
      });
    }

    if (filtered.length === 0) {
      if (heroContainer) heroContainer.style.display = 'none';
      grid.innerHTML = '';
      if (emptyNotice) emptyNotice.style.display = 'flex';
      return;
    }

    if (emptyNotice) emptyNotice.style.display = 'none';

    // Article à la une : premier épinglé ou le plus récent
    const pinnedIdx = filtered.findIndex(n => n.pinned);
    const heroItem = pinnedIdx !== -1 ? filtered[pinnedIdx] : filtered[0];
    const gridItems = filtered.filter(n => n.id !== heroItem.id);

    // =========================================================================
    // RENDER HERO (SPOTLIGHT BANNER AVEC 3D COVER DU ROMAN)
    // =========================================================================
    if (heroItem && heroCard && heroContainer) {
      heroContainer.style.display = 'block';
      const badge = getCategoryBadge(heroItem.category);
      const authorName = formatAuthorName(heroItem.author);
      const readTime = estimateReadingTime(heroItem.content || heroItem.excerpt);
      const relatedSeries = findRelatedSeries(heroItem.seriesId);
      
      const visualCover = heroItem.imageUrl || (relatedSeries && relatedSeries.cover) || '';

      const bookShowcaseHtml = visualCover ? `
        <div class="news-hero-visual">
          <div class="news-hero-book-wrap">
            <img src="${visualCover}" alt="${escapeHtml(relatedSeries ? relatedSeries.title : heroItem.title)}" class="news-hero-book-cover" loading="lazy">
            <div class="news-hero-book-glow"></div>
          </div>
        </div>
      ` : `
        <div class="news-hero-visual news-hero-visual-abstract">
          <div class="news-hero-abstract-icon">
            <i class="fa-solid ${badge.icon}"></i>
          </div>
        </div>
      `;

      const secondaryActionHtml = relatedSeries ? `
        <button type="button" class="btn-news-secondary" onclick="window.location.href='series.html?id=${encodeURIComponent(relatedSeries.id)}'">
          <i class="fa-solid fa-book-open"></i> <span>Fiche du roman</span>
        </button>
      ` : '';

      heroCard.innerHTML = `
        <div class="news-hero-banner-v2">
          ${bookShowcaseHtml}
          <div class="news-hero-body-v2">
            <div class="news-meta-row-v2">
              <span class="news-badge-v2 ${badge.class}"><i class="fa-solid ${badge.icon}"></i> ${badge.label}</span>
              ${heroItem.pinned ? '<span class="news-badge-v2 news-badge-pinned"><i class="fa-solid fa-thumbtack"></i> À la une</span>' : ''}
              <span class="news-meta-dot">•</span>
              <span class="news-date-pill-v2"><i class="fa-regular fa-clock"></i> ${formatRelativeDate(heroItem.createdAt)}</span>
              <span class="news-meta-dot">•</span>
              <span class="news-readtime-pill"><i class="fa-solid fa-book-reader"></i> ${readTime}</span>
            </div>

            <h2 class="news-hero-title-v2">${escapeHtml(heroItem.title)}</h2>
            <p class="news-hero-excerpt-v2">${escapeHtml(heroItem.excerpt || (heroItem.content ? heroItem.content.slice(0, 190) + '...' : ''))}</p>
            
            <div class="news-hero-actions-v2">
              <button type="button" class="btn-news-primary" data-id="${heroItem.id}">
                <span>Lire l'annonce</span> <i class="fa-solid fa-arrow-right"></i>
              </button>
              ${secondaryActionHtml}
            </div>

            <div class="news-hero-author-v2">
              <span class="news-author-verified"><i class="fa-solid fa-shield-halved"></i> Publié par <strong>${escapeHtml(authorName)}</strong></span>
            </div>
          </div>
        </div>
      `;

      const btnReadHero = heroCard.querySelector('.btn-news-primary');
      if (btnReadHero) {
        btnReadHero.onclick = () => openArticleReader(heroItem);
      }
    } else if (heroContainer) {
      heroContainer.style.display = 'none';
    }

    // =========================================================================
    // RENDER GRID (BENTO CARDS MODERNE & SÉCURISÉ)
    // =========================================================================
    grid.innerHTML = '';
    if (gridItems.length === 0) {
      return;
    }

    gridItems.forEach(item => {
      const badge = getCategoryBadge(item.category);
      const authorName = formatAuthorName(item.author);
      const readTime = estimateReadingTime(item.content || item.excerpt);
      const relatedSeries = findRelatedSeries(item.seriesId);
      const visualCover = item.imageUrl || (relatedSeries && relatedSeries.cover) || '';

      const card = document.createElement('article');
      card.className = 'news-card-v2';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Lire ${item.title}`);

      const thumbHtml = visualCover 
        ? `<div class="news-card-thumb-v2" style="background-image: url('${visualCover}');">
             <div class="news-card-thumb-fade"></div>
             <span class="news-badge-v2 ${badge.class} news-card-floating-badge"><i class="fa-solid ${badge.icon}"></i> ${badge.label}</span>
           </div>`
        : `<div class="news-card-thumb-v2 news-card-thumb-ambient">
             <div class="news-thumb-icon"><i class="fa-solid ${badge.icon}"></i></div>
             <span class="news-badge-v2 ${badge.class} news-card-floating-badge"><i class="fa-solid ${badge.icon}"></i> ${badge.label}</span>
           </div>`;

      card.innerHTML = `
        ${thumbHtml}
        <div class="news-card-body-v2">
          <div class="news-card-meta-v2">
            <span class="news-date-v2">${formatRelativeDate(item.createdAt)}</span>
            <span class="news-meta-dot">•</span>
            <span class="news-readtime-v2">${readTime}</span>
          </div>

          <h3 class="news-card-title-v2">${escapeHtml(item.title)}</h3>
          <p class="news-card-excerpt-v2">${escapeHtml(item.excerpt || (item.content ? item.content.slice(0, 130) + '...' : ''))}</p>

          <div class="news-card-footer-v2">
            <span class="news-card-author-v2"><i class="fa-solid fa-feather-pointed"></i> ${escapeHtml(authorName)}</span>
            <span class="news-card-link-v2">Lire <i class="fa-solid fa-arrow-right"></i></span>
          </div>
        </div>
      `;

      card.onclick = () => openArticleReader(item);
      card.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openArticleReader(item);
        }
      };
      grid.appendChild(card);
    });
  }

  function formatArticleContent(raw) {
    if (!raw) return '';
    const paragraphs = raw.split(/\n\s*\n/);
    return paragraphs.map(p => {
      const trimmed = p.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('⚔️') || trimmed.startsWith('📖') || trimmed.startsWith('✨') || trimmed.startsWith('✦') || trimmed.startsWith('###')) {
        return `<h4 class="news-reader-subheading">${escapeHtml(trimmed.replace(/^###\s*/, ''))}</h4>`;
      }
      return `<p class="news-reader-p">${escapeHtml(trimmed).replace(/\n/g, '<br>')}</p>`;
    }).join('');
  }

  function openArticleReader(article) {
    if (!article) return;
    state.selectedArticle = article;

    const modal = document.getElementById('newsReaderModal');
    const modalBody = document.getElementById('newsReaderBody');
    if (!modal || !modalBody) return;

    const badge = getCategoryBadge(article.category);
    const authorName = formatAuthorName(article.author);
    const readTime = estimateReadingTime(article.content || article.excerpt);
    const relatedSeries = findRelatedSeries(article.seriesId);
    const visualCover = article.imageUrl || (relatedSeries && relatedSeries.cover) || '';

    let seriesCardHtml = '';
    if (relatedSeries) {
      seriesCardHtml = `
        <div class="news-reader-series-banner">
          <div class="news-reader-series-label"><i class="fa-solid fa-bookmark"></i> Roman concerné par cette parution :</div>
          <div class="news-reader-series-box">
            <img src="${relatedSeries.cover || 'https://placehold.co/120x180/18181b/ffffff?text=Cover'}" alt="${escapeHtml(relatedSeries.title)}" class="news-reader-series-cover">
            <div class="news-reader-series-meta">
              <div class="news-reader-series-title">${escapeHtml(relatedSeries.title)}</div>
              <div class="news-reader-series-author">${escapeHtml(relatedSeries.author || 'Auteur')}</div>
              <button type="button" class="btn-news-goto-series" onclick="window.location.href='series.html?id=${encodeURIComponent(relatedSeries.id)}'">
                <i class="fa-solid fa-book-open"></i> <span>Accéder à la fiche de lecture</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }

    const headerVisual = visualCover ? `
      <div class="news-reader-top-banner" style="background-image: url('${visualCover}');">
        <div class="news-reader-top-overlay"></div>
      </div>
    ` : '';

    modalBody.innerHTML = `
      ${headerVisual}
      <div class="news-reader-inner-wrap">
        <div class="news-reader-meta-row">
          <span class="news-badge-v2 ${badge.class}"><i class="fa-solid ${badge.icon}"></i> ${badge.label}</span>
          <span class="news-meta-dot">•</span>
          <span class="news-date-pill-v2"><i class="fa-regular fa-calendar"></i> ${formatDateFr(article.createdAt)}</span>
          <span class="news-meta-dot">•</span>
          <span class="news-readtime-pill"><i class="fa-solid fa-book-reader"></i> ${readTime}</span>
        </div>

        <h1 class="news-reader-title">${escapeHtml(article.title)}</h1>

        <div class="news-reader-author-bar">
          <div class="news-reader-avatar"><i class="fa-solid fa-feather"></i></div>
          <div class="news-reader-author-details">
            <span class="news-reader-author-name">${escapeHtml(authorName)}</span>
            <span class="news-reader-author-role">Staff & Rédaction NovelTrad</span>
          </div>
        </div>

        ${seriesCardHtml}

        <div class="news-reader-content">
          ${formatArticleContent(article.content || article.excerpt || '')}
        </div>
      </div>
    `;

    modal.classList.remove('hidden');
    document.body.classList.add('news-modal-open');
    modal.scrollTop = 0;
  }

  function closeArticleReader() {
    const modal = document.getElementById('newsReaderModal');
    if (modal) {
      modal.classList.add('hidden');
      document.body.classList.remove('news-modal-open');
    }
  }

  function bindEvents() {
    // Filtres de catégories
    const filterBtns = document.querySelectorAll('.news-filter-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        state.activeCategory = btn.getAttribute('data-category') || 'all';
        render();
      });
    });

    // Fermeture de la modale
    const closeBtn = document.getElementById('newsReaderCloseBtn');
    if (closeBtn) {
      closeBtn.onclick = closeArticleReader;
    }
    const modalBackdrop = document.getElementById('newsReaderBackdrop');
    if (modalBackdrop) {
      modalBackdrop.onclick = closeArticleReader;
    }

    // Touche Échap pour fermer
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.getElementById('newsReaderModal');
        if (modal && !modal.classList.contains('hidden')) {
          closeArticleReader();
        }
      }
    });
  }

  function init() {
    if (state.isInitialized) {
      loadData();
      return;
    }
    state.isInitialized = true;
    bindEvents();
    loadData();
  }

  // API Publique
  window.NewsManager = {
    init: init,
    reload: loadData,
    openArticle: openArticleReader,
    closeArticle: closeArticleReader
  };

  // Chargement automatique si hash #news ou #actualites ou #annonces
  document.addEventListener('DOMContentLoaded', () => {
    const hash = window.location.hash || '';
    if (hash === '#news' || hash === '#actualites' || hash === '#annonces') {
      const tabNewsBtn = document.getElementById('tabNewsBtn');
      if (tabNewsBtn) tabNewsBtn.click();
    }
  });

})();
