/**
 * inline_comments.js -> Evolved into Webtoon-style End-of-Volume Comments (NovelTrad)
 * 
 * In-line paragraph reader module (distraction-free mode).
 * - End-of-Volume Webtoon comment system (Top comments, like/unlike, spoilers, guest/member auth).
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
      if (diffDays < 7) return `Il y a ${diffDays} jours`;
      return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    } catch(e) {
      return '';
    }
  }

  // =========================================================================
  //  1. SAFE NO-OP FOR LEGACY IN-LINE CALLS (PREVENTS ANY CRASHES)
  // =========================================================================
  window.initInlineParagraphComments = function() {
    // In-line reader overlay disabled in minimalist view.
  };

  window.openParagraphComments = function() {
    // Legacy drawer fallback
  };

  window.closeParagraphComments = function() {
    const drawer = document.getElementById('paraCommentsDrawer');
    const backdrop = document.getElementById('paraCommentsBackdrop');
    if (drawer) drawer.classList.add('hidden');
    if (backdrop) backdrop.classList.add('hidden');
  };

  // =========================================================================
  //  2. WEBTOON END-OF-VOLUME COMMENTS ENGINE
  // =========================================================================
  window.renderVolumeCommentsSection = function(mountContainer, bookKey, options) {
    if (!mountContainer || !bookKey) return;
    options = options || {};

    const cleanBookKey = String(bookKey);
    let commentsData = [];
    let activeSort = 'top'; // 'top' or 'recent'
    let isSubmitting = false;

    // Render skeleton layout
    mountContainer.innerHTML = `
      <section class="vol-comments-section" id="volCommentsSection_${cleanBookKey}" aria-label="Commentaires du volume">
        
        <!-- Header with Webtoon tabs -->
        <div class="vol-comments-header">
          <div class="vol-comments-title-wrap">
            <h3 class="vol-comments-title">
              <i class="fa-solid fa-comments"></i>
              <span>Espace Débat & Avis</span>
            </h3>
            <span class="vol-comments-count-pill" id="volCommentsCountBadge">Chargement...</span>
          </div>

          <div class="vol-comments-sort-tabs" role="tablist">
            <button type="button" class="vol-sort-tab active" data-sort="top" title="Trier par votes">
              <i class="fa-solid fa-fire"></i> <span>Top Avis</span>
            </button>
            <button type="button" class="vol-sort-tab" data-sort="recent" title="Trier par date">
              <i class="fa-solid fa-clock"></i> <span>Plus Récents</span>
            </button>
          </div>
        </div>

        <!-- Submission Box -->
        <div class="vol-comment-input-box" id="volCommentInputBox">
          <div class="vol-input-user-row">
            <div class="vol-user-avatar" id="volInputAvatar">
              <i class="fa-solid fa-user"></i>
            </div>
            <div class="vol-user-identity" id="volUserIdentity">
              <span class="vol-user-name" id="volInputUserName">Lecteur</span>
              <input type="text" id="volGuestNameInput" class="vol-guest-name-input hidden" placeholder="Votre pseudo (ex: SoloFan)" maxlength="24">
            </div>
            <button type="button" id="volLoginPromptBtn" class="vol-login-link-btn hidden">
              <i class="fa-solid fa-right-to-bracket"></i> Se connecter
            </button>
          </div>

          <textarea id="volCommentText" class="vol-comment-textarea" placeholder="Qu'avez-vous pensé de ce tome ? Vos scènes préférées, théories ou mot pour les traducteurs..." rows="3" maxlength="1000"></textarea>

          <div class="vol-input-footer">
            <label class="vol-spoiler-toggle">
              <input type="checkbox" id="volSpoilerCheck">
              <span><i class="fa-solid fa-triangle-exclamation"></i> Contient un spoiler</span>
            </label>
            <button type="button" id="volSubmitCommentBtn" class="vol-submit-btn">
              <i class="fa-solid fa-paper-plane"></i> <span>Publier</span>
            </button>
          </div>
        </div>

        <!-- Top Comments Spotlight (Webtoon Top 3) -->
        <div class="vol-top-spotlight hidden" id="volTopSpotlight">
          <div class="vol-top-spotlight-title">
            <i class="fa-solid fa-crown" style="color:#f59e0b;"></i>
            <span>Top Commentaires du Tome</span>
          </div>
          <div class="vol-top-spotlight-list" id="volTopSpotlightList"></div>
        </div>

        <!-- Full Comments List -->
        <div class="vol-comments-feed" id="volCommentsFeed">
          <div class="vol-feed-loading">
            <i class="fa-solid fa-circle-notch fa-spin"></i>
            <span>Chargement des avis de la communauté...</span>
          </div>
        </div>

      </section>
    `;

    const countBadge = mountContainer.querySelector('#volCommentsCountBadge');
    const sortTabs = mountContainer.querySelectorAll('.vol-sort-tab');
    const feed = mountContainer.querySelector('#volCommentsFeed');
    const topSpotlight = mountContainer.querySelector('#volTopSpotlight');
    const topSpotlightList = mountContainer.querySelector('#volTopSpotlightList');
    const textarea = mountContainer.querySelector('#volCommentText');
    const submitBtn = mountContainer.querySelector('#volSubmitCommentBtn');
    const spoilerCheck = mountContainer.querySelector('#volSpoilerCheck');
    const avatarEl = mountContainer.querySelector('#volInputAvatar');
    const userNameEl = mountContainer.querySelector('#volInputUserName');
    const guestInput = mountContainer.querySelector('#volGuestNameInput');
    const loginPromptBtn = mountContainer.querySelector('#volLoginPromptBtn');

    // Update user display in form
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
        guestInput.classList.add('hidden');
        loginPromptBtn.classList.add('hidden');

        if (avatar) {
          avatarEl.innerHTML = `<img src="${avatar}" alt="${escapeHtml(pseudo)}">`;
        } else {
          avatarEl.innerHTML = '<i class="fa-solid fa-user"></i>';
        }
      } else {
        // Guest mode
        userNameEl.classList.add('hidden');
        guestInput.classList.remove('hidden');
        loginPromptBtn.classList.remove('hidden');
        avatarEl.innerHTML = '<i class="fa-solid fa-user-ninja"></i>';

        const savedGuest = localStorage.getItem('noveltrad_visitor_name');
        if (savedGuest) guestInput.value = savedGuest;
      }
    }
    updateFormIdentity();

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

    // Sort tabs handler
    sortTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const s = tab.getAttribute('data-sort');
        if (s === activeSort) return;
        activeSort = s;
        sortTabs.forEach(t => t.classList.toggle('active', t === tab));
        renderCommentsList();
      });
    });

    // Fetch comments from API
    async function loadVolumeComments() {
      try {
        const resp = await fetch(`/api/comments/${encodeURIComponent(cleanBookKey)}/volume_end`);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        commentsData = Array.isArray(data.comments) ? data.comments : [];
        renderCommentsList();
        if (typeof window.refreshVolumeCommentsBadge === "function") window.refreshVolumeCommentsBadge(cleanBookKey);
      } catch (err) {
        console.warn('[VolumeComments] Erreur chargement:', err);
        feed.innerHTML = `
          <div class="vol-feed-empty">
            <i class="fa-solid fa-circle-exclamation fa-2x" style="color:#ef4444;"></i>
            <p>Impossible de charger les avis pour le moment.</p>
          </div>
        `;
        countBadge.textContent = '0';
      }
    }

        function renderCommentsList() {
      const count = commentsData.length;
      if (countBadge) {
        countBadge.textContent = count + (count > 1 ? ' avis' : ' avis');
      }

      // 1. TOP SPOTLIGHT (Uniquement commentaires principaux)
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

      // 2. MAIN FEED
      if (count === 0) {
        feed.innerHTML = `
          <div class="vol-feed-empty">
            <div class="empty-icon-wrap"><i class="fa-regular fa-comment-dots"></i></div>
            <h4>Soyez le premier à donner votre avis !</h4>
            <p>Vous venez d'achever ce tome. Partagez votre ressenti, vos théories ou remerciez les traducteurs.</p>
          </div>
        `;
        return;
      }

      // Séparer les commentaires principaux et les réponses
      const topLevelComments = commentsData.filter(c => !c.parent_id);
      const repliesMap = new Map();
      commentsData.filter(c => c.parent_id).forEach(r => {
        if (!repliesMap.has(r.parent_id)) repliesMap.set(r.parent_id, []);
        repliesMap.get(r.parent_id).push(r);
      });

      // Trier les réponses par ordre chronologique
      repliesMap.forEach(list => {
        list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      });

      // Trier les commentaires principaux
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
        ? '<span class="vol-badge-role vip"><i class="fa-solid fa-gem"></i> Mécène</span>'
        : '';

      const topBadgeMarkup = isTopCard
        ? `<span class="vol-badge-top-rank"><i class="fa-solid fa-crown"></i> TOP ${rank || ''}</span>`
        : '';

      const relTime = formatRelativeTime(c.created_at);

      // Spoiler wrapper
      let contentMarkup = '';
      if (c.is_spoiler) {
        contentMarkup = `
          <div class="vol-spoiler-box" onclick="this.classList.toggle('revealed')">
            <div class="vol-spoiler-banner">
              <i class="fa-solid fa-triangle-exclamation"></i>
              <span>Attention Spoiler</span>
              <em>(Cliquer pour révéler)</em>
            </div>
            <div class="vol-spoiler-text">${escapeHtml(c.content)}</div>
          </div>
        `;
      } else {
        contentMarkup = `<p class="vol-comment-text">${escapeHtml(c.content)}</p>`;
      }

      const auth = window.authManager;
      const currentUserId = auth && auth.currentUser ? auth.currentUser.id : null;
      const isAdmin = auth && auth.isAdmin && auth.isAdmin();
      const canDelete = isAdmin || (currentUserId && currentUserId === c.user_id);

      // Reply badge if this is a reply
      const replyToMarkup = (isReply && c.excerpt && c.excerpt.startsWith('Réponse à '))
        ? `<span class="vol-reply-to-pill"><i class="fa-solid fa-reply fa-xs"></i> ${escapeHtml(c.excerpt)}</span>`
        : '';

      let repliesSectionMarkup = '';
      if (!isReply) {
        // Build thread of replies
        let repliesHtml = '';
        if (replies.length > 0) {
          replies.forEach(r => {
            const replyCard = buildCommentCard(r, false, null, true, []);
            repliesHtml += replyCard.outerHTML;
          });
        }

        repliesSectionMarkup = `
          <!-- Tiroir inline de réponse -->
          <div class="vol-reply-drawer hidden" id="replyDrawer-${c.id}">
            <div class="vol-reply-input-wrap">
              <div class="vol-reply-to-hint">
                <i class="fa-solid fa-reply" style="color:#f59e0b;"></i>
                <span>Répondre à <strong style="color:#fbbf24;">@${escapeHtml(c.user_name)}</strong></span>
              </div>
              <textarea class="vol-reply-textarea" id="replyText-${c.id}" placeholder="Votre réponse bienveillante..." rows="2" maxlength="500"></textarea>
              <div class="vol-reply-actions-row">
                <button type="button" class="vol-btn-cancel-reply" data-cid="${c.id}">Annuler</button>
                <button type="button" class="vol-btn-send-reply" data-cid="${c.id}" data-author="${escapeHtml(c.user_name)}">
                  <i class="fa-solid fa-paper-plane"></i> <span>Répondre</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Fil de discussion des réponses -->
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
              <span class="vol-card-time">${relTime}</span>
            </div>
          </div>
          ${canDelete ? `<button type="button" class="vol-btn-delete" data-cid="${c.id}" title="Supprimer ce commentaire"><i class="fa-regular fa-trash-can"></i></button>` : ''}
        </div>

        <div class="vol-card-body">
          ${contentMarkup}
        </div>

        <div class="vol-card-footer">
          <button type="button" class="vol-btn-like ${(c.likes > 0) ? 'has-likes' : ''}" data-cid="${c.id}">
            <i class="fa-regular fa-heart"></i>
            <span class="vol-like-count">${c.likes || 0}</span>
          </button>
          ${!isReply ? `
            <button type="button" class="vol-btn-reply" data-cid="${c.id}" data-author="${escapeHtml(c.user_name)}">
              <i class="fa-solid fa-reply"></i>
              <span>Répondre</span>
              ${replies.length > 0 ? `<span class="vol-reply-count-badge">${replies.length}</span>` : ''}
            </button>
          ` : ''}
        </div>

        ${repliesSectionMarkup}
      `;

      return card;
    }

    function bindFeedEvents() {
      // 1. Bouton Répondre : ouvre le tiroir inline
      mountContainer.querySelectorAll('.vol-btn-reply').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const cId = btn.getAttribute('data-cid');
          const drawer = mountContainer.querySelector('#replyDrawer-' + cId);
          if (drawer) {
            const isHidden = drawer.classList.contains('hidden');
            // Fermer les autres tiroirs
            mountContainer.querySelectorAll('.vol-reply-drawer').forEach(d => d.classList.add('hidden'));
            if (isHidden) {
              drawer.classList.remove('hidden');
              const txt = drawer.querySelector('.vol-reply-textarea');
              if (txt) {
                txt.focus();
              }
            }
          }
        };
      });

      // 2. Bouton Annuler réponse
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

      // 3. Bouton Envoyer la réponse
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

            // Notification visuelle
            const newCard = mountContainer.querySelector('#vcmt-' + (data.comment?.id || data.id));
            if (newCard) {
              newCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
              newCard.style.outline = '2px solid #f59e0b';
              setTimeout(() => { newCard.style.outline = ''; }, 2500);
            }

          } catch (err) {
            alert(err.message || 'Erreur lors de l\'envoi de la réponse.');
          } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> <span>Répondre</span>';
          }
        };
      });
      // Like button handlers
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
              // Update local state
              const target = commentsData.find(x => x.id === cId);
              if (target) {
                target.likes = data.likes;
                if (!Array.isArray(target.liked_by)) target.liked_by = [];
                // Update UI count
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

      // Delete button handlers
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
              if (typeof window.refreshVolumeCommentsBadge === "function") window.refreshVolumeCommentsBadge(cleanBookKey);
            } else {
              alert(data.error || 'Erreur lors de la suppression.');
            }
          } catch(err) {
            alert('Erreur: ' + err.message);
          }
        };
      });
    }

    // Submit new comment
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

        // Reset inputs
        textarea.value = '';
        if (spoilerCheck) spoilerCheck.checked = false;

        // Insert new comment and re-render
        commentsData.unshift(data.comment || data);
        renderCommentsList();
        if (typeof window.refreshVolumeCommentsBadge === "function") window.refreshVolumeCommentsBadge(cleanBookKey);

      } catch(err) {
        alert(err.message || 'Impossible de publier le commentaire.');
      } finally {
        isSubmitting = false;
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> <span>Publier</span>';
      }
    });

    // Initial load
    loadVolumeComments();
  };

})();
