import assert from 'node:assert/strict';
import { Agent, fetch as clientFetch } from 'undici';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { once, getEventListeners } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// The test client must not impose its own 300s timeout on proxy responses.
const clientAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
const dataDir = await mkdtemp(join(tmpdir(), 'tokenring-test-'));
process.env.TOKENRING_DATA_DIR = dataDir;
process.env.TOKENRING_LOG_LEVEL = 'silent';
process.env.TOKENRING_ADMIN_PASSWORD = 'test-password-only';
const { buildApp } = await import('../dist/http/app.js');
const { ensureAdminPassword } = await import('../dist/http/auth.js');
const { settingsRepo, DEFAULT_SETTINGS } = await import('../dist/db/repositories/settings.js');
const { providersRepo } = await import('../dist/db/repositories/providers.js');
const { upstreamKeysRepo } = await import('../dist/db/repositories/upstreamKeys.js');
const { virtualKeysRepo } = await import('../dist/db/repositories/virtualKeys.js');
const { db, closeDb } = await import('../dist/db/database.js');
const { dispatch, closeUpstreamClient } = await import('../dist/core/upstreamClient.js');

const json = '{ "choices": [{"message":{"content":"unchanged ✓"}}] }\n';
const chunks = ['data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
  ': upstream heartbeat\n\n', 'data: [DONE]\n\n'];
let handle;
let upstream, app, url, upstreamUrl, token, cookie;
let calls = 0;
const later = (res, ms, fn) => {
  const timer = setTimeout(fn, ms);
  res.once('close', () => clearTimeout(timer));
};

before(async () => {
  upstream = createServer((req, res) => { calls++; handle(req, res); });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  const provider = providersRepo.create({ name: 'mock', baseUrl: `${upstreamUrl}/v1`, isDefault: true });
  upstreamKeysRepo.create({ providerId: provider.id, label: 'mock', secret: 'not-a-real-secret' });
  ({ token } = virtualKeysRepo.create({ name: 'test' }));
  ensureAdminPassword();
  app = await buildApp();
  await app.listen({ host: '127.0.0.1', port: 0 });
  url = `http://127.0.0.1:${app.server.address().port}`;
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'test-password-only' } });
  cookie = login.headers['set-cookie'].split(';')[0];
});

after(async () => {
  await app?.close();
  await closeUpstreamClient();
  await clientAgent.close();
  upstream?.closeAllConnections();
  if (upstream) await new Promise(resolve => upstream.close(resolve));
  closeDb();
  await rm(dataDir, { recursive: true, force: true });
});

function configure(timeoutMs) {
  calls = 0;
  settingsRepo.save({ ...DEFAULT_SETTINGS, requestTimeoutMs: timeoutMs, injectUsageTracking: false });
}
function request(path = '/v1/chat/completions', signal) {
  return clientFetch(`${url}${path}`, {
    dispatcher: clientAgent,
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{"model":"mock","messages":[]}', signal,
  });
}
function rawDispatch(timeoutMs, signal, path = '/v1/chat/completions') {
  return dispatch({ baseUrl: upstreamUrl, path, search: '',
    method: 'GET', headers: {}, body: null, secret: 'test', timeoutMs, signal });
}
async function waitUntil(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await sleep(10); }
  assert.fail('condition did not become true');
}

test('settings API accepts 10/20 minutes and unlimited, rejects invalid values, persists choices', async () => {
  assert.equal(settingsRepo.all().requestTimeoutMs, 1_200_000);
  for (const value of [600_000, 1_200_000, 0, 120_000]) {
    const result = await app.inject({ method: 'PATCH', url: '/api/settings', headers: { cookie }, payload: { requestTimeoutMs: value } });
    assert.equal(result.statusCode, 200);
    closeDb(); // Reopen SQLite to verify persistence rather than just an in-memory value.
    const read = await app.inject({ url: '/api/settings', headers: { cookie } });
    assert.equal(read.json().settings.requestTimeoutMs, value);
    assert.equal(read.json().defaults.requestTimeoutMs, 1_200_000);
  }
  for (const value of [-1, 1, 999, 1_200_001, 1000.5]) {
    const result = await app.inject({ method: 'PATCH', url: '/api/settings', headers: { cookie }, payload: { requestTimeoutMs: value } });
    assert.equal(result.statusCode, 400);
  }
  assert.equal(settingsRepo.all().requestTimeoutMs, 120_000);
  assert.equal(app.server.timeout, 0);
});

