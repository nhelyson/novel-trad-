// ==========================================================================
// NOVELTRAD D4 - ADMIN PANEL & MODERATION LOGIC
// ==========================================================================

class AdminManager {
  constructor() {
    this.pendingQueue = [];
    this.allNovels = [];
    this.allUsers = [];
    this.initElements();
    this.bindEvents();
  }

  initElements() {
    this.container = document.getElementById('adminModuleContainer');
    this.viewDashboard = document.getElementById('adminDashboardSection');
    this.viewQueue = document.getElementById('adminQueueSection');
    this.viewCatalog = document.getElementById('adminCatalogSection');
    this.viewUsers = document.getElementById('adminUsersSection');
    this.viewEditorial = document.getElementById('adminEditorialSection');

    this.tabDashBtn = document.getElementById('adminTabDashBtn');
    this.tabQueueBtn = document.getElementById('adminTabQueueBtn');
    this.tabCatalogBtn = document.getElementById('adminTabCatalogBtn');
    this.tabUsersBtn = document.getElementById('adminTabUsersBtn');
    this.tabEditorialBtn = document.getElementById('adminTabEditorialBtn');
    this.queueCountBadge = document.getElementById('adminQueueCountBadge');

    this.queueContainer = document.getElementById('adminQueueList');
    this.catalogContainer = document.getElementById('adminCatalogList');
    this.usersContainer = document.getElementById('adminUsersList');

    this.inpUserSearch = document.getElementById('adminUserSearchInp');
    this.inpCatalogSearch = document.getElementById('adminCatalogSearchInp');
  }

