/**
 * MovieBox TV Companion Server
 * High-performance Node.js companion backend for provider aggregation, CORS proxying,
 * and secure credential handling.
 */

import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { URL } from 'node:url';

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const MOVIEBOX_SECRET = process.env.MOVIEBOX_API_SECRET || 'DEFAULT_SIGNING_SECRET';
const MOVIEBOX_HOST = process.env.MOVIEBOX_HOST || 'https://api6.aoneroom.com';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
}

function sendJson(res, statusCode, data) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function generateMovieboxToken(timestamp) {
  const tsStr = String(timestamp);
  const reversed = tsStr.split('').reverse().join('');
  const hash = crypto.createHash('md5').update(reversed).digest('hex');
  return `${tsStr},${hash}`;
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  // Health check
  if (pathname === '/api/health') {
    sendJson(res, 200, {
      status: 'online',
      service: 'MovieBox TV Companion Backend',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
    return;
  }

  // MovieBox Proxy: Search
  if (pathname === '/api/providers/moviebox/search') {
    const q = reqUrl.searchParams.get('q') || '';
    if (!q) {
      sendJson(res, 200, { items: [] });
      return;
    }

    const timestamp = Date.now();
    const token = generateMovieboxToken(timestamp);
    const targetUrl = `${MOVIEBOX_HOST}/api/v1/search?keyword=${encodeURIComponent(q)}&page=1&per_page=20`;

    try {
      const upstreamResp = await fetch(targetUrl, {
        headers: {
          'Accept': 'application/json',
          'X-Client-Timestamp': String(timestamp),
          'X-Client-Token': token,
          'User-Agent': 'MovieBox-TV/1.0',
        },
        signal: AbortSignal.timeout(7000),
      });

      if (!upstreamResp.ok) {
        sendJson(res, upstreamResp.status, { error: `Upstream HTTP ${upstreamResp.status}`, items: [] });
        return;
      }

      const json = await upstreamResp.json();
      const rawList = json.data?.list || json.list || [];
      const items = rawList.map((item) => ({
        id: String(item.id || item.subject_id),
        provider: 'moviebox',
        title: item.title || item.name || 'Untitled',
        year: String(item.release_year || item.year || ''),
        mediaType: item.stype === 2 ? 'series' : 'movie',
        posterUrl: item.cover_url || null,
        imdbRating: item.imdb_rating ? String(item.imdb_rating) : null,
      }));

      sendJson(res, 200, { items });
    } catch (err) {
      sendJson(res, 502, { error: `Proxy failed: ${err.message}`, items: [] });
    }
    return;
  }

  // MovieBox Proxy: Details
  if (pathname === '/api/providers/moviebox/details') {
    const id = reqUrl.searchParams.get('id') || '';
    if (!id) {
      sendJson(res, 400, { error: 'Missing id parameter' });
      return;
    }

    const targetUrl = `${MOVIEBOX_HOST}/api/v1/subject/detail?id=${encodeURIComponent(id)}`;
    try {
      const upstreamResp = await fetch(targetUrl, { signal: AbortSignal.timeout(7000) });
      if (!upstreamResp.ok) {
        sendJson(res, upstreamResp.status, { error: `Upstream error ${upstreamResp.status}` });
        return;
      }
      const json = await upstreamResp.json();
      sendJson(res, 200, json.data || json);
    } catch (err) {
      sendJson(res, 502, { error: err.message });
    }
    return;
  }

  // 404
  sendJson(res, 404, { error: 'Endpoint not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`MovieBox TV Companion Server listening on http://${HOST}:${PORT}`);
});
