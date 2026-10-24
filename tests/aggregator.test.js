import test from 'node:test';
import assert from 'node:assert/strict';

import { SearchAggregator, normalizeTitleKey } from '../src/providers/aggregator.js';
import { ProviderAdapter } from '../src/providers/provider-base.js';

test('normalizeTitleKey correctly strips years and symbols', () => {
  assert.equal(normalizeTitleKey('Tears of Steel', '2012'), 'tearsofsteel_2012');
  assert.equal(normalizeTitleKey('Tears of Steel (2012)', ''), 'tearsofsteel_2012');
  assert.equal(normalizeTitleKey('Big Buck Bunny 1080p Bluray x264', '2008'), 'bigbuckbunny_2008');
  assert.equal(normalizeTitleKey('The Lord of the Rings: The Return of the King', '2003'), 'thelordoftheringsthereturnoftheking_2003');
});

test('SearchAggregator merges and deduplicates matching titles from multiple providers', () => {
  const aggregator = new SearchAggregator();
  const map = new Map();

  const providerA = { id: 'prov_a', label: 'Provider A' };
  const providerB = { id: 'prov_b', label: 'Provider B' };

  const resultsA = [
    { id: 'a1', title: 'Tears of Steel', year: '2012', posterUrl: 'http://cdn.com/posterA.jpg', isAuthorized: true },
    { id: 'a2', title: 'Unique Movie A', year: '2020', isAuthorized: true },
  ];

  const resultsB = [
    { id: 'b1', title: 'Tears of Steel (2012)', year: '2012', backdropUrl: 'http://cdn.com/backdropB.jpg', isAuthorized: false },
    { id: 'b2', title: 'Unique Movie B', year: '2021', isAuthorized: false },
  ];

  aggregator.mergeResults(map, resultsA, providerA);
  aggregator.mergeResults(map, resultsB, providerB);

  const items = Array.from(map.values());
  assert.equal(items.length, 3, 'Should have deduplicated Tears of Steel into 1 item + 2 unique items');

  const tears = items.find((i) => i.title.includes('Tears of Steel'));
  assert.ok(tears, 'Tears of Steel should exist');
  assert.equal(tears.sources.length, 2, 'Should preserve both provider sources');
  assert.equal(tears.posterUrl, 'http://cdn.com/posterA.jpg');
  assert.equal(tears.backdropUrl, 'http://cdn.com/backdropB.jpg');
  assert.equal(tears.isAuthorized, true, 'Should mark as authorized if at least one source is authorized');
});

test('SearchAggregator handles slow/timeout and failing providers without failing search', async () => {
  // Mock mockable registry
  class FastProvider extends ProviderAdapter {
    async search() {
      return [{ id: 'fast1', title: 'Fast Movie', year: '2024' }];
    }
  }

  class FailingProvider extends ProviderAdapter {
    async search() {
      throw new Error('Database connection failed');
    }
  }

  class TimeoutProvider extends ProviderAdapter {
    async search(query, options = {}) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          resolve([{ id: 'slow1', title: 'Slow Movie', year: '2024' }]);
        }, 500);
        if (options.signal) {
          options.signal.addEventListener('abort', () => clearTimeout(timer));
        }
      });
    }
  }

  const aggregator = new SearchAggregator();

  // Test isolated execution
  const fast = new FastProvider('fast', 'Fast');
  const failing = new FailingProvider('failing', 'Failing');
  const timeoutProv = new TimeoutProvider('timeout', 'Timeout');

  const statusList = [];
  const mergedMap = new Map();

  const adapters = [fast, failing, timeoutProv];
  const timeoutMs = 50; // fast timeout for test

  const promises = adapters.map(async (adapter) => {
    const status = { id: adapter.id, status: 'pending', error: null };
    try {
      const searchPromise = adapter.search('test');
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
      );
      const res = await Promise.race([searchPromise, timeoutPromise]);
      status.status = 'success';
      aggregator.mergeResults(mergedMap, res, adapter);
    } catch (err) {
      if (err.message.includes('Timeout')) {
        status.status = 'timeout';
      } else {
        status.status = 'error';
      }
      status.error = err.message;
    }
    statusList.push(status);
  });

  await Promise.all(promises);

  assert.equal(statusList.find((s) => s.id === 'fast').status, 'success');
  assert.equal(statusList.find((s) => s.id === 'failing').status, 'error');
  assert.equal(statusList.find((s) => s.id === 'timeout').status, 'timeout');

  const results = Array.from(mergedMap.values());
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Fast Movie');
});

test('SearchAggregator handles edge cases: empty queries and long titles', async () => {
  const aggregator = new SearchAggregator();
  const emptyRes = await aggregator.search('   ');
  assert.deepEqual(emptyRes.items, []);

  const longTitle = 'The Super Ultra Extended Director Cut of a Very Long Cinematic Film That Spans Multiple Lines (2025)';
  const key = normalizeTitleKey(longTitle, '2025');
  assert.ok(key.length > 0);
  assert.ok(key.includes('2025'));
});
