import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../scripts/config.mjs';
import { createHttp } from '../scripts/lib/http.mjs';
import { formatSummary, formatVerbose, runUpdate, xTrace } from '../scripts/update.mjs';
import { sameWithoutVolatile } from '../scripts/data-changed.mjs';
import * as usgs from '../scripts/sources/usgs.mjs';
import * as faa from '../scripts/sources/faa.mjs';
import * as jpl from '../scripts/sources/jpl.mjs';
import * as xsrc from '../scripts/sources/x.mjs';
import { failingSource, fakeSource, fixture, fixtureJson, mockFetch, newsItem, noSleep, readJson, throwingSource, tmpRoot } from './helpers.mjs';

const cfg = config();
const T = {
  flights: ['Flights grounded at Newark after system glitch', 'Southwest flights delayed by a major IT outage', 'Airlines recover after nationwide FAA ground stop'],
  hacks: ['Hackers breach customer database at retailer', 'Data breach exposes millions of customer records', 'Ransomware attack takes city systems offline'],
  internet: ['Cloudflare outage knocks thousands of sites offline', 'Major AWS outage disrupts popular apps', 'Slack is down for users across the US'],
  grid: ['Rolling blackouts hit regional grid as demand spikes', 'Power outage leaves 50,000 customers in the dark', 'Blackout hits city after substation failure'],
  markets: ['Stocks plunge in sudden flash crash', 'Trading halted as Nasdaq selloff deepens', 'Bitcoin crashes below 60,000 in wild swing'],
};
const PUBS = ['Pub A', 'Pub B', 'Pub C'];
const cat3 = (cat, at) => T[cat].map((title, i) => newsItem({ cat, title, source: PUBS[i], url: `https://pub${i}.example/${cat}/${i}`, publishedAt: Date.parse(at) }));
const feed = (items, id = 'google') => fakeSource(id, { count: items.length, items });
const ALL_FEEDS = ['google', 'bing', 'gdelt', 'hn', 'usgs', 'swpc', 'jpl', 'faa', 'status'];

const go = (root, now, sources, extra = {}) => runUpdate({ root, now, env: {}, sources, config: cfg, ...extra });
const dayPath = (root, d) => path.join(root, 'data', 'days', `${d}.json`);
const latestOf = (root) => readJson(path.join(root, 'data', 'latest.json'));

function snapshot(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else out.set(path.relative(root, full), fs.readFileSync(full, 'utf8'));
    }
  };
  walk(path.join(root, 'data'));
  return out;
}

test('a day is never rewritten once its ET date has passed, and the next day starts its own file', async () => {
  const root = tmpRoot();
  await go(root, '2026-11-16T22:30:00Z', [feed(cat3('internet', '2026-11-16T20:00:00Z'))]);
  const before = fs.readFileSync(dayPath(root, '2026-11-16'), 'utf8');
  const day16 = JSON.parse(before);
  assert.equal(day16.stories.length, 3);
  const firstSeen = Object.fromEntries(day16.stories.map((s) => [s.id, s.firstSeenAt]));

  // A later run on the 17th finds new stories and drops nothing it should keep.
  await go(root, '2026-11-17T15:00:00Z', [feed(cat3('grid', '2026-11-17T14:00:00Z'))]);
  assert.equal(fs.readFileSync(dayPath(root, '2026-11-16'), 'utf8'), before, 'the 16th is byte for byte what it was at its last run');
  const day17 = readJson(dayPath(root, '2026-11-17'));
  assert.equal(day17.stories.length, 6, 'the 17th is the rolling 24 hours, which still reaches back into the evening of the 16th');
  assert.deepEqual(day17.stories.map((s) => s.cat).sort(), ['grid', 'grid', 'grid', 'internet', 'internet', 'internet']);
  for (const s of day17.stories.filter((x) => x.cat === 'internet')) assert.equal(s.firstSeenAt, firstSeen[s.id]);

  // And a run a day later, when the 16th's stories are old, still leaves the 16th and 17th as they were.
  const seventeen = fs.readFileSync(dayPath(root, '2026-11-17'), 'utf8');
  await go(root, '2026-11-18T15:00:00Z', [feed(cat3('hacks', '2026-11-18T14:00:00Z'))]);
  assert.equal(fs.readFileSync(dayPath(root, '2026-11-16'), 'utf8'), before);
  assert.equal(fs.readFileSync(dayPath(root, '2026-11-17'), 'utf8'), seventeen, 'the 17th is final once it is the 18th');
  assert.deepEqual(readJson(dayPath(root, '2026-11-18')).stories.map((s) => s.cat), ['hacks', 'hacks', 'hacks']);
});

test('item 1: today\'s day file is the homepage: same score, fired, bumps, change and stories in listing order', async () => {
  const root = tmpRoot();
  const now = new Date('2026-11-17T20:30:00Z');
  const quake = usgs.parseUsgs(fixtureJson('usgs.json'), { minMag: 6 });
  const stop = faa.parseFaa(fixture('faa-stops.xml'), cfg.faa);
  const instruments = [
    fakeSource('usgs', { count: 1, vital: { quake: quake.vital }, signals: quake.signals }),
    fakeSource('faa', { count: 2, vital: { faa: faa.faaVital(stop) }, signals: faa.faaSignals(stop, now.getTime()) }),
  ];
  // Yesterday, a calm day: one fired category, so its final score is the floor.
  await go(root, '2026-11-16T22:30:00Z', [feed(cat3('internet', '2026-11-16T20:00:00Z'))]);
  const yesterdayFinal = readJson(dayPath(root, '2026-11-16'));
  // Today: busy, with stories from the evening before still inside the 24 hours.
  const items = [...cat3('internet', '2026-11-17T12:00:00Z'), ...cat3('grid', '2026-11-17T13:00:00Z'), ...cat3('hacks', '2026-11-17T14:00:00Z'), ...cat3('markets', '2026-11-17T15:00:00Z')];
  const { latest } = await go(root, now.toISOString(), [feed(items), ...instruments]);
  const day = readJson(dayPath(root, '2026-11-17'));

  assert.equal(day.date, '2026-11-17');
  assert.equal(day.score, latest.score);
  assert.deepEqual(day.fired, latest.fired);
  assert.deepEqual(day.bumps, latest.bumps);
  assert.equal(day.change, latest.change);
  assert.deepEqual(day.stories, latest.stories, 'the same stories in the same order');
  assert.ok(latest.bumps.length >= 1, 'the instruments were counted');
  assert.equal(latest.yesterday.date, '2026-11-16');
  assert.equal(latest.yesterday.score, yesterdayFinal.score, 'compared with yesterday\'s final score');
  assert.equal(latest.change, latest.score - yesterdayFinal.score);
  assert.ok(latest.change > 0);
  const index = readJson(path.join(root, 'data', 'days.json'));
  assert.equal(index[0].date, '2026-11-17');
  assert.equal(index[0].score, latest.score);
  assert.equal(index[0].top.title, latest.stories[0].title, 'the almanac top story is the first receipt');
});

