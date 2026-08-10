/* ==========================================================================
   NovelTrad DeepL PDF Translator - Client App Logic
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  let selectedFile = null;
  let translatedPdfBlobUrl = null;

  // DOM Elements
  const apiStatusBadge = document.getElementById('apiStatusBadge');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  const pdfDropzone = document.getElementById('pdfDropzone');
  const pdfFileInput = document.getElementById('pdfFileInput');
  const dropzoneEmpty = document.getElementById('dropzoneEmpty');
  const fileLoadedInfo = document.getElementById('fileLoadedInfo');
  const pdfFileName = document.getElementById('pdfFileName');
  const pdfFileSize = document.getElementById('pdfFileSize');
  const removePdfBtn = document.getElementById('removePdfBtn');

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

  // Check Backend & DeepL Status on Load
  checkApiStatus();

  async function checkApiStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();

      if (data.deeplConfigured) {
        statusDot.className = 'status-dot green';
        statusText.textContent = 'DeepL API Configuré (Clé .env)';
      } else {
        statusDot.className = 'status-dot warning';
        statusText.textContent = 'Clé DeepL requise ci-dessous';
      }
    } catch (err) {
      statusDot.className = 'status-dot warning';
      statusText.textContent = 'Serveur local prêt';
    }
  }

  // Password Visibility Toggle
  toggleApiKeyVisBtn.addEventListener('click', () => {
    const type = customApiKeyInput.type === 'password' ? 'text' : 'password';
    customApiKeyInput.type = type;
    toggleApiKeyVisBtn.querySelector('i').className = type === 'password' ? 'fa-regular fa-eye' : 'fa-regular fa-eye-slash';
  });

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

  const analyzeBtn = document.getElementById('analyzeBtn');
  const simulationModal = document.getElementById('simulationModal');
  const simulationBody = document.getElementById('simulationBody');
  const cancelSimBtn = document.getElementById('cancelSimBtn');
  const confirmSimBtn = document.getElementById('confirmSimBtn');

  const statSent = document.getElementById('statSent');
  const statSaved = document.getElementById('statSaved');
  const statCacheEntries = document.getElementById('statCacheEntries');
  const statHitRate = document.getElementById('statHitRate');

  // Load Dashboard Stats
  loadDashboardStats();
  setInterval(loadDashboardStats, 10000);

  async function loadDashboardStats() {
    try {
      const apiKey = customApiKeyInput ? customApiKeyInput.value.trim() : '';
      const res = await fetch(`/api/dashboard-stats?apiKey=${encodeURIComponent(apiKey)}`);
      const data = await res.json();

      if (data.stats) {
        statSent.textContent = Number(data.stats.totalCharactersSent || 0).toLocaleString();
        statSaved.textContent = Number(data.stats.totalCharactersSaved || 0).toLocaleString();
        statCacheEntries.textContent = Number(data.stats.cacheEntries || 0).toLocaleString();
        statHitRate.textContent = `${data.stats.hitRatePercent || '0.0'} %`;
      }
    } catch (err) {
      console.warn('Dashboard stats error:', err);
    }
  }

  function handleFileSelected(file) {
    hideError();
    selectedFile = file;
    pdfFileName.textContent = file.name;
    pdfFileSize.textContent = `${(file.size / (1024 * 1024)).toFixed(2)} MB • Fichier de Roman`;

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
  }

  // --- SIMULATION MODE ---
  analyzeBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    hideError();
    const formData = new FormData();
    formData.append('document', selectedFile);
    formData.append('targetLang', targetLangSelect.value);
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

      simulationBody.innerHTML = `
        <div style="background: rgba(0,0,0,0.25); padding: 15px; border-radius: 10px;">
          <p><strong>Fichier :</strong> ${sim.filename}</p>
          <p><strong>Caractères bruts :</strong> ${sim.rawCharacters.toLocaleString()}</p>
          <p><strong>Caractères après nettoyage :</strong> ${sim.cleanedCharacters.toLocaleString()}</p>
          <hr style="border-color: rgba(255,255,255,0.1); margin: 10px 0;">
          <p><strong>Total Segments :</strong> ${sim.totalSegments.toLocaleString()}</p>
          <p><strong>Déjà en Cache :</strong> <span style="color: #34d399;">${sim.cachedSegmentsCount.toLocaleString()}</span></p>
          <p><strong>À envoyer à DeepL :</strong> <span style="color: #fbbf24;">${sim.toTranslateCount.toLocaleString()}</span> (${sim.estimatedCharactersToSend.toLocaleString()} chars)</p>
          <hr style="border-color: rgba(255,255,255,0.1); margin: 10px 0;">
          <p style="font-size: 1.1rem; color: #a78bfa;"><strong>Économie totale estimée :</strong> ${sim.totalCharactersSaved.toLocaleString()} caractères (≈ ${sim.savingsPercent} %)</p>
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


  // Translation Submission
  translateBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    hideError();
    hideResultSection();
    showProgressSection();

    translateBtn.disabled = true;
    const targetLang = targetLangSelect.value;
    const customApiKey = customApiKeyInput.value.trim();

    const formData = new FormData();
    formData.append('pdf', selectedFile);
    formData.append('targetLang', targetLang);
    if (customApiKey) {
      formData.append('apiKey', customApiKey);
    }

    // Simulate animated progress steps
    animateProgressSteps();

    try {
      const response = await fetch('/api/translate-pdf', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        let errText = 'Erreur lors de la traduction du PDF.';
        try {
          const errData = await response.json();
          errText = errData.message || errText;
        } catch (e) {}
        throw new Error(errText);
      }

      // Received PDF Binary Blob
      const pdfBlob = await response.blob();
      translatedPdfBlobUrl = URL.createObjectURL(pdfBlob);

      // Setup Download Link
      const originalName = selectedFile.name.replace(/\.[^/.]+$/, "");
      const outputFilename = `${originalName}_${targetLang.toLowerCase()}.pdf`;

      downloadPdfBtn.href = translatedPdfBlobUrl;
      downloadPdfBtn.download = outputFilename;

      updateProgress(100, 'Traduction terminée !');
      setTimeout(() => {
        hideProgressSection();
        showResultSection();
        translateBtn.disabled = false;
      }, 600);

    } catch (err) {
      hideProgressSection();
      showError(err.message || 'Une erreur inattendue est survenue.');
      translateBtn.disabled = false;
    }
  });

  function animateProgressSteps() {
    const isLarge = selectedFile && selectedFile.size > 9.5 * 1024 * 1024;
    if (isLarge) {
      updateProgress(10, '⚡ Mode Gros Document activé (Découpage par lots)...');
      setTimeout(() => {
        if (progressSection.classList.contains('hidden')) return;
        updateProgress(35, 'Traduction des lots par DeepL (Préservation des images & mise en page)...');
      }, 3000);

      setTimeout(() => {
        if (progressSection.classList.contains('hidden')) return;
        updateProgress(75, 'Traduction des lots en cours par DeepL...');
      }, 10000);

      setTimeout(() => {
        if (progressSection.classList.contains('hidden')) return;
        updateProgress(92, 'Reconstruction et fusion du PDF final...');
      }, 18000);
    } else {
      updateProgress(15, 'Envoi du document à DeepL...');
      setTimeout(() => {
        if (progressSection.classList.contains('hidden')) return;
        updateProgress(45, 'Traduction en cours (Préservation de la mise en page & images)...');
      }, 2500);

      setTimeout(() => {
        if (progressSection.classList.contains('hidden')) return;
        updateProgress(80, 'Finalisation et assemblage du PDF...');
      }, 6000);
    }
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
    updateProgress(0, 'Initialisation...');
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
    errorMessage.textContent = msg;
    errorBanner.classList.remove('hidden');
  }

  function hideError() {
    errorBanner.classList.add('hidden');
  }
});
