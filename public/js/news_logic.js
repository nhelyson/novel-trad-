/**
 * NovelTrad - Module Dédié Actualités & Annonces Officielles
 * Conçu selon les principes UI/UX Pro Max & Emil Kowalski (Fluidité, Typographie, Press feedback)
 */

(function() {
  'use strict';

  const state = {
    news: [],
    catalogSeries: [],
    activeCategory: 'all', // 'all' | 'Annonce' | 'Sortie' | 'Mise à jour' | 'Communauté'
    selectedArticle: null,
    isLoading: false,
    isInitialized: false
  };

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

  function getCategoryBadge(cat) {
    const c = (cat || 'Annonce').trim();
    if (c.toLowerCase().includes('sortie') || c.toLowerCase().includes('tome') || c.toLowerCase().includes('volume')) {
      return { label: c, class: 'news-cat-release', icon: 'fa-book-open' };
    }
    if (c.toLowerCase().includes('mise à jour') || c.toLowerCase().includes('patch') || c.toLowerCase().includes('update')) {
      return { label: c, class: 'news-cat-update', icon: 'fa-wand-magic-sparkles' };
    }
    if (c.toLowerCase().includes('communauté') || c.toLowerCase().includes('event') || c.toLowerCase().includes('concours')) {
      return { label: c, class: 'news-cat-community', icon: 'fa-users' };
    }
    return { label: c, class: 'news-cat-announcement', icon: 'fa-bullhorn' };
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
    const countBadge = document.getElementById('newsTotalCountBadge');
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

    if (countBadge) {
      countBadge.textContent = `${filtered.length} article${filtered.length > 1 ? 's' : ''}`;
    }

    if (filtered.length === 0) {
      if (heroContainer) heroContainer.style.display = 'none';
      grid.innerHTML = '';
      if (emptyNotice) emptyNotice.style.display = 'flex';
      return;
    }

    if (emptyNotice) emptyNotice.style.display = 'none';

    // 1. Article à la une (Soit le premier épinglé, soit le tout dernier)
    const pinnedIdx = filtered.findIndex(n => n.pinned);
    const heroItem = pinnedIdx !== -1 ? filtered[pinnedIdx] : (filtered.length > 0 ? filtered[0] : null);
    
    // Le reste va dans la grille
    const gridItems = heroItem ? filtered.filter(n => n.id !== heroItem.id) : filtered;

    // Render Hero
    if (heroItem && heroCard && heroContainer) {
      heroContainer.style.display = 'block';
      const badge = getCategoryBadge(heroItem.category);
      const bgImg = heroItem.imageUrl ? `style="background-image: url('${heroItem.imageUrl}');"` : '';
      const hasImgClass = heroItem.imageUrl ? 'has-cover' : 'no-cover';

      heroCard.innerHTML = `
        <div class="news-hero-banner ${hasImgClass}" ${bgImg}>
          <div class="news-hero-overlay"></div>
          <div class="news-hero-body">
            <div class="news-meta-row">
              <span class="news-badge ${badge.class}"><i class="fa-solid ${badge.icon}"></i> ${badge.label}</span>
              ${heroItem.pinned ? '<span class="news-badge news-badge-pinned"><i class="fa-solid fa-thumbtack"></i> À la une</span>' : ''}
              <span class="news-date-pill"><i class="fa-regular fa-clock"></i> ${formatRelativeDate(heroItem.createdAt)}</span>
            </div>
            <h2 class="news-hero-title">${escapeHtml(heroItem.title)}</h2>
            <p class="news-hero-excerpt">${escapeHtml(heroItem.excerpt || (heroItem.content ? heroItem.content.slice(0, 180) + '...' : ''))}</p>
            <div class="news-hero-footer">
              <button type="button" class="btn-news-read" data-id="${heroItem.id}">
                <span>Lire l'annonce complète</span> <i class="fa-solid fa-arrow-right"></i>
              </button>
              <span class="news-author-tag"><i class="fa-solid fa-feather"></i> ${escapeHtml(heroItem.author || 'Équipe NovelTrad')}</span>
            </div>
          </div>
        </div>
      `;
      const btnReadHero = heroCard.querySelector('.btn-news-read');
      if (btnReadHero) {
        btnReadHero.onclick = () => openArticleReader(heroItem);
      }
    } else if (heroContainer) {
      heroContainer.style.display = 'none';
    }

    // Render Grid
    grid.innerHTML = '';
    if (gridItems.length === 0) {
      return;
    }

    gridItems.forEach(item => {
      const badge = getCategoryBadge(item.category);
      const card = document.createElement('article');
      card.className = 'news-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Lire ${item.title}`);

      const imgHtml = item.imageUrl 
        ? `<div class="news-card-thumb" style="background-image: url('${item.imageUrl}');"></div>`
        : `<div class="news-card-thumb news-card-thumb-pattern"><i class="fa-solid ${badge.icon}"></i></div>`;

      card.innerHTML = `
        ${imgHtml}
        <div class="news-card-content">
          <div class="news-meta-row">
            <span class="news-badge ${badge.class}"><i class="fa-solid ${badge.icon}"></i> ${badge.label}</span>
            <span class="news-date-text">${formatRelativeDate(item.createdAt)}</span>
          </div>
          <h3 class="news-card-title">${escapeHtml(item.title)}</h3>
          <p class="news-card-excerpt">${escapeHtml(item.excerpt || (item.content ? item.content.slice(0, 140) + '...' : ''))}</p>
          <div class="news-card-footer">
            <span class="news-card-author">${escapeHtml(item.author || 'NovelTrad')}</span>
            <span class="news-card-action">Lire <i class="fa-solid fa-arrow-right"></i></span>
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

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatArticleContent(raw) {
    if (!raw) return '';
    // Formatage soigné des paragraphes et retours à la ligne
    const paragraphs = raw.split(/\n\s*\n/);
    return paragraphs.map(p => {
      const trimmed = p.trim();
      if (!trimmed) return '';
      // Détection de sous-titres avec émojis ou préfixes
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
    const relatedSeries = article.seriesId 
      ? state.catalogSeries.find(s => s.id === article.seriesId)
      : null;

    let seriesCardHtml = '';
    if (relatedSeries) {
      seriesCardHtml = `
        <div class="news-related-series-box">
          <div class="news-related-label"><i class="fa-solid fa-link"></i> Série mentionnée dans cette annonce :</div>
          <div class="news-related-series-card">
            <img src="${relatedSeries.cover || 'https://placehold.co/120x180/18181b/ffffff?text=Cover'}" alt="${escapeHtml(relatedSeries.title)}" class="news-related-cover">
            <div class="news-related-info">
              <div class="news-related-title">${escapeHtml(relatedSeries.title)}</div>
              <div class="news-related-author">${escapeHtml(relatedSeries.author || 'Auteur')}</div>
              <button type="button" class="btn-news-goto-series" onclick="window.location.href='series.html?id=${encodeURIComponent(relatedSeries.id)}'">
                <i class="fa-solid fa-book-open"></i> <span>Découvrir la série</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }

    const headerBannerHtml = article.imageUrl ? `
      <div class="news-reader-banner" style="background-image: url('${article.imageUrl}');"></div>
    ` : '';

    modalBody.innerHTML = `
      ${headerBannerHtml}
      <div class="news-reader-header">
        <div class="news-meta-row">
          <span class="news-badge ${badge.class}"><i class="fa-solid ${badge.icon}"></i> ${badge.label}</span>
          <span class="news-date-pill"><i class="fa-regular fa-calendar"></i> ${formatDateFr(article.createdAt)}</span>
        </div>
        <h1 class="news-reader-title">${escapeHtml(article.title)}</h1>
        <div class="news-reader-author-bar">
          <div class="news-reader-avatar"><i class="fa-solid fa-feather"></i></div>
          <div class="news-reader-author-details">
            <span class="news-reader-author-name">${escapeHtml(article.author || 'Équipe NovelTrad')}</span>
            <span class="news-reader-author-role">Communication Officielle</span>
          </div>
        </div>
      </div>
      ${seriesCardHtml}
      <div class="news-reader-content">
        ${formatArticleContent(article.content || article.excerpt || '')}
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
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
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

  // Chargement automatique si hash #news ou #actualites
  document.addEventListener('DOMContentLoaded', () => {
    const hash = window.location.hash || '';
    if (hash === '#news' || hash === '#actualites' || hash === '#annonces') {
      const tabNewsBtn = document.getElementById('tabNewsBtn');
      if (tabNewsBtn) tabNewsBtn.click();
    }
  });

})();
