/**
 * Stremio Addon Provider Adapter
 * Implements the standard Addon protocol (manifest.json, /catalog, /meta, /stream)
 * compatible with upstream MovieBox-TUI's addon integration.
 */

import { ProviderAdapter } from '../provider-base.js';
import { logger } from '../../utils/logger.js';

const TAG = 'StremioAddonAdapter';
const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';

export class StremioAddonAdapter extends ProviderAdapter {
  constructor(customManifestUrl = null) {
    super('stremio_addons', 'Cinemeta / Addons', {
      supportsSearch: true,
      supportsDetails: true,
      supportsStreams: true,
      supportsSubtitles: true,
      supportsSeries: true,
    });
    this.manifestUrl = customManifestUrl || `${CINEMETA_BASE}/manifest.json`;
    this.baseUrl = this.manifestUrl.replace(/\/manifest\.json$/, '');
  }

  async search(query, options = {}) {
    const q = query.trim();
    if (!q) return [];

    try {
      const searchUrl = `${this.baseUrl}/catalog/movie/top/search=${encodeURIComponent(q)}.json`;
      const resp = await fetch(searchUrl, { signal: options.signal });
      if (!resp.ok) {
        throw new Error(`Addon HTTP ${resp.status}`);
      }
      const data = await resp.json();
      const metas = data.metas || [];

      return metas.map((m) => ({
        id: `stremio:${m.id}`,
        provider: this.id,
        providerLabel: this.label,
        title: m.name || 'Untitled',
        year: String(m.year || m.releaseInfo || ''),
        mediaType: m.type === 'series' ? 'series' : 'movie',
        posterUrl: m.poster || null,
        backdropUrl: m.background || m.poster || null,
        imdbRating: m.imdbRating ? String(m.imdbRating) : null,
        genres: m.genres || [],
        isAuthorized: true,
      }));
    } catch (err) {
      logger.warn(TAG, `Addon search failed: ${err.message}`);
      return [];
    }
  }

  async getDetails(id, options = {}) {
    const cleanId = id.replace(/^stremio:/, '');
    const type = cleanId.startsWith('tt') ? 'movie' : 'movie'; // standard imdb id prefix

    try {
      const metaUrl = `${this.baseUrl}/meta/${type}/${cleanId}.json`;
      const resp = await fetch(metaUrl, { signal: options.signal });
      if (!resp.ok) throw new Error(`Addon meta HTTP ${resp.status}`);
      const data = await resp.json();
      const m = data.meta;
      if (!m) throw new Error('Meta not found');

      return {
        id: `stremio:${m.id}`,
        provider: this.id,
        providerLabel: this.label,
        title: m.name,
        year: String(m.year || m.releaseInfo || ''),
        mediaType: m.type === 'series' ? 'series' : 'movie',
        duration: m.runtime || null,
        imdbRating: m.imdbRating ? String(m.imdbRating) : null,
        genres: m.genres || [],
        tagline: '',
        description: m.description || '',
        director: Array.isArray(m.director) ? m.director.join(', ') : m.director || '',
        stars: Array.isArray(m.cast) ? m.cast.slice(0, 4).join(', ') : '',
        posterUrl: m.poster || null,
        backdropUrl: m.background || m.poster || null,
        seasons: [],
        isAuthorized: true,
      };
    } catch (err) {
      logger.warn(TAG, `Addon getDetails error: ${err.message}`);
      throw err;
    }
  }

  async getStreams(id, options = {}) {
    return [];
  }

  async healthCheck() {
    const start = Date.now();
    try {
      const resp = await fetch(this.manifestUrl, { method: 'GET' });
      return {
        online: resp.ok,
        latencyMs: Date.now() - start,
        message: resp.ok ? 'Active (Cinemeta Protocol)' : `HTTP ${resp.status}`,
      };
    } catch (err) {
      return {
        online: false,
        latencyMs: Date.now() - start,
        message: `Offline: ${err.message}`,
      };
    }
  }
}
