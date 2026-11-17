import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../scripts/config.mjs';
import { createHttp } from '../scripts/lib/http.mjs';
import { compileGate, compileKeywordFiling } from '../scripts/lib/filter.mjs';
import { createGatekeeper } from '../scripts/lib/pipeline.mjs';
import * as cluster from '../scripts/lib/cluster.mjs';
import * as x from '../scripts/sources/x.mjs';
import { fixtureJson, mockFetch, newsItem, noSleep } from './helpers.mjs';

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

test('posts become headlines: link removed, entities decoded, the label at the start dropped, linked to the post', async () => {
  const r = await x.run(ctxFor(xApi()));
  const byUrl = Object.fromEntries(r.items.map((i) => [i.url, i]));
  const first = byUrl['https://x.com/BNONews/status/9001'];
  assert.equal(first.title, 'Major outage hits airline check-in systems');
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

// ---- Downdetector: every post counts -------------------------------------------------------------------------------

const DD = users.find((u) => u.username === 'DownDetector').id;
const DD_POSTS = [
  'User reports indicate problems at Apple since 12:20 PM EST.',
  'User reports indicate Instagram is having problems since 9:02 AM EST.',
  'User reports indicate possible problems at Verizon Wireless since 3:15 PM EST.',
];

test('the search asks for every Downdetector post besides the watched accounts with keywords, and the filters cover the whole query', async () => {
  const q = x.buildQuery(cfg.x);
  assert.ok(q.includes(' OR (from:DownDetector)'), 'the Downdetector clause, spelled as in the accounts list');
  assert.ok(q.startsWith('(((from:BNONews OR '), 'the whole OR sits inside one more pair of parentheses');
  assert.ok(q.endsWith(') -is:retweet -is:reply lang:en'), 'so the three filters apply to every part of it');
  assert.equal(q.split('-is:retweet').length, 2, 'once');
  assert.ok(q.length <= 512, `${q.length} chars`);
  // the parentheses are balanced and the keywords are still in
  assert.equal(q.split('(').length, q.split(')').length);
  assert.match(q, /\(outage OR /);
  // and it is the query the search call really sends
  const m = xApi();
  await x.run(ctxFor(m));
  assert.equal(new URL(m.calls[1].url).searchParams.get('query'), q);
});

test('a long keyword list is trimmed from the end and the Downdetector clause and the filters stay', () => {
  const huge = { ...cfg.x, keywords: Array.from({ length: 200 }, (_, i) => `keyword${i}`) };
  const q = x.buildQuery(huge);
  assert.ok(q.length <= 512, `${q.length} chars`);
  assert.match(q, /keyword0\b/);
  assert.ok(q.includes(' OR (from:DownDetector)'));
  assert.ok(q.endsWith(') -is:retweet -is:reply lang:en'));
  assert.ok(!q.includes('keyword199'), 'the tail of the list was dropped');
});

test('with no every-post accounts there is no extra clause, and the query is the old one inside one pair of parentheses', () => {
  for (const none of [{ ...cfg.x, everyPost: [] }, { ...cfg.x, everyPost: undefined }]) {
    const q = x.buildQuery(none);
    assert.ok(!q.includes('OR (from:'), q);
    assert.ok(q.startsWith('(((from:BNONews OR '));
    assert.ok(q.endsWith(')) -is:retweet -is:reply lang:en'));
  }
  const two = x.buildQuery({ ...cfg.x, everyPost: ['DownDetector', 'BNONews'] });
  assert.ok(two.includes(' OR (from:DownDetector) OR (from:BNONews)) -is:retweet'));
});

test('every account in everyPost is also in accounts, in the same spelling, so its posts can be told apart', () => {
  assert.deepEqual(cfg.x.everyPost, ['DownDetector']);
  for (const handle of cfg.x.everyPost) assert.ok(cfg.x.accounts.includes(handle), handle);
});

test('Downdetector posts from the search become internet stories that nothing excludes', () => {
  const gk = createGatekeeper(cfg);
  const items = x.postsToItems(
    DD_POSTS.map((text, i) => post(7000 + i, DD, text, 10 + i)),
    { [DD]: 'DownDetector' },
    cfg.x,
  );
  assert.equal(items.length, 3);
  assert.equal(items[0].title, DD_POSTS[0]);
  assert.equal(items[0].url, 'https://x.com/DownDetector/status/7000');
  assert.equal(items[0].source, '@DownDetector on X');
  for (const item of items) {
    assert.equal(gk.excluder.test(item.title, { signal: false, source: item.source }), null, `${item.title}: not excluded`);
    const verdict = gk.admit(item, NOW);
    assert.equal(verdict.drop, undefined, `${item.title}: ${verdict.drop}`);
    assert.equal(verdict.keep?.cat, 'internet', item.title);
    assert.equal(verdict.keep.kind, 'x');
  }
});

test('the Downdetector keyword is narrow: other reports of "user reports" do not slip in as outages', () => {
  const gk = createGatekeeper(cfg);
  for (const text of ['Nice weather in the park today', 'New survey of user reports shows people like dogs', 'Customers report great service at the new cafe']) {
    const [item] = x.postsToItems([post(7100, 101, text)], { 101: 'BNONews' }, cfg.x);
    assert.equal(gk.admit(item, NOW).drop, 'off-topic', text);
  }
});

// ---- Phase 17: X posts reach the page ------------------------------------------------------------------------------
// The run of 4:32 PM ET on 11/17 read 4 posts and kept none. Downdetector's posts end in "How is it affecting you?
// #Name", so the question rule dropped every one, and the NSA post fit no category on its own.

const HANDLES = Object.fromEntries(users.map((u) => [u.id, u.username]));
const idOf = (name) => users.find((u) => u.username === name).id;
const headline = (text) => x.postHeadline(text, cfg.x.headlineChars);
const xItem = (text, who = 'BNONews') => x.postsToItems([post(8100, idOf(who), text)], HANDLES, cfg.x)[0];

const FOUR_POSTS = [
  post(8001, DD, 'User reports indicate problems with Uber since 3:24 PM EST. How is it affecting you? #Uber https://t.co/uber0001'),
  post(8002, DD, 'User reports indicate problems with Roblox since 3:20 PM EST. How is it affecting you? #Roblox'),
  post(8003, idOf('BNONews'), 'Classified US national security communications network hit by outage, NSA says https://t.co/nsa00001'),
  post(8004, idOf('spectatorindex'), 'Transportation Secretary Sean Duffy says federal intelligence agencies have ruled out a cyberattack as the cause of the outage'),
];

test('the four posts of the 4:32 PM run: Uber, Roblox and the NSA post are kept as internet, and the Duffy post is still dropped as politics', () => {
  const gk = createGatekeeper(cfg);
  const items = x.postsToItems(FOUR_POSTS, HANDLES, cfg.x);
  assert.equal(items.length, 4);
  const [uber, roblox, nsa, duffy] = items.map((i) => gk.admit(i, NOW));
  assert.equal(uber.keep?.cat, 'internet', JSON.stringify(uber));
  assert.equal(uber.keep.title, 'User reports indicate problems with Uber since 3:24 PM EST.');
  assert.equal(uber.keep.kind, 'x');
  assert.equal(roblox.keep?.cat, 'internet', JSON.stringify(roblox));
  assert.equal(roblox.keep.title, 'User reports indicate problems with Roblox since 3:20 PM EST.');
  assert.equal(nsa.keep?.cat, 'internet', JSON.stringify(nsa));
  assert.equal(nsa.keep.title, 'Classified US national security communications network hit by outage, NSA says');
  assert.deepEqual(duffy, { drop: 'excluded:politics', detail: 'Duffy' });
});

test('a post that is only a question stays as it is, and the question rule still drops it', () => {
  const gk = createGatekeeper(cfg);
  for (const text of ['Anyone else having trouble with Verizon today?', 'Is your Wi-Fi acting up? Is it just you?']) {
    assert.equal(headline(text), text, 'the headline is the post');
    assert.equal(gk.admit(xItem(text, 'DownDetector'), NOW).drop, 'excluded:question', text);
  }
  const hashed = xItem('How is it affecting you? #Uber', 'DownDetector');
  assert.ok(hashed, 'a question with a hashtag is still a post');
  assert.equal(hashed.title, 'How is it affecting you?', 'the hashtag at its end still goes');
  assert.equal(gk.admit(hashed, NOW).drop, 'excluded:question');
});

test('hashtags at the end of a post go, and a hashtag inside a sentence stays', () => {
  assert.equal(headline('Uber outage right now #Uber'), 'Uber outage right now');
  assert.equal(headline('Roblox outage right now #Roblox #outage'), 'Roblox outage right now');
  assert.equal(headline('Uber outage right now #Uber https://t.co/abc12345'), 'Uber outage right now', 'once the link is cut out the hashtag is at the end');
  assert.equal(headline('Big #outage at Uber right now'), 'Big #outage at Uber right now');
  assert.equal(headline('Big #outage at Uber right now #Uber'), 'Big #outage at Uber right now');
  assert.equal(headline('#Uber #outage'), '#Uber #outage', 'a post of nothing but hashtags is left alone');
});

test('when a post says something and then asks, the questions at its end go and the rest stays', () => {
  assert.equal(headline('User reports indicate problems with Uber since 3:24 PM EST. How is it affecting you? #Uber'), 'User reports indicate problems with Uber since 3:24 PM EST.');
  assert.equal(headline('Uber is down for thousands of users. Is it down for you? Who else is affected?'), 'Uber is down for thousands of users.');
  assert.equal(headline('Uber is down!! How is it affecting you??'), 'Uber is down!!');
  assert.equal(headline('Is Uber down? Reports say yes. Is it you?'), 'Is Uber down? Reports say yes.', 'only the questions at the end go');
  assert.equal(headline('Is Uber down? Is it just me?'), 'Is Uber down? Is it just me?', 'nothing but questions');
});

test('a full stop after an abbreviation does not end a sentence', () => {
  assert.equal(headline('Dr. Smith asked: is it safe?'), 'Dr. Smith asked: is it safe?');
  assert.equal(headline('Reports: Sen. Smith says the grid is fine. Dr. Jones asked: is it safe?'), 'Reports: Sen. Smith says the grid is fine.');
  assert.equal(headline('Outage began at 3 p.m. EST. Are you affected?'), 'Outage began at 3 p.m. EST.');
});

test('every word in X.keywords has an entry in the map, every entry names a real category, and a more specific phrase comes first', () => {
  const map = cfg.x.keywordCategories;
  const ids = cfg.categories.map((c) => c.id);
  for (const word of cfg.x.keywords.map((k) => k.replaceAll('"', ''))) assert.ok(Object.hasOwn(map, word), `no entry for "${word}"`);
  for (const [word, cat] of Object.entries(map)) assert.ok(ids.includes(cat), `"${word}" is filed under ${cat}, which is not a category`);
  const order = Object.keys(map);
  for (const a of order) {
    for (const b of order) if (a !== b && b.split(' ').includes(a)) assert.ok(order.indexOf(b) < order.indexOf(a), `"${b}" must come before "${a}"`);
  }
});

test('a headline that fits no category is filed by the first keyword it holds, a category that rejects it files nothing, and a price is not an outage', () => {
  const file = compileKeywordFiling(cfg.x.keywordCategories, cfg.x.keywordVeto, compileGate(cfg.categories));
  for (const [word, cat] of Object.entries(cfg.x.keywordCategories)) {
    assert.equal(file(`Officials say ${word} near the harbor tonight`), cat, word);
    assert.equal(file(`OFFICIALS SAY ${word.toUpperCase()} NEAR THE HARBOR`), cat, `${word} in capitals`);
  }
  assert.equal(file('Power outage at the harbor after an outage at the port'), 'grid', 'the most specific keyword first');
  assert.equal(file('Ground stop at the harbor airport after an outage'), 'flights');
  assert.equal(file('Nothing to see at the harbor tonight'), null);
  assert.equal(file('TV blackout hits cable subscribers in the region'), null, 'Lights out rejects a TV blackout');
  assert.equal(file('Electricity outage in the old town'), null, 'Internet down rejects an electricity outage');
  assert.equal(file('The S&P 500 is down 2.1% today'), null, 'a price');
  assert.equal(file('Bitcoin is down 5% after an outage at the exchange'), 'internet', 'the price is cut out, the outage still counts');
  assert.equal(file('Judge finds company in breach of contract over pipeline deal'), null, 'a broken deal, not a hack');
  assert.equal(file('Club says rival in breach of transfer rules'), null);
  assert.equal(file('Data breach exposes millions of patient records'), 'hacks');
});

test('only an X post is filed by its keyword, and only after the quality and exclusion checks', () => {
  const gk = createGatekeeper(cfg);
  assert.equal(gk.admit(xItem('Blackout in Cuba'), NOW).keep?.cat, 'grid');
  assert.equal(gk.admit(xItem('Uber is down'), NOW).keep?.cat, 'internet');
  assert.equal(gk.admit(xItem('Tsunami near the harbor'), NOW).keep?.cat, 'earth');
  assert.equal(gk.admit(xItem('Nothing to see at the harbor tonight'), NOW).drop, 'off-topic');
  const news = { kind: 'news', cat: null, title: 'Blackout in Cuba', url: 'https://example.com/a', source: 'Example Times', publishedAt: NOW - 5 * MIN };
  assert.equal(gk.admit(news, NOW).drop, 'off-topic', 'a news headline is not filed by a keyword');
  assert.equal(gk.admit(xItem('Trump says the outage was sabotage'), NOW).drop, 'excluded:politics');
  assert.match(gk.admit(xItem('Gunman killed after outage at the station'), NOW).drop, /^excluded:/);
});

const STORED_X = {
  id: 'a1b2c3d4e5f6',
  cat: 'internet',
  kind: 'x',
  title: 'Classified US national security communications network hit by outage, NSA says',
  url: 'https://x.com/BNONews/status/8003',
  source: '@BNONews on X',
  publishedAt: '2026-11-17T21:00:00.000Z',
  latestAt: '2026-11-17T21:00:00.000Z',
  firstSeenAt: '2026-11-17T21:05:00.000Z',
  outlets: 1,
  outletNames: ['@BNONews on X'],
  score: 1,
};

test('a stored X story filed by its keyword survives recheck, and so does a story told by several outlets that holds the post', () => {
  const gk = createGatekeeper(cfg);
  assert.deepEqual(gk.recheck(STORED_X), { keep: STORED_X });
  assert.equal(gk.recheck({ ...STORED_X, cat: 'grid' }).keep?.cat, 'internet', 'filed the way admit files it');
  const told = { ...STORED_X, kind: 'news', source: 'Example Times', outletNames: ['Example Times', '@BNONews on X'], outlets: 2 };
  assert.equal(gk.recheck(told).keep?.cat, 'internet', 'the post can be the headline of a story several outlets tell');
  assert.equal(gk.recheck({ ...told, outletNames: ['Example Times', 'Other Times'] }).drop, 'off-topic', 'a story with no post in it is not');
  assert.equal(gk.recheck({ ...STORED_X, title: 'Trump says the outage was sabotage' }).drop, 'excluded:politics', 'the exclusions still come first');
});

test('today\'s live day file (11/17) goes through the gate as it is: nothing in it is dropped, moved or changed', () => {
  const gk = createGatekeeper(cfg);
  const day = fixtureJson('day-2026-11-17-live.json');
  assert.ok(day.stories.length >= 100, `${day.stories.length} stories`);
  for (const story of day.stories) assert.deepEqual(gk.recheck(story), { keep: story }, story.title);
});

// ---- Phase 17c: one story per outage, and post headlines without labels -------------------------------------------
// The run of 4:52 PM ET on 11/17 passed 8 posts, but only 4 stories held one. Every Downdetector post is the same
// sentence with another name in it, so the word-overlap check joined Uber, Roblox, Microsoft 365 and every later
// outage into one story that ranked low and hid them all. And Breaking911 and BNONews start posts with a label.

const LABELS = ['BREAKING', 'BREAKING NEWS', 'JUST IN', 'UPDATE', 'DEVELOPING', 'NEW', 'ALERT', 'URGENT'];
const EQUINOR = "Norway-based Equinor, Europe's largest natural gas supplier, says it will cut output";

test('a label at the start of a post goes: every label, in any case, with or without emoji and symbols before it', () => {
  for (const label of LABELS) {
    const lower = label.toLowerCase();
    for (const form of [label, lower, lower[0].toUpperCase() + lower.slice(1)]) assert.equal(headline(`${form}: ${EQUINOR}`), EQUINOR, form);
  }
  for (const lead of ['🚨 ', '🚨', '⚠️ ', '🔴 ', '🚨🚨 ', '⭕ ', '❗ ', '‼️ ', '🇺🇸 ', '► ', '>> ', '★ ', '• ', '- ', '| ', '* ', '#']) {
    assert.equal(headline(`${lead}BREAKING: ${EQUINOR}`), EQUINOR, `${lead}BREAKING:`);
    assert.equal(headline(`${lead}JUST IN: ${EQUINOR}`), EQUINOR, `${lead}JUST IN:`);
  }
  assert.equal(headline('BREAKING:Uber is down for thousands of users'), 'Uber is down for thousands of users', 'a space after the colon is not needed');
  assert.equal(headline('BREAKING : Uber is down for thousands of users'), 'Uber is down for thousands of users', 'nor before it');
});

test('labels that follow each other all go, and a label that is not at the start stays', () => {
  assert.equal(headline('🚨 BREAKING: JUST IN: Uber is down for thousands of users'), 'Uber is down for thousands of users');
  assert.equal(headline('BREAKING NEWS: UPDATE: 🚨 JUST IN: Uber is down for thousands of users'), 'Uber is down for thousands of users');
  assert.equal(headline('Uber is down. BREAKING: Roblox is down too'), 'Uber is down. BREAKING: Roblox is down too');
  assert.equal(headline('Outage update: Uber is back for most users'), 'Outage update: Uber is back for most users');
  assert.equal(headline('Uber is down, says the BREAKING: tag'), 'Uber is down, says the BREAKING: tag');
  assert.equal(headline('RT @someone: BREAKING: Uber is down'), 'RT @someone: BREAKING: Uber is down');
  for (const text of ['"BREAKING: Uber is down," says a user', '(BREAKING: Uber is down)', '[BREAKING: Uber is down]', '\u201cBREAKING: Uber is down\u201d, says a user']) {
    assert.equal(headline(text), text, 'a post that opens with a quote or a bracket does not open with a label');
  }
});

test('a label needs its colon, so a headline that only starts with the same word stays', () => {
  for (const text of [
    'Breaking news from Tokyo',
    'Breaking news from Tokyo: a quake strikes the coast',
    'Just in time for the storm, power is back',
    'Update on the Uber outage: service is back',
    'New outage hits Uber users across the country',
    'Alert level raised after the quake',
    'Urgent repairs under way at the data center',
    'Developing countries hit by the outage',
  ]) {
    assert.equal(headline(text), text);
  }
  assert.equal(headline('BREAKING: Breaking news from Tokyo'), 'Breaking news from Tokyo', 'the label goes and the headline that begins with the same words stays');
});

test('a post that is only a label stays as it is, and the gate still drops it', () => {
  for (const text of ['BREAKING:', '🚨 BREAKING:', 'JUST IN:', '🚨 BREAKING: JUST IN:', 'BREAKING NEWS: 🚨']) assert.equal(headline(text), text, text);
  assert.equal(headline('BREAKING: Uber'), 'Uber', 'one word after the label is enough for the label to go');
  const only = xItem('BREAKING:');
  assert.ok(only, 'a post that is only a label is still a post');
  assert.equal(only.title, 'BREAKING:');
  assert.equal(createGatekeeper(cfg).admit(only, NOW).drop, 'too-short');
});

test('the label rule works with the hashtag and question rules, and the page gets the headline without the label', () => {
  assert.equal(headline('🚨 BREAKING: Uber is down right now #Uber'), 'Uber is down right now');
  assert.equal(headline('BREAKING: User reports indicate problems with Uber since 3:24 PM EST. How is it affecting you? #Uber https://t.co/uber0001'), 'User reports indicate problems with Uber since 3:24 PM EST.');
  assert.equal(headline('JUST IN: Is Uber down? Is it just you?'), 'Is Uber down? Is it just you?', 'a post of nothing but questions is still left to the question rule');
  const gk = createGatekeeper(cfg);
  const verdict = gk.admit(xItem('🚨 BREAKING: Cloudflare outage knocks thousands of sites offline'), NOW);
  assert.equal(verdict.keep?.title, 'Cloudflare outage knocks thousands of sites offline');
  assert.equal(verdict.keep.cat, 'internet');
  const long = headline(`BREAKING: ${'word '.repeat(100)}`);
  assert.ok(Array.from(long).length <= cfg.x.headlineChars && long.startsWith('word'), 'the 200 characters are spent on the post, not on its label');
});

// Downdetector's four posts of the 4:52 PM run, as the X source returns them.
const DD_FOUR = [
  post(8201, DD, 'User reports indicate problems with Uber since 3:24 PM EST. How is it affecting you? #Uber https://t.co/uber0001', 28),
  post(8202, DD, 'User reports indicate problems with Roblox since 3:20 PM EST. How is it affecting you? #Roblox', 32),
  post(8203, DD, 'User reports indicate problems with Microsoft 365 since 10:02 AM EST. How is it affecting you? #Microsoft365', 40),
  post(8204, DD, 'User reports indicate problems with Apple Music since 12:00 PM EST. How is it affecting you? #AppleMusic', 35),
];
const DD_TITLES = [
  'User reports indicate problems with Uber since 3:24 PM EST.',
  'User reports indicate problems with Roblox since 3:20 PM EST.',
  'User reports indicate problems with Microsoft 365 since 10:02 AM EST.',
  'User reports indicate problems with Apple Music since 12:00 PM EST.',
];
const ddLink = (p) => `https://x.com/DownDetector/status/${p.id}`;
const MERGE = { now: NOW, boilerplate: cfg.x.boilerplate };

// One run the way update.mjs does it: the posts become items, the gate keeps some, and the kept are merged into what
// the day file held. The stored stories are checked again first, as the run does.
function runOf(posts, storedStories = []) {
  const gk = createGatekeeper(cfg);
  const kept = x.postsToItems(posts, HANDLES, cfg.x).map((item) => gk.admit(item, NOW).keep).filter(Boolean);
  const storedKept = storedStories.map((s) => gk.recheck(s).keep).filter(Boolean);
  return { kept, merged: cluster.mergeStories(storedKept, kept, MERGE) };
}

test('four Downdetector posts about four services, in one run, come out as four stories, each with its own link', () => {
  const { kept, merged } = runOf(DD_FOUR);
  assert.equal(kept.length, 4, 'all four pass the filters');
  assert.equal(merged.length, 4, merged.map((s) => s.title).join(' | '));
  assert.deepEqual(merged.map((s) => s.url).sort(), DD_FOUR.map(ddLink).sort());
  assert.deepEqual(merged.map((s) => s.title).sort(), [...DD_TITLES].sort(), 'each headline is shown whole, with its time');
  for (const s of merged) {
    assert.equal(s.kind, 'x');
    assert.equal(s.cat, 'internet');
    assert.equal(s.outlets, 1);
    assert.deepEqual(s.outletNames, ['@DownDetector on X']);
  }
  assert.equal(new Set(merged.map((s) => s.id)).size, 4, 'four ids');
});

test('a stored Downdetector story about Uber does not take in a new post about Roblox, and two stored ones stay two', () => {
  const [uber, roblox, microsoft, apple] = DD_FOUR;
  const first = runOf([uber]);
  assert.equal(first.merged.length, 1);
  const [storedUber] = first.merged;

  const second = runOf([roblox], first.merged);
  assert.equal(second.merged.length, 2, second.merged.map((s) => s.title).join(' | '));
  const uberAfter = second.merged.find((s) => s.url === ddLink(uber));
  assert.ok(uberAfter, 'the Uber story is still there, with its own link');
  assert.equal(uberAfter.id, storedUber.id, 'and its id');
  assert.equal(uberAfter.title, DD_TITLES[0]);
  assert.equal(uberAfter.outlets, 1);
  assert.ok(second.merged.some((s) => s.url === ddLink(roblox) && s.title === DD_TITLES[1]), 'Roblox is its own story');

  // Stored side by side, none of them takes in another, whatever else arrives.
  const third = runOf([microsoft], second.merged);
  const fourth = runOf([apple], third.merged);
  assert.equal(fourth.merged.length, 4);
  const again = runOf([], fourth.merged);
  assert.deepEqual(again.merged.map((s) => s.id).sort(), fourth.merged.map((s) => s.id).sort(), 'a run with nothing new keeps all four');
});

test('the cut is for the word check only: the same post text twice is still one story, and the headline shown is whole', () => {
  const twice = runOf([post(8301, DD, DD_FOUR[0].text, 20), post(8302, DD, DD_FOUR[0].text, 10)]);
  assert.equal(twice.merged.length, 1, 'the title key does not change');
  assert.equal(twice.merged[0].title, DD_TITLES[0]);
  assert.equal(twice.merged[0].url, 'https://x.com/DownDetector/status/8301', 'the older post is the story link');
});

test('two outlets\' near-verbatim rewrites of one news headline still merge with the boilerplate list on', () => {
  const rewrites = [
    newsItem({ title: 'FAA outage traced to aging copper-wire switch as expert warns air traffic system needs overhaul', source: 'WSB', url: 'https://a.com/1' }),
    newsItem({ title: 'FAA outage traced to aging copper-wire switch, expert warns air traffic system needs overhaul', source: 'KSL', url: 'https://b.com/2' }),
    newsItem({ title: 'Bank of America online banking outage leaves customers locked out', source: 'CNN', url: 'https://c.com/3' }),
  ];
  const out = cluster.mergeStories([], rewrites, MERGE);
  assert.equal(out.length, 2);
  assert.equal(out.find((s) => /FAA/.test(s.title)).outlets, 2);
});

test('the Downdetector wording is cut down to the service, in each form it comes in, and nothing else is cut', () => {
  const cut = cluster.compileBoilerplate(cfg.x.boilerplate);
  const left = (title) => cut(title).replace(/\s+/g, ' ').trim();
  for (const [title, service] of [
    ['User reports indicate problems with Uber since 3:24 PM EST.', 'Uber'],
    ['User reports indicate problems at Apple since 12:20 PM EST.', 'Apple'],
    ['User reports indicate issues with Microsoft 365 since 10:02 AM EST.', 'Microsoft 365'],
    ['User reports indicate issues at Apple Music since 12:00 PM EDT.', 'Apple Music'],
    ['User reports indicate possible problems at Verizon Wireless since 3:15 PM EST.', 'Verizon Wireless'],
    ['User reports indicate Instagram is having problems since 9:02 AM EST.', 'Instagram'],
    ['user reports indicate problems with uber since 3:24 pm est.', 'uber'],
    ['USER REPORTS INDICATE PROBLEMS WITH UBER SINCE 3:24 PM EST.', 'UBER'],
    ['User reports indicate problems with Uber since 3:24 PM EST', 'Uber'],
  ]) {
    assert.equal(left(title), service, title);
  }
  for (const zone of ['EST', 'EDT', 'CST', 'CDT', 'MST', 'MDT', 'PST', 'PDT', 'GMT', 'BST', 'UTC']) {
    for (const time of ['12:00 AM', '1:05 AM', '9:02 AM', '12:20 PM', '3:24 PM', '11:59 PM']) {
      assert.equal(left(`User reports indicate problems with Uber since ${time} ${zone}.`), 'Uber', `${time} ${zone}`);
    }
  }
  for (const title of [
    'Verizon outage hits customers across the US',
    'Uber is having problems with payments in several cities',
    'Roblox down for thousands since the update, users report',
    'Users report problems with Uber since the app update',
    'Outage began at 3:24 PM EST and lasted two hours',
    'Power restored to 40,000 customers after outage',
  ]) {
    assert.equal(cut(title), title, 'a headline that is not that sentence is left whole');
  }
});

test('the boilerplate list is plain regular expressions, and none of them changes a headline in today\'s live day file', () => {
  assert.ok(Array.isArray(cfg.x.boilerplate) && cfg.x.boilerplate.length >= 1);
  for (const re of cfg.x.boilerplate) assert.ok(re instanceof RegExp, String(re));
  const cut = cluster.compileBoilerplate(cfg.x.boilerplate);
  const day = fixtureJson('day-2026-11-17-live.json');
  for (const s of day.stories) assert.equal(cut(s.title), s.title, s.title);
});

test('today\'s live day file (11/17) goes through the merge with the boilerplate list on: no story is lost, joined or renamed', () => {
  const day = fixtureJson('day-2026-11-17-live.json');
  assert.ok(day.stories.length >= 100, `${day.stories.length} stories`);
  const out = cluster.mergeStories(day.stories, [], { now: Date.parse('2026-11-17T21:52:00Z'), boilerplate: cfg.x.boilerplate });
  assert.equal(out.length, day.stories.length);
  const byId = new Map(out.map((s) => [s.id, s]));
  for (const s of day.stories) {
    const same = byId.get(s.id);
    assert.ok(same, `${s.title} is still a story`);
    assert.equal(same.title, s.title);
    assert.equal(same.outlets, s.outlets, s.title);
  }
});

// ---- Phase 17d: a story keeps its X post's link --------------------------------------------------------------------
// On 11/17 at 5:11 PM ET the editor put Breaking911's Equinor post in a row with three news stories. A row is one link,
// so the post was hidden, and a post that joins a news story left only "@AP on X" in its outlet names: its link was
// lost. A story that is not itself a post but holds one keeps the post's link as xUrl.

const CLOUDFLARE = 'Cloudflare outage knocks thousands of sites offline';
const AP_POST = 'https://x.com/AP/status/7001';
const apPost = (over = {}) => ({ via: 'x', kind: 'x', cat: 'internet', title: CLOUDFLARE, url: AP_POST, source: '@AP on X', publishedAt: NOW - 20 * MIN, ...over });
const wire = (over = {}) => newsItem({ cat: 'internet', title: CLOUDFLARE, url: 'https://reuters.example/cloudflare', source: 'Reuters', publishedAt: NOW - 30 * MIN, ...over });
const bnoPost = (over = {}) => apPost({ url: 'https://x.com/BNONews/status/6001', source: '@BNONews on X', ...over });
const mergeOne = (stored, fresh) => {
  const out = cluster.mergeStories(stored, fresh, MERGE);
  assert.equal(out.length, 1, out.map((s) => s.title).join(' | '));
  return out[0];
};

test('a news story that takes in an X post keeps the post\'s link as xUrl, and nothing else about the merge changes', () => {
  const joined = mergeOne([], [wire(), apPost()]);
  const alone = mergeOne([], [wire()]);
  assert.equal(joined.xUrl, AP_POST);
  assert.equal(joined.kind, 'news');
  assert.equal(joined.url, 'https://reuters.example/cloudflare', 'the story still opens the news link');
  assert.equal(joined.url, alone.url);
  assert.equal(joined.title, alone.title);
  assert.equal(joined.id, alone.id);
  assert.equal(joined.source, 'Reuters');
  assert.equal(joined.outlets, 2);
  assert.deepEqual(joined.outletNames, ['Reuters', '@AP on X']);
  assert.deepEqual(Object.keys(joined).filter((k) => k !== 'xUrl'), Object.keys(alone), 'one more key and no other');
});

test('the post\'s own story, a story whose own link is the post, and a story with no post have no xUrl key at all', () => {
  assert.equal(mergeOne([], [wire(), apPost()]).xUrl, AP_POST, 'the story that takes a post in has the link, so the none below are not just a missing feature');
  const own = mergeOne([], [apPost()]);
  assert.equal(own.kind, 'x');
  assert.equal(own.url, AP_POST);
  assert.ok(!('xUrl' in own), 'a post is not given its own link twice');
  const none = mergeOne([], [wire()]);
  assert.ok(!('xUrl' in none), 'no post, no key');
  // The post is the older one, so it is the story's own link and there is nothing to add.
  const early = mergeOne([], [apPost({ publishedAt: NOW - 40 * MIN }), wire()]);
  assert.equal(early.url, AP_POST);
  assert.ok(!('xUrl' in early));
  assert.equal(early.outlets, 2);
  // Four unrelated stories and a signal: none has the key.
  const many = cluster.mergeStories([], [wire(), wire({ title: 'Major AWS outage disrupts popular apps', url: 'https://wsj.example/aws' }), apPost({ title: 'Uber is down for thousands of users', url: 'https://x.com/DownDetector/status/8001', source: '@DownDetector on X' })], MERGE);
  assert.equal(many.length, 3);
  assert.deepEqual(many.filter((s) => 'xUrl' in s).map((s) => s.title), [], 'a post that stands alone is its own story, and no one else holds it');
});

test('the link stays across runs: a stored story keeps the one it has, and nothing a later run finds takes it away or changes it', () => {
  const first = mergeOne([], [wire(), apPost()]);
  assert.equal(first.xUrl, AP_POST);
  // a run that finds nothing, a run that finds the same two again, and a run after that
  const second = mergeOne([first], []);
  assert.deepEqual(second, first, 'a run with nothing new leaves the story as it was');
  const third = mergeOne([second], [wire(), apPost()]);
  assert.equal(third.xUrl, AP_POST);
  assert.equal(third.id, first.id);
  assert.equal(third.url, first.url);
  assert.equal(third.outlets, 2);
  assert.deepEqual(mergeOne([third], []), first);
  // a post from an earlier moment that arrives later does not replace the link the story has
  const later = mergeOne([first], [bnoPost({ publishedAt: NOW - 90 * MIN })]);
  assert.equal(later.xUrl, AP_POST, 'a stored story keeps the one it has');
  assert.deepEqual(later.outletNames, ['Reuters', '@AP on X', '@BNONews on X']);
  assert.equal(later.url, first.url);
  // two stored stories that come together keep the link of the one first seen
  const older = { ...first, id: 'older', firstSeenAt: new Date(NOW - 5 * 3600000).toISOString(), xUrl: 'https://x.com/Reuters/status/1' };
  const newer = { ...first, id: 'newer', firstSeenAt: new Date(NOW - 3 * 3600000).toISOString(), xUrl: 'https://x.com/cnnbrk/status/2' };
  assert.equal(mergeOne([newer, older], []).xUrl, 'https://x.com/Reuters/status/1');
  assert.equal(mergeOne([older, newer], []).xUrl, 'https://x.com/Reuters/status/1');
});

test('a news story stored before the link was kept gets it from the next post it takes in', () => {
  const [story] = cluster.mergeStories([], [wire()], MERGE);
  const old = { ...story, outlets: 2, outletNames: ['Reuters', '@AP on X'] };
  assert.ok(!('xUrl' in old));
  assert.ok(!('xUrl' in mergeOne([old], [])), 'with no post to read it from, there is none');
  assert.equal(mergeOne([old], [apPost()]).xUrl, AP_POST);
});

test('of several posts in one story the earliest is its link, in whatever order they arrive, and the same moment goes by the link', () => {
  const a = apPost({ publishedAt: NOW - 20 * MIN });
  const b = bnoPost({ publishedAt: NOW - 25 * MIN });
  const c = bnoPost({ url: 'https://x.com/Reuters/status/6002', source: '@Reuters on X', publishedAt: NOW - 25 * MIN });
  for (const order of [[wire(), a, b, c], [c, b, a, wire()], [a, wire(), c, b], [b, c, wire(), a]]) {
    const story = mergeOne([], order);
    assert.equal(story.xUrl, b.url, 'the earliest post; two from the same moment go by their links');
    assert.equal(story.url, 'https://reuters.example/cloudflare');
  }
  // A post with no time of its own comes after one that has a time.
  const untimed = apPost({ url: 'https://x.com/cnnbrk/status/1', source: '@cnnbrk on X', publishedAt: null });
  assert.equal(mergeOne([], [wire(), untimed, a]).xUrl, a.url);
});

test('a bad xUrl in a stored file is dropped, a good one is read back, and a new post still gives the story its link', () => {
  const good = mergeOne([], [wire(), apPost()]);
  for (const bad of [
    'javascript:alert(1)',
    'http://x.com/AP/status/7001',
    'https://example.com/AP/status/7001',
    'https://x.com.evil.example/AP/status/7001',
    'https://user:pass@x.com/AP/status/7001',
    'https://x.com/AP',
    'https://x.com/i/status/7001',
    '',
    null,
    42,
    {},
    ['https://x.com/AP/status/7001'],
  ]) {
    const kept = mergeOne([{ ...good, xUrl: bad }], []);
    assert.ok(!('xUrl' in kept), `${JSON.stringify(bad)} is dropped`);
    assert.equal(mergeOne([{ ...good, xUrl: bad }], [apPost()]).xUrl, AP_POST, `${JSON.stringify(bad)} does not stop the post from giving the link`);
  }
  assert.equal(mergeOne([{ ...good, xUrl: ' https://twitter.com/AP/status/7001 ' }], []).xUrl, 'https://twitter.com/AP/status/7001', 'a good one is read back, cleaned the way safeUrl cleans it');
  // A story whose own link is a post has none, even when a file says it has.
  const own = mergeOne([], [apPost()]);
  assert.ok(!('xUrl' in mergeOne([{ ...own, xUrl: 'https://x.com/BNONews/status/6001' }], [])));
  // A signal has none either, whatever a file says.
  const signal = { id: 'sig:asteroid:1', kind: 'signal', cat: 'space', title: 'Asteroid 2026 WA passes at 0.33 lunar distances', url: 'https://ssd.jpl.nasa.gov/x', source: 'NASA/JPL', publishedAt: new Date(NOW).toISOString(), firstSeenAt: new Date(NOW).toISOString(), score: 4, xUrl: AP_POST };
  assert.ok(!cluster.mergeStories([signal], [], MERGE).some((s) => 'xUrl' in s));
});