test('dashboard key connectivity test still works when response deadline is unlimited', async () => {
  configure(0);
  handle = (_req, res) => later(res, 30, () => {
    res.setHeader('content-type', 'application/json'); res.end('{"data":[{"id":"mock"}]}');
  });
  const key = upstreamKeysRepo.list()[0];
  const response = await app.inject({ method: 'POST', url: `/api/upstream-keys/${key.id}/test`, headers: { cookie } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.deepEqual(response.json().models, ['mock']);
});

test('delayed headers, delayed JSON body and SSE gaps preserve bytes in finite and unlimited modes', async () => {
  for (const timeoutMs of [1000, 0]) {
    configure(timeoutMs);
    handle = (_req, res) => later(res, 60, () => { res.setHeader('content-type', 'application/json'); res.end(json); });
    assert.equal(await (await request()).text(), json);
    handle = (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.flushHeaders(); later(res, 60, () => res.end(json)); };
    assert.equal(await (await request()).text(), json);
    handle = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(chunks[0]);
      later(res, 60, () => { res.write(chunks[1]); later(res, 60, () => res.end(chunks[2])); });
    };
    assert.equal(await (await request()).text(), chunks.join(''));
    assert.equal(calls, 3);
  }
});

test('finite deadline aborts before headers and through JSON body consumption', async () => {
  handle = (_req, res) => later(res, 200, () => res.end(json));
  await assert.rejects(rawDispatch(40), /timeout/);
  handle = (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.flushHeaders(); later(res, 200, () => res.end(json)); };
  const result = await rawDispatch(80);
  try { await assert.rejects(result.response.text()); } finally { result.dispose(); }
});

test('dispose releases abort listeners and cancels an abandoned response body', async () => {
  let closed = false;
  handle = (_req, res) => {
    res.once('close', () => { closed = true; });
    res.writeHead(200, { 'content-type': 'application/json' }); res.flushHeaders();
  };
  const controller = new AbortController();
  const result = await rawDispatch(0, controller.signal);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
  result.dispose();
  result.dispose(); // Cleanup is safe in a finally block even after explicit disposal.
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  await waitUntil(() => closed);
});

test('JSON body deadline returns an error, cleans up, logs failure and does not retry', async () => {
  configure(80); // Below UI minimum only to accelerate the transport regression test.
  let closed = false;
  handle = (_req, res) => { res.on('close', () => { closed = true; }); res.writeHead(200, { 'content-type': 'application/json' }); res.flushHeaders(); };
  const response = await request();
  assert.equal(response.status, 502);
  await response.text();
  await waitUntil(() => closed);
  assert.equal(calls, 1);
  const log = db().prepare('SELECT * FROM request_logs ORDER BY rowid DESC LIMIT 1').get();
  assert.equal(log.succeeded, 0);
  assert.equal(log.status_code, 502);
});

test('active stream still obeys a finite total deadline, without retry or fabricated DONE', async () => {
  configure(100);
  let closed = false;
  handle = (_req, res) => {
    res.on('close', () => { closed = true; });
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(chunks[0]);
    const timer = setInterval(() => res.write(chunks[1]), 15);
    res.on('close', () => clearInterval(timer));
  };
  const response = await request();
  const reader = response.body.getReader();
  let text = '';
  await assert.rejects(async () => {
    for (;;) { const { done, value } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); }
  });
  await waitUntil(() => closed);
  assert.ok(text.startsWith(chunks[0]));
  assert.ok(!text.includes('[DONE]'));
  assert.equal(calls, 1);
});

test('unlimited client disconnect cancels upstream before headers, during JSON and during SSE', async () => {
  for (const phase of ['headers', 'json', 'sse']) {
    configure(0);
    let closed = false;
    handle = (_req, res) => {
      res.on('close', () => { closed = true; });
      if (phase !== 'headers') {
        res.writeHead(200, { 'content-type': phase === 'json' ? 'application/json' : 'text/event-stream' });
        res.flushHeaders();
        if (phase === 'sse') res.write(chunks[0]);
      }
    };
    const controller = new AbortController();
    const pending = request(undefined, controller.signal).then(r => r.text());
    const rejected = assert.rejects(pending);
    await waitUntil(() => calls > 0);
    await sleep(30);
    controller.abort();
    await rejected;
    await waitUntil(() => closed);
    assert.equal(calls, 1);
  }
});

test('genuine upstream JSON and SSE disconnects remain failures without retries', async () => {
  for (const contentType of ['application/json', 'text/event-stream']) {
    configure(0);
    handle = (_req, res) => {
      res.writeHead(200, { 'content-type': contentType }); res.write(contentType === 'application/json' ? '{' : chunks[0]);
      later(res, 30, () => res.destroy());
    };
    const response = await request();
    if (contentType === 'application/json') { assert.equal(response.status, 502); await response.text(); }
    else await assert.rejects(response.text());
    assert.equal(calls, 1);
  }
});

const longDelay = Number(process.env.LONG_TIMEOUT_DELAY_MS || 125_000);
test('real responses beyond the old deadline in finite and unlimited modes', { skip: !process.env.LONG_TIMEOUT_TESTS, timeout: longDelay + 15_000 }, async () => {
  configure(1_200_000);
  const activeBodies = new Map();
  handle = (req, res) => {
    if (req.url.endsWith('/headers')) {
      later(res, longDelay, () => { res.setHeader('content-type', 'application/json'); res.end(json); });
    } else if (req.url.endsWith('/json')) {
      res.writeHead(200, { 'content-type': 'application/json' }); res.flushHeaders();
      later(res, longDelay, () => res.end(json));
    } else {
      res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(chunks[0]);
      if (req.url.endsWith('/active')) {
        const sent = [chunks[0]];
        const timer = setInterval(() => { sent.push(chunks[1]); res.write(chunks[1]); }, 1000);
        res.on('close', () => clearInterval(timer));
        later(res, longDelay, () => {
          clearInterval(timer); sent.push(chunks[2]);
          activeBodies.set(`${req.method}:${req.url}`, sent.join(''));
          res.end(chunks[2]);
        });
      } else {
        later(res, longDelay, () => res.end(chunks.slice(1).join('')));
      }
    }
  };
  const finite = ['headers', 'json', 'sse', 'active'].map(async path => (await request(`/v1/${path}`)).text());
  const unlimited = ['headers', 'json', 'sse', 'active'].map(async path => {
    const result = await rawDispatch(0, undefined, `/v1/${path}`);
    try { return await result.response.text(); } finally { result.dispose(); }
  });
  const results = await Promise.all([...finite, ...unlimited]);
  assert.deepEqual(results, [json, json, chunks.join(''), activeBodies.get('POST:/v1/active'),
    json, json, chunks.join(''), activeBodies.get('GET:/active')]);
  assert.equal(calls, 8);
});
