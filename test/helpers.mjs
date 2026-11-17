// Shared test helpers. No test here touches the network or the real data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..');
export const FIX = path.join(HERE, 'fixtures');

export const fixture = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');
export const fixtureJson = (name) => JSON.parse(fixture(name));

export function tmpRoot(prefix = 'dtwet-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function exists(file) {
  return fs.existsSync(file);
}

// A fetch stand-in. routes: [[matcher, responder], ...]; matcher is a string
// (substring of the URL) or a RegExp; responder is a function (url, init) that
// returns { status, body, headers } or throws. Every call is recorded.
export function mockFetch(routes) {
  const calls = [];
  async function fetchImpl(url, init = {}) {
    calls.push({ url: String(url), headers: init.headers || {} });
    for (const [matcher, responder] of routes) {
      const hit = typeof matcher === 'string' ? String(url).includes(matcher) : matcher.test(String(url));
      if (!hit) continue;
      const r = await responder(String(url), init);
      return new Response(r.body ?? '', { status: r.status ?? 200, headers: r.headers ?? {} });
    }
    return new Response('no route', { status: 404 });
  }
  return { fetch: fetchImpl, calls };
}

// A no-op sleep so spacing and retries cost no time in tests.
export const noSleep = async () => {};

// A source module stand-in for runUpdate.
export function fakeSource(id, result) {
  return { id, run: async (ctx) => ({ id, ok: true, count: 0, error: null, ...(typeof result === 'function' ? await result(ctx) : result) }) };
}
export function failingSource(id, error = 'boom') {
  return { id, run: async () => ({ id, ok: false, count: 0, error }) };
}
export function throwingSource(id) {
  return {
    id,
    run: async () => {
      throw new Error('this source has a bug');
    },
  };
}

export function newsItem(over = {}) {
  return {
    via: 'test',
    kind: 'news',
    cat: 'internet',
    title: 'Cloudflare outage knocks thousands of sites offline',
    url: 'https://example.com/a',
    source: 'Example',
    publishedAt: Date.parse('2026-11-16T20:00:00Z'),
    ...over,
  };
}
