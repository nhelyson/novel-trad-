/**
 * inline_comments.js - In-Line Paragraph Comments & Sliding Drawer (NovelTrad)
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


  let currentActiveBookKey = '';
  let currentActiveParagraphId = '';
  let currentActiveExcerpt = '';

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
  //  1. ATTACH COMMENTS TRIGGERS TO CHAPTER PARAGRAPHS
  // =========================================================================
  window.initInlineParagraphComments = async function(contentContainer, bookKey, chapterNum) {
    if (!contentContainer || !bookKey) return;
    currentActiveBookKey = String(bookKey);
    window._currentActiveBookKey = currentActiveBookKey;

    // Find all paragraph elements
    const elements = contentContainer.querySelectorAll('p, blockquote, .dialogue, figure, .pdf-reflow-p');
    if (!elements || elements.length === 0) return;

    let validIndex = 0;
    elements.forEach((el) => {
      // Ignore if text is too short (empty lines or pure formatting)
      const text = el.textContent ? el.textContent.trim() : '';
      const isImg = el.querySelector('img') || el.tagName === 'FIGURE';
      if (!isImg && text.length < 5) return;

      const paragraphId = `c${chapterNum}_p${validIndex}`;
      validIndex++;

      el.setAttribute('data-paragraph-id', paragraphId);
      el.classList.add('has-para-comment-anchor');

      // Check if button already exists
      let btn = el.querySelector('.para-comment-trigger');
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'para-comment-trigger';
        btn.setAttribute('data-pid', paragraphId);
        btn.setAttribute('aria-label', 'Voir les commentaires du paragraphe');
        btn.innerHTML = `<i class="fa-regular fa-comment-dots"></i><span class="para-comment-count" data-pid="${paragraphId}"></span>`;

        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const excerpt = text.length > 150 ? text.substring(0, 150) + '...' : text;
          window.openParagraphComments(bookKey, paragraphId, excerpt || 'Illustration du roman');
        });

        el.appendChild(btn);
      }
    });

    // Batch fetch comment counts for this chapter
    try {
      const resp = await fetch(`/api/comments/counts?bookKey=${encodeURIComponent(bookKey)}&chapter=${encodeURIComponent(chapterNum)}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data.success && data.counts) {
          Object.entries(data.counts).forEach(([pid, count]) => {
            const countSpans = contentContainer.querySelectorAll(`.para-comment-count[data-pid="${pid}"]`);
            countSpans.forEach(span => {
              if (count > 0) {
                span.textContent = count > 99 ? '99+' : count;
                const parentBtn = span.closest('.para-comment-trigger');
                if (parentBtn) parentBtn.classList.add('has-count');
              }
            });
          });
        }
      }
    } catch (e) {
      console.warn('[InlineComments] Erreur chargement des compteurs:', e);
    }
  };

  // =========================================================================
  //  2. OPEN PARAGRAPH COMMENTS DRAWER
  // =========================================================================
  window.openParagraphComments = function(bookKey, paragraphId, excerpt) {
    currentActiveBookKey = bookKey;
    currentActiveParagraphId = paragraphId;
    currentActiveExcerpt = excerpt || '';

    const drawer = document.getElementById('paraCommentsDrawer');
    const backdrop = document.getElementById('paraCommentsBackdrop');
    const quoteText = document.getElementById('paraQuoteText');
    const list = document.getElementById('paraCommentsList');

    if (!drawer || !backdrop) return;

    if (quoteText) {
      quoteText.textContent = currentActiveExcerpt;
    }

    // Update current user identity in post form
    updateCommentFormUser();

    // Show drawer
    backdrop.classList.remove('hidden');
    drawer.classList.remove('hidden');
    drawer.classList.add('open');

    // Load comments
    loadCommentsForActiveParagraph();
  };

  window.closeParagraphComments = function() {
    const drawer = document.getElementById('paraCommentsDrawer');
    const backdrop = document.getElementById('paraCommentsBackdrop');
    if (drawer) {
      drawer.classList.remove('open');
      drawer.classList.add('hidden');
    }
    if (backdrop) {
      backdrop.classList.add('hidden');
    }
  };

  function updateCommentFormUser() {
    const auth = window.authManager;
    const authorAvatar = document.getElementById('commentAuthorAvatar');
    const authorName = document.getElementById('commentAuthorName');

    if (auth && auth.currentUser) {
      const profile = auth.userProfile || {};
      const pseudo = profile.display_name || (auth.currentUser.user_metadata?.display_name) || auth.currentUser.email.split('@')[0];
      const avatar = profile.avatar_url || (auth.currentUser.user_metadata?.avatar_url) || '';

      if (authorName) authorName.textContent = pseudo;
      if (authorAvatar) {
        if (avatar) {
          authorAvatar.innerHTML = `<img src="${avatar}" alt="${pseudo}">`;
        } else {
          authorAvatar.innerHTML = '<i class="fa-solid fa-user"></i>';
        }
      }
    } else {
      if (authorName) authorName.textContent = 'Invité';
      if (authorAvatar) authorAvatar.innerHTML = '<i class="fa-solid fa-user-ninja"></i>';
    }
  }

  // =========================================================================
  //  3. LOAD & RENDER COMMENTS LIST
  // =========================================================================
  async function loadCommentsForActiveParagraph() {
    const list = document.getElementById('paraCommentsList');
    if (!list) return;

    list.innerHTML = `
      <div class="para-comments-loading">
        <i class="fa-solid fa-circle-notch fa-spin"></i>
        <span>Chargement des commentaires...</span>
      </div>
    `;

    try {
      const resp = await fetch(`/api/comments/${encodeURIComponent(currentActiveBookKey)}/${encodeURIComponent(currentActiveParagraphId)}`);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();

      if (!data.success || !Array.isArray(data.comments) || data.comments.length === 0) {
        list.innerHTML = `
          <div class="para-comments-empty">
            <div class="empty-icon"><i class="fa-regular fa-comment-dots"></i></div>
            <h4>Aucun commentaire pour l'instant</h4>
            <p>Soyez le premier lecteur à réagir à cette réplique ou cette illustration !</p>
          </div>
        `;
        return;
      }

      list.innerHTML = '';
      data.comments.forEach(c => {
        const item = document.createElement('div');
        item.className = 'para-comment-item';
        item.id = 'cmt-' + c.id;

        // Modération sobre & immersive : zéro badge public (style Reddit / Royal Road)
        const roleBadge = '';

        const avatarMarkup = c.user_avatar
          ? `<img src="${c.user_avatar}" alt="${c.user_name}" class="comment-item-avatar-img">`
          : `<div class="comment-item-avatar-placeholder"><i class="fa-solid fa-user"></i></div>`;

        const relTime = formatRelativeTime(c.created_at);

        // Spoiler handling
        let contentMarkup = '';
        if (c.is_spoiler) {
          contentMarkup = `
            <div class="comment-spoiler-box" onclick="this.classList.toggle('revealed')">
              <div class="spoiler-warning">
                <i class="fa-solid fa-triangle-exclamation"></i> Contient un spoiler <span>(Cliquez pour révéler)</span>
              </div>
              <div class="spoiler-content">${escapeHtml(c.content)}</div>
            </div>
          `;
        } else {
          contentMarkup = `<p class="comment-item-text">${escapeHtml(c.content)}</p>`;
        }

        const auth = window.authManager;
        const currentUserId = auth && auth.currentUser ? auth.currentUser.id : null;
        const isAdmin = auth && auth.isAdmin && auth.isAdmin();
        const canDelete = isAdmin || (currentUserId && currentUserId === c.user_id);

        item.innerHTML = `
          <div class="comment-item-header">
            <div class="comment-item-author">
              <div class="comment-item-avatar">${avatarMarkup}</div>
              <div class="comment-item-meta">
                <div class="comment-author-name-row">
                  <strong class="comment-author-name">${escapeHtml(c.user_name)}</strong>
                  ${roleBadge}
                </div>
                <span class="comment-item-time">${relTime}</span>
              </div>
            </div>
            ${canDelete ? `<button type="button" class="btn-delete-comment" data-cid="${c.id}" title="Supprimer"><i class="fa-regular fa-trash-can"></i></button>` : ''}
          </div>
          <div class="comment-item-body">
            ${contentMarkup}
          </div>
          <div class="comment-item-footer">
            <button type="button" class="btn-like-comment ${(c.likes > 0) ? 'has-likes' : ''}" data-cid="${c.id}">
              <i class="fa-regular fa-heart"></i> <span class="like-count">${c.likes || 0}</span>
            </button>
          </div>
        `;

        list.appendChild(item);
      });

      // Bind like & delete actions
      bindCommentActions(list);

    } catch (e) {
      console.error('[InlineComments] Erreur chargement:', e);
      list.innerHTML = `
        <div class="para-comments-empty" style="color: #ef4444;">
          <i class="fa-solid fa-circle-exclamation fa-2x"></i>
          <p>Impossible de charger les commentaires.</p>
        </div>
      `;
    }
  }

  function bindCommentActions(container) {
    container.querySelectorAll('.btn-like-comment').forEach(btn => {
      btn.addEventListener('click', async () => {
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
            const countEl = btn.querySelector('.like-count');
            if (countEl) countEl.textContent = data.likes;
            if (data.liked) {
              btn.classList.add('liked');
              btn.querySelector('i').className = 'fa-solid fa-heart';
            } else {
              btn.classList.remove('liked');
              btn.querySelector('i').className = 'fa-regular fa-heart';
            }
          }
        } catch(e) {
          console.warn('[Like Error]', e);
        } finally {
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('.btn-delete-comment').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cId = btn.getAttribute('data-cid');
        if (!cId) return;
        if (!confirm('Supprimer ce commentaire ?')) return;

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
            const item = document.getElementById('cmt-' + cId);
            if (item) item.remove();
            decrementBadgeCount(currentActiveParagraphId);
          } else {
            alert(data.error || 'Erreur lors de la suppression.');
          }
        } catch(e) {
          alert('Erreur: ' + e.message);
        }
      });
    });
  }

  function incrementBadgeCount(paragraphId) {
    const badges = document.querySelectorAll(`.para-comment-count[data-pid="${paragraphId}"]`);
    badges.forEach(b => {
      const current = parseInt(b.textContent || '0', 10);
      const next = isNaN(current) ? 1 : current + 1;
      b.textContent = next;
      const parentBtn = b.closest('.para-comment-trigger');
      if (parentBtn) parentBtn.classList.add('has-count');
    });
  }

  function decrementBadgeCount(paragraphId) {
    const badges = document.querySelectorAll(`.para-comment-count[data-pid="${paragraphId}"]`);
    badges.forEach(b => {
      const current = parseInt(b.textContent || '0', 10);
      const next = Math.max(0, current - 1);
      if (next > 0) {
        b.textContent = next;
      } else {
        b.textContent = '';
        const parentBtn = b.closest('.para-comment-trigger');
        if (parentBtn) parentBtn.classList.remove('has-count');
      }
    });
  }

  // =========================================================================
  //  4. SUBMIT NEW COMMENT
  // =========================================================================
  async function submitActiveComment() {
    const input = document.getElementById('paraCommentInput');
    const spoilerCheck = document.getElementById('paraCommentSpoilerCheck');
    const submitBtn = document.getElementById('btnSubmitParaComment');

    if (!input || !submitBtn) return;
    const text = input.value.trim();
    if (text.length < 2) {
      alert('Veuillez écrire au moins 2 caractères.');
      return;
    }

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
        excerpt: String(currentActiveExcerpt || '').slice(0, 300)
      };

      const res = await fetch(`/api/comments/${encodeURIComponent(currentActiveBookKey)}/${encodeURIComponent(currentActiveParagraphId)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Erreur lors de la publication.');
      }

      input.value = '';
      if (spoilerCheck) spoilerCheck.checked = false;
      incrementBadgeCount(currentActiveParagraphId);

      // Reload comments list
      await loadCommentsForActiveParagraph();

    } catch (err) {
      alert(err.message || 'Erreur lors de la publication du commentaire.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Publier';
    }
  }

  // =========================================================================
  //  5. DOM INIT & EVENT LISTENERS
  // =========================================================================
  document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('paraCommentsCloseBtn');
    const backdrop = document.getElementById('paraCommentsBackdrop');
    const submitBtn = document.getElementById('btnSubmitParaComment');
    const textarea = document.getElementById('paraCommentInput');

    if (closeBtn) closeBtn.addEventListener('click', window.closeParagraphComments);
    if (backdrop) backdrop.addEventListener('click', window.closeParagraphComments);
    if (submitBtn) submitBtn.addEventListener('click', submitActiveComment);

    if (textarea) {
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          submitActiveComment();
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        window.closeParagraphComments();
      }
    });
  });

})();
