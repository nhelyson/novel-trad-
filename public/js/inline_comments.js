/**
 * inline_comments.js - Espace Commentaires & Débats de Tome / Webtoon (NovelTrad 2026)
 * 
 * Architecture & Design Haute Définition (Style Webnovel, MangaDex & NovelUpdates) :
 * - Fils de discussion imbriqués (Threaded Nested Replies) avec accordéon dépliable
 * - Mention automatique @Auteur dans les réponses
 * - Onglets de tri interactifs : Populaires (Top votes) vs Récents (Chronologique)
 * - Spotlight Top 3 (Hall of Fame des meilleurs avis de la communauté)
 * - Bouclier Spoiler interactif avec défloutage fluide au clic (Reveal/Hide)
 * - Identité utilisateur persistante (Mode Connecté & Mode Invité avec pseudo modifiable)
 * - Bouton Like avec micro-animations et compteurs en direct
 * - Design sombre obsidian, glassmorphism et typographie soignée
 * 
 * NOTE STRICTE : Les anciens commentaires inline par paragraphe restent désactivés (no-op).
 */
(function() {
  'use strict';

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatRelativeTime(dateStr) {
    try {
      const now = Date.now();
      const diffMs = now - new Date(dateStr).getTime();
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHours = Math.floor(diffMin / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffSec < 45) return "À l'instant";
      if (diffMin < 60) return `Il y a ${diffMin} min`;
      if (diffHours < 24) return `Il y a ${diffHours} h`;
      if (diffDays === 1) return 'Hier';
      if (diffDays < 7) return `Il y a ${diffDays} j`;
      return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    } catch(e) {
      return '';
    }
  }

  // =========================================================================
  //  1. SÉCURITÉ : DÉSACTIVATION STRICTE DES COMMENTAIRES IN-LINE (PARAGRAPHE)
  // =========================================================================
  window.initInlineParagraphComments = function() {};
  window.openParagraphComments = function() {};
  window.closeParagraphComments = function() {
    const drawer = document.getElementById('paraCommentsDrawer');
    const backdrop = document.getElementById('paraCommentsBackdrop');
    if (drawer) drawer.classList.add('hidden');
    if (backdrop) backdrop.classList.add('hidden');
  };

  // =========================================================================
  //  2. MOTEUR DES COMMENTAIRES DU LECTEUR (WEBTOON & TIROIR D'AVIS DU TOME)
  // =========================================================================
  window.renderVolumeCommentsSection = function(mountContainer, bookKey, options) {
    if (!mountContainer || !bookKey) return;
    options = options || {};

    const cleanBookKey = String(bookKey);
    let commentsData = [];
    let activeSort = 'top'; // 'top' ou 'recent'
    let isSubmitting = false;

    // Rendu du squelette complet de l'espace commentaire
    mountContainer.innerHTML = `
      <section class="vol-comments-section" id="volCommentsSection_${cleanBookKey}" aria-label="Espace Commentaires du Volume">
        
        <!-- EN-TÊTE PRO STYLE WEBNOVEL / MANGADEX -->
        <div class="vol-comments-header">
          <div class="vol-comments-title-wrap">
            <div class="vol-comments-icon-badge">
              <i class="fa-solid fa-comments"></i>
            </div>
            <div class="vol-comments-title-texts">
              <div class="vol-comments-headline-row">
                <h3 class="vol-comments-title">Commentaires & Débats</h3>
                <span class="vol-comments-count-pill" id="volCommentsCountBadge">
                  <i class="fa-solid fa-spinner fa-spin"></i>
                </span>
              </div>
              <p class="vol-comments-subtitle">Partagez vos théories, avis et réactions avec la communauté</p>
            </div>
          </div>

          <!-- ONGLETS DE TRI DES AVIS -->
          <div class="vol-comments-sort-tabs" role="tablist" aria-label="Trier les avis">
            <button type="button" class="vol-sort-tab active" data-sort="top" title="Trier par votes">
              <i class="fa-solid fa-fire"></i> <span>Populaires</span>
            </button>
            <button type="button" class="vol-sort-tab" data-sort="recent" title="Trier par date">
              <i class="fa-solid fa-clock"></i> <span>Récents</span>
            </button>
          </div>
        </div>

        <!-- FORMULAIRE DE PUBLICATION (COMPOSER BOX) -->
        <div class="vol-comment-input-box" id="volCommentInputBox">
          <div class="vol-input-user-row">
            <div class="vol-user-profile-meta">
              <div class="vol-user-avatar" id="volInputAvatar">
                <i class="fa-solid fa-user"></i>
              </div>
              <div class="vol-user-identity" id="volUserIdentity">
                <span class="vol-user-name" id="volInputUserName">Lecteur</span>
                <div class="vol-guest-wrap" id="volGuestWrap">
                  <i class="fa-solid fa-pen-nib vol-guest-icon"></i>
                  <input type="text" id="volGuestNameInput" class="vol-guest-name-input" placeholder="Votre pseudo (ex: SoloFan)" maxlength="24" autocomplete="nickname">
                </div>
              </div>
            </div>
            <div class="vol-input-meta-actions">
              <span class="vol-char-counter" id="volCharCounter">0 / 1000</span>
              <button type="button" id="volLoginPromptBtn" class="vol-login-link-btn hidden" title="Se connecter">
                <i class="fa-solid fa-right-to-bracket"></i> <span>Connexion</span>
              </button>
            </div>
          </div>

          <div class="vol-textarea-wrap">
            <textarea id="volCommentText" class="vol-comment-textarea" placeholder="Qu'avez-vous pensé de ce tome ? Vos scènes préférées, théories ou mot pour les traducteurs..." rows="3" maxlength="1000"></textarea>
          </div>

          <div class="vol-input-footer">
            <label class="vol-spoiler-toggle" title="Masquer le texte sous un avertissement de spoiler">
              <input type="checkbox" id="volSpoilerCheck">
              <span class="vol-spoiler-pill">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <span>Contient un spoiler</span>
              </span>
            </label>
            <button type="button" id="volSubmitCommentBtn" class="vol-submit-btn">
              <i class="fa-solid fa-paper-plane"></i>
              <span>Publier mon avis</span>
            </button>
          </div>
        </div>

        <!-- SPOTLIGHT TOP 3 (Hall of Fame) -->
        <div class="vol-top-spotlight hidden" id="volTopSpotlight">
          <div class="vol-top-spotlight-title">
            <i class="fa-solid fa-crown" style="color:#f59e0b;"></i>
            <span>Top Commentaires du Tome</span>
          </div>
          <div class="vol-top-spotlight-list" id="volTopSpotlightList"></div>
        </div>

        <!-- FLUX PRINCIPAL DES COMMENTAIRES & DISCUSSIONS -->
        <div class="vol-comments-feed" id="volCommentsFeed">
          <div class="vol-feed-loading">
            <i class="fa-solid fa-circle-notch fa-spin"></i>
            <span>Chargement des avis de la communauté...</span>
          </div>
        </div>

      </section>
    `;

    // Éléments du DOM
    const countBadge = mountContainer.querySelector('#volCommentsCountBadge');
    const sortTabs = mountContainer.querySelectorAll('.vol-sort-tab');
    const feed = mountContainer.querySelector('#volCommentsFeed');
    const topSpotlight = mountContainer.querySelector('#volTopSpotlight');
    const topSpotlightList = mountContainer.querySelector('#volTopSpotlightList');
    const textarea = mountContainer.querySelector('#volCommentText');
    const charCounter = mountContainer.querySelector('#volCharCounter');
    const submitBtn = mountContainer.querySelector('#volSubmitCommentBtn');
    const spoilerCheck = mountContainer.querySelector('#volSpoilerCheck');
    const avatarEl = mountContainer.querySelector('#volInputAvatar');
    const userNameEl = mountContainer.querySelector('#volInputUserName');
    const guestWrap = mountContainer.querySelector('#volGuestWrap');
    const guestInput = mountContainer.querySelector('#volGuestNameInput');
    const loginPromptBtn = mountContainer.querySelector('#volLoginPromptBtn');

    // Mise à jour de l'identité de l'utilisateur
    function updateFormIdentity() {
      const auth = window.authManager;
      if (auth && auth.currentUser) {
        const profile = auth.userProfile || {};
        const metaName = auth.currentUser.user_metadata ? (auth.currentUser.user_metadata.display_name || auth.currentUser.user_metadata.full_name) : null;
        const emailName = auth.currentUser.email ? auth.currentUser.email.split('@')[0] : 'Lecteur';
        const pseudo = profile.display_name || metaName || emailName || 'Lecteur';
        const metaAvatar = auth.currentUser.user_metadata ? auth.currentUser.user_metadata.avatar_url : '';
        const avatar = profile.avatar_url || metaAvatar || '';

        userNameEl.textContent = pseudo;
        userNameEl.classList.remove('hidden');
        if (guestWrap) guestWrap.classList.add('hidden');
        if (loginPromptBtn) loginPromptBtn.classList.add('hidden');

        if (avatar) {
          avatarEl.innerHTML = `<img src="${avatar}" alt="${escapeHtml(pseudo)}">`;
        } else {
          avatarEl.innerHTML = '<i class="fa-solid fa-user-check"></i>';
        }
      } else {
        // Mode Invité (Guest First)
        userNameEl.classList.add('hidden');
        if (guestWrap) guestWrap.classList.remove('hidden');
        if (loginPromptBtn) loginPromptBtn.classList.remove('hidden');
        avatarEl.innerHTML = '<i class="fa-solid fa-user-ninja"></i>';

        const savedGuest = localStorage.getItem('noveltrad_visitor_name');
        if (savedGuest && guestInput) guestInput.value = savedGuest;
      }
    }
    updateFormIdentity();

    // Raccourci vers la modal de connexion
    if (loginPromptBtn) {
      loginPromptBtn.addEventListener('click', () => {
        if (typeof window.openAuthModal === 'function') {
          window.openAuthModal('login');
        } else {
          const authBtn = document.getElementById('loginBtn') || document.getElementById('mobileAuthBtn');
          if (authBtn) authBtn.click();
        }
      });
    }

    // Compteur de caractères en direct
    if (textarea && charCounter) {
      textarea.addEventListener('input', () => {
        const len = textarea.value.length;
        charCounter.textContent = `${len} / 1000`;
        charCounter.classList.toggle('near-limit', len > 800);
        charCounter.classList.toggle('at-limit', len >= 980);
      });
    }

    // Gestion du tri
    sortTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const s = tab.getAttribute('data-sort');
        if (s === activeSort) return;
        activeSort = s;
        sortTabs.forEach(t => t.classList.toggle('active', t === tab));
        renderCommentsList();
      });
    });

    // Chargement des commentaires depuis l'API
    async function loadVolumeComments() {
      try {
        const resp = await fetch(`/api/comments/${encodeURIComponent(cleanBookKey)}/volume_end`);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        commentsData = Array.isArray(data.comments) ? data.comments : [];
        renderCommentsList();
        if (typeof window.refreshVolumeCommentsBadge === "function") {
          window.refreshVolumeCommentsBadge(cleanBookKey);
        }
      } catch (err) {
        console.warn('[VolumeComments] Erreur chargement:', err);
        feed.innerHTML = `
          <div class="vol-feed-empty">
            <i class="fa-solid fa-circle-exclamation fa-2x" style="color:#ef4444;"></i>
            <p>Impossible de charger les avis pour le moment.</p>
          </div>
        `;
        if (countBadge) countBadge.textContent = '0 avis';
      }
    }

    // Rendu visuel de la liste avec arborescence des réponses
    function renderCommentsList() {
      const count = commentsData.length;
      if (countBadge) {
        countBadge.textContent = `${count} avis`;
      }

      // 1. TOP SPOTLIGHT (Commentaires principaux les plus aimés)
      const topLevelAll = commentsData.filter(c => !c.parent_id);
      const likedComments = [...topLevelAll].filter(c => (c.likes || 0) > 0);
      likedComments.sort((a, b) => (b.likes || 0) - (a.likes || 0));
      const top3 = likedComments.slice(0, 3);

      if (top3.length > 0 && activeSort === 'top') {
        topSpotlight.classList.remove('hidden');
        topSpotlightList.innerHTML = '';
        top3.forEach((c, idx) => {
          topSpotlightList.appendChild(buildCommentCard(c, true, idx + 1, false, []));
        });
      } else {
        topSpotlight.classList.add('hidden');
        topSpotlightList.innerHTML = '';
      }

      // 2. ÉTAT VIDE
      if (count === 0) {
        feed.innerHTML = `
          <div class="vol-feed-empty">
            <div class="empty-icon-wrap"><i class="fa-regular fa-comment-dots"></i></div>
            <h4>Soyez le premier à donner votre avis !</h4>
            <p>Vous venez d'achever ce tome. Partagez votre ressenti, vos théories ou remerciez l'équipe de traduction.</p>
          </div>
        `;
        return;
      }

      // Séparation des commentaires principaux et de leurs réponses
      const topLevelComments = commentsData.filter(c => !c.parent_id);
      const repliesMap = new Map();
      commentsData.filter(c => c.parent_id).forEach(r => {
        if (!repliesMap.has(r.parent_id)) repliesMap.set(r.parent_id, []);
        repliesMap.get(r.parent_id).push(r);
      });

      // Tri des réponses chronologique (plus ancienne en premier pour suivre la discussion)
      repliesMap.forEach(list => {
        list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      });

      // Tri des commentaires principaux
      if (activeSort === 'top') {
        topLevelComments.sort((a, b) => (b.likes || 0) - (a.likes || 0) || new Date(b.created_at) - new Date(a.created_at));
      } else {
        topLevelComments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }

      feed.innerHTML = '';
      topLevelComments.forEach(c => {
        const replies = repliesMap.get(c.id) || [];
        feed.appendChild(buildCommentCard(c, false, null, false, replies));
      });

      bindFeedEvents();
    }

    // Construction du DOM d'une carte de commentaire
    function buildCommentCard(c, isTopCard, rank, isReply = false, replies = []) {
      const card = document.createElement('div');
      card.className = isReply 
        ? 'vol-comment-card vol-reply-card' 
        : ('vol-comment-card' + (isTopCard ? ' is-top-rank' : ''));
      card.id = 'vcmt-' + c.id;

      const avatarMarkup = c.user_avatar
        ? `<img src="${c.user_avatar}" alt="${escapeHtml(c.user_name)}" class="vol-card-avatar-img">`
        : `<div class="vol-card-avatar-placeholder"><i class="fa-solid fa-user"></i></div>`;

      const roleBadge = (c.user_role && c.user_role.toUpperCase() === 'ADMIN')
        ? '<span class="vol-badge-role admin"><i class="fa-solid fa-shield-halved"></i> Traducteur</span>'
        : (c.user_role && c.user_role.toUpperCase() === 'VIP')
        ? '<span class="vol-badge-role vip"><i class="fa-solid fa-gem"></i> VIP</span>'
        : '<span class="vol-badge-role member">Lecteur</span>';

      const topBadgeMarkup = isTopCard
        ? `<span class="vol-badge-top-rank rank-${rank || 1}"><i class="fa-solid fa-crown"></i> TOP ${rank || ''}</span>`
        : '';

      const relTime = formatRelativeTime(c.created_at);

      // Traitement des Spoilers
      let contentMarkup = '';
      if (c.is_spoiler) {
        contentMarkup = `
          <div class="vol-spoiler-shield" id="spShield-${c.id}">
            <div class="vol-spoiler-banner">
              <div class="vol-spoiler-banner-left">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <span>Ce commentaire contient des spoilers</span>
              </div>
              <button type="button" class="vol-btn-reveal-spoiler" data-cid="${c.id}">
                <i class="fa-regular fa-eye"></i> <span>Révéler</span>
              </button>
            </div>
            <div class="vol-comment-text vol-spoiler-content hidden" id="spContent-${c.id}">
              ${escapeHtml(c.content)}
            </div>
          </div>
        `;
      } else {
        contentMarkup = `<div class="vol-comment-text">${escapeHtml(c.content)}</div>`;
      }

      // Droits de suppression
      const auth = window.authManager;
      const currentUserId = auth && auth.currentUser ? auth.currentUser.id : null;
      const isAdmin = auth && auth.isAdmin && auth.isAdmin();
      const canDelete = isAdmin || (currentUserId && currentUserId === c.user_id);

      // Badge de mention pour une réponse
      const replyToMarkup = (isReply && c.excerpt && c.excerpt.startsWith('Réponse à '))
        ? `<span class="vol-reply-to-pill"><i class="fa-solid fa-reply fa-xs"></i> ${escapeHtml(c.excerpt)}</span>`
        : '';

      // Section des réponses imbriquées (Threaded Tree)
      let repliesSectionMarkup = '';
      if (!isReply) {
        let repliesHtml = '';
        if (replies.length > 0) {
          replies.forEach(r => {
            const replyCard = buildCommentCard(r, false, null, true, []);
            repliesHtml += replyCard.outerHTML;
          });
        }

        repliesSectionMarkup = `
          <!-- Tiroir inline de réponse directe -->
          <div class="vol-reply-drawer hidden" id="replyDrawer-${c.id}">
            <div class="vol-reply-input-wrap">
              <div class="vol-reply-to-hint">
                <i class="fa-solid fa-reply" style="color:#f43f5e;"></i>
                <span>Répondre à <strong style="color:#fb7185;">@${escapeHtml(c.user_name)}</strong></span>
              </div>
              <textarea class="vol-reply-textarea" id="replyText-${c.id}" placeholder="Votre réponse constructive..." rows="2" maxlength="500"></textarea>
              <div class="vol-reply-actions-row">
                <button type="button" class="vol-btn-cancel-reply" data-cid="${c.id}">Annuler</button>
                <button type="button" class="vol-btn-send-reply" data-cid="${c.id}" data-author="${escapeHtml(c.user_name)}">
                  <i class="fa-solid fa-paper-plane"></i> <span>Envoyer la réponse</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Fil de discussion des réponses (Thread) avec accordéon -->
          ${replies.length > 0 ? `
            <div class="vol-thread-toggle-row">
              <button type="button" class="vol-btn-toggle-thread" data-cid="${c.id}">
                <i class="fa-solid fa-chevron-down vol-thread-chevron"></i>
                <span class="vol-thread-label">${replies.length} réponse${replies.length > 1 ? 's' : ''}</span>
              </button>
            </div>
          ` : ''}

          <div class="vol-replies-thread ${replies.length > 0 ? '' : 'hidden'}" id="repliesThread-${c.id}">
            <div class="vol-replies-list" id="repliesList-${c.id}">
              ${repliesHtml}
            </div>
          </div>
        `;
      }

      card.innerHTML = `
        <div class="vol-card-header">
          <div class="vol-card-author-group">
            <div class="vol-card-avatar">${avatarMarkup}</div>
            <div class="vol-card-author-meta">
              <div class="vol-card-name-row">
                <strong class="vol-card-username">${escapeHtml(c.user_name)}</strong>
                ${replyToMarkup}
                ${roleBadge}
                ${topBadgeMarkup}
              </div>
              <span class="vol-card-time"><i class="fa-regular fa-clock fa-2xs"></i> ${relTime}</span>
            </div>
          </div>
          ${canDelete ? `<button type="button" class="vol-btn-delete" data-cid="${c.id}" title="Supprimer ce commentaire"><i class="fa-regular fa-trash-can"></i></button>` : ''}
        </div>

        <div class="vol-card-body">
          ${contentMarkup}
        </div>

        <div class="vol-card-footer">
          <button type="button" class="vol-btn-like ${(c.likes > 0) ? 'has-likes' : ''}" data-cid="${c.id}" title="J'aime">
            <i class="${(c.likes > 0) ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
            <span class="vol-like-count">${c.likes || 0}</span>
          </button>
          ${!isReply ? `
            <button type="button" class="vol-btn-reply" data-cid="${c.id}" data-author="${escapeHtml(c.user_name)}" title="Répondre à ce commentaire">
              <i class="fa-solid fa-reply"></i>
              <span>Répondre</span>
              ${replies.length > 0 ? `<span class="vol-reply-count-badge">${replies.length}</span>` : ''}
            </button>
          ` : `
            <button type="button" class="vol-btn-reply-nested" data-cid="${c.parent_id || c.id}" data-author="${escapeHtml(c.user_name)}" title="Répondre à ${escapeHtml(c.user_name)}">
              <i class="fa-solid fa-reply fa-xs"></i>
              <span>Répondre</span>
            </button>
          `}
        </div>

        ${repliesSectionMarkup}
      `;

      return card;
    }

    // Liaison des événements sur les cartes
    function bindFeedEvents() {
      // 1. Défloutage / Bascule des spoilers
      mountContainer.querySelectorAll('.vol-btn-reveal-spoiler').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const cId = btn.getAttribute('data-cid');
          const content = mountContainer.querySelector('#spContent-' + cId);
          if (content) {
            const isHidden = content.classList.contains('hidden');
            content.classList.toggle('hidden');
            btn.innerHTML = isHidden 
              ? '<i class="fa-regular fa-eye-slash"></i> <span>Masquer</span>' 
              : '<i class="fa-regular fa-eye"></i> <span>Révéler</span>';
          }
        };
      });

      // 2. Bascule d'affichage du fil de réponses (Accordéon)
      mountContainer.querySelectorAll('.vol-btn-toggle-thread').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const cId = btn.getAttribute('data-cid');
          const thread = mountContainer.querySelector('#repliesThread-' + cId);
          const chevron = btn.querySelector('.vol-thread-chevron');
          if (thread) {
            const isHidden = thread.classList.contains('hidden');
            thread.classList.toggle('hidden', !isHidden);
            if (chevron) {
              chevron.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
            }
          }
        };
      });

      // 3. Bouton Répondre principal : ouvre le tiroir inline
      mountContainer.querySelectorAll('.vol-btn-reply').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const cId = btn.getAttribute('data-cid');
          const drawer = mountContainer.querySelector('#replyDrawer-' + cId);
          if (drawer) {
            const isHidden = drawer.classList.contains('hidden');
            mountContainer.querySelectorAll('.vol-reply-drawer').forEach(d => {
              if (d !== drawer) d.classList.add('hidden');
            });
            if (isHidden) {
              drawer.classList.remove('hidden');
              const txt = drawer.querySelector('.vol-reply-textarea');
              if (txt) {
                txt.focus();
                txt.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }
            } else {
              drawer.classList.add('hidden');
            }
          }
        };
      });

      // 4. Bouton Répondre à l'intérieur d'une réponse (nested)
      mountContainer.querySelectorAll('.vol-btn-reply-nested').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const parentCid = btn.getAttribute('data-cid');
          const author = btn.getAttribute('data-author');
          const drawer = mountContainer.querySelector('#replyDrawer-' + parentCid);
          if (drawer) {
            drawer.classList.remove('hidden');
            const txt = drawer.querySelector('.vol-reply-textarea');
            if (txt) {
              txt.value = `@${author} `;
              txt.focus();
              txt.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
          }
        };
      });

      // 5. Bouton Annuler réponse
      mountContainer.querySelectorAll('.vol-btn-cancel-reply').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const cId = btn.getAttribute('data-cid');
          const drawer = mountContainer.querySelector('#replyDrawer-' + cId);
          if (drawer) {
            drawer.classList.add('hidden');
            const txt = drawer.querySelector('.vol-reply-textarea');
            if (txt) txt.value = '';
          }
        };
      });

      // 6. Bouton Envoyer la réponse
      mountContainer.querySelectorAll('.vol-btn-send-reply').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const cId = btn.getAttribute('data-cid');
          const parentAuthor = btn.getAttribute('data-author') || 'Lecteur';
          const drawer = mountContainer.querySelector('#replyDrawer-' + cId);
          if (!drawer) return;
          const txt = drawer.querySelector('.vol-reply-textarea');
          const replyText = txt ? txt.value.trim() : '';

          if (!replyText || replyText.length < 2) {
            alert('Veuillez saisir au moins 2 caractères pour répondre.');
            return;
          }

          btn.disabled = true;
          btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Envoi...';

          try {
            const auth = window.authManager;
            const token = auth ? await auth.getAccessToken() : null;
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = 'Bearer ' + token;

            let visitorName = '';
            if (guestInput && !guestInput.classList.contains('hidden')) {
              visitorName = guestInput.value.trim();
              if (visitorName) localStorage.setItem('noveltrad_visitor_name', visitorName);
            }

            const payload = {
              content: replyText,
              parent_id: cId,
              parentId: cId,
              visitor_name: visitorName,
              excerpt: 'Réponse à @' + parentAuthor
            };

            const res = await fetch(`/api/comments/${encodeURIComponent(cleanBookKey)}/volume_end`, {
              method: 'POST',
              headers,
              body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
              throw new Error(data.error || 'Impossible d\'envoyer la réponse.');
            }

            // Ajouter la nouvelle réponse à la liste locale et rafraîchir
            commentsData.push(data.comment || data);
            renderCommentsList();

            // Révéler le fil de discussion de cette réponse
            const threadEl = mountContainer.querySelector('#repliesThread-' + cId);
            if (threadEl) threadEl.classList.remove('hidden');

            // Scroll et animation de confirmation
            const newCard = mountContainer.querySelector('#vcmt-' + (data.comment?.id || data.id));
            if (newCard) {
              newCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
              newCard.style.outline = '2px solid #f43f5e';
              setTimeout(() => { newCard.style.outline = ''; }, 2500);
            }

          } catch (err) {
            alert(err.message || 'Erreur lors de l\'envoi de la réponse.');
          } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> <span>Envoyer la réponse</span>';
          }
        };
      });

      // 7. Bouton J'aime (Likes)
      mountContainer.querySelectorAll('.vol-btn-like').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const cId = btn.getAttribute('data-cid');
          if (!cId) return;

          btn.disabled = true;
          try {
            const auth = window.authManager;
            const token = auth ? await auth.getAccessToken() : null;
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = 'Bearer ' + token;

            const res = await fetch(`/api/comments/${cId}/like`, {
              method: 'POST',
              headers
            });
            const data = await res.json();
            if (data.success) {
              const target = commentsData.find(x => x.id === cId);
              if (target) {
                target.likes = data.likes;
                if (!Array.isArray(target.liked_by)) target.liked_by = [];
                mountContainer.querySelectorAll(`.vol-btn-like[data-cid="${cId}"]`).forEach(b => {
                  const cnt = b.querySelector('.vol-like-count');
                  if (cnt) cnt.textContent = data.likes;
                  if (data.liked) {
                    b.classList.add('liked');
                    b.querySelector('i').className = 'fa-solid fa-heart';
                  } else {
                    b.classList.remove('liked');
                    b.querySelector('i').className = 'fa-regular fa-heart';
                  }
                });
              }
            }
          } catch(err) {
            console.warn('[Like error]', err);
          } finally {
            btn.disabled = false;
          }
        };
      });

      // 8. Bouton Suppression
      mountContainer.querySelectorAll('.vol-btn-delete').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const cId = btn.getAttribute('data-cid');
          if (!cId) return;
          if (!confirm('Voulez-vous vraiment supprimer ce commentaire ?')) return;

          try {
            const auth = window.authManager;
            const token = auth ? await auth.getAccessToken() : null;
            const headers = {};
            if (token) headers['Authorization'] = 'Bearer ' + token;

            const res = await fetch(`/api/comments/${cId}`, {
              method: 'DELETE',
              headers
            });
            const data = await res.json();
            if (data.success) {
              commentsData = commentsData.filter(x => x.id !== cId);
              renderCommentsList();
              if (typeof window.refreshVolumeCommentsBadge === "function") {
                window.refreshVolumeCommentsBadge(cleanBookKey);
              }
            } else {
              alert(data.error || 'Erreur lors de la suppression.');
            }
          } catch(err) {
            alert('Erreur: ' + err.message);
          }
        };
      });
    }

    // Soumission du nouveau commentaire principal
    submitBtn.addEventListener('click', async () => {
      if (isSubmitting) return;
      const text = textarea.value.trim();
      if (text.length < 2) {
        alert('Votre commentaire doit comporter au moins 2 caractères.');
        textarea.focus();
        return;
      }

      const visitorName = guestInput ? guestInput.value.trim() : '';
      if (guestInput && !guestInput.classList.contains('hidden') && visitorName) {
        localStorage.setItem('noveltrad_visitor_name', visitorName);
      }

      isSubmitting = true;
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Publication...';

      try {
        const auth = window.authManager;
        const token = auth ? await auth.getAccessToken() : null;
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const payload = {
          content: text,
          is_spoiler: Boolean(spoilerCheck && spoilerCheck.checked),
          visitor_name: visitorName,
          excerpt: options.title || 'Fin du Volume'
        };

        const res = await fetch(`/api/comments/${encodeURIComponent(cleanBookKey)}/volume_end`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Erreur lors de la publication.');
        }

        // Réinitialisation des champs
        textarea.value = '';
        if (charCounter) charCounter.textContent = '0 / 1000';
        if (spoilerCheck) spoilerCheck.checked = false;

        // Insertion et rafraîchissement
        commentsData.unshift(data.comment || data);
        renderCommentsList();
        if (typeof window.refreshVolumeCommentsBadge === "function") {
          window.refreshVolumeCommentsBadge(cleanBookKey);
        }

      } catch(err) {
        alert(err.message || 'Impossible de publier le commentaire.');
      } finally {
        isSubmitting = false;
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> <span>Publier mon avis</span>';
      }
    });

    // Chargement initial
    loadVolumeComments();
  };

})();