test('item 1: yesterday and change use yesterday\'s final snapshot, not what it would be scored now', async () => {
  const root = tmpRoot();
  // The 16th ends at 11 pm with two fired categories: its final score is 12.
  await go(root, '2026-11-17T04:00:00Z', [feed([...cat3('internet', '2026-11-17T01:00:00Z'), ...cat3('grid', '2026-11-17T02:00:00Z')])]);
  assert.equal(readJson(dayPath(root, '2026-11-16')).score, 12);
  // At 12:30 am on the 17th the same stories are still in the rolling view, and the 16th is left alone.
  const { latest } = await go(root, '2026-11-17T05:30:00Z', [feed([])]);
  assert.equal(latest.score, 12);
  assert.deepEqual(latest.yesterday, { date: '2026-11-16', score: 12, fired: ['internet', 'grid'] });
  assert.equal(latest.change, 0);
  // Later that evening the rolling view has moved on, and yesterday's score has not.
  const { latest: later } = await go(root, '2026-11-18T01:00:00Z', [feed(cat3('markets', '2026-11-18T00:00:00Z'))]);
  assert.equal(later.yesterday.score, 12, 'yesterday never moves');
  assert.equal(readJson(dayPath(root, '2026-11-16')).score, 12);
});

test('a story with no date is dated when first seen, a future date counts as just now, and both stay put', async () => {
  const root = tmpRoot();
  const items = [
    newsItem({ title: 'Cloudflare outage knocks thousands of sites offline', publishedAt: null, url: 'https://a.example/1' }),
    newsItem({ title: 'Major AWS outage disrupts popular apps', publishedAt: Date.parse('2026-11-20T00:00:00Z'), url: 'https://a.example/2' }),
  ];
  const first = await go(root, '2026-11-16T22:00:00Z', [feed(items)]);
  assert.deepEqual(first.latest.stories.map((s) => s.publishedAt), ['2026-11-16T22:00:00.000Z', '2026-11-16T22:00:00.000Z']);
  const second = await go(root, '2026-11-16T22:15:00Z', [feed(items)]);
  assert.deepEqual(second.latest.stories.map((s) => s.publishedAt), ['2026-11-16T22:00:00.000Z', '2026-11-16T22:00:00.000Z']);
  assert.ok(second.latest.stories.every((s) => s.firstSeenAt === '2026-11-16T22:00:00.000Z'));
});

test('midnight Eastern: 11:59 pm and 12:01 am are both in the new day\'s rolling view, and the old day stays', async () => {
  const root = tmpRoot();
  const items = [
    newsItem({ title: 'Cloudflare outage knocks thousands of sites offline', publishedAt: Date.parse('2026-11-17T04:59:00Z'), url: 'https://a.example/1' }),
    newsItem({ title: 'Major AWS outage disrupts popular apps', publishedAt: Date.parse('2026-11-17T05:01:00Z'), url: 'https://a.example/2' }),
  ];
  await go(root, '2026-11-17T04:59:30Z', [feed([items[0]])]);
  const final16 = fs.readFileSync(dayPath(root, '2026-11-16'), 'utf8');
  await go(root, '2026-11-17T05:30:00Z', [feed(items)]);
  assert.equal(fs.readFileSync(dayPath(root, '2026-11-16'), 'utf8'), final16, 'the 16th keeps what it had at its last run');
  assert.deepEqual(readJson(dayPath(root, '2026-11-16')).stories.map((s) => s.title), ['Cloudflare outage knocks thousands of sites offline']);
  assert.equal(readJson(dayPath(root, '2026-11-17')).stories.length, 2, 'the new day opens with the rolling 24 hours');
  const latest = latestOf(root);
  assert.equal(latest.stories.length, 2);
  assert.equal(latest.etDate, '2026-11-17');
});

test('a story keeps its id when it is seen again on a later run', async () => {
  const root = tmpRoot();
  const items = cat3('internet', '2026-11-16T20:00:00Z');
  await go(root, '2026-11-16T22:00:00Z', [feed(items)]);
  const a = readJson(dayPath(root, '2026-11-16')).stories.map((s) => [s.id, s.firstSeenAt]).sort();
  await go(root, '2026-11-16T22:30:00Z', [feed(items)]);
  const b = readJson(dayPath(root, '2026-11-16')).stories.map((s) => [s.id, s.firstSeenAt]).sort();
  assert.deepEqual(b, a);
});

test('every source failing loses nothing already published', async () => {
  const root = tmpRoot();
  await go(root, '2026-11-16T22:00:00Z', [feed(cat3('internet', '2026-11-16T20:00:00Z'))]);
  const day = fs.readFileSync(dayPath(root, '2026-11-16'), 'utf8');
  const first = latestOf(root);
  const { report } = await go(root, '2026-11-16T22:15:00Z', ALL_FEEDS.concat(['x', 'topstories']).map((id) => failingSource(id)));
  assert.equal(fs.readFileSync(dayPath(root, '2026-11-16'), 'utf8'), day);
  const latest = latestOf(root);
  assert.deepEqual(latest.stories, first.stories);
  assert.equal(latest.lastSuccessAt, first.buildTime, 'it still says when the feeds last worked');
  assert.equal(latest.headlinesRead, first.headlinesRead);
  assert.equal(latest.sources.google.ok, false);
  assert.equal(latest.sources.google.lastOkAt, first.buildTime);
  assert.equal(report.keptCount, 0);
});

test('a source that throws is reported as failed and the run goes on', async () => {
  const root = tmpRoot();
  const { report, latest } = await go(root, '2026-11-16T22:00:00Z', [throwingSource('hn'), feed(cat3('internet', '2026-11-16T20:00:00Z'))]);
  const hn = report.results.find((r) => r.id === 'hn');
  assert.equal(hn.ok, false);
  assert.match(hn.error, /crashed: this source has a bug/);
  assert.equal(latest.stories.length, 3);
  assert.equal(latest.sources.hn.ok, false);
});

