/**
 * NovelTrad - Release Radar 2.0 (Planning & Calendrier Officiel des Sorties)
 * Interface fluide, navigation par ruban tactile, recherche instantanée et fiches Simulcast.
 */

(function() {
  'use strict';

  const MONTH_NAMES_FR = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
  ];

  const DAYS_NAMES_FR = [
    'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'
  ];

  const SHORT_DAYS_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

  const DEFAULT_COVER = 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22120%22%20height%3D%22180%22%20viewBox%3D%220%200%20120%20180%22%3E%3Crect%20width%3D%22120%22%20height%3D%22180%22%20fill%3D%22%231e293b%22%2F%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20fill%3D%22%2394a3b8%22%20font-size%3D%2214%22%3ELN%3C%2Ftext%3E%3C%2Fsvg%3E';

  window.handleCalCoverError = function(img) {
    if (!img) return;
    img.onerror = null;
    img.src = DEFAULT_COVER;
  };

  const state = {
    selectedYear: new Date().getFullYear(),
    selectedMonth: new Date().getMonth(),
    selectedDay: null, // null = tout le mois, ou numéro du jour (1-31)
    activeFilter: 'all', // 'all' | 'translations' | 'volumes' | 'new' | 'announcements'
    searchQuery: '', // Recherche en temps réel
    viewMode: window.innerWidth <= 768 ? 'agenda' : 'agenda', // Par défaut Timeline / Radar pour une UX moderne
    events: [],
    catalogNovels: [],
    scheduleItems: [],
    newsItems: [],
    reminders: new Set(),
    isInitialized: false,
    isLoading: false
  };

  /**
   * Initialisation du module Calendrier
   */
  async function init() {
    if (state.isInitialized) {
      renderCalendar();
      return;
    }
    state.isInitialized = true;
    loadReminders();
    bindEvents();
    await loadData();
    renderCalendar();
  }

  function loadReminders() {
    try {
      const stored = localStorage.getItem('noveltrad_cal_reminders');
      if (stored) {
        state.reminders = new Set(JSON.parse(stored));
      }
    } catch(e) {
      console.warn('[Calendar] Erreur lecture rappels:', e);
    }
  }

  function saveReminders() {
    try {
      localStorage.setItem('noveltrad_cal_reminders', JSON.stringify([...state.reminders]));
    } catch(e) {
      console.warn('[Calendar] Erreur sauvegarde rappels:', e);
    }
  }

  /**
   * Chargement asynchrone des données
   */
  async function loadData() {
    state.isLoading = true;
    try {
      const [catalogRes, scheduleRes, newsRes] = await Promise.allSettled([
        fetch('/api/catalog'),
        fetch('/api/editorial/schedule'),
        fetch('/api/editorial/news')
      ]);

      if (catalogRes.status === 'fulfilled' && catalogRes.value.ok) {
        const catData = await catalogRes.value.json();
        state.catalogNovels = catData.novels || catData.series || [];
      }

      if (scheduleRes.status === 'fulfilled' && scheduleRes.value.ok) {
        const schedData = await scheduleRes.value.json();
        state.scheduleItems = schedData.schedule || [];
      }

      if (newsRes.status === 'fulfilled' && newsRes.value.ok) {
        const newsData = await newsRes.value.json();
        state.newsItems = newsData.news || [];
      }

      aggregateEvents();
    } catch(err) {
      console.error('[Calendar] Erreur chargement des données:', err);
    } finally {
      state.isLoading = false;
    }
  }

  function parseDate(raw) {
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  function formatDateIso(d) {
    if (!d) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /**
   * Consolidation des événements depuis les catalogues, volumes, schedule et news
   */
  function aggregateEvents() {
    const list = [];
    const seenEventKeys = new Set();

    // 1. Volumes publiés du Catalogue
    state.catalogNovels.forEach(novel => {
      const volumes = novel.volumes || [];
      const hasVolumes = volumes.length > 0;

      volumes.forEach(vol => {
        const releaseDate = parseDate(vol.release_date || vol.uploaded_at || vol.created_at);
        if (!releaseDate) return;

        const volNum = vol.volume_number || vol.volumeNumber || '1';
        const volKey = `vol_${novel.id}_${volNum}_${formatDateIso(releaseDate)}`;
        if (seenEventKeys.has(volKey)) return;
        seenEventKeys.add(volKey);

        const hasFile = Boolean(vol.file_path);
        list.push({
          id: vol.id || volKey,
          novelId: novel.id,
          volumeId: vol.id,
          title: novel.title || 'Light Novel',
          volume: vol.title || `Tome ${volNum}`,
          volumeNumber: volNum,
          cover: vol.cover_url || vol.cover || novel.cover_url || novel.cover || '',
          date: releaseDate,
          dateIso: formatDateIso(releaseDate),
          type: 'volumes',
          subType: 'translation',
          status: hasFile ? 'available' : 'planned',
          statusLabel: hasFile ? '🟢 Disponible' : '🔵 Sortie',
          badgeClass: hasFile ? 'badge-available' : 'badge-release',
          badgeIcon: hasFile ? 'fa-check' : 'fa-clock',
          hasReader: hasFile,
          filePath: vol.file_path || '',
          team: novel.author || novel.translator || 'Équipe NovelTrad',
          description: novel.synopsis || novel.description || 'Volume disponible à la lecture sur NovelTrad.'
        });
      });

      // 2. Nouveautés (Ajouts de séries récentes au catalogue)
      const createdAt = parseDate(novel.created_at);
      if (createdAt) {
        const newKey = `new_${novel.id}_${formatDateIso(createdAt)}`;
        if (!seenEventKeys.has(newKey)) {
          seenEventKeys.add(newKey);
          list.push({
            id: newKey,
            novelId: novel.id,
            title: novel.title || 'Nouvelle série',
            volume: hasVolumes ? `${volumes.length} vol. dispo` : 'Nouvelle série',
            cover: novel.cover_url || novel.cover || '',
            date: createdAt,
            dateIso: formatDateIso(createdAt),
            type: 'new',
            status: 'available',
            statusLabel: '✨ Nouveauté',
            badgeClass: 'badge-new',
            badgeIcon: 'fa-sparkles',
            hasReader: hasVolumes,
            team: novel.author || 'NovelTrad',
            description: novel.synopsis || 'Nouvelle œuvre intégrée au catalogue NovelTrad.'
          });
        }
      }
    });

    // 3. Sorties programmées (Schedule éditorial)
    state.scheduleItems.forEach(item => {
      const releaseDate = parseDate(item.releaseDate);
      if (!releaseDate) return;

      const schedKey = `sched_${item.seriesId || item.id}_${item.volumeOrChapter || item.volume || ""}_${formatDateIso(releaseDate)}`;
      if (seenEventKeys.has(schedKey)) return;
      seenEventKeys.add(schedKey);

      const isAvailable = item.status === 'available';
      const isTrad = item.type === 'translation' || item.type === 'traduction';
      const isAnnounce = item.type === 'announcement' || item.type === 'annonce';

      let typeCategory = 'volumes';
      let statusLabel = '🔵 Sortie';
      let badgeClass = 'badge-release';

      if (isAnnounce) {
        typeCategory = 'announcements';
        statusLabel = '📢 Annonce';
        badgeClass = 'badge-announce';
      } else if (isTrad) {
        typeCategory = 'translations';
        statusLabel = isAvailable ? '🟢 Traduit' : '🔵 En cours';
        badgeClass = isAvailable ? 'badge-available' : 'badge-release';
      }

      list.push({
        id: schedKey,
        novelId: item.seriesId || '',
        title: item.title || 'Sortie Programmée',
        volume: item.volume || 'Chapitre / Tome',
        cover: item.coverUrl || item.cover || '',
        date: releaseDate,
        dateIso: formatDateIso(releaseDate),
        type: typeCategory,
        subType: item.type,
        status: item.status || 'planned',
        statusLabel: statusLabel,
        badgeClass: badgeClass,
        badgeIcon: 'fa-calendar-check',
        hasReader: Boolean(item.readerUrl || item.seriesId),
        team: item.team || 'NovelTrad',
        description: item.description || 'Sortie officielle programmée sur NovelTrad.'
      });
    });

    // 4. Actualités & Annonces officielles
    state.newsItems.forEach(news => {
      const newsDate = parseDate(news.created_at || news.published_at || news.date);
      if (!newsDate) return;

      const newsKey = `news_${news.id}_${formatDateIso(newsDate)}`;
      if (seenEventKeys.has(newsKey)) return;
      seenEventKeys.add(newsKey);

      list.push({
        id: newsKey,
        newsId: news.id,
        title: news.title || 'Actualité NovelTrad',
        volume: news.category || 'Annonce',
        cover: news.cover_url || news.image || '',
        date: newsDate,
        dateIso: formatDateIso(newsDate),
        type: 'announcements',
        status: 'available',
        statusLabel: '📢 Actualité',
        badgeClass: 'badge-announce',
        badgeIcon: 'fa-bullhorn',
        hasReader: false,
        team: 'Éditorial NovelTrad',
        description: news.excerpt || news.content || 'Annonce officielle de la communauté NovelTrad.'
      });
    });

    state.events = list;
  }

  /**
   * Filtrage des événements pour le mois et la recherche
   */
  function getFilteredEventsForMonth() {
    const year = state.selectedYear;
    const month = state.selectedMonth;
    const query = (state.searchQuery || '').toLowerCase().trim();

    return state.events.filter(ev => {
      if (!ev.date) return false;
      const evYear = ev.date.getFullYear();
      const evMonth = ev.date.getMonth();

      // Si recherche active sans mois forcé, on peut matcher sur toute l'année, mais ici on respecte le mois ou on filtre
      if (evYear !== year || evMonth !== month) return false;

      // Filtre de catégorie
      if (state.activeFilter === 'translations' && ev.type !== 'translations' && ev.subType !== 'translation') return false;
      if (state.activeFilter === 'volumes' && ev.type !== 'volumes') return false;
      if (state.activeFilter === 'new' && ev.type !== 'new') return false;
      if (state.activeFilter === 'announcements' && ev.type !== 'announcements') return false;

      // Filtre de recherche textuelle
      if (query) {
        const titleMatch = (ev.title || '').toLowerCase().includes(query);
        const volMatch = (ev.volume || '').toLowerCase().includes(query);
        const teamMatch = (ev.team || '').toLowerCase().includes(query);
        if (!titleMatch && !volMatch && !teamMatch) return false;
      }

      return true;
    });
  }

  /**
   * Mise à jour des compteurs de filtres
   */
  function updateFilterCounts() {
    const year = state.selectedYear;
    const month = state.selectedMonth;

    const monthEvents = state.events.filter(ev => {
      return ev.date && ev.date.getFullYear() === year && ev.date.getMonth() === month;
    });

    const counts = {
      all: monthEvents.length,
      volumes: monthEvents.filter(ev => ev.type === 'volumes').length,
      translations: monthEvents.filter(ev => ev.type === 'translations' || ev.subType === 'translation').length,
      new: monthEvents.filter(ev => ev.type === 'new').length
    };

    const countAllEl = document.getElementById('calCountAll');
    if (countAllEl) countAllEl.textContent = counts.all;

    const countVolEl = document.getElementById('calCountVolumes');
    if (countVolEl) countVolEl.textContent = counts.volumes;

    const countTradEl = document.getElementById('calCountTranslations');
    if (countTradEl) countTradEl.textContent = counts.translations;

    const countNewEl = document.getElementById('calCountNew');
    if (countNewEl) countNewEl.textContent = counts.new;
  }

  /**
   * Rendu du ruban horizontal des jours du mois
   */
  function renderDayStrip(events = []) {
    const stripEl = document.getElementById('calDayStrip');
    if (!stripEl) return;
    stripEl.innerHTML = '';

    const year = state.selectedYear;
    const month = state.selectedMonth;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
    const todayDate = today.getDate();

    const daysWithEvents = new Set();
    const eventList = Array.isArray(events) ? events : [];
    eventList.forEach(ev => {
      if (ev.date && ev.date.getFullYear() === year && ev.date.getMonth() === month) {
        daysWithEvents.add(ev.date.getDate());
      }
    });

    const fragment = document.createDocumentFragment();

    // 1. Bouton "Tout le mois"
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'cal-day-strip-item' + (state.selectedDay === null ? ' active' : '');
    allBtn.setAttribute('data-day', 'all');
    allBtn.setAttribute('title', 'Afficher toutes les sorties du mois');
    allBtn.innerHTML = `
      <span class="cal-day-strip-name">Mois</span>
      <span class="cal-day-strip-num">Tous</span>
    `;
    allBtn.addEventListener('click', () => {
      state.selectedDay = null;
      renderCalendar();
    });
    fragment.appendChild(allBtn);

    // 2. Boutons par jour
    for (let d = 1; d <= daysInMonth; d++) {
      const dayDate = new Date(year, month, d);
      const dayName = SHORT_DAYS_FR[dayDate.getDay()];
      const isToday = isCurrentMonth && d === todayDate;
      const hasEvents = daysWithEvents.has(d);
      const isSelected = state.selectedDay === d;

      const dayBtn = document.createElement('button');
      dayBtn.type = 'button';
      dayBtn.id = 'calDayStripItem_' + d;
      dayBtn.className = 'cal-day-strip-item' +
        (isSelected ? ' active' : '') +
        (isToday ? ' cal-day-today' : '');
      dayBtn.setAttribute('data-day', d);
      dayBtn.setAttribute('title', `${dayName} ${d} ${MONTH_NAMES_FR[month]}${hasEvents ? ' (Sorties disponibles)' : ''}`);

      dayBtn.innerHTML = `
        <span class="cal-day-strip-name">${dayName}</span>
        <span class="cal-day-strip-num">${d}</span>
        ${hasEvents ? '<span class="cal-day-strip-dot"></span>' : ''}
      `;

      dayBtn.addEventListener('click', () => {
        if (state.selectedDay === d) {
          state.selectedDay = null; // Désélectionner pour revenir au mois complet
        } else {
          state.selectedDay = d;
        }
        renderCalendar();
      });

      fragment.appendChild(dayBtn);
    }

    stripEl.appendChild(fragment);

    // Auto-scroll vers le jour actif ou aujourd'hui
    setTimeout(() => {
      const activeEl = stripEl.querySelector('.cal-day-strip-item.active') ||
                       stripEl.querySelector('.cal-day-strip-item.cal-day-today');
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }, 100);
  }

  /**
   * Rendu global du calendrier
   */
  function renderCalendar() {
    updateHeaderUI();
    updateFilterCounts();

    const filteredEvents = getFilteredEventsForMonth();
    renderDayStrip(filteredEvents);

    const emptyStateEl = document.getElementById('calendarEmptyState');
    const gridWrapperEl = document.getElementById('calendarGridWrapper');
    const agendaWrapperEl = document.getElementById('calendarAgendaWrapper');

    const isMobile = window.innerWidth <= 768;
    const effectiveView = isMobile ? 'agenda' : state.viewMode;

    const gridSwitchBtn = document.getElementById('calViewGridBtn');
    const agendaSwitchBtn = document.getElementById('calViewAgendaBtn');
    if (gridSwitchBtn && agendaSwitchBtn) {
      if (effectiveView === 'grid') {
        gridSwitchBtn.classList.add('active');
        gridSwitchBtn.setAttribute('aria-pressed', 'true');
        agendaSwitchBtn.classList.remove('active');
        agendaSwitchBtn.setAttribute('aria-pressed', 'false');
      } else {
        agendaSwitchBtn.classList.add('active');
        agendaSwitchBtn.setAttribute('aria-pressed', 'true');
        gridSwitchBtn.classList.remove('active');
        gridSwitchBtn.setAttribute('aria-pressed', 'false');
      }
    }

    if (filteredEvents.length === 0) {
      if (emptyStateEl) emptyStateEl.classList.remove('hidden');
      if (gridWrapperEl) gridWrapperEl.classList.add('hidden');
      if (agendaWrapperEl) agendaWrapperEl.classList.add('hidden');
    } else {
      if (emptyStateEl) emptyStateEl.classList.add('hidden');
      if (effectiveView === 'grid') {
        if (gridWrapperEl) gridWrapperEl.classList.remove('hidden');
        if (agendaWrapperEl) agendaWrapperEl.classList.add('hidden');
        renderMonthlyGrid(filteredEvents);
      } else {
        if (agendaWrapperEl) agendaWrapperEl.classList.remove('hidden');
        if (gridWrapperEl) gridWrapperEl.classList.add('hidden');
        renderAgendaList(filteredEvents);
      }
    }
  }

  function updateHeaderUI() {
    const monthNameEl = document.getElementById('calCurrentMonthName');
    const yearEl = document.getElementById('calCurrentYear');
    if (monthNameEl) monthNameEl.textContent = MONTH_NAMES_FR[state.selectedMonth];
    if (yearEl) yearEl.textContent = state.selectedYear;
  }

  /**
   * Rendu de la Grille Mensuelle 7 jours
   */
  function renderMonthlyGrid(events) {
    const gridEl = document.getElementById('calendarMonthlyGrid');
    if (!gridEl) return;
    gridEl.innerHTML = '';

    const year = state.selectedYear;
    const month = state.selectedMonth;

    const firstDayIndex = (new Date(year, month, 1).getDay() + 6) % 7; // Lundi = 0
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
    const todayDate = today.getDate();

    const eventsByDay = {};
    events.forEach(ev => {
      const d = ev.date.getDate();
      if (!eventsByDay[d]) eventsByDay[d] = [];
      eventsByDay[d].push(ev);
    });

    const fragment = document.createDocumentFragment();

    // Jours du mois précédent
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const num = daysInPrevMonth - i;
      const cell = document.createElement('div');
      cell.className = 'cal-grid-cell cal-cell-other-month';
      cell.innerHTML = `<span class="cal-cell-num">${num}</span>`;
      fragment.appendChild(cell);
    }

    // Jours du mois courant
    for (let d = 1; d <= daysInMonth; d++) {
      const cell = document.createElement('div');
      const isToday = isCurrentMonth && d === todayDate;
      const isSelected = state.selectedDay === d;
      const dayEvents = eventsByDay[d] || [];

      cell.className = 'cal-grid-cell' +
        (isToday ? ' cal-cell-today' : '') +
        (isSelected ? ' cal-cell-selected' : '');

      let eventsHtml = '';
      const maxDisplay = 2;
      dayEvents.slice(0, maxDisplay).forEach(ev => {
        eventsHtml += `
          <div class="cal-cell-chip ${ev.badgeClass}" title="${escapeHtml(ev.title)} - ${escapeHtml(ev.volume)}">
            <span>${escapeHtml(ev.title)}</span>
          </div>
        `;
      });

      if (dayEvents.length > maxDisplay) {
        eventsHtml += `<div class="cal-cell-chip" style="color: #a5b4fc; font-weight:700;">+${dayEvents.length - maxDisplay} autres</div>`;
      }

      cell.innerHTML = `
        <span class="cal-cell-num">${d}</span>
        <div class="cal-cell-events-list">${eventsHtml}</div>
      `;

      // Clic sur une cellule -> bascule sur le jour dans la vue Timeline
      cell.addEventListener('click', () => {
        state.selectedDay = d;
        state.viewMode = 'agenda';
        renderCalendar();
      });

      fragment.appendChild(cell);
    }

    // Compléter la dernière ligne de 7 jours
    const totalCells = firstDayIndex + daysInMonth;
    const remainder = totalCells % 7;
    if (remainder !== 0) {
      const nextDays = 7 - remainder;
      for (let n = 1; n <= nextDays; n++) {
        const cell = document.createElement('div');
        cell.className = 'cal-grid-cell cal-cell-other-month';
        cell.innerHTML = `<span class="cal-cell-num">${n}</span>`;
        fragment.appendChild(cell);
      }
    }

    gridEl.appendChild(fragment);
  }

  /**
   * Rendu de la vue Radar / Timeline
   */
  function renderAgendaList(events) {
    const agendaEl = document.getElementById('calendarAgendaList');
    if (!agendaEl) return;
    agendaEl.innerHTML = '';

    let displayEvents = events;
    if (state.selectedDay !== null) {
      displayEvents = events.filter(ev => ev.date && ev.date.getDate() === state.selectedDay);
    }

    if (displayEvents.length === 0 && state.selectedDay !== null) {
      const emptyDay = document.createElement('div');
      emptyDay.className = 'cal-empty-state';
      emptyDay.innerHTML = `
        <div class="cal-empty-icon"><i class="fa-regular fa-calendar-xmark"></i></div>
        <h3 class="cal-empty-title">Aucune sortie le ${state.selectedDay} ${MONTH_NAMES_FR[state.selectedMonth]} ${state.selectedYear}</h3>
        <p class="cal-empty-desc">Aucun roman, tome ou chapitre n'est répertorié pour cette journée.</p>
        <button type="button" class="cal-empty-btn" id="calSeeAllMonthBtn">
          <i class="fa-solid fa-calendar-days"></i> <span>Voir tout le mois</span>
        </button>
      `;
      const btn = emptyDay.querySelector('#calSeeAllMonthBtn');
      if (btn) {
        btn.addEventListener('click', () => {
          state.selectedDay = null;
          renderCalendar();
        });
      }
      agendaEl.appendChild(emptyDay);
      return;
    }

    // Trier les événements par date
    const sorted = [...displayEvents].sort((a, b) => b.date.getTime() - a.date.getTime());

    // Grouper par date ISO
    const groups = {};
    sorted.forEach(ev => {
      const key = ev.dateIso;
      if (!groups[key]) groups[key] = [];
      groups[key].push(ev);
    });

    const now = new Date();
    const todayIso = formatDateIso(now);
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const yesterdayIso = formatDateIso(yesterday);
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const tomorrowIso = formatDateIso(tomorrow);

    const fragment = document.createDocumentFragment();

    Object.keys(groups).forEach(dateIso => {
      const groupEvents = groups[dateIso];
      const sampleDate = groupEvents[0].date;
      const isToday = dateIso === todayIso;
      const isYesterday = dateIso === yesterdayIso;
      const isTomorrow = dateIso === tomorrowIso;

      const groupContainer = document.createElement('div');
      groupContainer.className = 'cal-agenda-group';

      const dateHeader = document.createElement('div');
      dateHeader.className = 'cal-agenda-date-header';

      const dayName = DAYS_NAMES_FR[(sampleDate.getDay() + 6) % 7];
      const dayNum = sampleDate.getDate();
      const monthName = MONTH_NAMES_FR[sampleDate.getMonth()];

      let statusBadge = '';
      if (isToday) {
        statusBadge = '<span class="cal-today-pill">Aujourd\'hui</span>';
      } else if (isYesterday) {
        statusBadge = '<span class="cal-badge-pill" style="background: rgba(148, 163, 184, 0.15); color: #cbd5e1;">Hier</span>';
      } else if (isTomorrow) {
        statusBadge = '<span class="cal-badge-pill" style="background: rgba(99, 102, 241, 0.15); color: #a5b4fc;">Demain</span>';
      }

      dateHeader.innerHTML = `
        <div class="cal-agenda-date-title">
          <span class="cal-agenda-day-name">${dayName}</span>
          <span class="cal-agenda-day-number">${dayNum} ${monthName}</span>
        </div>
        ${statusBadge}
      `;
      groupContainer.appendChild(dateHeader);

      const cardsContainer = document.createElement('div');
      cardsContainer.className = 'cal-agenda-cards-container';

      groupEvents.forEach(ev => {
        const item = document.createElement('div');
        item.className = `cal-agenda-item ${ev.badgeClass || ''}`;
        item.setAttribute('tabindex', '0');
        item.setAttribute('role', 'button');

        const coverUrl = ev.cover || DEFAULT_COVER;
        const isReminded = state.reminders.has(ev.id);

        item.innerHTML = `
          <div class="cal-agenda-item-thumb-box">
            <img src="${escapeHtml(coverUrl)}" class="cal-agenda-item-thumb" alt="" loading="lazy" onerror="window.handleCalCoverError(this)">
          </div>
          <div class="cal-agenda-item-info">
            <div class="cal-agenda-item-badges">
              <span class="cal-badge-pill ${ev.badgeClass}">
                ${escapeHtml(ev.statusLabel)}
              </span>
            </div>
            <h4 class="cal-agenda-item-title">${escapeHtml(ev.title)}</h4>
            <div class="cal-agenda-item-meta">
              <span class="cal-agenda-item-vol">${escapeHtml(ev.volume)}</span>
              ${ev.team ? `<span class="cal-agenda-item-team"><i class="fa-solid fa-users"></i> ${escapeHtml(ev.team)}</span>` : ''}
            </div>
            ${ev.description ? `<p class="cal-agenda-item-desc">${escapeHtml(ev.description)}</p>` : ''}
          </div>
          <div class="cal-agenda-item-actions">
            ${ev.hasReader ? `
              <button type="button" class="cal-btn-quick-read" title="Lire maintenant">
                <i class="fa-solid fa-book-open"></i> <span>Lire</span>
              </button>
            ` : `
              <button type="button" class="cal-btn-quick-view" title="Voir les détails">
                <i class="fa-solid fa-circle-info"></i> <span>Détails</span>
              </button>
            `}
            <button type="button" class="cal-btn-remind ${isReminded ? 'active' : ''}" title="${isReminded ? 'Rappel activé' : 'Me rappeler'}">
              <i class="fa-${isReminded ? 'solid' : 'regular'} fa-bell"></i>
            </button>
          </div>
        `;

        // Événements boutons
        item.addEventListener('click', () => openEventModal(ev));

        const quickReadBtn = item.querySelector('.cal-btn-quick-read');
        if (quickReadBtn) {
          quickReadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            launchReader(ev);
          });
        }

        const remindBtn = item.querySelector('.cal-btn-remind');
        if (remindBtn) {
          remindBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleReminder(ev, remindBtn);
          });
        }

        cardsContainer.appendChild(item);
      });

      groupContainer.appendChild(cardsContainer);
      fragment.appendChild(groupContainer);
    });

    agendaEl.appendChild(fragment);
  }

  /**
   * Modal Détail Événement
   */
  function openEventModal(ev) {
    const modalEl = document.getElementById('calEventModal');
    const bodyEl = document.getElementById('calEventModalBody');
    if (!modalEl || !bodyEl) return;

    const coverUrl = ev.cover || DEFAULT_COVER;
    const formattedDate = ev.date ? `${ev.date.getDate()} ${MONTH_NAMES_FR[ev.date.getMonth()]} ${ev.date.getFullYear()}` : '';

    bodyEl.innerHTML = `
      <div class="cal-modal-header">
        <div class="cal-modal-cover-wrapper">
          <img src="${escapeHtml(coverUrl)}" class="cal-modal-cover" alt="" onerror="window.handleCalCoverError(this)">
        </div>
        <div class="cal-modal-info">
          <div class="cal-modal-badges-row">
            <span class="cal-badge-pill ${ev.badgeClass}">${escapeHtml(ev.statusLabel)}</span>
          </div>
          <h2 class="cal-modal-title" id="calModalTitle">${escapeHtml(ev.title)}</h2>
          <div class="cal-modal-vol-tag">${escapeHtml(ev.volume)}</div>
          <div class="cal-modal-meta-list">
            ${formattedDate ? `<div class="cal-modal-meta-item"><i class="fa-regular fa-calendar-check"></i> <span>Sortie le ${formattedDate}</span></div>` : ''}
            ${ev.team ? `<div class="cal-modal-meta-item"><i class="fa-solid fa-feather-pointed"></i> <span>${escapeHtml(ev.team)}</span></div>` : ''}
          </div>
        </div>
      </div>
      <div class="cal-modal-synopsis">
        <h4 class="cal-modal-synopsis-label">Synopsis</h4>
        <p class="cal-modal-synopsis-text">${escapeHtml(ev.description || 'Aucun synopsis disponible pour cette parution.')}</p>
      </div>
      <div class="cal-modal-actions">
        ${ev.hasReader ? `
          <button type="button" class="cal-btn-quick-read" id="calModalReadBtn">
            <i class="fa-solid fa-book-open"></i> <span>Lire ce tome</span>
          </button>
        ` : ''}
        ${ev.novelId ? `
          <button type="button" class="cal-btn-quick-view" id="calModalSeriesBtn">
            <i class="fa-solid fa-layer-group"></i> <span>Voir la série</span>
          </button>
        ` : ''}
      </div>
    `;

    const readBtn = bodyEl.querySelector('#calModalReadBtn');
    if (readBtn) {
      readBtn.addEventListener('click', () => {
        closeEventModal();
        launchReader(ev);
      });
    }

    const seriesBtn = bodyEl.querySelector('#calModalSeriesBtn');
    if (seriesBtn) {
      seriesBtn.addEventListener('click', () => {
        closeEventModal();
        if (ev.novelId) {
          window.location.href = '/series.html?id=' + encodeURIComponent(ev.novelId);
        }
      });
    }

    modalEl.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeEventModal() {
    const modalEl = document.getElementById('calEventModal');
    if (modalEl) modalEl.classList.add('hidden');
    document.body.style.overflow = '';
  }

  function launchReader(ev) {
    if (!ev) return;

    let targetBook = null;

    // 1. Tenter de retrouver le tome exact dans le catalogue chargé en mémoire
    if (ev.novelId && state.catalog && state.catalog.length > 0) {
      const matchedNovel = state.catalog.find(n => n.id === ev.novelId);
      if (matchedNovel && matchedNovel.volumes && matchedNovel.volumes.length > 0) {
        let matchedVol = null;
        if (ev.volumeId) {
          matchedVol = matchedNovel.volumes.find(v => v.id === ev.volumeId);
        }
        if (!matchedVol && ev.volumeNumber) {
          matchedVol = matchedNovel.volumes.find(v => String(v.volume_number || v.volumeNumber) === String(ev.volumeNumber));
        }
        if (!matchedVol && ev.volume) {
          const numMatch = String(ev.volume).match(/\d+/);
          if (numMatch) {
            matchedVol = matchedNovel.volumes.find(v => String(v.volume_number || v.volumeNumber) === numMatch[0]);
          }
        }
        if (!matchedVol) {
          matchedVol = matchedNovel.volumes[0];
        }

        if (matchedVol && (matchedVol.file_path || matchedVol.filePath)) {
          const fp = matchedVol.file_path || matchedVol.filePath;
          targetBook = {
            id: matchedVol.id || `vol_${matchedNovel.id}_${matchedVol.volume_number || 1}`,
            seriesId: matchedNovel.id,
            seriesTitle: matchedNovel.title,
            title: `${matchedNovel.title} - ${matchedVol.title || ('Tome ' + (matchedVol.volume_number || 1))}`,
            volumeNumber: matchedVol.volume_number || 1,
            format: fp.endsWith('.pdf') ? 'pdf' : 'epub',
            file_path: fp,
            filePath: fp,
            cover: matchedVol.cover_url || matchedVol.cover || matchedNovel.cover_url || matchedNovel.cover || ev.cover || '',
            allow_download: matchedNovel.allow_download !== false
          };
        }
      }
    }

    // 2. Si on a directement filePath sur ev
    if (!targetBook && ev.filePath) {
      targetBook = {
        id: ev.volumeId || ev.id,
        seriesId: ev.novelId || '',
        seriesTitle: ev.title,
        title: `${ev.title} - ${ev.volume || 'Lecture'}`,
        volumeNumber: ev.volumeNumber || 1,
        format: ev.filePath.endsWith('.pdf') ? 'pdf' : 'epub',
        file_path: ev.filePath,
        filePath: ev.filePath,
        cover: ev.cover || ''
      };
    }

    // 3. Ouvrir directement le lecteur in-page si disponible sur la page courante
    if (targetBook && typeof window.openBookReader === 'function') {
      window.openBookReader(targetBook);
      return;
    }

    // 4. Redirection vers la fiche de la série avec le tome en paramètre
    if (ev.novelId) {
      const volParam = ev.volumeNumber ? `&vol=${encodeURIComponent(ev.volumeNumber)}` : '';
      window.location.href = `/series.html?id=${encodeURIComponent(ev.novelId)}${volParam}`;
    }
  }

  function toggleReminder(ev, btn) {
    if (state.reminders.has(ev.id)) {
      state.reminders.delete(ev.id);
      btn.classList.remove('active');
      const icon = btn.querySelector('i');
      if (icon) {
        icon.className = 'fa-regular fa-bell';
      }
      showToast('Rappel supprimé');
    } else {
      state.reminders.add(ev.id);
      btn.classList.add('active');
      const icon = btn.querySelector('i');
      if (icon) {
        icon.className = 'fa-solid fa-bell';
      }
      showToast('🔔 Rappel activé pour ' + ev.title);
    }
    saveReminders();
  }

  function showToast(message) {
    const existing = document.querySelector('.cal-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'cal-toast';
    toast.innerHTML = `<i class="fa-solid fa-circle-check" style="color: #22c55e;"></i> <span>${escapeHtml(message)}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.transition = 'opacity 0.3s, transform 0.3s';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(15px)';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  /**
   * Écouteurs d'événements
   */
  function bindEvents() {
    // Navigation Mois Précédent
    const prevBtn = document.getElementById('calPrevMonthBtn');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (state.selectedMonth === 0) {
          state.selectedMonth = 11;
          state.selectedYear -= 1;
        } else {
          state.selectedMonth -= 1;
        }
        state.selectedDay = null;
        renderCalendar();
      });
    }

    // Navigation Mois Suivant
    const nextBtn = document.getElementById('calNextMonthBtn');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (state.selectedMonth === 11) {
          state.selectedMonth = 0;
          state.selectedYear += 1;
        } else {
          state.selectedMonth += 1;
        }
        state.selectedDay = null;
        renderCalendar();
      });
    }

    // Bouton Aujourd'hui
    const todayBtn = document.getElementById('calTodayBtn');
    if (todayBtn) {
      todayBtn.addEventListener('click', () => {
        const now = new Date();
        state.selectedYear = now.getFullYear();
        state.selectedMonth = now.getMonth();
        state.selectedDay = now.getDate();
        renderCalendar();
      });
    }

    // Recherche en direct
    const searchInput = document.getElementById('calNovelSearchInput');
    const searchClear = document.getElementById('calSearchClearBtn');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value.trim();
        if (searchClear) {
          searchClear.classList.toggle('hidden', state.searchQuery.length === 0);
        }
        renderCalendar();
      });
    }

    if (searchClear && searchInput) {
      searchClear.addEventListener('click', () => {
        searchInput.value = '';
        state.searchQuery = '';
        searchClear.classList.add('hidden');
        renderCalendar();
      });
    }

    // Boutons de Filtres
    const filterBtns = document.querySelectorAll('.cal-filter-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        state.activeFilter = btn.getAttribute('data-filter') || 'all';
        renderCalendar();
      });
    });

    // Bouton Réinitialiser Filtre
    const resetFilterBtn = document.getElementById('calResetFilterBtn');
    if (resetFilterBtn) {
      resetFilterBtn.addEventListener('click', () => {
        state.activeFilter = 'all';
        state.searchQuery = '';
        state.selectedDay = null;
        if (searchInput) searchInput.value = '';
        if (searchClear) searchClear.classList.add('hidden');
        const allBtn = document.querySelector('.cal-filter-btn[data-filter="all"]');
        if (allBtn) {
          filterBtns.forEach(b => b.classList.remove('active'));
          allBtn.classList.add('active');
        }
        renderCalendar();
      });
    }

    // Bascule Mode Grille / Agenda
    const gridSwitchBtn = document.getElementById('calViewGridBtn');
    const agendaSwitchBtn = document.getElementById('calViewAgendaBtn');

    if (gridSwitchBtn && agendaSwitchBtn) {
      gridSwitchBtn.addEventListener('click', () => {
        state.viewMode = 'grid';
        gridSwitchBtn.classList.add('active');
        gridSwitchBtn.setAttribute('aria-pressed', 'true');
        agendaSwitchBtn.classList.remove('active');
        agendaSwitchBtn.setAttribute('aria-pressed', 'false');
        renderCalendar();
      });

      agendaSwitchBtn.addEventListener('click', () => {
        state.viewMode = 'agenda';
        agendaSwitchBtn.classList.add('active');
        agendaSwitchBtn.setAttribute('aria-pressed', 'true');
        gridSwitchBtn.classList.remove('active');
        gridSwitchBtn.setAttribute('aria-pressed', 'false');
        renderCalendar();
      });
    }

    // Fermeture Modal
    const modalCloseBtn = document.getElementById('calEventModalClose');
    if (modalCloseBtn) {
      modalCloseBtn.addEventListener('click', closeEventModal);
    }

    const modalEl = document.getElementById('calEventModal');
    if (modalEl) {
      modalEl.addEventListener('click', (e) => {
        if (e.target === modalEl) closeEventModal();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeEventModal();
    });

    // Redimensionnement
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (state.isInitialized) {
          renderCalendar();
        }
      }, 200);
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // API Publique
  window.EditorialManager = {
    init: function() {
      if (!state.isInitialized) {
        init();
      } else {
        renderCalendar();
      }
    },
    loadData: loadData,
    render: renderCalendar,
    switchTab: function() {
      renderCalendar();
    },
    openEventModal: openEventModal
  };

  // Chargement automatique lors d'accès par URL hash
  document.addEventListener('DOMContentLoaded', () => {
    const hash = window.location.hash;
    if (hash === '#planning' || hash === '#calendar' || hash === '#calendrier') {
      init();
    }
  });

})();
