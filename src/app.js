/**
 * MovieBox TV - Master Application Controller
 * Orchestrates navigation, remote D-pad input, concurrent multi-provider search,
 * intelligent quality selection, playback lifecycle, and local persistence.
 */

import { remoteController, TV_KEYS } from './remote/remote-controller.js';
import { catalogService } from './catalog/catalog.js';
import { searchAggregator } from './providers/aggregator.js';
import { providerRegistry } from './providers/provider-registry.js';
import { PlaybackAdapter } from './playback/playback-adapter.js';
import { subtitleManager } from './subtitles/subtitle-manager.js';
import { storageManager } from './storage/storage-manager.js';
import { logger } from './utils/logger.js';
import { formatTimeCode, formatResolution, escapeHtml } from './utils/formatters.js';

const TAG = 'MovieBoxApp';

const POSTER_FALLBACK_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 260 380'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' stop-color='%231a1e29'/%3E%3Cstop offset='100%25' stop-color='%230b0d14'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='260' height='380' fill='url(%23g)'/%3E%3Crect x='105' y='145' width='50' height='50' rx='10' fill='%23e50914' opacity='0.25'/%3E%3Cpath d='M123 160l18 10-18 10z' fill='%23e50914'/%3E%3Ctext x='130' y='225' font-family='sans-serif' font-size='14' font-weight='700' fill='%23ffffff' text-anchor='middle' opacity='0.6' letter-spacing='2'%3EMOVIEBOX%3C/text%3E%3C/svg%3E";

class MovieBoxApp {
  constructor() {
    this.currentScreen = 'home';
    this.screenHistory = [];
    this.searchQuery = '';
    this.searchDebounceTimer = null;
    this.playbackAdapter = null;
    this.activeMediaItem = null;
    this.activeStreams = [];
    this.selectedStreamCandidate = null;
    this.osdHideTimeout = null;

    this.init();
  }

  async init() {
    logger.info(TAG, 'Initializing MovieBox TV application');

    this.cacheElements();
    this.initPlayback();
    this.setupNavigation();
    this.setupVirtualKeyboard();
    this.setupRemoteHandlers();
    this.setupSettingsUI();

    // Load initial screen
    await this.navigateTo('home');
    logger.info(TAG, 'MovieBox TV application initialized successfully');
  }

