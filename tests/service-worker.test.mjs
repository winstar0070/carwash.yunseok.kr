import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const origin = 'https://carwash.test';
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function worker({ put = async () => {}, fetch = async () => new Response('fresh'), stored = new Map() } = {}) {
  const handlers = {}, matches = [], puts = [], timers = [], installed = [];
  const cache = {
    async match(key) { matches.push(key); return stored.get(key); },
    put(key, response) { puts.push(key); return put(key, response); },
    async addAll(paths) { installed.push(...paths); },
  };
  runInNewContext(source, {
    self: { location: { origin }, addEventListener(type, fn) { handlers[type] = fn; }, async skipWaiting() {}, clients: { async claim() {} } },
    caches: { async open() { return cache; }, async keys() { return ['other-app', 'carwash-offline-v16', 'carwash-offline-v18']; }, async delete() {} },
    fetch, URL, Response, AbortController,
    setTimeout(fn, ms) { timers.push({ fn, ms, cleared: false }); return timers.length; },
    clearTimeout(id) { timers[id - 1].cleared = true; },
  });
  function dispatch(path, { mode = 'navigate', method = 'GET' } = {}) {
    const lifetimes = [];
    const event = { request: { url: new URL(path, origin).href, mode, method }, waitUntil(p) { lifetimes.push(p); }, respondWith(p) { this.response = p; } };
    handlers.fetch(event);
    return { ...event, lifetimes };
  }
  return { dispatch, puts, matches, timers, installed, async install() { const tasks = []; handlers.install({ waitUntil(p) { tasks.push(p); } }); await Promise.all(tasks); } };
}

for (const [label, path, mode] of [
  ['navigation', '/', 'navigate'],
  ['external font', 'https://cdn.jsdelivr.net/npm/pretendard/font.woff2', 'cors'],
]) {
  test(`${label} returns a fresh response while cache write is blocked, and extends lifetime until write ends`, async () => {
    const gate = deferred(), h = worker({ put: () => gate.promise });
    const event = h.dispatch(path, { mode });
    assert.ok(event.lifetimes.length > 0, 'Lifetime must be registered during the fetch event');
    const marker = Symbol('pending');
    const response = await Promise.race([event.response, new Promise(resolve => setTimeout(() => resolve(marker), 50))]);
    let lifetimeEnded = false;
    void Promise.all(event.lifetimes).then(() => { lifetimeEnded = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(lifetimeEnded, false, 'Lifetime must include the pending cache write');
    gate.resolve();
    await Promise.all(event.lifetimes);
    assert.notEqual(response, marker, 'Cache writes must not delay the network response');
    assert.equal(await response.text(), 'fresh');
    assert.equal(h.puts.length, 1);
  });

  test(`${label} retains fresh response when cache.put rejects`, async () => {
    const h = worker({ put: async () => { throw new Error('quota exceeded'); } });
    const event = h.dispatch(path, { mode });
    assert.equal(await (await event.response).text(), 'fresh');
    await Promise.all(event.lifetimes); // Rejected writes must be handled rather than escaping as unhandled rejections.
  });
}

test('both HTML URLs use the single root cache offline, and navigation still times out after 3 seconds', async () => {
  for (const path of ['/', '/index.html']) {
    const h = worker({ stored: new Map([['/', new Response('offline')]]), fetch: async () => { throw new Error('offline'); } });
    const event = h.dispatch(path);
    assert.equal(await (await event.response).text(), 'offline');
    assert.deepEqual(h.matches, ['/']);
    assert.equal(h.timers[0].ms, 3000);
    assert.equal(h.timers[0].cleared, true);
    await Promise.all(event.lifetimes);
  }
  const h = worker({ stored: new Map([['/', new Response('timeout fallback')]]), fetch: (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  const event = h.dispatch('/');
  await new Promise(resolve => setImmediate(resolve));
  h.timers[0].fn();
  assert.equal(await (await event.response).text(), 'timeout fallback');
  await Promise.all(event.lifetimes);
});

test('API, non-GET, external documents, and unknown navigation bypass the worker', () => {
  const h = worker();
  for (const [path, options] of [['/api/products', {}], ['/', { method: 'POST' }], ['https://elsewhere.test/', {}], ['/missing', {}]]) {
    assert.equal(h.dispatch(path, options).response, undefined);
  }
});

test('source install caches one HTML document and preserves standalone module dependencies', async () => {
  const h = worker();
  await h.install();
  assert.equal(h.installed.filter(path => path === '/' || path === '/index.html').length, 1);
  assert.equal(new Set(h.installed).size, h.installed.length);
  assert.ok(h.installed.includes('/catalog-data.js'));
  assert.match(source, /carwash-offline-v18/);
});

for (const [label, path, mode] of [['navigation', '/', 'navigate'], ['font', 'https://cdn.jsdelivr.net/npm/pretendard/font.woff2', 'cors']]) {
  test(`${label} returns no-store responses without retaining a cache copy`, async () => {
    const h = worker({ fetch: async () => new Response('private', { headers: { 'Cache-Control': 'private, no-store' } }) });
    const event = h.dispatch(path, { mode });
    assert.equal(await (await event.response).text(), 'private');
    await Promise.all(event.lifetimes);
    assert.deepEqual(h.puts, []);
  });
}

test('unsuccessful navigation falls back while unsuccessful fonts stay uncached', async () => {
  const h = worker({ stored: new Map([['/', new Response('offline')]]), fetch: async () => new Response('unavailable', { status: 503 }) });
  const navigation = h.dispatch('/');
  assert.equal(await (await navigation.response).text(), 'offline');
  const font = h.dispatch('https://cdn.jsdelivr.net/npm/pretendard/font.woff2', { mode: 'cors' });
  assert.equal((await font.response).status, 503);
  await Promise.all([...navigation.lifetimes, ...font.lifetimes]);
  assert.deepEqual(h.puts, []);
});
