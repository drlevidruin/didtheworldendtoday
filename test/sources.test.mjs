import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../scripts/config.mjs';
import { createHttp } from '../scripts/lib/http.mjs';
import { mergeStories } from '../scripts/lib/cluster.mjs';
import { rotationStep, startIndex } from '../scripts/sources/news-common.mjs';
import * as google from '../scripts/sources/google.mjs';
import * as bing from '../scripts/sources/bing.mjs';
import * as gdelt from '../scripts/sources/gdelt.mjs';
import * as hn from '../scripts/sources/hn.mjs';
import * as usgs from '../scripts/sources/usgs.mjs';
import * as swpc from '../scripts/sources/swpc.mjs';
import * as jpl from '../scripts/sources/jpl.mjs';
import * as faa from '../scripts/sources/faa.mjs';
import * as status from '../scripts/sources/status.mjs';
import * as trends from '../scripts/sources/trends.mjs';
import { fixture, fixtureJson, mockFetch, noSleep } from './helpers.mjs';

const cfg = config();
const NOW = new Date('2026-11-16T22:30:00Z');
const ctxFor = (fetchImpl, over = {}) => ({
  http: createHttp({ fetchImpl, sleep: noSleep }),
  now: NOW,
  config: cfg,
  env: {},
  xState: null,
  prev: {},
  ...over,
});

// ---- Google News ----------------------------------------------------------

test('google: titles lose the publisher suffix, bad links are dropped', () => {
  const items = google.parseGoogle(fixture('google.xml'), 'flights');
  assert.equal(items.length, 3, 'the javascript: link is dropped');
  assert.deepEqual(
    items.map((i) => i.title),
    ['Airlines recover after nationwide FAA ground stop', 'Air travel ramps back up at DFW after nationwide ground stop', 'Ground stop - how it works - and what comes next'],
  );
  assert.deepEqual(items.map((i) => i.source), ['news8000.com', 'WFAA', 'Example Daily']);
  assert.equal(items[0].publishedAt, Date.parse('2026-11-16T20:10:00Z'));
  assert.ok(items.every((i) => i.kind === 'news' && i.cat === 'flights' && i.via === 'google'));
  assert.ok(items.every((i) => i.url.startsWith('https://news.google.com/')));
});

test('google: one request per configured query, spaced, with the right URL', async () => {
  const { fetch, calls } = mockFetch([['news.google.com', () => ({ body: fixture('google.xml') })]]);
  const r = await google.run(ctxFor(fetch));
  assert.equal(r.ok, true);
  assert.equal(r.error, null);
  assert.equal(calls.length, cfg.categories.reduce((n, c) => n + c.queries.length, 0));
  assert.ok(calls.every((c) => c.url.startsWith('https://news.google.com/rss/search?q=') && c.url.includes('+when:1d')));
  assert.equal(r.items.length, calls.length * 3);
  const asked = new Set(calls.map((c) => decodeURIComponent(c.url.split('q=')[1].split('&')[0]).replace(/\+when:1d$/, '')));
  assert.equal(asked.size, calls.length, 'each query exactly once');
});

test('google: the first 429 ends the run, with no push past it', async () => {
  let n = 0;
  const { fetch, calls } = mockFetch([['news.google.com', () => (++n > 3 ? { status: 429, body: fixture('google-blocked.html') } : { body: fixture('google.xml') })]]);
  const r = await google.run(ctxFor(fetch));
  assert.equal(r.ok, true, 'three queries answered');
  assert.equal(calls.length, 4, 'it stopped at the first refusal and pushed no further');
  assert.match(r.error, /blocked after 3 of \d+ queries/);
  assert.equal(r.items.length, 9);
  assert.equal('cursor' in r, false, 'nothing is saved between runs');
});