  cacheElements() {
    this.els = {
      navHome: document.getElementById('nav-btn-home'),
      navSearch: document.getElementById('nav-btn-search'),
      navFavorites: document.getElementById('nav-btn-favorites'),
      navHistory: document.getElementById('nav-btn-history'),
      navSettings: document.getElementById('nav-btn-settings'),

      screenHome: document.getElementById('screen-home'),
      screenSearch: document.getElementById('screen-search'),
      screenFavorites: document.getElementById('screen-favorites'),
      screenHistory: document.getElementById('screen-history'),
      screenSettings: document.getElementById('screen-settings'),

      // Hero Billboard
      heroBackdrop: document.getElementById('hero-backdrop-img'),
      heroTitle: document.getElementById('hero-title'),
      heroSynopsis: document.getElementById('hero-synopsis'),
      heroResBadge: document.getElementById('hero-resolution-badge'),
      heroRatingBadge: document.getElementById('hero-rating-badge'),
      heroPlayBtn: document.getElementById('hero-play-btn'),
      heroDetailsBtn: document.getElementById('hero-details-btn'),
      heroFavBtn: document.getElementById('hero-fav-btn'),
      catalogContainer: document.getElementById('catalog-rows-container'),

      // Search
      searchField: document.getElementById('search-query-display'),
      keyboardGrid: document.getElementById('tv-virtual-keyboard'),
      providerPills: document.getElementById('search-provider-pills'),
      searchResultsTitle: document.getElementById('search-results-title'),
      searchResultsCount: document.getElementById('search-results-count'),
      searchResultsGrid: document.getElementById('search-results-grid'),

      // Favorites & History
      favoritesGrid: document.getElementById('favorites-grid'),
      historyGrid: document.getElementById('history-grid'),
      clearHistoryBtn: document.getElementById('clear-history-btn'),

      // Settings
      qualityGroup: document.getElementById('setting-quality-group'),
      strategyGroup: document.getElementById('setting-strategy-group'),
      engineGroup: document.getElementById('setting-engine-group'),
      subtitleGroup: document.getElementById('setting-subtitle-group'),
      providerHealthList: document.getElementById('provider-health-list'),
      btnPingProviders: document.getElementById('btn-ping-providers'),
      btnClearLogs: document.getElementById('btn-clear-logs'),
      logViewer: document.getElementById('diagnostics-log-viewer'),

      // Details Modal
      detailsModal: document.getElementById('details-modal'),
      detailPoster: document.getElementById('detail-poster-img'),
      detailTitle: document.getElementById('detail-title'),
      detailTagline: document.getElementById('detail-tagline'),
      detailDesc: document.getElementById('detail-description'),
      detailProviderBadge: document.getElementById('detail-provider-badge'),
      detailResBadge: document.getElementById('detail-res-badge'),
      detailRatingBadge: document.getElementById('detail-rating-badge'),
      detailYearBadge: document.getElementById('detail-year-badge'),
      detailDirector: document.getElementById('detail-director'),
      detailStars: document.getElementById('detail-stars'),
      detailGenres: document.getElementById('detail-genres'),
      detailStreamsRow: document.getElementById('detail-streams-row'),
      modalPlayBtn: document.getElementById('modal-play-btn'),
      modalFavBtn: document.getElementById('modal-fav-btn'),
      modalFavLabel: document.getElementById('modal-fav-label'),
      modalCloseBtn: document.getElementById('modal-close-btn'),

      // Player
      playerView: document.getElementById('player-view'),
      videoElement: document.getElementById('tv-video-element'),
      subtitleOverlay: document.getElementById('subtitle-overlay'),
      bufferingIndicator: document.getElementById('player-buffering-indicator'),
      playerOsd: document.getElementById('player-osd'),
      osdTitle: document.getElementById('osd-media-title'),
      osdSub: document.getElementById('osd-stream-metadata'),
      osdTimeCurrent: document.getElementById('osd-time-current'),
      osdTimeDuration: document.getElementById('osd-time-duration'),
      osdProgressFill: document.getElementById('osd-progress-fill'),
      osdBtnRewind: document.getElementById('osd-btn-rewind'),
      osdBtnPlayPause: document.getElementById('osd-btn-playpause'),
      osdIconPlay: document.getElementById('osd-icon-play'),
      osdIconPause: document.getElementById('osd-icon-pause'),
      osdPlayPauseText: document.getElementById('osd-playpause-text'),
      osdBtnForward: document.getElementById('osd-btn-forward'),
      osdBtnQuality: document.getElementById('osd-btn-quality'),
      osdQualityLabel: document.getElementById('osd-quality-label'),
      osdBtnSubtitles: document.getElementById('osd-btn-subtitles'),
      osdSubtitleLabel: document.getElementById('osd-subtitle-label'),
      osdBtnClose: document.getElementById('osd-btn-close'),
      osdStatusFlash: document.getElementById('osd-status-flash'),

      // Player Error
      playerErrorOverlay: document.getElementById('player-error-overlay'),
      playerErrorMessage: document.getElementById('player-error-message'),
      errorBtnRetry: document.getElementById('error-btn-retry'),
      errorBtnExit: document.getElementById('error-btn-exit'),

      // Toast
      toast: document.getElementById('tv-toast'),
      toastMessage: document.getElementById('tv-toast-message'),
    };

    subtitleManager.setOverlayElement(this.els.subtitleOverlay);
  }

  initPlayback() {
    this.playbackAdapter = new PlaybackAdapter(this.els.videoElement, {
      onStateChange: (state) => this.handlePlaybackState(state),
      onTimeUpdate: (current, duration) => this.handlePlaybackTime(current, duration),
      onDurationChange: (duration) => this.handlePlaybackDuration(duration),
      onStreamSelected: (stream, pool) => this.handleStreamSelected(stream, pool),
      onEngineChange: (engineType) => this.handleEngineChange(engineType),
      onError: (err) => this.handlePlaybackError(err),
    });
  }

  handleEngineChange(engineType) {
    if (engineType === 'avplay') {
      this.els.playerView.classList.add('hw-playing');
      document.body.classList.add('hw-playing');
    } else {
      this.els.playerView.classList.remove('hw-playing');
      document.body.classList.remove('hw-playing');
    }
  }