  escape(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  bindEvents() {
    if (this.tabDashBtn) this.tabDashBtn.addEventListener('click', () => this.showView('dashboard'));
    if (this.tabQueueBtn) this.tabQueueBtn.addEventListener('click', () => this.showView('queue'));
    if (this.tabCatalogBtn) this.tabCatalogBtn.addEventListener('click', () => this.showView('catalog'));
    if (this.tabUsersBtn) this.tabUsersBtn.addEventListener('click', () => this.showView('users'));
    if (this.tabEditorialBtn) this.tabEditorialBtn.addEventListener('click', () => this.showView('editorial'));
    this.bindEditorialEvents();

    if (this.inpUserSearch) {
      this.inpUserSearch.addEventListener('input', () => this.renderUsersList());
    }
    if (this.inpCatalogSearch) {
      this.inpCatalogSearch.addEventListener('input', () => this.renderCatalogList());
    }
  }

  async getHeaders() {
    const token = window.authManager ? await window.authManager.getAccessToken() : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  async initAdmin() {
    if (!window.authManager || !window.authManager.isAdmin()) {
      alert('Accès réservé : Vous devez être Administrateur pour accéder à ce panneau.');
      if (typeof setActiveTab === 'function') {
        const catBtn = document.getElementById('tabCatalogBtn');
        const catMod = document.getElementById('catalogModule');
        if (catBtn && catMod) setActiveTab(catBtn, catMod);
      }
      return;
    }
    await this.loadAllAdminData();
    this.showView('dashboard');
  }

  showView(viewName) {
    [this.viewDashboard, this.viewQueue, this.viewCatalog, this.viewUsers, this.viewEditorial].forEach(v => {
      if (v) v.classList.add('hidden');
    });

    [this.tabDashBtn, this.tabQueueBtn, this.tabCatalogBtn, this.tabUsersBtn, this.tabEditorialBtn].forEach(b => {
      if (b) b.classList.remove('active');
    });

    if (viewName === 'dashboard') {
      if (this.viewDashboard) this.viewDashboard.classList.remove('hidden');
      if (this.tabDashBtn) this.tabDashBtn.classList.add('active');
      this.updateDashboardStats();
    } else if (viewName === 'queue') {
      if (this.viewQueue) this.viewQueue.classList.remove('hidden');
      if (this.tabQueueBtn) this.tabQueueBtn.classList.add('active');
      this.renderQueueList();
    } else if (viewName === 'catalog') {
      if (this.viewCatalog) this.viewCatalog.classList.remove('hidden');
      if (this.tabCatalogBtn) this.tabCatalogBtn.classList.add('active');
      this.renderCatalogList();
    } else if (viewName === 'users') {
      if (this.viewUsers) this.viewUsers.classList.remove('hidden');
      if (this.tabUsersBtn) this.tabUsersBtn.classList.add('active');
      this.renderUsersList();
    } else if (viewName === 'editorial') {
      if (this.viewEditorial) this.viewEditorial.classList.remove('hidden');
      if (this.tabEditorialBtn) this.tabEditorialBtn.classList.add('active');
      this.renderEditorialManagement();
    }
  }

  async loadAllAdminData() {
    await Promise.all([
      this.loadPendingQueue(),
      this.loadCatalog(),
      this.loadUsers()
    ]);
    this.updateDashboardStats();
  }

  async loadPendingQueue() {
    try {
      const headers = await this.getHeaders();
      const res = await fetch('/api/admin/pending', { headers });
      if (res.ok) {
        const data = await res.json();
        this.pendingQueue = data.pending || [];
      } else {
        this.pendingQueue = [];
      }

      if (this.queueCountBadge) {
        this.queueCountBadge.textContent = this.pendingQueue.length;
        this.queueCountBadge.style.display = this.pendingQueue.length > 0 ? 'inline-block' : 'none';
      }
    } catch (err) {
      console.error('[AdminManager] Error loadPendingQueue:', err);
      this.pendingQueue = [];
    }
  }

  async loadCatalog() {
    try {
      const headers = await this.getHeaders();
      const res = await fetch('/api/catalog', { headers });
      if (res.ok) {
        const data = await res.json();
        this.allNovels = data.novels || [];
      } else {
        this.allNovels = [];
      }
    } catch (err) {
      console.error('[AdminManager] Error loadCatalog:', err);
      this.allNovels = [];
    }
  }

  async loadUsers() {
    try {
      const headers = await this.getHeaders();
      const res = await fetch('/api/admin/users', { headers });
      if (res.ok) {
        const data = await res.json();
        this.allUsers = data.users || [];
      } else {
        this.allUsers = [];
      }

      // Ensure current admin is visible if empty
      if (this.allUsers.length === 0 && window.authManager && window.authManager.currentUser) {
        const cur = window.authManager.currentUser;
        this.allUsers = [{
          id: cur.id,
          email: cur.email,
          display_name: cur.user_metadata?.display_name || cur.email.split('@')[0],
          role: window.authManager.getUserRole ? window.authManager.getUserRole() : 'ADMIN',
          created_at: cur.created_at || new Date().toISOString()
        }];
      }
    } catch (err) {
      console.error('[AdminManager] Error loadUsers:', err);
      this.allUsers = [];
    }
  }

  async updateDashboardStats() {
    const elNovels = document.getElementById('adminStatNovels');
    const elQueue = document.getElementById('adminStatQueue');
    const elUsers = document.getElementById('adminStatUsers');
    const elContributors = document.getElementById('adminStatContributors');

    // Live update from memory
    if (elNovels) elNovels.textContent = this.allNovels.length;
    if (elQueue) elQueue.textContent = this.pendingQueue.length;
    if (elUsers) elUsers.textContent = this.allUsers.length;
    if (elContributors) {
      const contribCount = this.allUsers.filter(u => u.role === 'CONTRIBUTOR' || u.role === 'ADMIN').length;
      elContributors.textContent = contribCount;
    }

    // Refresh from backend stats endpoint
    try {
      const headers = await this.getHeaders();
      const res = await fetch('/api/admin/stats', { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.stats) {
          if (elNovels && data.stats.totalNovels > 0) elNovels.textContent = data.stats.totalNovels;
          if (elQueue) elQueue.textContent = data.stats.pendingReviews;
          if (elUsers && data.stats.totalUsers > 0) elUsers.textContent = Math.max(data.stats.totalUsers, this.allUsers.length);
          if (elContributors && data.stats.totalContributors > 0) elContributors.textContent = data.stats.totalContributors;
        }
      }
    } catch (e) {}

    const elQueueRecent = document.getElementById('adminQueueRecentList');
    if (elQueueRecent) {
      if (this.pendingQueue.length === 0) {
        elQueueRecent.innerHTML = '<div class="admin-empty-clean"><i class="fa-solid fa-circle-check"></i> File de modération vide. Aucun roman en attente.</div>';
      } else {
        elQueueRecent.innerHTML = this.pendingQueue.slice(0, 3).map(n => `
          <div class="admin-queue-mini-item">
            <div>
              <strong>${n.title}</strong>
              <span>Soumis par ${n.created_by_email || n.created_by || 'Contributeur'}</span>
            </div>
            <button class="btn-admin-action approve" onclick="window.adminManager.approveNovel('${n.id}')">
              <i class="fa-solid fa-check"></i> Valider
            </button>
          </div>
        `).join('');
      }
    }
  }

  previewVolume(novelId, volumeIndex) {
    const novel = this.pendingQueue.find(n => n.id === novelId);
    if (!novel || !novel.volumes || !novel.volumes[volumeIndex]) {
      alert("Volume introuvable pour ce roman.");
      return;
    }

    const vol = novel.volumes[volumeIndex];
    const volNum = vol.volume_number || vol.volumeNumber || (volumeIndex + 1);
    const formatStr = (vol.format || vol.file_type || (vol.file_name ? vol.file_name.split('.').pop() : 'epub')).toLowerCase();
    const isPdf = formatStr === 'pdf';

    const bookPayload = {
      id: vol.id || `${novel.id}_vol_${volNum}`,
      title: `${novel.title} - ${vol.title || ('Volume ' + volNum)}`,
      seriesId: novel.id,
      volumeNumber: volNum,
      format: isPdf ? 'pdf' : 'epub',
      file_path: vol.file_path || vol.filePath,
      filePath: vol.file_path || vol.filePath,
      cover: vol.cover || vol.cover_url || novel.cover
    };

    if (typeof window.openBookReader === 'function') {
      window.openBookReader(bookPayload);
    } else if (typeof window.openReader === 'function') {
      window.openReader(bookPayload);
    } else {
      alert("Le lecteur intégré n'est pas disponible sur cette page.");
    }
  }

  renderQueueList() {
    if (!this.queueContainer) return;

    if (this.pendingQueue.length === 0) {
      this.queueContainer.innerHTML = `
        <div class="admin-empty-state">
          <i class="fa-solid fa-clipboard-check"></i>
          <h3>Aucune soumission en attente</h3>
          <p>Toutes les créations ont été validées ou traitées.</p>
        </div>
      `;
      return;
    }

    this.queueContainer.innerHTML = this.pendingQueue.map(novel => {
      const cover = novel.cover || novel.cover_url || 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400';
      const volumes = Array.isArray(novel.volumes) ? novel.volumes : [];
      const hasVolumes = volumes.length > 0;

      return `
        <div class="admin-queue-card" id="admin-queue-card-${novel.id}">
          <img src="${cover}" alt="${novel.title}" class="admin-queue-cover">
          <div class="admin-queue-details">
            <div class="admin-queue-header">
              <h3>${novel.title}</h3>
              <span class="badge-pending"><i class="fa-solid fa-clock"></i> En attente de validation</span>
            </div>
            <p class="admin-queue-meta">
              <span><strong>Auteur :</strong> ${novel.author || 'Non renseigné'}</span> &bull; 
              <span><strong>Contributeur :</strong> ${novel.created_by_email || novel.created_by || 'Anonyme'}</span> &bull; 
              <span><strong>Soumis le :</strong> ${new Date(novel.submitted_at || novel.updated_at || Date.now()).toLocaleDateString('fr-FR')}</span>
            </p>
            <p class="admin-queue-synopsis">${novel.synopsis || novel.description || 'Aucun synopsis fourni.'}</p>
            <div class="admin-queue-genres">
              ${(novel.genres || []).map(g => `<span class="tag-chip">${g}</span>`).join('')}
            </div>

            <!-- SECTION INSPECTION VOLUMES UPLOADÉS -->
            <div class="admin-queue-vols-section">
              <div class="admin-queue-vols-head">
                <i class="fa-solid fa-boxes-stacked"></i>
                <strong>Tomes soumis (${volumes.length}) :</strong>
                ${!hasVolumes ? '<span class="admin-no-vols-alert"><i class="fa-solid fa-triangle-exclamation"></i> Aucun tome téléversé</span>' : ''}
              </div>

              ${hasVolumes ? `
                <div class="admin-queue-vols-list">
                  ${volumes.map((v, vIdx) => {
                    const volNum = v.volume_number || v.volumeNumber || (vIdx + 1);
                    const fileType = (v.file_type || (v.file_name ? v.file_name.split('.').pop() : (v.format || 'EPUB'))).toUpperCase();
                    const fileSize = v.file_size ? `${(v.file_size / (1024 * 1024)).toFixed(1)} Mo` : '';
                    const downloadUrl = v.file_path ? `${v.file_path}?download=1` : '';

                    return `
                      <div class="admin-vol-row">
                        <div class="admin-vol-info">
                          <span class="admin-vol-badge">TOME ${String(volNum).padStart(2, '0')}</span>
                          <span class="admin-vol-title">${v.title || `Volume ${volNum}`}</span>
                          <span class="admin-vol-type ${fileType.toLowerCase()}">${fileType}</span>
                          ${fileSize ? `<span class="admin-vol-size"><i class="fa-solid fa-hard-drive"></i> ${fileSize}</span>` : ''}
                        </div>
                        <div class="admin-vol-actions">
                          <button type="button" class="btn-admin-preview-vol" onclick="window.adminManager.previewVolume('${novel.id}', ${vIdx})" title="Ouvrir dans le lecteur pour inspection">
                            <i class="fa-solid fa-book-open"></i> Lire / Prévisualiser
                          </button>
                          ${downloadUrl ? `
                            <a href="${downloadUrl}" download class="btn-admin-download-vol" title="Télécharger le fichier original">
                              <i class="fa-solid fa-download"></i>
                            </a>
                          ` : ''}
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              ` : `
                <p class="admin-vols-empty-hint">Le contributeur n'a pas encore ajouté de fichier pour cette œuvre. Vous pouvez la rejeter pour lui notifier de téléverser au moins un tome.</p>
              `}
            </div>

            <div class="admin-queue-actions">
              <button class="btn-admin-action approve" onclick="window.adminManager.approveNovel('${novel.id}')">
                <i class="fa-solid fa-check"></i> Approuver & Publier
              </button>
              <button class="btn-admin-action reject" onclick="window.adminManager.rejectNovel('${novel.id}')">
                <i class="fa-solid fa-xmark"></i> Rejeter (avec motif)
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  async approveNovel(novelId) {
    if (!confirm('Voulez-vous approuver et publier ce Light Novel dans le catalogue officiel ?')) return;

    try {
      // Backend API handles status updates

      const headers = await this.getHeaders();
      const res = await fetch(`/api/admin/novels/${novelId}/approve`, {
        method: 'POST',
        headers
      });

      if (!res.ok) throw new Error('Échec de l\'approbation du roman.');

      alert('Le roman a été approuvé et publié avec succès !');
      await this.loadAllAdminData();
      this.renderQueueList();
    } catch (err) {
      console.error('[AdminManager] Erreur approveNovel:', err);
      alert(`Erreur : ${err.message}`);
    }
  }

  async rejectNovel(novelId) {
    const reason = prompt('Indiquez la raison du rejet (qui sera communiquée au contributeur) :', 'Informations incomplètes ou non conformes');
    if (reason === null) return;

    try {
      // Backend API handles status updates

      const headers = await this.getHeaders();
      const res = await fetch(`/api/admin/novels/${novelId}/reject`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ review_notes: reason })
      });

      if (!res.ok) throw new Error('Échec du rejet du roman.');

      alert('Le roman a été renvoyé en statut Brouillon.');
      await this.loadAllAdminData();
      this.renderQueueList();
    } catch (err) {
      console.error('[AdminManager] Erreur rejectNovel:', err);
      alert(`Erreur : ${err.message}`);
    }
  }

  renderCatalogList() {
    if (!this.catalogContainer) return;
    const q = (this.inpCatalogSearch?.value || '').trim().toLowerCase();

    let filtered = [...this.allNovels];
    if (q) {
      filtered = filtered.filter(n => (n.title || '').toLowerCase().includes(q) || (n.author || '').toLowerCase().includes(q));
    }

    this.catalogContainer.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr>
            <th>Couverture</th>
            <th>Titre</th>
            <th>Auteur</th>
            <th>Statut</th>
            <th>À la une (Slider)</th>
            <th>Action rapide</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(n => {
            const status = (n.publication_status || 'PUBLISHED').toUpperCase();
            return `
              <tr>
                <td><img src="${n.cover || 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400'}" class="admin-table-thumb"></td>
                <td><strong>${n.title}</strong></td>
                <td>${n.author || 'Inconnu'}</td>
                <td>
                  <select class="admin-status-select" onchange="window.adminManager.changeNovelStatus('${n.id}', this.value)">
                    <option value="PUBLISHED" ${status === 'PUBLISHED' ? 'selected' : ''}>Publié</option>
                    <option value="DRAFT" ${status === 'DRAFT' ? 'selected' : ''}>Brouillon</option>
                    <option value="PENDING_REVIEW" ${status === 'PENDING_REVIEW' ? 'selected' : ''}>En attente</option>
                    <option value="ARCHIVED" ${status === 'ARCHIVED' ? 'selected' : ''}>Archivé</option>
                  </select>
                </td>
                <td>
                  <button type="button" class="btn-contrib-action ${n.featured ? 'featured-active' : ''}" style="${n.featured ? 'color: #f59e0b; border-color: rgba(245, 158, 11, 0.4); background: rgba(245, 158, 11, 0.12);' : 'color: #94a3b8; border-color: rgba(255, 255, 255, 0.1); font-size: 12px; padding: 4px 10px;'}" onclick="window.adminManager.toggleFeatured('${n.id}')" title="${n.featured ? 'Retirer du slider d\'accueil' : 'Mettre à la une sur le slider d\'accueil'}">
                    <i class="fa-${n.featured ? 'solid' : 'regular'} fa-star" style="color: ${n.featured ? '#f59e0b' : 'inherit'};"></i> ${n.featured ? 'À la une' : 'Standard'}
                  </button>
                </td>
                <td>
                  <button class="btn-admin-mini" onclick="window.location.href='/series.html?id=${n.id}'" title="Voir la fiche">
                    <i class="fa-solid fa-eye"></i>
                  </button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

    async toggleFeatured(novelId) {
    try {
      const headers = await this.getHeaders();
      const res = await fetch(`/api/catalog/series/${encodeURIComponent(novelId)}/toggle-featured`, {
        method: 'POST',
        headers
      });
      const data = await res.json();
      if (data.success) {
        if (window.toastManager && typeof window.toastManager.show === 'function') {
          window.toastManager.show(data.featured ? '⭐ Roman mis à la une sur le slider !' : 'Roman retiré de la une', 'success');
        }
        const novel = this.allNovels.find(n => n.id === novelId);
        if (novel) novel.featured = data.featured;
        this.renderCatalogList();

        // Rafraîchir le slider d'accueil si présent
        if (window.HomeLnoriManager && typeof window.HomeLnoriManager.loadHeroData === 'function') {
          window.HomeLnoriManager.loadHeroData();
        }
        if (typeof window.reloadCatalog === 'function') {
          window.reloadCatalog();
        }
      } else {
        alert(data.message || 'Erreur lors de la mise à la une');
      }
    } catch (e) {
      console.error('[AdminManager] Erreur toggleFeatured:', e);
      alert('Erreur: ' + e.message);
    }
  }

  async changeNovelStatus(novelId, newStatus) {
    try {
      const headers = await this.getHeaders();
      const res = await fetch(`/api/admin/novels/${novelId}/status`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ status: newStatus })
      });

      if (!res.ok) throw new Error('Échec du changement de statut');
      alert(`Statut mis à jour : ${newStatus}`);
      await this.loadCatalog();
      if (window.HomeLnoriManager && typeof window.HomeLnoriManager.reloadAllData === 'function') {
        window.HomeLnoriManager.reloadAllData();
      }
      if (typeof window.reloadCatalog === 'function') {
        window.reloadCatalog();
      }
    } catch (err) {
      console.error('[AdminManager] Erreur changeNovelStatus:', err);
      alert(`Erreur : ${err.message}`);
    }
  }

  renderUsersList() {
    if (!this.usersContainer) return;
    const q = (this.inpUserSearch?.value || '').trim().toLowerCase();

    let filtered = [...this.allUsers];
    if (q) {
      filtered = filtered.filter(u => (u.email || '').toLowerCase().includes(q) || (u.id || '').toLowerCase().includes(q));
    }

    this.usersContainer.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr>
            <th>Utilisateur</th>
            <th>ID</th>
            <th>Rôle Actuel</th>
            <th>Modifier le Rôle</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(u => `
            <tr>
              <td><i class="fa-solid fa-user"></i> <strong>${u.email || 'Utilisateur'}</strong></td>
              <td><code>${u.id ? u.id.substring(0, 8) + '...' : 'N/A'}</code></td>
              <td><span class="role-badge role-${(u.role || 'USER').toLowerCase()}">${u.role || 'USER'}</span></td>
              <td>
                <select class="admin-role-select" onchange="window.adminManager.changeUserRole('${u.id}', this.value)">
                  <option value="USER" ${u.role === 'USER' ? 'selected' : ''}>USER (Lecteur)</option>
                  <option value="CONTRIBUTOR" ${u.role === 'CONTRIBUTOR' ? 'selected' : ''}>CONTRIBUTOR (Créateur)</option>
                  <option value="ADMIN" ${u.role === 'ADMIN' ? 'selected' : ''}>ADMIN (Administrateur)</option>
                </select>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  async changeUserRole(userId, newRole) {
    if (!confirm(`Êtes-vous sûr de vouloir changer le rôle de cet utilisateur vers ${newRole} ?`)) {
      this.renderUsersList();
      return;
    }

    try {
      const targetUser = this.allUsers.find(u => u.id === userId);
      const userEmail = targetUser ? targetUser.email : '';

      // Mise à jour sécurisée via le backend NovelTrad (qui applique la modification dans Supabase Cloud avec le client Admin)
      const headers = await this.getHeaders();
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ role: newRole, email: userEmail })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Échec de la modification du rôle');
      }

      // Update in local array immediately
      if (targetUser) targetUser.role = newRole;

      alert(`Rôle de ${userEmail || 'l\'utilisateur'} modifié avec succès vers ${newRole} dans Supabase Cloud !`);
      await this.loadUsers();
      this.renderUsersList();
      this.updateDashboardStats();
    } catch (err) {
      console.error('[AdminManager] Erreur changeUserRole:', err);
      alert(`Erreur : ${err.message}`);
    }
  }

  // =========================================================================
  // GESTION ÉDITORIALE & PLANNING (YEN PRESS UX INSPIRATION)
  // =========================================================================

  // =========================================================================
  // GESTION ÉDITORIALE & PLANNING (UX AMÉLIORÉE & MODALES COMPLÈTES)
  // =========================================================================

  bindEditorialEvents() {
    this.editorialSchedule = [];
    this.editorialNews = [];
    this.activeEdSubTab = 'schedule';

    // Sub-navigation tabs
    const tabSched = document.getElementById('adminEdTabSchedule');
    const tabNews = document.getElementById('adminEdTabNews');
    if (tabSched) {
      tabSched.addEventListener('click', () => this.switchEdSubTab('schedule'));
    }
    if (tabNews) {
      tabNews.addEventListener('click', () => this.switchEdSubTab('news'));
    }

    // Schedule filters
    const schedSearch = document.getElementById('adminSchedSearchInput');
    const schedStatus = document.getElementById('adminSchedFilterStatus');
    if (schedSearch) {
      schedSearch.addEventListener('input', () => this.renderAdminScheduleTable());
    }
    if (schedStatus) {
      schedStatus.addEventListener('change', () => this.renderAdminScheduleTable());
    }

    // News filters
    const newsSearch = document.getElementById('adminNewsSearchInput');
    const newsCat = document.getElementById('adminNewsFilterCategory');
    if (newsSearch) {
      newsSearch.addEventListener('input', () => this.renderAdminNewsCards());
    }
    if (newsCat) {
      newsCat.addEventListener('change', () => this.renderAdminNewsCards());
    }

    // Open add schedule modal
    const btnOpenSched = document.getElementById('btnAdminOpenAddSchedModal');
    if (btnOpenSched) {
      btnOpenSched.addEventListener('click', () => this.openAddScheduleModal());
    }

    // Close schedule modal
    const schedModal = document.getElementById('addScheduleModal');
    const btnCloseSched = document.getElementById('schedModalCloseBtn');
    const btnCancelSched = document.getElementById('btnCancelSchedModal');
    const closeSchedModal = () => {
      if (schedModal) {
        schedModal.classList.add('hidden');
        schedModal.style.display = '';
      }
    };
    if (btnCloseSched) btnCloseSched.addEventListener('click', closeSchedModal);
    if (btnCancelSched) btnCancelSched.addEventListener('click', closeSchedModal);

    // Dynamic cover preview for schedule modal
    const schedCoverInp = document.getElementById('schedCoverUrl');
    if (schedCoverInp) {
      schedCoverInp.addEventListener('input', () => {
        const url = schedCoverInp.value.trim();
        const prevImg = document.getElementById('schedCoverPreviewImg');
        const prevPlc = document.getElementById('schedCoverPreviewPlaceholder');
        if (prevImg && prevPlc) {
          if (url) {
            prevImg.src = url;
            prevImg.classList.remove('hidden');
            prevPlc.classList.add('hidden');
          } else {
            prevImg.src = '';
            prevImg.classList.add('hidden');
            prevPlc.classList.remove('hidden');
          }
        }
      });
    }

    // Auto-fill from catalog select
    const schedSeriesSel = document.getElementById('schedSeriesSelect');
    if (schedSeriesSel) {
      schedSeriesSel.addEventListener('change', () => {
        const seriesId = schedSeriesSel.value;
        if (!seriesId) return;
        const novel = (this.allNovels || []).find(n => n.id === seriesId);
        if (novel) {
          const titleInp = document.getElementById('schedSeriesTitle');
          const coverInp = document.getElementById('schedCoverUrl');
          const typeSel = document.getElementById('schedType');
          const teamInp = document.getElementById('schedTeam');

          if (titleInp && !titleInp.value) titleInp.value = novel.title || '';
          if (coverInp) {
            coverInp.value = novel.cover || '';
            coverInp.dispatchEvent(new Event('input'));
          }
          if (typeSel) {
            const isWebnovel = (novel.type === 'webnovel' || (novel.origin && novel.origin.toLowerCase().includes('web')));
            typeSel.value = isWebnovel ? 'web_novel' : 'light_novel';
          }
          if (teamInp && !teamInp.value) {
            teamInp.value = novel.translator || 'Team NovelTrad';
          }
        }
      });
    }

    // Submit Schedule Form (Add & Edit)
    const schedForm = document.getElementById('addScheduleForm');
    if (schedForm) {
      schedForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errBox = document.getElementById('schedFormError');
        if (errBox) { errBox.classList.add('hidden'); errBox.textContent = ''; }

        const editId = (document.getElementById('schedEditId')?.value || '').trim();
        const seriesTitle = (document.getElementById('schedSeriesTitle')?.value || '').trim();
        const volumeOrChapter = (document.getElementById('schedVolumeOrChapter')?.value || '').trim();
        const type = document.getElementById('schedType')?.value || 'light_novel';
        const releaseDate = document.getElementById('schedInputDate')?.value || '';
        const time = document.getElementById('schedInputTime')?.value || '18:00';
        const team = (document.getElementById('schedTeam')?.value || '').trim() || 'Team NovelTrad';
        const status = document.getElementById('schedStatus')?.value || 'upcoming';
        const coverUrl = (document.getElementById('schedCoverUrl')?.value || '').trim();
        const seriesId = document.getElementById('schedSeriesSelect')?.value || null;

        if (!seriesTitle) {
          if (errBox) { errBox.textContent = "Veuillez saisir le titre de l'œuvre."; errBox.classList.remove('hidden'); }
          return;
        }
        if (!releaseDate) {
          if (errBox) { errBox.textContent = "Veuillez choisir une date de parution."; errBox.classList.remove('hidden'); }
          return;
        }

        let dayOfWeek = 0;
        let dayName = 'Lundi';
        const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
        try {
          const parts = releaseDate.split('-');
          if (parts.length === 3) {
            const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
            dayOfWeek = d.getDay();
            dayName = DAYS[dayOfWeek];
          }
        } catch(err) {}

        const payload = {
          seriesId,
          seriesTitle,
          volumeOrChapter,
          type,
          releaseDate,
          dayOfWeek,
          dayName,
          time,
          team,
          status,
          statusLabel: status === 'released' ? 'Disponible !' : 'À paraître',
          coverUrl
        };

        try {
          const headers = await this.getHeaders();
          const url = editId ? `/api/editorial/schedule/${encodeURIComponent(editId)}` : '/api/editorial/schedule';
          const method = editId ? 'PUT' : 'POST';

          const res = await fetch(url, {
            method,
            headers,
            body: JSON.stringify(payload)
          });

          const data = await res.json();
          if (data.success) {
            closeSchedModal();
            schedForm.reset();
            await this.loadEditorialData();
            this.updateEditorialKPIs();
            this.renderAdminScheduleTable();

            if (window.EditorialManager && typeof window.EditorialManager.loadData === 'function') {
              await window.EditorialManager.loadData();
              window.EditorialManager.render();
            }
          } else {
            if (errBox) {
              errBox.textContent = data.message || "Erreur lors de l'enregistrement.";
              errBox.classList.remove('hidden');
            } else {
              alert(data.message || "Erreur lors de l'enregistrement.");
            }
          }
        } catch(err) {
          if (errBox) {
            errBox.textContent = 'Erreur serveur : ' + err.message;
            errBox.classList.remove('hidden');
          } else {
            alert('Erreur serveur : ' + err.message);
          }
        }
      });
    }

    // Open add news modal button in admin panel
    const btnOpenNews = document.getElementById('btnAdminOpenAddNewsModal');
    const newsModal = document.getElementById('adminAddNewsModal');
    const btnCloseNews = document.getElementById('adminAddNewsCloseBtn');
    const btnCancelNews = document.getElementById('btnCancelNewsModal');

    if (btnOpenNews) {
      btnOpenNews.addEventListener('click', () => {
        if (newsModal) {
          const form = document.getElementById('adminAddNewsForm');
          if (form) form.reset();
          const prevImg = document.getElementById('newsImagePreviewImg');
          const prevPlaceholder = document.getElementById('newsImagePreviewPlaceholder');
          if (prevImg) prevImg.classList.add('hidden');
          if (prevPlaceholder) prevPlaceholder.classList.remove('hidden');

          this.populateNewsSeriesSelect();

          newsModal.classList.remove('hidden');
          newsModal.style.display = 'flex';
        }
      });
    }

    const closeNewsModal = () => {
      if (newsModal) {
        newsModal.classList.add('hidden');
        newsModal.style.display = '';
      }
    };

    if (btnCloseNews) btnCloseNews.addEventListener('click', closeNewsModal);
    if (btnCancelNews) btnCancelNews.addEventListener('click', closeNewsModal);

    // Live Banner Preview in News Modal
    const newsImgInp = document.getElementById('adminModalNewsImage');
    if (newsImgInp) {
      newsImgInp.addEventListener('input', () => {
        const url = newsImgInp.value.trim();
        const prevImg = document.getElementById('newsImagePreviewImg');
        const prevPlaceholder = document.getElementById('newsImagePreviewPlaceholder');
        if (prevImg && prevPlaceholder) {
          if (url) {
            prevImg.src = url;
            prevImg.classList.remove('hidden');
            prevPlaceholder.classList.add('hidden');
          } else {
            prevImg.src = '';
            prevImg.classList.add('hidden');
            prevPlaceholder.classList.remove('hidden');
          }
        }
      });
    }

    // Submit News Form
    const newsForm = document.getElementById('adminAddNewsForm');
    if (newsForm) {
      newsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const headers = await this.getHeaders();
          const payload = {
            title: document.getElementById('adminModalNewsTitle').value.trim(),
            category: document.getElementById('adminModalNewsCategory').value,
            seriesId: document.getElementById('adminModalNewsSeriesSelect').value || null,
            imageUrl: document.getElementById('adminModalNewsImage').value.trim(),
            excerpt: document.getElementById('adminModalNewsExcerpt').value.trim(),
            content: document.getElementById('adminModalNewsContent').value.trim(),
            pinned: document.getElementById('adminModalNewsPinned').checked
          };

          const res = await fetch('/api/editorial/news', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (data.success) {
            closeNewsModal();
            newsForm.reset();
            alert('Actualité publiée avec succès !');
            await this.loadEditorialData();
            this.renderEditorialManagement();
            if (window.EditorialManager && typeof window.EditorialManager.loadData === 'function') {
              await window.EditorialManager.loadData();
              window.EditorialManager.render();
            }
          } else {
            alert(data.message || 'Erreur lors de la publication.');
          }
        } catch(err) {
          alert('Erreur serveur : ' + err.message);
        }
      });
    }
  }

