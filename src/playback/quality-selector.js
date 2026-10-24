/**
 * MovieBox TV Intelligent Quality Selector & Stream Ranking Engine
 * Evaluates resolution, TV playback capabilities, startup latency, connection reliability,
 * and user preferences (Auto, Fastest Start, Best Quality, Most Reliable, Manual Overrides).
 */

import { parseResolutionNumber } from '../utils/formatters.js';
import { logger } from '../utils/logger.js';

const TAG = 'QualitySelector';

// Track recent playback failures by URL/domain to deprioritize failing mirrors
const recentFailureMap = new Map();
const FAILURE_EXPIRY_MS = 15 * 60 * 1000;

export function recordPlaybackFailure(streamUrl) {
  if (!streamUrl) return;
  try {
    const host = new URL(streamUrl).host;
    const count = recentFailureMap.get(host)?.count || 0;
    recentFailureMap.set(host, { count: count + 1, timestamp: Date.now() });
    logger.warn(TAG, `Recorded playback failure for host: ${host} (Total: ${count + 1})`);
  } catch {
    recentFailureMap.set(streamUrl, { count: 1, timestamp: Date.now() });
  }
}

export function getFailureCount(streamUrl) {
  if (!streamUrl) return 0;
  try {
    const host = new URL(streamUrl).host;
    const entry = recentFailureMap.get(host);
    if (entry && Date.now() - entry.timestamp < FAILURE_EXPIRY_MS) {
      return entry.count;
    }
  } catch {
    const entry = recentFailureMap.get(streamUrl);
    if (entry && Date.now() - entry.timestamp < FAILURE_EXPIRY_MS) return entry.count;
  }
  return 0;
}

export class QualitySelector {
  constructor() {
    this.capabilities = this.detectTVCapabilities();
  }

  detectTVCapabilities() {
    // Samsung 2017+ 4K QLED TV capability matrix
    return {
      maxResolution: 2160,
      supportedCodecs: ['h264', 'avc', 'h265', 'hevc', 'vp9'],
      supportedContainers: ['mp4', 'mkv', 'm3u8', 'mpd', 'webm', 'ts'],
      supports4K: true,
      supportsHDR: true,
    };
  }

  /**
   * Filter and rank available stream candidates according to user preference and strategy.
   * @param {StreamCandidate[]} streams
   * @param {object} settings - { qualityPreference, selectionStrategy }
   * @returns {{ selectedStream: StreamCandidate|null, rankedStreams: StreamCandidate[] }}
   */
  selectStream(streams, settings = {}) {
    if (!Array.isArray(streams) || streams.length === 0) {
      return { selectedStream: null, rankedStreams: [] };
    }

    const preference = settings.qualityPreference || 'auto';
    const strategy = settings.selectionStrategy || 'fastest_start';

    // 1. Filter out completely incompatible streams
    const compatibleStreams = streams.filter((stream) => this.isStreamCompatible(stream));
    const candidatePool = compatibleStreams.length > 0 ? compatibleStreams : streams;

    // 2. Score and rank candidates based on strategy
    const scoredStreams = candidatePool.map((stream) => {
      const scoreData = this.calculateStreamScore(stream, strategy, preference);
      return {
        ...stream,
        resolutionNumber: stream.resolutionNumber || parseResolutionNumber(stream.quality),
        score: scoreData.score,
        reason: scoreData.reason,
        failurePenalty: scoreData.failurePenalty,
        recommended: false,
      };
    });

    // Sort descending by score
    scoredStreams.sort((a, b) => b.score - a.score);

    // Mark the top stream as recommended
    if (scoredStreams.length > 0) {
      scoredStreams[0].recommended = true;
    }

    // 3. Selection
    let selected = null;
    if (preference !== 'auto') {
      const targetRes = parseResolutionNumber(preference);
      // Look for exact match first
      const exactMatch = scoredStreams.find((s) => s.resolutionNumber === targetRes);
      if (exactMatch) {
        selected = exactMatch;
      } else {
        // Nearest available resolution
        selected = this.findNearestResolution(scoredStreams, targetRes);
      }
    } else {
      selected = scoredStreams[0] || null;
    }

    return {
      selectedStream: selected,
      rankedStreams: scoredStreams,
    };
  }