  setupNavigation() {
    const navButtons = [
      { btn: this.els.navHome, screen: 'home' },
      { btn: this.els.navSearch, screen: 'search' },
      { btn: this.els.navFavorites, screen: 'favorites' },
      { btn: this.els.navHistory, screen: 'history' },
      { btn: this.els.navSettings, screen: 'settings' },
    ];

    for (const { btn, screen } of navButtons) {
      if (!btn) continue;
      btn.addEventListener('click', () => {
        this.navigateTo(screen);
      });
    }

    // Modal controls
    this.els.modalCloseBtn.addEventListener('click', () => this.closeDetailsModal());
    this.els.modalPlayBtn.addEventListener('click', () => {
      if (this.activeMediaItem) {
        this.startPlayback(this.activeMediaItem, this.selectedStreamCandidate);
      }
    });
    this.els.modalFavBtn.addEventListener('click', () => {
      if (this.activeMediaItem) {
        const isFav = storageManager.toggleFavorite(this.activeMediaItem);
        this.els.modalFavLabel.textContent = isFav ? 'Remove Favorite' : 'Add Favorite';
        this.showToast(isFav ? 'Added to Favorites' : 'Removed from Favorites');
      }
    });

    // History controls
    this.els.clearHistoryBtn.addEventListener('click', () => {
      storageManager.clearHistory();
      this.renderHistoryScreen();
      this.showToast('Watch history cleared');
    });

    // Player OSD Controls
    this.els.osdBtnClose.addEventListener('click', () => this.exitPlayer());
    this.els.osdBtnPlayPause.addEventListener('click', () => this.playbackAdapter.togglePlayPause());
    this.els.osdBtnRewind.addEventListener('click', () => this.playbackAdapter.seekRelative(-10));
    this.els.osdBtnForward.addEventListener('click', () => this.playbackAdapter.seekRelative(10));
    this.els.osdBtnQuality.addEventListener('click', () => this.cycleQualityPreference());
    this.els.osdBtnSubtitles.addEventListener('click', () => this.cycleSubtitleLanguage());

    // Player Error Controls
    this.els.errorBtnRetry.addEventListener('click', () => {
      this.els.playerErrorOverlay.style.display = 'none';
      this.playbackAdapter.retryWithFallback();
    });
    this.els.errorBtnExit.addEventListener('click', () => {
      this.exitPlayer();
    });
  }

  setupRemoteHandlers() {
    // Top-level back handler
    remoteController.pushBackHandler(() => {
      // 1. If player is active, close player
      if (this.els.playerView.style.display !== 'none') {
        this.exitPlayer();
        return true;
      }

      // 2. If details modal is open, close modal
      if (this.els.detailsModal.classList.contains('active')) {
        this.closeDetailsModal();
        return true;
      }

      // 3. If on search screen with query text, clear query first
      if (this.currentScreen === 'search' && this.searchQuery.length > 0) {
        this.searchQuery = '';
        this.els.searchField.value = '';
        this.performSearch('');
        return true;
      }

      // 4. If on secondary screen, go home
      if (this.currentScreen !== 'home') {
        this.navigateTo('home');
        return true;
      }

      // 5. If on home screen, exit app gracefully on Samsung Tizen
      if (typeof window !== 'undefined' && window.tizen && window.tizen.application) {
        try {
          window.tizen.application.getCurrentApplication().exit();
        } catch (e) {
          logger.info(TAG, 'Exit called');
        }
      }
      return false;
    });

    // Global media key handler for remote play/pause/rewind/fast-forward
    remoteController.pushKeyHandler((event, code) => {
      if (this.els.playerView.style.display !== 'none') {
        this.showPlayerOsd();

        switch (code) {
          case TV_KEYS.PLAY:
            this.playbackAdapter.play();
            return true;
          case TV_KEYS.PAUSE:
            this.playbackAdapter.pause();
            return true;
          case TV_KEYS.PLAY_PAUSE:
            this.playbackAdapter.togglePlayPause();
            return true;
          case TV_KEYS.STOP:
            this.exitPlayer();
            return true;
          case TV_KEYS.REWIND:
            this.playbackAdapter.seekRelative(-15);
            this.flashOsdStatus('« Rewind 15s');
            return true;
          case TV_KEYS.FAST_FWD:
            this.playbackAdapter.seekRelative(15);
            this.flashOsdStatus('Forward 15s »');
            return true;
        }
      }
      return false;
    });
  }

