import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../scripts/config.mjs';
import { createHttp } from '../scripts/lib/http.mjs';
import { emptyLatch, evaluateTopStories, normalizeLatch, readQuietFile, resolveQuiet } from '../scripts/lib/quietmode.mjs';
import { headlineMagnitude, quietReason } from '../scripts/lib/quietcards.mjs';
import * as topstories from '../scripts/sources/topstories.mjs';
import { fixtureJson, mockFetch, noSleep, tmpRoot, REPO } from './helpers.mjs';

const cfg = config();
const HOUR = 3600e3;
const NOW = Date.parse('2026-11-16T22:30:00Z');
const evalTitles = (titles) => evaluateTopStories(titles, cfg.quiet);

// ---- quiet.json, the manual switch ------------------------------------------

function quietFile(content) {
  const dir = tmpRoot('dtwet-quiet-');
  const file = path.join(dir, 'quiet.json');
  if (content !== undefined) fs.writeFileSync(file, content);
  return file;
}

test('the file that ships says quiet is off', () => {
  const r = readQuietFile(path.join(REPO, 'quiet.json'));
  assert.equal(r.quiet, false);
  assert.equal(r.problem, null);
});

test('manual: a missing file is off', () => {
  const r = readQuietFile(quietFile());
  assert.deepEqual(r, { quiet: false, note: '', problem: null });
});

test('manual: true is on, false is off, and the note comes along', () => {
  assert.deepEqual(readQuietFile(quietFile('{"quiet": true, "note": "A hard day"}')), { quiet: true, note: 'A hard day', problem: null });
  assert.equal(readQuietFile(quietFile('{"quiet": false, "note": ""}')).quiet, false);
  assert.equal(readQuietFile(quietFile('{"note": "no switch"}')).quiet, false);
});

test('manual: words people might type', () => {
  for (const v of ['"true"', '"yes"', '"on"', '"1"', '1', '" TRUE "']) assert.equal(readQuietFile(quietFile(`{"quiet": ${v}}`)).quiet, true, v);
  for (const v of ['"false"', '"no"', '"off"', '"0"', '0', '""']) assert.equal(readQuietFile(quietFile(`{"quiet": ${v}}`)).quiet, false, v);
});

test('manual: a broken switch means quiet (fail-safe), with the reason', () => {
  const broken = [
    ['{"quiet": tru', /not valid JSON/],
    ['', /not valid JSON/],
    ['[]', /not an object/],
    ['null', /not an object/],
    ['7', /not an object/],
    ['{"quiet": "maybe"}', /not true or false/],
    ['{"quiet": {"x": 1}}', /not true or false/],
  ];
  for (const [content, why] of broken) {
    const r = readQuietFile(quietFile(content));
    assert.equal(r.quiet, true, content);
    assert.match(r.problem, why, content);
  }
});

test('manual: a file that cannot be read means quiet', () => {
  const dir = tmpRoot('dtwet-quiet-dir-');
  const r = readQuietFile(dir); // a folder where a file should be
  assert.equal(r.quiet, true);
  assert.match(r.problem, /unreadable/);
});

test('manual: a long note is cut', () => {
  assert.equal(readQuietFile(quietFile(JSON.stringify({ quiet: true, note: 'x'.repeat(1000) }))).note.length, 300);
});

// ---- the automatic check ----------------------------------------------------

const hit = 'Mass shooting at a mall leaves dozens dead';
const calm = 'Fed holds rates steady';

test('auto: 3 matching headlines in the top 30 trip it, 2 do not', () => {
  const three = [hit, calm, 'Death toll rises after the attack', calm, 'Officials call it a massacre'];
  const ev3 = evalTitles(three);
  assert.equal(ev3.tripped, true);
  assert.equal(ev3.matched, 3);
  assert.equal(ev3.checked, 5);
  const ev2 = evalTitles([hit, calm, 'Death toll rises after the attack', calm]);
  assert.equal(ev2.tripped, false);
  assert.equal(ev2.matched, 2);
});

