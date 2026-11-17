// Google Trends: the feed, what becomes of its headlines, and the trending number that stays with a story.
// Everything runs offline against the sample feed in fixtures/trends.xml (the real answer of 11/17, 1:51 PM ET).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { config } from '../scripts/config.mjs';
import { createHttp } from '../scripts/lib/http.mjs';
import { createGatekeeper } from '../scripts/lib/pipeline.mjs';
import { runUpdate, SOURCES } from '../scripts/update.mjs';
import * as trends from '../scripts/sources/trends.mjs';
import { fakeSource, fixture, mockFetch, newsItem, noSleep, readJson, tmpRoot } from './helpers.mjs';

const cfg = config();
const NOW = new Date('2026-11-17T19:00:00Z'); // 2:00 PM ET
const ctxFor = (fetchImpl, over = {}) => ({
  http: createHttp({ fetchImpl, sleep: noSleep }),
  now: NOW,
  config: cfg,
  env: {},
  xState: null,
  prev: {},
  ...over,
});
const serving = (body, status = 200) => mockFetch([['trends.google.com', () => ({ status, body })]]);

// A trend as the feed writes it, and a feed of trends.
const trendXml = ({ title, traffic = '1000+', at = 'Tue, 17 Nov 2026 09:20:00 -0800', stories = [] }) =>
  `<item><title>${title}</title><ht:approx_traffic>${traffic}</ht:approx_traffic><description/><link>https://trends.google.com/trending/rss?geo=US</link><pubDate>${at}</pubDate>` +
  stories
    .map(([t, u, s]) => `<ht:news_item><ht:news_item_title>${t}</ht:news_item_title><ht:news_item_snippet/><ht:news_item_url>${u}</ht:news_item_url><ht:news_item_source>${s}</ht:news_item_source></ht:news_item>`)
    .join('') +
  '</item>';
const feedXml = (...items) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><rss xmlns:atom="http://www.w3.org/2005/Atom" xmlns:ht="https://trends.google.com/trending/rss" version="2.0"><channel><title>Daily Search Trends</title><description>Recent searches</description><link>https://trends.google.com/trending/rss?geo=US</link>${items.join('')}</channel></rss>`;

const SEARCHES = ['pennsylvania lottery', 'rj godfrey', 'when we were young 2027', 'gpt 6.2', 'playstation plus games', 'flight 5342', 'yemen', 'earthshot prize', 'banana ball', 'apple outage'];
const APPLE = ['Is Apple down? Thousands report problems accessing services', "Can't sign in to your iCloud? Users report problems with several Apple services", 'Apple Accounts, App Store and Apple Music Experiencing Issues'];

// ---- the sample feed ----------------------------------------------------------------------------------------

