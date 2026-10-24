import test from 'node:test';
import assert from 'node:assert/strict';

import { TV_KEYS } from '../src/remote/remote-controller.js';
import { formatTimeCode, formatResolution, formatFileSize } from '../src/utils/formatters.js';

test('TV_KEYS defines standard Samsung Tizen remote key codes', () => {
  assert.equal(TV_KEYS.ENTER, 13);
  assert.equal(TV_KEYS.BACK, 10009); // Samsung Tizen Return key
  assert.equal(TV_KEYS.LEFT, 37);
  assert.equal(TV_KEYS.UP, 38);
  assert.equal(TV_KEYS.RIGHT, 39);
  assert.equal(TV_KEYS.DOWN, 40);
  assert.equal(TV_KEYS.PLAY, 415);
  assert.equal(TV_KEYS.PAUSE, 19);
  assert.equal(TV_KEYS.PLAY_PAUSE, 10252);
  assert.equal(TV_KEYS.STOP, 413);
});

test('formatTimeCode produces standard hours:minutes:seconds representation', () => {
  assert.equal(formatTimeCode(0), '00:00');
  assert.equal(formatTimeCode(45), '00:45');
  assert.equal(formatTimeCode(125), '02:05');
  assert.equal(formatTimeCode(3665), '01:01:05');
});

test('formatResolution formats 4K, 1080p, 720p clearly for TV display', () => {
  assert.equal(formatResolution('2160p'), '4K UHD');
  assert.equal(formatResolution('4k'), '4K UHD');
  assert.equal(formatResolution('1080p'), '1080p FHD');
  assert.equal(formatResolution('720p'), '720p HD');
  assert.equal(formatResolution('480p'), '480p SD');
});

test('formatFileSize formats bytes to human-readable units', () => {
  assert.equal(formatFileSize(1024), '1.0 KB');
  assert.equal(formatFileSize(1024 * 1024 * 2.5), '2.5 MB');
  assert.equal(formatFileSize(1024 * 1024 * 1024 * 4.2), '4.2 GB');
});

test('PlaybackAdapter handles engine selection and retryWithFallback', async () => {
  const { PlaybackAdapter } = await import('../src/playback/playback-adapter.js');
  const listeners = {};
  const mockVideo = {
    addEventListener: (evt, cb) => { listeners[evt] = cb; },
    removeEventListener: (evt) => { delete listeners[evt]; },
    pause: () => {},
    play: async () => {},
    removeAttribute: () => {},
    load: () => {
      setImmediate(() => {
        if (listeners.loadedmetadata) listeners.loadedmetadata();
      });
    },
    currentTime: 0,
    duration: 100,
  };

  const adapter = new PlaybackAdapter(mockVideo);
  assert.equal(adapter.engineType, 'html5');

  adapter.switchEngine('html5');
  assert.equal(adapter.engineType, 'html5');

  // retryWithFallback resets candidates and forces html5
  adapter.candidatePool = [{ url: 'http://example.com/stream.mp4', quality: '1080p' }];
  adapter.candidateIndex = 2;
  await adapter.retryWithFallback();
  assert.equal(adapter.candidateIndex, 0);
  assert.equal(adapter.engineType, 'html5');
  adapter.stop();
});

