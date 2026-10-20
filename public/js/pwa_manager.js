/**
 * NovelTrad - Gestionnaire PWA & Expérience Hors-ligne
 * - Sécurité anti-doublon : Détection OS native (getInstalledRelatedApps)
 * - Détection standalone, iOS WebApp, WebAPK et drapeaux persistants
 * - Pop-up Bottom Sheet moderne et non-intrusif
 * - Modal d'installation guidée pas-à-pas (Android, iOS, Desktop)
 * - Gestion du statut réseau en temps réel (Offline / Online)
 * - Enregistrement et cycle de vie du Service Worker
 */

(function() {
  'use strict';

  let deferredInstallPrompt = null;

  const state = {
    isInstalled: false,
    isOnline: navigator.onLine,
    canNativeInstall: false,
    checkedOS: false
  };

  const DISMISS_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // 3 jours de tranquillité si fermé

  /**
   * Initialisation du gestionnaire PWA
   */
  async function init() {
    registerServiceWorker();
    
    // 1. Sécurité anti-doublon au démarrage : vérification complète de l'OS et du navigateur
    await checkInstallationStatus();

    setupNetworkListeners();
    setupInstallListeners();
    createInstallGuideModal();
    
    // 2. Si l'application n'est PAS installée sur l'OS, proposer l'installation proprement
    if (!state.isInstalled) {
      setupInstallPopup();
    }
  }

  /**
   * SÉCURITÉ ANTI-DOUBLON MULTI-NIVEAUX (OS & NAVIGATEUR)
   * Vérifie si l'application NovelTrad est déjà installée sur l'appareil avant toute proposition.
   */
  async function checkInstallationStatus() {
    // A. Détection du mode d'exécution actuel (Standalone, Plein Écran, WebAPK Android, Safari iOS)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                         window.matchMedia('(display-mode: fullscreen)').matches ||
                         window.matchMedia('(display-mode: window-controls-overlay)').matches ||
                         window.navigator.standalone === true ||
                         document.referrer.includes('android-app://') ||
                         window.location.search.includes('source=pwa');

    if (isStandalone) {
      markAsInstalled('standalone_active');
      return true;
    }

    // B. Détection native OS via l'API standardisée getInstalledRelatedApps() (Chrome Android / Windows / macOS / Linux)
    if ('getInstalledRelatedApps' in navigator) {
      try {
        const relatedApps = await navigator.getInstalledRelatedApps();
        if (Array.isArray(relatedApps) && relatedApps.length > 0) {
          markAsInstalled('os_registry');
          return true;
        } else {
          // Si l'API répond 0 application, cela signifie que l'utilisateur a désinstallé l'app
          localStorage.removeItem('noveltrad_pwa_installed');
        }
      } catch (err) {
      }
    }

    // C. Vérification de la mémoire locale persistante (pour Safari iOS et navigateurs sans getInstalledRelatedApps)
    const hasInstalledFlag = localStorage.getItem('noveltrad_pwa_installed') === 'true';
    if (hasInstalledFlag) {
      markAsInstalled('persistent_flag');
      return true;
    }

    state.isInstalled = false;
    state.checkedOS = true;
    return false;
  }

  /**
   * Verrouille l'état "Déjà Installé" et désactive toute proposition
   */
  function markAsInstalled(reason) {
    state.isInstalled = true;
    state.checkedOS = true;
    localStorage.setItem('noveltrad_pwa_installed', 'true');
    document.body.classList.add('pwa-standalone');
    hideInstallButtons();
    closeInstallPopup(true);
  }

  /**
   * Enregistrement du Service Worker
   */
  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then((reg) => {
            reg.onupdatefound = () => {
              const installingWorker = reg.installing;
              if (installingWorker) {
                installingWorker.onstatechange = () => {
                  if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  }
                };
              }
            };
          })
          .catch((err) => {
            console.warn('[PWA] Échec enregistrement SW:', err);
          });
      });
    }
  }

  /**
   * Écouteurs d'installation et événements natifs
   */
  function setupInstallListeners() {
    // Si l'app est déjà installée sur l'OS, ignorer
    if (state.isInstalled) return;

    window.addEventListener('beforeinstallprompt', (e) => {
      // Si déjà installée, empêcher toute invite
      if (state.isInstalled) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      deferredInstallPrompt = e;
      state.canNativeInstall = true;
    });

    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      markAsInstalled('appinstalled_event');
      showOfflineToast('🎉 NovelTrad a été installée avec succès sur votre appareil !', 'success', 5000);
    });

    // Lier le bouton du tiroir mobile
    const mobBtn = document.getElementById('mobilePwaInstallBtn');
    if (mobBtn) {
      mobBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        triggerInstallPrompt();
      });
    }
  }

  /**
   * Déclencheur universel d'installation
   */
  async function triggerInstallPrompt() {
    // Sécurité : revérifier si l'app vient d'être installée
    if (state.isInstalled) {
      showOfflineToast('L\'application NovelTrad est déjà installée sur votre appareil.', 'info');
      return;
    }

    closeInstallPopup(false);

    // 1. Si l'invite native est disponible, la lancer
    if (deferredInstallPrompt) {
      try {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') {
          markAsInstalled('user_accepted_prompt');
        }
        deferredInstallPrompt = null;
        return;
      } catch (err) {
        console.warn('[PWA] Erreur prompt natif:', err);
      }
    }

    // 2. Sinon, afficher le guide étape par étape selon l'OS
    openInstallGuideModal();
  }

  function hideInstallButtons() {
    const mobBtn = document.getElementById('mobilePwaInstallBtn');
    if (mobBtn) mobBtn.classList.add('hidden');
  }

  /**
   * Pop-up Bottom Sheet d'Installation (sécurisé contre les doublons)
   */
  async function setupInstallPopup() {
    // Double vérification de sécurité avant affichage
    if (state.isInstalled) return;

    // Vérifier à nouveau avec l'OS
    const isInstalledNow = await checkInstallationStatus();
    if (isInstalledNow) return;

    // Vérifier le cooldown de 3 jours si l'utilisateur l'avait déjà fermé
    const lastDismissed = localStorage.getItem('noveltrad_pwa_popup_dismissed');
    if (lastDismissed) {
      const diff = Date.now() - parseInt(lastDismissed, 10);
      if (diff < DISMISS_COOLDOWN_MS) {
        return;
      }
    }

    // Délai agréable de 2.5 secondes
    setTimeout(async () => {
      // Re-vérifier au moment précis où le timer expire
      if (state.isInstalled) return;
      if (document.getElementById('pwaInstallPopup')) return;

      const popup = document.createElement('div');
      popup.id = 'pwaInstallPopup';
      popup.className = 'pwa-popup-overlay';
      popup.innerHTML = `
        <div class="pwa-popup-backdrop" id="pwaPopupBackdrop"></div>
        <div class="pwa-popup-sheet" role="dialog" aria-modal="true" aria-labelledby="pwaPopupTitle">
          <div class="pwa-popup-handle-bar"></div>
          
          <button type="button" class="pwa-popup-close-btn" id="pwaPopupCloseBtn" aria-label="Fermer">
            <i class="fa-solid fa-xmark"></i>
          </button>

          <div class="pwa-popup-main">
            <div class="pwa-popup-header">
              <div class="pwa-popup-icon-box">
                <img src="/icons/icon-192x192.png" alt="NovelTrad Icon">
              </div>
              <div class="pwa-popup-title-box">
                <div class="pwa-popup-badge"><i class="fa-solid fa-bolt"></i> Application Légère & Rapide</div>
                <h3 id="pwaPopupTitle">Installer NovelTrad</h3>
                <p class="pwa-popup-subtitle">Profitez de la meilleure expérience de lecture de Light Novels</p>
              </div>
            </div>

            <div class="pwa-popup-features">
              <div class="pwa-popup-feature">
                <div class="pwa-feat-icon"><i class="fa-solid fa-expand"></i></div>
                <div class="pwa-feat-text">
                  <strong>Plein écran immersif</strong>
                  <span>Sans barre de navigateur ni distractions</span>
                </div>
              </div>
              <div class="pwa-popup-feature">
                <div class="pwa-feat-icon"><i class="fa-solid fa-book-bookmark"></i></div>
                <div class="pwa-feat-text">
                  <strong>Lecture hors-ligne</strong>
                  <span>Accédez à vos tomes sauvegardés sans connexion</span>
                </div>
              </div>
              <div class="pwa-popup-feature">
                <div class="pwa-feat-icon"><i class="fa-solid fa-mobile-screen-button"></i></div>
                <div class="pwa-feat-text">
                  <strong>Accès en 1 clic</strong>
                  <span>Lancez vos lectures depuis l'écran d'accueil</span>
                </div>
              </div>
            </div>

            <div class="pwa-popup-actions">
              <button type="button" class="btn-pwa-popup-install" id="pwaPopupInstallBtn">
                <i class="fa-solid fa-download"></i>
                <span>Installer maintenant</span>
              </button>
              <button type="button" class="btn-pwa-popup-later" id="pwaPopupLaterBtn">
                <span>Plus tard</span>
              </button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(popup);
      
      requestAnimationFrame(() => {
        popup.classList.add('open');
      });

      document.getElementById('pwaPopupInstallBtn')?.addEventListener('click', () => {
        triggerInstallPrompt();
      });

      document.getElementById('pwaPopupLaterBtn')?.addEventListener('click', () => {
        dismissInstallPopup();
      });

      document.getElementById('pwaPopupCloseBtn')?.addEventListener('click', () => {
        dismissInstallPopup();
      });

      document.getElementById('pwaPopupBackdrop')?.addEventListener('click', () => {
        dismissInstallPopup();
      });

    }, 2500);
  }

  function dismissInstallPopup() {
    localStorage.setItem('noveltrad_pwa_popup_dismissed', Date.now().toString());
    closeInstallPopup(false);
  }

  function closeInstallPopup(immediate) {
    const popup = document.getElementById('pwaInstallPopup');
    if (!popup) return;

    if (immediate) {
      popup.remove();
      return;
    }

    popup.classList.remove('open');
    setTimeout(() => {
      popup.remove();
    }, 350);
  }

  /**
   * Modal d'Installation Guidée
   */
  function createInstallGuideModal() {
    if (document.getElementById('pwaInstallGuideModal')) return;

    const modal = document.createElement('div');
    modal.id = 'pwaInstallGuideModal';
    modal.className = 'pwa-guide-modal-overlay hidden';

    const ua = navigator.userAgent.toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(ua);
    const isAndroid = /android/.test(ua);

    let stepsHtml = '';
    let osBadge = '';

    if (isAndroid) {
      osBadge = '<span class="pwa-os-tag android"><i class="fa-brands fa-android"></i> Android (Chrome / Brave / Edge)</span>';
      stepsHtml = `
        <div class="pwa-guide-step">
          <div class="pwa-step-num">1</div>
          <div class="pwa-step-content">
            <strong>Ouvrez le menu du navigateur</strong>
            <p>Appuyez sur les <strong>trois points verticaux (⋮)</strong> en haut à droite de l'écran.</p>
          </div>
        </div>
        <div class="pwa-guide-step">
          <div class="pwa-step-num">2</div>
          <div class="pwa-step-content">
            <strong>Sélectionnez « Installer l'application »</strong>
            <p>Ou <em>« Ajouter à l'écran d'accueil »</em> selon votre navigateur.</p>
          </div>
        </div>
        <div class="pwa-guide-step">
          <div class="pwa-step-num">3</div>
          <div class="pwa-step-content">
            <strong>Confirmez l'installation</strong>
            <p>NovelTrad s'installe comme une application native avec raccourcis et lecture hors-ligne !</p>
          </div>
        </div>
      `;
    } else if (isIos) {
      osBadge = '<span class="pwa-os-tag ios"><i class="fa-brands fa-apple"></i> iPhone & iPad (Safari)</span>';
      stepsHtml = `
        <div class="pwa-guide-step">
          <div class="pwa-step-num">1</div>
          <div class="pwa-step-content">
            <strong>Appuyez sur Partager</strong>
            <p>Touchez le bouton <strong>Partager <i class="fa-solid fa-arrow-up-from-bracket"></i></strong> au bas de l'écran Safari.</p>
          </div>
        </div>
        <div class="pwa-guide-step">
          <div class="pwa-step-num">2</div>
          <div class="pwa-step-content">
            <strong>Sélectionnez « Sur l'écran d'accueil »</strong>
            <p>Faites défiler les options vers le bas et touchez <strong>« Sur l'écran d'accueil »</strong>.</p>
          </div>
        </div>
        <div class="pwa-guide-step">
          <div class="pwa-step-num">3</div>
          <div class="pwa-step-content">
            <strong>Appuyez sur « Ajouter »</strong>
            <p>L'icône NovelTrad apparaîtra sur votre écran d'accueil en plein écran.</p>
          </div>
        </div>
      `;
    } else {
      osBadge = '<span class="pwa-os-tag desktop"><i class="fa-solid fa-desktop"></i> Ordinateur (Chrome / Edge / Brave)</span>';
      stepsHtml = `
        <div class="pwa-guide-step">
          <div class="pwa-step-num">1</div>
          <div class="pwa-step-content">
            <strong>Repérez l'icône dans la barre d'adresse</strong>
            <p>Cliquez sur l'icône <strong>Installer <i class="fa-solid fa-download"></i></strong> située à droite de l'URL.</p>
          </div>
        </div>
        <div class="pwa-guide-step">
          <div class="pwa-step-num">2</div>
          <div class="pwa-step-content">
            <strong>Ou utilisez le menu du navigateur</strong>
            <p>Cliquez sur le menu <strong>⋮</strong> puis sur <strong>« Installer NovelTrad »</strong>.</p>
          </div>
        </div>
      `;
    }

    modal.innerHTML = `
      <div class="pwa-guide-modal-card">
        <button type="button" class="pwa-guide-close-btn" id="pwaGuideCloseBtn" aria-label="Fermer">
          <i class="fa-solid fa-xmark"></i>
        </button>

        <div class="pwa-guide-header">
          <div class="pwa-guide-icon-badge">
            <img src="/icons/icon-192x192.png" alt="NovelTrad Logo">
          </div>
          <div class="pwa-guide-title-box">
            <h3>Installer NovelTrad</h3>
            ${osBadge}
          </div>
        </div>

        <div class="pwa-guide-body">
          <p class="pwa-guide-intro">Installez NovelTrad sur votre appareil pour profiter d'une lecture plein écran, d'un accès rapide et du mode hors-ligne sans connexion.</p>
          <div class="pwa-guide-steps">
            ${stepsHtml}
          </div>
        </div>

        <div class="pwa-guide-footer">
          <button type="button" class="btn-pwa-guide-ok" id="pwaGuideOkBtn">
            <i class="fa-solid fa-check"></i> J'ai compris
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('pwaGuideCloseBtn')?.addEventListener('click', closeInstallGuideModal);
    document.getElementById('pwaGuideOkBtn')?.addEventListener('click', closeInstallGuideModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeInstallGuideModal();
    });
  }

  function openInstallGuideModal() {
    createInstallGuideModal();
    const modal = document.getElementById('pwaInstallGuideModal');
    if (modal) {
      modal.classList.remove('hidden');
      setTimeout(() => modal.classList.add('open'), 10);
    }
  }

  function closeInstallGuideModal() {
    const modal = document.getElementById('pwaInstallGuideModal');
    if (modal) {
      modal.classList.remove('open');
      setTimeout(() => modal.classList.add('hidden'), 250);
    }
  }

  /**
   * Surveillance réseau
   */
  function setupNetworkListeners() {
    window.addEventListener('online', () => {
      state.isOnline = true;
      document.body.classList.remove('is-offline');
      showOfflineToast('✅ Connexion rétablie', 'success', 3000);
    });

    window.addEventListener('offline', () => {
      state.isOnline = false;
      document.body.classList.add('is-offline');
      showOfflineToast('📶 Mode Hors-Ligne activé • Vos romans enregistrés restent accessibles', 'offline', 6000);
    });

    if (!navigator.onLine) {
      document.body.classList.add('is-offline');
      setTimeout(() => {
        showOfflineToast('📶 Mode Hors-Ligne activé • Vos romans enregistrés restent accessibles', 'offline', 6000);
      }, 1000);
    }
  }

  function showOfflineToast(message, type = 'info', duration = 3500) {
    let toast = document.getElementById('pwaNetworkToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'pwaNetworkToast';
      toast.className = 'pwa-network-toast';
      document.body.appendChild(toast);
    }

    toast.className = 'pwa-network-toast pwa-toast-' + type;
    toast.innerHTML = `
      <div class="pwa-toast-inner">
        <span class="pwa-toast-text">${message}</span>
      </div>
    `;

    toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  }

  // API Publique pour tests et intégration
  window.PwaManager = {
    init: init,
    checkInstallationStatus: checkInstallationStatus,
    promptInstall: triggerInstallPrompt,
    openPopup: () => {
      localStorage.removeItem('noveltrad_pwa_popup_dismissed');
      setupInstallPopup();
    },
    openGuide: openInstallGuideModal,
    isInstalled: () => state.isInstalled,
    isOnline: () => state.isOnline
  };

  document.addEventListener('DOMContentLoaded', init);

})();