test('google: the starting query moves every 15 minutes, so a blocked source still covers everything over a few runs', async () => {
  const queries = cfg.categories.flatMap((c) => c.queries);
  const firstQuery = async (at) => {
    const { fetch, calls } = mockFetch([['news.google.com', () => ({ status: 429, body: 'blocked' })]]);
    await google.run(ctxFor(fetch, { now: new Date(at) }));
    return decodeURIComponent(calls[0].url.split('q=')[1].split('&')[0]).replace(/\+when:1d$/, '');
  };
  const a = await firstQuery('2026-11-16T22:00:00Z');
  const b = await firstQuery('2026-11-16T22:15:00Z');
  const c = await firstQuery('2026-11-16T22:30:00Z');
  assert.equal(new Set([a, b, c]).size, 3);
  for (const q of [a, b, c]) assert.ok(queries.includes(q));
  assert.equal(await firstQuery('2026-11-16T22:00:00Z'), a, 'the same time gives the same start');
  assert.equal(await firstQuery('2026-11-16T22:14:59Z'), a, 'one start per 15 minute slot');
});

test('rotation: windows as wide as the step, started one slot apart, cover every query within a few runs, for any list length', () => {
  for (let total = 2; total <= 70; total += 1) {
    const step = rotationStep(total);
    assert.ok(step >= 1 && step < total, `step for ${total}`);
    const covered = new Set();
    const slots = Math.ceil(total / step) + 1;
    for (let slot = 0; slot < slots; slot += 1) {
      const start = startIndex(slot * 15 * 60 * 1000, total);
      assert.ok(start >= 0 && start < total);
      for (let i = 0; i < step; i += 1) covered.add((start + i) % total);
    }
    assert.equal(covered.size, total, `${total} queries, step ${step}`);
  }
  assert.equal(startIndex(123456789, 1), 0);
  assert.equal(startIndex(123456789, 0), 0);
  const total = cfg.categories.reduce((n, c) => n + c.queries.length, 0);
  assert.ok(rotationStep(total) <= 12, 'a source that allows about a dozen calls still gets full coverage');
});

test('google: a 429 on the very first call is a failed source, not a crash', async () => {
  const { fetch, calls } = mockFetch([['news.google.com', () => ({ status: 429, body: fixture('google-blocked.html') })]]);
  const r = await google.run(ctxFor(fetch));
  assert.equal(r.ok, false);
  assert.equal(r.count, 0);
  assert.match(r.error, /429/);
  assert.equal(calls.length, 1);
});

test('google: a block page that answers 200 is a failure, not an empty success', async () => {
  const { fetch, calls } = mockFetch([['news.google.com', () => ({ status: 200, body: fixture('google-blocked.html') })]]);
  const r = await google.run(ctxFor(fetch));
  assert.equal(r.ok, false);
  assert.match(r.error, /not an RSS|no channel|not XML/);
  assert.ok(calls.length <= 5, `it gives up after a few failures in a row, made ${calls.length}`);
});

test('google: a dead network gives up after a few failures in a row', async () => {
  const { fetch, calls } = mockFetch([['news.google.com', () => { throw new TypeError('fetch failed'); }]]);
  const r = await google.run(ctxFor(fetch));
  assert.equal(r.ok, false);
  assert.match(r.error, /gave up after 4 failures in a row/);
  assert.equal(calls.length, 8, '4 queries, each tried twice');
});

// ---- Bing -----------------------------------------------------------------

test('bing: apiclick links are decoded to the publisher page', () => {
  const items = bing.parseBing(fixture('bing.xml'), 'flights');
  assert.equal(items.length, 3);
  assert.equal(items[0].url, 'https://apnews.com/article/donald-trump-joe-biden-cash-stranded-travelers-2d4441b7387ba31c691e0d2d52cb543d');
  assert.equal(items[2].url, 'https://www.cnn.com/2026/11/16/politics/buttigieg-trump-faa-groundstop');
  assert.deepEqual(items.map((i) => i.source), ['Associated Press News', 'CNN on MSN', 'CNN']);
  assert.ok(items.every((i) => i.via === 'bing'));
});

test('bing: decodeBingLink leaves other links alone', () => {
  assert.equal(bing.decodeBingLink('https://example.com/a'), 'https://example.com/a');
  assert.equal(bing.decodeBingLink('not a url'), 'not a url');
  assert.equal(bing.decodeBingLink('https://www.bing.com/news/apiclick.aspx?x=1'), 'https://www.bing.com/news/apiclick.aspx?x=1');
  assert.equal(bing.decodeBingLink('https://evilbing.com/news/apiclick.aspx?url=https%3a%2f%2fa.com'), 'https://evilbing.com/news/apiclick.aspx?url=https%3a%2f%2fa.com');
});

