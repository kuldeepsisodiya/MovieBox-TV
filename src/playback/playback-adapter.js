/**
 * Master Playback Adapter
 * Abstraction layer coordinating AVPlay engine or HTML5 video, subtitle tracking,
 * watch history progress persistence, and automatic stream fallback on failure.
 */

import { AVPlayEngine } from './avplay-engine.js';
import { HTML5Engine } from './html5-engine.js';
import { qualitySelector, recordPlaybackFailure } from './quality-selector.js';
import { subtitleManager } from '../subtitles/subtitle-manager.js';
import { storageManager } from '../storage/storage-manager.js';
import { logger } from '../utils/logger.js';

const TAG = 'PlaybackAdapter';

export class PlaybackAdapter {
  constructor(videoElement, callbacks = {}) {
    this.videoElement = videoElement;
    this.callbacks = {
      onStateChange: () => {},
      onTimeUpdate: () => {},
      onDurationChange: () => {},
      onStreamSelected: () => {},
      onError: () => {},
      ...callbacks,
    };

    this.engine = null;
    this.activeMedia = null;
    this.activeStream = null;
    this.candidatePool = [];
    this.candidateIndex = 0;
    this.isPlaying = false;
    this.isBuffering = false;
    this.duration = 0;
    this.currentTime = 0;
    this.progressSaveInterval = null;

    this.initEngine();
  }

  initEngine() {
    const isTizenNative = typeof window !== 'undefined' && Boolean(window.webapis && window.webapis.avplay);

    const engineCallbacks = {
      onTimeUpdate: (time) => this.handleTimeUpdate(time),
      onDurationChange: (dur) => this.handleDurationChange(dur),
      onBuffering: (buffering) => this.handleBuffering(buffering),
      onBufferComplete: () => this.handleBuffering(false),
      onEnded: () => this.handleEnded(),
      onError: (err) => this.handlePlaybackError(err),
    };

    if (isTizenNative) {
      logger.info(TAG, 'Initializing Samsung AVPlay Hardware Engine');
      this.engine = new AVPlayEngine(engineCallbacks);
      this.engineType = 'avplay';
    } else {
      logger.info(TAG, 'Initializing HTML5 Video Fallback Engine');
      this.engine = new HTML5Engine(this.videoElement, engineCallbacks);
      this.engineType = 'html5';
    }
  }

  /**
   * Start playback for a media item and candidate streams
   */
  async loadMedia(mediaItem, streamCandidates = [], { season = 1, episode = 1, manualStream = null } = {}) {
    this.stop();
    this.activeMedia = mediaItem;
    this.season = season;
    this.episode = episode;

    const settings = storageManager.getSettings();

    // If a specific stream was manually selected, use it
    if (manualStream) {
      this.activeStream = manualStream;
      this.candidatePool = [manualStream, ...streamCandidates.filter((s) => s.url !== manualStream.url)];
      this.candidateIndex = 0;
    } else {
      // Automatic ranking based on user quality and strategy preferences
      const selection = qualitySelector.selectStream(streamCandidates, settings);
      this.activeStream = selection.selectedStream;
      this.candidatePool = selection.rankedStreams;
      this.candidateIndex = 0;
    }

    if (!this.activeStream) {
      throw new Error('No compatible stream candidate found for this title');
    }

    this.callbacks.onStreamSelected(this.activeStream, this.candidatePool);

    // Check watch history for resume point
    const resumePoint = storageManager.getResumePoint(mediaItem.provider, mediaItem.id, season, episode);

    await this.playCandidate(this.activeStream, resumePoint);
  }

  async playCandidate(stream, startPosition = 0) {
    logger.info(TAG, `Attempting playback with stream: ${stream.title || stream.url} (${stream.quality})`);
    this.activeStream = stream;
    this.callbacks.onStreamSelected(stream, this.candidatePool);
    this.handleBuffering(true);

    try {
      await this.engine.open(stream.url, {
        headers: stream.headers || {},
        startPositionSeconds: startPosition,
      });

      this.engine.play();
      this.isPlaying = true;
      this.callbacks.onStateChange('playing');
      this.startProgressSaveLoop();
    } catch (err) {
      logger.error(TAG, `Stream playback error for ${stream.url}: ${err.message}`);
      recordPlaybackFailure(stream.url);
      await this.tryFallbackStream();
    }
  }