test('auto: matches beyond the top 30 are not counted', () => {
  const titles = Array.from({ length: 30 }, () => calm);
  titles[0] = hit;
  titles[1] = 'Death toll climbs';
  titles.push('A massacre was reported', 'Terror attack in the capital', 'Scores killed in the strike');
  const ev = evalTitles(titles);
  assert.equal(ev.checked, 30);
  assert.equal(ev.matched, 2);
  assert.equal(ev.tripped, false);
});

test('auto: each spec term is recognized', () => {
  for (const t of ['A mass shooting in town', 'Terror attack in the city', 'Terrorist attacks rock capital', 'The massacre continues', 'Dozens killed in blast', 'Hundreds dead after storm', 'Scores of people dead', 'Death toll passes 40']) {
    assert.equal(evalTitles([t]).matched, 1, t);
  }
  for (const t of ['Fed holds rates steady', 'Mass transit strike ends', 'Dozens of flights canceled', 'Hundreds of sites offline']) {
    assert.equal(evalTitles([t]).matched, 0, t);
  }
});

test('auto: an ordinary day (a real live top-30 from 2026-11-16) does not trip', () => {
  const { titles } = fixtureJson('top-stories-ordinary.json');
  assert.equal(titles.length, 30);
  const ev = evalTitles(titles);
  assert.equal(ev.tripped, false);
  assert.equal(ev.matched, 0);
});

test('auto: junk input is handled', () => {
  assert.equal(evalTitles(undefined).checked, 0);
  assert.equal(evalTitles(null).tripped, false);
  assert.equal(evalTitles([]).tripped, false);
});

// ---- putting them together --------------------------------------------------

const auto = (titles, extra = {}) => ({ checked: true, via: 'google-top-stories', evaluation: evalTitles(titles), ...extra });
const off = { quiet: false, note: '', problem: null };
const run = (over) => resolveQuiet({ manual: off, auto: auto([calm]), latch: emptyLatch(), nowMs: NOW, holdHours: 6, ...over });

test('quiet resolves to off on an ordinary day, with the reason it checked', () => {
  const r = run({});
  assert.equal(r.quiet, false);
  assert.equal(r.why, null);
  assert.equal(r.auto.checked, true);
  assert.equal(r.auto.matched, 0);
  assert.equal(r.auto.headlines, 1);
  assert.equal(r.auto.tripped, false);
});

test('manual quiet wins and carries its note', () => {
  const r = run({ manual: { quiet: true, note: 'A hard day', problem: null } });
  assert.equal(r.quiet, true);
  assert.equal(r.why, 'manual');
  assert.equal(r.note, 'A hard day');
});

test('a broken quiet.json shows up as the reason', () => {
  const r = run({ manual: { quiet: true, note: '', problem: 'quiet.json is not valid JSON, staying quiet' } });
  assert.equal(r.quiet, true);
  assert.match(r.reason, /not valid JSON/);
});

test('auto trip turns quiet on, names the count, and starts a 6 hour hold', () => {
  const r = run({ auto: auto([hit, 'Death toll rises', 'A massacre was reported', calm]) });
  assert.equal(r.quiet, true);
  assert.equal(r.why, 'auto');
  assert.match(r.reason, /3 of the top 4 headlines match mass-casualty terms/);
  assert.equal(r.holdUntil, new Date(NOW + 6 * HOUR).toISOString());
  assert.equal(r.latch.holdUntil, r.holdUntil);
  assert.equal(r.auto.matches.length, 3);
});

test('the hold keeps it quiet after the headlines move on, then lets go', () => {
  const tripped = run({ auto: auto([hit, 'Death toll rises', 'A massacre was reported']) });
  const later = run({ latch: tripped.latch, nowMs: NOW + 3 * HOUR });
  assert.equal(later.quiet, true);
  assert.equal(later.why, 'hold');
  assert.match(later.reason, /holding quiet until/);
  const expired = run({ latch: tripped.latch, nowMs: NOW + 6 * HOUR + 1000 });
  assert.equal(expired.quiet, false);
  assert.equal(expired.latch.holdUntil, null);
});

