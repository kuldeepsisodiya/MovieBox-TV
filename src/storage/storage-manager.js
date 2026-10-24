/**
 * MovieBox TV Safe Persistent Storage Manager
 * Handles favorites, watchlist, watch history with progress, and user preferences.
 * Includes graceful memory fallback if localStorage throws or is restricted.
 */

import { logger } from '../utils/logger.js';

const TAG = 'StorageManager';

const STORAGE_KEYS = {
  FAVORITES: 'moviebox_favorites_v1',
  WATCHLIST: 'moviebox_watchlist_v1',
  HISTORY: 'moviebox_history_v1',
  SETTINGS: 'moviebox_settings_v1',
};

const DEFAULT_SETTINGS = {
  qualityPreference: 'auto', // 'auto', '2160p', '1080p', '720p', '480p'
  selectionStrategy: 'fastest_start', // 'fastest_start', 'best_quality', 'most_reliable'
  playerEngine: 'auto', // 'auto', 'html5', 'avplay'
  subtitleLanguage: 'off', // 'off', 'en', 'hi', 'auto'
  backendUrl: '', // Optional proxy/backend
  enabledProviders: {
    public_domain: true,
    moviebox: true,
    fourkhdhub: true,
    stremio_addons: true,
    dramachi: true,
  },
  requestTimeoutMs: 7500,
  logLevel: 'INFO',
};

class StorageManager {
  constructor() {
    this.memoryStore = new Map();
    this.isStorageAvailable = this.checkStorage();
    if (!this.isStorageAvailable) {
      logger.warn(TAG, 'localStorage unavailable. Using in-memory fallback store.');
    }
  }

  checkStorage() {
    try {
      const testKey = '__mb_storage_test__';
      window.localStorage.setItem(testKey, testKey);
      window.localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }

  getItem(key) {
    if (this.isStorageAvailable) {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw) return JSON.parse(raw);
      } catch (err) {
        logger.warn(TAG, `Failed to read ${key} from localStorage: ${err.message}`);
      }
    }
    return this.memoryStore.get(key) || null;
  }

  setItem(key, value) {
    this.memoryStore.set(key, value);
    if (this.isStorageAvailable) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch (err) {
        logger.warn(TAG, `Failed to write ${key} to localStorage: ${err.message}`);
      }
    }
  }

  removeItem(key) {
    this.memoryStore.delete(key);
    if (this.isStorageAvailable) {
      try {
        window.localStorage.removeItem(key);
      } catch (err) {
        logger.warn(TAG, `Failed to remove ${key} from localStorage: ${err.message}`);
      }
    }
  }

  // --- Favorites ---

  getFavorites() {
    return this.getItem(STORAGE_KEYS.FAVORITES) || [];
  }

  isFavorite(provider, id) {
    const list = this.getFavorites();
    return list.some((item) => item.provider === provider && item.id === id);
  }

  toggleFavorite(mediaItem) {
    const list = this.getFavorites();
    const idx = list.findIndex((item) => item.provider === mediaItem.provider && item.id === mediaItem.id);
    if (idx >= 0) {
      list.splice(idx, 1);
      this.setItem(STORAGE_KEYS.FAVORITES, list);
      return false;
    } else {
      const toStore = {
        id: mediaItem.id,
        provider: mediaItem.provider,
        title: mediaItem.title,
        posterUrl: mediaItem.posterUrl,
        year: mediaItem.year,
        mediaType: mediaItem.mediaType || 'movie',
        addedAt: Date.now(),
      };
      list.unshift(toStore);
      this.setItem(STORAGE_KEYS.FAVORITES, list.slice(0, 100)); // cap at 100
      return true;
    }
  }

  removeFavorite(provider, id) {
    const list = this.getFavorites();
    const filtered = list.filter((item) => !(item.provider === provider && item.id === id));
    this.setItem(STORAGE_KEYS.FAVORITES, filtered);
  }

  // --- Watch History ---

  getHistory() {
    return this.getItem(STORAGE_KEYS.HISTORY) || [];
  }

  getResumePoint(provider, id, season = 1, episode = 1) {
    const history = this.getHistory();
    const entry = history.find(
      (h) => h.provider === provider && h.id === id && h.season === season && h.episode === episode
    );
    if (entry && !entry.completed && entry.progressSeconds > 10) {
      return entry.progressSeconds;
    }
    return 0;
  }

  updateHistory(mediaItem, { progressSeconds, durationSeconds, season = 1, episode = 1, streamQuality = '' } = {}) {
    if (!mediaItem || !mediaItem.id) return;
    const history = this.getHistory();
    const idx = history.findIndex(
      (h) => h.provider === mediaItem.provider && h.id === mediaItem.id && h.season === season && h.episode === episode
    );

    const progress = Math.max(0, Math.floor(progressSeconds || 0));
    const duration = Math.max(0, Math.floor(durationSeconds || 0));
    const completed = duration > 0 ? progress / duration >= 0.92 : false;

    const entry = {
      id: mediaItem.id,
      provider: mediaItem.provider,
      title: mediaItem.title,
      posterUrl: mediaItem.posterUrl,
      year: mediaItem.year,
      mediaType: mediaItem.mediaType || 'movie',
      season,
      episode,
      progressSeconds: progress,
      durationSeconds: duration,
      completed,
      streamQuality,
      lastWatched: Date.now(),
    };

    if (idx >= 0) {
      history.splice(idx, 1);
    }
    history.unshift(entry);
    this.setItem(STORAGE_KEYS.HISTORY, history.slice(0, 80)); // cap at 80 items
  }

  clearHistory() {
    this.removeItem(STORAGE_KEYS.HISTORY);
  }

  // --- Settings ---

  getSettings() {
    const stored = this.getItem(STORAGE_KEYS.SETTINGS) || {};
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      enabledProviders: {
        ...DEFAULT_SETTINGS.enabledProviders,
        ...(stored.enabledProviders || {}),
      },
    };
  }

  updateSettings(partial) {
    const current = this.getSettings();
    const updated = {
      ...current,
      ...partial,
      enabledProviders: {
        ...current.enabledProviders,
        ...(partial.enabledProviders || {}),
      },
    };
    this.setItem(STORAGE_KEYS.SETTINGS, updated);
    logger.info(TAG, 'Settings updated', updated);
    return updated;
  }

  resetSettings() {
    this.setItem(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  }
}

export const storageManager = new StorageManager();