  populateScheduleSeriesSelect() {
    const sel = document.getElementById('schedSeriesSelect');
    if (!sel || !this.allNovels) return;
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">-- Sélectionner une œuvre existante ou saisie libre --</option>';
    const sorted = [...this.allNovels].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    sorted.forEach(n => {
      const opt = document.createElement('option');
      opt.value = n.id;
      opt.textContent = n.title;
      sel.appendChild(opt);
    });
    if (currentVal) sel.value = currentVal;
  }

  openAddScheduleModal() {
    const modal = document.getElementById('addScheduleModal');
    if (!modal) return;
    this.populateScheduleSeriesSelect();

    const form = document.getElementById('addScheduleForm');
    if (form) form.reset();
    const editIdInp = document.getElementById('schedEditId');
    if (editIdInp) editIdInp.value = '';
    const header = document.getElementById('schedModalHeaderTitle');
    if (header) header.textContent = 'Programmer une nouvelle parution';
    const btnTxt = document.getElementById('schedSubmitBtnText');
    if (btnTxt) btnTxt.textContent = 'Enregistrer la parution';
    const dateInp = document.getElementById('schedInputDate');
    if (dateInp) dateInp.value = new Date().toISOString().split('T')[0];
    const timeInp = document.getElementById('schedInputTime');
    if (timeInp) timeInp.value = '18:00';
    const errBox = document.getElementById('schedFormError');
    if (errBox) { errBox.classList.add('hidden'); errBox.textContent = ''; }

    const prevImg = document.getElementById('schedCoverPreviewImg');
    const prevPlc = document.getElementById('schedCoverPreviewPlaceholder');
    if (prevImg) prevImg.classList.add('hidden');
    if (prevPlc) prevPlc.classList.remove('hidden');

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  editScheduleItem(itemId) {
    const item = (this.editorialSchedule || []).find(s => s.id === itemId);
    if (!item) return;

    this.openAddScheduleModal();
    const editIdInp = document.getElementById('schedEditId');
    if (editIdInp) editIdInp.value = item.id;
    const header = document.getElementById('schedModalHeaderTitle');
    if (header) header.textContent = 'Modifier la parution';
    const btnTxt = document.getElementById('schedSubmitBtnText');
    if (btnTxt) btnTxt.textContent = 'Mettre à jour la parution';

    const sel = document.getElementById('schedSeriesSelect');
    if (sel && item.seriesId) sel.value = item.seriesId;

    const titleInp = document.getElementById('schedSeriesTitle');
    if (titleInp) titleInp.value = item.seriesTitle || '';

    const volInp = document.getElementById('schedVolumeOrChapter');
    if (volInp) volInp.value = item.volumeOrChapter || '';

    const typeSel = document.getElementById('schedType');
    if (typeSel) typeSel.value = item.type || 'light_novel';

    const dateInp = document.getElementById('schedInputDate');
    if (dateInp) dateInp.value = item.releaseDate || '';

    const timeInp = document.getElementById('schedInputTime');
    if (timeInp) timeInp.value = item.time || '18:00';

    const teamInp = document.getElementById('schedTeam');
    if (teamInp) teamInp.value = item.team || '';

    const statusSel = document.getElementById('schedStatus');
    if (statusSel) statusSel.value = item.status || 'upcoming';

    const coverInp = document.getElementById('schedCoverUrl');
    if (coverInp) {
      coverInp.value = item.coverUrl || '';
      coverInp.dispatchEvent(new Event('input'));
    }
  }

  populateNewsSeriesSelect() {
    const sel = document.getElementById('adminModalNewsSeriesSelect');
    if (!sel || !this.allNovels) return;
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">Aucune</option>';
    this.allNovels.forEach(n => {
      const opt = document.createElement('option');
      opt.value = n.id;
      opt.textContent = n.title;
      sel.appendChild(opt);
    });
    if (currentVal) sel.value = currentVal;
  }

  switchEdSubTab(tab) {
    this.activeEdSubTab = tab;
    const tabSched = document.getElementById('adminEdTabSchedule');
    const tabNews = document.getElementById('adminEdTabNews');
    const viewSched = document.getElementById('adminEdViewSchedule');
    const viewNews = document.getElementById('adminEdViewNews');

    if (tabSched) tabSched.classList.toggle('active', tab === 'schedule');
    if (tabNews) tabNews.classList.toggle('active', tab === 'news');
    if (viewSched) viewSched.classList.toggle('hidden', tab !== 'schedule');
    if (viewNews) viewNews.classList.toggle('hidden', tab !== 'news');
  }

  async loadEditorialData() {
    try {
      const [schedRes, newsRes] = await Promise.all([
        fetch('/api/editorial/schedule'),
        fetch('/api/editorial/news')
      ]);
      if (schedRes.ok) {
        const s = await schedRes.json();
        this.editorialSchedule = s.schedule || [];
      }
      if (newsRes.ok) {
        const n = await newsRes.json();
        this.editorialNews = n.news || [];
      }
    } catch(err) {
      console.error('[AdminManager] Error loadEditorialData:', err);
    }
  }

  async renderEditorialManagement() {
    await this.loadEditorialData();
    this.updateEditorialKPIs();
    this.renderAdminScheduleTable();
    this.renderAdminNewsCards();
  }

  updateEditorialKPIs() {
    const sched = this.editorialSchedule || [];
    const news = this.editorialNews || [];

    const totalSched = sched.length;
    const upcomingCount = sched.filter(s => s.status !== 'released').length;
    const releasedCount = sched.filter(s => s.status === 'released').length;
    const totalNews = news.length;

    const elTotalSched = document.getElementById('adminKpiTotalSched');
    const elUpcomingSched = document.getElementById('adminKpiUpcomingSched');
    const elReleasedSched = document.getElementById('adminKpiReleasedSched');
    const elTotalNews = document.getElementById('adminKpiTotalNews');

    if (elTotalSched) elTotalSched.textContent = totalSched;
    if (elUpcomingSched) elUpcomingSched.textContent = upcomingCount;
    if (elReleasedSched) elReleasedSched.textContent = releasedCount;
    if (elTotalNews) elTotalNews.textContent = totalNews;

    const bSched = document.getElementById('adminEdBadgeSched');
    const bNews = document.getElementById('adminEdBadgeNews');
    if (bSched) bSched.textContent = totalSched;
    if (bNews) bNews.textContent = totalNews;
  }

  renderAdminScheduleTable() {
    const tbody = document.getElementById('adminSchedTableBody');
    if (!tbody) return;

    const q = (document.getElementById('adminSchedSearchInput')?.value || '').trim().toLowerCase();
    const statusFilter = document.getElementById('adminSchedFilterStatus')?.value || 'all';

    let items = [...(this.editorialSchedule || [])];

    if (statusFilter !== 'all') {
      items = items.filter(s => (s.status || 'upcoming') === statusFilter);
    }

    if (q) {
      items = items.filter(s =>
        (s.seriesTitle || '').toLowerCase().includes(q) ||
        (s.volumeOrChapter || '').toLowerCase().includes(q) ||
        (s.team || '').toLowerCase().includes(q)
      );
    }

    // Sort chronologically
    items.sort((a, b) => {
      const da = (a.releaseDate || '') + (a.time || '');
      const db = (b.releaseDate || '') + (b.time || '');
      return da.localeCompare(db);
    });

    if (items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center; padding:36px; color:#64748b;">
            <i class="fa-regular fa-calendar-xmark" style="font-size:2rem; margin-bottom:8px; display:block;"></i>
            Aucune sortie programmée ne correspond à vos filtres.
          </td>
        </tr>
      `;
      return;
    }

    const fallbackImg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='60' viewBox='0 0 40 60'%3E%3Crect width='40' height='60' fill='%23131722'/%3E%3C/svg%3E";

    tbody.innerHTML = items.map(item => {
      const isReleased = item.status === 'released';
      const statusClass = isReleased ? 'status-pill-released' : 'status-pill-upcoming';
      const statusLabel = isReleased ? '✅ Disponible' : '⏳ À paraître';
      const nextActionTooltip = isReleased ? 'Cliquer pour repasser en À paraître' : 'Cliquer pour marquer Disponible';
      const formatLabel = item.type === 'web_novel' ? 'Webnovel' : 'Light Novel';

      let formattedDate = item.releaseDate || '';
      if (item.releaseDate) {
        try {
          const d = new Date(item.releaseDate + 'T00:00:00');
          formattedDate = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
        } catch(e) {}
      }

      return `
        <tr class="admin-ed-row ${isReleased ? 'row-released' : ''}">
          <td>
            <img src="${item.coverUrl || fallbackImg}" alt="" class="admin-ed-thumb" onerror="this.src='${fallbackImg}'">
          </td>
          <td>
            <strong>${this.escape(item.seriesTitle)}</strong>
            <div class="admin-ed-sub">${this.escape(item.volumeOrChapter || '')}</div>
          </td>
          <td>
            <div style="font-weight:500; color:#f1f5f9;">${formattedDate || 'Date non définie'}</div>
            <div style="font-size:12px; color:#64748b;">${item.dayName || ''} ${item.time ? 'à ' + item.time : ''}</div>
          </td>
          <td>
            <span class="admin-chip-pill" style="font-size:11px;">${formatLabel}</span>
          </td>
          <td>
            <span style="color:#cbd5e1; font-size:13px;"><i class="fa-solid fa-users" style="font-size:11px; margin-right:4px;"></i>${this.escape(item.team || 'NovelTrad')}</span>
          </td>
          <td>
            <button type="button" class="admin-status-toggle-btn ${statusClass}" title="${nextActionTooltip}" onclick="window.adminManager.toggleScheduleStatus('${item.id}')">
              ${statusLabel} <i class="fa-solid fa-arrows-rotate" style="font-size:10px; margin-left:4px; opacity:0.6;"></i>
            </button>
          </td>
          <td style="text-align:right;">
            <button type="button" class="btn-action-icon" style="margin-right:6px;" title="Modifier cette programmation" onclick="window.adminManager.editScheduleItem('${item.id}')">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button type="button" class="btn-action-icon btn-danger" title="Supprimer de la programmation" onclick="window.adminManager.deleteScheduleItem('${item.id}')">
              <i class="fa-solid fa-trash"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  async toggleScheduleStatus(itemId) {
    const item = (this.editorialSchedule || []).find(s => s.id === itemId);
    if (!item) return;

    const newStatus = item.status === 'released' ? 'upcoming' : 'released';
    const newStatusLabel = newStatus === 'released' ? 'Disponible !' : 'À paraître';

    try {
      const headers = await this.getHeaders();
      const res = await fetch(`/api/editorial/schedule/${itemId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ status: newStatus, statusLabel: newStatusLabel })
      });
      if (res.ok) {
        item.status = newStatus;
        item.statusLabel = newStatusLabel;
        this.updateEditorialKPIs();
        this.renderAdminScheduleTable();

        // Also update public EditorialManager if loaded
        if (window.EditorialManager && typeof window.EditorialManager.loadData === 'function') {
          await window.EditorialManager.loadData();
          window.EditorialManager.render();
        }
      } else {
        const err = await res.json();
        alert(err.message || 'Impossible de modifier le statut.');
      }
    } catch(e) {
      alert('Erreur réseau : ' + e.message);
    }
  }

  async deleteScheduleItem(itemId) {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette parution du planning ?')) return;

    try {
      const headers = await this.getHeaders();
      const res = await fetch(`/api/editorial/schedule/${itemId}`, {
        method: 'DELETE',
        headers
      });
      if (res.ok) {
        this.editorialSchedule = this.editorialSchedule.filter(s => s.id !== itemId);
        this.updateEditorialKPIs();
        this.renderAdminScheduleTable();

        // Sync with public EditorialManager
        if (window.EditorialManager && typeof window.EditorialManager.loadData === 'function') {
          await window.EditorialManager.loadData();
          window.EditorialManager.render();
        }
      } else {
        const err = await res.json();
        alert(err.message || 'Impossible de supprimer.');
      }
    } catch(e) {
      alert('Erreur réseau : ' + e.message);
    }
  }

  renderAdminNewsCards() {
    const container = document.getElementById('adminNewsCardsContainer');
    if (!container) return;

    const q = (document.getElementById('adminNewsSearchInput')?.value || '').trim().toLowerCase();
    const cat = document.getElementById('adminNewsFilterCategory')?.value || 'all';

    let items = [...(this.editorialNews || [])];

    if (cat !== 'all') {
      items = items.filter(n => (n.category || '').toLowerCase() === cat.toLowerCase());
    }

    if (q) {
      items = items.filter(n =>
        (n.title || '').toLowerCase().includes(q) ||
        (n.content || '').toLowerCase().includes(q) ||
        (n.author || '').toLowerCase().includes(q)
      );
    }

    // Sort: pinned first, then by date descending
    items.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    if (items.length === 0) {
      container.innerHTML = `
        <div class="admin-empty-pane" style="text-align:center; padding:48px; color:#64748b;">
          <i class="fa-solid fa-bullhorn" style="font-size:2rem; margin-bottom:8px; display:block;"></i>
          Aucun article ou annonce ne correspond à votre recherche.
        </div>
      `;
      return;
    }

    container.innerHTML = items.map(n => {
      let dateFormatted = '';
      try {
        dateFormatted = new Date(n.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
      } catch(e) {
        dateFormatted = n.createdAt || '';
      }

      const isPinned = Boolean(n.pinned);

      return `
        <div class="admin-news-card ${isPinned ? 'is-pinned-card' : ''}">
          ${n.imageUrl ? `
            <div class="admin-news-cover-wrap">
              <img src="${n.imageUrl}" alt="" class="admin-news-cover" loading="lazy">
              ${isPinned ? '<span class="pinned-tag"><i class="fa-solid fa-thumbtack"></i> Épinglé</span>' : ''}
            </div>
          ` : (isPinned ? '<div style="padding:12px 16px 0;"><span class="pinned-tag"><i class="fa-solid fa-thumbtack"></i> Épinglé</span></div>' : '')}

          <div class="admin-news-content">
            <div class="admin-news-header-line">
              <span class="news-category-tag tag-${(n.category || 'annonce').toLowerCase()}">${this.escape(n.category || 'Annonce')}</span>
              <span class="admin-news-date">${dateFormatted}</span>
            </div>

            <h4 class="admin-news-title">${this.escape(n.title)}</h4>
            <p class="admin-news-excerpt">${this.escape(n.excerpt || (n.content ? n.content.substring(0, 120) + '...' : ''))}</p>

            <div class="admin-news-actions-bar">
              <span class="admin-news-author"><i class="fa-solid fa-user-pen"></i> ${this.escape(n.author || 'Admin')}</span>
              
              <div class="admin-news-btns">
                <button type="button" class="btn-action-icon ${isPinned ? 'btn-pinned' : ''}" title="${isPinned ? 'Désépingler' : 'Épingler en haut'}" onclick="window.adminManager.toggleNewsPinned('${n.id}')">
                  <i class="fa-solid fa-thumbtack"></i>
                </button>
                <button type="button" class="btn-action-icon btn-danger" title="Supprimer cette actualité" onclick="window.adminManager.deleteNewsItem('${n.id}')">
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  async toggleNewsPinned(newsId) {
    const item = (this.editorialNews || []).find(n => n.id === newsId);
    if (!item) return;

    try {
      const headers = await this.getHeaders();
      const res = await fetch(`/api/editorial/news/${newsId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ pinned: !item.pinned })
      });
      if (res.ok) {
        item.pinned = !item.pinned;
        this.renderAdminNewsCards();
        // Sync public EditorialManager
        if (window.EditorialManager && typeof window.EditorialManager.loadData === 'function') {
          await window.EditorialManager.loadData();
          window.EditorialManager.render();
        }
      } else {
        alert('Impossible de modifier le statut épinglé.');
      }
    } catch(e) {
      alert('Erreur réseau : ' + e.message);
    }
  }

  async deleteNewsItem(newsId) {
    if (!confirm('Êtes-vous sûr de vouloir supprimer définitivement cette actualité ?')) return;

    try {
      const headers = await this.getHeaders();
      const res = await fetch(`/api/editorial/news/${newsId}`, {
        method: 'DELETE',
        headers
      });
      if (res.ok) {
        this.editorialNews = this.editorialNews.filter(n => n.id !== newsId);
        this.updateEditorialKPIs();
        this.renderAdminNewsCards();
        // Sync public EditorialManager
        if (window.EditorialManager && typeof window.EditorialManager.loadData === 'function') {
          await window.EditorialManager.loadData();
          window.EditorialManager.render();
        }
      } else {
        alert('Impossible de supprimer cette actualité.');
      }
    } catch(e) {
      alert('Erreur réseau : ' + e.message);
    }
  }
}

window.adminManager = new AdminManager();