test('a run that trips again extends the hold from the new time', () => {
  const first = run({ auto: auto([hit, 'Death toll rises', 'A massacre was reported']) });
  const again = run({ latch: first.latch, nowMs: NOW + 5 * HOUR, auto: auto([hit, 'Death toll rises', 'A massacre was reported']) });
  assert.equal(again.holdUntil, new Date(NOW + 11 * HOUR).toISOString());
});

test('when the check could not run, quiet stays as it was and the reason says so', () => {
  const r = run({ auto: { checked: false, via: null, error: 'google-top-stories: HTTP 429' } });
  assert.equal(r.quiet, false);
  assert.equal(r.auto.checked, false);
  assert.match(r.auto.error, /429/);
  const held = run({ auto: { checked: false, via: null, error: 'x' }, latch: { holdUntil: new Date(NOW + HOUR).toISOString(), lastTrippedAt: null } });
  assert.equal(held.quiet, true, 'an earlier trip still holds while the check is down');
});

test('a damaged latch is repaired, not trusted', () => {
  assert.deepEqual(normalizeLatch({ holdUntil: 'not a date', lastTrippedAt: 5 }), { holdUntil: null, lastTrippedAt: null });
  assert.deepEqual(normalizeLatch(null), emptyLatch());
  assert.equal(run({ latch: { holdUntil: 'garbage' } }).quiet, false);
});

// ---- the top stories source -------------------------------------------------