test('bing: stops at the first 429 like Google', async () => {
  const { fetch, calls } = mockFetch([['bing.com', () => ({ status: 429, body: 'slow down' })]]);
  const r = await bing.run(ctxFor(fetch));
  assert.equal(r.ok, false);
  assert.equal(calls.length, 1);
});

// ---- GDELT ----------------------------------------------------------------

test('gdelt: English articles only, dates from seendate', () => {
  const items = gdelt.parseGdelt(fixtureJson('gdelt.json'), 'grid');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Rolling blackouts hit regional grid as demand spikes');
  assert.equal(items[0].publishedAt, Date.parse('2026-11-16T22:15:00Z'));
  assert.equal(items[0].source, 'example-news.com');
  assert.equal(gdelt.parseSeenDate('nonsense'), null);
});

test('gdelt: its plain-text "please limit requests" reply ends the run quietly', async () => {
  const { fetch, calls } = mockFetch([['gdeltproject.org', () => ({ body: fixture('gdelt-limit.txt') })]]);
  const r = await gdelt.run(ctxFor(fetch));
  assert.equal(r.ok, false);
  assert.match(r.error, /rate limited/);
  assert.equal(calls.length, 1, 'it did not ask a second time');
});

test('gdelt: at most 4 calls a run, and the categories rotate between runs', async () => {
  const { fetch, calls } = mockFetch([['gdeltproject.org', () => ({ body: fixture('gdelt.json') })]]);
  const r = await gdelt.run(ctxFor(fetch));
  assert.equal(r.ok, true);
  assert.equal(calls.length, cfg.gdelt.callsPerRun);
  const a = gdelt.pickCategories(cfg.categories, new Date('2026-11-16T22:00:00Z'), 4).map((c) => c.id);
  const b = gdelt.pickCategories(cfg.categories, new Date('2026-11-16T22:15:00Z'), 4).map((c) => c.id);
  assert.notDeepEqual(a, b);
});

// ---- Hacker News ----------------------------------------------------------

test('hn: stories become headlines, linked to the article, dated from created_at_i', () => {
  const items = hn.parseHn(fixtureJson('hn.json'), 'internet');
  assert.equal(items.length, 3);
  assert.equal(items[0].url, 'https://apnews.com/article/united-airlines-outage-5a5e5f75bb07f11ffb8750901f0076ff');
  assert.equal(items[0].source, 'apnews.com');
  assert.equal(items[0].publishedAt, 1794867738 * 1000);
});

test('hn: a self post with no url links to its discussion page', () => {
  const [item] = hn.parseHn({ hits: [{ objectID: '123', title: 'Ask HN: is GitHub down for everyone', created_at_i: 1794867738 }] }, 'internet');
  assert.equal(item.url, 'https://news.ycombinator.com/item?id=123');
});

test('hn: asks each configured query with the points floor', async () => {
  const { fetch, calls } = mockFetch([['hn.algolia.com', () => ({ body: fixture('hn.json') })]]);
  const r = await hn.run(ctxFor(fetch));
  assert.equal(r.ok, true);
  assert.equal(calls.length, cfg.hn.queries.length);
  assert.ok(decodeURIComponent(calls[0].url).includes(`points>${cfg.hn.minPoints}`));
});

// ---- USGS -----------------------------------------------------------------

test('usgs: the biggest quake is the vital sign, M6 and up are stories', () => {
  const out = usgs.parseUsgs(fixtureJson('usgs.json'), { minMag: 6 });
  assert.equal(out.vital.mag, 6.6);
  assert.equal(out.vital.place, '148 km WSW of Tual, Indonesia');
  assert.equal(out.signals.length, 1);
  const [s] = out.signals;
  assert.equal(s.kind, 'signal');
  assert.equal(s.cat, 'earth');
  assert.equal(s.id, 'sig:quake:us7000tymu');
  assert.equal(s.signal.type, 'quake');
  assert.equal(s.signal.mag, 6.6);
  assert.equal(s.publishedAt, 1794863480515);
});

