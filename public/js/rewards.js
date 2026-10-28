/**
 * NovelTrad Rewards Engine - Chibi Mascot Notification & Badge System
 */
(function() {
  'use strict';

  const MODAL_CSS = `
    .nt-reward-backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      background: rgba(8, 10, 15, 0.85);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      animation: ntFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes ntFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .nt-reward-card {
      background: linear-gradient(145deg, #131722, #0d1017);
      border: 1px solid rgba(245, 158, 11, 0.4);
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.8), 0 0 32px rgba(245, 158, 11, 0.25);
      border-radius: 20px;
      max-width: 580px;
      width: 100%;
      position: relative;
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 20px;
      padding: 24px;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      animation: ntPopIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes ntPopIn {
      from { opacity: 0; transform: scale(0.9) translateY(12px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    .nt-chibi-col {
      flex: 0 0 160px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .nt-chibi-img {
      width: 150px;
      height: 150px;
      object-fit: cover;
      border-radius: 16px;
      border: 2px solid rgba(245, 158, 11, 0.5);
      box-shadow: 0 8px 24px rgba(245, 158, 11, 0.3);
      animation: ntChibiFloat 3.5s ease-in-out infinite;
    }
    @keyframes ntChibiFloat {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-8px); }
    }
    .nt-bubble-col {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .nt-reward-tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      font-size: 11.5px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 3px 10px;
      border-radius: 20px;
      border: 1px solid rgba(245, 158, 11, 0.3);
      width: fit-content;
    }
    .nt-reward-title {
      font-size: 18px;
      font-weight: 800;
      color: #ffffff;
      margin: 0;
      line-height: 1.3;
    }
    .nt-reward-message {
      font-size: 13.5px;
      color: #d4d4d8;
      line-height: 1.55;
      margin: 0;
    }
    .nt-badge-unlock-box {
      background: rgba(255, 255, 255, 0.05);
      border: 1px dashed rgba(245, 158, 11, 0.5);
      border-radius: 10px;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 4px;
    }
    .nt-badge-icon-wrap {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: linear-gradient(135deg, #f59e0b, #d97706);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #000;
      font-size: 18px;
      box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
    }
    .nt-badge-info h4 {
      margin: 0 0 2px 0;
      font-size: 13.5px;
      font-weight: 800;
      color: #fbbf24;
    }
    .nt-badge-info p {
      margin: 0;
      font-size: 11.5px;
      color: #a1a1aa;
    }
    .nt-reward-actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 6px;
    }
    .nt-btn-claim {
      background: linear-gradient(135deg, #f59e0b, #d97706);
      color: #000000;
      border: none;
      border-radius: 10px;
      padding: 10px 20px;
      font-size: 13.5px;
      font-weight: 800;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s ease;
      box-shadow: 0 4px 16px rgba(245, 158, 11, 0.4);
    }
    .nt-btn-claim:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(245, 158, 11, 0.6);
      filter: brightness(1.1);
    }
    @media (max-width: 600px) {
      .nt-reward-card {
        flex-direction: column;
        text-align: center;
        padding: 20px;
      }
      .nt-chibi-col {
        flex: auto;
      }
      .nt-bubble-col {
        align-items: center;
      }
      .nt-badge-unlock-box {
        width: 100%;
        box-sizing: border-box;
      }
      .nt-reward-actions {
        width: 100%;
        justify-content: center;
      }
      .nt-btn-claim {
        width: 100%;
        justify-content: center;
      }
    }
  `;

  function injectStyles() {
    if (document.getElementById('ntRewardStyles')) return;
    const style = document.createElement('style');
    style.id = 'ntRewardStyles';
    style.textContent = MODAL_CSS;
    document.head.appendChild(style);
  }

  function showRewardModal(reward, user) {
    if (!reward || document.getElementById('ntRewardBackdrop')) return;
    injectStyles();

    const title = reward.title || 'Félicitations !';
    const message = reward.message || 'Vos signalements ont été validés par l\'équipe. Merci pour votre aide !';
    const badgeName = reward.badgeName || 'Œil de Lynx';
    const userName = (user && (user.display_name || user.email?.split('@')[0])) || 'Lecteur';

    const backdrop = document.createElement('div');
    backdrop.id = 'ntRewardBackdrop';
    backdrop.className = 'nt-reward-backdrop';

    backdrop.innerHTML = `
      <div class="nt-reward-card">
        <div class="nt-chibi-col">
          <img src="/img/chibi_mascot.jpg" alt="NovelTrad Mascotte" class="nt-chibi-img">
        </div>
        <div class="nt-bubble-col">
          <div class="nt-reward-tag">
            <i class="fa-solid fa-sparkles"></i> Récompense de la Communauté
          </div>
          <h3 class="nt-reward-title">Hey ${userName} ! 🎉</h3>
          <p class="nt-reward-message">${message}</p>
          <div class="nt-badge-unlock-box">
            <div class="nt-badge-icon-wrap">
              <i class="fa-solid fa-eye"></i>
            </div>
            <div class="nt-badge-info">
              <h4>Badge débloqué : ${badgeName}</h4>
              <p>Attribué aux relecteurs d'élite pour leur précision</p>
            </div>
          </div>
          <div class="nt-reward-actions">
            <button type="button" id="ntBtnClaimReward" class="nt-btn-claim">
              <i class="fa-solid fa-award"></i> Équiper mon badge
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const claimBtn = document.getElementById('ntBtnClaimReward');
    if (claimBtn) {
      claimBtn.addEventListener('click', async () => {
        claimBtn.disabled = true;
        claimBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Activation...';

        try {
          if (window.authManager && window.authManager.client && user && user.id) {
            await window.authManager.client
              .from('profiles')
              .update({ pending_reward: null })
              .eq('id', user.id);
          }
          if (window.authManager && window.authManager.userProfile) {
            window.authManager.userProfile.pending_reward = null;
            window.authManager.userProfile.badge = reward.badge || 'oeil_de_lynx';
          }
        } catch(e) {
          console.warn('[Rewards] Erreur acquittement:', e);
        }

        backdrop.style.opacity = '0';
        backdrop.style.transition = 'opacity 0.25s ease';
        setTimeout(() => backdrop.remove(), 250);
      });
    }
  }

  function checkPendingReward() {
    if (window.authManager && window.authManager.userProfile) {
      const prof = window.authManager.userProfile;
      if (prof.pending_reward) {
        showRewardModal(prof.pending_reward, prof);
      }
    }
  }

  window.addEventListener('user-role-changed', (e) => {
    if (e.detail && e.detail.profile && e.detail.profile.pending_reward) {
      showRewardModal(e.detail.profile.pending_reward, e.detail.profile);
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(checkPendingReward, 1200);
  });

  window.rewardManager = { showRewardModal, checkPendingReward };
})();
