/**
 * Samsung Tizen Official AVPlay Engine
 * Interacts directly with Samsung's hardware-accelerated AVPlay multimedia framework.
 * Reference: https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html
 */

import { logger } from '../utils/logger.js';

const TAG = 'AVPlayEngine';

export class AVPlayEngine {
  constructor(callbacks = {}) {
    this.callbacks = {
      onTimeUpdate: () => {},
      onDurationChange: () => {},
      onBuffering: () => {},
      onBufferComplete: () => {},
      onEnded: () => {},
      onError: () => {},
      ...callbacks,
    };
    this.isSupported = typeof window !== 'undefined' && Boolean(window.webapis && window.webapis.avplay);
    this.state = 'NONE'; // NONE, IDLE, READY, PLAYING, PAUSED
    this.currentUrl = null;
    this.duration = 0;
    this.currentTime = 0;
  }

  isAvailable() {
    return this.isSupported;
  }

  /**
   * Open and prepare stream with AVPlay.
   */
  async open(streamUrl, { headers = {}, startPositionSeconds = 0, displayRect = { x: 0, y: 0, width: 1920, height: 1080 } } = {}) {
    if (!this.isSupported) {
      throw new Error('Samsung AVPlay API is not available on this platform');
    }

    this.stopAndClose();

    try {
      logger.info(TAG, `Opening AVPlay stream: ${streamUrl}`);
      this.currentUrl = streamUrl;
      window.webapis.avplay.open(streamUrl);
      this.state = 'IDLE';

      // Set display rectangle (TV screen layout)
      window.webapis.avplay.setDisplayRect(displayRect.x, displayRect.y, displayRect.width, displayRect.height);

      // Configure headers / streaming properties if needed
      if (headers && Object.keys(headers).length > 0) {
        const headerStr = Object.entries(headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n');
        window.webapis.avplay.setStreamingProperty('CUSTOM_HEADER', headerStr);
      }

      // Attach official event listeners
      window.webapis.avplay.setListener({
        onbufferingstart: () => {
          logger.debug(TAG, 'AVPlay buffering started');
          this.callbacks.onBuffering(true);
        },
        onbufferingprogress: (percent) => {
          logger.debug(TAG, `AVPlay buffer progress: ${percent}%`);
        },
        onbufferingcomplete: () => {
          logger.debug(TAG, 'AVPlay buffering completed');
          this.callbacks.onBufferComplete();
        },
        oncurrentplaytime: (timeMs) => {
          this.currentTime = timeMs / 1000;
          this.callbacks.onTimeUpdate(this.currentTime);
        },
        onerror: (eventType) => {
          logger.error(TAG, `AVPlay error: ${eventType}`);
          this.callbacks.onError(new Error(`AVPlay error: ${eventType}`));
        },
        onevent: (eventType, eventData) => {
          logger.debug(TAG, `AVPlay event: ${eventType}`, eventData);
        },
        onsubtitlechange: (duration, text) => {
          logger.debug(TAG, `AVPlay subtitle: ${text}`);
        },
        onstreamcompleted: () => {
          logger.info(TAG, 'AVPlay stream completed');
          this.state = 'READY';
          this.callbacks.onEnded();
        },
      });

      // Prepare asynchronously
      await new Promise((resolve, reject) => {
        window.webapis.avplay.prepareAsync(
          () => {
            this.state = 'READY';
            try {
              const durMs = window.webapis.avplay.getDuration();
              this.duration = durMs > 0 ? durMs / 1000 : 0;
              this.callbacks.onDurationChange(this.duration);
            } catch {
              this.duration = 0;
            }

            // Seek to start position if resuming
            if (startPositionSeconds > 0) {
              try {
                window.webapis.avplay.seekTo(Math.floor(startPositionSeconds * 1000));
              } catch (seekErr) {
                logger.warn(TAG, `Initial seek failed: ${seekErr.message}`);
              }
            }

            resolve();
          },
          (err) => {
            this.state = 'NONE';
            reject(new Error(`AVPlay prepareAsync error: ${JSON.stringify(err)}`));
          }
        );
      });
    } catch (err) {
      this.state = 'NONE';
      logger.error(TAG, `AVPlay open failed: ${err.message}`);
      throw err;
    }
  }

  play() {
    if (!this.isSupported || (this.state !== 'READY' && this.state !== 'PAUSED')) return;
    try {
      window.webapis.avplay.play();
      this.state = 'PLAYING';
      logger.info(TAG, 'AVPlay playing');
    } catch (err) {
      logger.error(TAG, `AVPlay play error: ${err.message}`);
    }
  }

  pause() {
    if (!this.isSupported || this.state !== 'PLAYING') return;
    try {
      window.webapis.avplay.pause();
      this.state = 'PAUSED';
      logger.info(TAG, 'AVPlay paused');
    } catch (err) {
      logger.error(TAG, `AVPlay pause error: ${err.message}`);
    }
  }

  seekTo(seconds) {
    if (!this.isSupported || (this.state !== 'PLAYING' && this.state !== 'PAUSED')) return;
    try {
      const ms = Math.max(0, Math.floor(seconds * 1000));
      window.webapis.avplay.seekTo(ms, () => {
        logger.debug(TAG, `Seeked to ${seconds}s`);
      });
    } catch (err) {
      logger.error(TAG, `AVPlay seekTo error: ${err.message}`);
    }
  }

  stopAndClose() {
    if (!this.isSupported) return;
    try {
      if (this.state === 'PLAYING' || this.state === 'PAUSED') {
        window.webapis.avplay.stop();
      }
      if (this.state !== 'NONE') {
        window.webapis.avplay.close();
      }
    } catch (err) {
      logger.warn(TAG, `Error during AVPlay stopAndClose: ${err.message}`);
    } finally {
      this.state = 'NONE';
      this.currentUrl = null;
      this.duration = 0;
      this.currentTime = 0;
    }
  }

  getDuration() {
    return this.duration;
  }

  getCurrentTime() {
    return this.currentTime;
  }
}