test('usgs: run() returns the vital under quake, and fails cleanly on bad JSON', async () => {
  const ok = await usgs.run(ctxFor(mockFetch([['usgs.gov', () => ({ body: fixture('usgs.json') })]]).fetch));
  assert.equal(ok.ok, true);
  assert.equal(ok.vital.quake.mag, 6.6);
  assert.equal(ok.count, 1);
  const bad = await usgs.run(ctxFor(mockFetch([['usgs.gov', () => ({ body: '<html>oops</html>' })]]).fetch));
  assert.equal(bad.ok, false);
  assert.match(bad.error, /not JSON/);
  const down = await usgs.run(ctxFor(mockFetch([['usgs.gov', () => ({ status: 500, body: 'x' })]]).fetch));
  assert.equal(down.ok, false);
});

test('usgs: a feed with no quakes is a success with an empty vital', () => {
  const out = usgs.parseUsgs({ features: [] }, { minMag: 6 });
  assert.equal(out.vital, null);
  assert.deepEqual(out.signals, []);
  assert.deepEqual(usgs.parseUsgs({}, { minMag: 6 }).signals, []);
});

// ---- NOAA SWPC ------------------------------------------------------------

test('swpc: both shapes of the Kp feed are read the same way', () => {
  const objects = swpc.parseKpRows(fixtureJson('kp.json'));
  const arrays = swpc.parseKpRows(fixtureJson('kp-array.json'));
  assert.ok(objects.length > 10 && objects.every((r) => Number.isFinite(r.kp) && Number.isFinite(r.t)));
  assert.deepEqual(arrays.map((r) => r.kp), [2.67, 5.33, 6, 4.67]);
  assert.deepEqual(swpc.parseKpRows(null), []);
  assert.deepEqual(swpc.parseKpRows([]), []);
});

test('swpc: Kp 5 or more makes one story per ET day, using the day high', () => {
  const rows = swpc.parseKpRows(fixtureJson('kp-array.json'));
  const sigs = swpc.kpSignals(rows, Date.parse('2026-11-16T22:30:00Z'));
  assert.equal(sigs.length, 1);
  assert.equal(sigs[0].id, 'sig:kp:2026-11-16');
  assert.equal(sigs[0].signal.kp, 6);
  assert.equal(sigs[0].signal.scale, 'G2');
  assert.equal(sigs[0].cat, 'sun');
  assert.deepEqual(swpc.kpSignals(swpc.parseKpRows(fixtureJson('kp.json')), Date.parse('2026-11-16T22:30:00Z')), [], 'a calm week makes no story');
});

test('swpc: the flare ALERT and its SUMMARY merge into one story', () => {
  const sigs = swpc.flareSignals(fixtureJson('alerts.json'), Date.parse('2026-11-16T22:30:00Z'));
  assert.equal(sigs.length, 2, 'the alert and the summary of the X flare; the M flare and the watch are not X-class');
  assert.equal(sigs[0].id, sigs[1].id);
  assert.match(sigs[0].id, /^sig:flare:2026-11-16T18$/);
  assert.equal(sigs[0].signal.cls, 'X3.9');
  assert.match(sigs[0].title, /X-class solar flare X3\.9 \(R3 radio blackout\)/);
  const merged = mergeStories([], sigs, { now: NOW.getTime() });
  assert.equal(merged.length, 1);
});

test('swpc: run() reads both feeds and keeps the vital sign', async () => {
  const { fetch } = mockFetch([
    ['noaa-planetary-k-index', () => ({ body: fixture('kp-array.json') })],
    ['alerts.json', () => ({ body: fixture('alerts.json') })],
  ]);
  const r = await swpc.run(ctxFor(fetch));
  assert.equal(r.ok, true);
  assert.equal(r.vital.kp.value, 4.67);
  assert.equal(r.vital.kp.max24, 6);
  assert.ok(r.signals.some((s) => s.signal.type === 'kp') && r.signals.some((s) => s.signal.type === 'flare'));
});