  async navigateTo(screenId) {
    logger.info(TAG, `Navigating to screen: ${screenId}`);
    this.currentScreen = screenId;

    // Update nav buttons
    const navItems = [
      { el: this.els.navHome, id: 'home' },
      { el: this.els.navSearch, id: 'search' },
      { el: this.els.navFavorites, id: 'favorites' },
      { el: this.els.navHistory, id: 'history' },
      { el: this.els.navSettings, id: 'settings' },
    ];

    for (const item of navItems) {
      if (!item.el) continue;
      if (item.id === screenId) {
        item.el.classList.add('active');
      } else {
        item.el.classList.remove('active');
      }
    }

    // Hide all screens
    const screens = [
      this.els.screenHome,
      this.els.screenSearch,
      this.els.screenFavorites,
      this.els.screenHistory,
      this.els.screenSettings,
    ];

    for (const s of screens) {
      if (s) s.classList.remove('active');
    }

    // Show target screen
    switch (screenId) {
      case 'home':
        this.els.screenHome.classList.add('active');
        await this.renderHomeScreen();
        remoteController.focusElement(this.els.heroPlayBtn);
        break;
      case 'search':
        this.els.screenSearch.classList.add('active');
        const firstKey = this.els.keyboardGrid.querySelector('.key-btn');
        if (firstKey) remoteController.focusElement(firstKey);
        break;
      case 'favorites':
        this.els.screenFavorites.classList.add('active');
        this.renderFavoritesScreen();
        break;
      case 'history':
        this.els.screenHistory.classList.add('active');
        this.renderHistoryScreen();
        break;
      case 'settings':
        this.els.screenSettings.classList.add('active');
        this.renderSettingsScreen();
        break;
    }
  }

