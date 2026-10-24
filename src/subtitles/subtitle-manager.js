/**
 * MovieBox TV Subtitle Manager
 * Handles track discovery, SRT to WebVTT conversion, sync adjustment,
 * language selection (Off, English, Hindi, custom), and TV overlay rendering.
 */

import { storageManager } from '../storage/storage-manager.js';
import { logger } from '../utils/logger.js';

const TAG = 'SubtitleManager';

export function parseSrtToCues(srtText) {
  if (!srtText || typeof srtText !== 'string') return [];
  const normalized = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\s*\n/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    // Line 0 is often sequence number, or timecode directly
    let timeIndex = 0;
    if (!lines[0].includes('-->') && lines.length >= 2 && lines[1].includes('-->')) {
      timeIndex = 1;
    }

    const timeLine = lines[timeIndex];
    if (!timeLine || !timeLine.includes('-->')) continue;

    const [startStr, endStr] = timeLine.split('-->').map((s) => s.trim());
    const startTime = parseTimestamp(startStr);
    const endTime = parseTimestamp(endStr);

    if (isNaN(startTime) || isNaN(endTime)) continue;

    const text = lines.slice(timeIndex + 1).join('\n').trim();
    if (text) {
      cues.push({ startTime, endTime, text });
    }
  }

  return cues;
}

function parseTimestamp(timeStr) {
  if (!timeStr) return NaN;
  // formats: 00:01:20,500 or 00:01:20.500 or 01:20.500
  const parts = timeStr.trim().replace(',', '.').split(':');
  if (parts.length === 3) {
    const hrs = parseFloat(parts[0]);
    const mins = parseFloat(parts[1]);
    const secs = parseFloat(parts[2]);
    return hrs * 3600 + mins * 60 + secs;
  } else if (parts.length === 2) {
    const mins = parseFloat(parts[0]);
    const secs = parseFloat(parts[1]);
    return mins * 60 + secs;
  }
  return parseFloat(parts[0]);
}

export class SubtitleManager {
  constructor(overlayElement = null) {
    this.overlayElement = overlayElement;
    this.currentTrack = null;
    this.availableTracks = [];
    this.cues = [];
    this.activeCue = null;
    this.syncOffsetSeconds = 0; // -2.0 to +2.0
    this.loadUserPreference();
  }

  setOverlayElement(element) {
    this.overlayElement = element;
  }

  loadUserPreference() {
    const settings = storageManager.getSettings();
    this.preferredLanguage = settings.subtitleLanguage || 'off';
  }

  setAvailableTracks(tracks) {
    this.availableTracks = Array.isArray(tracks) ? [...tracks] : [];
    logger.info(TAG, `Loaded ${this.availableTracks.length} available subtitle tracks`);

    // Auto-select preferred track if configured
    if (this.preferredLanguage && this.preferredLanguage !== 'off') {
      const match = this.availableTracks.find(
        (t) => t.language === this.preferredLanguage || t.label?.toLowerCase().includes(this.preferredLanguage)
      );
      if (match) {
        this.selectTrack(match);
      } else {
        this.selectTrack(null);
      }
    } else {
      this.selectTrack(null);
    }
  }

  async selectTrack(track) {
    this.currentTrack = track;
    this.cues = [];
    this.activeCue = null;
    this.renderText('');

    if (!track) {
      logger.info(TAG, 'Subtitles turned OFF');
      storageManager.updateSettings({ subtitleLanguage: 'off' });
      return;
    }

    logger.info(TAG, `Selected subtitle track: ${track.label} (${track.language})`);
    storageManager.updateSettings({ subtitleLanguage: track.language });

    // Load content
    if (track.content) {
      this.cues = parseSrtToCues(track.content);
      logger.info(TAG, `Parsed ${this.cues.length} cues from direct content`);
    } else if (track.url) {
      try {
        const resp = await fetch(track.url);
        if (resp.ok) {
          const text = await resp.text();
          this.cues = parseSrtToCues(text);
          logger.info(TAG, `Loaded ${this.cues.length} cues from URL: ${track.url}`);
        }
      } catch (err) {
        logger.error(TAG, `Failed to load subtitle from ${track.url}: ${err.message}`);
      }
    }
  }

  updateTime(currentTimeSeconds) {
    if (!this.currentTrack || this.cues.length === 0) {
      if (this.activeCue) {
        this.activeCue = null;
        this.renderText('');
      }
      return;
    }

    const adjustedTime = currentTimeSeconds + this.syncOffsetSeconds;
    const matchingCue = this.cues.find((c) => adjustedTime >= c.startTime && adjustedTime <= c.endTime);

    if (matchingCue !== this.activeCue) {
      this.activeCue = matchingCue;
      this.renderText(matchingCue ? matchingCue.text : '');
    }
  }

  adjustSync(deltaSeconds) {
    this.syncOffsetSeconds = Math.max(-5, Math.min(5, this.syncOffsetSeconds + deltaSeconds));
    logger.info(TAG, `Subtitle sync adjusted: ${this.syncOffsetSeconds.toFixed(2)}s`);
    return this.syncOffsetSeconds;
  }

  resetSync() {
    this.syncOffsetSeconds = 0;
  }

  renderText(text) {
    if (!this.overlayElement) return;
    if (!text) {
      this.overlayElement.style.display = 'none';
      this.overlayElement.innerHTML = '';
      return;
    }

    this.overlayElement.style.display = 'block';
    // Clean and split lines
    const sanitized = text
      .replace(/<[^>]*>/g, '') // remove HTML tags from srt
      .replace(/\n/g, '<br/>');
    this.overlayElement.innerHTML = `<span class="subtitle-text-box">${sanitized}</span>`;
  }

  clear() {
    this.currentTrack = null;
    this.availableTracks = [];
    this.cues = [];
    this.activeCue = null;
    this.renderText('');
  }
}

export const subtitleManager = new SubtitleManager();
