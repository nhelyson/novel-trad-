/**
 * NovelTrad - Calendrier Officiel & Centre d'Actualité des Light Novels
 * Architecture inspirée de Kadokawa (grille mensuelle 7 jours, navigation Lundi->Dimanche)
 * et de LNRelease (présentation structurée: date, titre, volume, type de parution, statut).
 * 
 * Intégration fidèle au design system sombre de NovelTrad.
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
    viewMode: window.innerWidth <= 768 ? 'agenda' : 'grid', // 'grid' | 'agenda'
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
    state.isInitialized = true;
  }

  /**
   * Chargement des rappels sauvegardés en local
   */
  function loadReminders() {
    try {
      const stored = localStorage.getItem('noveltrad_calendar_reminders');
      if (stored) {
        state.reminders = new Set(JSON.parse(stored));
      }
    } catch (e) {
      console.warn('[Calendar] Erreur lecture rappels:', e);
      state.reminders = new Set();
    }
  }

  function saveReminders() {
    try {
      localStorage.setItem('noveltrad_calendar_reminders', JSON.stringify(Array.from(state.reminders)));
    } catch (e) {
      console.warn('[Calendar] Erreur sauvegarde rappels:', e);
    }
  }

  /**
   * Récupération des données réelles du catalogue et du planning
   */
  async function loadData() {
    state.isLoading = true;
    try {
      const [catalogRes, schedRes, newsRes] = await Promise.allSettled([
        fetch('/api/catalog'),
        fetch('/api/editorial/schedule'),
        fetch('/api/editorial/news')
      ]);

      if (catalogRes.status === 'fulfilled' && catalogRes.value.ok) {
        const catData = await catalogRes.value.json();
        state.catalogNovels = catData.novels || catData.series || [];
      }

      if (schedRes.status === 'fulfilled' && schedRes.value.ok) {
        const schedData = await schedRes.value.json();
        state.scheduleItems = schedData.schedule || [];
      }

      if (newsRes.status === 'fulfilled' && newsRes.value.ok) {
        const newsData = await newsRes.value.json();
        state.newsItems = newsData.news || [];
      }

      aggregateEvents();
    } catch (err) {
      console.error('[Calendar] Erreur chargement données:', err);
    } finally {
      state.isLoading = false;
    }
  }

  /**
   * Normalisation des dates (YYYY-MM-DD, ISO ou Timestamp)
   */
  function parseDate(raw) {
    if (!raw) return null;
    if (typeof raw === 'number') {
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        return new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10));
      }
      const d = new Date(trimmed);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  function formatDateIso(d) {
    if (!d) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /**
   * Agrégation intelligente des données réelles du projet
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
          volume: vol.title || `Vol. ${volNum}`,
          volumeNumber: volNum,
          cover: vol.cover_url || vol.cover || novel.cover_url || novel.cover || '',
          date: releaseDate,
          dateIso: formatDateIso(releaseDate),
          type: 'volumes',
          subType: 'translation', // Un volume traduit disponible
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
            statusLabel: '🆕 Nouveauté',
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

      const schedKey = `sched_${item.id || item.seriesId}_${formatDateIso(releaseDate)}`;
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
        badgeClass = 'badge-announcement';
      } else if (isTrad) {
        typeCategory = 'translations';
        statusLabel = isAvailable ? '🟢 Traduction disponible' : '🟣 Traduction';
        badgeClass = isAvailable ? 'badge-available' : 'badge-translation';
      } else if (isAvailable) {
        statusLabel = '🟢 Disponible';
        badgeClass = 'badge-available';
      }

      list.push({
        id: item.id || schedKey,
        novelId: item.seriesId,
        title: item.seriesTitle || 'Parution programmée',
        volume: item.volumeOrChapter ? (item.volumeOrChapter.startsWith('Vol') ? item.volumeOrChapter : `Vol. ${item.volumeOrChapter}`) : 'Parution',
        cover: item.coverUrl || '',
        date: releaseDate,
        dateIso: formatDateIso(releaseDate),
        type: typeCategory,
        status: isAvailable ? 'available' : 'planned',
        statusLabel: statusLabel,
        badgeClass: badgeClass,
        badgeIcon: isAvailable ? 'fa-check' : (isTrad ? 'fa-language' : (isAnnounce ? 'fa-bullhorn' : 'fa-calendar')),
        hasReader: isAvailable,
        team: item.team || 'Team NovelTrad',
        description: `Sortie officielle prévue le ${releaseDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`
      });
    });

    // 4. Annonces et Actualités Officielles
    state.newsItems.forEach(news => {
      const newsDate = parseDate(news.createdAt);
      if (!newsDate) return;

      const newsKey = `news_${news.id}_${formatDateIso(newsDate)}`;
      if (seenEventKeys.has(newsKey)) return;
      seenEventKeys.add(newsKey);

      list.push({
        id: news.id || newsKey,
        novelId: news.seriesId || null,
        title: news.title || 'Annonce Officielle',
        volume: news.category || 'Annonce',
        cover: news.imageUrl || '',
        date: newsDate,
        dateIso: formatDateIso(newsDate),
        type: 'announcements',
        status: 'info',
        statusLabel: '📢 Annonce',
        badgeClass: 'badge-announcement',
        badgeIcon: 'fa-bullhorn',
        hasReader: false,
        team: news.author || 'Équipe NovelTrad',
        description: news.excerpt || news.content || 'Annonce et actualité officielle de la communauté NovelTrad.'
      });
    });

    state.events = list;
  }

  /**
   * Filtrage des événements pour le mois sélectionné
   */
  function getFilteredEventsForMonth() {
    const year = state.selectedYear;
    const month = state.selectedMonth;

    return state.events.filter(ev => {
      if (!ev.date) return false;
      const evYear = ev.date.getFullYear();
      const evMonth = ev.date.getMonth();

      if (evYear !== year || evMonth !== month) return false;

      if (state.activeFilter === 'all') return true;
      if (state.activeFilter === 'translations') return ev.type === 'translations' || ev.subType === 'translation';
      if (state.activeFilter === 'volumes') return ev.type === 'volumes';
      if (state.activeFilter === 'new') return ev.type === 'new';
      if (state.activeFilter === 'announcements') return ev.type === 'announcements';

      return true;
    });
  }

  /**
   * Calcul des compteurs par filtre pour le mois en cours
   */
  function updateFilterCounts() {
    const year = state.selectedYear;
    const month = state.selectedMonth;

    const monthEvents = state.events.filter(ev => {
      return ev.date && ev.date.getFullYear() === year && ev.date.getMonth() === month;
    });

    const counts = {
      all: monthEvents.length,
      translations: monthEvents.filter(ev => ev.type === 'translations' || ev.subType === 'translation').length,
      volumes: monthEvents.filter(ev => ev.type === 'volumes').length,
      new: monthEvents.filter(ev => ev.type === 'new').length,
      announcements: monthEvents.filter(ev => ev.type === 'announcements').length
    };

    const countAllEl = document.getElementById('calCountAll');
    if (countAllEl) countAllEl.textContent = counts.all;

    const countTransEl = document.getElementById('calCountTranslations');
    if (countTransEl) countTransEl.textContent = counts.translations;

    const countVolsEl = document.getElementById('calCountVolumes');
    if (countVolsEl) countVolsEl.textContent = counts.volumes;

    const countNewEl = document.getElementById('calCountNew');
    if (countNewEl) countNewEl.textContent = counts.new;

    const countAnnEl = document.getElementById('calCountAnnouncements');
    if (countAnnEl) countAnnEl.textContent = counts.announcements;
  }

  /**
   * Rendu complet du calendrier (En-tête, Grille mensuelle, Mode Agenda)
   */
  
  /**
   * Rendu du ruban horizontal de sélection des jours (Mobile & Agenda)
   */
  function renderDayStrip(events) {
    const stripEl = document.getElementById('calDayStrip');
    if (!stripEl) return;
    stripEl.innerHTML = '';

    const year = state.selectedYear;
    const month = state.selectedMonth;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
    const todayDate = today.getDate();

    // Jours contenant des parutions dans le mois
    const daysWithEvents = new Set();
    events.forEach(ev => {
      if (ev.date && ev.date.getFullYear() === year && ev.date.getMonth() === month) {
        daysWithEvents.add(ev.date.getDate());
      }
    });

    const SHORT_DAYS_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    const fragment = document.createDocumentFragment();

    // 1. Pastille "Tout le mois"
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

    // 2. Pastilles pour chaque jour
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
        (isToday ? ' is-today' : '') +
        (hasEvents ? ' has-events' : '');
      dayBtn.setAttribute('data-day', String(d));
      dayBtn.setAttribute('title', d + ' ' + MONTH_NAMES_FR[month] + (isToday ? " (Aujourd'hui)" : ''));

      dayBtn.innerHTML = `
        <span class="cal-day-strip-name">${dayName}</span>
        <span class="cal-day-strip-num">${d}</span>
        ${hasEvents ? '<span class="cal-day-strip-dot"></span>' : ''}
      `;

      dayBtn.addEventListener('click', () => {
        if (state.selectedDay === d) {
          state.selectedDay = null;
        } else {
          state.selectedDay = d;
        }
        renderCalendar();
      });

      fragment.appendChild(dayBtn);
    }

    stripEl.appendChild(fragment);

    // Centrer le jour sélectionné ou aujourd'hui
    const targetDay = state.selectedDay || (isCurrentMonth ? todayDate : null);
    if (targetDay) {
      setTimeout(() => {
        const activeEl = document.getElementById('calDayStripItem_' + targetDay);
        if (activeEl) {
          activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
      }, 50);
    }
  }

  function renderCalendar() {
    updateHeaderUI();
    updateFilterCounts();
    renderDayStrip(filteredEvents);

    const filteredEvents = getFilteredEventsForMonth();
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
        if (gridWrapperEl) gridWrapperEl.classList.add('hidden');
        if (agendaWrapperEl) agendaWrapperEl.classList.remove('hidden');
        renderAgendaList(filteredEvents);
      }
    }
  }

  /**
   * Mise à jour des libellés du mois et de l'année
   */
  function updateHeaderUI() {
    const monthNameEl = document.getElementById('calCurrentMonthName');
    if (monthNameEl) {
      monthNameEl.textContent = MONTH_NAMES_FR[state.selectedMonth];
    }
    const yearEl = document.getElementById('calCurrentYear');
    if (yearEl) {
      yearEl.textContent = String(state.selectedYear);
    }
  }

  /**
   * Rendu de la Grille Mensuelle 7 jours (Lundi à Dimanche)
   */
  function renderMonthlyGrid(events) {
    const gridEl = document.getElementById('calendarMonthlyGrid');
    if (!gridEl) return;
    gridEl.innerHTML = '';

    const year = state.selectedYear;
    const month = state.selectedMonth;

    const today = new Date();
    const isCurrentYearMonth = today.getFullYear() === year && today.getMonth() === month;
    const todayDate = today.getDate();

    // 1er jour du mois
    const firstDay = new Date(year, month, 1);
    // Décalage pour démarrer le Lundi (0 = Lundi, 6 = Dimanche)
    const startDayOffset = (firstDay.getDay() + 6) % 7;

    // Nombre de jours dans le mois
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // Nombre de jours dans le mois précédent
    const prevMonthDays = new Date(year, month, 0).getDate();

    // Mapper les événements par jour du mois (1-31)
    const eventsByDay = {};
    for (let d = 1; d <= daysInMonth; d++) {
      eventsByDay[d] = [];
    }
    events.forEach(ev => {
      const d = ev.date.getDate();
      if (eventsByDay[d]) {
        eventsByDay[d].push(ev);
      }
    });

    const fragment = document.createDocumentFragment();

    // 1. Jours du mois précédent pour combler la première semaine
    for (let i = startDayOffset - 1; i >= 0; i--) {
      const prevDayNum = prevMonthDays - i;
      const cell = document.createElement('div');
      cell.className = 'cal-day-cell cal-day-muted';
      cell.setAttribute('aria-hidden', 'true');
      cell.innerHTML = `
        <div class="cal-day-header">
          <span class="cal-day-number">${prevDayNum}</span>
        </div>
      `;
      fragment.appendChild(cell);
    }

    // 2. Jours du mois actuel
    for (let day = 1; day <= daysInMonth; day++) {
      const cell = document.createElement('div');
      const isToday = isCurrentYearMonth && day === todayDate;
      const dayEvents = eventsByDay[day] || [];
      const hasEvents = dayEvents.length > 0;

      cell.className = 'cal-day-cell' + 
        (isToday ? ' cal-day-today' : '') + 
        (hasEvents ? ' cal-day-has-events' : '');

      cell.setAttribute('tabindex', '0');
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-label', `${day} ${MONTH_NAMES_FR[month]} ${year}, ${dayEvents.length} événement(s)`);

      // En-tête de cellule : numéro du jour + badge Aujourd'hui
      const headerDiv = document.createElement('div');
      headerDiv.className = 'cal-day-header';
      headerDiv.innerHTML = `
        <span class="cal-day-number">${day}</span>
        ${isToday ? '<span class="cal-today-pill">Aujourd\'hui</span>' : ''}
      `;
      cell.appendChild(headerDiv);

      // Liste des événements dans la cellule
      if (hasEvents) {
        const eventsContainer = document.createElement('div');
        eventsContainer.className = 'cal-day-events-list';

        // Afficher jusqu'à 3 événements par cellule
        const visibleEvents = dayEvents.slice(0, 3);
        visibleEvents.forEach(ev => {
          const card = createEventCard(ev, 'cell');
          eventsContainer.appendChild(card);
        });

        // Indicateur "+X autres" si plus de 3 événements
        if (dayEvents.length > 3) {
          const moreBtn = document.createElement('button');
          moreBtn.type = 'button';
          moreBtn.className = 'cal-more-events-btn';
          moreBtn.textContent = `+${dayEvents.length - 3} autres`;
          moreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openDayEventsModal(day, dayEvents);
          });
          eventsContainer.appendChild(moreBtn);
        }

        cell.appendChild(eventsContainer);
      }

      fragment.appendChild(cell);
    }

    // 3. Jours du mois suivant pour combler la grille (grille complète de 35 ou 42 cellules)
    const totalCells = startDayOffset + daysInMonth;
    const remainingCells = (7 - (totalCells % 7)) % 7;
    for (let j = 1; j <= remainingCells; j++) {
      const cell = document.createElement('div');
      cell.className = 'cal-day-cell cal-day-muted';
      cell.setAttribute('aria-hidden', 'true');
      cell.innerHTML = `
        <div class="cal-day-header">
          <span class="cal-day-number">${j}</span>
        </div>
      `;
      fragment.appendChild(cell);
    }

    gridEl.appendChild(fragment);
  }

  /**
   * Création d'une carte d'événement optimisée
   */
  function createEventCard(ev, context) {
    const card = document.createElement('div');
    card.className = `cal-event-card ${ev.badgeClass || ''}`;
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${ev.title} - ${ev.volume} - ${ev.statusLabel}`);

    const defaultCover = DEFAULT_COVER;
    const coverUrl = ev.cover || defaultCover;

    card.innerHTML = `
      <div class="cal-event-thumb-wrap">
        <img src="${escapeHtml(coverUrl)}" class="cal-event-thumb" alt="" loading="lazy" onerror="window.handleCalCoverError(this)">
      </div>
      <div class="cal-event-details">
        <div class="cal-event-badge-row">
          <span class="cal-badge-pill ${ev.badgeClass}">${escapeHtml(ev.statusLabel)}</span>
        </div>
        <div class="cal-event-title" title="${escapeHtml(ev.title)}">${escapeHtml(ev.title)}</div>
        <div class="cal-event-vol">${escapeHtml(ev.volume)}</div>
      </div>
    `;

    card.addEventListener('click', (e) => {
      e.stopPropagation();
      openEventModal(ev);
    });

    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openEventModal(ev);
      }
    });

    return card;
  }

  /**
   * Rendu de la vue Agenda / Liste chronologique (Mobile & Tablette)
   */
  function renderAgendaList(events) {
    const agendaEl = document.getElementById('calendarAgendaList');
    if (!agendaEl) return;
    agendaEl.innerHTML = '';

    // Filtrage spécifique si un jour précis est sélectionné dans le ruban
    let displayEvents = events;
    if (state.selectedDay !== null) {
      displayEvents = events.filter(ev => ev.date && ev.date.getDate() === state.selectedDay);
    }

    if (displayEvents.length === 0 && state.selectedDay !== null) {
      const emptyDay = document.createElement('div');
      emptyDay.className = 'cal-empty-day-state';
      emptyDay.innerHTML = `
        <div class="cal-empty-day-icon"><i class="fa-regular fa-calendar-xmark"></i></div>
        <h4>Aucune sortie le ${state.selectedDay} ${MONTH_NAMES_FR[state.selectedMonth]} ${state.selectedYear}</h4>
        <p>Aucun roman ou chapitre n'est programmé pour cette journée.</p>
        <button type="button" class="btn-secondary cal-btn-see-month" id="calSeeAllMonthBtn">
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

    // Trier les événements par date croissante
    const sorted = [...displayEvents].sort((a, b) => a.date.getTime() - b.date.getTime());

    // Grouper par date ISO (YYYY-MM-DD)
    const groups = {};
    sorted.forEach(ev => {
      const key = ev.dateIso;
      if (!groups[key]) groups[key] = [];
      groups[key].push(ev);
    });

    const todayIso = formatDateIso(new Date());
    const fragment = document.createDocumentFragment();

    Object.keys(groups).forEach(dateIso => {
      const groupEvents = groups[dateIso];
      const sampleDate = groupEvents[0].date;
      const isToday = dateIso === todayIso;

      const groupContainer = document.createElement('div');
      groupContainer.className = 'cal-agenda-group' + (isToday ? ' cal-agenda-group-today' : '');

      const dateHeader = document.createElement('div');
      dateHeader.className = 'cal-agenda-date-header';

      const dayName = DAYS_NAMES_FR[(sampleDate.getDay() + 6) % 7];
      const dayNum = sampleDate.getDate();
      const monthName = MONTH_NAMES_FR[sampleDate.getMonth()];

      dateHeader.innerHTML = `
        <div class="cal-agenda-date-title">
          <span class="cal-agenda-day-name">${dayName}</span>
          <span class="cal-agenda-day-number">${dayNum} ${monthName}</span>
        </div>
        ${isToday ? '<span class="cal-today-pill">Aujourd\'hui</span>' : ''}
      `;
      groupContainer.appendChild(dateHeader);

      const cardsContainer = document.createElement('div');
      cardsContainer.className = 'cal-agenda-cards-container';

      groupEvents.forEach(ev => {
        const item = document.createElement('div');
        item.className = `cal-agenda-item ${ev.badgeClass || ''}`;
        item.setAttribute('tabindex', '0');
        item.setAttribute('role', 'button');

        const defaultCover = DEFAULT_COVER;
        const coverUrl = ev.cover || defaultCover;

        item.innerHTML = `
          <div class="cal-agenda-item-thumb-box">
            <img src="${escapeHtml(coverUrl)}" class="cal-agenda-item-thumb" alt="" loading="lazy" onerror="window.handleCalCoverError(this)">
          </div>
          <div class="cal-agenda-item-info">
            <div class="cal-agenda-item-badge">
              <span class="cal-badge-pill ${ev.badgeClass}">${escapeHtml(ev.statusLabel)}</span>
            </div>
            <h4 class="cal-agenda-item-title">${escapeHtml(ev.title)}</h4>
            <div class="cal-agenda-item-vol">${escapeHtml(ev.volume)}</div>
            ${ev.team ? `<div class="cal-agenda-item-team"><i class="fa-solid fa-users"></i> ${escapeHtml(ev.team)}</div>` : ''}
          </div>
          <div class="cal-agenda-item-actions">
            ${ev.hasReader ? `
              <button type="button" class="btn-primary cal-btn-quick-read" title="Lire maintenant">
                <i class="fa-solid fa-book-open"></i> <span>Lire</span>
              </button>
            ` : `
              <button type="button" class="btn-secondary cal-btn-quick-view" title="Voir les détails">
                <i class="fa-solid fa-circle-info"></i> <span>Détails</span>
              </button>
            `}
          </div>
        `;

        item.addEventListener('click', () => openEventModal(ev));
        const quickReadBtn = item.querySelector('.cal-btn-quick-read');
        if (quickReadBtn) {
          quickReadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            launchReader(ev);
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
   * Modal Détail d'un événement
   */
  function openEventModal(ev) {
    const modalEl = document.getElementById('calEventModal');
    const bodyEl = document.getElementById('calEventModalBody');
    if (!modalEl || !bodyEl) return;

    const defaultCover = DEFAULT_COVER;
    const coverUrl = ev.cover || defaultCover;

    const formattedDate = ev.date ? ev.date.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }) : 'Date à confirmer';

    const isNotified = state.reminders.has(ev.id);

    bodyEl.innerHTML = `
      <div class="cal-modal-grid">
        <div class="cal-modal-cover-side">
          <img src="${escapeHtml(coverUrl)}" class="cal-modal-cover" alt="${escapeHtml(ev.title)}" onerror="window.handleCalCoverError(this)">
          <div class="cal-modal-badge-container">
            <span class="cal-badge-pill ${ev.badgeClass}">${escapeHtml(ev.statusLabel)}</span>
          </div>
        </div>

        <div class="cal-modal-info-side">
          <h2 id="calModalTitle" class="cal-modal-title">${escapeHtml(ev.title)}</h2>
          <div class="cal-modal-volume-tag">${escapeHtml(ev.volume)}</div>

          <div class="cal-modal-meta-list">
            <div class="cal-modal-meta-item">
              <i class="fa-regular fa-calendar-check"></i>
              <span><strong>Date :</strong> ${formattedDate}</span>
            </div>
            ${ev.team ? `
              <div class="cal-modal-meta-item">
                <i class="fa-solid fa-feather-pointed"></i>
                <span><strong>Responsable :</strong> ${escapeHtml(ev.team)}</span>
              </div>
            ` : ''}
            <div class="cal-modal-meta-item">
              <i class="fa-solid fa-circle-info"></i>
              <span><strong>Statut :</strong> ${escapeHtml(ev.statusLabel)}</span>
            </div>
          </div>

          <div class="cal-modal-description">
            <p>${escapeHtml(ev.description)}</p>
          </div>

          <div class="cal-modal-actions-row">
            ${ev.hasReader ? `
              <button type="button" class="btn-primary" id="calModalReadAction">
                <i class="fa-solid fa-book-open"></i> <span>Lire maintenant</span>
              </button>
            ` : ''}

            ${ev.novelId ? `
              <button type="button" class="btn-secondary" id="calModalSeriesAction">
                <i class="fa-solid fa-layer-group"></i> <span>Voir la fiche</span>
              </button>
            ` : ''}

            ${!ev.hasReader ? `
              <button type="button" class="cal-btn-notify ${isNotified ? 'active' : ''}" id="calModalNotifyAction">
                <i class="fa-${isNotified ? 'solid' : 'regular'} fa-bell"></i>
                <span>${isNotified ? 'Rappel activé' : 'Me prévenir'}</span>
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    // Attacher les actions de la modal
    const readBtn = document.getElementById('calModalReadAction');
    if (readBtn) {
      readBtn.addEventListener('click', () => {
        closeEventModal();
        launchReader(ev);
      });
    }

    const seriesBtn = document.getElementById('calModalSeriesAction');
    if (seriesBtn) {
      seriesBtn.addEventListener('click', () => {
        closeEventModal();
        if (ev.novelId) {
          window.location.href = `/series.html?id=${encodeURIComponent(ev.novelId)}`;
        }
      });
    }

    const notifyBtn = document.getElementById('calModalNotifyAction');
    if (notifyBtn) {
      notifyBtn.addEventListener('click', () => {
        toggleReminder(ev, notifyBtn);
      });
    }

    modalEl.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeEventModal() {
    const modalEl = document.getElementById('calEventModal');
    if (modalEl) {
      modalEl.classList.add('hidden');
      document.body.style.overflow = '';
    }
  }

  /**
   * Modale pour afficher tous les événements d'une journée dense
   */
  function openDayEventsModal(day, dayEvents) {
    const modalEl = document.getElementById('calEventModal');
    const bodyEl = document.getElementById('calEventModalBody');
    if (!modalEl || !bodyEl) return;

    const monthName = MONTH_NAMES_FR[state.selectedMonth];
    const year = state.selectedYear;

    let itemsHtml = dayEvents.map(ev => `
      <div class="cal-day-modal-row" data-event-id="${escapeHtml(ev.id)}">
        <div class="cal-day-modal-thumb">
          <img src="${escapeHtml(ev.cover || '')}" alt="" onerror="this.style.display='none';">
        </div>
        <div class="cal-day-modal-info">
          <div class="cal-badge-pill ${ev.badgeClass}">${escapeHtml(ev.statusLabel)}</div>
          <h4 class="cal-day-modal-title">${escapeHtml(ev.title)}</h4>
          <span class="cal-day-modal-vol">${escapeHtml(ev.volume)}</span>
        </div>
        <button type="button" class="btn-secondary cal-btn-row-detail">Voir</button>
      </div>
    `).join('');

    bodyEl.innerHTML = `
      <div class="cal-day-modal-wrapper">
        <h2 id="calModalTitle" class="cal-modal-title">Sorties du ${day} ${monthName} ${year}</h2>
        <p class="cal-modal-sub">${dayEvents.length} événement(s) programmé(s)</p>
        <div class="cal-day-modal-list">
          ${itemsHtml}
        </div>
      </div>
    `;

    bodyEl.querySelectorAll('.cal-day-modal-row').forEach((row, idx) => {
      row.addEventListener('click', () => {
        openEventModal(dayEvents[idx]);
      });
    });

    modalEl.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  /**
   * Action de lecture d'un volume
   */
  function launchReader(ev) {
    if (ev.novelId) {
      window.location.href = `/series.html?id=${encodeURIComponent(ev.novelId)}`;
    }
  }

  /**
   * Bascule du rappel pour les parutions futures
   */
  function toggleReminder(ev, btn) {
    const isSaved = state.reminders.has(ev.id);
    if (isSaved) {
      state.reminders.delete(ev.id);
      btn.classList.remove('active');
      btn.innerHTML = '<i class="fa-regular fa-bell"></i> <span>Me prévenir</span>';
      showToast('Rappel retiré pour cette parution.');
    } else {
      state.reminders.add(ev.id);
      btn.classList.add('active');
      btn.innerHTML = '<i class="fa-solid fa-bell"></i> <span>Rappel activé</span>';
      showToast('🔔 Vous serez notifié lors de la sortie de cette œuvre !');
    }
    saveReminders();
  }

  /**
   * Toast notification non-bloquant
   */
  function showToast(message) {
    let toast = document.getElementById('calToastNotification');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'calToastNotification';
      toast.className = 'cal-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 3200);
  }

  /**
   * Attachement des écouteurs d'événements
   */
  function bindEvents() {
    // Écouteur de redimensionnement réactif (mobile / desktop)
    let _calResizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(_calResizeTimer);
      _calResizeTimer = setTimeout(() => {
        if (state.isInitialized) {
          renderCalendar();
        }
      }, 200);
    }); // cal_window_resize_handler
    // Navigation Mois Précédent
    const prevBtn = document.getElementById('calPrevMonthBtn');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (state.selectedMonth === 0) {
          state.selectedMonth = 11;
          state.selectedYear -= 1;
          state.selectedDay = null;
        } else {
          state.selectedMonth -= 1;
          state.selectedDay = null;
        }
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
          state.selectedDay = null;
        } else {
          state.selectedMonth += 1;
          state.selectedDay = null;
        }
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

    // Bouton Réinitialiser Filtre dans l'état vide
    const resetFilterBtn = document.getElementById('calResetFilterBtn');
    if (resetFilterBtn) {
      resetFilterBtn.addEventListener('click', () => {
        state.activeFilter = 'all';
        const allBtn = document.querySelector('.cal-filter-btn[data-filter="all"]');
        if (allBtn) allBtn.click();
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

    // Échap pour fermer la modale
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeEventModal();
    });

    // Gestion du redimensionnement de fenêtre
    window.addEventListener('resize', debounce(() => {
      const isMobile = window.innerWidth <= 768;
      if (isMobile && state.viewMode === 'grid') {
        if (agendaSwitchBtn) agendaSwitchBtn.click();
      }
    }, 200));
  }

  function debounce(fn, delay) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // API Publique pour compatibilité ascendante avec app.js et admin_logic.js
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

  // Chargement automatique si l'URL démarre sur le hash planning ou calendrier
  document.addEventListener('DOMContentLoaded', () => {
    const hash = window.location.hash;
    if (hash === '#planning' || hash === '#calendar' || hash === '#calendrier') {
      init();
    }
  });

})();
