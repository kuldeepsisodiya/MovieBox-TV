/**
 * MovieBox TV Catalogue & Discovery Engine
 * Curates rows for Home screen: Trending Now, 4K UHD Showcase, Classics, Animation,
 * and caches catalog metadata.
 */

import { providerRegistry } from '../providers/provider-registry.js';
import { logger } from '../utils/logger.js';

const TAG = 'CatalogService';

export class CatalogService {
  constructor() {
    this.cachedRows = null;
  }

  async getHomeRows() {
    if (this.cachedRows) return this.cachedRows;

    const publicAdapter = providerRegistry.getAdapter('public_domain');
    const items = publicAdapter ? await publicAdapter.search('') : [];

    const trending = items.slice(0, 4);
    const fourkShowcase = items.filter((item) =>
      item.id === 'open-tears-of-steel' || item.id === 'open-big-buck-bunny'
    );
    const animation = items.filter((item) =>
      item.genres?.some((g) => g.toLowerCase().includes('animation'))
    );
    const sciFi = items.filter((item) =>
      item.genres?.some((g) => g.toLowerCase().includes('sci-fi') || g.toLowerCase().includes('vfx'))
    );

    const rows = [
      {
        id: 'row-trending',
        title: 'Trending Now',
        badge: 'Popular',
        items: trending,
      },
      {
        id: 'row-4k',
        title: '4K Ultra HD Showcase',
        badge: '2160p Master',
        items: fourkShowcase.length > 0 ? fourkShowcase : items,
      },
      {
        id: 'row-scifi',
        title: 'Sci-Fi & VFX Masterpieces',
        badge: 'Curated',
        items: sciFi.length > 0 ? sciFi : items,
      },
      {
        id: 'row-animation',
        title: 'Animated Shorts & Family',
        badge: 'All Ages',
        items: animation.length > 0 ? animation : items,
      },
    ];

    this.cachedRows = rows;
    logger.info(TAG, `Loaded ${rows.length} catalog rows`);
    return rows;
  }

  async getFeaturedItem() {
    const rows = await this.getHomeRows();
    const firstRow = rows[0];
    return firstRow?.items[0] || null;
  }

  clearCache() {
    this.cachedRows = null;
  }
}

export const catalogService = new CatalogService();
