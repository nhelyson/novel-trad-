/**
 * NovelTrad - Global Theme Manager (Dark & Light)
 * Haute lisibilité & transition instantanée sans flash
 */
(function() {
  'use strict';

  const STORAGE_KEY = 'noveltrad_global_theme';
  const VALID_THEMES = ['dark', 'light'];

  function getStoredTheme() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && VALID_THEMES.includes(saved)) return saved;
    } catch(e) {}
    return 'dark'; // Sombre par défaut
  }

  function applyTheme(theme, save = true) {
    if (!VALID_THEMES.includes(theme)) theme = 'dark';

    const root = document.documentElement;
    root.classList.remove('dark', 'theme-light', 'theme-sepia', 'theme-midnight');

    if (theme === 'light') {
      root.classList.add('theme-light');
    } else {
      root.classList.add('dark');
    }

    if (save) {
      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch(e) {}
    }

    updateThemeUI(theme);

    // Déclencher un événement global
    window.dispatchEvent(new CustomEvent('noveltrad-theme-changed', { detail: { theme } }));
  }

  function updateThemeUI(theme) {
    // 1. Mettre à jour les sélecteurs <select>
    const selects = document.querySelectorAll('#accountSettingTheme, .app-theme-select');
    selects.forEach(sel => {
      if (sel) sel.value = theme;
    });

    // 2. Mettre à jour les cartes interactives (Dual Cards)
    const cards = document.querySelectorAll('.theme-mode-card, .theme-pill-card');
    cards.forEach(card => {
      const cardTheme = card.getAttribute('data-theme');
      if (cardTheme === theme) {
        card.classList.add('active');
      } else {
        card.classList.remove('active');
      }
    });
  }

  // Initialisation immédiate
  const initialTheme = getStoredTheme();
  applyTheme(initialTheme, false);

  function initDOM() {
    updateThemeUI(getStoredTheme());

    // Clic sur les cartes de mode (Dark / Light)
    document.addEventListener('click', function(e) {
      const card = e.target.closest('.theme-mode-card, .theme-pill-card');
      if (card) {
        const theme = card.getAttribute('data-theme');
        if (theme && VALID_THEMES.includes(theme)) {
          applyTheme(theme, true);
          if (window.authManager && typeof window.authManager.showToast === 'function') {
            const label = theme === 'light' ? 'Mode Clair activé' : 'Mode Sombre Cosmique activé';
            window.authManager.showToast(label);
          }
        }
      }
    });

    // Changement sur select standard
    document.addEventListener('change', function(e) {
      if (e.target && (e.target.id === 'accountSettingTheme' || e.target.classList.contains('app-theme-select'))) {
        const theme = e.target.value;
        if (theme && VALID_THEMES.includes(theme)) {
          applyTheme(theme, true);
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDOM);
  } else {
    initDOM();
  }

  window.setNovelTradTheme = applyTheme;
  window.getNovelTradTheme = getStoredTheme;
})();
