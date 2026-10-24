import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSrtToCues, SubtitleManager } from '../src/subtitles/subtitle-manager.js';
import { storageManager } from '../src/storage/storage-manager.js';

test('parseSrtToCues correctly parses multi-cue SRT with comma timestamps', () => {
  const srt = `1
00:00:01,500 --> 00:00:04,200
Hello World!

2
00:00:05,000 --> 00:00:08,800
Second subtitle line with multiple
sentences on two rows.
`;

  const cues = parseSrtToCues(srt);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].startTime, 1.5);
  assert.equal(cues[0].endTime, 4.2);
  assert.equal(cues[0].text, 'Hello World!');

  assert.equal(cues[1].startTime, 5.0);
  assert.equal(cues[1].endTime, 8.8);
  assert.ok(cues[1].text.includes('Second subtitle line'));
});

test('SubtitleManager sync offset adjustments work properly', () => {
  const manager = new SubtitleManager();
  assert.equal(manager.syncOffsetSeconds, 0);

  manager.adjustSync(0.5);
  assert.equal(manager.syncOffsetSeconds, 0.5);

  manager.adjustSync(-0.25);
  assert.equal(manager.syncOffsetSeconds, 0.25);

  manager.resetSync();
  assert.equal(manager.syncOffsetSeconds, 0);
});

test('StorageManager handles favorites add, toggle, and query correctly', () => {
  const movie = {
    id: 'test_movie_1',
    provider: 'public_domain',
    title: 'Test Favorite Film',
    year: '2024',
    posterUrl: 'http://cdn/poster.jpg',
  };

  storageManager.removeItem('moviebox_favorites_v1');

  // Initial state: not favorite
  assert.equal(storageManager.isFavorite(movie.provider, movie.id), false);

  // Toggle on
  const added = storageManager.toggleFavorite(movie);
  assert.equal(added, true);
  assert.equal(storageManager.isFavorite(movie.provider, movie.id), true);

  // Toggle off
  const removed = storageManager.toggleFavorite(movie);
  assert.equal(removed, false);
  assert.equal(storageManager.isFavorite(movie.provider, movie.id), false);
});

test('StorageManager updates history and calculates resume points', () => {
  const movie = {
    id: 'test_movie_hist',
    provider: 'public_domain',
    title: 'History Test Movie',
  };

  storageManager.removeItem('moviebox_history_v1');

  // Under 10 seconds progress should not resume
  storageManager.updateHistory(movie, { progressSeconds: 5, durationSeconds: 600 });
  assert.equal(storageManager.getResumePoint(movie.provider, movie.id), 0);

  // Meaningful progress should return resume point
  storageManager.updateHistory(movie, { progressSeconds: 150, durationSeconds: 600 });
  assert.equal(storageManager.getResumePoint(movie.provider, movie.id), 150);

  // > 92% watched is marked completed and resets resume point
  storageManager.updateHistory(movie, { progressSeconds: 570, durationSeconds: 600 });
  assert.equal(storageManager.getResumePoint(movie.provider, movie.id), 0);
});