  async tryFallbackStream() {
    this.candidateIndex++;
    if (this.candidateIndex < this.candidatePool.length) {
      const nextStream = this.candidatePool[this.candidateIndex];
      logger.warn(TAG, `Falling back to next ranked stream candidate (${this.candidateIndex + 1}/${this.candidatePool.length}): ${nextStream.quality}`);
      const resumePos = this.currentTime;
      await this.playCandidate(nextStream, resumePos);
    } else {
      logger.error(TAG, 'All available stream candidates exhausted');
      this.handleBuffering(false);
      this.isPlaying = false;
      this.callbacks.onStateChange('error');
      this.callbacks.onError(new Error('Unable to play any available stream for this title. Please try another provider or resolution.'));
    }
  }

  play() {
    if (!this.engine) return;
    this.engine.play();
    this.isPlaying = true;
    this.callbacks.onStateChange('playing');
  }

  pause() {
    if (!this.engine) return;
    this.engine.pause();
    this.isPlaying = false;
    this.callbacks.onStateChange('paused');
    this.saveProgressNow();
  }

  togglePlayPause() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  seekRelative(deltaSeconds) {
    const target = Math.max(0, Math.min(this.currentTime + deltaSeconds, this.duration || this.currentTime + deltaSeconds));
    this.seekTo(target);
  }

  seekTo(seconds) {
    if (!this.engine) return;
    this.currentTime = seconds;
    this.engine.seekTo(seconds);
    subtitleManager.updateTime(seconds);
    this.callbacks.onTimeUpdate(this.currentTime, this.duration);
  }

  stop() {
    this.stopProgressSaveLoop();
    if (this.engine) {
      this.engine.stopAndClose();
    }
    this.isPlaying = false;
    this.isBuffering = false;
    this.currentTime = 0;
    this.duration = 0;
    this.activeStream = null;
    this.callbacks.onStateChange('stopped');
  }

  handleTimeUpdate(timeSeconds) {
    this.currentTime = timeSeconds;
    subtitleManager.updateTime(timeSeconds);
    this.callbacks.onTimeUpdate(this.currentTime, this.duration);
  }

  handleDurationChange(durationSeconds) {
    this.duration = durationSeconds;
    this.callbacks.onDurationChange(durationSeconds);
  }

  handleBuffering(isBuffering) {
    this.isBuffering = isBuffering;
    this.callbacks.onStateChange(isBuffering ? 'buffering' : this.isPlaying ? 'playing' : 'paused');
  }

  handleEnded() {
    this.isPlaying = false;
    this.saveProgressNow();
    this.callbacks.onStateChange('ended');
  }

  handlePlaybackError(err) {
    logger.error(TAG, `Engine reported error: ${err.message}`);
    if (this.activeStream) {
      recordPlaybackFailure(this.activeStream.url);
    }
    this.tryFallbackStream();
  }

  startProgressSaveLoop() {
    this.stopProgressSaveLoop();
    this.progressSaveInterval = setInterval(() => {
      this.saveProgressNow();
    }, 5000); // persist every 5 seconds
  }

  stopProgressSaveLoop() {
    if (this.progressSaveInterval) {
      clearInterval(this.progressSaveInterval);
      this.progressSaveInterval = null;
    }
  }

  saveProgressNow() {
    if (!this.activeMedia || this.currentTime < 3) return;
    storageManager.updateHistory(this.activeMedia, {
      progressSeconds: this.currentTime,
      durationSeconds: this.duration,
      season: this.season,
      episode: this.episode,
      streamQuality: this.activeStream?.quality || '',
    });
  }
}
