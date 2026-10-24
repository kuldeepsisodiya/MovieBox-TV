/**
 * MovieBox TV Provider Registry
 * Coordinates all provider adapters and their operational statuses.
 */

import { storageManager } from '../storage/storage-manager.js';
import { logger } from '../utils/logger.js';
import { PublicDomainAdapter } from './adapters/public-domain-adapter.js';
import { MovieBoxAdapter } from './adapters/moviebox-adapter.js';
import { StremioAddonAdapter } from './adapters/stremio-addon-adapter.js';
import { FourKHdAdapter } from './adapters/fourkhd-adapter.js';
import { DramachiAdapter } from './adapters/dramachi-adapter.js';

const TAG = 'ProviderRegistry';

class ProviderRegistry {
  constructor() {
    this.adapters = new Map();
    this.registerDefaults();
  }

  registerDefaults() {
    this.register(new PublicDomainAdapter());
    this.register(new MovieBoxAdapter());
    this.register(new StremioAddonAdapter());
    this.register(new FourKHdAdapter());
    this.register(new DramachiAdapter());
  }

  register(adapter) {
    if (!adapter || !adapter.id) return;
    this.adapters.set(adapter.id, adapter);
    logger.debug(TAG, `Registered provider: ${adapter.id} (${adapter.label})`);
  }

  getAdapter(id) {
    return this.adapters.get(id) || null;
  }

  getAllAdapters() {
    return Array.from(this.adapters.values());
  }

  getEnabledAdapters() {
    const settings = storageManager.getSettings();
    const enabledMap = settings.enabledProviders || {};
    return this.getAllAdapters().filter((adapter) => {
      // Default to true if not explicitly set to false
      return enabledMap[adapter.id] !== false;
    });
  }

  async runHealthChecks() {
    const results = [];
    for (const adapter of this.getAllAdapters()) {
      try {
        const health = await adapter.healthCheck();
        results.push({
          id: adapter.id,
          label: adapter.label,
          online: health.online,
          latencyMs: health.latencyMs,
          message: health.message,
        });
      } catch (err) {
        results.push({
          id: adapter.id,
          label: adapter.label,
          online: false,
          latencyMs: 0,
          message: err.message,
        });
      }
    }
    return results;
  }
}

export const providerRegistry = new ProviderRegistry();
