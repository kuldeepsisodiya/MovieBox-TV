/**
 * Unified Concurrent Multi-Provider Search Aggregator
 * Executes parallel searches across all enabled providers with independent timeouts,
 * failure isolation, real-time streaming partial results, title normalization, and deduplication.
 */

import { providerRegistry } from './provider-registry.js';
import { logger } from '../utils/logger.js';
import { sanitizeTitle } from '../utils/formatters.js';

const TAG = 'SearchAggregator';

// In-memory query cache with TTL (5 minutes)
const searchCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 40;

export function normalizeTitleKey(title, year = '') {
  if (!title) return '';
  let str = String(title).trim();
  let detectedYear = year ? String(year).trim().slice(0, 4) : '';

  // Extract year like (2012) or [2012] or 2012 from title
  const yearMatch = str.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) {
    if (!detectedYear) {
      detectedYear = yearMatch[1];
    }
    str = str.replace(/\b(19\d{2}|20\d{2})\b/g, '');
  }

  const clean = sanitizeTitle(str).toLowerCase().replace(/[^a-z0-9]/g, '');
  return detectedYear ? `${clean}_${detectedYear}` : clean;
}

export class SearchAggregator {
  constructor() {
    this.currentAbortController = null;
  }

  /**
   * Search all enabled providers concurrently.
   * @param {string} query
   * @param {object} options - { timeoutMs, onPartialResults, signal }
   * @returns {Promise<{ items: NormalizedMedia[], providerStatuses: ProviderStatus[] }>}
   */
  async search(query, options = {}) {
    const q = query.trim();
    if (!q) {
      return { items: [], providerStatuses: [] };
    }

    const timeoutMs = options.timeoutMs || 7500;
    const cacheKey = q.toLowerCase();

    // Check cache
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      logger.debug(TAG, `Returning cached results for: "${q}"`);
      return cached.data;
    }

    // Cancel previous search if running
    if (this.currentAbortController) {
      this.currentAbortController.abort();
    }
    this.currentAbortController = new AbortController();
    const activeSignal = options.signal || this.currentAbortController.signal;

    const enabledAdapters = providerRegistry.getEnabledAdapters();
    if (enabledAdapters.length === 0) {
      logger.warn(TAG, 'No providers are currently enabled');
      return { items: [], providerStatuses: [] };
    }

    const mergedItemsMap = new Map(); // key -> canonical media item
    const providerStatuses = [];

    // Launch concurrent searches
    const searchPromises = enabledAdapters.map(async (adapter) => {
      const startTime = Date.now();
      const status = {
        id: adapter.id,
        label: adapter.label,
        status: 'pending',
        durationMs: 0,
        resultCount: 0,
        error: null,
      };

      try {
        // Independent timeout per provider
        const searchPromise = adapter.search(q, { signal: activeSignal });
        const timeoutPromise = new Promise((_, reject) => {
          const timer = setTimeout(() => {
            reject(new Error(`Timeout after ${timeoutMs}ms`));
          }, timeoutMs);
          if (activeSignal) {
            activeSignal.addEventListener('abort', () => clearTimeout(timer), { once: true });
          }
        });

        const results = await Promise.race([searchPromise, timeoutPromise]);
        status.status = 'success';
        status.durationMs = Date.now() - startTime;
        status.resultCount = results.length;

        // Merge results incrementally
        this.mergeResults(mergedItemsMap, results, adapter);

        if (typeof options.onPartialResults === 'function') {
          options.onPartialResults(Array.from(mergedItemsMap.values()), [...providerStatuses, status]);
        }
      } catch (err) {
        status.durationMs = Date.now() - startTime;
        if (err.name === 'AbortError') {
          status.status = 'aborted';
          status.error = 'Cancelled';
        } else if (err.message && err.message.includes('Timeout')) {
          status.status = 'timeout';
          status.error = `Timed out (${timeoutMs}ms)`;
        } else {
          status.status = 'error';
          status.error = err.message || 'Provider error';
        }
        logger.warn(TAG, `Provider ${adapter.id} search failed: ${status.error}`);
      }

      providerStatuses.push(status);
      return status;
    });

