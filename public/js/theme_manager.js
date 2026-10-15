/**
 * NovelTrad - Global Theme Manager
 * Supports: 'dark' (default), 'light', 'sepia', 'midnight'
 * Integrates with Account Settings, Guest View, and Reader.
 */
(function() {
  'use strict';

  const STORAGE_KEY = 'noveltrad_global_theme';
  const VALID_THEMES = ['dark', 'light', 'sepia', 'midnight'];

  function getStoredTheme() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('noveltrad_reader_theme');
      if (saved && VALID_THEMES.includes(saved)) return saved;
    } catch(e) {}
    return 'dark'; // Dark is default
  }

  function applyTheme(theme, save = true) {
    if (!VALID_THEMES.includes(theme)) theme = 'dark';

    const root = document.documentElement;
    // Remove all theme classes
    root.classList.remove('dark', 'theme-light', 'theme-sepia', 'theme-midnight');

    if (theme === 'light') {
      root.classList.add('theme-light');
    } else if (theme === 'sepia') {
      root.classList.add('theme-sepia');
    } else if (theme === 'midnight') {
      root.classList.add('theme-midnight');
      root.classList.add('dark');
    } else {
      root.classList.add('dark');
    }

    if (save) {
      try {
        localStorage.setItem(STORAGE_KEY, theme);
        localStorage.setItem('noveltrad_reader_theme', theme);
      } catch(e) {}
    }

    // Update UI controls
    updateThemePickersUI(theme);

    // Dispatch event so other modules (like reader) can sync if open
    window.dispatchEvent(new CustomEvent('noveltrad-theme-changed', { detail: { theme } }));
  }

  function updateThemePickersUI(theme) {
    // 1. Update dropdown selects
    const selects = document.querySelectorAll('#accountSettingTheme, .app-theme-select');
    selects.forEach(sel => {
      if (sel) sel.value = theme;
    });

    // 2. Update theme pill cards
    const pills = document.querySelectorAll('.theme-pill-card');
    pills.forEach(pill => {
      const pTheme = pill.getAttribute('data-theme');
      if (pTheme === theme) {
        pill.classList.add('active');
      } else {
        pill.classList.remove('active');
      }
    });
  }

  // Initialize immediately
  const initialTheme = getStoredTheme();
  applyTheme(initialTheme, false);

  // Setup DOM listeners once ready
  function initDOM() {
    updateThemePickersUI(getStoredTheme());

    // Listen to clicks on theme pills anywhere in document
    document.addEventListener('click', function(e) {
      const pill = e.target.closest('.theme-pill-card');
      if (pill) {
        const theme = pill.getAttribute('data-theme');
        if (theme) {
          applyTheme(theme, true);
          if (window.authManager && typeof window.authManager.showToast === 'function') {
            const labels = {
              'dark': 'Thème Sombre Cosmique activé',
              'light': 'Thème Clair Épuré activé',
              'sepia': 'Thème Sépia Papier Chaud activé',
              'midnight': 'Thème Nuit OLED activé'
            };
            window.authManager.showToast(labels[theme] || 'Thème mis à jour');
          }
        }
      }
    });

    // Listen to select change
    document.addEventListener('change', function(e) {
      if (e.target && (e.target.id === 'accountSettingTheme' || e.target.classList.contains('app-theme-select'))) {
        const theme = e.target.value;
        if (theme) {
          applyTheme(theme, true);
          if (window.authManager && typeof window.authManager.showToast === 'function') {
            const labels = {
              'dark': 'Thème Sombre Cosmique activé',
              'light': 'Thème Clair Épuré activé',
              'sepia': 'Thème Sépia Papier Chaud activé',
              'midnight': 'Thème Nuit OLED activé'
            };
            window.authManager.showToast(labels[theme] || 'Thème mis à jour');
          }
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
