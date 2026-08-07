/* ==========================================================================
   Manga & Webtoon AI Translator - Client Module Script
   ========================================================================== */

// 1. Interactive Before / After Slider Engine
window.initBeforeAfterSlider = function() {
  const viewer = document.getElementById('mangaSliderViewer');
  const afterImg = document.getElementById('imgTranslated');
  const handle = document.getElementById('sliderHandle');
  if (!viewer || !afterImg || !handle) return;

  let isDragging = false;
  let zoomLevel = 1;

  function updateSliderPosition(clientX) {
    const rect = viewer.getBoundingClientRect();
    let x = clientX - rect.left;
    if (x < 0) x = 0;
    if (x > rect.width) x = rect.width;

    const percentage = (x / rect.width) * 100;
    afterImg.style.clipPath = `polygon(0 0, ${percentage}% 0, ${percentage}% 100%, 0 100%)`;
    handle.style.left = `${percentage}%`;
  }

  handle.addEventListener('mousedown', () => { isDragging = true; });
  window.addEventListener('mouseup', () => { isDragging = false; });
  window.addEventListener('mousemove', (e) => {
    if (isDragging) updateSliderPosition(e.clientX);
  });

  // Touch Support for Mobile
  handle.addEventListener('touchstart', () => { isDragging = true; });
  window.addEventListener('touchend', () => { isDragging = false; });
  window.addEventListener('touchmove', (e) => {
    if (isDragging && e.touches.length > 0) updateSliderPosition(e.touches[0].clientX);
  });

  // Zoom Controls
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const zoomResetBtn = document.getElementById('zoomResetBtn');
  const originalImg = document.getElementById('imgOriginal');

  if (zoomInBtn && originalImg) {
    zoomInBtn.addEventListener('click', () => {
      zoomLevel = Math.min(zoomLevel + 0.25, 2.5);
      applyZoom();
    });

    zoomOutBtn.addEventListener('click', () => {
      zoomLevel = Math.max(zoomLevel - 0.25, 0.75);
      applyZoom();
    });

    zoomResetBtn.addEventListener('click', () => {
      zoomLevel = 1;
      applyZoom();
    });

    function applyZoom() {
      originalImg.style.transform = `scale(${zoomLevel})`;
      afterImg.style.transform = `scale(${zoomLevel})`;
      zoomResetBtn.textContent = `${Math.round(zoomLevel * 100)}%`;
    }
  }
};

// 2. Pipeline Animation Execution
window.runMangaPipelineAnimation = function() {
  const steps = [
    { id: 'step1', percent: 20, time: 800 },
    { id: 'step2', percent: 40, time: 1800 },
    { id: 'step3', percent: 65, time: 3000 },
    { id: 'step4', percent: 85, time: 4200 },
    { id: 'step5', percent: 100, time: 5500 }
  ];

  const fill = document.getElementById('pipelineProgressFill');

  steps.forEach((step, idx) => {
    setTimeout(() => {
      const el = document.getElementById(step.id);
      if (el) {
        el.classList.add('active');
        const tag = el.querySelector('.step-status-tag');
        if (tag) tag.textContent = 'En cours...';
      }

      if (idx > 0) {
        const prevEl = document.getElementById(steps[idx - 1].id);
        if (prevEl) {
          prevEl.classList.remove('active');
          prevEl.classList.add('done');
          const tag = prevEl.querySelector('.step-status-tag');
          if (tag) {
            tag.style.color = 'var(--manga-cyan)';
            tag.textContent = '✓ Terminé';
          }
        }
      }

      if (fill) fill.style.width = `${step.percent}%`;

      if (idx === steps.length - 1) {
        setTimeout(() => {
          window.location.href = 'viewer.html';
        }, 1200);
      }
    }, step.time);
  });
};

// 3. Upload Event Handlers
document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('mangaFileInput');
  const previewBox = document.getElementById('selectedFilePreview');
  const previewName = document.getElementById('previewFileName');
  const previewMeta = document.getElementById('previewFileMeta');
  const clearBtn = document.getElementById('clearFileBtn');
  const startBtn = document.getElementById('startMangaAnalysisBtn');

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        const f = e.target.files[0];
        previewName.textContent = f.name;
        previewMeta.textContent = `${e.target.files.length > 1 ? e.target.files.length + ' fichiers sélectionnés' : '1 fichier'} • ${(f.size / (1024*1024)).toFixed(2)} MB`;
        previewBox.classList.remove('hidden');
      }
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        fileInput.value = '';
        previewBox.classList.add('hidden');
      });
    }

    if (startBtn) {
      startBtn.addEventListener('click', () => {
        window.location.href = 'progress.html';
      });
    }
  }
});