test('an empty folder and no network still gives a valid, quiet day', async () => {
  const root = tmpRoot();
  const { latest } = await go(root, '2026-11-16T22:00:00Z', ALL_FEEDS.concat(['x', 'topstories']).map((id) => failingSource(id)));
  assert.equal(latest.score, 11);
  assert.deepEqual(latest.fired, []);
  assert.deepEqual(latest.stories, []);
  assert.equal(latest.lastSuccessAt, null);
  assert.equal(latest.change, null);
  assert.equal(latest.yesterday, null);
  assert.deepEqual(fs.readdirSync(path.join(root, 'data', 'days')), ['2026-11-16.json'], 'no invented past days');
});

test('archive entries the current rules would reject are removed and counted', async () => {
  const root = tmpRoot();
  const good = { id: 'aaaa1111', cat: 'internet', kind: 'news', title: 'Cloudflare outage knocks thousands of sites offline', url: 'https://example.com/a', source: 'Pub A', publishedAt: '2026-11-16T18:00:00.000Z', firstSeenAt: '2026-11-16T18:05:00.000Z', outlets: 1, outletNames: ['Pub A'], score: 1 };
  const bad = { ...good, id: 'bbbb2222', title: 'Man killed in power outage at the airport', url: 'https://example.com/b' };
  const lost = { ...good, id: 'cccc3333', title: 'Cat photos you will love', url: 'https://example.com/c' };
  fs.mkdirSync(path.dirname(dayPath(root, '2026-11-16')), { recursive: true });
  fs.writeFileSync(dayPath(root, '2026-11-16'), JSON.stringify({ date: '2026-11-16', score: 11, fired: [], bumps: [], updatedAt: '2026-11-16T19:00:00.000Z', stories: [good, bad, lost] }));
  const { report } = await go(root, '2026-11-16T22:00:00Z', [feed([])]);
  assert.equal(report.cleaned['excluded:death'], 1);
  assert.equal(report.cleaned['off-topic'], 1);
  assert.deepEqual(readJson(dayPath(root, '2026-11-16')).stories.map((s) => s.id), ['aaaa1111']);
  assert.match(formatSummary(report), /removed from the archive by the current rules: excluded:death 1, off-topic 1/);
});

test('item 12: every stored story is checked again on every run, and a frozen day is left as it was', async () => {
  const root = tmpRoot();
  const story = (id, title, over = {}) => ({ id, cat: 'internet', kind: 'news', title, url: `https://example.com/${id}`, source: 'Pub A', publishedAt: '2026-11-17T14:00:00.000Z', firstSeenAt: '2026-11-17T14:05:00.000Z', outlets: 1, outletNames: ['Pub A'], score: 1, ...over });
  const banned = [
    'Man fatally shot at airport',
    'Gunfire at LAX terminal',
    'Robot malfunction injures worker',
    'Hackers hit schoolchildren records',
    "Hackers leak students' records",
    'Toddlers game app exposes data',
    'Teens targeted by app flaw',
    'Baby formula recalled over botulism',
    'Airline stock falls after Air India crash',
    'Antisemitic rants spread on app',
    'Jewish school targeted by hackers',
    'Synagogue websites hit by outage',
    'Tariff hike rattles markets',
    'Vaccine debate flares',
    'Powell fired as Fed chair',
    'Elon Musk says X is down',
    'Listeria sickens 27 across states',
    'Ebola outbreak in Congo',
    'Therapy notes of 30,000 patients leaked',
    'US has lost measles elimination status',
  ];
  const kept = [
    story('keep0001', 'Cloudflare outage knocks thousands of sites offline'),
    story('keep0002', 'Market crash wipes billions from tech stocks', { cat: 'markets' }),
    story('keep0003', 'DDoS attack knocks gaming site offline', { cat: 'hacks' }),
  ];
  const bad = (when) => banned.map((title, i) => story(`bad${String(i).padStart(5, '0')}${when}`, title, { publishedAt: when === 'y' ? '2026-11-16T20:00:00.000Z' : '2026-11-17T14:00:00.000Z' }));
  const frozen = { date: '2026-11-16', score: 40, fired: [], bumps: [], change: null, updatedAt: '2026-11-16T23:59:00.000Z', stories: bad('y') };
  fs.mkdirSync(path.dirname(dayPath(root, '2026-11-16')), { recursive: true });
  fs.writeFileSync(dayPath(root, '2026-11-16'), JSON.stringify(frozen));
  fs.writeFileSync(dayPath(root, '2026-11-17'), JSON.stringify({ date: '2026-11-17', score: 30, fired: [], bumps: [], change: 0, updatedAt: '2026-11-17T14:30:00.000Z', stories: [...kept, ...bad('t')] }));
  const frozenBefore = fs.readFileSync(dayPath(root, '2026-11-16'), 'utf8');
  const { report, latest } = await go(root, '2026-11-17T15:00:00Z', [feed([])]);
  const titles = latest.stories.map((x) => x.title);
  for (const title of banned) assert.ok(!titles.includes(title), `"${title}" is gone from latest.json`);
  assert.deepEqual(titles.sort(), kept.map((x) => x.title).sort(), 'the harmless stories stay');
  assert.deepEqual(readJson(dayPath(root, '2026-11-17')).stories.map((x) => x.title).sort(), kept.map((x) => x.title).sort(), "today's file is cleaned too");
  const cleaned = Object.values(report.cleaned).reduce((a, b) => a + b, 0);
  assert.equal(cleaned, banned.length * 2, "yesterday's and today's copies are both turned away");
  assert.equal(fs.readFileSync(dayPath(root, '2026-11-16'), 'utf8'), frozenBefore, 'a day that has passed is never rewritten');
});

test('items 19 and 3: a malformed or unclear quiet.json means quiet ON, the problem is named in latest.json and the run summary, and the run still succeeds', async () => {
  const shapes = [
    ['{ "quiet": tru', /not valid JSON/],
    ['', /not valid JSON/],
    ['[]', /not an object/],
    ['{}', /no "quiet" setting/],
    ['{"quite": true}', /no "quiet" setting/],
    ['{"quiet": null}', /not true or false/],
    ['{"quiet": "false"}', /not true or false/],
    ['{"quiet": "maybe"}', /not true or false/],
    ['{"quiet": {"x": 1}}', /not true or false/],
  ];
  for (const [content, why] of shapes) {
    const root = tmpRoot();
    fs.writeFileSync(path.join(root, 'quiet.json'), content);
    const { report, latest } = await go(root, '2026-11-16T22:00:00Z', [feed(cat3('internet', '2026-11-16T20:00:00Z'))]);
    assert.equal(latest.quiet.quiet, true, `"${content}" is read as quiet`);
    assert.equal(latest.quiet.why, 'manual');
    assert.match(latest.quiet.manual.problem, why);
    assert.match(latest.quiet.reason, why);
    const summary = formatSummary(report);
    assert.match(summary, /quiet: ON \(manual: /);
    assert.match(summary, /quiet\.json PROBLEM: /);
    assert.ok(latest.stories.length >= 3, 'the stories still file as usual');
  }
  // Someone fixes the file: the next run is back to normal and the problem is gone.
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'quiet.json'), '{ nope');
  await go(root, '2026-11-16T22:00:00Z', [feed([])]);
  fs.writeFileSync(path.join(root, 'quiet.json'), '{"quiet": false, "note": ""}');
  const fixed = await go(root, '2026-11-16T22:15:00Z', [feed([])]);
  assert.equal(fixed.latest.quiet.quiet, false);
  assert.equal(fixed.latest.quiet.manual.problem, null);
  assert.ok(!/PROBLEM/.test(formatSummary(fixed.report)));
});

