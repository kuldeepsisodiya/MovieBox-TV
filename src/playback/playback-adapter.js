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
      onEngineChange: () => {},
      onError: () => {},
      ...callbacks,
    };

    this.engine = null;
    this.engineType = null;
    this.html5Engine = null;
    this.avplayEngine = null;
    this.avplayDisabledForSession = false;

    this.activeMedia = null;
    this.activeStream = null;
    this.candidatePool = [];
    this.candidateIndex = 0;
    this.isPlaying = false;
    this.isBuffering = false;
    this.duration = 0;
    this.currentTime = 0;
    this.progressSaveInterval = null;

    this.initEngines();
  }

  initEngines() {
    const isTizenNative = typeof window !== 'undefined' && Boolean(window.webapis && window.webapis.avplay);

    const engineCallbacks = {
      onTimeUpdate: (time) => this.handleTimeUpdate(time),
      onDurationChange: (dur) => this.handleDurationChange(dur),
      onBuffering: (buffering) => this.handleBuffering(buffering),
      onBufferComplete: () => this.handleBuffering(false),
      onEnded: () => this.handleEnded(),
      onError: (err) => this.handlePlaybackError(err),
    };

    this.html5Engine = new HTML5Engine(this.videoElement, engineCallbacks);

    if (isTizenNative) {
      logger.info(TAG, 'Samsung AVPlay hardware support detected');
      this.avplayEngine = new AVPlayEngine(engineCallbacks);
    } else {
      logger.info(TAG, 'Standard web environment: HTML5 Video Engine primary');
    }

    // Default to auto-selected engine
    this.switchEngine(isTizenNative ? 'avplay' : 'html5');
  }

  switchEngine(type) {
    if (this.engine) {
      try {
        this.engine.stopAndClose();
      } catch {}
    }

    if (type === 'avplay' && this.avplayEngine && !this.avplayDisabledForSession) {
      this.engine = this.avplayEngine;
      this.engineType = 'avplay';
    } else {
      this.engine = this.html5Engine;
      this.engineType = 'html5';
    }

    if (this.callbacks.onEngineChange) {
      this.callbacks.onEngineChange(this.engineType);
    }
    logger.info(TAG, `Active playback engine set to: ${this.engineType.toUpperCase()}`);
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

  async playCandidate(stream, startPosition = 0, preferredEngineType = null) {
    logger.info(TAG, `Attempting playback with stream: ${stream.title || stream.url} (${stream.quality})`);
    this.activeStream = stream;
    this.callbacks.onStreamSelected(stream, this.candidatePool);
    this.handleBuffering(true);

    const settings = storageManager.getSettings();
    let targetEngine = preferredEngineType;

    if (!targetEngine) {
      if (settings.playerEngine === 'html5' || !this.avplayEngine || this.avplayDisabledForSession) {
        targetEngine = 'html5';
      } else if (settings.playerEngine === 'avplay') {
        targetEngine = 'avplay';
      } else {
        // 'auto' mode: default to avplay if available, else html5
        targetEngine = this.avplayEngine && !this.avplayDisabledForSession ? 'avplay' : 'html5';
      }
    }

    this.switchEngine(targetEngine);

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
      logger.error(TAG, `Playback error on ${this.engineType} for ${stream.url}: ${err.message}`);

      // If AVPlay failed in Auto mode, seamlessly attempt HTML5 on this exact same stream candidate
      if (this.engineType === 'avplay' && settings.playerEngine !== 'avplay') {
        logger.warn(TAG, `AVPlay failed to open stream. Seamlessly falling back to HTML5 Video for ${stream.quality}...`);
        this.avplayDisabledForSession = true;
        this.switchEngine('html5');
        try {
          await this.engine.open(stream.url, {
            headers: stream.headers || {},
            startPositionSeconds: startPosition,
          });
          this.engine.play();
          this.isPlaying = true;
          this.callbacks.onStateChange('playing');
          this.startProgressSaveLoop();
          return;
        } catch (html5Err) {
          logger.error(TAG, `HTML5 fallback also failed for ${stream.url}: ${html5Err.message}`);
        }
      }

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

  async retryWithFallback() {
    logger.info(TAG, 'User requested fallback retry. Forcing HTML5 engine and restarting candidate pool.');
    this.avplayDisabledForSession = true;
    this.candidateIndex = 0;
    const stream = this.candidatePool[0];
    if (stream) {
      await this.playCandidate(stream, 0, 'html5');
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

  async handlePlaybackError(err) {
    logger.error(TAG, `Engine (${this.engineType}) reported error: ${err.message}`);
    const settings = storageManager.getSettings();

    // If AVPlay failed at runtime in auto mode, immediately switch candidate to HTML5 video
    if (this.engineType === 'avplay' && settings.playerEngine !== 'avplay' && this.activeStream) {
      logger.warn(TAG, 'AVPlay failed at runtime. Switching active stream to HTML5 video fallback...');
      this.avplayDisabledForSession = true;
      this.switchEngine('html5');
      const resumePos = this.currentTime;
      try {
        await this.engine.open(this.activeStream.url, {
          headers: this.activeStream.headers || {},
          startPositionSeconds: resumePos,
        });
        this.engine.play();
        this.isPlaying = true;
        this.callbacks.onStateChange('playing');
        return;
      } catch (html5Err) {
        logger.error(TAG, `HTML5 fallback also failed: ${html5Err.message}`);
      }
    }

    if (this.activeStream) {
      recordPlaybackFailure(this.activeStream.url);
    }
    await this.tryFallbackStream();
  }

  startProgressSaveLoop() {
    this.stopProgressSaveLoop();
    this.progressSaveInterval = setInterval(() => {
      this.saveProgressNow();
    }, 5000); // persist every 5 seconds
    if (this.progressSaveInterval && typeof this.progressSaveInterval.unref === 'function') {
      this.progressSaveInterval.unref();
    }
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
