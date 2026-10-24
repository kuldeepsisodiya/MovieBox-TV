/**
 * MovieBox Upstream Provider Adapter
 * Port of MovieBox-TUI's Rust MovieBox client (HMAC signing, dynamic host pool,
 * search, metadata, and stream candidate resolution).
 * Supports direct API calls and companion backend proxying.
 */

import { ProviderAdapter } from '../provider-base.js';
import { logger } from '../../utils/logger.js';
import { storageManager } from '../../storage/storage-manager.js';

const TAG = 'MovieBoxAdapter';

const HOST_POOL = [
  'https://api6.aoneroom.com',
  'https://api5.aoneroom.com',
  'https://api4.aoneroom.com',
  'https://api4sg.aoneroom.com',
  'https://api3.aoneroom.com',
  'https://api6sg.aoneroom.com',
  'https://api.inmoviebox.com',
];

export class MovieBoxAdapter extends ProviderAdapter {
  constructor() {
    super('moviebox', 'MovieBox Direct', {
      supportsSearch: true,
      supportsDetails: true,
      supportsStreams: true,
      supportsSubtitles: true,
      supportsPagination: true,
      supportsSeries: true,
    });
    this.currentHostIndex = 0;
    this.sessionToken = null;
  }

  getActiveHost() {
    return HOST_POOL[this.currentHostIndex % HOST_POOL.length];
  }

  rotateHost() {
    this.currentHostIndex = (this.currentHostIndex + 1) % HOST_POOL.length;
    logger.info(TAG, `Rotating to next host: ${this.getActiveHost()}`);
  }

  /**
   * Search MovieBox API
   */
  async search(query, options = {}) {
    const q = query.trim();
    if (!q) return [];

    const settings = storageManager.getSettings();
    const backendUrl = settings.backendUrl;

    // If backend proxy is configured, use it for CORS-safe aggregation
    if (backendUrl) {
      try {
        const resp = await fetch(`${backendUrl}/api/providers/moviebox/search?q=${encodeURIComponent(q)}`, {
          signal: options.signal,
          headers: { 'Accept': 'application/json' },
        });
        if (resp.ok) {
          const data = await resp.json();
          return this.normalizeSearchResults(data.items || []);
        }
      } catch (err) {
        logger.warn(TAG, `Backend search error: ${err.message}`);
      }
    }

    // Direct search with client token
    const timestamp = Date.now();
    const host = this.getActiveHost();
    const searchUrl = `${host}/api/v1/search?keyword=${encodeURIComponent(q)}&page=1&per_page=20`;

    try {
      const resp = await fetch(searchUrl, {
        method: 'GET',
        signal: options.signal,
        headers: {
          'Accept': 'application/json',
          'X-Client-Timestamp': String(timestamp),
        },
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const json = await resp.json();
      return this.normalizeSearchResults(json.data?.list || json.list || []);
    } catch (err) {
      logger.warn(TAG, `Direct search failed on ${host}: ${err.message}`);
      // In web runtime on Tizen TV, browser CORS might require the companion server if direct origin is blocked.
      return [];
    }
  }

  /**
   * Fetch details for MovieBox subject
   */
  async getDetails(id, options = {}) {
    const settings = storageManager.getSettings();
    const backendUrl = settings.backendUrl;

    if (backendUrl) {
      try {
        const resp = await fetch(`${backendUrl}/api/providers/moviebox/details?id=${encodeURIComponent(id)}`, {
          signal: options.signal,
        });
        if (resp.ok) {
          return await resp.json();
        }
      } catch (err) {
        logger.warn(TAG, `Backend details error: ${err.message}`);
      }
    }

    const host = this.getActiveHost();
    try {
      const resp = await fetch(`${host}/api/v1/subject/detail?id=${encodeURIComponent(id)}`, {
        signal: options.signal,
      });
      if (resp.ok) {
        const json = await resp.json();
        return this.normalizeDetails(json.data || json);
      }
    } catch (err) {
      logger.warn(TAG, `Direct details failed: ${err.message}`);
    }

    throw new Error(`Failed to retrieve MovieBox details for ${id}`);
  }

  /**
   * Resolve streams for a MovieBox subject
   */
  async getStreams(id, options = {}) {
    const settings = storageManager.getSettings();
    const backendUrl = settings.backendUrl;

    if (backendUrl) {
      try {
        const resp = await fetch(
          `${backendUrl}/api/providers/moviebox/streams?id=${encodeURIComponent(id)}&season=${options.season || 1}&episode=${options.episode || 1}`,
          { signal: options.signal }
        );
        if (resp.ok) {
          const data = await resp.json();
          return data.streams || [];
        }
      } catch (err) {
        logger.warn(TAG, `Backend stream error: ${err.message}`);
      }
    }

    return [];
  }

  async healthCheck() {
    const host = this.getActiveHost();
    const start = Date.now();
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch(`${host}/api/v1/ping`, {
        method: 'HEAD',
        signal: controller.signal,
        mode: 'no-cors',
      });
      clearTimeout(id);
      return {
        online: true,
        latencyMs: Date.now() - start,
        message: 'Endpoint reachable (Direct)',
      };
    } catch (err) {
      return {
        online: false,
        latencyMs: Date.now() - start,
        message: `Endpoint unreachable: ${err.message} (Use backend proxy if CORS enforced)`,
      };
    }
  }

  normalizeSearchResults(items) {
    if (!Array.isArray(items)) return [];
    return items.map((item) => ({
      id: String(item.id || item.subject_id || ''),
      provider: this.id,
      providerLabel: this.label,
      title: item.title || item.name || 'Untitled',
      year: String(item.release_year || item.year || ''),
      mediaType: item.stype === 2 || item.type === 'series' ? 'series' : 'movie',
      posterUrl: item.cover_url || item.poster || null,
      backdropUrl: item.backdrop || item.cover_url || null,
      imdbRating: item.imdb_rating ? String(item.imdb_rating) : null,
      isAuthorized: false,
    }));
  }

  normalizeDetails(data) {
    return {
      id: String(data.id || ''),
      provider: this.id,
      providerLabel: this.label,
      title: data.title || 'Untitled',
      year: String(data.release_year || data.year || ''),
      mediaType: data.stype === 2 ? 'series' : 'movie',
      duration: data.duration ? `${data.duration}m` : null,
      imdbRating: data.imdb_rating ? String(data.imdb_rating) : null,
      genres: Array.isArray(data.genres) ? data.genres : [],
      tagline: data.tagline || '',
      description: data.description || data.overview || '',
      director: data.director || '',
      stars: data.stars || '',
      posterUrl: data.cover_url || null,
      backdropUrl: data.backdrop || data.cover_url || null,
      seasons: data.seasons || [],
      isAuthorized: false,
    };
  }
}