    await Promise.allSettled(searchPromises);

    const finalItems = Array.from(mergedItemsMap.values());

    // Sort: items with posters and authorized streams first, then by match relevance
    finalItems.sort((a, b) => {
      if (a.isAuthorized !== b.isAuthorized) {
        return a.isAuthorized ? -1 : 1;
      }
      if (Boolean(a.posterUrl) !== Boolean(b.posterUrl)) {
        return a.posterUrl ? -1 : 1;
      }
      return (b.sources?.length || 0) - (a.sources?.length || 0);
    });

    const responseData = {
      items: finalItems,
      providerStatuses,
    };

    // Store in cache
    searchCache.set(cacheKey, { timestamp: Date.now(), data: responseData });
    if (searchCache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = searchCache.keys().next().value;
      searchCache.delete(oldestKey);
    }

    return responseData;
  }

  /**
   * Merge provider results into canonical items (deduplication)
   */
  mergeResults(map, results, adapter) {
    for (const item of results) {
      if (!item || !item.title) continue;
      const key = normalizeTitleKey(item.title, item.year);
      if (!key) continue;

      if (!map.has(key)) {
        map.set(key, {
          id: item.id,
          canonicalTitle: item.title,
          title: item.title,
          year: item.year || '',
          mediaType: item.mediaType || 'movie',
          posterUrl: item.posterUrl || null,
          backdropUrl: item.backdropUrl || null,
          imdbRating: item.imdbRating || null,
          duration: item.duration || null,
          genres: item.genres || [],
          isAuthorized: Boolean(item.isAuthorized),
          sources: [
            {
              provider: adapter.id,
              providerLabel: adapter.label,
              sourceId: item.id,
              posterUrl: item.posterUrl,
            },
          ],
        });
      } else {
        const canonical = map.get(key);
        // Enrich canonical item
        if (!canonical.posterUrl && item.posterUrl) canonical.posterUrl = item.posterUrl;
        if (!canonical.backdropUrl && item.backdropUrl) canonical.backdropUrl = item.backdropUrl;
        if (!canonical.year && item.year) canonical.year = item.year;
        if (!canonical.imdbRating && item.imdbRating) canonical.imdbRating = item.imdbRating;
        if (!canonical.duration && item.duration) canonical.duration = item.duration;
        if (item.isAuthorized) canonical.isAuthorized = true;

        if (!canonical.sources.some((s) => s.provider === adapter.id && s.sourceId === item.id)) {
          canonical.sources.push({
            provider: adapter.id,
            providerLabel: adapter.label,
            sourceId: item.id,
            posterUrl: item.posterUrl,
          });
        }
      }
    }
  }

  /**
   * Concurrently query all linked providers for stream candidates for a media item.
   */
  async resolveStreamsForMedia(mediaItem, { season = 1, episode = 1, timeoutMs = 6000 } = {}) {
    if (!mediaItem) return [];

    const sources = mediaItem.sources && mediaItem.sources.length > 0
      ? mediaItem.sources
      : [{ provider: mediaItem.provider, sourceId: mediaItem.id, providerLabel: mediaItem.providerLabel }];

    const streamPromises = sources.map(async (source) => {
      const adapter = providerRegistry.getAdapter(source.provider);
      if (!adapter) return [];

      try {
        const fetchPromise = adapter.getStreams(source.sourceId, { season, episode });
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Stream discovery timeout')), timeoutMs)
        );
        const streams = await Promise.race([fetchPromise, timeoutPromise]);
        return streams.map((s) => ({
          ...s,
          provider: source.provider,
          providerLabel: source.providerLabel || adapter.label,
        }));
      } catch (err) {
        logger.warn(TAG, `Stream fetch failed for provider ${source.provider}: ${err.message}`);
        return [];
      }
    });

    const streamBatches = await Promise.allSettled(streamPromises);
    const combinedStreams = [];
    for (const batch of streamBatches) {
      if (batch.status === 'fulfilled' && Array.isArray(batch.value)) {
        combinedStreams.push(...batch.value);
      }
    }

    return combinedStreams;
  }
}

export const searchAggregator = new SearchAggregator();
