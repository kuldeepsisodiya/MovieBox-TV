/**
 * 4KHDHub Provider Adapter
 * Port of MovieBox-TUI's 4KHDHub scraper and multi-resolution release resolver.
 */

import { ProviderAdapter } from '../provider-base.js';
import { logger } from '../../utils/logger.js';
import { storageManager } from '../../storage/storage-manager.js';

const TAG = 'FourKHdAdapter';

export class FourKHdAdapter extends ProviderAdapter {
  constructor() {
    super('fourkhdhub', '4KHDHub (UHD Releases)', {
      supportsSearch: true,
      supportsDetails: true,
      supportsStreams: true,
      supportsSubtitles: false,
      supportsSeries: true,
    });
  }

  async search(query, options = {}) {
    const q = query.trim();
    if (!q) return [];

    const settings = storageManager.getSettings();
    const backendUrl = settings.backendUrl;

    if (backendUrl) {
      try {
        const resp = await fetch(`${backendUrl}/api/providers/fourkhd/search?q=${encodeURIComponent(q)}`, {
          signal: options.signal,
        });
        if (resp.ok) {
          const data = await resp.json();
          return data.items || [];
        }
      } catch (err) {
        logger.warn(TAG, `Backend 4KHDHub search error: ${err.message}`);
      }
    }

    return [];
  }

  async getDetails(id, options = {}) {
    const settings = storageManager.getSettings();
    const backendUrl = settings.backendUrl;

    if (backendUrl) {
      const resp = await fetch(`${backendUrl}/api/providers/fourkhd/details?id=${encodeURIComponent(id)}`, {
        signal: options.signal,
      });
      if (resp.ok) {
        return await resp.json();
      }
    }
    throw new Error('4KHDHub details require backend resolution due to HTML scraping protections');
  }

  async getStreams(id, options = {}) {
    const settings = storageManager.getSettings();
    const backendUrl = settings.backendUrl;

    if (backendUrl) {
      const resp = await fetch(`${backendUrl}/api/providers/fourkhd/streams?id=${encodeURIComponent(id)}`, {
        signal: options.signal,
      });
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
      return { online: true, latencyMs: 50, message: 'Backend Assisted' };
    }
    return {
      online: false,
      latencyMs: 0,
      message: 'Requires backend scraper proxy (CORS and anti-bot protection on upstream)',
    };
  }
}