test('a hostile headline is stored as text, stripped of control characters, and unsafe links are dropped', async () => {
  const root = tmpRoot();
  const evil = newsItem({ title: '<script>alert("x")</script> Cloudflare\u0000 outage ‮knocks sites offline', source: '<b>Evil</b> Daily', url: 'https://example.com/x?a=1&b=2' });
  const js = newsItem({ title: 'Cloudflare outage hits thousands of sites again', url: 'javascript:alert(1)' });
  const data = newsItem({ title: 'Another Cloudflare outage hits a lot of sites', url: 'data:text/html,<script>alert(1)</script>' });
  const { report, latest } = await go(root, '2026-11-16T22:00:00Z', [feed([evil, js, data])]);
  assert.equal(report.dropped['bad-link'], 2);
  assert.equal(latest.stories.length, 1);
  const [s] = latest.stories;
  assert.equal(s.title, '<script>alert("x")</script> Cloudflare outage knocks sites offline');
  assert.equal(s.source, '<b>Evil</b> Daily');
  assert.equal(s.url, 'https://example.com/x?a=1&b=2');
  assert.ok(!/[\u0000-\u001f\u007f-\u009f‮]/.test(JSON.stringify(s).replace(/\\u[0-9a-f]{4}/gi, 'X')));
  for (const [rel, text] of snapshot(root)) assert.ok(!/javascript:|data:text/.test(text), `${rel} must not hold an unsafe link`);
});

test('reasons for every drop are counted', async () => {
  const root = tmpRoot();
  const now = '2026-11-16T22:00:00Z';
  const items = [
    newsItem({ title: 'Cloudflare outage knocks thousands of sites offline' }),
    newsItem({ title: 'Old Cloudflare outage story from days ago', publishedAt: Date.parse('2026-11-10T00:00:00Z'), url: 'https://example.com/old' }),
    newsItem({ title: 'Hi', url: 'https://example.com/short' }),
    newsItem({ title: 'Weekend recipes for a cozy night in', url: 'https://example.com/recipes' }),
    newsItem({ title: 'Gunman killed after outage at the station', url: 'https://example.com/g' }),
    newsItem({ title: 'Trump says the outage was sabotage', url: 'https://example.com/t' }),
    newsItem({ title: 'No link outage story at the airport', url: '' }),
  ];
  const { report } = await go(root, now, [feed(items)]);
  assert.equal(report.keptCount, 1);
  assert.equal(report.dropped.old, 1);
  assert.equal(report.dropped['too-short'], 1);
  assert.equal(report.dropped['off-topic'], 1);
  assert.equal(report.dropped['excluded:death'], 1);
  assert.equal(report.dropped['excluded:politics'], 1);
  assert.equal(report.dropped['bad-link'], 1);
  assert.equal(report.headlinesRead, 7);
});

test('the same story from two sources is one story with two outlets', async () => {
  const root = tmpRoot();
  const a = newsItem({ title: 'Cloudflare outage knocks thousands of sites offline', source: 'Pub A', url: 'https://a.example/1' });
  const b = newsItem({ title: 'Cloudflare outage knocks thousands of sites offline', source: 'Pub B', url: 'https://b.example/1', via: 'bing' });
  const { latest } = await go(root, '2026-11-16T22:00:00Z', [feed([a], 'google'), feed([b], 'bing')]);
  assert.equal(latest.stories.length, 1);
  assert.equal(latest.stories[0].outlets, 2);
  assert.deepEqual(latest.stories[0].outletNames.sort(), ['Pub A', 'Pub B']);
});

test('the score, yesterday, change and the record day across three days', async () => {
  const root = tmpRoot();
  const early = { config: { ...cfg, firstEdition: '2026-11-01' } }; // days before the real first edition
  // One story per category per day, run by three outlets. Titles differ from day to day on purpose:
  // the same story seen again on a later day belongs to the day it was first seen.
  const story3 = (title, at, cat) =>
    PUBS.map((source, i) => newsItem({ cat, title, source, url: `https://pub${i}.example/${title.toLowerCase().replace(/[^a-z]+/g, '-')}`, publishedAt: Date.parse(at) }));
  const day14 = (at) => [
    ...story3('Cloudflare outage knocks thousands of sites offline', at, 'internet'),
    ...story3('Rolling blackouts hit regional grid as demand spikes', at, 'grid'),
    ...story3('Flights grounded at Newark after system glitch', at, 'flights'),
    ...story3('Stocks plunge in sudden flash crash', at, 'markets'),
  ];
  const day15 = (at) => [...story3('Slack is down for users across the US', at, 'internet'), ...story3('Blackout hits city after substation failure', at, 'grid')];
  const day16 = (at) => [
    ...story3('Major AWS outage disrupts popular apps', at, 'internet'),
    ...story3('Power outage leaves 50,000 customers in the dark', at, 'grid'),
    ...story3('Hackers breach customer database at retailer', at, 'hacks'),
  ];
  const r14 = await go(root, '2026-11-14T20:00:00Z', [feed(day14('2026-11-14T15:00:00Z'))], early);
  assert.equal(r14.latest.score, 24);
  assert.equal(r14.latest.yesterday, null);
  assert.equal(r14.latest.change, null);
  assert.deepEqual(r14.latest.record, { date: '2026-11-14', score: 24 });

  const r15 = await go(root, '2026-11-15T20:00:00Z', [feed(day15('2026-11-15T15:00:00Z'))], early);
  assert.equal(r15.latest.score, 12);
  assert.deepEqual(r15.latest.yesterday, { date: '2026-11-14', score: 24, fired: ['flights', 'internet', 'markets', 'grid'] });
  assert.equal(r15.latest.change, 12 - 24);

  const r16 = await go(root, '2026-11-16T20:00:00Z', [feed(day16('2026-11-16T15:00:00Z'))], early);
  assert.equal(r16.latest.score, 18);
  assert.deepEqual(r16.latest.fired, ['hacks', 'internet', 'grid']);
  assert.equal(r16.latest.yesterday.date, '2026-11-15');
  assert.equal(r16.latest.yesterday.score, 12);
  assert.equal(r16.latest.change, 6);
  assert.deepEqual(r16.latest.record, { date: '2026-11-14', score: 24 });

  const index = readJson(path.join(root, 'data', 'days.json'));
  assert.deepEqual(index.map((e) => [e.date, e.score]), [['2026-11-16', 18], ['2026-11-15', 12], ['2026-11-14', 24]]);
  assert.ok(index[0].top && index[0].top.title && index[0].top.url);
  assert.equal(readJson(dayPath(root, '2026-11-14')).stories.length, 4, 'the 14th keeps exactly what was seen on the 14th');
});

