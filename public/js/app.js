/* ==========================================================================
   NovelTrad DeepL PDF & EPUB Translator - Client App Logic
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  let selectedFile = null;
  let translatedBlobUrl = null;
  let activeEventSource = null;

  // DOM Elements
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
  const errorBanner = document.getElementById('errorBanner');
  const errorMessage = document.getElementById('errorMessage');

  const analyzeBtn = document.getElementById('analyzeBtn');
  const simulationModal = document.getElementById('simulationModal');
  const simulationBody = document.getElementById('simulationBody');
  const cancelSimBtn = document.getElementById('cancelSimBtn');
  const confirmSimBtn = document.getElementById('confirmSimBtn');

  const statSent = document.getElementById('statSent');
  const statSaved = document.getElementById('statSaved');
  const statCacheEntries = document.getElementById('statCacheEntries');
  const statHitRate = document.getElementById('statHitRate');

  // Check Backend & Provider Status on Load
  checkApiStatus();
  loadDashboardStats();
  setInterval(loadDashboardStats, 10000);

  async function checkApiStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();

      if (data.nllbAvailable) {
        statusDot.className = 'status-dot green';
        statusText.textContent = '✓ NLLB Local disponible (Hors ligne)';
      } else if (data.deeplConfigured) {
        statusDot.className = 'status-dot green';
        statusText.textContent = 'DeepL API Configuré (.env)';
      } else {
        statusDot.className = 'status-dot warning';
        statusText.textContent = 'Moteur Local ou Clé API requis';
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

  // Drag and Drop Events
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

  async function loadDashboardStats() {
    try {
      const apiKey = customApiKeyInput ? customApiKeyInput.value.trim() : '';
      const res = await fetch(`/api/dashboard-stats?apiKey=${encodeURIComponent(apiKey)}`);
      const data = await res.json();

      if (data.quotaInfo) {
        statSent.textContent = Number(data.quotaInfo.characterCount || 0).toLocaleString();
        statSaved.textContent = Number(data.quotaInfo.charactersRemaining || 0).toLocaleString();
        statHitRate.textContent = `${data.quotaInfo.percentUsed || '0.0'} %`;
      } else if (data.stats) {
        statSent.textContent = Number(data.stats.activeJobs || 0).toLocaleString() + ' jobs';
        statSaved.textContent = Number(data.stats.cacheEntries || 0).toLocaleString();
      }
    } catch (err) {
      console.warn('Dashboard stats error:', err);
    }
  }

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

  // Mode Simulation / Analyse du document
  analyzeBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    hideError();
    const formData = new FormData();
    formData.append('document', selectedFile);
    formData.append('targetLang', targetLangSelect.value);
    formData.append('provider', providerSelect ? providerSelect.value : 'nllb');
    if (customApiKeyInput.value.trim()) {
      formData.append('apiKey', customApiKeyInput.value.trim());
    }

    try {
      const res = await fetch('/api/analyze-novel', {
        method: 'POST',
        body: formData
      });
      const sim = await res.json();

      if (sim.error) {
        throw new Error(sim.message);
      }

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

  // Exécution de la Traduction avec événements temps réel SSE (Zéro faux pourcentage)
  translateBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    hideError();
    hideResultSection();
    showProgressSection();

    translateBtn.disabled = true;
    const targetLang = targetLangSelect.value;
    const customApiKey = customApiKeyInput.value.trim();
    const provider = providerSelect ? providerSelect.value : 'nllb';
    const jobId = 'job_' + Date.now();

    const formData = new FormData();
    formData.append('document', selectedFile);
    formData.append('jobId', jobId);
    formData.append('targetLang', targetLang);
    formData.append('provider', provider);
    if (customApiKey) {
      formData.append('apiKey', customApiKey);
    }

    // Connexion SSE pour suivre la progression exacte
    connectSSE(jobId);

    try {
      const response = await fetch('/api/translate-document', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        let errText = 'Erreur lors de la traduction.';
        try {
          const errData = await response.json();
          errText = errData.message || errText;
        } catch (e) {}
        throw new Error(errText);
      }

      const blob = await response.blob();
      translatedBlobUrl = URL.createObjectURL(blob);

      const ext = selectedFile.name.split('.').pop().toLowerCase();
      const originalName = selectedFile.name.replace(/\.[^/.]+$/, "");
      const outputFilename = `${originalName}_${targetLang.toLowerCase()}.${ext}`;

      downloadPdfBtn.href = translatedBlobUrl;
      downloadPdfBtn.download = outputFilename;
      downloadPdfBtn.innerHTML = `<i class="fa-solid fa-download"></i> Télécharger le document traduit (${ext.toUpperCase()})`;

      updateProgress(100, 'Traduction terminée avec succès !');
      setTimeout(() => {
        hideProgressSection();
        showResultSection();
        translateBtn.disabled = false;
      }, 600);

    } catch (err) {
      hideProgressSection();
      showError(err.message || 'Une erreur inattendue est survenue.');
      translateBtn.disabled = false;
    } finally {
      if (activeEventSource) {
        activeEventSource.close();
        activeEventSource = null;
      }
    }
  });

  // Connexion SSE (Server-Sent Events) pour la progression en temps réel
  function connectSSE(jobId) {
    if (activeEventSource) {
      activeEventSource.close();
    }

    activeEventSource = new EventSource(`/api/translation-events/${jobId}`);

    activeEventSource.onmessage = (event) => {
      try {
        const job = JSON.parse(event.data);
        if (!job) return;

        let statusText = job.statusMessage || 'Traitement en cours...';
        let percent = 0;

        if (job.phase === 'TRANSLATION' && job.totalBlocks > 0) {
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
        } else if (job.phase === 'COMPLETED') {
          percent = 100;
          statusText = 'Traduction et assemblage terminés !';
        }

        updateProgress(Math.min(100, percent), statusText);
      } catch (e) {
        console.warn('SSE Parse Error:', e);
      }
    };

    activeEventSource.onerror = () => {
      if (activeEventSource) {
        activeEventSource.close();
        activeEventSource = null;
      }
    };
  }

  function updateProgress(percent, labelText) {
    progressFill.style.width = `${percent}%`;
    progressPercent.textContent = `${percent}%`;
    if (labelText) {
      progressLabel.textContent = labelText;
      progressSubtext.textContent = labelText;
    }
  }

  function showProgressSection() {
    progressSection.classList.remove('hidden');
    updateProgress(0, 'Initialisation du traitement...');
  }

  function hideProgressSection() {
    progressSection.classList.add('hidden');
  }

  function showResultSection() {
    resultSection.classList.remove('hidden');
  }

  function hideResultSection() {
    resultSection.classList.add('hidden');
  }

  function showError(msg) {
    errorMessage.innerHTML = msg.replace(/\n/g, '<br>');
    errorBanner.classList.remove('hidden');
  }

  function hideError() {
    errorBanner.classList.add('hidden');
  }
});
