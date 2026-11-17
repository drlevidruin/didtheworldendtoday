import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttp, HttpError } from '../scripts/lib/http.mjs';
import { USER_AGENT } from '../scripts/config.mjs';
import { mockFetch } from './helpers.mjs';

function sleeper() {
  const slept = [];
  return { slept, sleep: async (ms) => void slept.push(ms) };
}

test('every request carries the spec User-Agent', async () => {
  const { fetch, calls } = mockFetch([['example.com', () => ({ body: 'ok' })]]);
  const http = createHttp({ fetchImpl: fetch, sleep: async () => {} });
  await http.getText('https://example.com/a');
  assert.equal(calls[0].headers['user-agent'], 'didtheworldendtoday.com (news aggregator)');
  assert.equal(USER_AGENT, 'didtheworldendtoday.com (news aggregator)');
});

test('a server error is retried once, then the second answer is used', async () => {
  let n = 0;
  const { fetch, calls } = mockFetch([['example.com', () => (++n === 1 ? { status: 503, body: 'busy' } : { body: 'fine' })]]);
  const s = sleeper();
  const http = createHttp({ fetchImpl: fetch, sleep: s.sleep });
  assert.equal(await http.getText('https://example.com/a'), 'fine');
  assert.equal(calls.length, 2);
  assert.equal(s.slept.length, 1);
});

test('two server errors in a row fail, after exactly two tries', async () => {
  const { fetch, calls } = mockFetch([['example.com', () => ({ status: 500, body: 'no' })]]);
  const http = createHttp({ fetchImpl: fetch, sleep: async () => {} });
  await assert.rejects(http.getText('https://example.com/a'), (e) => e instanceof HttpError && e.status === 500);
  assert.equal(calls.length, 2);
});

test('a network error is retried once', async () => {
  let n = 0;
  const { fetch, calls } = mockFetch([
    [
      'example.com',
      () => {
        if (++n === 1) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
        return { body: 'back' };
      },
    ],
  ]);
  const http = createHttp({ fetchImpl: fetch, sleep: async () => {} });
  assert.equal(await http.getText('https://example.com/a'), 'back');
  assert.equal(calls.length, 2);
});

test('a refusal (429, 403) or a missing page (404) is never retried', async () => {
  for (const status of [429, 403, 404, 410]) {
    const { fetch, calls } = mockFetch([['example.com', () => ({ status, body: 'no' })]]);
    const http = createHttp({ fetchImpl: fetch, sleep: async () => {} });
    await assert.rejects(http.getText('https://example.com/a'), (e) => e.status === status, String(status));
    assert.equal(calls.length, 1, `status ${status} must be tried once`);
  }
});

test('a timeout counts as a retryable failure', async () => {
  let n = 0;
  const { fetch, calls } = mockFetch([
    [
      'example.com',
      () => {
        if (++n === 1) throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
        return { body: 'ok' };
      },
    ],
  ]);
  const http = createHttp({ fetchImpl: fetch, sleep: async () => {} });
  assert.equal(await http.getText('https://example.com/a'), 'ok');
  assert.equal(calls.length, 2);
});

test('the 15 second timeout is wired in as an abort signal', async () => {
  let signal;
  const fetchImpl = async (url, init) => {
    signal = init.signal;
    return new Response('ok');
  };
  await createHttp({ fetchImpl }).getText('https://example.com/a');
  assert.ok(signal instanceof AbortSignal);
  assert.equal(signal.aborted, false);
});

test('calls to one host are spaced by gapMs, and different hosts do not wait for each other', async () => {
  const { fetch } = mockFetch([[/./, () => ({ body: 'ok' })]]);
  let t = 1_000_000;
  const s = sleeper();
  const http = createHttp({ fetchImpl: fetch, sleep: async (ms) => { s.slept.push(ms); t += ms; }, now: () => t });
  await http.getText('https://a.example/1', { gapMs: 1000 });
  await http.getText('https://a.example/2', { gapMs: 1000 });
  await http.getText('https://a.example/3', { gapMs: 1000 });
  assert.deepEqual(s.slept, [1000, 1000]);
  await http.getText('https://b.example/1', { gapMs: 1000 });
  assert.deepEqual(s.slept, [1000, 1000]);
});

test('concurrent callers on one key queue up instead of racing', async () => {
  const { fetch } = mockFetch([[/./, () => ({ body: 'ok' })]]);
  let t = 5_000_000;
  const s = sleeper();
  const http = createHttp({ fetchImpl: fetch, sleep: async (ms) => { s.slept.push(ms); t += ms; }, now: () => t });
  await Promise.all([1, 2, 3].map((i) => http.getText(`https://a.example/${i}`, { gapMs: 500, key: 'k' })));
  assert.equal(s.slept.length, 2);
  assert.ok(s.slept[1] >= s.slept[0]);
});

test('offline mode rewrites every host to one that cannot resolve, and never sleeps', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(String(url));
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  };
  const s = sleeper();
  const http = createHttp({ fetchImpl, offline: true, sleep: s.sleep });
  await assert.rejects(http.getText('https://news.google.com/rss/search?q=x', { gapMs: 5000 }), /network error/);
  assert.equal(seen.length, 2);
  for (const u of seen) assert.equal(new URL(u).hostname, 'offline.invalid');
  assert.deepEqual(s.slept, []);
});

test('getJson explains a body that is not JSON', async () => {
  const { fetch } = mockFetch([['example.com', () => ({ body: 'Please limit requests to one every 5 seconds' })]]);
  const http = createHttp({ fetchImpl: fetch, sleep: async () => {} });
  await assert.rejects(http.getJson('https://example.com/a'), /not JSON: Please limit requests/);
});

test('an oversized reply is refused', async () => {
  const { fetch } = mockFetch([['example.com', () => ({ body: 'x'.repeat(2000) })]]);
  const http = createHttp({ fetchImpl: fetch, maxChars: 1000 });
  await assert.rejects(http.getText('https://example.com/a'), /too large/);
});

test('after the run deadline every call fails at once with no request made', async () => {
  const { fetch, calls } = mockFetch([[/./, () => ({ body: 'ok' })]]);
  const http = createHttp({ fetchImpl: fetch, now: () => 2000, deadline: 1000 });
  await assert.rejects(http.getText('https://example.com/a'), /time budget/);
  assert.equal(calls.length, 0);
});
