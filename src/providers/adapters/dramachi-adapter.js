/**
 * Dramachi Provider Adapter
 * Port of MovieBox-TUI's Asian drama & series provider.
 */

import { ProviderAdapter } from '../provider-base.js';
import { logger } from '../../utils/logger.js';
import { storageManager } from '../../storage/storage-manager.js';

const TAG = 'DramachiAdapter';

export class DramachiAdapter extends ProviderAdapter {
  constructor() {
    super('dramachi', 'Dramachi (Asian Drama)', {
      supportsSearch: true,
      supportsDetails: true,
      supportsStreams: true,
      supportsSubtitles: true,
      supportsSeries: true,
    });
  }

  async search(query, options = {}) {
    const q = query.trim();
    if (!q) return [];
    const settings = storageManager.getSettings();
    if (settings.backendUrl) {
      try {
        const resp = await fetch(`${settings.backendUrl}/api/providers/dramachi/search?q=${encodeURIComponent(q)}`, {
          signal: options.signal,
        });
        if (resp.ok) {
          const data = await resp.json();
          return data.items || [];
        }
      } catch (err) {
        logger.warn(TAG, `Dramachi backend search error: ${err.message}`);
      }
    }
    return [];
  }

  async getDetails(id, options = {}) {
    const settings = storageManager.getSettings();
    if (settings.backendUrl) {
      const resp = await fetch(`${settings.backendUrl}/api/providers/dramachi/details?id=${encodeURIComponent(id)}`, {
        signal: options.signal,
      });
      if (resp.ok) return await resp.json();
    }
    throw new Error('Dramachi details require backend proxy');
  }

  async getStreams(id, options = {}) {
    const settings = storageManager.getSettings();
    if (settings.backendUrl) {
      const resp = await fetch(
        `${settings.backendUrl}/api/providers/dramachi/streams?id=${encodeURIComponent(id)}&season=${options.season || 1}&episode=${options.episode || 1}`,
        { signal: options.signal }
      );
      if (resp.ok) {
        const data = await resp.json();
        return data.streams || [];
      }
    }
    return [];
  }

  async healthCheck() {
    const settings = storageManager.getSettings();
    if (settings.backendUrl) {
      return { online: true, latencyMs: 60, message: 'Backend Assisted' };
    }
    return {
      online: false,
      latencyMs: 0,
      message: 'Requires backend scraper proxy',
    };
  }
}
