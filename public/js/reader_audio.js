/**
 * NovelTrad - Reader Ambient Audio Engine (reader_audio.js)
 * High-fidelity anime piano, lofi chill, traditional Japanese soundscapes & ambient layers.
 * Supports authentic audio tracks (/audio/*.mp3) and procedural ambient audio (Web Audio API).
 * 100% offline, zero external dependencies, zero autoplay.
 */
(function () {
  'use strict';

  let audioCtx = null;
  let masterGain = null;
  let isPlaying = false;
  let currentPreset = 'piano_nostalgia'; // 'piano_nostalgia' | 'tokyo_lofi' | 'zen_japan' | 'rain' | 'campfire'
  let currentVolume = 0.35; // 0.0 - 1.0

  let currentAudioElement = null;
  let activeNodes = [];
  let crackleTimer = null;

  // Real audio files mapping
  const REAL_TRACKS = {
    'piano_nostalgia': '/audio/piano_nostalgia.mp3',
    'tokyo_lofi': '/audio/tokyo_lofi_chill.mp3',
    'zen_japan': '/audio/zen_japan.mp3'
  };

  function initAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        console.warn('[ReaderAudio] Web Audio API non supporté.');
        return false;
      }
      audioCtx = new AudioContextClass();
      masterGain = audioCtx.createGain();
      masterGain.gain.setValueAtTime(currentVolume, audioCtx.currentTime);
      masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return true;
  }

  // Pink noise buffer (for rain and warm background presence)
  let pinkBuffer = null;
  function getPinkBuffer() {
    if (pinkBuffer || !audioCtx) return pinkBuffer;
    const bufferSize = audioCtx.sampleRate * 4;
    pinkBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = pinkBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    return pinkBuffer;
  }

  // Soft rain layer
  function startRainLayer(gainLevel) {
    if (!audioCtx) return;
    const buf = getPinkBuffer();
    if (!buf) return;

    const source = audioCtx.createBufferSource();
    source.buffer = buf;
    source.loop = true;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(750, audioCtx.currentTime);

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(gainLevel || 0.25, audioCtx.currentTime);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);

    source.start(0);
    activeNodes.push(source, filter, gain);
  }

  // Campfire layer (warm low hum + crackles)
  function startCampfireLayer() {
    if (!audioCtx) return;
    const buf = getPinkBuffer();
    if (!buf) return;

    const source = audioCtx.createBufferSource();
    source.buffer = buf;
    source.loop = true;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(260, audioCtx.currentTime);

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.28, audioCtx.currentTime);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    source.start(0);
    activeNodes.push(source, filter, gain);

    function scheduleCrackle() {
      if (!isPlaying || currentPreset !== 'campfire') return;
      playCracklePop();
      const nextDelay = 100 + Math.random() * 400;
      crackleTimer = setTimeout(scheduleCrackle, nextDelay);
    }
    scheduleCrackle();
  }

  function playCracklePop() {
    if (!audioCtx || audioCtx.state !== 'running') return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();

    osc.type = 'square';
    osc.frequency.setValueAtTime(700 + Math.random() * 2000, now);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200 + Math.random() * 900, now);
    filter.Q.setValueAtTime(3.5, now);

    const popVol = 0.02 + Math.random() * 0.07;
    gain.gain.setValueAtTime(popVol, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03 + Math.random() * 0.05);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);

    osc.start(now);
    osc.stop(now + 0.1);
  }

  // Stop real track with optional smooth fade
  function stopRealTrack(immediate) {
    if (!currentAudioElement) return;
    const audio = currentAudioElement;
    currentAudioElement = null;

    if (immediate) {
      audio.pause();
      audio.currentTime = 0;
      audio.src = '';
    } else {
      let vol = audio.volume;
      const fadeStep = vol / 8;
      const fader = setInterval(() => {
        vol = Math.max(0, vol - fadeStep);
        audio.volume = vol;
        if (vol <= 0.02) {
          clearInterval(fader);
          audio.pause();
          audio.currentTime = 0;
          audio.src = '';
        }
      }, 25);
    }
  }

  function playRealTrack(trackUrl) {
    stopRealTrack(true);
    const audio = new Audio();
    audio.src = trackUrl;
    audio.loop = true;
    audio.volume = 0;
    currentAudioElement = audio;

    audio.play().then(() => {
      // Smooth fade-in
      let vol = 0;
      const targetVol = currentVolume;
      const step = targetVol / 10;
      const fader = setInterval(() => {
        if (!currentAudioElement || currentAudioElement !== audio) {
          clearInterval(fader);
          return;
        }
        vol = Math.min(targetVol, vol + step);
        audio.volume = vol;
        if (vol >= targetVol) {
          clearInterval(fader);
        }
      }, 30);
    }).catch(err => {
      console.warn('[ReaderAudio] Impossible de lire la piste:', err);
    });
  }

  function stopAllActiveNodes() {
    stopRealTrack(true);
    if (crackleTimer) {
      clearTimeout(crackleTimer);
      crackleTimer = null;
    }
    activeNodes.forEach(node => {
      try {
        if (node.stop) node.stop();
        if (node.disconnect) node.disconnect();
      } catch (e) {}
    });
    activeNodes = [];
  }

  // Controls
  function startPlayback() {
    stopAllActiveNodes();
    isPlaying = true;
    updateUiState(true);

    if (REAL_TRACKS[currentPreset]) {
      playRealTrack(REAL_TRACKS[currentPreset]);
    } else {
      if (!initAudioContext()) return;
      if (currentPreset === 'rain') {
        startRainLayer(0.28);
      } else if (currentPreset === 'campfire') {
        startCampfireLayer();
      }
    }
  }

  function stopPlayback() {
    isPlaying = false;
    stopAllActiveNodes();
    updateUiState(false);
  }

  function togglePlayback() {
    if (isPlaying) {
      stopPlayback();
    } else {
      startPlayback();
    }
  }

  function setPreset(presetKey) {
    currentPreset = presetKey;
    localStorage.setItem('noveltrad_reader_audio_preset', presetKey);
    updatePresetButtonsUi();
    if (isPlaying) {
      startPlayback();
    }
  }

  function setVolume(val) {
    currentVolume = Math.max(0, Math.min(1, val));
    localStorage.setItem('noveltrad_reader_audio_volume', String(currentVolume));
    if (currentAudioElement) {
      currentAudioElement.volume = currentVolume;
    }
    if (masterGain && audioCtx) {
      masterGain.gain.setValueAtTime(currentVolume, audioCtx.currentTime);
    }
    const valSpan = document.getElementById('readerAudioVolumeVal');
    if (valSpan) {
      valSpan.textContent = Math.round(currentVolume * 100) + '%';
    }
    const slider = document.getElementById('readerAudioVolume');
    if (slider && Number(slider.value) !== Math.round(currentVolume * 100)) {
      slider.value = Math.round(currentVolume * 100);
    }
  }

  function updateUiState(playing) {
    const toggleBtn = document.getElementById('readerAudioToggle');
    const playBtn = document.getElementById('readerAudioPlayBtn');
    const statusText = document.getElementById('readerAudioStatus');

    if (toggleBtn) {
      if (playing) {
        toggleBtn.classList.add('audio-playing');
        toggleBtn.title = "Ambiance sonore : En lecture (cliquer pour ouvrir/arrêter)";
      } else {
        toggleBtn.classList.remove('audio-playing');
        toggleBtn.title = "Ambiance sonore";
      }
    }

    if (playBtn) {
      if (playing) {
        playBtn.classList.add('is-playing');
        playBtn.innerHTML = '<i class="fa-solid fa-pause"></i> <span id="readerAudioPlayText">Mettre en pause</span>';
      } else {
        playBtn.classList.remove('is-playing');
        playBtn.innerHTML = '<i class="fa-solid fa-play"></i> <span id="readerAudioPlayText">Lancer la musique</span>';
      }
    }

    if (statusText) {
      if (playing) {
        statusText.textContent = "Actif";
        statusText.style.color = "#10b981";
      } else {
        statusText.textContent = "Désactivé";
        statusText.style.color = "var(--text-secondary)";
      }
    }
  }

  function updatePresetButtonsUi() {
    const buttons = document.querySelectorAll('.audio-preset-btn');
    buttons.forEach(btn => {
      if (btn.getAttribute('data-preset') === currentPreset) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  function setupDomListeners() {
    const audioToggle = document.getElementById('readerAudioToggle');
    const audioMenu = document.getElementById('readerAudioMenu');
    const playBtn = document.getElementById('readerAudioPlayBtn');
    const volumeSlider = document.getElementById('readerAudioVolume');
    const presetButtons = document.querySelectorAll('.audio-preset-btn');

    let savedPreset = localStorage.getItem('noveltrad_reader_audio_preset');
    // Map legacy presets if any
    if (savedPreset === 'zen_piano') savedPreset = 'piano_nostalgia';
    if (savedPreset === 'cafe_rain') savedPreset = 'tokyo_lofi';

    if (savedPreset) {
      currentPreset = savedPreset;
    }
    const savedVol = localStorage.getItem('noveltrad_reader_audio_volume');
    if (savedVol !== null) {
      const parsedVol = parseFloat(savedVol);
      if (!isNaN(parsedVol)) {
        currentVolume = Math.max(0, Math.min(1, parsedVol));
      }
    }
    updatePresetButtonsUi();
    const valSpan = document.getElementById('readerAudioVolumeVal');
    if (valSpan) valSpan.textContent = Math.round(currentVolume * 100) + '%';
    if (volumeSlider) volumeSlider.value = Math.round(currentVolume * 100);

    if (audioToggle && audioMenu) {
      audioToggle.onclick = function (e) {
        e.stopPropagation();
        const settingsMenu = document.getElementById('readerSettingsMenu');
        if (settingsMenu) settingsMenu.classList.add('hidden');
        audioMenu.classList.toggle('hidden');
      };

      document.addEventListener('click', function (e) {
        if (!audioToggle.contains(e.target) && !audioMenu.contains(e.target)) {
          audioMenu.classList.add('hidden');
        }
      });
    }

    if (playBtn) {
      playBtn.onclick = function (e) {
        e.stopPropagation();
        togglePlayback();
      };
    }

    presetButtons.forEach(btn => {
      btn.onclick = function (e) {
        e.stopPropagation();
        const preset = btn.getAttribute('data-preset');
        if (preset) {
          setPreset(preset);
          if (!isPlaying) {
            startPlayback();
          }
        }
      };
    });

    if (volumeSlider) {
      volumeSlider.oninput = function (e) {
        setVolume(parseFloat(e.target.value) / 100);
      };
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupDomListeners);
  } else {
    setupDomListeners();
  }

  window.ReaderAudio = {
    play: startPlayback,
    stop: stopPlayback,
    toggle: togglePlayback,
    setPreset: setPreset,
    setVolume: setVolume,
    isPlaying: () => isPlaying,
    reinitUi: setupDomListeners
  };
})();
