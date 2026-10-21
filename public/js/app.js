/* ==========================================================================
   NovelTrad AI Studio - Client App Logic (Documents & Independent Video Modules)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // GUARD: Do not execute workspace logic on series.html
  if (window.location.pathname.includes('series.html')) {
    return;
  }

  // Global State
  let selectedFile = null;
    let translatedBlobUrl = null;
  let convertedPdfBlobUrl = null;
  let srtBlobUrl = null;
    let activeEventSource = null;
    let currentJobId = null;
    let currentSrtContent = null;

  // --- MODERN FULL NOVELTRAD ROUTING & NAVIGATION ---
  const tabHomeBtn = document.getElementById('tabHomeBtn');
  const tabCatalogBtn = document.getElementById('tabCatalogBtn');
  const tabLibraryBtn = document.getElementById('tabLibraryBtn');
  const tabContinueBtn = document.getElementById('tabContinueBtn');
  const tabFavoritesBtn = document.getElementById('tabFavoritesBtn');
  const tabReadingHistoryBtn = document.getElementById('tabReadingHistoryBtn');
  const tabDocsBtn = document.getElementById('tabDocsBtn');
    const btnNavContributorStudio = document.getElementById('btnNavContributorStudio');
  const btnNavAdminPanel = document.getElementById('btnNavAdminPanel');

  const homeModuleContainer = document.getElementById('homeModuleContainer');
  const catalogModule = document.getElementById('catalogModule');
  const editorialModule = document.getElementById('editorialModule');
  const newsModule = document.getElementById('newsModule');
  const libraryModule = document.getElementById('libraryModule');
  const docModuleContainer = document.getElementById('docModuleContainer');
    const contributorModuleContainer = document.getElementById('contributorModuleContainer');
  const adminModuleContainer = document.getElementById('adminModuleContainer');
  const accountModuleContainer = document.getElementById('accountModuleContainer');

  function setActiveTab(activeBtn, activeModule) {
    // 1. Reset standard buttons
    document.querySelectorAll('.btn-sidebar, .nav-item-btn, .nav-dropdown-link, .nav-mobile-btn, .btn-nav-auth-pill').forEach(btn => {
      btn.classList.remove('active');
    });

    // 2. Clear dropdown triggers
    const navExplorerTrigger = document.getElementById('navExplorerTrigger');
    const navLibraryTrigger = document.getElementById('navLibraryTrigger');
    const navTradTrigger = document.getElementById('navTradTrigger');
    
    if (navExplorerTrigger) navExplorerTrigger.classList.remove('active');
    if (navLibraryTrigger) navLibraryTrigger.classList.remove('active');
    if (navTradTrigger) navTradTrigger.classList.remove('active');
    if (tabHomeBtn) tabHomeBtn.classList.remove('active');

    // 3. Highlight active button & corresponding parent dropdown trigger
    if (activeBtn) {
      activeBtn.classList.add('active');
      const btnId = activeBtn.id || '';
      
      if (btnId === 'tabHomeBtn') {
        const m = document.getElementById('mobileHomeBtn');
        if (m) m.classList.add('active');
      } else if (['tabCatalogBtn', 'tabPlanningBtn', 'tabNewsBtn'].includes(btnId)) {
        if (navExplorerTrigger) navExplorerTrigger.classList.add('active');
        const mapMob = {
          'tabCatalogBtn': 'mobileCatalogBtn',
          'tabPlanningBtn': 'mobilePlanningBtn',
          'tabNewsBtn': 'mobileNewsBtn'
        };
        const m = document.getElementById(mapMob[btnId]);
        if (m) m.classList.add('active');
      } else if (false && btnId === 'tabCatalogBtn') {
        if (navExplorerTrigger) navExplorerTrigger.classList.add('active');
        const m = document.getElementById('mobileCatalogBtn');
        if (m) m.classList.add('active');
      } else if (['tabLibraryBtn', 'tabContinueBtn', 'tabFavoritesBtn', 'tabReadingHistoryBtn'].includes(btnId)) {
        if (navLibraryTrigger) navLibraryTrigger.classList.add('active');
        const mapMob = {
          'tabLibraryBtn': 'mobileLibraryBtn',
          'tabContinueBtn': 'mobileContinueBtn',
          'tabFavoritesBtn': 'mobileFavoritesBtn',
          'tabReadingHistoryBtn': 'mobileReadingHistoryBtn'
        };
        const m = document.getElementById(mapMob[btnId]);
        if (m) m.classList.add('active');
      } else if (['tabDocsBtn', 'historyBtn'].includes(btnId)) {
        if (navTradTrigger) navTradTrigger.classList.add('active');
        const mapMob = {
          'tabDocsBtn': 'mobileDocsBtn',
                    'historyBtn': 'mobileHistoryBtn'
        };
        const m = document.getElementById(mapMob[btnId]);
        if (m) m.classList.add('active');
      }
    }

    // 4. Contrôle d'accès strict par rôle avant d'afficher un module protégé
    const auth = window.authManager || window.supabaseAuthManager;
    const curContribCheck = document.getElementById('contributorModuleContainer');
    if (curContribCheck && activeModule === curContribCheck) {
      if (!auth || !auth.isContributor()) {
        if (tabHomeBtn) tabHomeBtn.click();
        return;
      }
    }
    const curAdmCheck = document.getElementById('adminModuleContainer');
    if (curAdmCheck && activeModule === curAdmCheck) {
      if (!auth || !auth.isAdmin()) {
        if (tabHomeBtn) tabHomeBtn.click();
        return;
      }
    }

    // Hide all module containers
    if (homeModuleContainer) homeModuleContainer.classList.add('hidden');
    if (catalogModule) catalogModule.classList.add('hidden');
    if (editorialModule) editorialModule.classList.add('hidden');
    if (newsModule) newsModule.classList.add('hidden');
    if (docModuleContainer) docModuleContainer.classList.add('hidden');
    const curContribHide = document.getElementById('contributorModuleContainer'); if (curContribHide) curContribHide.classList.add('hidden');
    const curAdmHide = document.getElementById('adminModuleContainer'); if (curAdmHide) curAdmHide.classList.add('hidden');
    if (accountModuleContainer) accountModuleContainer.classList.add('hidden');
    if (libraryModule) {
      libraryModule.classList.add('hidden');
    }

    // 5. Show requested module
    if (activeModule) {
      activeModule.classList.remove('hidden');
      activeModule.style.display = '';
    }

    // 6. Show library filter bar only when library is active
    const filterBar = document.getElementById('librarySubMenu');
    if (filterBar) {
      if (activeModule && activeModule.id === 'libraryModule') {
        filterBar.classList.remove('hidden');
      } else {
        filterBar.classList.add('hidden');
      }
    }

    // Reset immédiat du scroll vertical et horizontal pour garantir le positionnement en tête de page
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    const mainContentEl = document.querySelector('.main-content');
    if (mainContentEl) {
      mainContentEl.scrollTop = 0;
      mainContentEl.scrollLeft = 0;
    }
  }

  window.setActiveTab = setActiveTab;

  // Global Tab Openers
  function openAccountTab() {
    const accModule = document.getElementById('accountModuleContainer');
    if (!accModule) return;
    setActiveTab(null, accModule);
    if (window.authManager && typeof window.authManager.renderProfileView === 'function') {
      window.authManager.renderProfileView();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  window.openAccountTab = openAccountTab;

  let _isLoadingContributorBundle = false;

  async function openContributorTab() {
    // 1. Attente initiale que Supabase Auth initialise la session
    if (window.authManager) {
      try {
        if (!window.authManager.currentUser && window.authManager.isLoading !== false) {
          await Promise.race([
            new Promise(resolve => {
              const check = () => {
                if (window.authManager.currentUser || window.authManager.isLoading === false) resolve();
                else setTimeout(check, 50);
              };
              check();
            }),
            new Promise(r => setTimeout(r, 600))
          ]);
        }
      } catch(e) {}
    }

    // 2. Si non-contributeur : silence radio total, on efface le hash et on reste sur l'accueil
    const isContrib = window.authManager && typeof window.authManager.isContributor === 'function' && window.authManager.isContributor();
    if (!isContrib) {
      if (window.location.hash === '#contributor' || window.location.hash === '#studio') {
        history.replaceState(null, '', window.location.pathname);
      }
      return;
    }

    // 3. Si le studio contributeur est déjà monté dans le DOM
    let contribModule = document.getElementById('contributorModuleContainer');
    if (contribModule && window.contributorManager) {
      setActiveTab(null, contribModule);
      if (typeof window.contributorManager.initStudio === 'function') {
        window.contributorManager.initStudio();
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // 4. Si pas encore monté, récupération sécurisée auprès du serveur
    if (_isLoadingContributorBundle) return;
    _isLoadingContributorBundle = true;

    try {
      const token = window.authManager ? await window.authManager.getAccessToken() : null;
      if (!token) throw new Error('Token requis');

      const res = await fetch('/api/contributor/bundle', {
        headers: { 'Authorization': 'Bearer ' + token }
      });

      if (!res.ok) {
        history.replaceState(null, '', window.location.pathname);
        return;
      }

      const data = await res.json();
      if (data && data.success && data.html) {
        let mount = document.getElementById('contributorMountPoint');
        if (!mount) {
          mount = document.createElement('div');
          mount.id = 'contributorMountPoint';
          const main = document.querySelector('main.app-main') || document.querySelector('main');
          const adminMount = document.getElementById('adminMountPoint');
          const footer = document.getElementById('noveltradFooter');
          if (main && adminMount) {
            main.insertBefore(mount, adminMount);
          } else if (main && footer) {
            main.insertBefore(mount, footer);
          } else if (main) {
            main.appendChild(mount);
          } else {
            document.body.appendChild(mount);
          }
        }

        mount.innerHTML = data.html;

        if (data.js && !window.contributorManager) {
          const s = document.createElement('script');
          s.textContent = data.js;
          document.body.appendChild(s);
        }

        contribModule = document.getElementById('contributorModuleContainer');
        if (contribModule) {
          setActiveTab(null, contribModule);
          if (window.contributorManager && typeof window.contributorManager.initStudio === 'function') {
            window.contributorManager.initStudio();
          }
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }
    } catch(err) {
      console.warn('[Contributor Lazy Load Error]', err);
    } finally {
      _isLoadingContributorBundle = false;
    }
  }
  window.openContributorTab = openContributorTab;

  let _isLoadingAdminBundle = false;

  async function openAdminTab() {
    // 1. Attente initiale que Supabase Auth initialise la session
    if (window.authManager) {
      try {
        if (!window.authManager.currentUser && window.authManager.isLoading !== false) {
          await Promise.race([
            new Promise(resolve => {
              const check = () => {
                if (window.authManager.currentUser || window.authManager.isLoading === false) resolve();
                else setTimeout(check, 50);
              };
              check();
            }),
            new Promise(r => setTimeout(r, 600))
          ]);
        }
      } catch(e) {}
    }

    // 2. Si non-admin : silence radio total, on efface le hash et on reste sur l'accueil
    const isAdmin = window.authManager && typeof window.authManager.isAdmin === 'function' && window.authManager.isAdmin();
    if (!isAdmin) {
      if (window.location.hash === '#admin') {
        history.replaceState(null, '', window.location.pathname);
      }
      return;
    }

    // 3. Si l'admin module est déjà monté dans le DOM
    let adminModule = document.getElementById('adminModuleContainer');
    if (adminModule && window.adminManager) {
      setActiveTab(null, adminModule);
      if (typeof window.adminManager.initAdmin === 'function') {
        window.adminManager.initAdmin();
      }
      window.scrollTo(0, 0);
      return;
    }

    // 4. Si pas encore monté, récupération sécurisée auprès du serveur
    if (_isLoadingAdminBundle) return;
    _isLoadingAdminBundle = true;

    try {
      const token = window.authManager ? await window.authManager.getAccessToken() : null;
      if (!token) throw new Error('Token requis');

      const res = await fetch('/api/admin/bundle', {
        headers: { 'Authorization': 'Bearer ' + token }
      });

      if (!res.ok) {
        history.replaceState(null, '', window.location.pathname);
        return;
      }

      const data = await res.json();
      if (data && data.success && data.html) {
        let mount = document.getElementById('adminMountPoint');
        if (!mount) {
          mount = document.createElement('div');
          mount.id = 'adminMountPoint';
          const main = document.querySelector('main.app-main') || document.querySelector('main');
          const footer = document.getElementById('noveltradFooter');
          if (main && footer) {
            main.insertBefore(mount, footer);
          } else if (main) {
            main.appendChild(mount);
          } else {
            document.body.appendChild(mount);
          }
        }

        mount.innerHTML = data.html;

        if (data.js && !window.adminManager) {
          const s = document.createElement('script');
          s.textContent = data.js;
          document.body.appendChild(s);
        }

        adminModule = document.getElementById('adminModuleContainer');
        if (adminModule) {
          setActiveTab(null, adminModule);
          if (window.adminManager && typeof window.adminManager.initAdmin === 'function') {
            window.adminManager.initAdmin();
          }
          window.scrollTo(0, 0);
        }
      }
    } catch(err) {
      console.warn('[Admin Lazy Load Error]', err);
    } finally {
      _isLoadingAdminBundle = false;
    }
  }
  window.openAdminTab = openAdminTab;

  // URL Hash & Param Routing Handler
  function handleHashRouting() {
    const hash = window.location.hash || '';
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab') || '';

    if (hash === '#account' || hash === '#profil' || hash === '#profile' || tabParam === 'account' || tabParam === 'profil') {
      openAccountTab();
    } else if (hash === '#contributor' || hash === '#studio' || tabParam === 'contributor' || tabParam === 'studio') {
      openContributorTab();
    } else if (hash === '#admin' || tabParam === 'admin') {
      openAdminTab();
    } else if (hash === '#news' || hash === '#actualites' || hash === '#annonces' || tabParam === 'news') {
      openNewsTab();
    }
  }
  window.addEventListener('hashchange', handleHashRouting);
  setTimeout(handleHashRouting, 100);


  // Tab click listeners
  if (tabHomeBtn) {
    tabHomeBtn.addEventListener('click', () => {
      setActiveTab(tabHomeBtn, homeModuleContainer);
      if (window.HomeLnoriManager) {
        if (typeof window.HomeLnoriManager.reloadAllData === 'function') {
          window.HomeLnoriManager.reloadAllData();
        } else if (typeof window.HomeLnoriManager.init === 'function') {
          window.HomeLnoriManager.init(true);
        }
      }
    });
  }

  
  const tabPlanningBtn = document.getElementById('tabPlanningBtn');
  const tabNewsBtn = document.getElementById('tabNewsBtn');
  const mobilePlanningBtn = document.getElementById('mobilePlanningBtn');
  const mobileNewsBtn = document.getElementById('mobileNewsBtn');

  if (tabPlanningBtn) {
    tabPlanningBtn.addEventListener('click', () => {
      setActiveTab(tabPlanningBtn, editorialModule);
      if (window.EditorialManager) {
        window.EditorialManager.init();
        window.EditorialManager.switchTab('schedule');
      }
    });
  }

  function openNewsTab() {
    if (tabNewsBtn && newsModule) {
      setActiveTab(tabNewsBtn, newsModule);
    }
    if (window.NewsManager && typeof window.NewsManager.init === 'function') {
      window.NewsManager.init();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  window.openNewsTab = openNewsTab;

  if (tabNewsBtn) {
    tabNewsBtn.addEventListener('click', openNewsTab);
  }

  if (mobilePlanningBtn) {
    mobilePlanningBtn.addEventListener('click', () => {
      if (typeof closeMobileDrawer === 'function') closeMobileDrawer();
      if (tabPlanningBtn) tabPlanningBtn.click();
    });
  }

  if (mobileNewsBtn) {
    mobileNewsBtn.addEventListener('click', () => {
      if (typeof closeMobileDrawer === 'function') closeMobileDrawer();
      openNewsTab();
    });
  }

  if (tabCatalogBtn) {
    tabCatalogBtn.addEventListener('click', () => {
      setActiveTab(tabCatalogBtn, catalogModule);
      if (window.initCatalog) {
        window.initCatalog();
      }
    });
  }

  if (tabLibraryBtn) {
    tabLibraryBtn.addEventListener('click', () => {
      setActiveTab(tabLibraryBtn, libraryModule);
      if (typeof initLibrary === 'function') initLibrary();
    });
  }

  if (tabContinueBtn) {
    tabContinueBtn.addEventListener('click', () => {
      setActiveTab(tabLibraryBtn, libraryModule);
      if (typeof initLibrary === 'function') initLibrary();
      setTimeout(() => {
        const hero = document.getElementById('continueReadingHero');
        if (hero && !hero.classList.contains('hidden')) {
          hero.scrollIntoView({ behavior: 'smooth' });
        }
      }, 100);
    });
  }

  if (tabFavoritesBtn) {
    tabFavoritesBtn.addEventListener('click', () => {
      setActiveTab(tabLibraryBtn, libraryModule);
      if (typeof initLibrary === 'function') initLibrary();
      setTimeout(() => {
        const favPill = document.querySelector('.lib-pill[data-filter="favorites"]');
        if (favPill) favPill.click();
      }, 50);
    });
  }

  if (tabReadingHistoryBtn) {
    tabReadingHistoryBtn.addEventListener('click', () => {
      setActiveTab(tabLibraryBtn, libraryModule);
      if (typeof initLibrary === 'function') initLibrary();
      setTimeout(() => {
        const readingPill = document.querySelector('.lib-pill[data-filter="reading"]');
        if (readingPill) readingPill.click();
      }, 50);
    });
  }

  if (tabDocsBtn) {
    tabDocsBtn.addEventListener('click', () => {
      setActiveTab(tabDocsBtn, docModuleContainer);
    });
  }

  
  if (btnNavContributorStudio) {
    btnNavContributorStudio.addEventListener('click', () => {
      const auth = window.authManager || window.supabaseAuthManager;
      if (!auth || !auth.isContributor()) {
        alert('Accès réservé : Vous devez être Contributeur ou Administrateur pour accéder au Studio.');
        return;
      }
      setActiveTab(btnNavContributorStudio, contributorModuleContainer);
      if (window.contributorManager) {
        window.contributorManager.initStudio();
      }
    });
  }

  if (btnNavAdminPanel) {
    btnNavAdminPanel.addEventListener('click', () => {
      openAdminTab();
    });
  }

  // --- MOBILE DRAWER WIRING ---
  const topnavHamburger = document.getElementById('topnavHamburger');
  const navMobileDrawer = document.getElementById('navMobileDrawer');
  const navMobileCloseBtn = document.getElementById('navMobileCloseBtn');
  const navMobileBackdrop = document.getElementById('navMobileBackdrop');
  const navMobileSearchToggle = document.getElementById('navMobileSearchToggle');
  const navMobileSearchInput = document.getElementById('navMobileSearchInput');

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

  function bindMobileNav(mobileId, desktopId) {
    const mobBtn = document.getElementById(mobileId);
    const deskBtn = document.getElementById(desktopId);
    if (mobBtn && deskBtn) {
      mobBtn.addEventListener('click', () => {
        deskBtn.click();
        closeMobileDrawer();
      });
    }
  }

  bindMobileNav('mobileHomeBtn', 'tabHomeBtn');
  bindMobileNav('mobileCatalogBtn', 'tabCatalogBtn');
  bindMobileNav('mobileContinueBtn', 'tabContinueBtn');
  bindMobileNav('mobileLibraryBtn', 'tabLibraryBtn');
  bindMobileNav('mobileFavoritesBtn', 'tabFavoritesBtn');
  bindMobileNav('mobileReadingHistoryBtn', 'tabReadingHistoryBtn');
  bindMobileNav('mobileDocsBtn', 'tabDocsBtn');
    bindMobileNav('mobileHistoryBtn', 'historyBtn');
  bindMobileNav('mobileLoginBtn', 'navLoginBtn');

  // Compact Navbar Global Search Controller
  const navGlobalSearchInput = document.getElementById('navGlobalSearchInput');
  const navSearchClearBtn = document.getElementById('navSearchClearBtn');

  if (navGlobalSearchInput) {
    let globalSearchDebounce = null;
    navGlobalSearchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      if (navSearchClearBtn) {
        navSearchClearBtn.classList.toggle('hidden', q.length === 0);
      }
      clearTimeout(globalSearchDebounce);
      globalSearchDebounce = setTimeout(() => {
        if (q.length > 0) {
          if (catalogModule && catalogModule.classList.contains('hidden')) {
            if (tabCatalogBtn) tabCatalogBtn.click();
          }
          const catInput = document.getElementById('catalogSearchInput');
          if (catInput) {
            catInput.value = q;
            catInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      }, 200);
    });

    if (navSearchClearBtn) {
      navSearchClearBtn.addEventListener('click', () => {
        navGlobalSearchInput.value = '';
        navSearchClearBtn.classList.add('hidden');
        const catInput = document.getElementById('catalogSearchInput');
        if (catInput) {
          catInput.value = '';
          catInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    }
  }

  if (navMobileSearchInput) {
    navMobileSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = navMobileSearchInput.value.trim();
        if (q) {
          if (tabCatalogBtn) tabCatalogBtn.click();
          closeMobileDrawer();
          setTimeout(() => {
            const catInput = document.getElementById('catalogSearchInput');
            if (catInput) {
              catInput.value = q;
              catInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }, 150);
        }
      }
    });
  }

  // --- INITIAL ROUTE DISPATCHER ---
  function handleInitialRoute() {
    const hash = window.location.hash || '';
    if (hash.startsWith('#catalog')) {
      if (tabCatalogBtn) tabCatalogBtn.click();
      if (window.initCatalog) {
        window.initCatalog();
      }
    } else if (hash === '#planning' || hash === '#calendar' || hash === '#calendrier') {
      if (tabPlanningBtn) tabPlanningBtn.click();
    } else if (hash === '#library') {
      if (tabLibraryBtn) tabLibraryBtn.click();
    } else if (hash === '#favorites') {
      if (tabFavoritesBtn) tabFavoritesBtn.click();
    } else if (hash === '#continue') {
      if (tabContinueBtn) tabContinueBtn.click();
    } else if (hash === '#reading-history') {
      if (tabReadingHistoryBtn) tabReadingHistoryBtn.click();
    } else if (hash === '#docs' || hash === '#video') {
      if (tabDocsBtn) tabDocsBtn.click();
    } else if (hash === '#contributor') {
      const auth = window.authManager || window.supabaseAuthManager;
      if (auth && auth.isContributor()) {
        if (btnNavContributorStudio) btnNavContributorStudio.click();
      } else {
        if (tabHomeBtn) tabHomeBtn.click();
      }
    } else if (hash === '#admin') {
      const auth = window.authManager || window.supabaseAuthManager;
      if (auth && auth.isAdmin()) {
        if (btnNavAdminPanel) btnNavAdminPanel.click();
      } else {
        if (tabHomeBtn) tabHomeBtn.click();
      }
    } else {
      // Default view is Home!
      if (tabHomeBtn) tabHomeBtn.click();
    }
  }

  // Run initial route dispatcher
  setTimeout(handleInitialRoute, 50);
  window.addEventListener('hashchange', handleInitialRoute);

  // --- DOCUMENT MODULE DOM ELEMENTS ---
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  const pdfDropzone = document.getElementById('pdfDropzone');
  const pdfFileInput = document.getElementById('pdfFileInput');
  const dropzoneEmpty = document.getElementById('dropzoneEmpty');
  const fileLoadedInfo = document.getElementById('fileLoadedInfo');
  const pdfFileName = document.getElementById('pdfFileName');
  const pdfFileSize = document.getElementById('pdfFileSize');
  const removePdfBtn = document.getElementById('removePdfBtn');

  const providerSelect = document.getElementById('providerSelect');
  const targetLangSelect = document.getElementById('targetLangSelect');
  const customApiKeyInput = document.getElementById('customApiKeyInput');
  const toggleApiKeyVisBtn = document.getElementById('toggleApiKeyVisBtn');
  const translateBtn = document.getElementById('translateBtn');

  const progressSection = document.getElementById('progressSection');
  const progressLabel = document.getElementById('progressLabel');
  const progressPercent = document.getElementById('progressPercent');
  const progressFill = document.getElementById('progressFill');
  const progressSubtext = document.getElementById('progressSubtext');

  const resultSection = document.getElementById('resultSection');
  const downloadPdfBtn = document.getElementById('downloadPdfBtn');
  const convertPdfSection = document.getElementById('convertPdfSection');
  const convertPdfBtn = document.getElementById('convertPdfBtn');
  const pdfDownloadRow = document.getElementById('pdfDownloadRow');
  const downloadConvertedPdfBtn = document.getElementById('downloadConvertedPdfBtn');

  const errorBanner = document.getElementById('errorBanner');
  const errorMessage = document.getElementById('errorMessage');

  const analyzeBtn = document.getElementById('analyzeBtn');
  const simulationModal = document.getElementById('simulationModal');
  const simulationBody = document.getElementById('simulationBody');
  const cancelSimBtn = document.getElementById('cancelSimBtn');
  const confirmSimBtn = document.getElementById('confirmSimBtn');

  const statSent = document.getElementById('statSent');
  const statSaved = document.getElementById('statSaved');
  const statHitRate = document.getElementById('statHitRate');

  // (Video module DOM elements removed)

  // Check Backend & Provider Status on Load
  checkApiStatus();
  loadDashboardStats();
  setInterval(loadDashboardStats, 10000);

  async function checkApiStatus() {
    try {
      const data = await ApiClient.checkStatus();

      if (data.nllbAvailable) {
        statusDot.className = 'status-dot green';
        statusText.textContent = '✓ NLLB Local disponible (Hors ligne)';
      } else if (data.deeplConfigured) {
        statusDot.className = 'status-dot green';
        statusText.textContent = 'DeepL API Configuré (.env)';
      } else {
        statusDot.className = 'status-dot warning';
        statusText.textContent = 'Clé API requise (Gemini / DeepL)';
      }
    } catch (err) {
      statusDot.className = 'status-dot warning';
      statusText.textContent = 'Serveur local prêt';
    }
  }

  // Password Visibility Toggle
  if (toggleApiKeyVisBtn) {
    toggleApiKeyVisBtn.addEventListener('click', () => {
      const type = customApiKeyInput.type === 'password' ? 'text' : 'password';
      customApiKeyInput.type = type;
      toggleApiKeyVisBtn.querySelector('i').className = type === 'password' ? 'fa-regular fa-eye' : 'fa-regular fa-eye-slash';
    });
  }

  function updateProviderUI() {
    if (!providerSelect || !customApiKeyInput) return;
    const p = providerSelect.value;
    if (p === 'gemini') {
      customApiKeyInput.placeholder = 'Clé Gemini API (AIzaSy... optionnelle si .env)';
    } else if (p === 'deepl') {
      customApiKeyInput.placeholder = 'Clé DeepL API (optionnelle si .env)';
    } else if (p === 'openai') {
      customApiKeyInput.placeholder = 'Clé OpenAI (sk-...)';
    } else {
      customApiKeyInput.placeholder = 'Saisir la clé API (optionnelle)...';
    }
  }

  if (providerSelect) {
    providerSelect.addEventListener('change', updateProviderUI);
    updateProviderUI();
  }

  // --- DOCUMENT DROPZONE EVENTS ---
  pdfDropzone.addEventListener('click', () => {
    pdfFileInput.click();
  });

  pdfDropzone.addEventListener('click', () => { pdfFileInput.click(); });
  pdfDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    pdfDropzone.classList.add('dragover');
  });

  pdfDropzone.addEventListener('dragleave', () => {
    pdfDropzone.classList.remove('dragover');
  });

  pdfDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    pdfDropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  pdfFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelected(e.target.files[0]);
    }
  });

  removePdfBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    resetFileSelection();
  });

  function handleFileSelected(file) {
    hideError();
    selectedFile = file;
    const ext = file.name.split('.').pop().toUpperCase();
    pdfFileName.textContent = file.name;
    pdfFileSize.textContent = `${(file.size / (1024 * 1024)).toFixed(2)} MB • Format ${ext}`;

    const iconEl = fileLoadedInfo.querySelector('.pdf-badge-icon i');
    if (iconEl) {
      iconEl.className = ext === 'EPUB' ? 'fa-solid fa-book-open' : 'fa-solid fa-file-pdf';
    }

    dropzoneEmpty.classList.add('hidden');
    fileLoadedInfo.classList.remove('hidden');
    translateBtn.disabled = false;
    analyzeBtn.disabled = false;

    hideResultSection();
  }

  function resetFileSelection() {
    selectedFile = null;
    currentJobId = null;
    pdfFileInput.value = '';
    fileLoadedInfo.classList.add('hidden');
    dropzoneEmpty.classList.remove('hidden');
    translateBtn.disabled = true;
    analyzeBtn.disabled = true;
    hideError();
    hideResultSection();
    hideProgressSection();

    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }
  }

  // (Video dropzone events removed)

  async function loadDashboardStats() {
    try {
      const apiKey = customApiKeyInput ? customApiKeyInput.value.trim() : '';
      const data = await ApiClient.getDashboardStats(apiKey);

      const statLimitEl = document.getElementById('statLimit');
      const statRemainingEl = document.getElementById('statRemaining');

      if (data.quotaInfo && !data.quotaInfo.error) {
        if (statSent) statSent.textContent = Number(data.quotaInfo.characterCount || 0).toLocaleString();
        if (statLimitEl) statLimitEl.textContent = Number(data.quotaInfo.characterLimit || 0).toLocaleString();
        if (statRemainingEl) statRemainingEl.textContent = Number(data.quotaInfo.charactersRemaining || 0).toLocaleString();
        if (statHitRate) statHitRate.textContent = `${data.quotaInfo.percentUsed || '0.0'} %`;
      } else if (data.quotaInfo && data.quotaInfo.error) {
        if (statSent) statSent.textContent = 'Indisponible';
        if (statLimitEl) statLimitEl.textContent = 'Indisponible';
        if (statRemainingEl) statRemainingEl.textContent = data.quotaInfo.reason === 'INVALID_API_KEY' ? 'Clé Invalide' : 'Erreur API';
        if (statHitRate) statHitRate.textContent = 'N/A';
      } else if (data.stats) {
        if (statSent) statSent.textContent = Number(data.stats.activeJobs || 0).toLocaleString() + ' jobs';
        if (statRemainingEl) statRemainingEl.textContent = Number(data.stats.cacheEntries || 0).toLocaleString();
      }
    } catch (err) {
      console.warn('Dashboard stats error:', err);
    }
  }

  // --- DOCUMENT SIMULATION & TRANSLATION ---
  analyzeBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    hideError();
    const formData = new FormData();
    formData.append('document', selectedFile);
    formData.append('targetLang', targetLangSelect.value);
    formData.append('provider', providerSelect ? providerSelect.value : 'gemini');
    if (customApiKeyInput.value.trim()) {
      formData.append('apiKey', customApiKeyInput.value.trim());
    }

    try {
      const sim = await ApiClient.analyzeNovel(formData);

      let quotaMessageHtml = '';
      if (sim.quotaCheck) {
        const qc = sim.quotaCheck;
        if (qc.canProceed) {
          quotaMessageHtml = `<p style="color: #34d399;"><strong>Vérification Quota :</strong> ✓ ${qc.message}</p>`;
        } else {
          quotaMessageHtml = `<p style="color: #f43f5e; white-space: pre-line;"><strong>Vérification Quota :</strong> ${qc.message}</p>`;
        }
      }

      const fileType = sim.fileType || 'DOCUMENT';
      const detailInfo = fileType === 'EPUB' 
        ? `<p><strong>Chapitres :</strong> ${sim.chapters}</p><p><strong>Blocs de texte :</strong> ${sim.totalTextBlocks}</p>`
        : `<p><strong>Pages :</strong> ${sim.pages || 'N/A'}</p>`;

      simulationBody.innerHTML = `
        <div style="background: rgba(0,0,0,0.25); padding: 15px; border-radius: 10px;">
          <p><strong>Fichier :</strong> ${sim.filename} (${fileType})</p>
          <p><strong>Taille :</strong> ${sim.sizeMB} Mo</p>
          ${detailInfo}
          <p><strong>Nombre total de caractères :</strong> ${Number(sim.totalCharacters || sim.rawCharacters || 0).toLocaleString()}</p>
          <hr style="border-color: rgba(255,255,255,0.1); margin: 10px 0;">
          ${quotaMessageHtml}
        </div>
      `;

      simulationModal.classList.remove('hidden');
    } catch (err) {
      showError(err.message || 'Erreur lors de la simulation.');
    }
  });

  cancelSimBtn.addEventListener('click', () => {
    simulationModal.classList.add('hidden');
  });

  confirmSimBtn.addEventListener('click', () => {
    simulationModal.classList.add('hidden');
    translateBtn.click();
  });

    translateBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    hideError();
    hideResultSection();
    showProgressSection();

    translateBtn.disabled = true;
    const targetLang = targetLangSelect.value;
    const customApiKey = customApiKeyInput.value.trim();
    const provider = providerSelect ? providerSelect.value : 'gemini';
    currentJobId = 'job_' + Date.now();

    const formData = new FormData();
    formData.append('document', selectedFile);
    formData.append('jobId', currentJobId);
    formData.append('targetLang', targetLang);
    formData.append('provider', provider);
    if (customApiKey) {
      formData.append('apiKey', customApiKey);
    }

    connectSSE(currentJobId);

    try {
      const resultData = await ApiClient.translateDocument(formData);
      
      if (resultData.secretToken) {
        window.currentSecretToken = resultData.secretToken;
        if (typeof saveJobToHistory === 'function') {
          saveJobToHistory(currentJobId, window.currentSecretToken);
        }
      }
      
    } catch (err) {
      hideProgressSection();
      showError(err.message || 'Une erreur inattendue est survenue.', Boolean(err.isQuotaExceeded || err.isAuthError));
      translateBtn.disabled = false;
      if (activeEventSource) {
        activeEventSource.close();
        activeEventSource = null;
      }
    }
  });

  if (convertPdfBtn) {
    convertPdfBtn.addEventListener('click', async () => {
      if (!currentJobId && !selectedFile) return;

      hideError();
      showProgressSection();
      convertPdfBtn.disabled = true;

      const conversionJobId = currentJobId || ('job_pdf_conv_' + Date.now());
      connectSSE(conversionJobId);

      const formData = new FormData();
      formData.append('jobId', conversionJobId);
      if (selectedFile) {
        formData.append('filename', selectedFile.name);
      }

      try {
        const pdfBlob = await ApiClient.convertEpubToPdf(formData);
        convertedPdfBlobUrl = URL.createObjectURL(pdfBlob);

        const originalName = selectedFile ? selectedFile.name.replace(/\.[^/.]+$/, "") : "roman";
        const pdfOutputFilename = `${originalName}_FR.pdf`;

        downloadConvertedPdfBtn.href = convertedPdfBlobUrl;
        downloadConvertedPdfBtn.download = pdfOutputFilename;
        downloadConvertedPdfBtn.innerHTML = `<i class="fa-solid fa-file-pdf"></i> Télécharger le PDF (${pdfOutputFilename})`;

        pdfDownloadRow.classList.remove('hidden');
        updateProgress(100, 'Conversion PDF terminée avec succès !');

        setTimeout(() => {
          hideProgressSection();
          showResultSection();
          convertPdfBtn.disabled = false;
        }, 600);

      } catch (err) {
        hideProgressSection();
        showResultSection();
        showError(`⚠️ La conversion PDF a échoué : ${err.message}\nVotre EPUB traduit reste disponible au téléchargement ci-dessus.`);
        convertPdfBtn.disabled = false;
      } finally {
        if (activeEventSource) {
          activeEventSource.close();
          activeEventSource = null;
        }
      }
    });
  }

  // (Video module actions removed)

  // --- SSE PROGRESS CONNECTIONS ---
  function connectSSE(jobId) {
    if (activeEventSource) activeEventSource.close();

    activeEventSource = ApiClient.connectSSE(jobId, {
      onMessage: (job) => {
        if (!job) return;

        let statusText = job.statusMessage || 'Traitement en cours...';
        let percent = 0;

        if (job.status === 'WAITING_FOR_KEY') {
          percent = Math.round((job.currentBlock / (job.totalBlocks || 1)) * 80);
          statusText = `⏳ Clé 1 épuisée (${job.currentBlock} / ${job.totalBlocks} blocs traduits). Entrez la clé 2...`;
          showError(`⛔ Clé 1 épuisée à ${percent}% (${job.currentBlock} / ${job.totalBlocks} blocs traduits).<br>Saisissez votre deuxième clé API ci-dessous pour poursuivre la traduction sans recommencer :`, true);
          updateProgress(percent, statusText);
        } else if (job.status === 'FAILED' || job.status === 'QUOTA_EXCEEDED') {
           hideProgressSection();
           showError(job.statusMessage || 'Une erreur est survenue pendant la traduction asynchrone.', Boolean(job.statusMessage && (job.statusMessage.toLowerCase().includes('quota') || job.statusMessage.toLowerCase().includes('403') || job.status === 'QUOTA_EXCEEDED')));
           translateBtn.disabled = false;
           if (activeEventSource) {
              activeEventSource.close();
              activeEventSource = null;
           }
           return;
        } else if (job.phase === 'TRANSLATION' && job.totalBlocks > 0) {
          percent = Math.round((job.currentBlock / job.totalBlocks) * 80);
          statusText = `Traduction : ${job.currentBlock} / ${job.totalBlocks} blocs`;
        } else if (job.phase === 'RECONSTRUCTION') {
          if (job.totalPages > 0) {
            percent = 80 + Math.round((job.currentPage / job.totalPages) * 20);
            statusText = `Reconstruction PDF : page ${job.currentPage} / ${job.totalPages}`;
          } else if (job.totalChapters > 0) {
            percent = 80 + Math.round((job.currentChapter / job.totalChapters) * 20);
            statusText = `Reconstruction EPUB : chapitre ${job.currentChapter} / ${job.totalChapters}`;
          }
        } else if ((job.status === 'COMPLETED' || job.phase === 'COMPLETED')) {
          percent = 100;
          statusText = 'Traitement terminé avec succès !';
          
          // On utilise les donnees du job au cas ou la page a ete rafraichie
          const targetLang = job.targetLang || (window.targetLangSelect ? window.targetLangSelect.value : "FR");
          const ext = job.type === "epub" ? "epub" : (job.type === "pdf" ? "pdf" : "txt");
          const baseName = job.filename || (window.selectedFile ? window.selectedFile.name : "document");
          const originalName = baseName.replace(/\.[^/.]+$/, "");
          const outputFilename = `${originalName}_${targetLang.toLowerCase()}.${ext}`;
          
          let token = "";
          if (typeof getSavedJobs === "function") {
            const historyJobs = getSavedJobs();
            const savedJob = historyJobs.find(j => j.jobId === jobId);
            if (savedJob) token = savedJob.secretToken;
          }
          if (!token) token = window.currentSecretToken || "";
          
          downloadPdfBtn.href = `/api/download-job/${jobId}?token=${token}`;
          downloadPdfBtn.download = outputFilename;
          downloadPdfBtn.innerHTML = `<i class="fa-solid fa-download"></i> Télécharger le document Traduit (${outputFilename})`;
          
          const addToLibraryBtn = document.getElementById('addToLibraryBtn');
          if (addToLibraryBtn) {
            addToLibraryBtn.disabled = false;
            addToLibraryBtn.innerHTML = '<i class="fa-solid fa-bookmark"></i> Ajouter à ma bibliothèque';
            addToLibraryBtn.onclick = async () => {
              try {
                addToLibraryBtn.disabled = true;
                addToLibraryBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Ajout en cours...';
                const addRes = await fetch('/api/library/add-job-to-library', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ jobId })
                });
                const addData = await addRes.json();
                if (addData.success) {
                  addToLibraryBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Ajouté à votre bibliothèque !';
                  addToLibraryBtn.classList.remove('btn-secondary');
                  addToLibraryBtn.classList.add('btn-success');
                } else {
                  addToLibraryBtn.disabled = false;
                  addToLibraryBtn.innerHTML = '<i class="fa-solid fa-bookmark"></i> Réessayer l\'ajout';
                  alert(addData.message || "Erreur lors de l'ajout à la bibliothèque.");
                }
              } catch (e) {
                addToLibraryBtn.disabled = false;
                addToLibraryBtn.innerHTML = '<i class="fa-solid fa-bookmark"></i> Réessayer l\'ajout';
                alert("Erreur lors de l'ajout : " + e.message);
              }
            };
          }
          
          if (ext === "epub") {
            convertPdfSection.classList.remove("hidden");
            pdfDownloadRow.classList.add("hidden");
            convertPdfBtn.disabled = false;
          } else {
            convertPdfSection.classList.add("hidden");
          }
          
          setTimeout(() => {
            hideProgressSection();
            showResultSection();
          }, 1000);
        }

        updateProgress(Math.min(100, percent), statusText);
      },
      onError: () => {}
    });
  }

    function updateProgress(percent, labelText) {
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (progressPercent) progressPercent.textContent = `${percent}%`;
    if (labelText) {
      if (progressLabel) progressLabel.textContent = labelText;
      if (progressSubtext) progressSubtext.textContent = labelText;
    }
  }

  function showProgressSection() { progressSection.classList.remove('hidden'); updateProgress(0, 'Initialisation...'); }
  function hideProgressSection() { progressSection.classList.add('hidden'); }
  function showResultSection() { resultSection.classList.remove('hidden'); hideError(); }
  function hideResultSection() { resultSection.classList.add('hidden'); }
  const changeKeyInProgressBtn = document.getElementById('changeKeyInProgressBtn');
  const inlineKeyBox = document.getElementById('inlineKeyBox');
  const inlineApiKeyInput = document.getElementById('inlineApiKeyInput');
  const applyInlineKeyBtn = document.getElementById('applyInlineKeyBtn');
  const keyResumeBox = document.getElementById('keyResumeBox');
  const resumeApiKeyInput = document.getElementById('resumeApiKeyInput');
  const submitResumeKeyBtn = document.getElementById('submitResumeKeyBtn');

  if (changeKeyInProgressBtn && inlineKeyBox) {
    changeKeyInProgressBtn.addEventListener('click', () => {
      inlineKeyBox.classList.toggle('hidden');
    });
  }

  if (applyInlineKeyBtn && inlineApiKeyInput) {
    applyInlineKeyBtn.addEventListener('click', async () => {
      const newKey = inlineApiKeyInput.value.trim();
      if (!newKey) {
        alert('Veuillez saisir une clé API.');
        return;
      }
      if (!currentJobId) {
        alert('Aucun job actif à mettre à jour.');
        return;
      }
      
      let token = window.currentSecretToken || '';
      if (!token && typeof getSavedJobs === 'function') {
        const historyJobs = getSavedJobs();
        const savedJob = historyJobs.find(j => j.jobId === currentJobId);
        if (savedJob) token = savedJob.secretToken;
      }
      
      try {
        hideResultSection();
        const res = await fetch('/api/resume-translation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId: currentJobId, secretToken: token, apiKey: newKey, deeplApiKey: newKey, provider: providerSelect ? providerSelect.value : 'gemini' })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Erreur lors de la reprise');

        if (customApiKeyInput) customApiKeyInput.value = newKey;
        inlineKeyBox.classList.add('hidden');
        hideError(); // On cache la banniere d'erreur puisqu'on reprend
        updateProgress(progressPercent.textContent.replace('%',''), 'Reprise de la traduction en cours...');
      } catch (err) {
        alert('Erreur lors de la mise à jour de la clé : ' + err.message);
      }
    });
  }

  if (submitResumeKeyBtn && resumeApiKeyInput) {
    submitResumeKeyBtn.addEventListener('click', async () => {
      const newKey = resumeApiKeyInput.value.trim();
      if (!newKey) {
        alert('Veuillez saisir une nouvelle clé API.');
        return;
      }
      if (!currentJobId) {
        alert('Aucune session de traduction active à reprendre.');
        return;
      }
      if (customApiKeyInput) customApiKeyInput.value = newKey;
      await resumeTranslation(currentJobId, newKey);
    });
  }

  async function resumeTranslation(jobId, newApiKey) {
    hideError();
    hideResultSection();
    showProgressSection();
    if (translateBtn) translateBtn.disabled = true;

    // Connecter le flux SSE pour recevoir en temps réel la progression de la suite
    connectSSE(jobId);
    
    // Conserver le pourcentage actuel plutôt que de le remettre à 0
    let currentPct = 0;
    if (progressPercent && progressPercent.textContent) {
      currentPct = parseInt(progressPercent.textContent) || 0;
    }
    updateProgress(currentPct, 'Reprise de la traduction avec la nouvelle clé API...');

    try {
      let token = window.currentSecretToken || '';
      if (!token && typeof getSavedJobs === 'function') {
        const historyJobs = getSavedJobs();
        const savedJob = historyJobs.find(j => j.jobId === jobId);
        if (savedJob) token = savedJob.secretToken;
      }

      const response = await fetch('/api/resume-translation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          secretToken: token,
          apiKey: newApiKey,
          deeplApiKey: newApiKey,
          provider: providerSelect ? providerSelect.value : 'deepl'
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Erreur lors de la reprise de la traduction.');
      }

      // La traduction est relancée en arrière-plan avec succès !
      // On masque la boîte de saisie de la clé 2
      if (keyResumeBox) keyResumeBox.classList.add('hidden');
      if (resumeApiKeyInput) resumeApiKeyInput.value = '';

      // Le suivi SSE (connectSSE) prend immédiatement le relais
      // et mettra à jour la barre de progression en continu jusqu'à 100%.
      // Dès que le job est 'COMPLETED', connectSSE affichera le vrai bouton Télécharger.

    } catch (err) {
      hideProgressSection();
      showError(err.message || 'Une erreur est survenue lors de la reprise.', Boolean(err.isQuotaExceeded || err.isAuthError));
      if (translateBtn) translateBtn.disabled = false;
      if (activeEventSource) {
        activeEventSource.close();
        activeEventSource = null;
      }
    }
  }

  function showError(msg, isQuotaOrAuth = false) {
    errorMessage.innerHTML = msg.replace(/\n/g, '<br>');
    errorBanner.classList.remove('hidden');

    const containsQuotaKey = msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('clé') || msg.toLowerCase().includes('456') || msg.toLowerCase().includes('403') || msg.toLowerCase().includes('dépassement');
    if (keyResumeBox) {
      if (isQuotaOrAuth || containsQuotaKey) {
        keyResumeBox.classList.remove('hidden');
      } else {
        keyResumeBox.classList.add('hidden');
      }
    }
  }
  function hideError() { errorBanner.classList.add('hidden'); }

  // (Video UI helpers removed)
});


// ==========================================
// HISTORY & RESUME LOGIC
// ==========================================

function getSavedJobs() {
  try {
    return JSON.parse(localStorage.getItem('noveltrad_jobs') || '[]');
  } catch(e) { return []; }
}

function saveJobToHistory(jobId, secretToken) {
  const jobs = getSavedJobs();
  const existing = jobs.find(j => j.jobId === jobId);
  if (!existing) {
    jobs.push({ jobId, secretToken });
    localStorage.setItem('noveltrad_jobs', JSON.stringify(jobs));
  }
}

function removeJobFromHistory(jobId) {
  const jobs = getSavedJobs();
  const filtered = jobs.filter(j => j.jobId !== jobId);
  localStorage.setItem('noveltrad_jobs', JSON.stringify(filtered));
}

const historyBtn = document.getElementById('historyBtn');
const historyModal = document.getElementById('historyModal');
const closeHistoryModal = document.getElementById('closeHistoryModal');
const historyList = document.getElementById('historyList');

if (historyBtn) {
  historyBtn.addEventListener('click', async () => {
    historyModal.classList.remove('hidden');
    await refreshHistory();
  });
}
if (closeHistoryModal) {
  closeHistoryModal.addEventListener('click', () => historyModal.classList.add('hidden'));
}

async function refreshHistory() {
  historyList.innerHTML = '<div style="text-align:center; padding:2rem;">Chargement...</div>';
  const savedJobs = getSavedJobs();
  if (savedJobs.length === 0) {
    historyList.innerHTML = '<div style="text-align:center; color:#6b7280; padding:2rem;">Aucune traduction en attente.</div>';
    return;
  }

  try {
    const res = await fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobs: savedJobs })
    });
    
    if (!res.ok) throw new Error('Erreur de chargement');
    const data = await res.json();
    
    // Clean up local storage for jobs that server said don't exist
    const validJobIds = data.jobs.map(j => j.jobId);
    savedJobs.forEach(sj => {
      if (!validJobIds.includes(sj.jobId)) removeJobFromHistory(sj.jobId);
    });

    if (data.jobs.length === 0) {
      historyList.innerHTML = '<div style="text-align:center; color:#6b7280; padding:2rem;">Aucune traduction en attente.</div>';
      return;
    }

    historyList.innerHTML = '';
    data.jobs.forEach(job => {
      const jobEl = document.createElement('div');
      jobEl.style = 'border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem; display: flex; flex-direction: column; gap: 0.5rem;';
      
      let statusIcon = '??';
      if (job.status === 'WAITING_FOR_KEY') statusIcon = '??';
      if (job.status === 'QUOTA_EXCEEDED') statusIcon = '??';
      if (job.status === 'PAUSED') statusIcon = '??';
      if (job.status === 'COMPLETED') statusIcon = '?';

      let lastAct = Math.round((Date.now() - job.lastUpdated) / 60000);
      let timeText = lastAct < 1 ? "� l\'instant" : "il y a " + lastAct + " min";
      
      const savedJob = savedJobs.find(sj => sj.jobId === job.jobId);

      jobEl.innerHTML = `
        <div style="font-weight:bold; font-size:1rem;">${statusIcon} ${job.filename}</div>
        <div style="font-size:0.9rem; color:#4b5563;">Statut: ${job.statusMessage || job.status}</div>
        <div style="font-size:0.9rem; color:#4b5563;">Progression: ${job.progress}% (${job.currentBlock} / ${job.totalBlocks})</div>
        <div style="font-size:0.8rem; color:#9ca3af;">Dernière activité: ${timeText}</div>
        <div style="display:flex; gap:0.5rem; margin-top:0.5rem;">
          ${job.canResume ? `<button class="btn btn-primary" onclick="resumeJob('${job.jobId}', '${savedJob.secretToken}')">Reprendre</button>` : ''}
          ${job.status === 'COMPLETED' ? `<a class="btn btn-primary" href="/api/download-job/${job.jobId}?token=${savedJob.secretToken}">Télécharger</a>` : ''}
        </div>
      `;
      historyList.appendChild(jobEl);
    });

  } catch(e) {
    historyList.innerHTML = '<div style="text-align:center; color:#ef4444; padding:2rem;">Erreur de chargement de l\'historique.</div>';
  }
}

window.resumeJob = async function(jobId, secretToken) {
  const newKey = prompt("Veuillez entrer une cl� DeepL valide pour reprendre la traduction (laisser vide pour r�utiliser l\'actuelle):");
  if (newKey === null) return; // cancelled

  try {
    const res = await fetch('/api/resume-translation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, secretToken, apiKey: newKey.trim(), deeplApiKey: newKey.trim() })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Erreur lors de la reprise');
    
    historyModal.classList.add('hidden');
    
    // Set UI to translating state
    const dropzone = document.getElementById('pdfDropzone');
    if (dropzone) dropzone.classList.add('hidden');
    
    const progress = document.getElementById('progressSection');
    if (progress) progress.classList.remove('hidden');
    
    const result = document.getElementById('resultSection');
    if (result) result.classList.add('hidden');
    currentJobId = jobId;
    connectSSE(jobId);

  } catch(e) {
    alert("Erreur: " + e.message);
  }
}

  // --- HISTORY BADGE LOGIC ---
  async function updateHistoryBadge() {
    const badge = document.getElementById('historyBadge');
    if (!badge) return;
    
    const savedJobs = getSavedJobs();
    if (savedJobs.length === 0) {
      badge.classList.add('hidden');
      return;
    }
    
    try {
      const res = await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobs: savedJobs })
      });
      if (!res.ok) return;
      
      const data = await res.json();
      const validJobs = data.jobs || [];
      
      // Compter les jobs qui necessitent l'attention (COMPLETED ou canResume)
      const attentionCount = validJobs.filter(j => j.status === 'COMPLETED' || j.canResume).length;
      
      if (attentionCount > 0) {
        badge.textContent = attentionCount;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    } catch (e) {
      console.error('Erreur badge historique:', e);
    }
  }

  // Mettre à jour le badge toutes les 5 secondes et au chargement
  setInterval(updateHistoryBadge, 5000);
  document.addEventListener('DOMContentLoaded', updateHistoryBadge);
