/**
 * HTML5 Video Playback Engine
 * Provides compliant playback across browsers, TV simulators, and webview fallbacks.
 */

import { logger } from '../utils/logger.js';

const TAG = 'HTML5Engine';

export class HTML5Engine {
  constructor(videoElement, callbacks = {}) {
    this.video = videoElement;
    this.callbacks = {
      onTimeUpdate: () => {},
      onDurationChange: () => {},
      onBuffering: () => {},
      onBufferComplete: () => {},
      onEnded: () => {},
      onError: () => {},
      ...callbacks,
    };
    this.boundHandlers = {};
    this.setupListeners();
  }

  isAvailable() {
    return Boolean(this.video);
  }

  setupListeners() {
    if (!this.video) return;

    this.boundHandlers.timeupdate = () => {
      this.callbacks.onTimeUpdate(this.video.currentTime);
    };
    this.boundHandlers.durationchange = () => {
      this.callbacks.onDurationChange(this.video.duration || 0);
    };
    this.boundHandlers.waiting = () => {
      this.callbacks.onBuffering(true);
    };
    this.boundHandlers.canplay = () => {
      this.callbacks.onBufferComplete();
    };
    this.boundHandlers.playing = () => {
      this.callbacks.onBufferComplete();
    };
    this.boundHandlers.ended = () => {
      this.callbacks.onEnded();
    };
    this.boundHandlers.error = () => {
      const err = this.video.error;
      const msg = err ? `HTML5 Video Error code ${err.code}: ${err.message}` : 'Playback error';
      logger.error(TAG, msg);
      this.callbacks.onError(new Error(msg));
    };

    for (const [event, handler] of Object.entries(this.boundHandlers)) {
      this.video.addEventListener(event, handler);
    }
  }

  async open(streamUrl, { startPositionSeconds = 0 } = {}) {
    if (!this.video) throw new Error('Video element not initialized');
    this.video.src = streamUrl;
    this.video.load();

    return new Promise((resolve, reject) => {
      const onLoadedMetadata = () => {
        cleanup();
        if (startPositionSeconds > 0) {
          try {
            this.video.currentTime = startPositionSeconds;
          } catch (e) {
            logger.warn(TAG, `Seek to start position failed: ${e.message}`);
          }
        }
        resolve();
      };

      const onError = () => {
        cleanup();
        reject(new Error(this.video.error?.message || 'Video failed to load'));
      };

      const cleanup = () => {
        this.video.removeEventListener('loadedmetadata', onLoadedMetadata);
        this.video.removeEventListener('error', onError);
      };

      this.video.addEventListener('loadedmetadata', onLoadedMetadata);
      this.video.addEventListener('error', onError);
    });
  }

  play() {
    if (!this.video) return;
    this.video.play().catch((err) => {
      logger.warn(TAG, `HTML5 play prevented: ${err.message}`);
    });
  }

  pause() {
    if (!this.video) return;
    this.video.pause();
  }

  seekTo(seconds) {
    if (!this.video) return;
    try {
      this.video.currentTime = Math.max(0, Math.min(seconds, this.video.duration || seconds));
    } catch (err) {
      logger.warn(TAG, `Seek error: ${err.message}`);
    }
  }

  stopAndClose() {
    if (!this.video) return;
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
  }

  getDuration() {
    return this.video?.duration || 0;
  }

  getCurrentTime() {
    return this.video?.currentTime || 0;
  }

  destroy() {
    if (!this.video) return;
    for (const [event, handler] of Object.entries(this.boundHandlers)) {
      this.video.removeEventListener(event, handler);
    }
    this.stopAndClose();
  }
}