test('nothing before the first edition is written or kept, and launch day has no yesterday', async () => {
  const root = tmpRoot();
  // An earlier run left a file for the day before launch, with its own index line.
  fs.mkdirSync(path.join(root, 'data', 'days'), { recursive: true });
  fs.writeFileSync(
    dayPath(root, '2026-11-15'),
    JSON.stringify({ date: '2026-11-15', score: 68, fired: ['grid'], bumps: [], stories: [], updatedAt: '2026-11-15T12:00:00.000Z' }),
  );
  fs.writeFileSync(path.join(root, 'data', 'days.json'), JSON.stringify([{ date: '2026-11-15', score: 68, fired: ['grid'], top: null, cats: {} }]));

  // The launch day itself, with a story published late the evening before.
  const late = newsItem({ cat: 'grid', title: 'Blackout hits city after substation failure', source: 'Pub A', url: 'https://a.example/late', publishedAt: Date.parse('2026-11-16T03:30:00Z') });
  const { latest } = await go(root, '2026-11-16T15:00:00Z', [feed([...cat3('internet', '2026-11-16T14:00:00Z'), late])]);
  assert.equal(fs.existsSync(dayPath(root, '2026-11-15')), false, 'the day before launch is deleted');
  assert.equal(fs.existsSync(dayPath(root, '2026-11-14')), false);
  assert.deepEqual(readJson(path.join(root, 'data', 'days.json')).map((e) => e.date), ['2026-11-16']);
  assert.equal(latest.yesterday, null);
  assert.equal(latest.change, null);
  assert.deepEqual(latest.record, { date: '2026-11-16', score: latest.score });
});

test('a story published before the first edition day is not filed under a day we never published', async () => {
  const root = tmpRoot();
  const evening = cat3('grid', '2026-11-16T04:30:00Z'); // 11:30 pm on the 15th in New York
  const { latest, report } = await go(root, '2026-11-16T15:00:00Z', [feed([...evening, ...cat3('internet', '2026-11-16T14:00:00Z')])]);
  assert.equal(fs.existsSync(dayPath(root, '2026-11-15')), false);
  assert.ok(latest.stories.every((s) => s.cat === 'internet'));
  assert.equal(report.outOfWindow, 3);
});

test('instruments fire their categories and add their fixed bumps, and a big quake gets a quiet card', async () => {
  const root = tmpRoot();
  const now = new Date('2026-11-16T22:30:00Z');
  const quake = usgs.parseUsgs(fixtureJson('usgs.json'), { minMag: 6 });
  const stop = faa.parseFaa(fixture('faa-stops.xml'), cfg.faa);
  const rock = jpl.parseCad(fixtureJson('jpl.json'), now, cfg.signals);
  const sources = [
    fakeSource('usgs', { count: 1, vital: { quake: quake.vital }, signals: quake.signals }),
    fakeSource('faa', { count: 2, vital: { faa: faa.faaVital(stop) }, signals: faa.faaSignals(stop, now.getTime()) }),
    fakeSource('jpl', { count: 1, vital: { asteroid: rock.vital }, signals: rock.signals }),
  ];
  const { latest } = await go(root, now.toISOString(), sources);
  assert.deepEqual(latest.fired, ['flights', 'space', 'earth']);
  assert.equal(latest.score, 6 * 3 + 5 + 15 + 6);
  assert.deepEqual(latest.bumps.map((b) => b.key).sort(), ['asteroid', 'faa', 'quake']);
  const q = latest.stories.find((s) => s.signal?.type === 'quake');
  assert.equal(q.quiet, true);
  assert.equal(q.quietReason, 'quake M6.5 or more');
  assert.equal(latest.vital.quake.mag, 6.6);
  assert.equal(latest.vital.faa.groundStops.length, 2);
  assert.equal(latest.vital.asteroid.des, '2026 WA');
  assert.equal(latest.vital.clock.secondsToMidnight, 85);
});

test('a failed instrument shows its last good reading, marked stale, then gives up after its window', async () => {
  const now = '2026-11-16T22:30:00Z';
  const vital = { mag: 6.1, place: 'Somewhere', time: '2026-11-16T10:00:00.000Z', url: 'https://example.com/q', pager: null, tsunami: false };
  const seed = (lastOkAt) => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, 'data', 'state'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data', 'state', 'sources.json'), JSON.stringify({ usgs: { ok: true, count: 1, error: null, lastTryAt: lastOkAt, lastOkAt, vital: { quake: vital } } }));
    return root;
  };
  const lastOk = '2026-11-16T20:30:00.000Z';
  const fresh = await go(seed(lastOk), now, [failingSource('usgs')]);
  assert.deepEqual(fresh.latest.vital.quake, { ...vital, stale: true, staleSince: lastOk });
  const old = '2026-11-15T10:00:00.000Z';
  const gone = await go(seed(old), now, [failingSource('usgs')]);
  assert.deepEqual(gone.latest.vital.quake, { unavailable: true, stale: true, staleSince: old });
  const never = await go(tmpRoot(), now, [failingSource('usgs')]);
  assert.equal(never.latest.vital.quake, null);
  const ok = await go(seed(lastOk), now, [fakeSource('usgs', { vital: { quake: { ...vital, mag: 5.2 } } })]);
  assert.equal(ok.latest.vital.quake.mag, 5.2);
  assert.ok(!('stale' in ok.latest.vital.quake));
});

