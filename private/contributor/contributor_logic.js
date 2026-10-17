// ==========================================================================
// NOVELTRAD D4 - CONTRIBUTOR STUDIO LOGIC (DUAL MODE: AUTO API & MANUAL)
// ==========================================================================

class ContributorManager {
  constructor() {
    this.novels = [];
    this.myNovels = [];
    this.currentEditingNovelId = null;
    this.selectedNovelForVolumes = null;
    this.selectedVolumeFile = null;
    this.selectedGenres = new Set();
    this.currentMode = 'auto'; // 'auto' | 'manual'
    this.fetchedApiData = null;

    this.initElements();
    this.bindEvents();
  }

  initElements() {
    this.container = document.getElementById('contributorModuleContainer');
    this.viewOverview = document.getElementById('contribOverviewSection');
    this.viewNovels = document.getElementById('contribNovelsSection');
    this.viewForm = document.getElementById('contribFormSection');
    this.viewVolumes = document.getElementById('contribVolumesSection');
    this.modalVolume = document.getElementById('contribVolumeModal');

    this.tabOverviewBtn = document.getElementById('contribTabOverviewBtn');
    this.tabNovelsBtn = document.getElementById('contribTabNovelsBtn');
    this.tabCreateBtn = document.getElementById('contribTabCreateBtn');
    this.tabVolumesBtn = document.getElementById('contribTabVolumesBtn');

    // Dual mode elements
    this.btnModeAuto = document.getElementById('btnModeAuto');
    this.btnModeManual = document.getElementById('btnModeManual');
    this.autoPanel = document.getElementById('contribAutoModePanel');
    this.inpApiSearch = document.getElementById('contribApiSearchInput');
    this.btnFetchApi = document.getElementById('btnContribFetchApi');
    this.apiResultCard = document.getElementById('contribApiResultCard');
    this.btnApplyApiData = document.getElementById('btnApplyApiData');

    // API Result Card preview
    this.apiResultCover = document.getElementById('apiResultCover');
    this.apiResultTitle = document.getElementById('apiResultTitle');
    this.apiResultAuthor = document.getElementById('apiResultAuthor');
    this.apiResultStatus = document.getElementById('apiResultStatus');
    this.apiResultGenres = document.getElementById('apiResultGenres');
    this.apiResultSynopsis = document.getElementById('apiResultSynopsis');
    this.apiResultProvider = document.getElementById('apiResultProvider');

    // Form elements
    this.novelForm = document.getElementById('contribNovelForm');
    this.novelFormTitle = document.getElementById('contribFormTitle');
    this.inpTitle = document.getElementById('contribNovelTitle');
    this.inpRomaji = document.getElementById('contribNovelRomaji');
    this.inpAuthor = document.getElementById('contribNovelAuthor');
    this.inpIllustrator = document.getElementById('contribNovelIllustrator');
    this.inpSynopsis = document.getElementById('contribNovelSynopsis');
    this.inpGenres = document.getElementById('contribNovelGenres');
    this.inpTags = document.getElementById('contribNovelTags');
    this.inpCoverUrl = document.getElementById('contribNovelCoverUrl');
    this.btnCoverPillFile = document.getElementById('btnCoverPillFile');
    this.btnCoverPillUrl = document.getElementById('btnCoverPillUrl');
    this.paneCoverFile = document.getElementById('contribCoverFilePanel');
    this.paneCoverUrl = document.getElementById('contribCoverUrlPanel');
    this.dropzoneCover = document.getElementById('contribCoverDropzone');
    this.fileInputCover = document.getElementById('contribCoverFileInput');
    this.coverDropEmpty = document.getElementById('coverDropEmpty');
    this.coverDropPreview = document.getElementById('coverDropPreview');
    this.coverDropLoading = document.getElementById('coverDropLoading');
    this.coverDropThumb = document.getElementById('coverDropThumb');
    this.coverFileTitle = document.getElementById('coverFileTitle');
    this.btnBrowseCover = document.getElementById('btnBrowseCover');
    this.btnChangeCover = document.getElementById('btnChangeCover');
    this.btnDeleteCover = document.getElementById('btnDeleteCover');
    this.coverDirectUrlInput = document.getElementById('contribCoverUrlDirectInput');
    this.inpStatus = document.getElementById('contribNovelStatus');
    this.novelSubmitBtn = document.getElementById('contribSaveNovelBtn');

    // Live preview elements
    this.previewCover = document.getElementById('livePreviewCoverImg');
    this.previewTitle = document.getElementById('livePreviewTitle');
    this.previewAuthor = document.getElementById('livePreviewAuthor');
    this.previewGenres = document.getElementById('livePreviewGenres');

    // Volume modal elements
    this.volNovelTitleSpan = document.getElementById('volModalNovelTitle');
    this.volForm = document.getElementById('contribVolumeForm');
    this.inpVolNumber = document.getElementById('contribVolNumber');
    this.inpVolTitle = document.getElementById('contribVolTitle');
    this.inpVolReleaseDate = document.getElementById('contribVolReleaseDate');
    this.volListContainer = document.getElementById('contribVolListContainer');
    this.btnUnitModeVolume = document.getElementById('btnUnitModeVolume');
    this.btnUnitModeChapter = document.getElementById('btnUnitModeChapter');
    this.inpNovelAllowDownload = document.getElementById('contribNovelAllowDownload');
    this.btnToggleNovelDownload = document.getElementById('btnToggleNovelDownload');
    this.labelToggleNovelDownload = document.getElementById('labelToggleNovelDownload');
    this.inpNovelUnitType = document.getElementById('contribNovelUnitType');
    this.inpNovelOrigin = document.getElementById('contribNovelOrigin');
    this.inpNovelOriginCustom = document.getElementById('contribNovelOriginCustom');
    this.apiResultRomaji = document.getElementById('apiResultRomaji');
    this.apiResultRomajiText = document.getElementById('apiResultRomajiText');

    if (this.inpNovelOrigin) {
      this.inpNovelOrigin.addEventListener('change', () => {
        if (this.inpNovelOrigin.value === 'OTHER') {
          if (this.inpNovelOriginCustom) this.inpNovelOriginCustom.classList.remove('hidden');
        } else {
          if (this.inpNovelOriginCustom) this.inpNovelOriginCustom.classList.add('hidden');
        }
      });
    }
    this.candidatesSection = document.getElementById('contribApiCandidatesSection');
    this.candidatesGrid = document.getElementById('contribApiCandidatesGrid');
    this.candidatesCountPill = document.getElementById('candidatesCountPill');
    this.apiResultOrigin = document.getElementById('apiResultOrigin');
    this.volFormColTitle = document.getElementById('volFormColTitle');
    this.volFormColDesc = document.getElementById('volFormColDesc');
    this.volDropzoneMainPrompt = document.getElementById('volDropzoneMainPrompt');
    this.volTypeSelectLabel = document.getElementById('volTypeSelectLabel');
    this.volNumberInputLabel = document.getElementById('volNumberInputLabel');
    this.volTitleInputLabel = document.getElementById('volTitleInputLabel');
    this.btnSubmitVolumeText = document.getElementById('btnSubmitVolumeText');
    this.volListColHeader = document.getElementById('volListColHeader');

    this.searchInp = document.getElementById('contribSearchInput');
    this.statusFilter = document.getElementById('contribStatusFilter');
  }