function rss(titles, publisher = '') {
  const items = titles.map((t, i) => `<item><title>${t}${publisher ? ` - ${publisher}` : ''}</title><link>https://example.com/${i}</link><pubDate>Mon, 16 Nov 2026 20:00:00 GMT</pubDate>${publisher ? `<source url="https://example.com">${publisher}</source>` : ''}</item>`).join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Top</title>${items}</channel></rss>`;
}
const ctxFor = (fetchImpl) => ({ http: createHttp({ fetchImpl, sleep: noSleep }), now: new Date(NOW), config: cfg, env: {}, xState: null, prev: {} });

test('config: Google first, then two fallback feeds, all https', () => {
  assert.match(cfg.quiet.topStoriesUrl, /^https:\/\/news\.google\.com\//);
  assert.equal(cfg.quiet.fallbackFeeds.length, 2);
  for (const f of cfg.quiet.fallbackFeeds) {
    assert.match(f.url, /^https:\/\//);
    assert.ok(f.via);
  }
});

test('topstories: reads the top 30 titles and drops the publisher suffix', async () => {
  const titles = Array.from({ length: 40 }, (_, i) => `Story number ${i + 1} about things`);
  const { fetch } = mockFetch([['news.google.com', () => ({ body: rss(titles, 'AP') })]]);
  const r = await topstories.run(ctxFor(fetch));
  assert.equal(r.ok, true);
  assert.equal(r.via, 'google-top-stories');
  assert.equal(r.titles.length, 30);
  assert.equal(r.titles[0], 'Story number 1 about things');
});

test('topstories: when Google refuses, the next feed that answers is used and named', async () => {
  const { fetch, calls } = mockFetch([
    ['news.google.com', () => ({ status: 429, body: 'blocked' })],
    ['bbci.co.uk', () => ({ body: rss(['BBC story one about a thing', 'BBC story two about a thing']) })],
  ]);
  const r = await topstories.run(ctxFor(fetch));
  assert.equal(r.ok, true);
  assert.equal(r.via, 'bbc-top-stories');
  assert.deepEqual(r.titles, ['BBC story one about a thing', 'BBC story two about a thing']);
  assert.equal(calls.length, 2);
});

test('topstories: an empty feed counts as a failure and the next one is tried', async () => {
  const { fetch } = mockFetch([
    ['news.google.com', () => ({ body: rss([]) })],
    ['bbci.co.uk', () => ({ status: 500, body: 'x' })],
    ['npr.org', () => ({ body: rss(['NPR story one about a thing']) })],
  ]);
  const r = await topstories.run(ctxFor(fetch));
  assert.equal(r.via, 'npr-top-stories');
});

test('topstories: nothing answering is a failed check with every reason listed', async () => {
  const { fetch } = mockFetch([[/./, () => ({ status: 503, body: 'x' })]]);
  const r = await topstories.run(ctxFor(fetch));
  assert.equal(r.ok, false);
  assert.deepEqual(r.titles, []);
  assert.match(r.error, /google-top-stories.*bbc-top-stories.*npr-top-stories/);
});

// ---- quiet cards ------------------------------------------------------------

const story = (title, over = {}) => ({ title, kind: 'news', cat: 'weather', ...over });

test('quiet card: disaster words get one, in any category', () => {
  for (const [title, word] of [
    ['Flash flood warning closes the interstate', 'flash flood'],
    ['Wildfire forces power shutoffs for 40,000 customers', 'wildfire'],
    ['Hurricane watch issued as outages loom', 'hurricane'],
    ['Tornado knocks out power across the county', 'tornado'],
    ['Landslide cuts the only highway', 'landslide'],
    ['Tsunami advisory lifted after the quake', 'tsunami'],
    ['Thousands evacuated as the grid fails', 'evacuated'],
    ['Wildfire smoke grounds flights at the airport', 'wildfire'],
  ]) {
    const reason = quietReason(story(title, { cat: 'grid' }));
    assert.equal(reason, `headline mentions ${word}`, title);
  }
});

test('quiet card: the word "fire" in a harmless sense does not', () => {
  for (const title of [
    'Amazon Fire TV Stick app outage hits users',
    'Fire sale on cloud credits after the outage',
    'Ceasefire holds as the network comes back',
    'Friendly fire in the bank outage blame game',
    'Fire Tablet owners report a login outage',
  ]) {
    assert.equal(quietReason(story(title)), null, title);
  }
  assert.equal(quietReason(story('A fire at the data center takes the site offline')), 'headline mentions fire');
});

test('quiet card: an ordinary outage or glitch does not get one', () => {
  for (const t of ['Cloudflare outage knocks thousands of sites offline', 'Rolling blackouts hit regional grid', 'Flights grounded by a system glitch']) {
    assert.equal(quietReason(story(t)), null, t);
  }
});

test('quiet card: a big quake signal does, a small one does not', () => {
  const quake = (signal) => ({ kind: 'signal', cat: 'earth', title: 'M 6.6 - 148 km WSW of Tual, Indonesia', signal: { type: 'quake', ...signal } });
  assert.equal(quietReason(quake({ mag: 6.6 })), 'quake M6.5 or more');
  assert.equal(quietReason(quake({ mag: 6.0 })), null);
  assert.equal(quietReason(quake({ mag: 6.0, pager: 'yellow' })), 'USGS PAGER yellow');
  assert.equal(quietReason(quake({ mag: 6.0, pager: 'green' })), null);
  assert.equal(quietReason(quake({ mag: 6.0, tsunami: true })), 'tsunami flag');
});

test('quiet card: a news headline that states a big magnitude does too', () => {
  assert.equal(headlineMagnitude('6.6 magnitude earthquake strikes off Indonesia'), 6.6);
  assert.equal(headlineMagnitude('Magnitude 7 quake rattles Japan'), 7);
  assert.equal(headlineMagnitude('M7.1 quake near Alaska'), 7.1);
  assert.equal(headlineMagnitude('Earthquake knocks out power in the region'), 0);
  assert.equal(headlineMagnitude('Magnitude 6.8 reading on the new sensor'), 0, 'no quake word, no magnitude');
  assert.equal(quietReason(story('6.8 magnitude earthquake strikes the coast', { cat: 'earth' })), 'quake M6.5 or more');
  assert.equal(quietReason(story('5.1 magnitude earthquake rattles windows', { cat: 'earth' })), null);
});