test('quiet mode in latest.json: an ordinary day, an automatic trip with its hold, and the manual switch', async () => {
  const root = tmpRoot();
  const ordinary = fixtureJson('top-stories-ordinary.json').titles;
  const top = (titles, via = 'google-top-stories') => fakeSource('topstories', { count: titles.length, via, titles });

  const calm = await go(root, '2026-11-16T22:00:00Z', [top(ordinary)]);
  assert.equal(calm.latest.quiet.quiet, false);
  assert.equal(calm.latest.quiet.auto.checked, true);
  assert.equal(calm.latest.quiet.auto.via, 'google-top-stories');
  assert.equal(calm.latest.quiet.auto.headlines, 30);
  assert.equal(calm.latest.quiet.auto.matched, 0);
  assert.equal(calm.latest.quiet.auto.tripped, false);

  const bad = ['Mass shooting at a mall leaves dozens dead', 'Death toll rises after the attack', 'Officials call it a massacre', ...ordinary.slice(0, 20)];
  const tripped = await go(root, '2026-11-16T22:15:00Z', [top(bad)]);
  assert.equal(tripped.latest.quiet.quiet, true);
  assert.equal(tripped.latest.quiet.why, 'auto');
  assert.match(tripped.latest.quiet.reason, /3 of the top 23 headlines match mass-casualty terms/);
  assert.equal(tripped.latest.quiet.auto.matches.length, 3);
  assert.ok(readJson(path.join(root, 'data', 'state', 'quiet.json')).holdUntil);

  const held = await go(root, '2026-11-17T00:15:00Z', [top(ordinary)]);
  assert.equal(held.latest.quiet.quiet, true);
  assert.equal(held.latest.quiet.why, 'hold');
  const released = await go(root, '2026-11-17T05:00:00Z', [top(ordinary)]);
  assert.equal(released.latest.quiet.quiet, false);

  fs.writeFileSync(path.join(root, 'quiet.json'), '{"quiet": true, "note": "A hard day"}');
  const manual = await go(root, '2026-11-17T05:15:00Z', [top(ordinary)]);
  assert.equal(manual.latest.quiet.quiet, true);
  assert.equal(manual.latest.quiet.why, 'manual');
  assert.equal(manual.latest.quiet.note, 'A hard day');

  fs.writeFileSync(path.join(root, 'quiet.json'), '{ nope');
  const broken = await go(root, '2026-11-17T05:30:00Z', [top(ordinary)]);
  assert.equal(broken.latest.quiet.quiet, true, 'a broken switch means quiet');
  assert.match(broken.latest.quiet.reason, /not valid JSON/);
});

test('quiet mode: when the check cannot run, latest.json says so', async () => {
  const { latest } = await go(tmpRoot(), '2026-11-16T22:00:00Z', [failingSource('topstories', 'google-top-stories: HTTP 429; bbc-top-stories: HTTP 503')]);
  assert.equal(latest.quiet.quiet, false);
  assert.equal(latest.quiet.auto.checked, false);
  assert.match(latest.quiet.auto.error, /429/);
  assert.match(formatSummary((await go(tmpRoot(), '2026-11-16T22:00:00Z', [failingSource('topstories', 'down')])).report), /auto check unavailable \(down\)/);
});

test('a run with nothing new changes only timestamps', async () => {
  const root = tmpRoot();
  const sources = [feed(cat3('internet', '2026-11-16T20:00:00Z')), fakeSource('usgs', { vital: { quake: { mag: 5.2, place: 'X', time: '2026-11-16T10:00:00.000Z', url: 'https://example.com', pager: null, tsunami: false } } })];
  await go(root, '2026-11-16T22:00:00Z', sources);
  const a = snapshot(root);
  await go(root, '2026-11-16T22:15:00Z', sources);
  const b = snapshot(root);
  assert.deepEqual([...b.keys()].sort(), [...a.keys()].sort());
  for (const [rel, text] of a) {
    if (b.get(rel) === text) continue;
    assert.ok(sameWithoutVolatile(rel.split(path.sep).join('/'), JSON.parse(text), JSON.parse(b.get(rel))), `${rel} changed by more than timestamps`);
  }
  assert.equal(a.get(path.join('data', 'days', '2026-11-16.json')), b.get(path.join('data', 'days', '2026-11-16.json')));
  assert.equal(a.get(path.join('data', 'days.json')), b.get(path.join('data', 'days.json')));
});

test('a corrupt day file stops the run and is left as it was', async () => {
  const root = tmpRoot();
  fs.mkdirSync(path.dirname(dayPath(root, '2026-11-16')), { recursive: true });
  fs.writeFileSync(dayPath(root, '2026-11-16'), '{ this is not json');
  await assert.rejects(go(root, '2026-11-16T22:00:00Z', [feed(cat3('internet', '2026-11-16T20:00:00Z'))]), /Corrupt JSON/);
  assert.equal(fs.readFileSync(dayPath(root, '2026-11-16'), 'utf8'), '{ this is not json');
});

test('a damaged state file does not stop a run', async () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'data', 'state'), { recursive: true });
  for (const f of ['sources.json', 'x.json', 'quiet.json']) fs.writeFileSync(path.join(root, 'data', 'state', f), '%%%');
  fs.writeFileSync(path.join(root, 'data', 'latest.json'), '%%%');
  const { latest } = await go(root, '2026-11-16T22:00:00Z', [feed(cat3('internet', '2026-11-16T20:00:00Z'))]);
  assert.equal(latest.stories.length, 3);
});

test('item 16: when the last 24 hours are empty the page keeps the latest stories, but they never count toward the score', async () => {
  const root = tmpRoot();
  const old = [...cat3('internet', '2026-11-16T20:00:00Z'), ...cat3('grid', '2026-11-16T20:00:00Z')];
  const first = await go(root, '2026-11-16T22:00:00Z', [feed(old)]);
  assert.equal(first.latest.score, 12, 'two fired categories while they are fresh');
  const { latest, report } = await go(root, '2026-11-18T03:00:00Z', [failingSource('google')]);
  assert.equal(latest.rollingFallback, true);
  assert.equal(latest.stories.length, 6, 'the list is not empty');
  assert.equal(latest.score, 11, 'the floor: old stories are not news from today');
  assert.deepEqual(latest.fired, []);
  assert.deepEqual(latest.bumps, []);
  assert.equal(readJson(dayPath(root, '2026-11-17')).score, 11, 'today\'s file says the same');
  assert.match(formatSummary(report), /none that new, so the latest are shown and not scored/);
  const again = await go(root, '2026-11-18T03:15:00Z', [feed([])]);
  assert.equal(again.latest.rollingFallback, true);
  assert.equal(again.latest.score, 11);
});