  bindEvents() {
    if (this.tabOverviewBtn) this.tabOverviewBtn.addEventListener('click', () => this.showView('overview'));
    if (this.tabNovelsBtn) this.tabNovelsBtn.addEventListener('click', () => this.showView('novels'));
    if (this.tabCreateBtn) this.tabCreateBtn.addEventListener('click', () => this.openCreateForm());
    if (this.tabVolumesBtn) this.tabVolumesBtn.addEventListener('click', () => this.showView('volumes'));

    const btnNewNovel = document.getElementById('btnContribNewNovel');
    if (btnNewNovel) btnNewNovel.addEventListener('click', () => this.openCreateForm());

    // Dual mode switchers
    if (this.btnModeAuto) {
      this.btnModeAuto.addEventListener('click', () => this.switchMode('auto'));
    }
    if (this.btnModeManual) {
      this.btnModeManual.addEventListener('click', () => this.switchMode('manual'));
    }

    // API Search
    if (this.btnFetchApi) {
      this.btnFetchApi.addEventListener('click', () => this.searchApiMetadata());
    }
    if (this.inpApiSearch) {
      this.inpApiSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.searchApiMetadata();
        }
      });
    }
    if (this.btnApplyApiData) {
      this.btnApplyApiData.addEventListener('click', () => this.applyApiDataToForm());
    }

    // Interactive Genre chips
    this.setupGenreChips();

    // Live preview update on inputs
    if (this.inpTitle) this.inpTitle.addEventListener('input', () => this.updateLivePreview());
    if (this.inpAuthor) this.inpAuthor.addEventListener('input', () => this.updateLivePreview());
    if (this.inpCoverUrl) {
      this.inpCoverUrl.addEventListener('input', () => this.updateLivePreview());
      this.inpCoverUrl.addEventListener('change', () => this.updateLivePreview());
    }

    if (this.novelForm) {
      this.novelForm.addEventListener('submit', (e) => this.handleNovelSubmit(e));
    }

    if (this.volForm) {
      this.volForm.addEventListener('submit', (e) => this.handleVolumeSubmit(e));
    }

    if (this.btnUnitModeVolume) {
      this.btnUnitModeVolume.addEventListener('click', () => this.switchUnitType('volume', true));
    }
    if (this.btnUnitModeChapter) {
      this.btnUnitModeChapter.addEventListener('click', () => this.switchUnitType('chapter', true));
    }

    if (this.btnToggleNovelDownload) {
      this.btnToggleNovelDownload.addEventListener('click', () => this.toggleNovelDownloadPermission());
    }

    const btnCloseVolModal = document.getElementById('btnCloseContribVolModal');
    if (btnCloseVolModal && this.modalVolume) {
      btnCloseVolModal.addEventListener('click', () => {
        this.modalVolume.classList.add('hidden');
      });
    }

    if (this.searchInp) this.searchInp.addEventListener('input', () => this.renderNovelsList());
    if (this.statusFilter) this.statusFilter.addEventListener('change', () => this.renderNovelsList());

    // Setup Volume Dropzone
    this.setupVolumeDropzone();

    // Setup Multifunctional Cover Upload (Local File + Web URL)
    this.setupCoverUpload();

    // Auto-reload novels when contributor/admin logs in
    const auth = window.authManager || window.supabaseAuthManager;
    if (auth && typeof auth.onAuthStateChange === 'function') {
      auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
          this.loadMyNovels();
        }
      });
    }
  }

  setupGenreChips() {
    document.querySelectorAll('#contribGenreChipsSelector .genre-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const genre = chip.getAttribute('data-genre');
        if (this.selectedGenres.has(genre)) {
          this.selectedGenres.delete(genre);
          chip.classList.remove('selected');
        } else {
          this.selectedGenres.add(genre);
          chip.classList.add('selected');
        }
        this.updateGenresField();
        this.updateLivePreview();
      });
    });
  }

  setupVolumeDropzone() {
    const dropzone = document.getElementById('volDropzone');
    const fileInput = document.getElementById('contribVolFile');
    const prompt = document.getElementById('volDropzonePrompt');
    const preview = document.getElementById('volSelectedFilePreview');
    const fileNameEl = document.getElementById('volSelectedFileName');
    const fileSizeEl = document.getElementById('volSelectedFileSize');
    const fileIconBox = document.getElementById('volFileIconBox');
    const btnRemove = document.getElementById('btnRemoveVolFile');

    if (!dropzone || !fileInput) return;

    this.selectedVolumeFile = null;

    const handleFileSelect = (file) => {
      if (!file) return;
      const ext = file.name.split('.').pop().toLowerCase();
      if (!['epub', 'pdf', 'zip'].includes(ext)) {
        alert('Veuillez sélectionner un fichier .epub ou .pdf valide.');
        return;
      }

      this.selectedVolumeFile = file;
      if (prompt) prompt.classList.add('hidden');
      if (preview) preview.classList.remove('hidden');
      if (fileNameEl) fileNameEl.textContent = file.name;
      
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      if (fileSizeEl) fileSizeEl.textContent = `${sizeMb} Mo • ${ext.toUpperCase()}`;
      
      if (fileIconBox) {
        fileIconBox.innerHTML = ext === 'pdf' 
          ? '<i class="fa-solid fa-file-pdf" style="color: #f87171;"></i>' 
          : '<i class="fa-solid fa-book" style="color: #60a5fa;"></i>';
      }

      // Auto-extract volume number from filename if possible
      const match = file.name.match(/(?:vol(?:ume)?|tome|t|chap(?:itre)?|ch|c)[._\s-]*(\d+(?:\.\d+)?)/i);
      if (match && match[1] && this.inpVolNumber) {
        this.inpVolNumber.value = parseInt(match[1], 10);
      }
    };

    dropzone.addEventListener('click', (e) => {
      if (e.target.closest('#btnRemoveVolFile')) return;
      fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleFileSelect(e.target.files[0]);
      }
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });

    dropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFileSelect(e.dataTransfer.files[0]);
      }
    });

    if (btnRemove) {
      btnRemove.addEventListener('click', (e) => {
        e.stopPropagation();
        this.resetVolumeFilePicker();
      });
    }
  }

  resetVolumeFilePicker() {
    this.selectedVolumeFile = null;
    const fileInput = document.getElementById('contribVolFile');
    const prompt = document.getElementById('volDropzonePrompt');
    const preview = document.getElementById('volSelectedFilePreview');
    const progress = document.getElementById('volUploadProgress');
    
    if (fileInput) fileInput.value = '';
    if (prompt) prompt.classList.remove('hidden');
    if (preview) preview.classList.add('hidden');
    if (progress) progress.classList.add('hidden');
  }

  switchMode(mode) {
    this.currentMode = mode;
    if (mode === 'auto') {
      if (this.btnModeAuto) this.btnModeAuto.classList.add('active');
      if (this.btnModeManual) this.btnModeManual.classList.remove('active');
      if (this.autoPanel) this.autoPanel.classList.remove('hidden');
    } else {
      if (this.btnModeAuto) this.btnModeAuto.classList.remove('active');
      if (this.btnModeManual) this.btnModeManual.classList.add('active');
      if (this.autoPanel) this.autoPanel.classList.add('hidden');
    }
  }

  async getHeaders() {
    const auth = window.authManager || window.supabaseAuthManager;
    const token = auth ? await auth.getAccessToken() : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  async initStudio() {
    const auth = window.authManager || window.supabaseAuthManager;
    if (!auth || !auth.isContributor()) {
      // Accès réservé - redirection silencieuse
      if (typeof setActiveTab === 'function') {
        const catBtn = document.getElementById('tabCatalogBtn');
        const catMod = document.getElementById('catalogModule');
        if (catBtn && catMod) setActiveTab(catBtn, catMod);
      }
      return;
    }
    await this.loadMyNovels();
    this.showView('overview');
  }

  showView(viewName) {
    const auth = window.authManager || window.supabaseAuthManager;
    if (!auth || !auth.isContributor()) {
      if (this.container) this.container.classList.add('hidden');
      return;
    }
    [this.viewOverview, this.viewNovels, this.viewForm, this.viewVolumes].forEach(v => {
      if (v) v.classList.add('hidden');
    });

    [this.tabOverviewBtn, this.tabNovelsBtn, this.tabCreateBtn, this.tabVolumesBtn].forEach(b => {
      if (b) b.classList.remove('active');
    });

    if (viewName === 'overview') {
      if (this.viewOverview) this.viewOverview.classList.remove('hidden');
      if (this.tabOverviewBtn) this.tabOverviewBtn.classList.add('active');
      if (this.tabVolumesBtn) this.tabVolumesBtn.classList.add('hidden');
      this.updateStats();
      this.loadMyNovels();
    } else if (viewName === 'novels') {
      if (this.viewNovels) this.viewNovels.classList.remove('hidden');
      if (this.tabNovelsBtn) this.tabNovelsBtn.classList.add('active');
      if (this.tabVolumesBtn) this.tabVolumesBtn.classList.add('hidden');
      this.renderNovelsList();
      this.loadMyNovels();
    } else if (viewName === 'form') {
      if (this.viewForm) this.viewForm.classList.remove('hidden');
      if (this.tabCreateBtn) this.tabCreateBtn.classList.add('active');
      if (this.tabVolumesBtn) this.tabVolumesBtn.classList.add('hidden');
      this.updateLivePreview();
    } else if (viewName === 'volumes') {
      if (this.viewVolumes) this.viewVolumes.classList.remove('hidden');
      if (this.tabVolumesBtn) {
        this.tabVolumesBtn.classList.remove('hidden');
        this.tabVolumesBtn.classList.add('active');
      }
    }
  }

  async searchApiMetadata() {
    const query = (this.inpApiSearch?.value || '').trim();
    if (!query) {
      alert('Veuillez entrer le nom d\'un Light Novel à rechercher.');
      return;
    }

    const textSpan = document.getElementById('btnFetchApiText');
    const spinSpan = document.getElementById('btnFetchApiSpinner');
    if (textSpan) textSpan.classList.add('hidden');
    if (spinSpan) spinSpan.classList.remove('hidden');
    if (this.btnFetchApi) this.btnFetchApi.disabled = true;

    try {
      const res = await fetch(`/api/metadata/search?q=${encodeURIComponent(query)}`);
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Le serveur backend doit être redémarré (npm start) pour charger la route API.');
      }
      const data = await res.json();
      if (!res.ok || !data.success || !data.metadata) {
        throw new Error(data.error || 'Aucun Light Novel trouvé sur les APIs pour cette recherche.');
      }

      this.fetchedApiData = data.metadata;
      this.candidates = data.candidates || [data.metadata];
      this.renderApiResultCard(data.metadata);
      this.renderCandidatesSelector(this.candidates, data.metadata.id || (data.metadata.title));
    } catch (err) {
      console.error('[Contributor] Erreur API search:', err);
      alert(`Recherche API : ${err.message}`);
    } finally {
      if (textSpan) textSpan.classList.remove('hidden');
      if (spinSpan) spinSpan.classList.add('hidden');
      if (this.btnFetchApi) this.btnFetchApi.disabled = false;
    }
  }

  renderCandidatesSelector(candidates, activeId) {
    const section = document.getElementById('contribApiCandidatesSection');
    const grid = document.getElementById('contribApiCandidatesGrid');
    const countPill = document.getElementById('candidatesCountPill');
    if (!section || !grid) return;

    if (!candidates || candidates.length <= 1) {
      section.classList.add('hidden');
      return;
    }

    if (countPill) countPill.textContent = `${candidates.length} résultat${candidates.length > 1 ? 's' : ''}`;
    grid.innerHTML = '';

    candidates.forEach((cand, idx) => {
      const candId = cand.id || (cand.provider + '-' + idx);
      const isActive = (candId === activeId) || (idx === 0 && !activeId);
      const isNovel = (cand.format === 'NOVEL');
      const coverUrl = cand.cover || '/icons/icon-512x512.png';
      const provider = (cand.provider || 'anilist').toLowerCase();

      // Flag / Country pill
      let flagEmoji = '🇯🇵';
      if ((cand.origin || '').includes('Corée') || cand.countryOfOrigin === 'KR') flagEmoji = '🇰🇷';
      else if ((cand.origin || '').includes('Chine') || cand.countryOfOrigin === 'CN') flagEmoji = '🇨🇳';
      else if ((cand.origin || '').includes('France') || cand.countryOfOrigin === 'FR') flagEmoji = '🇫🇷';

      const card = document.createElement('div');
      card.className = `api-candidate-card ${isActive ? 'active' : ''}`;
      card.innerHTML = `
        <img src="${coverUrl}" alt="Cover" class="api-candidate-thumb" onerror="this.src='/icons/icon-512x512.png'">
        <div class="api-candidate-info">
          <div>
            <div class="api-candidate-title" title="${cand.title}">${cand.title}</div>
            ${cand.title_romaji && cand.title_romaji.trim() && cand.title_romaji.trim().toLowerCase() !== (cand.title || '').trim().toLowerCase() ? `<div class="api-candidate-romaji" title="${cand.title_romaji}"><i class="fa-solid fa-language"></i> ${cand.title_romaji}</div>` : ''}
            <div class="api-candidate-author">${cand.author || 'Auteur non précisé'}${cand.year ? ` &bull; ${cand.year}` : ''}</div>
          </div>
          <div class="api-candidate-badges">
            <span class="api-source-badge ${provider}">${provider.toUpperCase()}</span>
            <span class="api-origin-badge">${flagEmoji} ${cand.origin ? cand.origin.split(' ')[0] : 'Japon'}</span>
            <span class="api-origin-badge ${isNovel ? 'format-novel' : 'format-manga'}">${cand.format_label || (isNovel ? 'Novel' : 'Manga')}</span>
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        document.querySelectorAll('.api-candidate-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        this.fetchedApiData = cand;
        this.renderApiResultCard(cand);
      });

      grid.appendChild(card);
    });

    section.classList.remove('hidden');
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  renderApiResultCard(meta) {
    if (!this.apiResultCard) return;

    const cover = meta.cover || '/icons/icon-512x512.png';
    if (this.apiResultCover) this.apiResultCover.src = cover;
    if (this.apiResultTitle) this.apiResultTitle.textContent = meta.title || 'Sans titre';
    if (this.apiResultRomaji && this.apiResultRomajiText) {
      const romaji = meta.title_romaji || meta.originalTitle || '';
      if (romaji && romaji.trim().toLowerCase() !== (meta.title || '').trim().toLowerCase()) {
        this.apiResultRomajiText.textContent = romaji;
        this.apiResultRomaji.classList.remove('hidden');
      } else {
        this.apiResultRomaji.classList.add('hidden');
      }
    }
    if (this.apiResultAuthor) this.apiResultAuthor.textContent = meta.author || 'Inconnu';
    if (this.apiResultStatus) this.apiResultStatus.textContent = meta.status_fr || meta.status || 'En cours';
    if (this.apiResultOrigin) this.apiResultOrigin.textContent = meta.origin || 'Japon (Light Novel)';
    if (this.apiResultProvider) this.apiResultProvider.textContent = `Source : ${(meta.provider || 'AniList').toUpperCase()}`;

    if (this.apiResultSynopsis) {
      const syn = meta.synopsis_fr || meta.synopsis || 'Aucun synopsis disponible.';
      this.apiResultSynopsis.textContent = syn.length > 250 ? syn.substring(0, 250) + '...' : syn;
    }

    if (this.apiResultGenres) {
      const genres = meta.genres_fr || meta.genres || [];
      this.apiResultGenres.innerHTML = genres.map(g => `<span class="tag-chip">${g}</span>`).join('');
    }

    this.apiResultCard.classList.remove('hidden');
    this.apiResultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  applyApiDataToForm() {
    if (!this.fetchedApiData) return;
    const meta = this.fetchedApiData;

    if (this.inpTitle) this.inpTitle.value = meta.title || '';
    if (this.inpRomaji) this.inpRomaji.value = meta.title_romaji || meta.originalTitle || '';
    if (this.inpAuthor) this.inpAuthor.value = meta.author || '';
    if (this.inpIllustrator) this.inpIllustrator.value = meta.illustrator || '';
    if (this.inpSynopsis) this.inpSynopsis.value = meta.synopsis_fr || meta.synopsis || '';
    if (this.inpCoverUrl) this.inpCoverUrl.value = meta.cover || '';
    // Origine automatique intelligente
    if (this.inpNovelOrigin) {
      let matchedOrigin = 'Japon (Light Novel)';
      const origStr = (meta.origin || '').toLowerCase();
      const co = (meta.countryOfOrigin || '').toUpperCase();
      if (origStr.includes('corée') || origStr.includes('coree') || co === 'KR') {
        matchedOrigin = 'Corée du Sud (Webnovel)';
      } else if (origStr.includes('chine') || co === 'CN') {
        matchedOrigin = 'Chine (Webnovel)';
      } else if (origStr.includes('france') || co === 'FR') {
        matchedOrigin = 'France (Création originale)';
      } else if (meta.origin) {
        matchedOrigin = meta.origin;
      }

      const hasOption = Array.from(this.inpNovelOrigin.options).some(o => o.value === matchedOrigin);
      if (hasOption) {
        this.inpNovelOrigin.value = matchedOrigin;
        if (this.inpNovelOriginCustom) this.inpNovelOriginCustom.classList.add('hidden');
      } else {
        this.inpNovelOrigin.value = 'OTHER';
        if (this.inpNovelOriginCustom) {
          this.inpNovelOriginCustom.value = matchedOrigin;
          this.inpNovelOriginCustom.classList.remove('hidden');
        }
      }
    }
    this.syncCoverUI(meta.cover || '');

    // Apply genres
    this.selectedGenres.clear();
    const genres = meta.genres_fr || meta.genres || [];
    genres.forEach(g => this.selectedGenres.add(g));

    document.querySelectorAll('#contribGenreChipsSelector .genre-chip').forEach(chip => {
      const g = chip.getAttribute('data-genre');
      if (this.selectedGenres.has(g)) {
        chip.classList.add('selected');
      } else {
        chip.classList.remove('selected');
      }
    });
    this.updateGenresField();

    // Apply tags
    if (meta.tags && Array.isArray(meta.tags) && this.inpTags) {
      this.inpTags.value = meta.tags.join(', ');
    }

    this.updateLivePreview();
    alert('Informations appliquées avec succès ! Vous pouvez les ajuster avant d\'enregistrer.');
    if (this.novelForm) this.novelForm.scrollIntoView({ behavior: 'smooth' });
  }

  updateGenresField() {
    if (this.inpGenres) {
      this.inpGenres.value = Array.from(this.selectedGenres).join(', ');
    }
  }

  updateLivePreview() {
    const title = this.inpTitle?.value.trim() || 'Titre du roman';
    const author = this.inpAuthor?.value.trim() || 'Auteur inconnu';
    const cover = this.inpCoverUrl?.value.trim() || '/icons/icon-512x512.png';

    if (this.previewTitle) this.previewTitle.textContent = title;
    if (this.previewAuthor) this.previewAuthor.textContent = author;
    if (this.previewCover) this.previewCover.src = cover;

    if (this.previewGenres) {
      this.previewGenres.innerHTML = Array.from(this.selectedGenres).slice(0, 4).map(g => `
        <span class="tag-chip">${g}</span>
      `).join('');
    }
  }

  async toggleFeatured(novelId) {
    try {
      const auth = window.authManager || window.supabaseAuthManager;
      const token = auth ? await auth.getAccessToken() : null;
      const res = await fetch(`/api/catalog/series/${encodeURIComponent(novelId)}/toggle-featured`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      const data = await res.json();
      if (data.success) {
        if (window.toastManager && typeof window.toastManager.show === 'function') {
          window.toastManager.show(data.featured ? '⭐ Roman mis à la une sur le slider !' : 'Roman retiré de la une', 'success');
        }
        await this.loadMyNovels();
        // Si la vitrine d'accueil est chargée, rafraîchir le hero
        if (window.HomeLnoriManager && typeof window.HomeLnoriManager.loadHeroData === 'function') {
          window.HomeLnoriManager.loadHeroData();
        }
      } else {
        alert(data.message || 'Erreur lors de la mise à la une');
      }
    } catch (e) {
      console.error('Erreur toggleFeatured:', e);
    }
  }

  async loadMyNovels() {
    try {
      const auth = window.authManager || window.supabaseAuthManager;
      if (!auth || !auth.isContributor()) {
        this.novels = [];
        this.myNovels = [];
        return;
      }
      const token = auth ? await auth.getAccessToken() : null;
      if (!token) {
        // Guest mode: no request needed until user logs in
        this.novels = [];
        this.myNovels = [];
        this.updateStats();
        this.renderNovelsList();
        return;
      }
      const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
      const res = await fetch('/api/contributor/novels', { headers });
      if (!res.ok) throw new Error('Erreur chargement romans');
      const data = await res.json();
      this.novels = data.novels || [];
      this.myNovels = this.novels;
      this.updateStats();
      this.renderNovelsList();
    } catch (err) {
      console.error('[ContributorManager] Erreur loadMyNovels:', err);
    }
  }

  updateStats() {
    const total = this.novels.length;
    const drafts = this.novels.filter(n => (n.publication_status || 'DRAFT').toUpperCase() === 'DRAFT').length;
    const pending = this.novels.filter(n => (n.publication_status || '').toUpperCase() === 'PENDING_REVIEW').length;
    const published = this.novels.filter(n => (n.publication_status || '').toUpperCase() === 'PUBLISHED').length;

    const elTotal = document.getElementById('contribStatTotal');
    const elDrafts = document.getElementById('contribStatDrafts');
    const elPending = document.getElementById('contribStatPending');
    const elPublished = document.getElementById('contribStatPublished');

    if (elTotal) elTotal.textContent = total;
    if (elDrafts) elDrafts.textContent = drafts;
    if (elPending) elPending.textContent = pending;
    if (elPublished) elPublished.textContent = published;

    const recentContainer = document.getElementById('contribRecentList');
    if (recentContainer) {
      if (this.novels.length === 0) {
        recentContainer.innerHTML = `
          <div class="contrib-empty-state">
            <i class="fa-solid fa-feather"></i>
            <p>Vous n'avez pas encore créé de roman. Commencez dès aujourd'hui !</p>
            <button class="btn-contrib-primary" onclick="window.contributorManager.openCreateForm()">
              <i class="fa-solid fa-plus"></i> Créer mon premier Roman
            </button>
          </div>`;
      } else {
        const recents = [...this.novels].reverse().slice(0, 4);
        recentContainer.innerHTML = recents.map(n => this.renderNovelRow(n)).join('');
      }
    }
  }

  renderNovelsList() {
    const listContainer = document.getElementById('contribNovelsListGrid');
    if (!listContainer) return;

    let filtered = [...this.novels];
    const q = (this.searchInp?.value || '').trim().toLowerCase();
    const st = (this.statusFilter?.value || 'ALL').toUpperCase();

    if (q) {
      filtered = filtered.filter(n => 
        (n.title || '').toLowerCase().includes(q) ||
        (n.author || '').toLowerCase().includes(q)
      );
    }

    if (st !== 'ALL') {
      filtered = filtered.filter(n => (n.publication_status || 'DRAFT').toUpperCase() === st);
    }

    if (filtered.length === 0) {
      listContainer.innerHTML = `
        <div class="contrib-empty-state full-width">
          <i class="fa-solid fa-folder-open"></i>
          <p>Aucun roman ne correspond à votre recherche.</p>
        </div>`;
      return;
    }

    listContainer.innerHTML = filtered.map(novel => {
      const status = (novel.publication_status || 'DRAFT').toUpperCase();
      const isRejected = (status === 'DRAFT' && Boolean(novel.rejection_reason && novel.rejection_reason.trim()));

      let badgeClass = 'badge-draft';
      let badgeText = 'Brouillon';
      if (isRejected) {
        badgeClass = 'badge-rejected';
        badgeText = 'Rejeté (À corriger)';
      } else if (status === 'PENDING_REVIEW') {
        badgeClass = 'badge-pending';
        badgeText = 'En attente de validation';
      } else if (status === 'PUBLISHED') {
        badgeClass = 'badge-published';
        badgeText = 'Publié';
      } else if (status === 'ARCHIVED') {
        badgeClass = 'badge-archived';
        badgeText = 'Archivé';
      }

      const cover = novel.cover || novel.cover_url || '/icons/icon-512x512.png';
      const volCount = novel.volumes ? novel.volumes.length : (novel.volume_count || 0);
      const safeReason = (novel.rejection_reason || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      return `
        <div class="contrib-novel-card ${isRejected ? 'is-rejected-card' : ''}">
          <div class="contrib-card-cover-wrap">
            <img src="${cover}" alt="${novel.title}" class="contrib-card-cover" onerror="this.src='/icons/icon-512x512.png'">
            <span class="contrib-status-badge ${badgeClass}">${badgeText}</span>
          </div>
          <div class="contrib-card-body">
            <h4 class="contrib-card-title" title="${novel.title}">${novel.title}</h4>
            <p class="contrib-card-author"><i class="fa-solid fa-pen-nib"></i> ${novel.author || 'Auteur inconnu'}</p>
            <div class="contrib-card-meta">
              <span><i class="fa-solid fa-book"></i> ${volCount} Tome${volCount > 1 ? 's' : ''}</span>
              <span><i class="fa-solid fa-calendar"></i> ${new Date(novel.created_at || Date.now()).toLocaleDateString('fr-FR')}</span>
            </div>

            ${isRejected ? `
              <div class="contrib-rejection-box">
                <div class="contrib-rejection-title">
                  <i class="fa-solid fa-triangle-exclamation"></i>
                  <span>Motif du rejet par la modération :</span>
                </div>
                <div class="contrib-rejection-msg">"${safeReason}"</div>
                <div class="contrib-rejection-hint">
                  <i class="fa-solid fa-lightbulb"></i> Modifiez la fiche ou les tomes, puis cliquez sur <b>Re-soumettre</b>.
                </div>
              </div>
            ` : ''}
            
            <div class="contrib-card-actions">
              <button type="button" class="btn-contrib-action" onclick="window.contributorManager.openEditForm('${novel.id}')" title="Modifier la fiche">
                <i class="fa-solid fa-edit"></i> Modifier
              </button>
              <button type="button" class="btn-contrib-action" onclick="window.contributorManager.openVolumesModal('${novel.id}')" title="Gérer les tomes">
                <i class="fa-solid fa-boxes-stacked"></i> Volumes
              </button>

              ${status === 'DRAFT' ? (
                isRejected ? `
                  <button type="button" class="btn-contrib-action primary btn-resubmit-accent" onclick="window.contributorManager.submitForReview('${novel.id}')" title="Re-soumettre pour validation">
                    <i class="fa-solid fa-rotate-right"></i> Re-soumettre
                  </button>
                ` : `
                  <button type="button" class="btn-contrib-action primary" onclick="window.contributorManager.submitForReview('${novel.id}')" title="Soumettre pour validation">
                    <i class="fa-solid fa-paper-plane"></i> Soumettre
                  </button>
                `
              ) : ''}

              <button type="button" class="btn-contrib-action danger" onclick="window.contributorManager.deleteNovel('${novel.id}')" title="Supprimer ce roman">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  renderNovelRow(novel) {
    const status = (novel.publication_status || 'DRAFT').toUpperCase();
    const isRejected = (status === 'DRAFT' && Boolean(novel.rejection_reason && novel.rejection_reason.trim()));
    let badgeClass = 'badge-draft';
    let badgeText = 'Brouillon';
    if (isRejected) {
      badgeClass = 'badge-rejected';
      badgeText = 'Rejeté';
    } else if (status === 'PENDING_REVIEW') {
      badgeClass = 'badge-pending';
      badgeText = 'En attente';
    } else if (status === 'PUBLISHED') {
      badgeClass = 'badge-published';
      badgeText = 'Publié';
    }

    return `
      <div class="contrib-recent-row">
        <div class="contrib-row-info">
          <strong>${novel.title}</strong>
          <span>${novel.author || 'Auteur non précisé'} &bull; ${new Date(novel.created_at || Date.now()).toLocaleDateString('fr-FR')}</span>
        </div>
        <div class="contrib-row-meta">
          <span class="contrib-status-badge ${badgeClass}">${badgeText}</span>
          <button type="button" class="btn-contrib-mini" onclick="window.contributorManager.openEditForm('${novel.id}')" title="Modifier">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button type="button" class="btn-contrib-mini danger" onclick="window.contributorManager.deleteNovel('${novel.id}')" title="Supprimer">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }

  openCreateForm() {
    this.currentEditingNovelId = null;
    this.selectedGenres.clear();
    document.querySelectorAll('#contribGenreChipsSelector .genre-chip').forEach(c => c.classList.remove('selected'));
    
    if (this.novelFormTitle) this.novelFormTitle.textContent = "Créer une nouvelle fiche de Light Novel";
    if (this.novelSubmitBtn) this.novelSubmitBtn.innerHTML = '<i class="fa-solid fa-save"></i> Enregistrer le Roman';
    if (this.novelForm) this.novelForm.reset();
    if (this.inpNovelOrigin) this.inpNovelOrigin.value = 'Japon (Light Novel)';
    if (this.inpNovelOriginCustom) {
      this.inpNovelOriginCustom.value = '';
      this.inpNovelOriginCustom.classList.add('hidden');
    }
    if (this.apiResultCard) this.apiResultCard.classList.add('hidden');
    const candContainer = document.getElementById('contribApiCandidatesContainer');
    if (candContainer) candContainer.classList.add('hidden');
    if (this.inpApiSearch) this.inpApiSearch.value = '';

    if (this.inpNovelUnitType) this.inpNovelUnitType.value = 'volume';
    if (this.inpNovelOrigin) this.inpNovelOrigin.value = 'Japon (Light Novel)';
    if (this.candidatesSection) this.candidatesSection.classList.add('hidden');
    if (this.inpNovelAllowDownload) this.inpNovelAllowDownload.checked = true;
    this.syncCoverUI('');
    this.switchMode('auto');
    this.showView('form');
    this.updateLivePreview();
  }

  openEditForm(novelId) {
    const novel = (this.novels || []).find(n => n.id === novelId);
    if (!novel) return;

    this.currentEditingNovelId = novelId;
    if (this.novelFormTitle) this.novelFormTitle.textContent = `Modifier : ${novel.title}`;
    if (this.novelSubmitBtn) this.novelSubmitBtn.innerHTML = '<i class="fa-solid fa-check"></i> Mettre à jour la fiche';

    if (this.inpTitle) this.inpTitle.value = novel.title || '';
    if (this.inpRomaji) this.inpRomaji.value = novel.title_romaji || novel.originalTitle || '';
    if (this.inpAuthor) this.inpAuthor.value = novel.author || '';
    if (this.inpIllustrator) this.inpIllustrator.value = novel.illustrator || '';
    if (this.inpSynopsis) this.inpSynopsis.value = novel.synopsis_fr || novel.synopsis || novel.description || '';
    if (this.inpCoverUrl) this.inpCoverUrl.value = novel.cover || novel.cover_url || '';
    this.syncCoverUI(novel.cover || novel.cover_url || '');
    if (this.inpStatus) this.inpStatus.value = novel.publication_status || 'DRAFT';
    if (this.inpNovelUnitType) this.inpNovelUnitType.value = novel.unit_type || 'volume';
    if (this.inpNovelOrigin) {
      const orig = novel.origin || 'Japon (Light Novel)';
      const hasOption = Array.from(this.inpNovelOrigin.options).some(o => o.value === orig);
      if (hasOption) {
        this.inpNovelOrigin.value = orig;
        if (this.inpNovelOriginCustom) this.inpNovelOriginCustom.classList.add('hidden');
      } else {
        this.inpNovelOrigin.value = 'OTHER';
        if (this.inpNovelOriginCustom) {
          this.inpNovelOriginCustom.value = orig;
          this.inpNovelOriginCustom.classList.remove('hidden');
        }
      }
    }
    if (this.candidatesSection) this.candidatesSection.classList.add('hidden');
    if (this.inpNovelAllowDownload) this.inpNovelAllowDownload.checked = (novel.allow_download !== false);

    this.selectedGenres.clear();
    const gList = Array.isArray(novel.genres_fr) ? novel.genres_fr : (Array.isArray(novel.genres) ? novel.genres : (novel.genres || '').split(',').map(s => s.trim()));
    gList.forEach(g => { if (g) this.selectedGenres.add(g); });

    document.querySelectorAll('#contribGenreChipsSelector .genre-chip').forEach(chip => {
      if (this.selectedGenres.has(chip.getAttribute('data-genre'))) {
        chip.classList.add('selected');
      } else {
        chip.classList.remove('selected');
      }
    });
    this.updateGenresField();

    if (this.inpTags) {
      this.inpTags.value = Array.isArray(novel.tags) ? novel.tags.join(', ') : (novel.tags || '');
    }

    this.switchMode('manual');
    this.showView('form');
    this.updateLivePreview();
  }

  async handleNovelSubmit(e) {
    e.preventDefault();
    const title = this.inpTitle?.value.trim();
    if (!title) {
      alert('Veuillez renseigner au minimum le titre du roman.');
      return;
    }

    const author = this.inpAuthor?.value.trim();
    if (!author) {
      alert('Veuillez renseigner le nom de l\'auteur.');
      return;
    }

    if (this.isSubmittingNovel) return;
    this.isSubmittingNovel = true;
    const submitBtn = this.novelSubmitBtn;
    const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enregistrement en cours...';
    }

    const payload = {
      title,
      title_romaji: this.inpRomaji?.value.trim() || '',
      author,
      illustrator: this.inpIllustrator?.value.trim() || '',
      synopsis: this.inpSynopsis?.value.trim() || '',
      cover: this.inpCoverUrl?.value.trim() || '',
      genres: Array.from(this.selectedGenres),
      tags: (this.inpTags?.value || '').split(',').map(s => s.trim()).filter(Boolean),
      publication_status: this.inpStatus?.value || 'DRAFT',
      unit_type: this.inpNovelUnitType?.value || 'volume',
      origin: (function(self) {
        let val = self.inpNovelOrigin?.value || 'Japon (Light Novel)';
        if (val === 'OTHER') {
          return self.inpNovelOriginCustom?.value.trim() || 'Autre';
        }
        return val;
      })(this),
      allow_download: this.inpNovelAllowDownload ? this.inpNovelAllowDownload.checked : true
    };

    try {
      const headers = await this.getHeaders();
      let res;
      if (this.currentEditingNovelId) {
        res = await fetch(`/api/contributor/novels/${this.currentEditingNovelId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(payload)
        });
      } else {
        res = await fetch('/api/contributor/novels', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
      }

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Erreur lors de l\'enregistrement du roman.');
      }

      // Live sync catalog & home
      if (window.HomeLnoriManager && typeof window.HomeLnoriManager.reloadAllData === 'function') {
        window.HomeLnoriManager.reloadAllData();
      }
      if (typeof window.reloadCatalog === 'function') {
        window.reloadCatalog();
      }
      alert(this.currentEditingNovelId ? 'Roman mis à jour avec succès !' : 'Roman créé avec succès !');
      await this.loadMyNovels();
      this.showView('novels');
    } catch (err) {
      console.error('[ContributorManager] Erreur sauvegarde:', err);
      alert(`Erreur : ${err.message}`);
    } finally {
      this.isSubmittingNovel = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHtml;
      }
    }
  }

  async submitForReview(novelId) {
    if (!confirm('Souhaitez-vous soumettre ce roman pour validation par l\'équipe de modération ?')) {
      return;
    }

    try {
      const headers = await this.getHeaders();
      const res = await fetch(`/api/contributor/novels/${novelId}/submit`, {
        method: 'POST',
        headers
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Erreur lors de la soumission.');
      }

      alert('Roman soumis avec succès pour validation !');
      await this.loadMyNovels();
      this.renderNovelsList();
    } catch (err) {
      console.error('[ContributorManager] Erreur soumission:', err);
      alert(`Erreur : ${err.message}`);
    }
  }

  async deleteNovel(novelId) {
    const novel = (this.novels || []).find(n => n.id === novelId);
    const title = novel ? novel.title : 'ce roman';
    if (!confirm(`Êtes-vous sûr de vouloir supprimer définitivement "${title}" ?\nCette action supprimera également tous ses tomes et fichiers associés.`)) {
      return;
    }

    try {
      const headers = await this.getHeaders();
      const res = await fetch(`/api/contributor/novels/${novelId}`, {
        method: 'DELETE',
        headers
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Erreur lors de la suppression du roman.');
      }

      // Live sync catalog & home
      if (window.HomeLnoriManager && typeof window.HomeLnoriManager.reloadAllData === 'function') {
        window.HomeLnoriManager.reloadAllData();
      }
      if (typeof window.reloadCatalog === 'function') {
        window.reloadCatalog();
      }

      alert('Le roman a été supprimé avec succès.');
      await this.loadMyNovels();
    } catch (err) {
      console.error('[ContributorManager] Erreur suppression:', err);
      alert(`Erreur : ${err.message}`);
    }
  }


  openVolumesModal(novelId) {
    const list = this.novels || this.myNovels || [];
    const novel = list.find(n => n.id === novelId);
    if (!novel) return;

    this.selectedNovelForVolumes = novel;
    this.currentUnitType = (novel.unit_type === 'chapter') ? 'chapter' : 'volume';
    this.updateUnitTypeLabels(this.currentUnitType);
    this.updateUnitToggleButtons(this.currentUnitType);
    this.updateDownloadToggleUI(novel.allow_download !== false);
    
    // Update headers and novel banner
    const titleEl = document.getElementById('volSectionNovelTitle') || document.getElementById('volModalNovelTitle');
    if (titleEl) titleEl.textContent = novel.title || 'Sans titre';

    const authorEl = document.getElementById('volSectionNovelAuthor');
    if (authorEl) authorEl.innerHTML = `<i class="fa-solid fa-pen-nib"></i> ${novel.author || 'Inconnu'}`;

    const coverEl = document.getElementById('volSectionNovelCover');
    if (coverEl) {
      if (novel.cover_url) {
        coverEl.src = novel.cover_url;
        coverEl.classList.remove('hidden');
      } else {
        coverEl.classList.add('hidden');
      }
    }

    const statusEl = document.getElementById('volSectionNovelStatus');
    if (statusEl) {
      statusEl.textContent = novel.publication_status || 'DRAFT';
      statusEl.className = `status-badge ${(novel.publication_status || 'DRAFT').toLowerCase()}`;
    }

    this.resetVolumeFilePicker();
    if (this.volForm) this.volForm.reset();

    // Auto calculate next volume number
    const vols = novel.volumes || [];
    const maxNum = vols.reduce((max, v) => Math.max(max, v.volume_number || v.number || 0), 0);
    if (this.inpVolNumber) this.inpVolNumber.value = maxNum + 1;

    // Set today date
    const releaseDateInp = document.getElementById('contribVolReleaseDate');
    if (releaseDateInp) releaseDateInp.value = new Date().toISOString().split('T')[0];

    this.renderVolumesListModal();

    // Switch to dedicated non-modal full section view
    this.showView('volumes');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Alias
  updateDownloadToggleUI(isAllowed) {
    if (this.btnToggleNovelDownload && this.labelToggleNovelDownload) {
      if (isAllowed) {
        this.btnToggleNovelDownload.style.background = 'rgba(16, 185, 129, 0.15)';
        this.btnToggleNovelDownload.style.color = '#34d399';
        this.btnToggleNovelDownload.style.borderColor = 'rgba(16, 185, 129, 0.35)';
        this.labelToggleNovelDownload.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Téléchargement public : Actif';
        this.btnToggleNovelDownload.title = "Le public peut télécharger les fichiers. Cliquez pour restreindre à la lecture en ligne seule.";
      } else {
        this.btnToggleNovelDownload.style.background = 'rgba(239, 68, 68, 0.2)';
        this.btnToggleNovelDownload.style.color = '#fca5a5';
        this.btnToggleNovelDownload.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        this.labelToggleNovelDownload.innerHTML = '<i class="fa-solid fa-lock"></i> Lecture en ligne exclusive';
        this.btnToggleNovelDownload.title = "Le téléchargement est désactivé pour le public. Cliquez pour autoriser le téléchargement.";
      }
    }
  }

  async toggleNovelDownloadPermission() {
    if (!this.selectedNovelForVolumes) return;
    const current = (this.selectedNovelForVolumes.allow_download !== false);
    const nextVal = !current;

    this.selectedNovelForVolumes.allow_download = nextVal;
    this.updateDownloadToggleUI(nextVal);

    // Sync local list
    const list = this.novels || this.myNovels || [];
    const item = list.find(n => n.id === this.selectedNovelForVolumes.id);
    if (item) item.allow_download = nextVal;

    try {
      const headers = await this.getHeaders();
      const res = await fetch(`/api/contributor/novels/${this.selectedNovelForVolumes.id}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ allow_download: nextVal })
      });
      const data = await res.json();
      if (data && data.success) {
        console.log('[ContributorManager] allow_download sauvegardé:', nextVal);
      }
    } catch (err) {
      console.warn('[ContributorManager] Erreur sauvegarde allow_download:', err);
    }
  }

  openManageVolumes(novelId) {
    this.openVolumesModal(novelId);
  }

  updateUnitToggleButtons(unitType) {
    if (this.btnUnitModeVolume) {
      this.btnUnitModeVolume.classList.toggle('active', unitType === 'volume');
    }
    if (this.btnUnitModeChapter) {
      this.btnUnitModeChapter.classList.toggle('active', unitType === 'chapter');
    }
  }

  updateUnitTypeLabels(unitType) {
    const isChap = unitType === 'chapter';

    if (this.volFormColTitle) {
      this.volFormColTitle.textContent = isChap ? 'Importer un Chapitre' : 'Importer un Tome';
    }
    if (this.volFormColDesc) {
      this.volFormColDesc.textContent = isChap ? 'Téléversez le fichier de votre chapitre et renseignez ses détails.' : 'Téléversez le fichier de votre tome et renseignez ses détails.';
    }
    if (this.volDropzoneMainPrompt) {
      this.volDropzoneMainPrompt.textContent = isChap ? 'Glissez-déposez le fichier du chapitre (.epub ou .pdf)' : 'Glissez-déposez le fichier du tome (.epub ou .pdf)';
    }
    if (this.volTypeSelectLabel) {
      this.volTypeSelectLabel.textContent = isChap ? 'Type de Récit / Chapitre' : 'Type de Récit / Volume';
    }
    if (this.volNumberInputLabel) {
      this.volNumberInputLabel.textContent = isChap ? 'Numéro du Chapitre *' : 'Numéro du Tome *';
    }
    if (this.inpVolNumber) {
      this.inpVolNumber.placeholder = isChap ? '1' : '1';
    }
    if (this.volTitleInputLabel) {
      this.volTitleInputLabel.textContent = isChap ? 'Titre du Chapitre (Optionnel)' : 'Titre du Tome (Optionnel)';
    }
    if (this.inpVolTitle) {
      this.inpVolTitle.placeholder = isChap ? "Ex: Chapitre 1 - Le commencement..." : "Ex: L'Éveil des Ombres, Tome 1...";
    }
    if (this.btnSubmitVolumeText) {
      this.btnSubmitVolumeText.textContent = isChap ? 'Téléverser & Ajouter ce Chapitre' : 'Téléverser & Ajouter ce Tome';
    }
    if (this.volListColHeader) {
      this.volListColHeader.textContent = isChap ? 'Chapitres de la Série' : 'Tomes de la Série';
    }
  }

  async switchUnitType(unitType, saveToBackend = false) {
    this.currentUnitType = unitType;
    this.updateUnitToggleButtons(unitType);
    this.updateUnitTypeLabels(unitType);

    if (this.selectedNovelForVolumes) {
      this.selectedNovelForVolumes.unit_type = unitType;
      
      // Sync in local lists
      const list = this.novels || this.myNovels || [];
      const item = list.find(n => n.id === this.selectedNovelForVolumes.id);
      if (item) item.unit_type = unitType;
    }

    this.renderVolumesListModal();

    if (saveToBackend && this.selectedNovelForVolumes) {
      try {
        const headers = await this.getHeaders();
        const res = await fetch(`/api/contributor/novels/${this.selectedNovelForVolumes.id}`, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ unit_type: unitType })
        });
        const data = await res.json();
        if (data && data.success) {
          console.log('[ContributorManager] Format de découpage enregistré sur le serveur:', unitType);
        }
      } catch (err) {
        console.warn('[ContributorManager] Erreur synchronisation unit_type:', err);
      }
    }
  }


  renderVolumesListModal() {
    if (!this.volListContainer || !this.selectedNovelForVolumes) return;
    const volumes = this.selectedNovelForVolumes.volumes || [];
    const isChap = this.currentUnitType === 'chapter';
    const unitWord = isChap ? 'chapitre' : 'tome';

    const badgeCount = document.getElementById('volModalCountBadge');
    if (badgeCount) badgeCount.textContent = `${volumes.length} ${unitWord}${volumes.length > 1 ? 's' : ''}`;
    const badgeSection = document.getElementById('volSectionCountBadge');
    if (badgeSection) badgeSection.textContent = `${volumes.length} ${unitWord}${volumes.length > 1 ? 's' : ''}`;

    if (volumes.length === 0) {
      this.volListContainer.innerHTML = `
        <div class="vol-empty-state">
          <div class="vol-empty-icon"><i class="fa-solid fa-box-open"></i></div>
          <h5>Aucun ${unitWord} téléversé</h5>
          <p>Utilisez le panneau de gauche pour ajouter le premier ${unitWord} (.epub ou .pdf) de ce roman.</p>
        </div>
      `;
      return;
    }

    this.volListContainer.innerHTML = volumes.map(v => {
      const volNum = v.volume_number || v.number || 1;
      const fileType = (v.file_type || (v.file_name ? v.file_name.split('.').pop() : 'EPUB')).toUpperCase();
      const fileSize = v.file_size ? `${(v.file_size / (1024 * 1024)).toFixed(1)} Mo` : '';
      const releaseDate = v.release_date ? new Date(v.release_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
      
      let displayTitle = v.title;
      if (!displayTitle) {
        displayTitle = isChap ? `Chapitre ${volNum}` : `Volume ${volNum}`;
      } else if (isChap && /^volume\s+/i.test(displayTitle.trim())) {
        displayTitle = displayTitle.trim().replace(/^volume\s+/i, 'Chapitre ');
      }

      const badgeLabel = isChap ? `CHAPITRE ${String(volNum).padStart(2, '0')}` : `TOME ${String(volNum).padStart(2, '0')}`;
      const badgeClass = isChap ? 'vol-badge-number chapter-badge' : 'vol-badge-number';
      const fileDownloadName = v.file_name || (isChap ? `Chapitre_${volNum}.${fileType.toLowerCase()}` : `Tome_${volNum}.${fileType.toLowerCase()}`);
      const deleteTitle = isChap ? 'Supprimer ce chapitre' : 'Supprimer ce tome';

      return `
        <div class="vol-card-item">
          <div class="vol-card-main">
            <div class="${badgeClass}">${badgeLabel}</div>
            <div class="vol-info-wrap">
              <div class="vol-title-text">${displayTitle}</div>
              <div class="vol-meta-tags">
                <span class="vol-pill-type ${fileType.toLowerCase()}"><i class="fa-solid ${fileType === 'PDF' ? 'fa-file-pdf' : 'fa-book'}"></i> ${fileType}</span>
                ${fileSize ? `<span class="vol-meta-item"><i class="fa-solid fa-hard-drive"></i> ${fileSize}</span>` : ''}
                ${releaseDate ? `<span class="vol-meta-item"><i class="fa-solid fa-calendar"></i> ${releaseDate}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="vol-card-actions">
            ${v.file_path ? `
              <a href="${v.file_path}" download="${fileDownloadName}" class="btn-vol-download" title="Télécharger le fichier">
                <i class="fa-solid fa-download"></i>
              </a>
            ` : ''}
            <button type="button" class="btn-vol-delete" onclick="window.contributorManager.handleDeleteVolume('${this.selectedNovelForVolumes.id}', ${volNum})" title="${deleteTitle}">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  async handleDeleteVolume(novelId, volNum) {
    const isChap = this.currentUnitType === 'chapter';
    const unitWord = isChap ? 'Chapitre' : 'Tome';
    if (!confirm(`Êtes-vous sûr de vouloir supprimer définitivement le ${unitWord} ${volNum} ?`)) {
      return;
    }

    try {
      const headers = await this.getHeaders();
      const res = await fetch(`/api/contributor/novels/${novelId}/volumes/${volNum}`, {
        method: 'DELETE',
        headers
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Erreur lors de la suppression du volume.');
      }

      if (this.selectedNovelForVolumes) {
        this.selectedNovelForVolumes.volumes = data.volumes || [];
        this.selectedNovelForVolumes.volume_count = this.selectedNovelForVolumes.volumes.length;
      }

      this.renderVolumesListModal();
      this.loadMyNovels();
    } catch (err) {
      console.error('[ContributorManager] Erreur suppression volume:', err);
      alert(`Erreur: ${err.message}`);
    }
  }

  async handleVolumeSubmit(e) {
    e.preventDefault();
    if (!this.selectedNovelForVolumes) return;

    const volume_number = parseFloat(this.inpVolNumber?.value || '1');
    const volume_type = document.getElementById('contribVolType')?.value || 'main';
    const volume_group = document.getElementById('contribVolGroup')?.value.trim() || '';
    const isChap = this.currentUnitType === 'chapter';
    const defaultPrefix = isChap ? 'Chapitre' : 'Volume';
    const title = this.inpVolTitle?.value.trim() || (volume_type === 'spinoff' ? (volume_group ? `${volume_group} - ${defaultPrefix} ${volume_number}` : `Spin-off ${defaultPrefix} ${volume_number}`) : `${defaultPrefix} ${volume_number}`);
    const release_date = document.getElementById('contribVolReleaseDate')?.value;

    const btnSubmit = document.getElementById('btnSubmitVolume');
    const progress = document.getElementById('volUploadProgress');
    const progressBar = document.getElementById('volProgressBarFill');
    const progressText = document.getElementById('volProgressText');

    try {
      if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Téléversement en cours...';
      }
      if (progress) progress.classList.remove('hidden');
      if (progressBar) progressBar.style.width = '40%';
      if (progressText) progressText.textContent = 'Téléversement du fichier sur le serveur...';

      const formData = new FormData();
      formData.append('volume_number', volume_number);
      formData.append('title', title);
      formData.append('volume_type', volume_type);
      if (volume_group) formData.append('volume_group', volume_group);
      if (release_date) formData.append('release_date', release_date);

      if (this.selectedVolumeFile) {
        formData.append('file', this.selectedVolumeFile);
      }

      if (progressBar) progressBar.style.width = '75%';

      const auth = window.authManager || window.supabaseAuthManager;
      const token = auth ? await auth.getAccessToken() : null;
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/contributor/novels/${this.selectedNovelForVolumes.id}/volumes`, {
        method: 'POST',
        headers,
        body: formData
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Erreur lors de l\'ajout du volume.');
      }

      if (progressBar) progressBar.style.width = '100%';
      if (progressText) progressText.textContent = 'Volume importé avec succès !';

      if (!this.selectedNovelForVolumes.volumes) this.selectedNovelForVolumes.volumes = [];
      this.selectedNovelForVolumes.volumes = data.volumes || this.selectedNovelForVolumes.volumes;
      this.selectedNovelForVolumes.volume_count = this.selectedNovelForVolumes.volumes.length;

      setTimeout(() => {
        this.resetVolumeFilePicker();
        if (this.volForm) this.volForm.reset();
        
        // Auto increment for next volume
        const vols = this.selectedNovelForVolumes.volumes;
        const maxNum = vols.reduce((max, v) => Math.max(max, v.volume_number || v.number || 0), 0);
        if (this.inpVolNumber) this.inpVolNumber.value = maxNum + 1;
        
        const releaseDateInp = document.getElementById('contribVolReleaseDate');
        if (releaseDateInp) releaseDateInp.value = new Date().toISOString().split('T')[0];

        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.innerHTML = isChap ? '<i class="fa-solid fa-cloud-arrow-up"></i> Téléverser & Ajouter ce Chapitre' : '<i class="fa-solid fa-cloud-arrow-up"></i> Téléverser & Ajouter ce Tome';
        }
        if (progress) progress.classList.add('hidden');

        this.renderVolumesListModal();
        this.loadMyNovels();
      }, 500);

    } catch (err) {
      console.error('[ContributorManager] Erreur volume:', err);
      alert(`Erreur: ${err.message}`);
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Téléverser & Ajouter ce Tome';
      }
      if (progress) progress.classList.add('hidden');
    }
  }

  // ==========================================================================
  // MULTIFUNCTIONAL COVER UPLOAD MANAGER (LOCAL FILE + WEB URL)
  // ==========================================================================
  setupCoverUpload() {
    if (this.btnCoverPillFile && this.btnCoverPillUrl) {
      this.btnCoverPillFile.addEventListener('click', () => this.switchCoverMode('file'));
      this.btnCoverPillUrl.addEventListener('click', () => this.switchCoverMode('url'));
    }

    if (this.btnBrowseCover && this.fileInputCover) {
      this.btnBrowseCover.addEventListener('click', (e) => {
        e.stopPropagation();
        this.fileInputCover.click();
      });
    }

    if (this.dropzoneCover && this.fileInputCover) {
      this.dropzoneCover.addEventListener('click', (e) => {
        if (e.target === this.fileInputCover) return;
        if (e.target.closest('#btnChangeCover') || e.target.closest('#btnDeleteCover')) return;
        this.fileInputCover.click();
      });

      ['dragenter', 'dragover'].forEach(evtName => {
        this.dropzoneCover.addEventListener(evtName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.dropzoneCover.classList.add('dragover');
        });
      });

      ['dragleave', 'drop'].forEach(evtName => {
        this.dropzoneCover.addEventListener(evtName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.dropzoneCover.classList.remove('dragover');
        });
      });

      this.dropzoneCover.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt && dt.files;
        if (files && files.length > 0) {
          this.handleCoverFile(files[0]);
        }
      });

      this.fileInputCover.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.handleCoverFile(e.target.files[0]);
        }
      });
    }

    if (this.btnChangeCover && this.fileInputCover) {
      this.btnChangeCover.addEventListener('click', (e) => {
        e.stopPropagation();
        this.fileInputCover.click();
      });
    }

    if (this.btnDeleteCover) {
      this.btnDeleteCover.addEventListener('click', (e) => {
        e.stopPropagation();
        this.clearCoverSelection();
      });
    }

    if (this.coverDirectUrlInput) {
      const syncFromUrlInput = () => {
        const val = this.coverDirectUrlInput.value.trim();
        if (this.inpCoverUrl) this.inpCoverUrl.value = val;
        this.updateLivePreview();
      };
      this.coverDirectUrlInput.addEventListener('input', syncFromUrlInput);
      this.coverDirectUrlInput.addEventListener('change', syncFromUrlInput);
    }
  }

  switchCoverMode(mode) {
    if (mode === 'file') {
      if (this.btnCoverPillFile) this.btnCoverPillFile.classList.add('active');
      if (this.btnCoverPillUrl) this.btnCoverPillUrl.classList.remove('active');
      if (this.paneCoverFile) this.paneCoverFile.classList.remove('hidden');
      if (this.paneCoverUrl) this.paneCoverUrl.classList.add('hidden');
    } else {
      if (this.btnCoverPillFile) this.btnCoverPillFile.classList.remove('active');
      if (this.btnCoverPillUrl) this.btnCoverPillUrl.classList.add('active');
      if (this.paneCoverFile) this.paneCoverFile.classList.add('hidden');
      if (this.paneCoverUrl) this.paneCoverUrl.classList.remove('hidden');
    }
  }

  async compressImage(file, maxWidth = 600, maxHeight = 900, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxWidth) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width = Math.round((width * maxHeight) / height);
              height = maxHeight;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          let mimeType = 'image/webp';
          try {
            const test = canvas.toDataURL('image/webp');
            if (!test.startsWith('data:image/webp')) {
              mimeType = 'image/jpeg';
            }
          } catch (err) {
            mimeType = 'image/jpeg';
          }

          canvas.toBlob((blob) => {
            if (blob) {
              resolve({ blob, mimeType });
            } else {
              resolve({ blob: file, mimeType: file.type });
            }
          }, mimeType, quality);
        };
        img.onerror = () => reject(new Error('Erreur de chargement de l\'image'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Erreur de lecture du fichier'));
      reader.readAsDataURL(file);
    });
  }

  async handleCoverFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      alert('Veuillez sélectionner un fichier image valide (JPG, PNG, WebP).');
      return;
    }

    try {
      if (this.coverDropEmpty) this.coverDropEmpty.classList.add('hidden');
      if (this.coverDropPreview) this.coverDropPreview.classList.add('hidden');
      if (this.coverDropLoading) this.coverDropLoading.classList.remove('hidden');

      const { blob, mimeType } = await this.compressImage(file, 600, 900, 0.85);

      const formData = new FormData();
      const ext = mimeType === 'image/webp' ? '.webp' : (mimeType === 'image/png' ? '.png' : '.jpg');
      const cleanFileName = file.name.replace(/\.[^.]+$/, '') + ext;
      formData.append('cover', blob, cleanFileName);

      const auth = window.authManager || window.supabaseAuthManager;
      const token = auth ? await auth.getAccessToken() : null;

      const res = await fetch('/api/upload/cover', {
        method: 'POST',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: formData
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Erreur lors du téléversement de la couverture.');
      }

      if (this.inpCoverUrl) this.inpCoverUrl.value = data.url;
      if (this.coverDirectUrlInput) this.coverDirectUrlInput.value = data.url;

      if (this.coverDropThumb) this.coverDropThumb.src = data.url;
      if (this.coverFileTitle) this.coverFileTitle.textContent = cleanFileName;

      if (this.coverDropLoading) this.coverDropLoading.classList.add('hidden');
      if (this.coverDropPreview) this.coverDropPreview.classList.remove('hidden');

      this.updateLivePreview();

      if (window.toastManager && typeof window.toastManager.show === 'function') {
        window.toastManager.show('Couverture téléversée et optimisée avec succès !', 'success');
      }
    } catch (err) {
      console.error('[CoverUpload]', err);
      alert('Erreur : ' + err.message);
      if (this.coverDropLoading) this.coverDropLoading.classList.add('hidden');
      if (!this.inpCoverUrl || !this.inpCoverUrl.value) {
        if (this.coverDropEmpty) this.coverDropEmpty.classList.remove('hidden');
      } else {
        if (this.coverDropPreview) this.coverDropPreview.classList.remove('hidden');
      }
    }
  }

  clearCoverSelection() {
    if (this.inpCoverUrl) this.inpCoverUrl.value = '';
    if (this.coverDirectUrlInput) this.coverDirectUrlInput.value = '';
    if (this.fileInputCover) this.fileInputCover.value = '';
    if (this.coverDropThumb) this.coverDropThumb.src = '';
    if (this.coverDropPreview) this.coverDropPreview.classList.add('hidden');
    if (this.coverDropLoading) this.coverDropLoading.classList.add('hidden');
    if (this.coverDropEmpty) this.coverDropEmpty.classList.remove('hidden');
    this.updateLivePreview();
  }

  syncCoverUI(url) {
    if (!url) {
      this.clearCoverSelection();
      this.switchCoverMode('file');
      return;
    }

    if (this.inpCoverUrl) this.inpCoverUrl.value = url;
    if (this.coverDirectUrlInput) this.coverDirectUrlInput.value = url;

    const isLocalUpload = url.startsWith('/uploads/covers/');

    if (isLocalUpload) {
      this.switchCoverMode('file');
      if (this.coverDropThumb) this.coverDropThumb.src = url;
      if (this.coverFileTitle) this.coverFileTitle.textContent = url.split('/').pop();
      if (this.coverDropEmpty) this.coverDropEmpty.classList.add('hidden');
      if (this.coverDropPreview) this.coverDropPreview.classList.remove('hidden');
    } else {
      this.switchCoverMode('url');
      if (this.coverDropThumb) this.coverDropThumb.src = url;
      if (this.coverFileTitle) this.coverFileTitle.textContent = 'Image distante';
      if (this.coverDropEmpty) this.coverDropEmpty.classList.add('hidden');
      if (this.coverDropPreview) this.coverDropPreview.classList.remove('hidden');
    }

    this.updateLivePreview();
  }

}

// Instanciation globale et résiliente
function initContributorStudio() {
  if (!window.contributorManager) {
    window.contributorManager = new ContributorManager();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initContributorStudio);
} else {
  initContributorStudio();
}