test('trends: the sample feed gives one headline per news story, and the Apple trend gives three with trending 50000', () => {
  const { items, error } = trends.parseTrends(fixture('trends.xml'));
  assert.equal(error, null);
  assert.equal(items.length, 29, '10 trends, 29 news stories');
  const apple = items.filter((i) => i.trending === 50000);
  assert.deepEqual(apple.map((i) => i.title), APPLE);
  assert.deepEqual(apple.map((i) => i.source), ['USA Today', 'kare11.com', 'MacRumors']);
  assert.equal(apple[0].url, 'https://www.usatoday.com/story/tech/2026/11/17/apple-services-outage/92827849007/');
  for (const i of apple) assert.equal(i.publishedAt, Date.parse('2026-11-17T17:20:00Z'), 'dated when the trend started: 9:20 AM at -0800');
  // Every headline: its own title, link and publisher, no category, a plain news headline, and the trend's number.
  for (const i of items) {
    assert.equal(i.via, 'trends');
    assert.equal(i.kind, 'news');
    assert.equal(i.cat, null, 'the keyword gate decides the category');
    assert.ok(i.title && i.source && /^https:\/\//.test(i.url));
    assert.ok(Number.isFinite(i.publishedAt));
    assert.ok(Number.isInteger(i.trending) && i.trending > 0);
  }
  assert.deepEqual([...new Set(items.map((i) => i.trending))].sort((a, b) => a - b), [200, 500, 1000, 2000, 50000]);
  // The search itself is never a headline.
  const titles = new Set(items.map((i) => i.title.toLowerCase()));
  for (const search of SEARCHES) assert.ok(!titles.has(search), `"${search}" is a search, not a headline`);
});

test('trends: entities are decoded once, and a title is not otherwise touched', () => {
  const { items } = trends.parseTrends(fixture('trends.xml'));
  assert.ok(items.some((i) => i.title === "Arizona's RJ Godfrey reportedly eligible to play vs. UConn after judge grants injunction"), '&apos; is an apostrophe');
  assert.equal(items.find((i) => i.source === 'kare11.com').title, "Can't sign in to your iCloud? Users report problems with several Apple services");
  assert.ok(items.every((i) => !/&(?:apos|amp|quot|#\d+);/.test(i.title)));
  const odd = trends.parseTrends(
    feedXml(trendXml({ title: 'x', stories: [['It&#39;s &quot;fine&quot; &amp; done', 'https://a.example/x?a=1&amp;b=2', 'A &amp; B'], ['Already &amp;amp; escaped', 'https://a.example/y', 'C']] })),
  );
  assert.deepEqual(odd.items.map((i) => i.title), ['It\'s "fine" & done', 'Already &amp; escaped'], 'one pass: a double-encoded entity is left as the feed wrote it');
  assert.equal(odd.items[0].url, 'https://a.example/x?a=1&b=2');
  assert.equal(odd.items[0].source, 'A & B');
});

test('trends: a trend with no news stories gives no headline, a trend with one gives one, and a bad link or a blank title is skipped', () => {
  const xml = feedXml(
    trendXml({ title: 'nothing to read', traffic: '5000+', stories: [] }),
    trendXml({ title: 'one story', traffic: '2000+', stories: [['Cloudflare outage knocks thousands of sites offline', 'https://example.com/a', 'Example']] }),
    trendXml({
      title: 'two bad ones',
      traffic: '2000+',
      stories: [
        ['A story with a script link', 'javascript:alert(1)', 'Example'],
        ['   ', 'https://example.com/b', 'Example'],
        ['A story with no publisher', 'https://example.com/c', ''],
      ],
    }),
  );
  const { items, error } = trends.parseTrends(xml);
  assert.equal(error, null);
  assert.deepEqual(items.map((i) => i.title), ['Cloudflare outage knocks thousands of sites offline', 'A story with no publisher']);
  assert.equal(items[1].source, 'unknown');
  assert.equal(trends.parseTrends(feedXml()).items.length, 0, 'a feed with no trends is a feed with no headlines');
  assert.equal(trends.parseTrends(feedXml()).error, null, 'and not an error');
});

test('trends: the number of searches reads "50000+", "1,000+", "200K+" and "1M+", and a count it cannot read is no number at all', () => {
  assert.equal(trends.searchCount('50000+'), 50000);
  assert.equal(trends.searchCount('500+'), 500);
  assert.equal(trends.searchCount(' 2000+ '), 2000);
  assert.equal(trends.searchCount('1,000+'), 1000);
  assert.equal(trends.searchCount('200K+'), 200000);
  assert.equal(trends.searchCount('1.5M+'), 1500000);
  for (const bad of ['', 'lots', '0+', '-5+', null, undefined]) assert.equal(trends.searchCount(bad), null, String(bad));
  const none = trends.parseTrends(feedXml(trendXml({ title: 'x', traffic: 'lots', stories: [['Cloudflare outage knocks thousands of sites offline', 'https://example.com/a', 'Example']] })));
  assert.equal(none.items.length, 1);
  assert.ok(!('trending' in none.items[0]), 'no number, no key');
});

test('trends: a broken feed gives zero items and no throw', async () => {
  const broken = ['<html><body>Our systems have detected unusual traffic from your computer network.</body></html>', '', 'not xml at all', '<rss><channel>', '<rss version="2.0"></rss>', '<<<>>>'];
  for (const body of broken) {
    let r;
    assert.doesNotThrow(() => {
      r = trends.parseTrends(body);
    }, JSON.stringify(body));
    assert.deepEqual(r.items, [], JSON.stringify(body));
    assert.equal(typeof r.error, 'string', `${JSON.stringify(body)} says what is wrong`);
  }
  assert.deepEqual(trends.parseTrends(null).items, []);
  assert.deepEqual(trends.parseTrends(undefined).items, []);
  // and through the source: a failed source with the reason, no items
  const r = await trends.run(ctxFor(serving(broken[0]).fetch));
  assert.equal(r.ok, false);
  assert.equal(r.count, 0);
  assert.deepEqual(r.items, []);
  assert.match(r.error, /not an RSS|no channel|not XML/);
});

// ---- the source ---------------------------------------------------------------------------------------------

test('trends: one read of the US feed per run, with the same helper and user agent as the other sources', async () => {
  const m = serving(fixture('trends.xml'));
  const r = await trends.run(ctxFor(m.fetch));
  assert.equal(m.calls.length, 1, 'once');
  assert.equal(m.calls[0].url, 'https://trends.google.com/trending/rss?geo=US');
  assert.equal(trends.FEED_URL, 'https://trends.google.com/trending/rss?geo=US');
  assert.equal(m.calls[0].headers['user-agent'], 'didtheworldendtoday.com (news aggregator)');
  assert.match(m.calls[0].headers.accept, /xml/);
  assert.ok(!m.calls[0].headers.authorization, 'no key');
  assert.equal(r.id, 'trends');
  assert.equal(r.ok, true);
  assert.equal(r.error, null);
  assert.equal(r.count, 29);
  assert.equal(r.items.length, 29);
  assert.ok(SOURCES.some((s) => s.id === 'trends' && s === trends), 'a run reads it');
  assert.equal(new Set(SOURCES.map((s) => s.id)).size, SOURCES.length, 'every source has its own id');
});

test('trends: a block, a server error, a timeout, a dead network and a block page that says 200 are each a failed source with no items and no throw', async () => {
  const timeout = () => {
    throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  };
  const cases = [
    ['429', mockFetch([['trends.google.com', () => ({ status: 429, body: 'Too many requests' })]]), /429/, 1],
    ['403', mockFetch([['trends.google.com', () => ({ status: 403, body: '<html>Forbidden</html>' })]]), /403/, 1],
    ['500', mockFetch([['trends.google.com', () => ({ status: 500, body: 'oops' })]]), /500/, 2],
    ['timeout', mockFetch([['trends.google.com', timeout]]), /timeout/, 2],
    ['dead network', mockFetch([['trends.google.com', () => { throw new TypeError('fetch failed'); }]]), /network error/, 2],
    ['block page', mockFetch([['trends.google.com', () => ({ status: 200, body: '<html><body>unusual traffic</body></html>' })]]), /not an RSS|no channel|not XML/, 1],
    ['empty answer', mockFetch([['trends.google.com', () => ({ status: 200, body: '' })]]), /not an RSS|no channel|not XML/, 1],
  ];
  for (const [name, m, error, calls] of cases) {
    const r = await trends.run(ctxFor(m.fetch));
    assert.equal(r.ok, false, name);
    assert.equal(r.count, 0, name);
    assert.deepEqual(r.items, [], name);
    assert.match(r.error, error, name);
    assert.equal(m.calls.length, calls, `${name}: one try, and one more only for a server error, a timeout or a dead network`);
  }
});

// ---- what becomes of the headlines ---------------------------------------------------------------------------

test('trends: a lottery or a game never becomes a story: the keyword gate and the exclusion filter drop them like any headline', () => {
  const gk = createGatekeeper(cfg);
  const { items } = trends.parseTrends(fixture('trends.xml'));
  const nowMs = NOW.getTime();
  const by = (re) => items.filter((i) => re.test(i.title));
  const lottery = by(/lottery/i);
  const games = by(/playstation|ps plus|banana ball/i);
  assert.equal(lottery.length, 3);
  assert.equal(games.length, 5);
  for (const item of [...lottery, ...games]) {
    const verdict = gk.admit(item, nowMs);
    assert.ok(verdict.drop, `kept: ${item.title}`);
    assert.equal(verdict.drop, 'off-topic', item.title);
  }
  // sports, celebrity and politics headlines drop out the same way
  for (const item of [...by(/RJ Godfrey|basketball/), ...by(/Kate Middleton|Catherine/), ...by(/Duffy|Cruz/)]) assert.ok(gk.admit(item, nowMs).drop, item.title);
  // the gate is the only thing that decides: an item of the same shape that names an outage is kept, with its number
  const real = trends.parseTrends(
    feedXml(trendXml({ title: 'apple outage', traffic: '50000+', stories: [['Apple outage knocks iCloud and the App Store offline for thousands', 'https://example.com/apple', 'USA Today']] })),
  ).items[0];
  const kept = gk.admit(real, nowMs).keep;
  assert.equal(kept.cat, 'internet');
  assert.equal(kept.trending, 50000, 'the gate passes the number on');
});

// ---- through a whole run -----------------------------------------------------------------------------------

const APPLE_AT = 'Tue, 17 Nov 2026 09:20:00 -0800'; // 17:20 UTC
const trendFeed = (traffic = '50000+') =>
  feedXml(
    trendXml({
      title: 'apple outage',
      traffic,
      at: APPLE_AT,
      stories: [
        ['Apple outage knocks iCloud and the App Store offline for thousands', 'https://news.example/apple-1', 'USA Today'],
        ['Apple outage: iCloud, Apple Music and App Store users report problems', 'https://news.example/apple-2', 'MacRumors'],
      ],
    }),
    trendXml({ title: 'pennsylvania lottery', traffic: '500+', at: APPLE_AT, stories: [['Winning Pa. Lottery numbers for Nov. 16, 2026', 'https://news.example/lottery', 'PennLive.com']] }),
    trendXml({ title: 'playstation plus games', traffic: '1000+', at: APPLE_AT, stories: [['PlayStation Plus issues December free game update, last chance to play 100-hour RPG', 'https://news.example/game', 'GAMINGbible']] }),
  );

// One run of the real trends source, with whatever feed `body.now` holds, next to a Google source.
function world() {
  const body = { now: trendFeed(), status: 200 };
  const m = mockFetch([['trends.google.com', () => ({ status: body.status, body: body.now })]]);
  const http = createHttp({ fetchImpl: m.fetch, sleep: noSleep });
  const plain = newsItem({ cat: 'internet', title: 'Cloudflare outage knocks thousands of sites offline', url: 'https://pub.example/cf', source: 'Pub A', publishedAt: Date.parse('2026-11-17T18:00:00Z') });
  const google = fakeSource('google', { count: 1, items: [plain] });
  const root = tmpRoot();
  const go = (now) => runUpdate({ root, now, env: {}, http, sources: [google, trends], config: cfg });
  const day = () => readJson(path.join(root, 'data', 'days', '2026-11-17.json'));
  return { body, go, day, root };
}

test('trends: through a run, an outage trend becomes stories that carry the number and the time it began, and the lottery and the game become nothing', async () => {
  const w = world();
  const { latest, report } = await w.go('2026-11-17T19:00:00Z');
  const titles = latest.stories.map((s) => s.title).sort();
  assert.deepEqual(titles, [
    'Apple outage knocks iCloud and the App Store offline for thousands',
    'Apple outage: iCloud, Apple Music and App Store users report problems',
    'Cloudflare outage knocks thousands of sites offline',
  ]);
  const apple = latest.stories.filter((s) => /^Apple outage/.test(s.title));
  for (const s of apple) {
    assert.equal(s.trending, 50000);
    assert.equal(s.publishedAt, '2026-11-17T17:20:00.000Z');
    assert.equal(s.latestAt, '2026-11-17T17:20:00.000Z');
    assert.equal(s.cat, 'internet');
  }
  const plain = latest.stories.find((s) => /^Cloudflare/.test(s.title));
  assert.ok(!('trending' in plain), 'a story that never trended has no trending key');
  assert.equal(plain.latestAt, '2026-11-17T18:00:00.000Z');
  const gone = report.droppedList.filter((d) => d.via === 'trends');
  assert.deepEqual(gone.map((d) => `${d.reason}: ${d.title}`).sort(), [
    'off-topic: PlayStation Plus issues December free game update, last chance to play 100-hour RPG',
    'off-topic: Winning Pa. Lottery numbers for Nov. 16, 2026',
  ]);
  assert.equal(latest.sources.trends.ok, true);
  assert.equal(w.day().stories.length, 3, 'and today\'s file has the same');
});

test('trends: a story keeps the biggest number it ever had after the trend leaves the feed, and a trend that cools off does not take it back', async () => {
  const w = world();
  const first = await w.go('2026-11-17T19:00:00Z');
  assert.deepEqual(first.latest.stories.filter((s) => 'trending' in s).map((s) => s.trending), [50000, 50000]);

  // the trend is gone: an empty feed
  w.body.now = feedXml();
  const second = await w.go('2026-11-17T20:00:00Z');
  const after = second.latest.stories.filter((s) => /^Apple outage/.test(s.title));
  assert.equal(after.length, 2, 'the stories live on');
  for (const s of after) {
    assert.equal(s.trending, 50000, 'a trend that cooled off the feed does not erase it');
    assert.equal(s.latestAt, '2026-11-17T17:20:00.000Z', 'nor the time of its newest headline');
  }
  assert.ok(second.latest.stories.every((s) => !/Cloudflare/.test(s.title) || !('trending' in s)));
  assert.deepEqual(w.day().stories.filter((s) => /^Apple outage/.test(s.title)).map((s) => s.trending), [50000, 50000], 'and it is in today\'s file');

  // the source fails: the same
  w.body.status = 500;
  const third = await w.go('2026-11-17T21:00:00Z');
  assert.equal(third.latest.sources.trends.ok, false);
  assert.deepEqual(third.latest.stories.filter((s) => /^Apple outage/.test(s.title)).map((s) => s.trending), [50000, 50000]);
  w.body.status = 200;

  // it comes back smaller: the highest of any member stays
  w.body.now = trendFeed('2000+');
  const fourth = await w.go('2026-11-17T22:00:00Z');
  assert.deepEqual(fourth.latest.stories.filter((s) => /^Apple outage/.test(s.title)).map((s) => s.trending), [50000, 50000]);

  // and bigger: the new highest
  w.body.now = trendFeed('200K+');
  const fifth = await w.go('2026-11-17T23:00:00Z');
  assert.deepEqual(fifth.latest.stories.filter((s) => /^Apple outage/.test(s.title)).map((s) => s.trending), [200000, 200000]);
  assert.ok(!('trending' in fifth.latest.stories.find((s) => /^Cloudflare/.test(s.title))));
});

test('trends: a run where the source only fails reads nothing from it, and the run goes on', async () => {
  const w = world();
  w.body.status = 429;
  const { latest, report } = await w.go('2026-11-17T19:00:00Z');
  assert.equal(latest.sources.trends.ok, false);
  assert.match(latest.sources.trends.error, /429/);
  assert.deepEqual(latest.stories.map((s) => s.title), ['Cloudflare outage knocks thousands of sites offline']);
  assert.equal(report.results.find((r) => r.id === 'trends').count, 0);
});

// ---- a headline that fits no category is filed by its search --------------------------------------------------

const WOBBLE = 'Apple fans left waiting as services wobble'; // no outage word: nothing in it fits a category
const trendItem = (over = {}) => ({ via: 'trends', kind: 'news', cat: null, title: WOBBLE, url: 'https://news.example/wobble', source: 'USA Today', publishedAt: NOW.getTime() - 3600e3, trending: 50000, trendTerm: 'apple outage', ...over });

test('trends: every headline carries the search it came from, and the search is still never a headline', () => {
  const { items } = trends.parseTrends(fixture('trends.xml'));
  assert.ok(items.every((i) => typeof i.trendTerm === 'string' && i.trendTerm));
  assert.deepEqual([...new Set(items.map((i) => i.trendTerm))].sort(), [...SEARCHES].sort());
  assert.deepEqual(items.filter((i) => i.trendTerm === 'apple outage').map((i) => i.title), APPLE);
  assert.ok(items.every((i) => i.title !== i.trendTerm));
  const blank = trends.parseTrends(feedXml(trendXml({ title: '  ', stories: [['Cloudflare outage knocks thousands of sites offline', 'https://example.com/a', 'Example']] }))).items;
  assert.equal(blank.length, 1);
  assert.ok(!('trendTerm' in blank[0]), 'a trend with no search text gives no key');
});

test('trends: a headline the gate files nothing for is filed by its search, and the headline is still judged as itself', () => {
  const gk = createGatekeeper(cfg);
  const nowMs = NOW.getTime();
  // the search files it: "apple outage" is internet
  const filed = gk.admit(trendItem(), nowMs);
  assert.equal(filed.drop, undefined);
  assert.equal(filed.keep.cat, 'internet');
  assert.equal(filed.keep.title, WOBBLE, 'the headline is never rewritten');
  assert.equal(filed.keep.trending, 50000);
  assert.equal(filed.keep.trendTerm, 'apple outage', 'the search stays with it, so a stored story is filed the same way');
  // no search, or a search that files nothing: as before
  const bare = trendItem();
  delete bare.trendTerm;
  assert.equal(gk.admit(bare, nowMs).drop, 'off-topic');
  assert.equal(gk.admit(trendItem({ trendTerm: 'pennsylvania lottery' }), nowMs).drop, 'off-topic');
  for (const bad of ['', '   ', 5, null, {}]) assert.equal(gk.admit(trendItem({ trendTerm: bad }), nowMs).drop, 'off-topic', String(bad));
  // a headline that fits on its own keeps its own category, and keeps the search too
  const own = gk.admit(trendItem({ title: 'Apple outage knocks iCloud offline for thousands' }), nowMs).keep;
  assert.equal(own.cat, 'internet');
  assert.equal(own.trendTerm, 'apple outage', 'the search stays with every trend story, not only one it filed');
  const gridTitle = gk.admit(trendItem({ title: 'Rolling blackouts hit regional grid as demand spikes' }), nowMs).keep;
  assert.equal(gridTitle.cat, 'grid', 'the headline decides first; the search is only for a headline that fits nothing');
  assert.equal(gridTitle.trendTerm, 'apple outage', 'and it is kept although it filed nothing');
  // the exclusion filter and the quality checks still judge the headline itself
  assert.equal(gk.admit(trendItem({ title: "Can't sign in to your iCloud? Users report problems with several Apple services" }), nowMs).drop, 'excluded:question');
  assert.equal(gk.admit(trendItem({ title: `Trump says ${WOBBLE.toLowerCase()}` }), nowMs).drop, 'excluded:politics');
  assert.equal(gk.admit(trendItem({ source: 'PR Newswire' }), nowMs).drop, 'excluded:press release');
  assert.equal(gk.admit(trendItem({ title: `${WOBBLE} and then something happens and the story is cut off in the middle of a sen...` }), nowMs).drop, 'quality:truncated');
  assert.equal(gk.admit(trendItem({ title: 'Сбой в работе сервисов Apple затронул тысячи пользователей' }), nowMs).drop, 'quality:script');
  assert.equal(gk.admit(trendItem({ url: 'javascript:alert(1)' }), nowMs).drop, 'bad-link');
  assert.equal(gk.admit(trendItem({ publishedAt: nowMs - 10 * 86400e3 }), nowMs).drop, 'old');
});

test('trends: a stored story filed by its search is kept by it, one without a search is not, and the rules still judge the headline', () => {
  const gk = createGatekeeper(cfg);
  const story = { id: 'abc123', cat: 'internet', kind: 'news', title: WOBBLE, url: 'https://news.example/wobble', source: 'USA Today', publishedAt: '2026-11-17T17:20:00.000Z', latestAt: '2026-11-17T17:20:00.000Z', firstSeenAt: '2026-11-17T18:00:00.000Z', outlets: 1, outletNames: ['USA Today'], trending: 50000, score: 5 };
  assert.equal(gk.recheck({ ...story, trendTerm: 'apple outage' }).keep.cat, 'internet');
  assert.equal(gk.recheck({ ...story, trendTerm: 'apple outage' }).keep.trendTerm, 'apple outage');
  assert.equal(gk.recheck(story).drop, 'off-topic', 'with no search its headline files nothing');
  assert.equal(gk.recheck({ ...story, trendTerm: 'pennsylvania lottery' }).drop, 'off-topic', 'a search that no longer files it');
  assert.equal(gk.recheck({ ...story, trendTerm: 'apple outage', title: `Trump says ${WOBBLE.toLowerCase()}` }).drop, 'excluded:politics');
  assert.equal(gk.recheck({ ...story, trendTerm: 'apple outage', source: 'PR Newswire' }).drop, 'excluded:press release');
  // a story that fits on its own never needed the search
  assert.equal(gk.recheck({ ...story, title: 'Apple outage knocks iCloud offline for thousands' }).keep.cat, 'internet');
});

test('trends: a trend story whose own headline files it keeps its search through admit, the store and recheck', async () => {
  const gk = createGatekeeper(cfg);
  const nowMs = NOW.getTime();
  // admit: the headline files it, and the search stays with it all the same, whatever the search is
  for (const search of ['apple outage', 'icloud down', 'is apple down']) {
    const kept = gk.admit(trendItem({ title: 'Apple outage knocks iCloud offline for thousands', trendTerm: search }), nowMs).keep;
    assert.equal(kept.cat, 'internet', search);
    assert.equal(kept.trendTerm, search, 'the search is kept as it came');
  }
  // the filing itself is the same as before: the headline first, the search only for a headline that fits nothing
  assert.equal(gk.admit(trendItem({ title: 'Rolling blackouts hit regional grid as demand spikes' }), nowMs).keep.cat, 'grid');
  assert.equal(gk.admit(trendItem({ title: 'Rolling blackouts hit regional grid as demand spikes', trendTerm: 'pennsylvania lottery' }), nowMs).keep.cat, 'grid', 'a search that files nothing is kept for a headline that files');
  assert.equal(gk.admit(trendItem({ trendTerm: 'pennsylvania lottery' }), nowMs).drop, 'off-topic', 'and a headline that fits nothing still needs a search that does');
  // only a non-empty string is a search
  for (const bad of ['', 5, null, undefined, {}, ['apple outage']]) {
    const kept = gk.admit(trendItem({ title: 'Apple outage knocks iCloud offline for thousands', trendTerm: bad }), nowMs).keep;
    assert.equal(kept.cat, 'internet', String(bad));
    assert.ok(!('trendTerm' in kept), `${JSON.stringify(bad)} is no search`);
  }
  // an item that did not come from a trend has no search to keep
  const plain = gk.admit(newsItem({ cat: 'internet', title: 'Cloudflare outage knocks thousands of sites offline', url: 'https://pub.example/cf', source: 'Pub A', publishedAt: nowMs - 3600e3 }), nowMs).keep;
  assert.ok(!('trendTerm' in plain));

  // the store: a whole run keeps the search in latest.json and in today's file, for both Apple stories, and gives none to the plain one
  const w = world();
  const isApple = (x) => /^Apple outage/.test(x.title);
  const first = await w.go('2026-11-17T19:00:00Z');
  const apple = first.latest.stories.filter(isApple);
  assert.equal(apple.length, 2);
  for (const x of apple) assert.equal(x.trendTerm, 'apple outage', 'in latest.json');
  for (const x of w.day().stories.filter(isApple)) assert.equal(x.trendTerm, 'apple outage', 'and in today\'s file');
  assert.ok(!('trendTerm' in first.latest.stories.find((x) => /^Cloudflare/.test(x.title))));

  // recheck, on its own and in the next run (the trend has left the feed, and the stored stories are checked again)
  for (const x of apple) {
    const again = gk.recheck(x);
    assert.equal(again.drop, undefined);
    assert.equal(again.keep.trendTerm, 'apple outage', 'recheck keeps it');
    assert.equal(again.keep.cat, 'internet');
  }
  w.body.now = feedXml();
  const second = await w.go('2026-11-17T20:00:00Z');
  const later = second.latest.stories.filter(isApple);
  assert.equal(later.length, 2);
  for (const x of later) assert.equal(x.trendTerm, 'apple outage', 'after the trend left the feed');
  for (const x of w.day().stories.filter(isApple)) assert.equal(x.trendTerm, 'apple outage');
  assert.deepEqual(second.report.cleaned ?? {}, {}, 'nothing was cleaned out of the archive');
});

test('trends: the sample feed gives two internet stories for the Apple trend, both with 50000, and the question stays out', async () => {
  const w = world();
  w.body.now = fixture('trends.xml');
  const { latest, report } = await w.go('2026-11-17T19:00:00Z');
  const apple = latest.stories.filter((s) => s.trending === 50000);
  assert.deepEqual(apple.map((s) => s.title).sort(), [APPLE[0], APPLE[2]].sort());
  for (const s of apple) {
    assert.equal(s.cat, 'internet');
    assert.equal(s.publishedAt, '2026-11-17T17:20:00.000Z');
    assert.equal(s.trendTerm, 'apple outage', 'they fit on their own headlines, and still keep the search');
  }
  assert.deepEqual(latest.stories.filter((s) => s.trending !== 50000).map((s) => s.title), ['Cloudflare outage knocks thousands of sites offline'], 'nothing else from the sample feed becomes a story');
  const gone = report.droppedList.filter((d) => d.via === 'trends');
  assert.equal(gone.length, 27, '29 headlines, 2 kept');
  assert.equal(gone.find((d) => d.title === APPLE[1]).reason, 'excluded:question');
  assert.ok(gone.filter((d) => d.reason === 'off-topic').length >= 20);
});

test('trends: a story filed by its search is kept by it through every later run, and the trend leaving the feed does not drop it', async () => {
  const w = world();
  const wobbleFeed = feedXml(trendXml({ title: 'apple outage', traffic: '50000+', at: APPLE_AT, stories: [[WOBBLE, 'https://news.example/wobble', 'USA Today']] }));
  w.body.now = wobbleFeed;
  const first = await w.go('2026-11-17T19:00:00Z');
  const wobble = first.latest.stories.find((s) => s.title === WOBBLE);
  assert.ok(wobble, 'filed by its search');
  assert.equal(wobble.cat, 'internet');
  assert.equal(wobble.trending, 50000);
  assert.equal(wobble.trendTerm, 'apple outage');
  assert.equal(w.day().stories.find((s) => s.title === WOBBLE).trendTerm, 'apple outage', 'and the file keeps the search');
  assert.ok(!('trendTerm' in first.latest.stories.find((s) => /^Cloudflare/.test(s.title))), 'a story that did not come from a trend has no key');

  // the trend is gone from the feed
  w.body.now = feedXml();
  const second = await w.go('2026-11-17T20:00:00Z');
  const still = second.latest.stories.find((s) => s.title === WOBBLE);
  assert.ok(still, 'the story lives on');
  assert.equal(still.id, wobble.id);
  assert.equal(still.firstSeenAt, wobble.firstSeenAt, 'and is not seen again as new');
  assert.equal(still.trending, 50000);
  assert.equal(still.trendTerm, 'apple outage');
  assert.deepEqual(second.report.cleaned ?? {}, {}, 'nothing was cleaned out of the archive');

  // the source fails, and then the trend comes back with the same headline
  w.body.status = 500;
  const third = await w.go('2026-11-17T21:00:00Z');
  assert.ok(third.latest.stories.some((s) => s.title === WOBBLE));
  w.body.status = 200;
  w.body.now = wobbleFeed;
  const fourth = await w.go('2026-11-17T22:00:00Z');
  const back = fourth.latest.stories.filter((s) => s.title === WOBBLE);
  assert.equal(back.length, 1, 'one story, not two');
  assert.equal(back[0].id, wobble.id);
  assert.equal(back[0].firstSeenAt, wobble.firstSeenAt);
});