test('swpc: one feed down is a partial success, both down is a failure', async () => {
  const partial = await swpc.run(ctxFor(mockFetch([['noaa-planetary-k-index', () => ({ body: fixture('kp-array.json') })], ['alerts.json', () => ({ status: 500, body: 'x' })]]).fetch));
  assert.equal(partial.ok, true);
  assert.match(partial.error, /partial/);
  const none = await swpc.run(ctxFor(mockFetch([[/./, () => ({ status: 500, body: 'x' })]]).fetch));
  assert.equal(none.ok, false);
});

// ---- NASA / JPL -----------------------------------------------------------

test('jpl: the closest pass is the vital sign; only a pass inside 1 lunar distance is a story', () => {
  const out = jpl.parseCad(fixtureJson('jpl.json'), NOW, cfg.signals);
  assert.equal(out.vital.des, '2026 WA');
  assert.ok(out.vital.ld > 0.3 && out.vital.ld < 0.35, `ld ${out.vital.ld}`);
  assert.equal(out.vital.upcoming, true);
  assert.equal(out.signals.length, 1);
  const [s] = out.signals;
  assert.equal(s.cat, 'space');
  assert.equal(s.signal.type, 'asteroid');
  assert.ok(s.signal.ld < 0.5);
  assert.match(s.title, /^Asteroid 2026 WA passes at 0\.33 lunar distances, about the size of a /);
  assert.equal(s.publishedAt, NOW.getTime(), 'an approach still ahead is news now');
  assert.equal(s.id, 'sig:asteroid:2026-WA:2026-11-17');
});

test('jpl: nothing in the window gives an empty vital and no story', () => {
  const out = jpl.parseCad({ fields: ['des', 'cd', 'dist', 'h'], data: [] }, NOW, cfg.signals);
  assert.equal(out.vital, null);
  assert.deepEqual(out.signals, []);
});

test('jpl: run() sends the date window and fails cleanly on a server error', async () => {
  const { fetch, calls } = mockFetch([['ssd-api.jpl.nasa.gov', () => ({ body: fixture('jpl.json') })]]);
  const r = await jpl.run(ctxFor(fetch));
  assert.equal(r.ok, true);
  assert.match(calls[0].url, /date-min=2026-11-15&date-max=2026-11-18/);
  const bad = await jpl.run(ctxFor(mockFetch([[/./, () => ({ status: 503, body: 'x' })]]).fetch));
  assert.equal(bad.ok, false);
});

// ---- FAA ------------------------------------------------------------------

test('faa: ground stops are stories, hubs first; delays and real closures are only counts', () => {
  const parsed = faa.parseFaa(fixture('faa-stops.xml'), cfg.faa);
  assert.deepEqual(parsed.stops.map((s) => [s.arpt, s.hub]), [['ATL', true], ['BNA', false]]);
  assert.equal(parsed.nationwide, false);
  assert.equal(parsed.delays.length, 1);
  assert.equal(parsed.closures.length, 1, 'the SNA night curfew notice is not a closure');
  const sigs = faa.faaSignals(parsed, NOW.getTime());
  assert.deepEqual(sigs.map((s) => s.signal.airport), ['ATL', 'BNA']);
  assert.equal(sigs[0].signal.hub, true);
  assert.equal(sigs[0].cat, 'flights');
  assert.equal(sigs[0].id, 'sig:faa-stop:ATL:2026-11-16');
  assert.ok(sigs[0].rank > sigs[1].rank);
  const vital = faa.faaVital(parsed);
  assert.equal(vital.groundStops.length, 2);
  assert.equal(vital.groundDelays, 1);
  assert.equal(vital.closures, 1);
});

test('faa: a feed with no ground stop makes no story', () => {
  const parsed = faa.parseFaa(fixture('faa.xml'), cfg.faa);
  assert.deepEqual(parsed.stops, []);
  assert.deepEqual(faa.faaSignals(parsed, NOW.getTime()), []);
  assert.equal(parsed.delays.length, 2);
  assert.equal(parsed.closures.length, 0, 'GA-only restrictions and night curfews are not closures');
});

