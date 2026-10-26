/**
 * NovelTrad - Espace Mature (+18) Logic & Leaderboard Engine
 */

(function() {
  'use strict';

  // --- AGE GATE VERIFICATION ---
  const ageGateModal = document.getElementById('ageGateModal');
  const btnConfirmAge = document.getElementById('btnConfirmAge');

  function checkAgeVerification() {
    const verified = localStorage.getItem('noveltrad_age_verified');
    if (verified === 'true') {
      if (ageGateModal) ageGateModal.classList.add('hidden');
      loadMatureData();
    } else {
      if (ageGateModal) ageGateModal.classList.remove('hidden');
    }
  }

  if (btnConfirmAge) {
    btnConfirmAge.addEventListener('click', () => {
      localStorage.setItem('noveltrad_age_verified', 'true');
      if (ageGateModal) {
        ageGateModal.style.opacity = '0';
        setTimeout(() => ageGateModal.classList.add('hidden'), 250);
      }
      loadMatureData();
    });
  }

  // --- STATE ---
  let matureData = {
    rankings: [],
    podium: [],
    latest: []
  };
  
  let sliderInterval = null;
  let currentSlideIndex = 0;

  // --- DOM ELEMENTS ---
  const sliderTrack = document.getElementById('matureSliderTrack');
  const sliderDots = document.getElementById('matureSliderDots');
  const btnPrevSlide = document.getElementById('btnPrevSlide');
  const btnNextSlide = document.getElementById('btnNextSlide');
  const podiumContainer = document.getElementById('maturePodiumContainer');
  const leaderboardContainer = document.getElementById('matureLeaderboardContainer');
  const latestContainer = document.getElementById('matureLatestContainer');
  

  // --- SEARCH DROPDOWN LOGIC (In Navbar) ---
  let searchDebounce = null;

  if (navSearchInput) {
    navSearchInput.addEventListener('input', (e) => {
      const q = (e.target.value || '').trim();
      clearTimeout(searchDebounce);

      if (q.length === 0) {
        closeSearchDropdown();
        return;
      }

      searchDebounce = setTimeout(() => {
        performInstantSearch(q);
      }, 200);
    });

    navSearchInput.addEventListener('focus', () => {
      const q = (navSearchInput.value || '').trim();
      if (q.length > 0) {
        performInstantSearch(q);
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (navSearchWrapper && !navSearchWrapper.contains(e.target)) {
      closeSearchDropdown();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSearchDropdown();
    }
  });

  function closeSearchDropdown() {
    if (navSearchDropdown) {
      navSearchDropdown.classList.remove('open');
    }
  }

  function openSearchDropdown() {
    if (navSearchDropdown) {
      navSearchDropdown.classList.add('open');
    }
  }

  async function performInstantSearch(query) {
    if (!navSearchResultsList) return;

    try {
      openSearchDropdown();
      navSearchResultsList.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--m-text-muted); font-size: 13px;"><i class="fa-solid fa-spinner fa-spin" style="margin-right: 6px;"></i> Recherche en cours...</div>';

      const res = await fetch(`/api/catalog/mature?q=${encodeURIComponent(query)}`);
      const data = await res.json();

      if (data.success && Array.isArray(data.rankings)) {
        renderSearchDropdownResults(data.rankings, query);
      } else {
        navSearchResultsList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--m-text-muted); font-size: 13px;">Aucun résultat trouvé.</div>';
        if (navSearchCountBadge) navSearchCountBadge.textContent = '0 résultat';
      }
    } catch (err) {
      console.error('[Search] Error:', err);
      navSearchResultsList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--m-text-muted); font-size: 13px;">Erreur lors de la recherche.</div>';
    }
  }

  function renderSearchDropdownResults(results, query) {
    if (!navSearchResultsList) return;

    if (navSearchCountBadge) {
      navSearchCountBadge.textContent = `${results.length} résultat${results.length > 1 ? 's' : ''}`;
    }

    if (results.length === 0) {
      navSearchResultsList.innerHTML = `
        <div style="padding: 20px; text-align: center; color: var(--m-text-muted); font-size: 13px;">
          <i class="fa-solid fa-magnifying-glass" style="font-size: 18px; margin-bottom: 6px; display: block; opacity: 0.5;"></i>
          Aucune œuvre ne correspond à "<strong>${escapeHtml(query)}</strong>"
        </div>
      `;
      return;
    }

    const fallbackCover = 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400';

    navSearchResultsList.innerHTML = results.slice(0, 8).map(item => {
      const volCount = (item.volumes && item.volumes.length) || 1;
      const rating = typeof item.rating === 'number' ? item.rating.toFixed(1) : (item.rating || '4.8');
      const cover = item.cover || fallbackCover;

      return `
        <a href="/series.html?id=${encodeURIComponent(item.id)}" class="m-search-item">
          <img src="${cover}" class="m-search-thumb" alt="" onerror="this.src='${fallbackCover}'">
          <div class="m-search-info">
            <div class="m-search-item-title">${escapeHtml(item.title)}</div>
            <div class="m-search-item-sub">
              <span><i class="fa-solid fa-pen-nib"></i> ${escapeHtml(item.author || 'Auteur')}</span>
              <span style="color:#fbbf24;"><i class="fa-solid fa-star"></i> ${rating}</span>
              <span>${volCount} vol.</span>
            </div>
          </div>
          <span class="m-search-item-rank">#${item.rank}</span>
        </a>
      `;
    }).join('');
  }

  // --- FETCH MAIN DATA (Slider, Podium, Leaderboard, Dernières Sorties) ---
  async function loadMatureData() {
    try {
      const res = await fetch(`/api/catalog/mature`);
      const data = await res.json();

      if (data.success) {
        matureData = data;
        renderSlider(data.rankings || []);
        renderPodium(data.podium || []);
        renderLeaderboard(data.rankings || []);
        renderLatest(data.latest || []);
      } else {
        renderEmptyState('Erreur lors du chargement des données.');
      }
    } catch (e) {
      console.error('[Mature] Error loading catalog:', e);
      renderEmptyState('Impossible de joindre le serveur.');
    }
  }

  // --- HERO SLIDER (Displayed where search bar was in Hero) ---
  function renderSlider(seriesList) {
    if (!sliderTrack) return;
    clearInterval(sliderInterval);

    const featuredList = (seriesList || []).slice(0, 5);

    if (featuredList.length === 0) {
      sliderTrack.innerHTML = `
        <div class="m-slide active">
          <div class="m-slide-overlay"></div>
          <div class="m-slide-content" style="justify-content: center; text-align: center; min-height: 220px;">
            <div style="max-width: 500px;">
              <h3 style="font-family: var(--m-font-heading); font-size: 20px; color: #fff; margin-bottom: 6px;">Bienvenue sur le Classement</h3>
              <p style="color: var(--m-text-muted); font-size: 13px;">Activez le badge <strong>Mature +18</strong> depuis le Panel Admin sur vos œuvres pour les voir s'animer dans ce carrousel.</p>
            </div>
          </div>
        </div>
      `;
      if (sliderDots) sliderDots.innerHTML = '';
      return;
    }

    const fallbackCover = 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400';

    sliderTrack.innerHTML = featuredList.map((item, idx) => {
      const cover = item.cover || fallbackCover;
      const rating = typeof item.rating === 'number' ? item.rating.toFixed(1) : (item.rating || '4.8');
      const views = (item.views || 0).toLocaleString('fr-FR');
      const volCount = (item.volumes && item.volumes.length) || 1;

      return `
        <div class="m-slide ${idx === 0 ? 'active' : ''}" data-index="${idx}">
          <div class="m-slide-backdrop" style="background-image: url('${cover}');"></div>
          <div class="m-slide-overlay"></div>
          <div class="m-slide-content">
            <img src="${cover}" class="m-slide-cover" alt="" onerror="this.src='${fallbackCover}'">
            <div class="m-slide-details">
              <div class="m-slide-pill"><i class="fa-solid fa-crown"></i> RANG #${item.rank}</div>
              <h2 class="m-slide-title">${escapeHtml(item.title)}</h2>
              <div class="m-slide-meta">
                <span><i class="fa-solid fa-pen-nib"></i> ${escapeHtml(item.author || 'Auteur')}</span>
                <span style="color: #fbbf24; font-weight: 700;"><i class="fa-solid fa-star"></i> ${rating}</span>
                <span><i class="fa-solid fa-eye" style="color: #e11d48;"></i> ${views}</span>
                <span><i class="fa-solid fa-book-open"></i> ${volCount} tome${volCount > 1 ? 's' : ''}</span>
              </div>
              <p class="m-slide-synopsis">${escapeHtml(item.synopsis || 'Plongez dans cette œuvre plébiscitée par la communauté.')}</p>
              <div class="m-slide-actions">
                <a href="/series.html?id=${encodeURIComponent(item.id)}" class="m-btn-slide-read">
                  <i class="fa-solid fa-play"></i> Découvrir l'œuvre
                </a>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Dots
    if (sliderDots) {
      sliderDots.innerHTML = featuredList.map((_, idx) => `
        <div class="m-dot ${idx === 0 ? 'active' : ''}" data-index="${idx}"></div>
      `).join('');

      sliderDots.querySelectorAll('.m-dot').forEach(dot => {
        dot.addEventListener('click', (e) => {
          const idx = parseInt(e.target.dataset.index) || 0;
          goToSlide(idx, featuredList.length);
        });
      });
    }

    currentSlideIndex = 0;
    startSliderAuto(featuredList.length);
  }

  function goToSlide(index, total) {
    if (total <= 1) return;
    currentSlideIndex = (index + total) % total;
    const slides = sliderTrack.querySelectorAll('.m-slide');
    const dots = sliderDots ? sliderDots.querySelectorAll('.m-dot') : [];

    slides.forEach((s, idx) => s.classList.toggle('active', idx === currentSlideIndex));
    dots.forEach((d, idx) => d.classList.toggle('active', idx === currentSlideIndex));
  }

  function startSliderAuto(total) {
    if (total <= 1) return;
    sliderInterval = setInterval(() => {
      goToSlide(currentSlideIndex + 1, total);
    }, 5000);
  }

  if (btnPrevSlide) {
    btnPrevSlide.addEventListener('click', () => {
      const total = sliderTrack ? sliderTrack.querySelectorAll('.m-slide').length : 0;
      clearInterval(sliderInterval);
      goToSlide(currentSlideIndex - 1, total);
      startSliderAuto(total);
    });
  }

  if (btnNextSlide) {
    btnNextSlide.addEventListener('click', () => {
      const total = sliderTrack ? sliderTrack.querySelectorAll('.m-slide').length : 0;
      clearInterval(sliderInterval);
      goToSlide(currentSlideIndex + 1, total);
      startSliderAuto(total);
    });
  }

  // --- RENDER PODIUM (Top 1, 2, 3) ---
  function renderPodium(podium) {
    if (!podiumContainer) return;

    if (!podium || podium.length === 0) {
      podiumContainer.innerHTML = '';
      return;
    }

    const first = podium[0];
    const second = podium[1];
    const third = podium[2];
    const fallbackCover = 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400';

    let html = `
      <!-- TOP #1 SPOTLIGHT -->
      <div class="m-card-champion">
        <div class="m-champ-rank">#1</div>
        <img src="${first.cover || fallbackCover}" class="m-champ-cover" alt="" onerror="this.src='${fallbackCover}'">
        <div class="m-champ-info">
          <div>
            <div class="m-champ-badge-row">
              <span class="m-rank-pill gold"><i class="fa-solid fa-crown"></i> RANG #1</span>
              <span class="m-logo-badge">+18</span>
              <span style="font-size:12px; font-weight:700; color:#fbbf24;"><i class="fa-solid fa-star"></i> ${(first.rating || 4.8).toFixed ? first.rating.toFixed(1) : first.rating}</span>
            </div>
            <a href="/series.html?id=${encodeURIComponent(first.id)}" class="m-champ-title">${escapeHtml(first.title)}</a>
            <div class="m-champ-author"><i class="fa-solid fa-pen-nib"></i> ${escapeHtml(first.author || 'Auteur')}</div>
            <p class="m-champ-synopsis">${escapeHtml(first.synopsis || 'Une œuvre sombre et intense à découvrir sans modération.')}</p>
          </div>
          <div class="m-champ-footer">
            <div class="m-perf-row">
              <span><i class="fa-solid fa-eye" style="color:#e11d48;"></i> ${(first.views || 0).toLocaleString('fr-FR')}</span>
              <span><i class="fa-solid fa-book-open"></i> ${(first.volumes && first.volumes.length) || 1} tome${first.volumes && first.volumes.length > 1 ? 's' : ''}</span>
            </div>
            <a href="/series.html?id=${encodeURIComponent(first.id)}" class="m-btn-read"><i class="fa-solid fa-play"></i> Découvrir</a>
          </div>
        </div>
      </div>
    `;

    if (second || third) {
      html += `<div class="m-podium-runners">`;
      if (second) {
        html += `
          <a href="/series.html?id=${encodeURIComponent(second.id)}" class="m-runner-card">
            <div class="m-runner-rank-num silver">#2</div>
            <img src="${second.cover || fallbackCover}" class="m-runner-cover" alt="" onerror="this.src='${fallbackCover}'">
            <div class="m-runner-details">
              <div class="m-champ-badge-row" style="margin-bottom:4px;">
                <span class="m-rank-pill silver">RANG #2</span>
                <span style="font-size:11.5px; color:#fbbf24; font-weight:700;"><i class="fa-solid fa-star"></i> ${(second.rating || 4.8).toFixed ? second.rating.toFixed(1) : second.rating}</span>
              </div>
              <div class="m-runner-title">${escapeHtml(second.title)}</div>
              <div class="m-runner-author">${escapeHtml(second.author || 'Auteur')}</div>
              <div class="m-perf-row" style="font-size:11.5px;">
                <span><i class="fa-solid fa-eye" style="color:#e11d48;"></i> ${(second.views || 0).toLocaleString('fr-FR')}</span>
              </div>
            </div>
          </a>
        `;
      }
      if (third) {
        html += `
          <a href="/series.html?id=${encodeURIComponent(third.id)}" class="m-runner-card">
            <div class="m-runner-rank-num bronze">#3</div>
            <img src="${third.cover || fallbackCover}" class="m-runner-cover" alt="" onerror="this.src='${fallbackCover}'">
            <div class="m-runner-details">
              <div class="m-champ-badge-row" style="margin-bottom:4px;">
                <span class="m-rank-pill bronze">RANG #3</span>
                <span style="font-size:11.5px; color:#fbbf24; font-weight:700;"><i class="fa-solid fa-star"></i> ${(third.rating || 4.8).toFixed ? third.rating.toFixed(1) : third.rating}</span>
              </div>
              <div class="m-runner-title">${escapeHtml(third.title)}</div>
              <div class="m-runner-author">${escapeHtml(third.author || 'Auteur')}</div>
              <div class="m-perf-row" style="font-size:11.5px;">
                <span><i class="fa-solid fa-eye" style="color:#e11d48;"></i> ${(third.views || 0).toLocaleString('fr-FR')}</span>
              </div>
            </div>
          </a>
        `;
      }
      html += `</div>`;
    }

    podiumContainer.innerHTML = html;
  }

  // --- RENDER LEADERBOARD ROWS (#4, #5, #6...) ---
  function renderLeaderboard(rankings) {
    if (!leaderboardContainer) return;

    const runners = rankings.filter(r => r.rank > 3);

    if (runners.length === 0) {
      if (!matureData.podium || matureData.podium.length === 0) {
        leaderboardContainer.innerHTML = `
          <div class="m-empty-state">
            <i class="fa-solid fa-lock m-empty-icon"></i>
            <h3 style="color:#fff; font-size:17px; margin-bottom:6px;">Aucune série dans le classement</h3>
            <p style="font-size:13px;">Activez le bouton <strong>Mature +18</strong> sur vos séries depuis le Panel Admin pour les voir s'afficher automatiquement ici !</p>
          </div>
        `;
      } else {
        leaderboardContainer.innerHTML = '';
      }
      return;
    }

    const fallbackCover = 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400';

    leaderboardContainer.innerHTML = runners.map(r => {
      const rankNum = r.rank < 10 ? '0' + r.rank : r.rank;
      return `
        <a href="/series.html?id=${encodeURIComponent(r.id)}" class="m-lead-row">
          <div class="m-lead-rank">${rankNum}</div>
          <img src="${r.cover || fallbackCover}" class="m-lead-cover" alt="" onerror="this.src='${fallbackCover}'">
          <div class="m-lead-meta">
            <div class="m-lead-title">${escapeHtml(r.title)}</div>
            <div class="m-lead-sub">
              <span><i class="fa-solid fa-pen-nib"></i> ${escapeHtml(r.author || 'Auteur')}</span>
              <span class="m-logo-badge" style="font-size:9px; padding:1px 5px;">+18</span>
            </div>
          </div>
          <div class="m-lead-stats">
            <span style="color:#fbbf24; font-weight:700;"><i class="fa-solid fa-star"></i> ${(r.rating || 4.8).toFixed ? r.rating.toFixed(1) : r.rating}</span>
            <span class="m-lead-views"><i class="fa-solid fa-eye" style="color:#e11d48;"></i> ${(r.views || 0).toLocaleString('fr-FR')}</span>
            <span class="m-btn-read" style="padding:6px 12px; font-size:11.5px;"><i class="fa-solid fa-arrow-right"></i></span>
          </div>
        </a>
      `;
    }).join('');
  }

  // --- RENDER DERNIERES SORTIES ---
  function renderLatest(latest) {
    if (!latestContainer) return;

    if (!latest || latest.length === 0) {
      latestContainer.innerHTML = '<div style="color:var(--m-text-muted); font-size:13px; padding: 12px 0;">Aucune parution récente dans cette section.</div>';
      return;
    }

    const fallbackCover = 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400';

    latestContainer.innerHTML = latest.map(item => {
      const volCount = (item.volumes && item.volumes.length) || 1;
      return `
        <a href="/series.html?id=${encodeURIComponent(item.id)}" class="m-rel-card">
          <div class="m-rel-cover-wrap">
            <img src="${item.cover || fallbackCover}" class="m-rel-cover" alt="" onerror="this.src='${fallbackCover}'">
            <span class="m-rel-tag">+18</span>
          </div>
          <div class="m-rel-body">
            <div class="m-rel-title">${escapeHtml(item.title)}</div>
            <div class="m-rel-footer">
              <span>${volCount} tome${volCount > 1 ? 's' : ''}</span>
              <span style="color:#fbbf24;"><i class="fa-solid fa-star"></i> ${(item.rating || 4.8).toFixed ? item.rating.toFixed(1) : item.rating}</span>
            </div>
          </div>
        </a>
      `;
    }).join('');
  }

  function renderEmptyState(msg) {
    if (leaderboardContainer) {
      leaderboardContainer.innerHTML = `<div class="m-empty-state"><p>${escapeHtml(msg)}</p></div>`;
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
  }

  // Init
  document.addEventListener('DOMContentLoaded', checkAgeVerification);
})();
