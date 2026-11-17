import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../scripts/config.mjs';
import { createHttp } from '../scripts/lib/http.mjs';
import { createGatekeeper } from '../scripts/lib/pipeline.mjs';
import * as x from '../scripts/sources/x.mjs';
import { mockFetch, noSleep } from './helpers.mjs';

const cfg = config();
const TOKEN = 'AAAA-secret-token-for-tests-%3D%3D';
const NOW = Date.parse('2026-11-16T22:30:00Z');
const MIN = 60000;

const users = cfg.x.accounts.map((name, i) => ({ id: String(101 + i), username: name }));
const post = (id, authorId, text, minutesAgo = 5) => ({
  id: String(id),
  author_id: String(authorId),
  text,
  created_at: new Date(NOW - minutesAgo * MIN).toISOString(),
});
const posts = [
  post(9001, 101, 'BREAKING: Major outage hits airline check-in systems https://t.co/abc123', 5),
  post(9003, 102, 'Cloudflare outage knocks sites offline across the US', 3),
  post(9002, 103, 'Earthquake M6.1 strikes off the coast &amp; people felt it', 9),
];

function xApi({ userBody = { data: users }, searchBody = { data: posts, meta: { newest_id: '9003', result_count: 3 } }, searchStatus = 200, userStatus = 200 } = {}) {
  return mockFetch([
    ['/2/users/by', () => ({ status: userStatus, body: JSON.stringify(userBody) })],
    ['/2/tweets/search/recent', () => ({ status: searchStatus, body: JSON.stringify(searchBody) })],
  ]);
}
const ctxFor = (m, { env = { X_BEARER_TOKEN: TOKEN }, xState = null, now = NOW } = {}) => ({
  http: createHttp({ fetchImpl: m.fetch, sleep: noSleep }),
  now: new Date(now),
  config: cfg,
  env,
  xState,
});

test('without a token nothing is requested and the source says it is off', async () => {
  const m = xApi();
  const r = await x.run(ctxFor(m, { env: {} }));
  assert.equal(m.calls.length, 0);
  assert.equal(r.ok, true);
  assert.equal(r.enabled, false);
  assert.equal(r.skipped, 'off');
  assert.deepEqual(r.items, []);
  const blank = await x.run(ctxFor(m, { env: { X_BEARER_TOKEN: '   ' } }));
  assert.equal(blank.enabled, false);
  assert.equal(m.calls.length, 0);
});

test('first run: one users lookup, then one search, with the token only in the request header', async () => {
  const m = xApi();
  const r = await x.run(ctxFor(m));
  assert.equal(r.ok, true);
  assert.equal(r.enabled, true);
  assert.equal(m.calls.length, 2);
  assert.ok(m.calls[0].url.startsWith(x.USERS_URL), 'users lookup first');
  assert.ok(m.calls[1].url.startsWith(x.SEARCH_URL), 'then the search');
  for (const c of m.calls) {
    assert.equal(c.headers.authorization, `Bearer ${TOKEN}`);
    assert.ok(!c.url.includes(TOKEN), 'the token is never in a URL');
  }
  const search = new URL(m.calls[1].url);
  assert.equal(search.searchParams.get('max_results'), '10');
  assert.equal(search.searchParams.get('tweet.fields'), 'created_at,author_id');
  assert.equal(search.searchParams.has('since_id'), false);
  const q = search.searchParams.get('query');
  assert.match(q, /from:BNONews/);
  assert.match(q, /-is:retweet -is:reply lang:en/);
  assert.equal(r.items.length, 3);
});

test('posts become headlines: link removed, entities decoded, linked to the post', async () => {
  const r = await x.run(ctxFor(xApi()));
  const byUrl = Object.fromEntries(r.items.map((i) => [i.url, i]));
  const first = byUrl['https://x.com/BNONews/status/9001'];
  assert.equal(first.title, 'BREAKING: Major outage hits airline check-in systems');
  assert.equal(first.kind, 'x');
  assert.equal(first.source, '@BNONews on X');
  assert.equal(first.publishedAt, NOW - 5 * MIN);
  assert.equal(byUrl['https://x.com/Breaking911/status/9002'].title, 'Earthquake M6.1 strikes off the coast & people felt it');
});

test('the newest id is saved, and the next run sends it as since_id without looking up users again', async () => {
  const first = await x.run(ctxFor(xApi()));
  assert.equal(first.state.sinceId, '9003');
  assert.equal(Object.keys(first.state.users).length, 10);

  const m = xApi({ searchBody: { meta: { result_count: 0 } } });
  const later = await x.run(ctxFor(m, { xState: first.state, now: NOW + 61 * MIN }));
  assert.equal(m.calls.length, 1, 'users are cached, only the search runs');
  assert.ok(m.calls[0].url.startsWith(x.SEARCH_URL));
  assert.equal(new URL(m.calls[0].url).searchParams.get('since_id'), '9003');
  assert.equal(later.state.sinceId, '9003', 'an empty result does not lose the id');
  assert.equal(later.ok, true);
  assert.deepEqual(later.items, []);
});