test('faa: ground stops at many airports at once, or a "nationwide" reason, make it nationwide', () => {
  const airports = ['ATL', 'BOS', 'DEN', 'DFW', 'EWR', 'JFK', 'LAX', 'MIA', 'ORD', 'SEA'];
  const rows = airports.map((a) => `<Program><ARPT>${a}</ARPT><Reason>equipment</Reason></Program>`).join('');
  const xml = `<AIRPORT_STATUS_INFORMATION><Delay_type><Name>Ground Stop Programs</Name><Ground_Stop_List>${rows}</Ground_Stop_List></Delay_type></AIRPORT_STATUS_INFORMATION>`;
  const many = faa.parseFaa(xml, cfg.faa);
  assert.equal(many.nationwide, true);
  const sigs = faa.faaSignals(many, NOW.getTime());
  assert.equal(sigs.length, 5, 'story count is capped');
  assert.ok(sigs.every((s) => s.signal.nationwide === true));

  const one = '<AIRPORT_STATUS_INFORMATION><Delay_type><Name>Ground Stop Programs</Name><Ground_Stop_List><Program><ARPT>ATL</ARPT><Reason>nationwide system failure</Reason></Program></Ground_Stop_List></Delay_type></AIRPORT_STATUS_INFORMATION>';
  assert.equal(faa.parseFaa(one, cfg.faa).nationwide, true);
});

test('faa: a page that is not the FAA feed is a failed source, not a quiet sky', async () => {
  assert.throws(() => faa.parseFaa('<html><body>Maintenance</body></html>', cfg.faa), /no AIRPORT_STATUS_INFORMATION/);
  const r = await faa.run(ctxFor(mockFetch([['nasstatus.faa.gov', () => ({ body: '<html>Maintenance</html>' })]]).fetch));
  assert.equal(r.ok, false);
  const good = await faa.run(ctxFor(mockFetch([['nasstatus.faa.gov', () => ({ body: fixture('faa-stops.xml') })]]).fetch));
  assert.equal(good.ok, true);
  assert.equal(good.count, 2);
  assert.equal(good.vital.faa.groundStops.length, 2);
});

// ---- Status pages ---------------------------------------------------------

test('status: only major and critical are stories', () => {
  const page = cfg.statusPages[0];
  const read = (name) => status.parseStatus(fixtureJson(name), page);
  assert.equal(status.statusSignal(page, read('status-none.json'), NOW.getTime()), null);
  assert.equal(status.statusSignal(page, read('status-minor.json'), NOW.getTime()), null);
  assert.equal(status.statusSignal(page, read('status-maintenance.json'), NOW.getTime()), null);
  const sig = status.statusSignal(page, read('status-major.json'), NOW.getTime());
  assert.equal(sig.cat, 'internet');
  assert.equal(sig.signal.indicator, 'major');
  assert.equal(sig.id, `sig:status:${page.id}:2026-11-16`);
  assert.equal(status.parseStatus({ status: {} }, page), null);
  assert.equal(status.parseStatus({ status: { indicator: 'weird' } }, page).indicator, 'unknown');
});

test('status: run() fails only when no page answers', async () => {
  const some = mockFetch([
    ['githubstatus.com', () => ({ body: fixture('status-major.json') })],
    ['cloudflarestatus.com', () => ({ body: fixture('status-none.json') })],
    [/./, () => ({ status: 500, body: 'x' })],
  ]);
  const r = await status.run(ctxFor(some.fetch));
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  assert.equal(r.vital.status.worst, 'major');
  assert.equal(r.vital.status.unreachable, cfg.statusPages.length - 2);
  const none = await status.run(ctxFor(mockFetch([[/./, () => ({ status: 500, body: 'x' })]]).fetch));
  assert.equal(none.ok, false);
  assert.match(none.error, /no status page answered/);
});

test('every source module has an id and a run() that returns instead of throwing', async () => {
  const all = { google, bing, gdelt, hn, usgs, swpc, jpl, faa, status, trends };
  const { fetch } = mockFetch([[/./, () => { throw new Error('everything is on fire'); }]]);
  for (const [name, mod] of Object.entries(all)) {
    assert.equal(mod.id, name);
    const r = await mod.run(ctxFor(fetch));
    assert.equal(r.ok, false, name);
    assert.equal(typeof r.error, 'string', name);
  }
});