test('the run summary lists every source, the drops, the score and the quiet check', async () => {
  const { report } = await go(tmpRoot(), '2026-11-16T22:00:00Z', [feed(cat3('internet', '2026-11-16T20:00:00Z')), failingSource('bing', 'HTTP 429')]);
  const text = formatSummary(report);
  assert.match(text, /^update 2026-11-16 17:00 ET/);
  assert.match(text, /google\s+ok\s+3/);
  assert.match(text, /bing\s+FAIL\s+0\s+HTTP 429/);
  assert.match(text, /read 3 headlines, kept 3, dropped: none/);
  assert.match(text, /doom 11, fired: internet/);
  assert.match(text, /quiet: off; auto check unavailable/);
  assert.match(formatVerbose(report), /KEPT[\s\S]*internet \(3\)[\s\S]*DROPPED/);
});

// ---- the real sources, end to end, with a pretend internet ----------------

function pretendInternet() {
  const top = `<?xml version="1.0"?><rss version="2.0"><channel><title>Top</title>${fixtureJson('top-stories-ordinary.json').titles.map((t, i) => `<item><title>${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title><link>https://example.com/${i}</link></item>`).join('')}</channel></rss>`;
  return mockFetch([
    ['news.google.com/rss/search', () => ({ body: fixture('google.xml') })],
    ['news.google.com/rss?', () => ({ body: top })],
    ['bing.com/news/search', () => ({ body: fixture('bing.xml') })],
    ['gdeltproject.org', () => ({ body: fixture('gdelt.json') })],
    ['hn.algolia.com', () => ({ body: fixture('hn.json') })],
    ['earthquake.usgs.gov', () => ({ body: fixture('usgs.json') })],
    ['noaa-planetary-k-index', () => ({ body: fixture('kp-array.json') })],
    ['swpc.noaa.gov/products/alerts.json', () => ({ body: fixture('alerts.json') })],
    ['ssd-api.jpl.nasa.gov', () => ({ body: fixture('jpl.json') })],
    ['nasstatus.faa.gov', () => ({ body: fixture('faa-stops.xml') })],
    ['trends.google.com', () => ({ body: fixture('trends.xml') })],
    ['githubstatus.com', () => ({ body: fixture('status-major.json') })],
    [/status/, () => ({ body: fixture('status-none.json') })],
  ]);
}

test('end to end with the real sources reading fixtures: every source answers, the score is in range, nothing is blank', async () => {
  const root = tmpRoot();
  const m = pretendInternet();
  const http = createHttp({ fetchImpl: m.fetch, sleep: noSleep });
  const { latest, report } = await runUpdate({ root, now: '2026-11-16T22:30:00Z', env: {}, http });
  for (const r of report.results) assert.ok(r.ok, `${r.id}: ${r.error}`);
  assert.equal(latest.sources.x.ok, true);
  assert.equal(latest.sources.trends.ok, true);
  assert.equal(report.results.find((r) => r.id === 'trends').count, 29, 'the sample feed has 29 news stories');
  assert.deepEqual(latest.x, { enabled: false, skipped: 'off' });
  assert.ok(latest.score >= 11 && latest.score <= 99);
  for (const cat of ['flights', 'space', 'sun', 'earth', 'internet']) assert.ok(latest.fired.includes(cat), `${cat} should fire from its instrument`);
  assert.ok(latest.score >= 6 * 5 + 5 + 15 + 6 + 5 + 8);
  assert.equal(latest.quiet.auto.checked, true);
  assert.equal(latest.quiet.auto.tripped, false);
  assert.equal(latest.quiet.quiet, false);
  assert.ok(latest.headlinesRead > 10);
  const text = JSON.stringify(latest);
  for (const bad of ['undefined', 'NaN', '[object', 'null,null']) assert.ok(!text.includes(bad), bad);
  assert.ok(m.calls.every((c) => c.headers['user-agent'] === 'didtheworldendtoday.com (news aggregator)'));
  assert.ok(m.calls.every((c) => !c.headers.authorization), 'no bearer header goes anywhere without a token');
  assert.ok(!m.calls.some((c) => /api\.x\.com/.test(c.url)), 'X is never contacted without a token');
});

test('end to end with every real source getting a 404: the run still finishes and writes valid files', async () => {
  const root = tmpRoot();
  const m = mockFetch([[/./, () => ({ status: 404, body: 'nope' })]]);
  const http = createHttp({ fetchImpl: m.fetch, sleep: noSleep });
  const { latest, report } = await runUpdate({ root, now: '2026-11-16T22:30:00Z', env: {}, http });
  assert.equal(latest.score, 11);
  assert.deepEqual(latest.stories, []);
  assert.equal(report.results.filter((r) => !r.ok).length, report.results.length - 1, 'every source failed except X, which is off');
  assert.ok(report.results.every((r) => !r.crashed));
  assert.equal(latest.quiet.auto.checked, false);
  assert.equal(latest.vital.quake, null);
  assert.match(formatSummary(report), /FAIL/);
});

// ---- X posts in the run's summary ----------------------------------------------------------------------------------
test('summary: one line says what became of the X posts, the drops listed with their reason, and nothing when there were none', () => {
  const kept = [{ kind: 'x', title: 'User reports indicate problems at Apple since 12:20 PM EST.' }, { kind: 'news', title: 'A headline' }];
  const droppedList = [
    { reason: 'excluded:violence', detail: 'shooting', via: 'x', title: 'BREAKING: Shooting at a mall', source: '@BNONews on X' },
    { reason: 'off-topic', detail: null, via: 'google', title: 'Not from X', source: 'Example News' },
  ];
  const own = { kind: 'x', outletNames: ['@DownDetector on X'] };
  const inside = { kind: 'news', outletNames: ['Reuters', '@AP on X'] };
  const plain = { kind: 'news', outletNames: ['Reuters'] };
  const t = xTrace(kept, droppedList, [own, inside, plain], [inside, plain]);
  assert.deepEqual({ ...t, dropped: t.dropped.length }, { passed: 1, dropped: 1, inAll: 2, onList: 1 });
  const base = { now: '2026-11-17T21:00:00.000Z', results: [], headlinesRead: 0, keptCount: 0, dropped: {}, cleaned: {}, rollingCount: 0, score: 0, fired: [], quiet: { quiet: false, auto: { checked: false, error: 'x' } } };
  const lines = formatSummary({ ...base, xTrace: t }).split('\n');
  assert.ok(lines.includes("  x posts: 1 passed the filters, 1 dropped; stories that hold one: 2 in all, 1 in today's list"));
  assert.ok(lines.includes('    dropped excluded:violence [shooting]: BREAKING: Shooting at a mall'));
  assert.ok(!formatSummary({ ...base, xTrace: xTrace([], [], [], []) }).includes('x posts'), 'no X posts, no line');
});

// ---- X posts reach the day file ----------------------------------------------------------------------------------
test('X posts reach the day file, and the next run keeps them, whether their own headline or their keyword filed them', async () => {
  const root = tmpRoot();
  const handles = { 110: 'DownDetector', 101: 'BNONews', 102: 'spectatorindex' };
  const posts = [
    { id: '8001', author_id: '110', created_at: '2026-11-17T20:40:00.000Z', text: 'User reports indicate problems with Uber since 3:24 PM EST. How is it affecting you? #Uber https://t.co/uber0001' },
    { id: '8003', author_id: '101', created_at: '2026-11-17T20:45:00.000Z', text: 'Classified US national security communications network hit by outage, NSA says https://t.co/nsa00001' },
    { id: '8004', author_id: '102', created_at: '2026-11-17T20:50:00.000Z', text: 'Transportation Secretary Sean Duffy says federal intelligence agencies have ruled out a cyberattack as the cause of the outage' },
  ];
  const xFeed = (items) => fakeSource('x', { enabled: true, count: items.length, items });
  const news = feed(cat3('flights', '2026-11-17T19:00:00Z'));

  const first = await go(root, '2026-11-17T21:00:00Z', [news, xFeed(xsrc.postsToItems(posts, handles, cfg.x))]);
  assert.equal(first.report.xTrace.passed, 2);
  assert.deepEqual(first.report.xTrace.dropped.map((d) => d.reason), ['excluded:politics']);
  const posted = (root) => readJson(dayPath(root, '2026-11-17')).stories.filter((s) => s.kind === 'x').map((s) => [s.cat, s.title]).sort();
  const expected = [
    ['internet', 'Classified US national security communications network hit by outage, NSA says'],
    ['internet', 'User reports indicate problems with Uber since 3:24 PM EST.'],
  ];
  assert.deepEqual(posted(root), expected);

  // An hour on, X has nothing new. The stored posts are checked again by the current rules and stay.
  const second = await go(root, '2026-11-17T22:05:00Z', [news, xFeed([])]);
  assert.deepEqual(second.report.cleaned, {});
  assert.deepEqual(posted(root), expected);
  assert.equal(second.report.xTrace.inAll, 2);
});

// ---- one story per outage ----------------------------------------------------------------------------------------
test('Downdetector posts about different services are different stories in the day file, and the next run keeps them apart', async () => {
  const root = tmpRoot();
  const handles = { 110: 'DownDetector' };
  const dd = (id, service, since, at) => ({ id, author_id: '110', created_at: at, text: `User reports indicate problems with ${service} since ${since} EST. How is it affecting you? #${service.replace(/ /g, '')}` });
  const posts = [
    dd('8201', 'Uber', '3:24 PM', '2026-11-17T20:30:00.000Z'),
    dd('8202', 'Roblox', '3:20 PM', '2026-11-17T20:26:00.000Z'),
    dd('8203', 'Microsoft 365', '10:02 AM', '2026-11-17T15:10:00.000Z'),
    dd('8204', 'Apple Music', '12:00 PM', '2026-11-17T17:05:00.000Z'),
  ];
  const xFeed = (items) => fakeSource('x', { enabled: true, count: items.length, items });
  const news = feed(cat3('flights', '2026-11-17T19:00:00Z'));
  const posted = () => readJson(dayPath(root, '2026-11-17')).stories.filter((s) => s.kind === 'x').map((s) => s.url).sort();
  const expected = posts.map((p) => `https://x.com/DownDetector/status/${p.id}`).sort();

  const first = await go(root, '2026-11-17T21:52:00Z', [news, xFeed(xsrc.postsToItems(posts, handles, cfg.x))]);
  assert.equal(first.report.xTrace.passed, 4);
  assert.deepEqual(posted(), expected, 'four stories, each with its own post');
  assert.equal(first.report.xTrace.onList, 4);

  const second = await go(root, '2026-11-17T23:00:00Z', [news, xFeed([])]);
  assert.deepEqual(posted(), expected, 'stored side by side, none takes in another');
  assert.equal(second.report.xTrace.inAll, 4);
});

// ---- a post that joins a news story ------------------------------------------------------------------------------
test('an X post that joins a news story leaves its link on the story in the day file and in latest.json, and every later run keeps it', async () => {
  const root = tmpRoot();
  const title = 'Cloudflare outage knocks thousands of sites offline';
  const news = newsItem({ cat: 'internet', title, source: 'Reuters', url: 'https://reuters.example/cloudflare', publishedAt: Date.parse('2026-11-17T19:00:00Z') });
  const posts = [{ id: '7001', author_id: '105', created_at: '2026-11-17T19:30:00.000Z', text: title }];
  const xFeed = (items) => fakeSource('x', { enabled: true, count: items.length, items });
  const day = () => readJson(dayPath(root, '2026-11-17')).stories;

  // The news is stored first, with no post to link.
  await go(root, '2026-11-17T19:40:00Z', [feed([news])]);
  assert.equal(day().length, 1);
  assert.ok(!('xUrl' in day()[0]));

  // An hour on, AP posts the same headline. It joins the story: the news link stays the story's, and the post's link is kept beside it.
  const joined = await go(root, '2026-11-17T20:45:00Z', [feed([news]), xFeed(xsrc.postsToItems(posts, { 105: 'AP' }, cfg.x))]);
  assert.equal(joined.report.xTrace.passed, 1);
  assert.equal(day().length, 1, 'one story, not two');
  const [story] = day();
  assert.equal(story.url, 'https://reuters.example/cloudflare');
  assert.deepEqual(story.outletNames, ['Reuters', '@AP on X']);
  assert.equal(story.xUrl, 'https://x.com/AP/status/7001');
  assert.equal(latestOf(root).stories[0].xUrl, 'https://x.com/AP/status/7001', 'latest.json has it too');

  // The post leaves X's window and a later run reads the story back from the file: the link is still there, the story the same.
  await go(root, '2026-11-17T22:05:00Z', [feed([news]), xFeed([])]);
  assert.deepEqual(day(), [story]);
  await go(root, '2026-11-17T23:10:00Z', [feed([]), xFeed([])]);
  assert.equal(JSON.stringify(day()[0]), JSON.stringify(story), 'byte for byte, key order included');

  // A bad link in the file is dropped when the story is read back.
  const file = readJson(dayPath(root, '2026-11-17'));
  file.stories[0].xUrl = 'https://example.com/AP/status/7001';
  fs.writeFileSync(dayPath(root, '2026-11-17'), JSON.stringify(file));
  await go(root, '2026-11-17T23:40:00Z', [feed([]), xFeed([])]);
  assert.ok(!('xUrl' in day()[0]));
});
