/**
 * Base Provider Adapter Contract
 * All provider adapters must implement this common interface.
 */

export class ProviderAdapter {
  constructor(id, label, capabilities = {}) {
    this.id = id;
    this.label = label;
    this.capabilities = {
      supportsSearch: true,
      supportsDetails: true,
      supportsStreams: true,
      supportsSubtitles: true,
      supportsPagination: false,
      supportsSeries: false,
      ...capabilities,
    };
  }

  /**
   * Search provider for movies / series matching query.
   * @param {string} query
   * @param {object} options
   * @returns {Promise<NormalizedCatalogItem[]>}
   */
  async search(query, options = {}) {
    throw new Error(`Provider ${this.id} has not implemented search()`);
  }

  /**
   * Retrieve full metadata details for a media item.
   * @param {string} id
   * @param {object} options
   * @returns {Promise<NormalizedMediaDetails>}
   */
  async getDetails(id, options = {}) {
    throw new Error(`Provider ${this.id} has not implemented getDetails()`);
  }

  /**
   * Discover and resolve playable stream candidates for an item.
   * @param {string} id
   * @param {object} options - { season, episode }
   * @returns {Promise<StreamCandidate[]>}
   */
  async getStreams(id, options = {}) {
    throw new Error(`Provider ${this.id} has not implemented getStreams()`);
  }

  /**
   * Fetch available subtitle tracks for a stream or item.
   * @param {object} streamCandidate
   * @returns {Promise<SubtitleTrack[]>}
   */
  async getSubtitles(streamCandidate) {
    return [];
  }

  /**
   * Perform a quick health probe to check provider availability.
   * @returns {Promise<{ online: boolean, latencyMs: number, message: string }>}
   */
  async healthCheck() {
    return { online: true, latencyMs: 0, message: 'Ready' };
  }
}
