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

  function handleFileSelected(file) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      showError('Seuls les fichiers au format PDF sont acceptés.');
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      showError('Le fichier est trop volumineux (Maximum 50 Mo).');
      return;
    }

    hideError();
    selectedFile = file;
    pdfFileName.textContent = file.name;
    const isLarge = file.size > 9.5 * 1024 * 1024;
    const modeBadge = isLarge ? ' • ⚡ Mode Gros Document (Lots & Images)' : '';
    pdfFileSize.textContent = `${(file.size / (1024 * 1024)).toFixed(2)} MB • Document PDF${modeBadge}`;

    dropzoneEmpty.classList.add('hidden');
    fileLoadedInfo.classList.remove('hidden');
    translateBtn.disabled = false;

    // Reset previous results
    hideResultSection();
  }

  function resetFileSelection() {
    selectedFile = null;
    pdfFileInput.value = '';
    fileLoadedInfo.classList.add('hidden');
    dropzoneEmpty.classList.remove('hidden');
    translateBtn.disabled = true;
    hideError();
    hideResultSection();
    hideProgressSection();

    if (translatedPdfBlobUrl) {
      URL.revokeObjectURL(translatedPdfBlobUrl);
      translatedPdfBlobUrl = null;
    }
  }

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