test('a second call inside 60 minutes is skipped with no request', async () => {
  const first = await x.run(ctxFor(xApi()));
  const m = xApi();
  const again = await x.run(ctxFor(m, { xState: first.state, now: NOW + 59 * MIN }));
  assert.equal(again.skipped, 'interval');
  assert.equal(again.ok, true);
  assert.equal(m.calls.length, 0);
  const ok = await x.run(ctxFor(xApi(), { xState: first.state, now: NOW + 60 * MIN }));
  assert.equal(ok.skipped, null);
});

test('a failed run still counts as a try, so a broken day does not hammer the API', async () => {
  const m = xApi({ searchStatus: 500 });
  const r = await x.run(ctxFor(m));
  assert.equal(r.ok, false);
  assert.ok(r.state.lastRunAt);
  const again = await x.run(ctxFor(xApi(), { xState: r.state, now: NOW + 5 * MIN }));
  assert.equal(again.skipped, 'interval');
});

test('the usage log: 10 users at $0.01 and 3 posts at $0.005 is $0.115', async () => {
  const r = await x.run(ctxFor(xApi()));
  assert.deepEqual(r.state.usage['2026-11-16'], { calls: 2, posts: 3, users: 10, usd: 0.115 });
});

test('the daily budget stops a call whose worst case would go over', async () => {
  const m = xApi();
  const r = await x.run(ctxFor(m, { env: { X_BEARER_TOKEN: TOKEN, X_DAILY_BUDGET_USD: '0.04' } }));
  assert.equal(r.skipped, 'budget');
  assert.equal(r.ok, true);
  assert.equal(m.calls.length, 0, 'not even the users lookup ($0.10 worst case) fits in $0.04');
});

test('with users cached, a $0.04 budget still blocks the search ($0.05 worst case), $0.05 allows it', async () => {
  const seeded = { users: Object.fromEntries(users.map((u) => [u.id, u.username])), usersFetchedAt: new Date(NOW - 86400000).toISOString() };
  const blocked = xApi();
  const r1 = await x.run(ctxFor(blocked, { env: { X_BEARER_TOKEN: TOKEN, X_DAILY_BUDGET_USD: '0.04' }, xState: seeded }));
  assert.equal(r1.skipped, 'budget');
  assert.equal(blocked.calls.length, 0);
  const allowed = xApi();
  const r2 = await x.run(ctxFor(allowed, { env: { X_BEARER_TOKEN: TOKEN, X_DAILY_BUDGET_USD: '0.05' }, xState: seeded }));
  assert.equal(r2.skipped, null);
  assert.equal(allowed.calls.length, 1);
});

test('money already spent today counts against the cap, and a new UTC day starts fresh', async () => {
  const seeded = {
    users: Object.fromEntries(users.map((u) => [u.id, u.username])),
    usersFetchedAt: new Date(NOW - 86400000).toISOString(),
    usage: { '2026-11-16': { calls: 9, posts: 112, users: 0, usd: 0.56 } },
  };
  const m = xApi();
  const r = await x.run(ctxFor(m, { xState: seeded }));
  assert.equal(r.skipped, 'budget');
  assert.equal(m.calls.length, 0);
  const tomorrow = await x.run(ctxFor(xApi(), { xState: seeded, now: Date.parse('2026-11-17T00:05:00Z') }));
  assert.equal(tomorrow.skipped, null);
});

test('the default cap is $0.60 a day, which with the editor\'s $1.40 makes the owner\'s $2, and a bad override falls back to it', () => {
  assert.equal(x.budgetUsd({}, cfg.x), 0.6);
  assert.equal(cfg.x.dailyBudgetUsd + cfg.editor.dailyBudgetUsd, 2);
  assert.equal(x.budgetUsd({ X_DAILY_BUDGET_USD: 'lots' }, cfg.x), 0.6);
  assert.equal(x.budgetUsd({ X_DAILY_BUDGET_USD: '' }, cfg.x), 0.6);
  assert.equal(x.budgetUsd({ X_DAILY_BUDGET_USD: '-3' }, cfg.x), 0.6);
  assert.equal(x.budgetUsd({ X_DAILY_BUDGET_USD: '0' }, cfg.x), 0);
  assert.equal(x.budgetUsd({ X_DAILY_BUDGET_USD: '2.5' }, cfg.x), 2.5);
});

test('the user lookup is redone only after a week, and an account that does not exist cannot trigger it', async () => {
  const cached = (daysAgo) => ({
    users: Object.fromEntries(users.map((u) => [u.id, u.username])),
    usersFetchedAt: new Date(NOW - daysAgo * 86400000).toISOString(),
    lastRunAt: new Date(NOW - 2 * 3600000).toISOString(),
  });
  const fresh = xApi();
  await x.run(ctxFor(fresh, { xState: cached(3) }));
  assert.equal(fresh.calls.length, 1);
  const stale = xApi();
  await x.run(ctxFor(stale, { xState: cached(8) }));
  assert.equal(stale.calls.length, 2);
  // Only 9 of 10 accounts came back: that is not a reason to look them up again every hour.
  const nine = xApi({ userBody: { data: users.slice(0, 9) } });
  const r = await x.run(ctxFor(nine));
  const later = xApi();
  await x.run(ctxFor(later, { xState: r.state, now: NOW + 2 * 3600000 }));
  assert.equal(later.calls.length, 1);
});