  // --- Home Screen ---
  async renderHomeScreen() {
    const featured = await catalogService.getFeaturedItem();
    if (featured) {
      this.activeFeaturedItem = featured;
      this.els.heroTitle.textContent = featured.title;
      this.els.heroSynopsis.textContent = featured.description || featured.tagline || '';
      if (featured.backdropUrl) {
        this.els.heroBackdrop.style.backgroundImage = `url("${featured.backdropUrl}")`;
      }
      this.els.heroResBadge.textContent = '4K ULTRA HD';
      this.els.heroRatingBadge.textContent = `IMDB ${featured.imdbRating || '8.2'}`;

      this.els.heroPlayBtn.onclick = () => this.openDetailsModal(featured, true);
      this.els.heroDetailsBtn.onclick = () => this.openDetailsModal(featured, false);
      this.els.heroFavBtn.onclick = () => {
        const isFav = storageManager.toggleFavorite(featured);
        this.showToast(isFav ? 'Added to Favorites' : 'Removed from Favorites');
      };
    }

    // Render Carousels
    const rows = await catalogService.getHomeRows();
    this.els.catalogContainer.innerHTML = '';

    rows.forEach((row, rowIndex) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'catalog-row';

      rowEl.innerHTML = `
        <div class="row-header">
          <h2 class="row-title">${escapeHtml(row.title)}</h2>
          <span class="row-badge">${escapeHtml(row.badge)}</span>
        </div>
        <div class="row-carousel" id="carousel-${rowIndex}"></div>
      `;

      const carouselEl = rowEl.querySelector('.row-carousel');
      row.items.forEach((item) => {
        const card = this.createPosterCard(item);
        carouselEl.appendChild(card);
      });

      this.els.catalogContainer.appendChild(rowEl);
    });
  }

  createPosterCard(item) {
    const card = document.createElement('button');
    card.className = 'poster-card focusable';
    card.setAttribute('tabindex', '0');

    const poster = item.posterUrl || POSTER_FALLBACK_SVG;
    const resolution = item.id.includes('4k') || item.id.includes('tears') || item.id.includes('bunny') ? '4K UHD' : '1080p';

    card.innerHTML = `
      <img class="poster-card-img" src="${escapeHtml(poster)}" alt="${escapeHtml(item.title)}" loading="lazy" onerror="this.onerror=null;this.src='${POSTER_FALLBACK_SVG}';">
      <div class="poster-card-overlay">
        <h3 class="poster-card-title">${escapeHtml(item.title)}</h3>
        <div class="poster-card-meta">
          <span>${escapeHtml(item.year || '2024')}</span>
          <span class="poster-card-badge">${resolution}</span>
        </div>
      </div>
    `;

    card.addEventListener('click', () => {
      this.openDetailsModal(item);
    });

    return card;
  }

  // --- Virtual Keyboard & Parallel Search ---
  setupVirtualKeyboard() {
    const keys = [
      'A', 'B', 'C', 'D', 'E', 'F',
      'G', 'H', 'I', 'J', 'K', 'L',
      'M', 'N', 'O', 'P', 'Q', 'R',
      'S', 'T', 'U', 'V', 'W', 'X',
      'Y', 'Z', '1', '2', '3', '4',
      '5', '6', '7', '8', '9', '0',
      'SPACE', 'BACKSPACE', 'CLEAR',
    ];

    this.els.keyboardGrid.innerHTML = '';
    keys.forEach((key) => {
      const btn = document.createElement('button');
      btn.className = 'key-btn focusable';
      btn.setAttribute('tabindex', '0');
      btn.textContent = key;

      if (key === 'SPACE') {
        btn.classList.add('span-2');
        btn.onclick = () => this.handleKeyInput(' ');
      } else if (key === 'BACKSPACE') {
        btn.classList.add('span-2');
        btn.onclick = () => this.handleKeyInput('BACKSPACE');
      } else if (key === 'CLEAR') {
        btn.classList.add('span-2');
        btn.onclick = () => this.handleKeyInput('CLEAR');
      } else {
        btn.onclick = () => this.handleKeyInput(key);
      }

      this.els.keyboardGrid.appendChild(btn);
    });
  }

  handleKeyInput(val) {
    if (val === 'BACKSPACE') {
      this.searchQuery = this.searchQuery.slice(0, -1);
    } else if (val === 'CLEAR') {
      this.searchQuery = '';
    } else {
      this.searchQuery += val;
    }

    this.els.searchField.value = this.searchQuery;

    clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = setTimeout(() => {
      this.performSearch(this.searchQuery);
    }, 250);
  }

  async performSearch(query) {
    const q = query.trim();
    if (!q) {
      this.els.searchResultsGrid.innerHTML = `
        <div class="empty-state">
          <svg class="empty-icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
          <div class="empty-text">Enter letters using the remote to search all configured providers concurrently.</div>
        </div>
      `;
      this.els.searchResultsCount.textContent = '0 titles';
      this.els.providerPills.innerHTML = '';
      return;
    }

    this.els.searchResultsTitle.textContent = `Results for "${q}"`;
    this.els.searchResultsGrid.innerHTML = '<div class="empty-state"><div class="spinner"></div><div class="empty-text">Searching all enabled providers in parallel...</div></div>';

    const renderResults = (items, providerStatuses) => {
      this.renderProviderPills(providerStatuses);
      this.els.searchResultsCount.textContent = `${items.length} titles`;

      if (items.length === 0) {
        this.els.searchResultsGrid.innerHTML = `
          <div class="empty-state">
            <div class="empty-text">No matching titles found across enabled providers.</div>
          </div>
        `;
        return;
      }

      this.els.searchResultsGrid.innerHTML = '';
      items.forEach((item) => {
        const card = this.createPosterCard(item);
        this.els.searchResultsGrid.appendChild(card);
      });
    };

    const res = await searchAggregator.search(q, {
      onPartialResults: (partialItems, statuses) => {
        renderResults(partialItems, statuses);
      },
    });

    renderResults(res.items, res.providerStatuses);
  }

  renderProviderPills(statuses) {
    this.els.providerPills.innerHTML = '';
    statuses.forEach((s) => {
      const pill = document.createElement('div');
      pill.className = `provider-pill ${s.status}`;
      const latencyStr = s.durationMs > 0 ? ` (${s.durationMs}ms)` : '';
      pill.innerHTML = `
        <span class="dot"></span>
        <span>${escapeHtml(s.label)}: ${s.status === 'success' ? `${s.resultCount} items${latencyStr}` : s.error || s.status}</span>
      `;
      this.els.providerPills.appendChild(pill);
    });
  }

  // --- Movie Details Modal ---
  async openDetailsModal(mediaItem, autoPlay = false) {
    this.activeMediaItem = mediaItem;
    this.selectedStreamCandidate = null;

    remoteController.saveFocus();

    this.els.detailTitle.textContent = mediaItem.title;
    this.els.detailTagline.textContent = mediaItem.tagline || '';
    this.els.detailPoster.src = mediaItem.posterUrl || POSTER_FALLBACK_SVG;
    this.els.detailPoster.onerror = () => { this.els.detailPoster.src = POSTER_FALLBACK_SVG; };

    this.els.detailProviderBadge.textContent = mediaItem.providerLabel || 'Unified Provider';
    this.els.detailResBadge.textContent = '4K UHD';
    this.els.detailRatingBadge.textContent = `IMDB ${mediaItem.imdbRating || '8.0'}`;
    this.els.detailYearBadge.textContent = mediaItem.year || '2024';

    this.els.detailDirector.textContent = mediaItem.director || 'Ian Hubert / Open Source Team';
    this.els.detailStars.textContent = mediaItem.stars || 'Derek de Lint, Sergio Hasselbaink';
    this.els.detailGenres.textContent = mediaItem.genres?.join(', ') || 'Sci-Fi, VFX';

    const isFav = storageManager.isFavorite(mediaItem.provider, mediaItem.id);
    this.els.modalFavLabel.textContent = isFav ? 'Remove Favorite' : 'Add Favorite';

    // Show modal
    this.els.detailsModal.classList.add('active');
    remoteController.trapFocus(this.els.detailsModal);

    // Resolve stream candidates concurrently
    this.els.detailStreamsRow.innerHTML = '<div class="stream-card"><div class="stream-card-res">Discovering Streams...</div><div class="stream-card-meta">Querying providers</div></div>';

    const streams = await searchAggregator.resolveStreamsForMedia(mediaItem);
    this.activeStreams = streams;
    this.renderStreamCandidates(streams);

    if (autoPlay && streams.length > 0) {
      this.startPlayback(mediaItem);
    }
  }

  renderStreamCandidates(streams) {
    this.els.detailStreamsRow.innerHTML = '';
    if (!streams || streams.length === 0) {
      this.els.detailStreamsRow.innerHTML = '<div class="stream-card"><div class="stream-card-res">No Direct Streams</div><div class="stream-card-meta">Check provider health in settings</div></div>';
      return;
    }

    streams.forEach((s, idx) => {
      const card = document.createElement('button');
      card.className = `stream-card focusable ${s.recommended ? 'recommended' : ''}`;
      card.setAttribute('tabindex', '0');

      card.innerHTML = `
        <div class="stream-card-res">
          <span>${formatResolution(s.quality)}</span>
          ${s.recommended ? '<span class="badge badge-gold" style="font-size:10px;">BEST</span>' : ''}
        </div>
        <div class="stream-card-meta">
          ${escapeHtml(s.label || s.providerLabel)} • ${s.bitrateMbps ? `${s.bitrateMbps} Mbps` : 'Direct CDN'}
        </div>
      `;

      card.addEventListener('click', () => {
        this.selectedStreamCandidate = s;
        this.showToast(`Selected stream: ${s.quality} (${s.label})`);
        this.startPlayback(this.activeMediaItem, s);
      });

      this.els.detailStreamsRow.appendChild(card);
    });
  }

  closeDetailsModal() {
    this.els.detailsModal.classList.remove('active');
    remoteController.releaseFocusTrap();
  }

  // --- Fullscreen Video Playback ---
  async startPlayback(mediaItem, specificStream = null) {
    this.closeDetailsModal();
    this.els.playerView.style.display = 'block';
    this.els.playerErrorOverlay.style.display = 'none';

    this.els.osdTitle.textContent = mediaItem.title;
    this.els.osdSub.textContent = 'Connecting to stream...';

    // Load available subtitles
    const publicAdapter = providerRegistry.getAdapter('public_domain');
    if (publicAdapter) {
      const subs = await publicAdapter.getSubtitles(specificStream || { id: mediaItem.id });
      subtitleManager.setAvailableTracks(subs);
    }

    try {
      await this.playbackAdapter.loadMedia(mediaItem, this.activeStreams, {
        manualStream: specificStream,
      });
      this.showPlayerOsd();
      remoteController.focusElement(this.els.osdBtnPlayPause);
    } catch (err) {
      logger.error(TAG, `Failed to load media: ${err.message}`);
      this.handlePlaybackError(err);
    }
  }

  handlePlaybackState(state) {
    logger.debug(TAG, `Playback state: ${state}`);
    if (state === 'buffering') {
      this.els.bufferingIndicator.style.display = 'flex';
    } else {
      this.els.bufferingIndicator.style.display = 'none';
    }

    if (state === 'playing') {
      this.els.osdIconPlay.style.display = 'none';
      this.els.osdIconPause.style.display = 'block';
      this.els.osdPlayPauseText.textContent = 'Pause';
    } else if (state === 'paused' || state === 'stopped') {
      this.els.osdIconPlay.style.display = 'block';
      this.els.osdIconPause.style.display = 'none';
      this.els.osdPlayPauseText.textContent = 'Play';
    }
  }

  handlePlaybackTime(current, duration) {
    this.els.osdTimeCurrent.textContent = formatTimeCode(current);
    if (duration > 0) {
      this.els.osdTimeDuration.textContent = formatTimeCode(duration);
      const percent = Math.min(100, (current / duration) * 100);
      this.els.osdProgressFill.style.width = `${percent}%`;
    }
  }

  handlePlaybackDuration(duration) {
    this.els.osdTimeDuration.textContent = formatTimeCode(duration);
  }

  handleStreamSelected(stream, pool) {
    this.els.osdSub.textContent = `${formatResolution(stream.quality)} • ${stream.label || stream.providerLabel} • ${stream.codec?.toUpperCase() || 'H.264'} (${stream.container?.toUpperCase() || 'MP4'})`;
    this.els.osdQualityLabel.textContent = `Quality: ${stream.quality}`;
  }

  handlePlaybackError(err) {
    this.els.playerErrorOverlay.style.display = 'flex';
    this.els.playerErrorMessage.textContent = err.message || 'Stream playback failed';
    remoteController.focusElement(this.els.errorBtnRetry);
  }

  showPlayerOsd() {
    this.els.playerOsd.classList.add('active');
    clearTimeout(this.osdHideTimeout);
    this.osdHideTimeout = setTimeout(() => {
      if (this.playbackAdapter.isPlaying) {
        this.els.playerOsd.classList.remove('active');
      }
    }, 4500);
  }

  flashOsdStatus(msg) {
    this.els.osdStatusFlash.textContent = msg;
    this.els.osdStatusFlash.style.opacity = '1';
    setTimeout(() => {
      this.els.osdStatusFlash.style.opacity = '0';
    }, 1500);
  }

  exitPlayer() {
    clearTimeout(this.osdHideTimeout);
    this.playbackAdapter.stop();
    subtitleManager.clear();
    this.els.playerView.style.display = 'none';
    this.els.playerErrorOverlay.style.display = 'none';
    this.els.playerView.classList.remove('hw-playing');
    document.body.classList.remove('hw-playing');

    // Refresh history screen if active
    if (this.currentScreen === 'history') {
      this.renderHistoryScreen();
    }
    remoteController.restoreFocus();
  }

  cycleQualityPreference() {
    const qualities = ['auto', '2160p', '1080p', '720p'];
    const current = storageManager.getSettings().qualityPreference;
    const nextIdx = (qualities.indexOf(current) + 1) % qualities.length;
    const nextQual = qualities[nextIdx];
    storageManager.updateSettings({ qualityPreference: nextQual });
    this.els.osdQualityLabel.textContent = `Quality: ${nextQual}`;
    this.flashOsdStatus(`Quality: ${nextQual}`);
  }

  cycleSubtitleLanguage() {
    const tracks = subtitleManager.availableTracks;
    if (tracks.length === 0) {
      this.flashOsdStatus('No subtitles available');
      return;
    }
    const current = subtitleManager.currentTrack;
    if (!current) {
      subtitleManager.selectTrack(tracks[0]);
      this.els.osdSubtitleLabel.textContent = `Sub: ${tracks[0].label}`;
      this.flashOsdStatus(`Subtitles: ${tracks[0].label}`);
    } else {
      const idx = tracks.indexOf(current);
      if (idx === tracks.length - 1) {
        subtitleManager.selectTrack(null);
        this.els.osdSubtitleLabel.textContent = 'Subtitles: Off';
        this.flashOsdStatus('Subtitles: Off');
      } else {
        const next = tracks[idx + 1];
        subtitleManager.selectTrack(next);
        this.els.osdSubtitleLabel.textContent = `Sub: ${next.label}`;
        this.flashOsdStatus(`Subtitles: ${next.label}`);
      }
    }
  }

  // --- Favorites Screen ---
  renderFavoritesScreen() {
    const favorites = storageManager.getFavorites();
    this.els.favoritesGrid.innerHTML = '';
    if (favorites.length === 0) {
      this.els.favoritesGrid.innerHTML = `
        <div class="empty-state" style="grid-column: span 6;">
          <svg class="empty-icon" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          <div class="empty-text">No favorites added yet. Add movies from Home or Search to watch later.</div>
        </div>
      `;
      return;
    }

    favorites.forEach((fav) => {
      const card = this.createPosterCard(fav);
      this.els.favoritesGrid.appendChild(card);
    });

    const first = this.els.favoritesGrid.querySelector('.poster-card');
    if (first) remoteController.focusElement(first);
  }

  // --- Watch History Screen ---
  renderHistoryScreen() {
    const history = storageManager.getHistory();
    this.els.historyGrid.innerHTML = '';
    if (history.length === 0) {
      this.els.historyGrid.innerHTML = `
        <div class="empty-state" style="grid-column: span 6;">
          <svg class="empty-icon" viewBox="0 0 24 24"><path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>
          <div class="empty-text">Your watch history is empty. Titles you play will appear here with saved progress.</div>
        </div>
      `;
      return;
    }

    history.forEach((item) => {
      const card = this.createPosterCard(item);
      this.els.historyGrid.appendChild(card);
    });

    const first = this.els.historyGrid.querySelector('.poster-card');
    if (first) remoteController.focusElement(first);
  }

  // --- Settings & Diagnostics ---
  setupSettingsUI() {
    const settings = storageManager.getSettings();

    // Quality buttons
    const qualityBtns = this.els.qualityGroup.querySelectorAll('.btn-choice');
    qualityBtns.forEach((btn) => {
      if (btn.dataset.quality === settings.qualityPreference) btn.classList.add('active');
      else btn.classList.remove('active');
      btn.onclick = () => {
        qualityBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        storageManager.updateSettings({ qualityPreference: btn.dataset.quality });
        this.showToast(`Default quality set to ${btn.dataset.quality.toUpperCase()}`);
      };
    });

    // Strategy buttons
    const strategyBtns = this.els.strategyGroup.querySelectorAll('.btn-choice');
    strategyBtns.forEach((btn) => {
      if (btn.dataset.strategy === settings.selectionStrategy) btn.classList.add('active');
      else btn.classList.remove('active');
      btn.onclick = () => {
        strategyBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        storageManager.updateSettings({ selectionStrategy: btn.dataset.strategy });
        this.showToast(`Selection strategy set to ${btn.textContent}`);
      };
    });

    // Player Engine buttons
    if (this.els.engineGroup) {
      const engineBtns = this.els.engineGroup.querySelectorAll('.btn-choice');
      engineBtns.forEach((btn) => {
        if (btn.dataset.engine === (settings.playerEngine || 'auto')) btn.classList.add('active');
        else btn.classList.remove('active');
        btn.onclick = () => {
          engineBtns.forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          const engineVal = btn.dataset.engine;
          storageManager.updateSettings({ playerEngine: engineVal });
          this.playbackAdapter.switchEngine(engineVal);
          this.showToast(`Player engine set to ${btn.textContent}`);
        };
      });
    }

    // Subtitle buttons
    const subBtns = this.els.subtitleGroup.querySelectorAll('.btn-choice');
    subBtns.forEach((btn) => {
      if (btn.dataset.subtitle === settings.subtitleLanguage) btn.classList.add('active');
      else btn.classList.remove('active');
      btn.onclick = () => {
        subBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        storageManager.updateSettings({ subtitleLanguage: btn.dataset.subtitle });
        this.showToast(`Default subtitles set to ${btn.textContent}`);
      };
    });

    // Ping Providers Button
    this.els.btnPingProviders.onclick = () => this.refreshProviderHealth();

    // Clear Logs Button
    this.els.btnClearLogs.onclick = () => {
      logger.clearLogs();
      this.renderDiagnosticsLog();
      this.showToast('Diagnostics logs cleared');
    };
  }

  async renderSettingsScreen() {
    await this.refreshProviderHealth();
    this.renderDiagnosticsLog();
    const firstBtn = this.els.qualityGroup.querySelector('.btn-choice');
    if (firstBtn) remoteController.focusElement(firstBtn);
  }

  async refreshProviderHealth() {
    this.els.providerHealthList.innerHTML = '<div class="empty-text">Running live health probes...</div>';
    const healthResults = await providerRegistry.runHealthChecks();

    this.els.providerHealthList.innerHTML = '';
    healthResults.forEach((h) => {
      const item = document.createElement('div');
      item.className = 'provider-health-item';
      item.innerHTML = `
        <div class="provider-info-group">
          <span class="status-dot ${h.online ? 'online' : 'error'}" style="${h.online ? '' : 'background-color:#ef4444;box-shadow:0 0 8px #ef4444;'}"></span>
          <div>
            <div class="provider-name">${escapeHtml(h.label)}</div>
            <div class="provider-meta">${escapeHtml(h.message)}</div>
          </div>
        </div>
        <span class="badge ${h.online ? 'badge-glass' : 'badge-accent'}">${h.online ? `${h.latencyMs} ms` : 'OFFLINE'}</span>
      `;
      this.els.providerHealthList.appendChild(item);
    });
  }

  renderDiagnosticsLog() {
    const logs = logger.getRecentLogs();
    this.els.logViewer.innerHTML = '';
    if (logs.length === 0) {
      this.els.logViewer.innerHTML = '<div>No logged events yet.</div>';
      return;
    }
    logs.slice(-30).forEach((entry) => {
      const line = document.createElement('div');
      line.className = `log-entry ${entry.level.toLowerCase()}`;
      line.textContent = `[${entry.timestamp}] [${entry.level}] [${entry.tag}] ${entry.message}`;
      this.els.logViewer.appendChild(line);
    });
    this.els.logViewer.scrollTop = this.els.logViewer.scrollHeight;
  }

  showToast(msg) {
    this.els.toastMessage.textContent = msg;
    this.els.toast.classList.add('show');
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.els.toast.classList.remove('show');
    }, 2800);
  }
}

// Start application when DOM is ready
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    window.movieboxApp = new MovieBoxApp();
  });
}
