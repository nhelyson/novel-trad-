/**
 * quote_card_generator.js - Social Quote Card Generator (Spotify Canvas style) for NovelTrad
 */
(function() {
  'use strict';

  let currentQuoteText = '';
  let currentBookMeta = {
    title: 'Light Novel',
    author: 'Auteur inconnu',
    chapter: 'Chapitre 1',
    coverUrl: ''
  };

  let cardSettings = {
    aspectRatio: '1:1', // '1:1', '9:16', '16:9'
    theme: 'neon',      // 'neon', 'sepia', 'cyberpunk', 'cinematic'
    fontSize: 34,
    showCover: true,
    showWatermark: true
  };

  let loadedCoverImage = null;

  // =========================================================================
  //  1. FLOATING TEXT SELECTION TOOLTIP
  // =========================================================================
  function initSelectionTooltip() {
    let tooltip = document.getElementById('readerSelectionTooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'readerSelectionTooltip';
      tooltip.className = 'reader-selection-tooltip hidden';
      tooltip.innerHTML = `
        <button type="button" id="btnTooltipQuoteCard" class="tooltip-action-btn" title="Générer une carte visuelle">
          <i class="fa-solid fa-camera"></i> <span>Créer une Carte</span>
        </button>
        <!-- btnTooltipComment removed: comments now at end of volume -->
        <button type="button" id="btnTooltipCopy" class="tooltip-action-btn" title="Copier le texte">
          <i class="fa-regular fa-copy"></i>
        </button>
      `;
      document.body.appendChild(tooltip);

      const btnCard = tooltip.querySelector('#btnTooltipQuoteCard');
      const btnComment = null;
      const btnCopy = tooltip.querySelector('#btnTooltipCopy');

      if (btnCard) {
        btnCard.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const sel = window.getSelection().toString().trim();
          tooltip.classList.add('hidden');
          if (sel) window.openQuoteCardModal(sel);
        });
      }

      if (btnComment) {
        btnComment.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const sel = window.getSelection();
          if (!sel) return;
          const selText = sel.toString().trim();
          tooltip.classList.add('hidden');
          if (selText) {
            // Robust paragraph resolution (anchorNode, focusNode, or commonAncestor)
            let paraEl = null;
            if (sel.anchorNode) {
              const p = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
              if (p) paraEl = p.closest('[data-paragraph-id]');
            }
            if (!paraEl && sel.focusNode) {
              const p = sel.focusNode.nodeType === 3 ? sel.focusNode.parentElement : sel.focusNode;
              if (p) paraEl = p.closest('[data-paragraph-id]');
            }
            if (!paraEl && sel.rangeCount > 0) {
              const common = sel.getRangeAt(0).commonAncestorContainer;
              const p = common.nodeType === 3 ? common.parentElement : common;
              if (p) paraEl = p.closest('[data-paragraph-id]');
            }

            const pid = paraEl ? paraEl.getAttribute('data-paragraph-id') : 'c1_p0';
            const bookKey = window._currentActiveBookKey || window._streamFileKey || (window.currentBookRef && (window.currentBookRef.fileKey || window.currentBookRef.id)) || 'novel';
            if (typeof window.openParagraphComments === 'function') {
              window.openParagraphComments(bookKey, pid, selText);
            }
          }
        });
      }

      if (btnCopy) {
        btnCopy.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const selText = window.getSelection().toString().trim();
          tooltip.classList.add('hidden');
          if (selText) {
            const attribution = currentBookMeta.title ? ` — "${currentBookMeta.title}" (NovelTrad)` : '';
            navigator.clipboard.writeText(`"${selText}"${attribution}`).then(() => {
              if (window.authManager && window.authManager.showToast) {
                window.authManager.showToast('Citation copiée avec attribution !');
              }
            });
          }
        });
      }
    }

    // Handle selection event on reader containers
    function handleMouseUp(e) {
      if (e.target.closest('#readerSelectionTooltip, #quoteCardModal, #paraCommentsDrawer')) return;

      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
          tooltip.classList.add('hidden');
          return;
        }

        const text = sel.toString().trim();
        if (text.length < 5) {
          tooltip.classList.add('hidden');
          return;
        }

        // Verify selection is inside reader
        const anchorNode = sel.anchorNode;
        const readerParent = anchorNode && (anchorNode.nodeType === 3 ? anchorNode.parentElement : anchorNode).closest('#readerViewer, #webnovelContent, .stream-chapter-content, #readerPage');
        if (!readerParent) {
          tooltip.classList.add('hidden');
          return;
        }

        // Extract reader book meta
        extractCurrentReaderMeta();

        // Position tooltip above selection
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;

        const tipW = tooltip.offsetWidth || 280;
        tooltip.style.left = Math.max(10, Math.min(window.innerWidth - tipW - 10, rect.left + rect.width / 2 - tipW / 2)) + 'px';
        const topPos = rect.top - 46;
        if (topPos < 10) {
          tooltip.style.top = (rect.bottom + 10) + 'px';
        } else {
          tooltip.style.top = topPos + 'px';
        }

        tooltip.classList.remove('hidden');
      }, 30);
    }

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchend', handleMouseUp);
    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('#readerSelectionTooltip')) {
        tooltip.classList.add('hidden');
      }
    });
  }

  function extractCurrentReaderMeta() {
    if (window.currentBookRef) {
      const b = window.currentBookRef;
      currentBookMeta.title = b.title || 'Light Novel';
      currentBookMeta.author = b.author || b.creator || 'Auteur NovelTrad';
      currentBookMeta.coverUrl = b.cover || b.cover_url || b.coverUrl || '';
      if (b.chapterNumber) {
        currentBookMeta.chapter = 'Chapitre ' + b.chapterNumber;
      }
    } else if (window.currentSeries) {
      const s = window.currentSeries;
      currentBookMeta.title = s.title || 'Webnovel';
      currentBookMeta.author = s.author || 'Auteur NovelTrad';
      currentBookMeta.coverUrl = s.cover || s.cover_url || '';
      if (window.currentChapterNum) {
        currentBookMeta.chapter = 'Chapitre ' + window.currentChapterNum;
      }
    }

    if (window._streamVolumeManifest && window._streamCurrentChapter) {
      const chMeta = window._streamVolumeManifest.chapters?.find(c => c.chapterNumber === window._streamCurrentChapter);
      if (chMeta && chMeta.title) {
        currentBookMeta.chapter = chMeta.title;
      }
    }
  }

  // =========================================================================
  //  2. OPEN MODAL & SETUP CANVAS
  // =========================================================================
  window.openQuoteCardModal = function(quoteText, bookMetaOverride) {
    currentQuoteText = String(quoteText || '').trim();
    if (!currentQuoteText) return;

    extractCurrentReaderMeta();
    if (bookMetaOverride) {
      currentBookMeta = { ...currentBookMeta, ...bookMetaOverride };
    }

    const modal = document.getElementById('quoteCardModal');
    if (!modal) return;

    // Populate inputs
    const textInput = document.getElementById('quoteCardTextInput');
    if (textInput) textInput.value = currentQuoteText;

    // Load cover image
    loadCoverForCanvas(currentBookMeta.coverUrl).then(() => {
      renderCanvasCard();
    });

    modal.classList.remove('hidden');
    renderCanvasCard();
  };

  window.closeQuoteCardModal = function() {
    const modal = document.getElementById('quoteCardModal');
    if (modal) modal.classList.add('hidden');
  };

  function loadCoverForCanvas(url) {
    return new Promise((resolve) => {
      if (!url) {
        loadedCoverImage = null;
        return resolve(null);
      }

      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      // Use image proxy if remote HTTP
      let loadUrl = url;
      if (url.startsWith('http://') || url.startsWith('https://')) {
        loadUrl = '/api/proxy-image?url=' + encodeURIComponent(url);
      }

      img.onload = () => {
        loadedCoverImage = img;
        resolve(img);
      };
      img.onerror = () => {
        console.warn('[QuoteCard] Échec chargement couverture:', url);
        loadedCoverImage = null;
        resolve(null);
      };
      img.src = loadUrl;
    });
  }

  // =========================================================================
  //  3. CANVAS HD DRAWING ENGINE
  // =========================================================================
  function renderCanvasCard() {
    const canvas = document.getElementById('quoteCardCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // 1. Dimensions based on Aspect Ratio (HD 2x)
    let width = 1080;
    let height = 1080;
    if (cardSettings.aspectRatio === '9:16') {
      width = 1080;
      height = 1920;
    } else if (cardSettings.aspectRatio === '16:9') {
      width = 1200;
      height = 675;
    }

    canvas.width = width;
    canvas.height = height;

    // 2. Theme Background
    drawCardBackground(ctx, width, height);

    // 3. Ambient Lighting & Grain
    drawAmbientGlow(ctx, width, height);

    // 4. Header (Novel Title, Chapter & Author)
    const headerHeight = drawCardHeader(ctx, width, height);

    // 5. Book Cover (if enabled)
    let coverBounds = null;
    if (cardSettings.showCover && loadedCoverImage) {
      coverBounds = drawCardCover(ctx, width, height);
    }

    // 6. Quote Text (Centred & Auto-wrapped)
    drawCardQuote(ctx, width, height, headerHeight, coverBounds);

    // 7. Watermark / Branding Footer
    if (cardSettings.showWatermark) {
      drawCardFooter(ctx, width, height);
    }
  }

  function drawCardBackground(ctx, w, h) {
    if (cardSettings.theme === 'neon') {
      // Midnight obsidian gradient with rose-crimson aura
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#0a0c14');
      grad.addColorStop(0.5, '#121524');
      grad.addColorStop(1, '#1b1220');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Subtle top gradient line
      const topGrad = ctx.createLinearGradient(0, 0, w, 0);
      topGrad.addColorStop(0, '#e11d48');
      topGrad.addColorStop(0.5, '#fb7185');
      topGrad.addColorStop(1, '#6366f1');
      ctx.fillStyle = topGrad;
      ctx.fillRect(0, 0, w, 8);

    } else if (cardSettings.theme === 'sepia') {
      // Warm vintage Japanese paper
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#1c1611');
      grad.addColorStop(1, '#2c221a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = '#d97706';
      ctx.fillRect(0, 0, w, 8);

    } else if (cardSettings.theme === 'cyberpunk') {
      // Deep violet & electric indigo
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#0f081d');
      grad.addColorStop(0.5, '#1b0d36');
      grad.addColorStop(1, '#0b162c');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      const topGrad = ctx.createLinearGradient(0, 0, w, 0);
      topGrad.addColorStop(0, '#06b6d4');
      topGrad.addColorStop(0.5, '#a855f7');
      topGrad.addColorStop(1, '#ec4899');
      ctx.fillStyle = topGrad;
      ctx.fillRect(0, 0, w, 8);

    } else if (cardSettings.theme === 'cinematic') {
      // Full bleed blurred cover background with dark vignette
      if (loadedCoverImage) {
        ctx.save();
        ctx.filter = 'blur(40px) brightness(0.35)';
        ctx.drawImage(loadedCoverImage, -40, -40, w + 80, h + 80);
        ctx.restore();
      } else {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, w, h);
      }
      // Radial vignette
      const rad = ctx.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.8);
      rad.addColorStop(0, 'rgba(0,0,0,0.2)');
      rad.addColorStop(1, 'rgba(0,0,0,0.85)');
      ctx.fillStyle = rad;
      ctx.fillRect(0, 0, w, h);
    }
  }

  function drawAmbientGlow(ctx, w, h) {
    ctx.save();
    // Top-right soft crimson glow
    const glow1 = ctx.createRadialGradient(w * 0.85, h * 0.15, 0, w * 0.85, h * 0.15, w * 0.5);
    glow1.addColorStop(0, 'rgba(225, 29, 72, 0.18)');
    glow1.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow1;
    ctx.fillRect(0, 0, w, h);

    // Bottom-left soft indigo glow
    const glow2 = ctx.createRadialGradient(w * 0.15, h * 0.85, 0, w * 0.15, h * 0.85, w * 0.45);
    glow2.addColorStop(0, 'rgba(99, 102, 241, 0.14)');
    glow2.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow2;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function drawCardHeader(ctx, w, h) {
    const isStory = (cardSettings.aspectRatio === '9:16');
    const startY = isStory ? 140 : 80;

    ctx.save();
    ctx.textAlign = 'center';

    // Novel Title
    ctx.font = 'bold 36px "Inter", sans-serif';
    ctx.fillStyle = '#f8fafc';
    const cleanTitle = currentBookMeta.title.length > 40 ? currentBookMeta.title.substring(0, 40) + '...' : currentBookMeta.title;
    ctx.fillText(cleanTitle, w / 2, startY);

    // Subtitle (Chapter & Author)
    ctx.font = '500 22px "Inter", sans-serif';
    ctx.fillStyle = '#94a3b8';
    const subText = `${currentBookMeta.chapter || ''} • ${currentBookMeta.author || ''}`.trim();
    ctx.fillText(subText, w / 2, startY + 36);

    ctx.restore();
    return startY + 50;
  }

  function drawCardCover(ctx, w, h) {
    const isStory = (cardSettings.aspectRatio === '9:16');
    const isLandscape = (cardSettings.aspectRatio === '16:9');
    
    let coverW = 180;
    let coverH = 260;
    let coverX = (w - coverW) / 2;
    let coverY = isStory ? 240 : 150;

    if (isLandscape) {
      coverW = 140;
      coverH = 200;
      coverX = 90;
      coverY = 160;
    }

    ctx.save();
    // Drop shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 12;

    // Rounded rectangle path for cover
    const radius = 12;
    ctx.beginPath();
    ctx.moveTo(coverX + radius, coverY);
    ctx.lineTo(coverX + coverW - radius, coverY);
    ctx.quadraticCurveTo(coverX + coverW, coverY, coverX + coverW, coverY + radius);
    ctx.lineTo(coverX + coverW, coverY + coverH - radius);
    ctx.quadraticCurveTo(coverX + coverW, coverY + coverH, coverX + coverW - radius, coverY + coverH);
    ctx.lineTo(coverX + radius, coverY + coverH);
    ctx.quadraticCurveTo(coverX, coverY + coverH, coverX, coverY + coverH - radius);
    ctx.lineTo(coverX, coverY + radius);
    ctx.quadraticCurveTo(coverX, coverY, coverX + radius, coverY);
    ctx.closePath();

    ctx.fillStyle = '#1e293b';
    ctx.fill();

    // Clip & draw image
    ctx.clip();
    ctx.drawImage(loadedCoverImage, coverX, coverY, coverW, coverH);
    ctx.restore();

    return { x: coverX, y: coverY, width: coverW, height: coverH };
  }

  function drawCardQuote(ctx, w, h, headerHeight, coverBounds) {
    const isStory = (cardSettings.aspectRatio === '9:16');
    const isLandscape = (cardSettings.aspectRatio === '16:9');

    let quoteBoxX = 100;
    let quoteBoxW = w - 200;
    let quoteCenterY = h / 2 + 60;

    if (isStory) {
      quoteCenterY = coverBounds ? coverBounds.y + coverBounds.height + (h - (coverBounds.y + coverBounds.height) - 160) / 2 : h / 2 + 80;
    } else if (isLandscape) {
      if (coverBounds) {
        quoteBoxX = coverBounds.x + coverBounds.width + 70;
        quoteBoxW = w - quoteBoxX - 90;
        quoteCenterY = h / 2 + 10;
      }
    } else {
      if (coverBounds) {
        quoteCenterY = coverBounds.y + coverBounds.height + (h - (coverBounds.y + coverBounds.height) - 140) / 2;
      }
    }

    ctx.save();

    // Decorative Quote Mark “
    ctx.font = 'bold 96px "Georgia", serif';
    ctx.fillStyle = cardSettings.theme === 'sepia' ? 'rgba(217, 119, 6, 0.4)' : 'rgba(225, 29, 72, 0.45)';
    ctx.textAlign = 'center';
    
    // Auto-wrap quote text
    const fontSize = cardSettings.fontSize;
    ctx.font = `italic 600 ${fontSize}px "Merriweather", "Georgia", serif`;
    const words = currentQuoteText.split(' ');
    let lines = [];
    let currentLine = words[0] || '';

    for (let i = 1; i < words.length; i++) {
      const testLine = currentLine + ' ' + words[i];
      const metrics = ctx.measureText(testLine);
      if (metrics.width > quoteBoxW) {
        lines.push(currentLine);
        currentLine = words[i];
      } else {
        currentLine = testLine;
      }
    }
    lines.push(currentLine);

    // Limit lines if quote is massive
    if (lines.length > 8) {
      lines = lines.slice(0, 8);
      lines[7] = lines[7] + '...';
    }

    const lineHeight = fontSize * 1.55;
    const totalTextHeight = lines.length * lineHeight;
    let startTextY = quoteCenterY - (totalTextHeight / 2) + (fontSize * 0.8);

    // Draw Quote Mark slightly above text
    ctx.fillText('“', isLandscape ? (quoteBoxX + quoteBoxW / 2) : (w / 2), startTextY - 30);

    // Draw Lines
    ctx.textAlign = 'center';
    ctx.fillStyle = cardSettings.theme === 'sepia' ? '#fef3c7' : '#ffffff';

    const textCenterX = isLandscape ? (quoteBoxX + quoteBoxW / 2) : (w / 2);
    lines.forEach((line, index) => {
      ctx.fillText(line, textCenterX, startTextY + (index * lineHeight));
    });

    ctx.restore();
  }

  function drawCardFooter(ctx, w, h) {
    const footerY = h - 65;
    ctx.save();
    ctx.textAlign = 'center';

    // Divider line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w * 0.25, footerY - 26);
    ctx.lineTo(w * 0.75, footerY - 26);
    ctx.stroke();

    // NovelTrad Branding Pill
    ctx.font = 'bold 18px "Inter", sans-serif';
    ctx.fillStyle = '#fb7185';
    ctx.fillText('📖 NOVELTRAD', w / 2 - 70, footerY);

    ctx.font = '500 16px "Inter", sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('• Lecture Interactive & Communauté', w / 2 + 75, footerY);

    ctx.restore();
  }

  // =========================================================================
  //  4. MODAL INTERACTIONS & EXPORT
  // =========================================================================
  function initModalEvents() {
    const modal = document.getElementById('quoteCardModal');
    if (!modal) return;

    const closeBtn = document.getElementById('quoteCardCloseBtn');
    const backdrop = document.getElementById('quoteCardBackdrop');
    if (closeBtn) closeBtn.addEventListener('click', window.closeQuoteCardModal);
    if (backdrop) backdrop.addEventListener('click', window.closeQuoteCardModal);

    // Aspect ratio selector
    document.querySelectorAll('.aspect-ratio-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.aspect-ratio-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        cardSettings.aspectRatio = btn.getAttribute('data-ratio');
        renderCanvasCard();
      });
    });

    // Theme selector
    document.querySelectorAll('.quote-theme-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.quote-theme-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        cardSettings.theme = btn.getAttribute('data-theme');
        renderCanvasCard();
      });
    });

    // Textarea input
    const textInput = document.getElementById('quoteCardTextInput');
    if (textInput) {
      textInput.addEventListener('input', (e) => {
        currentQuoteText = e.target.value;
        renderCanvasCard();
      });
    }

    // Toggle Cover
    const checkCover = document.getElementById('quoteCardCheckCover');
    if (checkCover) {
      checkCover.addEventListener('change', (e) => {
        cardSettings.showCover = e.target.checked;
        renderCanvasCard();
      });
    }

    // Toggle Watermark
    const checkWatermark = document.getElementById('quoteCardCheckWatermark');
    if (checkWatermark) {
      checkWatermark.addEventListener('change', (e) => {
        cardSettings.showWatermark = e.target.checked;
        renderCanvasCard();
      });
    }

    // Font size controls
    const btnFontMinus = document.getElementById('btnQuoteFontMinus');
    const btnFontPlus = document.getElementById('btnQuoteFontPlus');
    if (btnFontMinus) {
      btnFontMinus.addEventListener('click', () => {
        cardSettings.fontSize = Math.max(22, cardSettings.fontSize - 4);
        renderCanvasCard();
      });
    }
    if (btnFontPlus) {
      btnFontPlus.addEventListener('click', () => {
        cardSettings.fontSize = Math.min(54, cardSettings.fontSize + 4);
        renderCanvasCard();
      });
    }

    // Download Button
    const btnDownload = document.getElementById('btnDownloadQuoteCard');
    if (btnDownload) {
      btnDownload.addEventListener('click', () => {
        const canvas = document.getElementById('quoteCardCanvas');
        if (!canvas) return;

        const link = document.createElement('a');
        const filenameSlug = (currentBookMeta.title || 'noveltrad').toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30);
        link.download = `noveltrad_citation_${filenameSlug}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();

        if (window.authManager && window.authManager.showToast) {
          window.authManager.showToast('Carte de citation téléchargée en HD !');
        }
      });
    }

    // Copy Image Button
    const btnCopyImage = document.getElementById('btnCopyQuoteCard');
    if (btnCopyImage) {
      btnCopyImage.addEventListener('click', async () => {
        const canvas = document.getElementById('quoteCardCanvas');
        if (!canvas) return;

        btnCopyImage.disabled = true;
        btnCopyImage.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Copie...';

        try {
          canvas.toBlob(async (blob) => {
            if (!blob) throw new Error('Erreur de conversion de l\'image');
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob })
            ]);
            btnCopyImage.disabled = false;
            btnCopyImage.innerHTML = '<i class="fa-solid fa-check"></i> Image Copiée !';
            setTimeout(() => {
              btnCopyImage.innerHTML = '<i class="fa-regular fa-copy"></i> Copier l\'image';
            }, 2500);

            if (window.authManager && window.authManager.showToast) {
              window.authManager.showToast('Image copiée ! Collez-la directement dans Discord ou Twitter.');
            }
          }, 'image/png');
        } catch (err) {
          btnCopyImage.disabled = false;
          btnCopyImage.innerHTML = '<i class="fa-regular fa-copy"></i> Copier l\'image';
          alert('Impossible de copier l\'image directement. Utilisez le bouton Télécharger.');
        }
      });
    }

    // Native Web Share Button (Mobile)
    const btnShare = document.getElementById('btnShareQuoteCard');
    if (btnShare) {
      if (navigator.share) {
        btnShare.classList.remove('hidden');
        btnShare.addEventListener('click', () => {
          const canvas = document.getElementById('quoteCardCanvas');
          if (!canvas) return;

          canvas.toBlob(async (blob) => {
            if (!blob) return;
            const file = new File([blob], 'citation_noveltrad.png', { type: 'image/png' });
            try {
              await navigator.share({
                title: `Citation : ${currentBookMeta.title}`,
                text: `"${currentQuoteText}" — Lu sur NovelTrad`,
                files: [file]
              });
            } catch(e) {}
          });
        });
      } else {
        btnShare.classList.add('hidden');
      }
    }
  }

  // =========================================================================
  //  5. HOOK IN IN-LINE COMMENT DRAWER
  // =========================================================================
  function hookInCommentDrawer() {
    const btnQuoteToCard = document.getElementById('btnQuoteToCard');
    if (btnQuoteToCard) {
      btnQuoteToCard.addEventListener('click', () => {
        const quoteEl = document.getElementById('paraQuoteText');
        const text = quoteEl ? quoteEl.textContent.trim() : '';
        if (text && text !== '...') {
          window.openQuoteCardModal(text);
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    initSelectionTooltip();
    initModalEvents();
    hookInCommentDrawer();
  });

})();