test('a since_id older than the 7 day search window is dropped', async () => {
  const state = { sinceId: '123', lastRunAt: new Date(NOW - 7 * 86400000).toISOString(), users: Object.fromEntries(users.map((u) => [u.id, u.username])), usersFetchedAt: new Date(NOW - 86400000).toISOString() };
  const m = xApi();
  await x.run(ctxFor(m, { xState: state }));
  assert.equal(new URL(m.calls[0].url).searchParams.has('since_id'), false);
});

test('the token never reaches the saved state, the error text or the result', async () => {
  const leaky = mockFetch([
    ['/2/users/by', () => { throw new Error(`socket hang up while sending Bearer ${TOKEN}`); }],
  ]);
  const r = await x.run(ctxFor(leaky));
  assert.equal(r.ok, false);
  assert.ok(!JSON.stringify(r).includes(TOKEN), 'result');
  assert.ok(!JSON.stringify(r.state).includes(TOKEN), 'state');

  const good = await x.run(ctxFor(xApi()));
  assert.ok(!JSON.stringify(good).includes(TOKEN));
  assert.ok(!JSON.stringify(good.state).includes(TOKEN));
});

test('an API error is a failed source with a plain message, not a crash', async () => {
  for (const status of [401, 403, 429, 500]) {
    const r = await x.run(ctxFor(xApi({ searchStatus: status, userStatus: status })));
    assert.equal(r.ok, false, String(status));
    assert.match(r.error, new RegExp(String(status)));
  }
});

test('the search query always fits in 512 characters, trimming keywords from the end', () => {
  const q = x.buildQuery(cfg.x);
  assert.ok(q.length <= 512, `${q.length} chars`);
  const huge = { ...cfg.x, keywords: Array.from({ length: 200 }, (_, i) => `keyword${i}`) };
  const trimmed = x.buildQuery(huge);
  assert.ok(trimmed.length <= 512, `${trimmed.length} chars`);
  assert.match(trimmed, /keyword0\b/);
});

test('posts from accounts we did not look up, or with odd ids, are ignored', () => {
  const items = x.postsToItems(
    [post(5, 101, 'A real post about a Cloudflare outage'), post(6, 999, 'Unknown author outage story'), { id: 'abc', author_id: '101', text: 'Bad id outage story' }, post(7, 101, '   ')],
    { 101: 'BNONews' },
    cfg.x,
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://x.com/BNONews/status/5');
});

test('a long post is cut to 200 characters', () => {
  const [item] = x.postsToItems([post(5, 101, `Outage ${'word '.repeat(100)}`)], { 101: 'BNONews' }, cfg.x);
  assert.ok(Array.from(item.title).length <= 200);
  assert.ok(item.title.endsWith('…'));
});

test('a damaged state file is repaired', () => {
  const s = x.normalizeState({ sinceId: 'abc', lastRunAt: 5, users: [1], usersFetchedAt: {}, usage: 'no' });
  assert.deepEqual(s, x.emptyState());
  assert.deepEqual(x.normalizeState(null), x.emptyState());
  assert.equal(x.normalizeState({ sinceId: '12345' }).sinceId, '12345');
});

test('old usage days are pruned after two weeks', async () => {
  const state = { usage: { '2026-10-01': { calls: 1, posts: 0, users: 0, usd: 0.1 }, '2026-11-10': { calls: 1, posts: 0, users: 0, usd: 0.1 } } };
  const r = await x.run(ctxFor(xApi(), { xState: state }));
  assert.ok(!('2026-10-01' in r.state.usage));
  assert.ok('2026-11-10' in r.state.usage);
});

test('X posts go through the same exclusion filter as any headline', () => {
  const gk = createGatekeeper(cfg);
  const items = x.postsToItems(
    [post(11, 101, 'Airline systems down: check-in outage grounds flights'), post(12, 102, 'Gunman killed after outage at the station'), post(13, 103, 'Trump says the outage was sabotage'), post(14, 104, 'Nice weather in the park today')],
    { 101: 'BNONews', 102: 'spectatorindex', 103: 'Breaking911', 104: 'unusual_whales' },
    cfg.x,
  );
  const verdicts = items.map((i) => gk.admit(i, NOW));
  assert.equal(verdicts[0].keep?.kind, 'x');
  assert.ok(verdicts[0].keep.cat, 'an X post gets its category from the keyword gate');
  assert.match(verdicts[1].drop, /^excluded:/);
  assert.match(verdicts[2].drop, /^excluded:politics/);
  assert.equal(verdicts[3].drop, 'off-topic');
});