  isStreamCompatible(stream) {
    if (!stream || !stream.url) return false;
    const codec = (stream.codec || '').toLowerCase();
    const container = (stream.container || '').toLowerCase();

    // If codec is specified, check against supported codecs
    if (codec && !this.capabilities.supportedCodecs.some((c) => codec.includes(c))) {
      logger.debug(TAG, `Filtered out stream due to unsupported codec: ${codec}`);
      return false;
    }

    // Check containers
    if (container && !this.capabilities.supportedContainers.some((c) => container.includes(c))) {
      logger.debug(TAG, `Filtered out stream due to unsupported container: ${container}`);
      return false;
    }

    return true;
  }

  calculateStreamScore(stream, strategy, preference) {
    let score = 100;
    const reasons = [];

    const res = stream.resolutionNumber || parseResolutionNumber(stream.quality);
    const latency = stream.latencyMs || 100;
    const bitrate = stream.bitrateMbps || 5.0;
    const reliability = stream.reliabilityScore !== undefined ? stream.reliabilityScore : 0.9;
    const failures = getFailureCount(stream.url);

    // Penalty for recent failures
    const failurePenalty = failures * 45;
    score -= failurePenalty;
    if (failures > 0) {
      reasons.push(`${failures} recent failure(s)`);
    }

    // Direct file / CDN bonus
    if (stream.directFile) {
      score += 20;
      reasons.push('Direct CDN source');
    }

    switch (strategy) {
      case 'fastest_start': {
        // Prioritize low latency & reliable bitrate (sweet spot 4 - 10 Mbps)
        const latencyBonus = Math.max(0, (300 - latency) / 5);
        score += latencyBonus;

        if (bitrate >= 3 && bitrate <= 12) {
          score += 25; // optimal for instant buffer fill on TV
          reasons.push('Fast buffer fill profile');
        } else if (bitrate > 25) {
          score -= 15; // very heavy stream might buffer longer
        }

        score += reliability * 30;
        reasons.push(`Low latency (~${latency}ms)`);
        break;
      }

      case 'best_quality': {
        // Prioritize highest resolution (4K > 1080p > 720p > 480p)
        if (res >= 2160) {
          score += 60;
          reasons.push('4K Ultra HD');
        } else if (res >= 1080) {
          score += 40;
          reasons.push('Full HD 1080p');
        } else if (res >= 720) {
          score += 20;
          reasons.push('HD 720p');
        } else {
          score += 5;
        }

        // Higher bitrate bonus
        score += Math.min(bitrate * 2, 30);
        break;
      }

      case 'most_reliable':
      default: {
        // Heavily weight provider reliability and verified stream score
        score += reliability * 60;
        if (stream.isAuthorized) {
          score += 30;
          reasons.push('Authorized CDN');
        }
        if (latency < 150) {
          score += 15;
        }
        reasons.push(`Reliability rating: ${(reliability * 100).toFixed(0)}%`);
        break;
      }
    }

    // If user has a specific resolution preference, award bonus to matching resolutions
    if (preference !== 'auto') {
      const targetRes = parseResolutionNumber(preference);
      if (res === targetRes) {
        score += 80;
        reasons.unshift(`Matches preferred ${preference}`);
      }
    }

    return {
      score: Math.max(0, Math.round(score)),
      reason: reasons.join(' • '),
      failurePenalty,
    };
  }

  findNearestResolution(streams, targetResolution) {
    if (streams.length === 0) return null;
    let closest = streams[0];
    let minDiff = Math.abs((streams[0].resolutionNumber || 1080) - targetResolution);

    for (let i = 1; i < streams.length; i++) {
      const diff = Math.abs((streams[i].resolutionNumber || 1080) - targetResolution);
      if (diff < minDiff) {
        minDiff = diff;
        closest = streams[i];
      }
    }
    return closest;
  }
}

export const qualitySelector = new QualitySelector();
