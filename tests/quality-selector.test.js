import test from 'node:test';
import assert from 'node:assert/strict';

import { QualitySelector, recordPlaybackFailure, getFailureCount } from '../src/playback/quality-selector.js';

test('QualitySelector - Auto mode with fastest_start strategy selects low-latency stream', () => {
  const selector = new QualitySelector();

  const streams = [
    { id: 'heavy_4k', quality: '2160p', latencyMs: 380, bitrateMbps: 35.0, reliabilityScore: 0.95, url: 'http://cdn/4k.mp4' },
    { id: 'fast_1080p', quality: '1080p', latencyMs: 60, bitrateMbps: 8.0, reliabilityScore: 0.98, url: 'http://cdn/1080p.mp4' },
    { id: 'slow_720p', quality: '720p', latencyMs: 220, bitrateMbps: 4.0, reliabilityScore: 0.9, url: 'http://cdn/720p.mp4' },
  ];

  const result = selector.selectStream(streams, {
    qualityPreference: 'auto',
    selectionStrategy: 'fastest_start',
  });

  assert.ok(result.selectedStream, 'Should select a stream');
  assert.equal(result.selectedStream.id, 'fast_1080p', 'fastest_start should prefer low latency and fast buffer fill');
});

test('QualitySelector - best_quality strategy prioritizes highest resolution', () => {
  const selector = new QualitySelector();

  const streams = [
    { id: 'stream_720', quality: '720p', latencyMs: 30, bitrateMbps: 3.5, url: 'http://cdn/720.mp4' },
    { id: 'stream_1080', quality: '1080p', latencyMs: 80, bitrateMbps: 8.0, url: 'http://cdn/1080.mp4' },
    { id: 'stream_4k', quality: '2160p', latencyMs: 140, bitrateMbps: 20.0, url: 'http://cdn/4k.mp4' },
  ];

  const result = selector.selectStream(streams, {
    qualityPreference: 'auto',
    selectionStrategy: 'best_quality',
  });

  assert.equal(result.selectedStream.id, 'stream_4k', 'best_quality should prefer 4K (2160p)');
});

test('QualitySelector - Manual resolution override selects target resolution or nearest fallback', () => {
  const selector = new QualitySelector();

  const streams = [
    { id: 'stream_1080', quality: '1080p', resolutionNumber: 1080, url: 'http://cdn/1080.mp4' },
    { id: 'stream_720', quality: '720p', resolutionNumber: 720, url: 'http://cdn/720.mp4' },
  ];

  // Exact match 1080p
  const result1080 = selector.selectStream(streams, { qualityPreference: '1080p' });
  assert.equal(result1080.selectedStream.id, 'stream_1080');

  // Requesting 4K (2160p) when 4K is unavailable falls back to nearest (1080p)
  const result4kFallback = selector.selectStream(streams, { qualityPreference: '2160p' });
  assert.equal(result4kFallback.selectedStream.id, 'stream_1080', 'Should fallback to nearest 1080p');
});

test('QualitySelector - Unsupported codec is filtered out', () => {
  const selector = new QualitySelector();

  const streams = [
    { id: 'wmv_stream', quality: '1080p', codec: 'wmv3', container: 'asf', url: 'http://cdn/unsupported.wmv' },
    { id: 'h264_stream', quality: '1080p', codec: 'h264', container: 'mp4', url: 'http://cdn/supported.mp4' },
  ];

  const result = selector.selectStream(streams, { qualityPreference: 'auto' });
  assert.equal(result.selectedStream.id, 'h264_stream');
});

test('QualitySelector - Streams with recorded failures are penalised', () => {
  const selector = new QualitySelector();

  const failingUrl = 'http://flakey-host.com/stream.mp4';
  const goodUrl = 'http://reliable-host.com/stream.mp4';

  recordPlaybackFailure(failingUrl);
  recordPlaybackFailure(failingUrl);

  assert.equal(getFailureCount(failingUrl), 2);

  const streams = [
    { id: 'flakey', quality: '1080p', latencyMs: 50, bitrateMbps: 6.0, url: failingUrl },
    { id: 'reliable', quality: '1080p', latencyMs: 60, bitrateMbps: 6.0, url: goodUrl },
  ];

  const result = selector.selectStream(streams, { qualityPreference: 'auto', selectionStrategy: 'fastest_start' });
  assert.equal(result.selectedStream.id, 'reliable', 'Should avoid flakey host with recent errors');
});
