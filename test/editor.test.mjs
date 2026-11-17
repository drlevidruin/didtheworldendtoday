// The editor (npm run edit): it writes today's edition with the Claude API and never
// fails a run. Every case here uses a fake client, so nothing leaves the machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  config,
  EDITOR_BIG_SENT_MAX,
  EDITOR_BREAKING_GAP_MINUTES,
  EDITOR_BREAKING_MAX,
  EDITOR_BREAKING_NEW_HOURS,
  EDITOR_BREAKING_OUTLETS,
  EDITOR_BREAKING_RESERVE_USD,
  EDITOR_BREAKING_SIGNAL_SCORE,
  EDITOR_BREAKING_TRENDING,
  EDITOR_COST_GUESS,
  EDITOR_DAILY_BUDGET_USD,
  EDITOR_DAILY_CAP,
  EDITOR_FRESH_HOURS,
  EDITOR_FRESH_MAX,
  EDITOR_MAX_STORIES,
  EDITOR_MIN_GAP_MINUTES,
  EDITOR_MODEL,
  EDITOR_NIGHT_END_HOUR,
  EDITOR_NIGHT_GAP_MINUTES,
  EDITOR_PRICES,
} from '../scripts/config.mjs';
import { createGatekeeper } from '../scripts/lib/pipeline.mjs';
import { listingOrder, publishableStories, validateEdition } from '../scripts/lib/editions.mjs';
import { EDITOR_SYSTEM_PROMPT } from '../scripts/lib/editor-prompt.mjs';
import { EDITION_SCHEMA, askEditor, costOf, hoursAgo, isBig, newestAt, pickStories, regularPlan, runEditor, startedHoursAgo, toldBefore } from '../scripts/editor.mjs';
import { readJson, REPO, tmpRoot } from './helpers.mjs';

const cfg = config();
const { excluder } = createGatekeeper(cfg);
const EM = String.fromCharCode(0x2014);
const DATE = '2026-11-17';
const NOW = '2026-11-17T15:00:00.000Z'; // 10:00 am Eastern
const KEY = 'sk-ant-test-0123456789';

// ---- the day, the folders and the fake client ----------------------------------------------

const story = (id, cat, title, over = {}) => ({
  id,
  kind: 'news',
  cat,
  title,
  url: `https://pub.example/${id}`,
  source: 'Pub A',
  publishedAt: '2026-11-17T12:00:00.000Z',
  firstSeenAt: '2026-11-17T12:00:00.000Z',
  outlets: 4,
  outletNames: ['Pub A', 'Pub B', 'Pub C', 'Pub D'],
  score: 50,
  ...over,
});

// A signal's score is its severity (3.5 to 10), not a news rank: a quake of 6.6 scores 4.5, and from 5 up a signal is big news.
const QUAKE = story('sig:quake:q9', 'earth', 'M 6.6 - 148 km WSW of Tual, Indonesia', {
  kind: 'signal',
  source: 'USGS',
  outlets: 1,
  score: 4.5,
  quiet: true,
  signal: { type: 'quake', mag: 6.6, place: '148 km WSW of Tual, Indonesia', pager: 'orange', tsunami: false },
});

const dayStories = () => [
  story('s01', 'flights', 'United Airlines system outage delays departing flights', { score: 90, outlets: 12 }),
  story('s02', 'hacks', 'Chase online banking outage lasts for hours', { score: 88, outlets: 9 }),
  story('s03', 'internet', 'Cloudflare outage takes down thousands of websites', { score: 86, outlets: 7 }),
  story('s04', 'markets', 'Nasdaq falls into a correction after a tech sell-off', { score: 80 }),
  story('s05', 'space', 'Bus-sized asteroid passes between Earth and the Moon', { score: 78 }),
  story('s06', 'grid', 'Rolling blackouts hit regional grid as demand spikes', { score: 70 }),
  story('s07', 'ai', 'ChatGPT down for thousands of users', { score: 66 }),
  story('s08', 'weather', 'Freak hailstorm batters the valley', { score: 60 }),
  story('s09', 'animals', 'Three goats on the loose downtown', { score: 55 }),
  QUAKE,
];

// A story that is big news by its searches alone: 50000 Google searches. Its score is low on purpose, so it
// is not first in the page's order and "sent first" shows.
const trendingStory = (over = {}) => story('big1', 'internet', 'Apple outage knocks iCloud and the App Store offline', { score: 3, outlets: 3, trending: 50000, ...over });

// The same day with nothing the big news rules would pick, at any time of day. s01 and s02 are in 12 and 9
// outlets, and a story first seen at 12:00 UTC counts as just seen when the clock says 4 AM.
const calmDay = () => dayStories().map((st) => ({ ...st, outlets: Math.min(st.outlets, 4) }));

// A state file as the editor writes it, with today's date. Every test that makes a second call says where
// the first one stands.
const stateFor = (over = {}) => ({ date: DATE, calls: 1, usd: 0.09, lastWriteAt: null, lastIdsHash: 'older', lastCallAt: null, breakingCalls: 0, bigSent: [], ...over });

// An Eastern clock time on the 17th as an ISO instant. The 17th is winter time, UTC minus 5. An hour of 24
// or more is the next day.
const et = (hour, minute = 0) => new Date(Date.UTC(2026, 10, 17, hour + 5, minute)).toISOString();

function setup({ stories = dayStories(), editions = {}, state = null, quiet = null, latestQuiet = false } = {}) {
  const root = tmpRoot('dtwet-editor-');
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(path.join(dataDir, 'days'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'editions'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'state'), { recursive: true });
  const write = (rel, value) => fs.writeFileSync(path.join(root, rel), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  write('data/latest.json', { schema: 1, etDate: DATE, score: 62, quiet: { quiet: latestQuiet }, stories });
  if (stories) write(`data/days/${DATE}.json`, { date: DATE, score: 62, stories });
  for (const [date, edition] of Object.entries(editions)) write(`data/editions/${date}.json`, edition);
  if (state) write('data/state/editor.json', state);
  if (quiet !== null) write('quiet.json', quiet);
  return { root, dataDir, file: (rel) => path.join(root, rel), read: (rel) => fs.readFileSync(path.join(root, rel), 'utf8') };
}

// What a Claude client looks like to the editor. responder gets the request and the call number.
function fakeClient(responder) {
  const calls = [];
  const client = {
    calls,
    beta: {
      messages: {
        create: async (request) => {
          calls.push(request);
          return typeof responder === 'function' ? responder(request, calls.length) : responder;
        },
      },
    },
  };
  return client;
}

const answer = (body, extra = {}) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body) }],
  usage: { input_tokens: 1200, output_tokens: 300 },
  ...extra,
});

const GOOD = {
  date: DATE,
  headline: 'United planes sat late for an hour and a half. Still here.',
  items: [
    { emoji: '✈️', label: 'United outage', line: 'Systems down for an hour. Departures were delayed.', ids: ['s01'] },
    { emoji: '\u{1F3E6}', label: 'Chase banking', line: 'Online banking was down for hours on Monday.', ids: ['s02'] },
    { emoji: '\u{1F5A5}️', label: 'Cloudflare outage', line: 'Took thousands of sites down with it.', ids: ['s03', 's07'] },
    { emoji: '\u{1F4C9}', label: 'Nasdaq sell-off', line: 'Fell into a correction. It usually comes back.', ids: ['s04'] },
    { emoji: '☄️', label: 'Asteroid pass', line: 'Bus-sized, between Earth and the Moon. Missed.', ids: ['s05'] },
  ],
};
const withItems = (items, over = {}) => ({ ...GOOD, items, ...over });

// An edition the editor wrote earlier today, and the same one written by hand.
const OLD = {
  date: DATE,
  by: 'editor',
  writtenAt: '2026-11-17T09:00:00.000Z',
  headline: 'The old headline says one thing about the day. Still here.',
  items: ['s01', 's02', 's03'].map((id) => ({
    emoji: '\u{1F5A5}️',
    label: 'Old label',
    line: `The old line for ${id}.`,
    ids: [id],
    ...(id === 's01' ? { best: true } : {}),
    quiet: false,
    cat: 'internet',
    title: `Old title ${id}`,
    url: `https://pub.example/${id}`,
    source: 'Pub A',
    outlets: 4,
  })),
};

const HAND = { ...OLD, by: 'hand', headline: 'A hand written headline says one thing about the day. Still here.' };

const run = (s, client, over = {}) => {
  const lines = [];
  return runEditor({ client, now: NOW, dataDir: s.dataDir, env: { ANTHROPIC_API_KEY: KEY }, log: (l) => lines.push(l), config: cfg, ...over }).then((result) => ({ ...result, lines }));
};

const editionPath = (s, date = DATE) => path.join(s.dataDir, 'editions', `${date}.json`);
const stateOf = (s) => readJson(path.join(s.dataDir, 'state', 'editor.json'));
const listFiles = (dir) => fs.readdirSync(dir).sort();

// ---- when it does nothing ---------------------------------------------------------------------

test('editor: no key means no call, no file, and one line that says so', async () => {
  for (const env of [{}, { ANTHROPIC_API_KEY: '' }, { ANTHROPIC_API_KEY: '   ' }, { ANTHROPIC_API_KEY: undefined }]) {
    const s = setup();
    const client = fakeClient(answer(GOOD));
    const r = await run(s, client, { env });
    assert.equal(r.status, 'skipped', JSON.stringify(env));
    assert.equal(client.calls.length, 0, 'the API is not called');
    assert.deepEqual(r.lines, ['editor: no ANTHROPIC_API_KEY, so no edition written']);
    assert.deepEqual(listFiles(path.join(s.dataDir, 'editions')), []);
    assert.ok(!fs.existsSync(path.join(s.dataDir, 'state', 'editor.json')), 'no state either');
  }
});

test('editor: with no key the program exits 0 and says why, and an unusable folder never makes it fail', () => {
  const s = setup();
  const env = { ...process.env, DTWET_ROOT: s.root, DTWET_NOW: NOW, ANTHROPIC_API_KEY: '' };
  const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'editor.mjs')], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'editor: no ANTHROPIC_API_KEY, so no edition written');
  // a data folder that is not there at all: still one line, still exit 0
  const missing = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'editor.mjs')], { env: { ...env, DTWET_ROOT: path.join(s.root, 'nowhere'), ANTHROPIC_API_KEY: KEY }, encoding: 'utf8' });
  assert.equal(missing.status, 0, missing.stderr);
  assert.match(missing.stdout.trim(), /^editor: /);
  assert.equal(missing.stdout.trim().split('\n').length, 1);
  assert.ok(!missing.stdout.includes(KEY) && !missing.stderr.includes(KEY), 'the key is never printed');
  // and the package script is the program
  assert.equal(readJson(path.join(REPO, 'package.json')).scripts.edit, 'node scripts/editor.mjs');
});

test('editor: quiet mode, by the switch or by the automatic check, means no call', async () => {
  const cases = [
    ['the switch', { quiet: '{"quiet": true, "note": ""}\n' }],
    ['the automatic check', { latestQuiet: true }],
    ['a switch nobody can read', { quiet: '{ "quiet": true, }' }],
    ['a switch with no setting', { quiet: '{"note": "hi"}' }],
  ];
  for (const [name, opts] of cases) {
    const s = setup(opts);
    const client = fakeClient(answer(GOOD));
    const r = await run(s, client);
    assert.equal(r.status, 'skipped', name);
    assert.equal(client.calls.length, 0, name);
    assert.deepEqual(r.lines, ['editor: quiet mode is on, so no edition written'], name);
    assert.deepEqual(listFiles(path.join(s.dataDir, 'editions')), [], name);
  }
  // an explicit false is the only way back
  const s = setup({ quiet: '{"quiet": false, "note": ""}' });
  const client = fakeClient(answer(GOOD));
  assert.equal((await run(s, client)).status, 'written');
});

test('editor: after the daily cap of 20 calls it stops, and a new day starts at zero', async () => {
  assert.equal(EDITOR_DAILY_CAP, 20);
  assert.equal(cfg.editor.dailyCap, 20);
  const s = setup({ state: { date: DATE, calls: EDITOR_DAILY_CAP, usd: 0.5, lastWriteAt: null, lastIdsHash: null } });
  const client = fakeClient(answer(GOOD));
  const r = await run(s, client);
  assert.equal(r.status, 'skipped');
  assert.equal(client.calls.length, 0);
  assert.match(r.lines[0], /already called the API 20 times today \(the cap is 20\)/);
  // one call under the cap still goes through
  const under = setup({ state: { date: DATE, calls: EDITOR_DAILY_CAP - 1, usd: 0.5, lastWriteAt: null, lastIdsHash: null } });
  const last = fakeClient(answer(GOOD));
  assert.equal((await run(under, last)).status, 'written');
  assert.equal(stateOf(under).calls, EDITOR_DAILY_CAP);
  // yesterday's count does not carry over
  const fresh = setup({ state: { date: '2026-11-16', calls: EDITOR_DAILY_CAP, usd: 1.4, lastWriteAt: '2026-11-16T22:00:00.000Z', lastIdsHash: 'abc' } });
  const next = fakeClient(answer(GOOD));
  assert.equal((await run(fresh, next)).status, 'written');
  assert.deepEqual(stateOf(fresh).calls, 1);
  assert.equal(stateOf(fresh).date, DATE);
  // the cap counts calls, successful or not: three calls with a cap of two, two hours apart so no gap is in the way
  const small = { ...cfg, editor: { ...cfg.editor, dailyCap: 2 } };
  const t = setup();
  const failing = fakeClient(() => answer('not json'));
  const days = [dayStories(), [...dayStories(), story('s10', 'hacks', 'Retailer confirms security incident after passwords leak')], [...dayStories(), story('s10', 'hacks', 'Retailer confirms security incident after passwords leak'), story('s11', 'grid', 'Thousands without power after substation failure')]];
  const lines = [];
  for (const [i, stories] of days.entries()) {
    fs.writeFileSync(path.join(t.dataDir, 'days', `${DATE}.json`), JSON.stringify({ date: DATE, score: 62, stories }));
    lines.push((await run(t, failing, { config: small, now: et(10 + 2 * i) })).status);
  }
  assert.deepEqual(lines, ['kept', 'kept', 'skipped'], 'two failed calls use up a cap of two');
  assert.equal(failing.calls.length, 2);
  assert.equal(stateOf(t).calls, 2);
});

// ---- when a regular call may happen: the clock gap, the pacing and the money --------------------------------

test('editor: the gaps, the reserve and the big news numbers are in the config, and reach cfg.editor', () => {
  assert.equal(EDITOR_MIN_GAP_MINUTES, 60);
  assert.equal(EDITOR_NIGHT_GAP_MINUTES, 180);
  assert.equal(EDITOR_NIGHT_END_HOUR, 6);
  assert.equal(EDITOR_BREAKING_RESERVE_USD, 0.25);
  assert.equal(EDITOR_COST_GUESS, 0.09);
  assert.equal(EDITOR_BREAKING_TRENDING, 20000);
  assert.equal(EDITOR_BREAKING_SIGNAL_SCORE, 5);
  assert.equal(EDITOR_BREAKING_OUTLETS, 8);
  assert.equal(EDITOR_BREAKING_NEW_HOURS, 3);
  assert.equal(EDITOR_BREAKING_GAP_MINUTES, 15);
  assert.equal(EDITOR_BREAKING_MAX, 6);
  assert.equal(EDITOR_BIG_SENT_MAX, 200);
  const e = cfg.editor;
  assert.deepEqual(
    [e.minGapMinutes, e.nightGapMinutes, e.nightEndHour, e.breakingReserveUsd, e.costGuess, e.breakingTrending, e.breakingSignalScore, e.breakingOutlets, e.breakingNewHours, e.breakingGapMinutes, e.breakingMax, e.bigSentMax],
    [60, 180, 6, 0.25, 0.09, 20000, 5, 8, 3, 15, 6, 200],
  );
});

test('editor: overnight, from midnight to 5:59 AM Eastern, a regular call waits 180 minutes since the last call, and from 6:00 AM it is 60', async () => {
  // the last call was at 12:05 AM
  const s = setup({ stories: calmDay(), state: stateFor({ calls: 1, usd: 0.09, lastCallAt: et(0, 5) }) });
  const client = fakeClient(answer(GOOD));
  const early = await run(s, client, { now: et(2, 50) });
  assert.equal(early.status, 'skipped');
  assert.equal(client.calls.length, 0);
  assert.deepEqual(early.lines, ['editor: next regular call after 3:05 AM ET (180-minute gap; $1.06 left for 11 calls)']);
  assert.equal((await run(s, client, { now: et(3, 4) })).status, 'skipped', '179 minutes');
  const later = await run(s, client, { now: et(3, 6) });
  assert.equal(later.status, 'written', later.lines.join(' | '));
  assert.equal(client.calls.length, 1);
  assert.equal(stateOf(s).lastCallAt, et(3, 6));
  // the night gap is a setting
  const short = { ...cfg, editor: { ...cfg.editor, nightGapMinutes: 60 } };
  const t = setup({ stories: calmDay(), state: stateFor({ calls: 1, usd: 0.09, lastCallAt: et(0, 5) }) });
  assert.equal((await run(t, fakeClient(answer(GOOD)), { now: et(2, 50), config: short })).status, 'written', 'with a night gap of 60 the same run calls');
  // the day gap takes over at 6:00 AM: the last call was at 3:30 AM, so the night gap would run to 6:30 AM
  const u = setup({ stories: calmDay(), state: stateFor({ calls: 1, usd: 0.09, lastCallAt: et(3, 30) }) });
  const c3 = fakeClient(answer(GOOD));
  const before = await run(u, c3, { now: et(5, 55) });
  assert.equal(before.status, 'skipped');
  assert.deepEqual(before.lines, ['editor: next regular call after 6:00 AM ET (150-minute gap; $1.06 left for 11 calls)'], 'not 6:30: the night gap ends with the night');
  assert.equal(c3.calls.length, 0);
  assert.equal((await run(u, c3, { now: et(6, 5) })).status, 'written', 'at 6:05 the gap is the day gap, and 155 minutes have passed');
  // the first call of a new Eastern day is always allowed, at 12:10 AM too, whatever the last call of yesterday was
  const fresh = setup({ stories: calmDay(), state: stateFor({ date: '2026-11-16', calls: 9, usd: 1.3, lastCallAt: '2026-11-17T04:50:00.000Z' }) });
  const c4 = fakeClient(answer(GOOD));
  assert.equal((await run(fresh, c4, { now: et(0, 10) })).status, 'written');
  assert.deepEqual([stateOf(fresh).date, stateOf(fresh).calls, stateOf(fresh).lastCallAt], [DATE, 1, et(0, 10)]);
});

test('editor: by day, with plenty of money, a regular call waits 60 minutes since the last call, and not a minute less', async () => {
  // the last call was at 2 PM
  const s = setup({ state: stateFor({ calls: 1, usd: 0.09, lastCallAt: et(14, 0) }) });
  const client = fakeClient(answer(GOOD));
  const early = await run(s, client, { now: et(14, 45) });
  assert.equal(early.status, 'skipped');
  assert.equal(client.calls.length, 0);
  assert.deepEqual(early.lines, ['editor: next regular call after 3:00 PM ET (60-minute gap; $1.06 left for 11 calls)']);
  assert.equal((await run(s, client, { now: et(14, 59) })).status, 'skipped', '59 minutes');
  assert.equal(client.calls.length, 0);
  const on = await run(s, client, { now: et(15, 1) });
  assert.equal(on.status, 'written', on.lines.join(' | '));
  assert.equal(client.calls.length, 1, '61 minutes');
  // exactly 60 minutes is enough
  const t = setup({ state: stateFor({ calls: 1, usd: 0.09, lastCallAt: et(14, 0) }) });
  assert.equal((await run(t, fakeClient(answer(GOOD)), { now: et(15, 0) })).status, 'written');
  // the gap is the settings' number
  const wide = { ...cfg, editor: { ...cfg.editor, minGapMinutes: 120 } };
  const u = setup({ state: stateFor({ calls: 1, usd: 0.09, lastCallAt: et(14, 0) }) });
  assert.match((await run(u, fakeClient(answer(GOOD)), { now: et(15, 30), config: wide })).lines[0], /^editor: next regular call after 4:00 PM ET \(120-minute gap;/);
});

test('editor: the day\'s money is spread until midnight: the gap is the minutes to midnight over the calls the money buys, when that is longer than the clock gap', async () => {
  // $0.95 spent in 11 calls, the last at 6 PM: $0.20 is left for the regular calls, which is 2 calls
  const s = setup({ state: stateFor({ calls: 11, usd: 0.95, lastCallAt: et(18, 0) }) });
  const client = fakeClient(answer(GOOD));
  const early = await run(s, client, { now: et(19, 1) });
  assert.equal(early.status, 'skipped');
  assert.equal(client.calls.length, 0);
  assert.deepEqual(early.lines, ['editor: next regular call after 8:00 PM ET (120-minute gap; $0.20 left for 2 calls)'], 'at 8:00 PM the 4 hours left are 240 minutes, over 2 calls is 120');
  const on = await run(s, client, { now: et(20, 1) });
  assert.equal(on.status, 'written', on.lines.join(' | '));
  assert.equal(client.calls.length, 1);
  // the same day with more money left is paced shorter, and then the clock gap is the longer one
  const rich = setup({ state: stateFor({ calls: 4, usd: 0.34, lastCallAt: et(15, 5) }) });
  const early2 = await run(rich, fakeClient(answer(GOOD)), { now: et(15, 35) });
  assert.deepEqual(early2.lines, ['editor: next regular call after 4:05 PM ET (60-minute gap; $0.81 left for 9 calls)']);
  // a call costs at least the larger of the guess and today's average: $0.95 over 5 calls is $0.19 a call, and $0.20 buys 1
  const dear = setup({ state: stateFor({ calls: 5, usd: 0.95, lastCallAt: et(18, 0) }) });
  const early3 = await run(dear, fakeClient(answer(GOOD)), { now: et(19, 1) });
  assert.deepEqual(early3.lines, ['editor: next regular call after 9:00 PM ET (180-minute gap; $0.20 left for 1 call)'], 'one call left is made halfway to midnight');
  // the cost guess and the reserve are settings
  const careful = { ...cfg, editor: { ...cfg.editor, costGuess: 0.2, breakingReserveUsd: 0.1 } };
  const own = setup({ state: stateFor({ calls: 4, usd: 0.34, lastCallAt: et(15, 5) }) });
  const line = (await run(own, fakeClient(answer(GOOD)), { now: et(15, 35), config: careful })).lines[0];
  assert.match(line, /\$0\.96 left for 4 calls\)$/, '1.40 less 0.10 less 0.34, at $0.20 a call');
});

test('editor: with less than one call of regular money left there is no regular call, and the log says the rest is saved for breaking news', async () => {
  const at = (usd, calls = 12) => setup({ state: stateFor({ calls, usd, lastCallAt: et(5, 0) }) }); // the last call was 5 hours ago
  for (const usd of [1.2, 1.15, 1.07, 1.3999]) {
    const s = at(usd);
    const client = fakeClient(answer(GOOD));
    const r = await run(s, client);
    assert.equal(r.status, 'skipped', String(usd));
    assert.equal(client.calls.length, 0, `${usd}: no call`);
    assert.deepEqual(r.lines, [`editor: no regular call, the rest of today's money is saved for breaking news ($${usd.toFixed(2)} spent of $1.40)`], String(usd));
    assert.equal(stateOf(s).calls, 12, `${usd}: nothing is counted`);
  }
  // $1.06 spent leaves $0.09, which is one call: it is made, when its time comes
  const one = at(1.06);
  const c1 = fakeClient(answer(GOOD));
  const r1 = await run(one, c1);
  assert.equal(r1.status, 'skipped');
  assert.deepEqual(r1.lines, ['editor: next regular call after 2:30 PM ET (570-minute gap; $0.09 left for 1 call)']);
  assert.equal((await run(one, c1, { now: et(14, 31) })).status, 'written');
  // yesterday's spend does not carry over: a new day has all of it again
  const yesterday = setup({ state: stateFor({ date: '2026-11-16', calls: 12, usd: 1.3, lastCallAt: '2026-11-17T04:00:00.000Z' }) });
  assert.equal((await run(yesterday, fakeClient(answer(GOOD)))).status, 'written');
});

test('editor: a call whose answer fails the checks still counts: the run 15 minutes later makes no call', async () => {
  const s = setup();
  const kept = fakeClient(answer(withItems(GOOD.items.slice(0, 2)))); // two items: it fails the checks
  const first = await run(s, kept);
  assert.equal(first.status, 'kept');
  assert.equal(stateOf(s).lastCallAt, NOW);
  assert.equal(stateOf(s).lastWriteAt, null, 'it is not a write');
  assert.equal(stateOf(s).calls, 1);
  // new stories 15 minutes later, so the same-stories rule is not what stops it
  fs.writeFileSync(path.join(s.dataDir, 'days', `${DATE}.json`), JSON.stringify({ date: DATE, score: 62, stories: [...dayStories(), story('s10', 'hacks', 'Retailer confirms security incident after passwords leak')] }));
  const next = await run(s, kept, { now: new Date(Date.parse(NOW) + 15 * 60000) });
  assert.equal(next.status, 'skipped');
  assert.equal(kept.calls.length, 1, 'no second call');
  assert.match(next.lines[0], /^editor: next regular call after 11:0\d AM ET \(\d+-minute gap; \$1\.14 left for 12 calls\)$/);
  // a call that threw counts too
  const t = setup();
  const throwing = fakeClient(() => {
    throw new Error('overloaded');
  });
  assert.equal((await run(t, throwing)).status, 'failed');
  assert.equal(stateOf(t).lastCallAt, NOW);
  assert.equal((await run(t, throwing, { now: new Date(Date.parse(NOW) + 15 * 60000) })).status, 'skipped');
  assert.equal(throwing.calls.length, 1);
});

test('editor: lastCallAt is saved before the call is made, with the call count, so a run that dies halfway still counts', async () => {
  const s = setup();
  let seen = null;
  const client = fakeClient(() => {
    seen = stateOf(s);
    return answer(GOOD);
  });
  await run(s, client);
  assert.deepEqual([seen.calls, seen.lastCallAt, seen.breakingCalls], [1, NOW, 0]);
});

test('editor: a state file from before lastCallAt still works: the gap is counted from its last write, and the file gains the new keys', async () => {
  const old = { date: DATE, calls: 2, usd: 0.2, lastWriteAt: et(9, 30), lastIdsHash: 'older' };
  const s = setup({ state: old });
  const client = fakeClient(answer(GOOD));
  const early = await run(s, client, { now: et(10, 0) });
  assert.equal(early.status, 'skipped', 'the last write was 30 minutes ago');
  assert.deepEqual(early.lines, ['editor: next regular call after 10:57 AM ET (87-minute gap; $0.95 left for 9 calls)']);
  assert.equal(client.calls.length, 0);
  assert.deepEqual(Object.keys(JSON.parse(s.read('data/state/editor.json'))), ['date', 'calls', 'usd', 'lastWriteAt', 'lastIdsHash'], 'a skip writes nothing');
  const on = await run(s, client, { now: et(11, 0) });
  assert.equal(on.status, 'written', on.lines.join(' | '));
  assert.deepEqual(Object.keys(stateOf(s)), ['date', 'calls', 'usd', 'lastWriteAt', 'lastIdsHash', 'lastCallAt', 'breakingCalls', 'bigSent']);
  assert.deepEqual([stateOf(s).calls, stateOf(s).lastCallAt, stateOf(s).breakingCalls, stateOf(s).bigSent], [3, et(11, 0), 0, []]);
  // a lastCallAt that is not a time is ignored, and the last write stands in
  const odd = setup({ state: { ...old, lastCallAt: 'sometime' } });
  assert.equal((await run(odd, fakeClient(answer(GOOD)), { now: et(10, 0) })).status, 'skipped');
  // no last call and no last write at all: the first call of the day
  const none = setup({ state: { date: DATE, calls: 0, usd: 0, lastWriteAt: null, lastIdsHash: null } });
  assert.equal((await run(none, fakeClient(answer(GOOD)))).status, 'written');
});

test('editor: regularPlan works out the money, the calls it buys and the moment of the next call', () => {
  const at = (hour, minute = 0) => Date.parse(et(hour, minute));
  // no last call: the first call of the day, no moment to wait for
  const first = regularPlan(at(10), { usd: 0, calls: 0, lastCallMs: NaN });
  assert.deepEqual([first.saved, first.left, first.callsLeft, first.dueMs], [false, 1.15, 12, null]);
  // the example of the brief: $0.34 spent in 4 calls, the last at 3:05 PM, looked at at 3:35 PM
  const p = regularPlan(at(15, 35), { usd: 0.34, calls: 4, lastCallMs: at(15, 5) });
  assert.deepEqual([p.saved, p.left, p.callsLeft, p.gapMinutes, p.dueMs], [false, 0.81, 9, 60, at(16, 5)]);
  // the paced gap shrinks as midnight comes nearer, so the moment does not move with the clock: asked at 7:01 PM or at 7:30 PM, it is 8:00 PM
  const late = { usd: 0.95, calls: 11, lastCallMs: at(18) };
  assert.equal(regularPlan(at(19, 1), late).dueMs, at(20));
  assert.equal(regularPlan(at(19, 30), late).dueMs, at(20));
  assert.equal(regularPlan(at(20), late).gapMinutes, 120);
  // a call is reckoned at today's average when that is more than the guess
  assert.equal(regularPlan(at(19, 1), { usd: 0.95, calls: 5, lastCallMs: at(18) }).callsLeft, 1);
  assert.equal(regularPlan(at(19, 1), { usd: 0.95, calls: 0, lastCallMs: at(18) }).callsLeft, 2, 'no calls yet: the guess');
  // no money: saved, whatever the clock says
  for (const usd of [1.15, 1.2, 2]) {
    const x = regularPlan(at(10), { usd, calls: 10, lastCallMs: at(5) });
    assert.deepEqual([x.saved, x.callsLeft, x.dueMs], [true, 0, null], String(usd));
  }
  // a hair under a whole call because of floating point is a whole call: 1.4 - 0.25 - 1.06
  assert.equal(regularPlan(at(10), { usd: 1.06, calls: 12, lastCallMs: NaN }).callsLeft, 1);
  assert.equal(regularPlan(at(10), { usd: 1.0600001, calls: 12, lastCallMs: NaN }).callsLeft, 1, 'to 4 decimals');
  // the night gap, and the day gap that takes over at the end of the night
  const night = regularPlan(at(2, 50), { usd: 0.09, calls: 1, lastCallMs: at(0, 5) });
  assert.deepEqual([night.dueMs, night.gapMinutes], [at(3, 5), 180]);
  const edge = regularPlan(at(5, 55), { usd: 0.09, calls: 1, lastCallMs: at(3, 30) });
  assert.deepEqual([edge.dueMs, edge.gapMinutes], [at(6, 0), 150]);
});

test('editor: when the stories are the same as at its last call it does not call again', async () => {
  const s = setup();
  const client = fakeClient(answer(GOOD));
  assert.equal((await run(s, client)).status, 'written');
  assert.equal(client.calls.length, 1);
  const again = await run(s, client, { now: '2026-11-17T18:00:00.000Z' }); // well past the wait
  assert.equal(again.status, 'skipped');
  assert.equal(client.calls.length, 1, 'no second call');
  assert.deepEqual(again.lines, ['editor: the stories are the same as at the last call']);
  // a new story changes the set, so it calls again
  const stories = [...dayStories(), story('s10', 'hacks', 'Retailer confirms security incident after passwords leak')];
  fs.writeFileSync(path.join(s.dataDir, 'days', `${DATE}.json`), JSON.stringify({ date: DATE, score: 62, stories }));
  const changed = await run(s, client, { now: '2026-11-17T18:05:00.000Z' });
  assert.equal(changed.status, 'written');
  assert.equal(client.calls.length, 2);
  // the same goes for a call that was refused: the same stories are not asked about twice
  const t = setup();
  const refusing = fakeClient(answer('', { stop_reason: 'refusal' }));
  assert.equal((await run(t, refusing)).status, 'kept');
  assert.equal((await run(t, refusing, { now: '2026-11-17T17:00:00.000Z' })).status, 'skipped');
  assert.equal(refusing.calls.length, 1);
});

test('editor: nothing filed yet, or nothing new to say, means no call', async () => {
  const none = setup({ stories: null });
  const client = fakeClient(answer(GOOD));
  const r = await run(none, client);
  assert.equal(r.status, 'skipped');
  assert.equal(client.calls.length, 0);
  assert.deepEqual(r.lines, [`editor: no stories filed for ${DATE} yet`]);
  // every story was told on an earlier day, or has no title
  const told = (ids, line) => ({ emoji: '\u{1F5A5}\uFE0F', line, ids, quiet: false, cat: 'internet', title: `Old ${ids[0]}`, url: `https://pub.example/${ids[0]}`, source: 'Pub A', outlets: 4 });
  const used = { ...OLD, date: '2026-11-16', items: [told(['s01', 's02', 's03', 's04'], 'Line one.'), told(['s05', 's06', 's07'], 'Line two.'), told(['s08', 's09', 'sig:quake:q9'], 'Line three.')] };
  const spent = setup({ editions: { '2026-11-16': used } });
  const r2 = await run(spent, client);
  assert.equal(r2.status, 'skipped');
  assert.deepEqual(r2.lines, ['editor: no new stories to write about']);
  const blank = setup({ stories: [story('b1', 'internet', '   '), story('b2', 'internet', undefined)] });
  assert.deepEqual((await run(blank, client)).lines, ['editor: no new stories to write about']);
  assert.equal(client.calls.length, 0);
});

// ---- what it asks ------------------------------------------------------------------------------------

test('editor: the request has the shape the API wants, and each story is sent with eight plain fields', async () => {
  const s = setup();
  const client = fakeClient(answer(GOOD));
  await run(s, client);
  assert.equal(client.calls.length, 1);
  const req = client.calls[0];
  assert.equal(req.model, EDITOR_MODEL);
  assert.equal(EDITOR_MODEL, 'claude-opus-5-5');
  assert.equal(req.max_tokens, 16000);
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(req.fallbacks, 'default');
  assert.deepEqual(Object.keys(req.output_config).sort(), ['effort', 'format']);
  assert.equal(req.output_config.effort, 'medium');
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.deepEqual(req.output_config.format.schema, EDITION_SCHEMA);
  assert.equal(req.system, EDITOR_SYSTEM_PROMPT);
  assert.equal(req.messages.length, 1);
  assert.equal(req.messages[0].role, 'user');
  const sent = JSON.parse(req.messages[0].content);
  assert.deepEqual(Object.keys(sent), ['date', 'now', 'score', 'told', 'stories']);
  assert.equal(sent.date, DATE);
  assert.equal(sent.now, '10:00 AM ET', 'the time in New York, written the way the page writes it');
  assert.equal(sent.score, 62);
  assert.deepEqual(sent.told, [], 'no earlier edition, so nothing was told');
  for (const one of sent.stories) assert.deepEqual(Object.keys(one), ['id', 'cat', 'title', 'source', 'outlets', 'serious', 'hoursAgo', 'startedHoursAgo']);
  for (const one of sent.stories) assert.equal(one.hoursAgo, 3, 'published at 12:00 UTC, read at 15:00 UTC');
  for (const one of sent.stories) assert.equal(one.startedHoursAgo, 3, 'its first headline is its only one');
  const want = listingOrder(publishableStories(excluder, dayStories()), cfg.variety).map((x) => x.id);
  assert.deepEqual(sent.stories.map((x) => x.id), want, 'in the order the page lists them');
  assert.equal(sent.stories.find((x) => x.id === 'sig:quake:q9').serious, true, 'a quiet card is serious');
  assert.equal(sent.stories.find((x) => x.id === 's01').serious, false);
  assert.equal(sent.stories.find((x) => x.id === 's01').outlets, 12);
  assert.ok(!req.messages[0].content.includes(KEY) && !JSON.stringify(req).includes(KEY), 'the key is not in the request');
});

test('editor: the schema lists every key, allows nothing extra, and uses no keyword the API does not support', () => {
  const objects = [];
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object') objects.push(node);
    for (const [key, value] of Object.entries(node)) {
      assert.ok(!['minItems', 'maxItems', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern'].includes(key), `no ${key}`);
      walk(value);
    }
  })(EDITION_SCHEMA);
  assert.equal(objects.length, 2);
  for (const o of objects) {
    assert.deepEqual([...o.required].sort(), Object.keys(o.properties).sort(), 'every key is required');
    assert.equal(o.additionalProperties, false);
  }
  assert.deepEqual(Object.keys(EDITION_SCHEMA.properties).sort(), ['date', 'headline', 'items']);
  assert.deepEqual([...EDITION_SCHEMA.required].sort(), ['date', 'headline', 'items']);
  assert.ok(!('best' in EDITION_SCHEMA.properties), 'the order of the items is the rank, so there is no best id to ask for');
  assert.deepEqual(Object.keys(EDITION_SCHEMA.properties.items.items.properties).sort(), ['emoji', 'ids', 'label', 'line']);
  // the label is asked for on every item, as a string
  assert.deepEqual(EDITION_SCHEMA.properties.items.items.properties.label, { type: 'string' });
  assert.ok(EDITION_SCHEMA.properties.items.items.required.includes('label'), 'every item must carry a label');
});

test('editor: stories the edition could never use are never sent: used ids, no title, blocked topics, other languages, and more than 80', async () => {
  const early = { ...OLD, date: '2026-11-16', items: ['s01', 's02', 's03'].map((id) => ({ ...OLD.items[0], ids: [id], best: undefined, line: `Line ${id}.` })) };
  early.items[0].best = true;
  const stories = [
    ...dayStories(),
    story('b1', 'internet', '   '),
    story('b2', 'internet', 'Trump says the outage was fixed'),
    story('b3', 'weather', 'Por el derecho de la niñez a crecer en familia, las Aldeas Infantiles SOS convocan a una carrera pedestre'),
    story('b4', 'hacks', 'Gunman killed two people in a bank'),
  ];
  const s = setup({ stories, editions: { '2026-11-16': early } });
  const client = fakeClient(answer(GOOD));
  await run(s, client);
  const ids = JSON.parse(client.calls[0].messages[0].content).stories.map((x) => x.id);
  for (const gone of ['s01', 's02', 's03', 'b1', 'b2', 'b3', 'b4']) assert.ok(!ids.includes(gone), `${gone} is not sent`);
  for (const kept of ['s04', 's05', 's06', 's07', 's08', 's09', 'sig:quake:q9']) assert.ok(ids.includes(kept), `${kept} is sent`);
  // today's own earlier edition does not use ids up: only earlier days do
  const own = setup({ editions: { [DATE]: OLD } });
  const c2 = fakeClient(answer(GOOD));
  await run(own, c2);
  assert.ok(JSON.parse(c2.calls[0].messages[0].content).stories.some((x) => x.id === 's01'));
  // a very busy day: 80 at most
  assert.equal(EDITOR_MAX_STORIES, 80);
  const many = Array.from({ length: 120 }, (_, i) => story(`m${String(i).padStart(3, '0')}`, ['flights', 'hacks', 'internet', 'markets'][i % 4], `Cloudflare outage number ${i} knocks thousands of sites offline`, { score: 100 - (i % 50) }));
  const big = setup({ stories: many });
  const c3 = fakeClient(answer(GOOD));
  await run(big, c3);
  const sent = JSON.parse(c3.calls[0].messages[0].content).stories;
  assert.equal(sent.length, 80);
  assert.deepEqual(sent.map((x) => x.id), listingOrder(publishableStories(excluder, many), cfg.variety).slice(0, 80).map((x) => x.id));
});

// ---- what it does with the answer ------------------------------------------------------------------------

test('editor: a good answer is written as today\'s edition, with the lead story\'s fields copied in and no model name stored', async () => {
  const s = setup();
  const client = fakeClient(answer(GOOD));
  const r = await run(s, client);
  assert.equal(r.status, 'written');
  assert.equal(r.written, 5);
  assert.deepEqual(r.lines, ['editor: wrote 5 items for 2026-11-17 (1200 in, 300 out, $0.011)'], 'one line: items, tokens in, tokens out, what the call cost');
  const e = readJson(editionPath(s));
  assert.deepEqual(Object.keys(e), ['date', 'by', 'writtenAt', 'headline', 'items']);
  assert.equal(e.date, DATE);
  assert.equal(e.by, 'editor');
  assert.equal(e.writtenAt, NOW);
  assert.equal(e.headline, GOOD.headline);
  const lead = e.items[0];
  assert.deepEqual(Object.keys(lead), ['emoji', 'line', 'ids', 'best', 'quiet', 'cat', 'title', 'url', 'source', 'outlets', 'label']);
  assert.equal(lead.label, 'United outage');
  assert.deepEqual([lead.cat, lead.title, lead.url, lead.source, lead.outlets], ['flights', 'United Airlines system outage delays departing flights', 'https://pub.example/s01', 'Pub A', 12], 'copied from the lead story, s01');
  assert.deepEqual(e.items[0].ids, ['s01']);
  assert.deepEqual(e.items[2].ids, ['s03', 's07'], 'an item keeps all of its ids');
  assert.deepEqual(Object.keys(e.items[2]), ['emoji', 'line', 'ids', 'quiet', 'cat', 'title', 'url', 'source', 'outlets', 'label'], 'only the first item is marked best');
  assert.ok(!JSON.stringify(e).includes('claude') && !JSON.stringify(e).includes('opus'), 'no model name in the file');
  assert.ok(!s.read('data/editions/2026-11-17.json').includes(KEY));
  // it passes the same check the build runs
  const checked = validateEdition(e, { date: DATE, used: new Set(), byId: new Map(), excluder });
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.dropped, []);
  // the state: eight keys, one call, today's spend, the write time, the hash of the stories it read, when the call was made, no breaking call and no big story sent
  assert.deepEqual(Object.keys(stateOf(s)), ['date', 'calls', 'usd', 'lastWriteAt', 'lastIdsHash', 'lastCallAt', 'breakingCalls', 'bigSent']);
  assert.deepEqual([stateOf(s).date, stateOf(s).calls, stateOf(s).usd, stateOf(s).lastWriteAt], [DATE, 1, 0.0108, NOW]);
  assert.deepEqual([stateOf(s).lastCallAt, stateOf(s).breakingCalls, stateOf(s).bigSent], [NOW, 0, []]);
  assert.match(stateOf(s).lastIdsHash, /^[0-9a-f]{16}$/);
});

test('editor: the order of the items is the rank: item 1 is the closest call and nothing is moved', async () => {
  const s = setup();
  const client = fakeClient(answer(GOOD));
  await run(s, client);
  const e = readJson(editionPath(s));
  assert.deepEqual(e.items.map((i) => i.ids[0]), ['s01', 's02', 's03', 's04', 's05']);
  assert.deepEqual(e.items.map((i) => Boolean(i.best)), [true, false, false, false, false], 'the first item is the best one');
  // the reverse order is kept just as it is: the editor's order is the rank
  const back = setup();
  await run(back, fakeClient(answer(withItems([...GOOD.items].reverse()))));
  assert.deepEqual(readJson(editionPath(back)).items.map((i) => i.ids[0]), ['s05', 's04', 's03', 's02', 's01']);
  // an answer that still carries a "best" id from the old habit moves nothing
  for (const best of ['s05', 's07', 'nope']) {
    const t = setup();
    await run(t, fakeClient(answer({ ...GOOD, best })));
    assert.deepEqual(readJson(editionPath(t)).items.map((i) => i.ids[0]), ['s01', 's02', 's03', 's04', 's05'], `best ${best} changes nothing`);
  }
});

test('editor: the prompt asks for a label, a line and a one-sentence headline, in a ranking from most world-ending to least', () => {
  const p = EDITOR_SYSTEM_PROMPT;
  assert.ok(
    p.includes(
      '\nInput: one day\'s headlines as JSON: {date, now, score, told, stories: [{id, cat, title, source, outlets, serious, hoursAgo, startedHoursAgo, trending}]}. now is the time in New York. Many headlines describe the same event. hoursAgo is how many hours ago the story\'s newest headline came out, and startedHoursAgo how many hours ago its first one did. trending, when present, is how many people in the US searched for the story on Google lately: it is what people are talking about right now. told lists the items of the last two days, as "label: line".\n',
    ),
    'the input paragraph names now, told, hoursAgo, startedHoursAgo and trending',
  );
  assert.ok(
    p.includes(
      '\n2. Pick 5 to 10 events (3 or 4 on a quiet day). Skip anything that is not a near miss: charity runs, explainers, opinion, advice, lawsuits, politics. Pick the newest: take events from the last 12 hours first (hoursAgo 12 or less), and an older one only when that leaves fewer than 5. Only today counts: skip an event that was over before today began, even when today\'s headlines are about it (its cause, an investigation, the cleanup, what changes now, how people coped). startedHoursAgo and now show when it began, and the headlines show whether it is still going on. An event still going on today counts, and so does one that happened again today. Only real events: each needs two or more outlets, one outlet everybody knows, or an official reading (USGS, NOAA, NASA, the FAA, a status page, Downdetector). Skip a lone claim from a site people don\'t know. Flares, solar storms, quakes and asteroids are measured. A headline about one counts only when the input also has a reading of it from NOAA SWPC, USGS or NASA/JPL. Without one, it is about an older one. A trending event that is a near miss always makes the list. Skip any event already in told, unless something new and bigger happened to it, and then the line says what is new.\n',
    ),
    'rule 2 asks for the newest events, only today, only real events, always the trending near misses, and no repeats',
  );
  assert.ok(p.includes('\n1. Group the headlines into events. One item per event, with all of its ids, the best headline\'s id first.\n'), 'rule 1 is as it was');
  assert.match(
    p,
    /3\. Rank the events from most world-ending to least and list them in that order, so item 1 is the closest call\. Picture each one at a bigger scale, then weigh how many people it would reach, how much of the world, how fragile the system looked, and how close it came\. Outlet counts don't decide the rank\. A serious story is ranked by the same test, never put on top just for being serious, and keeps its plain line\./,
  );
  assert.ok(
    p.includes(
      '\n4. label: 1 to 4 words that name the thing in the story, not what happened to it: the object, company, place or event, written like a name (Asteroid 2026 WA, FAA outage, Card skimmers). Nouns only, no verb, no joke, no period, and the label must not repeat the first words of the line.\n',
    ),
    'rule 4 asks for a label',
  );
  assert.ok(
    p.includes(
      '\n5. line: what happened, in 12 words or fewer, at most two short sentences. The label already names the thing, so don\'t repeat it. emoji: one emoji that names the thing, an object or a place, never a face or a skull. A serious story gets a plain one (\u{1F30F} for an earthquake).\n',
    ),
    'rule 5 asks for a short line and an emoji',
  );
  assert.ok(
    p.includes(
      '\n6. headline: one sentence about item 1 and how it missed us, with one real detail from its line (a size, a time like 2:59 AM ET, a number) and no period inside it (write US, not U.S.), then "Still here." At most 15 words in all, and only facts already in your items.\n',
    ),
    'rule 6 asks for one sentence and then Still here.',
  );
  assert.ok(!/two full sentences/.test(p) && !p.includes('25 words or fewer'), 'the phase 7 rules are gone');
  assert.ok(!p.includes('the whole day in 12 words or fewer'), 'the old rule 5 is gone');
  assert.ok(!/\bbest:/.test(p) && !/the id of the closest call/.test(p), 'no best step');
  assert.ok(!/the closest call first: bigger scale, more outlets/.test(p), 'outlet counts no longer decide');
  assert.ok(p.includes('\n- The label says who or what. The line says how big, how long, how it ended. Numbers beat adjectives: "an hour and a half", "80% of its servers".\n'), 'the first voice rule');
  assert.match(p, /- Clock times are Eastern, written like 2:59 AM ET\.\n/);
  assert.ok(
    p.includes(
      '\nItems in the right voice (label: line):\n- Asteroid 2026 WA: Passed a third of the way to the Moon. Missed. So far.\n- FAA outage: Grounded flights nationwide. Traced to one old copper-wire switch.\n- Outlook outage: Microsoft says a July bug took out over 80% of its servers.\n- Nvidia sell-off: Pushed the Nasdaq into a correction. Wall Street for a big drop.\nA headline in the right voice: "An asteroid the size of a bus missed Earth at 2:59 AM ET. Still here."\n',
    ),
    'the examples are labels and lines, and a one-sentence headline',
  );
  assert.ok(!/An Nvidia-led sell-off pushed/.test(p) && !p.includes('Grounded flights sent one Vegas wedding'), 'the old examples are gone');
  assert.ok(!p.includes('Microsoft found its bug'), 'the old example is gone');
  assert.ok(!/[\u2013\u2014]/.test(p), 'no em or en dash in what the editor is told');
});

test('editor: a missing label or one with too many words is left off, the row stays, and the log line says so', async () => {
  const s = setup();
  const items = GOOD.items.map((it, i) => {
    if (i === 1) return { emoji: it.emoji, line: it.line, ids: it.ids }; // no label at all
    if (i === 2) return { ...it, label: 'Five words are too many' };
    return it;
  });
  const r = await run(s, fakeClient(answer(withItems(items))));
  assert.equal(r.status, 'written');
  assert.equal(r.written, 5, 'every row stays');
  const e = readJson(editionPath(s));
  assert.deepEqual(e.items.map((i) => i.label), ['United outage', '', '', 'Nasdaq sell-off', 'Asteroid pass']);
  assert.match(r.line, /item 2 kept without a label \(label missing\)/);
  assert.match(r.line, /item 3 kept without a label \(label has more than 4 words\)/);
  assert.ok(!/dropped/.test(r.line), 'nothing was dropped');
});

test('editor: a label with a period is left off and the row stays', async () => {
  const s = setup();
  const items = GOOD.items.map((it, i) => (i === 3 ? { ...it, label: 'Nasdaq sell-off.' } : it));
  const r = await run(s, fakeClient(answer(withItems(items))));
  assert.equal(r.status, 'written');
  assert.equal(r.written, 5);
  const e = readJson(editionPath(s));
  assert.deepEqual(e.items.map((i) => i.label), ['United outage', 'Chase banking', 'Cloudflare outage', '', 'Asteroid pass']);
  assert.match(r.line, /item 4 kept without a label \(label has a period\)/);
});

test('editor: ids that are not stories it sent are dropped, and an item left with none is dropped', async () => {
  const s = setup();
  const items = [
    ...GOOD.items.slice(0, 3),
    { emoji: '\u{1F916}', line: 'An invented story about robots that nobody filed.', ids: ['made-up', 'also-made-up'] },
    { emoji: '\u{1F300}', line: 'A hailstorm hit the valley and then it stopped.', ids: ['nope', 's08', 7, null] },
    { emoji: '\u{1F41D}', line: 'Three goats were on the loose downtown for a while.', ids: ['s09'] },
  ];
  const r = await run(s, fakeClient(answer(withItems(items))));
  assert.equal(r.status, 'written');
  const e = readJson(editionPath(s));
  assert.deepEqual(e.items.map((i) => i.ids), [['s01'], ['s02'], ['s03', 's07'], ['s08'], ['s09']], 'in the order the editor listed them, unknown ids gone, the invented item gone');
  assert.ok(!JSON.stringify(e).includes('made-up'));
});

test('editor: ids an earlier day already told are never sent, and an answer that uses them anyway is dropped', async () => {
  const early = { ...OLD, date: '2026-11-16', items: ['s01', 's02'].map((id, i) => ({ ...OLD.items[0], ids: [id], line: `Line ${id}.`, best: i === 0 ? true : undefined })) };
  early.items.push({ ...early.items[0], ids: ['s09'], line: 'Line s09.', best: undefined });
  const s = setup({ editions: { '2026-11-16': early } });
  const client = fakeClient(answer(GOOD)); // GOOD still tries s01 and s02
  await run(s, client);
  const sent = JSON.parse(client.calls[0].messages[0].content).stories.map((x) => x.id);
  for (const id of ['s01', 's02', 's09']) assert.ok(!sent.includes(id), `${id} is not sent`);
  const e = readJson(editionPath(s));
  assert.ok(e.items.every((i) => !['s01', 's02', 's09'].includes(i.ids[0])), 'the used ones are left out of the edition');
  assert.deepEqual(e.items.map((i) => i.ids[0]), ['s03', 's04', 's05']);
  assert.equal(listFiles(path.join(s.dataDir, 'editions')).join(','), '2026-11-16.json,2026-11-17.json');
});

test('editor: a line with a long dash is dropped, and so is a line on an excluded topic, and the rest are written', async () => {
  const s = setup();
  const items = [
    ...GOOD.items,
    { emoji: '\u{1F300}', line: `A hailstorm hit the valley ${EM} then it stopped.`, ids: ['s08'] },
    { emoji: '\u{1F41D}', line: 'Congress held a hearing about three goats downtown.', ids: ['s09'] },
    { emoji: '⚡', line: 'A gunman killed two people at the substation.', ids: ['s06'] },
  ];
  const r = await run(s, fakeClient(answer(withItems(items))));
  assert.equal(r.status, 'written');
  const e = readJson(editionPath(s));
  assert.equal(e.items.length, 5);
  const text = JSON.stringify(e);
  assert.ok(!text.includes(EM), 'no long dash in the file');
  assert.ok(!text.includes('Congress') && !text.includes('gunman'), 'no excluded topic in the file');
  assert.deepEqual(e.items.map((i) => i.ids[0]), ['s01', 's02', 's03', 's04', 's05']);
});

test('editor: fewer than 3 usable items keeps the old edition exactly as it was', async () => {
  const old = `${JSON.stringify(OLD, null, 2)}\n`;
  const cases = {
    'two items': withItems(GOOD.items.slice(0, 2)),
    'three items, one with a long dash': withItems([GOOD.items[0], GOOD.items[1], { ...GOOD.items[2], line: `Cloudflare went down ${EM} for a while.` }]),
    'nothing': withItems([]),
    'only invented ids': withItems(GOOD.items.map((it, i) => ({ ...it, ids: [`made-up-${i}`] }))),
  };
  for (const [name, body] of Object.entries(cases)) {
    const s = setup({ editions: { [DATE]: OLD } });
    const before = s.read(`data/editions/${DATE}.json`);
    assert.equal(before, old);
    const r = await run(s, fakeClient(answer(body)));
    assert.equal(r.status, 'kept', name);
    assert.equal(s.read(`data/editions/${DATE}.json`), before, `${name}: the file is untouched`);
    assert.match(r.lines[0], /^editor: the edition failed its checks \(only \d usable items?\), kept the current edition \(1200 in, 300 out\)$/, name);
    assert.equal(r.lines.length, 1, name);
  }
});

test('editor: a headline that breaks the rules keeps the old edition', async () => {
  const longOne = `United planes sat late for an hour and a half on Monday and for most of Tuesday afternoon and evening across the whole country. Still here.`;
  const tooLong = `United planes sat late for an hour. ${'Banks went down for a while. '.repeat(8)}Still here.`;
  assert.ok(longOne.length > 110 && tooLong.length > 110);
  for (const headline of [
    'Planes late. Banks down.',
    `United planes sat late for an hour and a half ${EM} for part of Monday. Still here.`,
    'United planes sat late for an hour and a half on Monday! Still here.',
    '',
    'Planes late. Banks down. Still here.',
    'Planes sat late on Nov. 17 for an hour. Still here.',
    longOne,
    tooLong,
  ]) {
    const s = setup({ editions: { [DATE]: OLD } });
    const before = s.read(`data/editions/${DATE}.json`);
    const r = await run(s, fakeClient(answer(withItems(GOOD.items, { headline }))));
    assert.equal(r.status, 'kept', JSON.stringify(headline));
    assert.equal(s.read(`data/editions/${DATE}.json`), before);
    assert.match(r.lines[0], /the edition failed its checks \(headline/);
  }
});

test('editor: a refusal, a cut-off answer or no answer keeps the old edition, and the log says what happened', async () => {
  const cases = [
    ['a refusal with a category', answer('', { stop_reason: 'refusal', stop_details: { category: 'cyber' } }), /the model stopped with refusal \(cyber\), kept the current edition \(1200 in, 300 out\)/],
    ['a refusal', answer('', { stop_reason: 'refusal' }), /the model stopped with refusal, kept the current edition/],
    ['a cut-off answer', answer('{"date":', { stop_reason: 'max_tokens' }), /the model stopped with max_tokens/],
    ['a pause', answer('', { stop_reason: 'pause_turn' }), /the model stopped with pause_turn/],
    ['no answer at all', undefined, /the model stopped with no answer, kept the current edition \(0 in, 0 out\)/],
    ['no stop reason', { content: [], usage: {} }, /the model stopped with no answer/],
  ];
  for (const [name, response, pattern] of cases) {
    const s = setup({ editions: { [DATE]: OLD } });
    const before = s.read(`data/editions/${DATE}.json`);
    const client = fakeClient(response);
    const r = await run(s, client);
    assert.equal(r.status, 'kept', name);
    assert.equal(client.calls.length, 1, name);
    assert.equal(s.read(`data/editions/${DATE}.json`), before, `${name}: the old edition stays`);
    assert.match(r.lines[0], pattern, name);
    assert.equal(stateOf(s).calls, 1, `${name}: it counts as a call`);
    assert.equal(stateOf(s).lastWriteAt, null, `${name}: it is not a write`);
  }
});

test('editor: an answer that is not JSON, or not an edition, keeps the old edition', async () => {
  const bad = ['{ not json', '', 'Here is the edition: {}', '[]', '"text"', '42', 'null', '{"items": 5}', '{"headline": "x"}', '{"date":"2026-11-17","headline":"Still here."}'];
  for (const text of bad) {
    const s = setup({ editions: { [DATE]: OLD } });
    const before = s.read(`data/editions/${DATE}.json`);
    const r = await run(s, fakeClient(answer(text)));
    assert.equal(r.status, 'kept', JSON.stringify(text));
    assert.equal(s.read(`data/editions/${DATE}.json`), before, JSON.stringify(text));
    assert.match(r.lines[0], /^editor: the answer (?:was not valid JSON|had no items), kept the current edition/, JSON.stringify(text));
  }
  // blocks that are not text are skipped, and the text blocks are joined
  const s = setup();
  const text = JSON.stringify(GOOD);
  const response = { stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 6 }, content: [{ type: 'thinking', thinking: 'let me think {not json}' }, { type: 'text', text: text.slice(0, 40) }, { type: 'tool_use', name: 'x' }, { type: 'text', text: text.slice(40) }, null] };
  const r = await run(s, fakeClient(response));
  assert.equal(r.status, 'written');
  assert.equal(readJson(editionPath(s)).items.length, 5);
  assert.match(r.lines[0], /\(5 in, 6 out, \$0\.000\)$/);
});

test('editor: a failed call keeps the old edition, counts as a call, and never prints the key', async () => {
  const errors = [new Error(`401 invalid x-api-key ${KEY}`), 'plain string', null, Object.assign(new Error('timed out'), { name: 'APIConnectionTimeoutError' }), { message: `object with ${KEY} inside` }];
  for (const err of errors) {
    const s = setup({ editions: { [DATE]: OLD } });
    const before = s.read(`data/editions/${DATE}.json`);
    const client = fakeClient(() => {
      throw err;
    });
    const r = await run(s, client);
    assert.equal(r.status, 'failed');
    assert.equal(client.calls.length, 1);
    assert.equal(s.read(`data/editions/${DATE}.json`), before);
    assert.equal(stateOf(s).calls, 1, 'the call counts');
    assert.equal(r.lines.length, 1, 'one line');
    assert.ok(!r.lines[0].includes(KEY), 'the key is not in the line');
    assert.match(r.lines[0], /^editor: the call failed \(.{0,220}\), kept the current edition$/);
    assert.ok(r.lines[0].length < 300);
  }
  const s = setup();
  const r = await run(s, fakeClient(() => Promise.reject(new Error(`bad ${KEY}`))));
  assert.match(r.lines[0], /bad \[key\]/, 'the key is masked');
});

test('editor: a problem anywhere is one line and never an exception', async () => {
  // a broken state file, a broken latest file, a broken day file, a log that throws
  for (const file of ['data/state/editor.json', 'data/latest.json', `data/days/${DATE}.json`]) {
    const s = setup();
    fs.writeFileSync(s.file(file), '{ nope');
    const client = fakeClient(answer(GOOD));
    const r = await run(s, client);
    assert.ok(['written', 'skipped', 'failed', 'kept'].includes(r.status), `${file}: ${r.status}`);
    assert.equal(r.lines.length, 1, file);
  }
  const s = setup();
  const r = await runEditor({ client: fakeClient(() => { throw new Error('x'); }), now: NOW, dataDir: s.dataDir, env: { ANTHROPIC_API_KEY: KEY }, log: () => {}, config: cfg });
  assert.equal(r.status, 'failed');
  // a client with no beta namespace at all
  const odd = await run(setup(), { beta: {} });
  assert.equal(odd.status, 'failed');
  assert.match(odd.lines[0], /^editor: the call failed/);
  // a clock that is not a time
  const t = setup();
  const r3 = await run(t, fakeClient(answer(GOOD)), { now: 'not a time' });
  assert.ok(['skipped', 'failed', 'written', 'kept'].includes(r3.status));
});

test('editor: it writes only today\'s file, and a past day\'s edition is never touched, even a hand-written one', async () => {
  const past = { ...HAND, date: '2026-11-16', items: ['s04', 's05', 's06'].map((id, i) => ({ ...OLD.items[0], ids: [id], best: i === 0 ? true : undefined, line: `Old line ${id}.` })) };
  past.items.forEach((it) => it.best === undefined && delete it.best);
  const s = setup({ editions: { '2026-11-16': past } });
  const before = s.read('data/editions/2026-11-16.json');
  const written = await run(s, fakeClient(answer(GOOD)));
  assert.equal(written.status, 'written', 'a hand-written edition on a past day does not stop today');
  assert.equal(s.read('data/editions/2026-11-16.json'), before, 'the 16th is exactly as it was');
  assert.deepEqual(listFiles(path.join(s.dataDir, 'editions')), ['2026-11-16.json', '2026-11-17.json']);
  assert.deepEqual(listFiles(s.dataDir), ['days', 'editions', 'latest.json', 'state'], 'nothing else in data/ was added');
  assert.deepEqual(listFiles(path.join(s.dataDir, 'days')), ['2026-11-17.json'], 'the day files are only read');
});

test('editor: an edition written by hand for today is never replaced: it says so, makes no call and counts nothing', async () => {
  const s = setup({ editions: { [DATE]: HAND } });
  assert.equal(readJson(editionPath(s)).by, 'hand');
  const before = s.read(`data/editions/${DATE}.json`);
  const client = fakeClient(answer(GOOD));
  const r = await run(s, client);
  assert.equal(r.status, 'skipped');
  assert.deepEqual(r.lines, ["editor: today's edition is hand-written, leaving it"]);
  assert.equal(client.calls.length, 0, 'no call');
  assert.equal(s.read(`data/editions/${DATE}.json`), before, 'the file is exactly as it was');
  assert.ok(!fs.existsSync(s.file('data/state/editor.json')), 'no call is counted');
  // it holds on every later run of the day, with new stories and a long wait too
  const stories = [...dayStories(), story('s10', 'hacks', 'Retailer confirms security incident after passwords leak')];
  fs.writeFileSync(path.join(s.dataDir, 'days', `${DATE}.json`), JSON.stringify({ date: DATE, score: 62, stories }));
  assert.equal((await run(s, client, { now: '2026-11-17T21:00:00.000Z' })).status, 'skipped');
  assert.equal(client.calls.length, 0);
  assert.equal(s.read(`data/editions/${DATE}.json`), before);
  // no key: the key line comes first, as it always does
  assert.deepEqual((await run(s, client, { env: {} })).lines, ['editor: no ANTHROPIC_API_KEY, so no edition written']);
  // an edition the editor wrote itself earlier today is the one it may replace
  const own = setup({ editions: { [DATE]: OLD } });
  assert.equal(readJson(editionPath(own)).by, 'editor');
  const c2 = fakeClient(answer(GOOD));
  assert.equal((await run(own, c2)).status, 'written');
  assert.equal(c2.calls.length, 1);
  const e = readJson(editionPath(own));
  assert.equal(e.by, 'editor');
  assert.equal(e.headline, GOOD.headline);
  assert.ok(!JSON.stringify(e).includes('Old headline'));
  // and tomorrow is a new day: yesterday's hand edition does not stand in the way
  const tomorrow = setup({ editions: { [DATE]: HAND } });
  const fresh = { ...GOOD, date: '2026-11-18', items: ['s04', 's05', 's06', 's07'].map((id, i) => ({ emoji: '\u{1F4C9}', line: `A new line number ${i + 1} about ${id}.`, ids: [id] })) };
  const c3 = fakeClient(answer(fresh));
  fs.writeFileSync(path.join(tomorrow.dataDir, 'days', '2026-11-18.json'), JSON.stringify({ date: '2026-11-18', score: 55, stories: dayStories() }));
  fs.writeFileSync(path.join(tomorrow.root, 'data', 'latest.json'), JSON.stringify({ schema: 1, etDate: '2026-11-18', score: 55, quiet: { quiet: false }, stories: dayStories() }));
  const next = await run(tomorrow, c3, { now: '2026-11-18T15:00:00.000Z' });
  assert.equal(c3.calls.length, 1, 'a new day, so a call');
  assert.equal(next.status, 'written', next.lines.join(' | '));
  assert.equal(readJson(path.join(tomorrow.dataDir, 'editions', '2026-11-18.json')).by, 'editor');
  assert.equal(readJson(editionPath(tomorrow)).by, 'hand', "and today's hand edition is untouched");
});

test('editor: the same answer written twice gives the same file, so a repeat commit has nothing to say', async () => {
  const a = setup();
  const b = setup();
  await run(a, fakeClient(answer(GOOD)));
  await run(b, fakeClient(answer(GOOD)));
  assert.equal(a.read('data/editions/2026-11-17.json'), b.read('data/editions/2026-11-17.json'));
  assert.ok(a.read('data/editions/2026-11-17.json').endsWith('\n'));
});

test('editor: askEditor passes its client the request unchanged and hands back what the client says', async () => {
  const seen = [];
  const client = { beta: { messages: { create: async (r) => (seen.push(r), { ok: true }) } } };
  const out = await askEditor(client, { model: 'm', date: DATE, now: '2:17 PM ET', score: 12, told: ['Label: A line.'], stories: [{ id: 'x' }] });
  assert.deepEqual(out, { ok: true });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].model, 'm');
  assert.equal(JSON.parse(seen[0].messages[0].content).score, 12);
  assert.equal(JSON.parse(seen[0].messages[0].content).now, '2:17 PM ET');
  assert.deepEqual(Object.keys(JSON.parse(seen[0].messages[0].content)), ['date', 'now', 'score', 'told', 'stories']);
  assert.deepEqual(JSON.parse(seen[0].messages[0].content).told, ['Label: A line.']);
  // told is always there, even when the caller has nothing to say
  await askEditor(client, { model: 'm', date: DATE, score: 12, stories: [] });
  assert.deepEqual(JSON.parse(seen[1].messages[0].content).told, []);
});

test('editor: the official SDK is a dependency, and it builds a client without touching the network', async () => {
  const pkg = readJson(path.join(REPO, 'package.json'));
  assert.ok(pkg.dependencies['@anthropic-ai/sdk'], 'the SDK is in dependencies');
  const lock = readJson(path.join(REPO, 'package-lock.json'));
  assert.ok(lock.packages['node_modules/@anthropic-ai/sdk'], 'and in the lockfile');
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: KEY, timeout: 120_000, maxRetries: 2 });
  assert.equal(typeof client.beta.messages.create, 'function');
  const source = fs.readFileSync(path.join(REPO, 'scripts', 'editor.mjs'), 'utf8');
  assert.ok(source.includes("new Anthropic({ timeout: 120_000, maxRetries: 2 })"), 'the client is built the way the brief says');
  assert.ok(!/\bfetch\(/.test(source), 'no hand-made HTTP call');
});

// ---- the newest news: hoursAgo ----------------------------------------------------------------------------

const hoursBefore = (hours, minutes = 0, from = NOW) => new Date(Date.parse(from) - hours * 3600000 - minutes * 60000).toISOString();

test('editor: hoursAgo is whole hours back from now, rounded down, from the later of publishedAt and firstSeenAt, else null, and never below zero', () => {
  const now = Date.parse(NOW);
  assert.equal(hoursAgo({ publishedAt: hoursBefore(3) }, now), 3);
  assert.equal(hoursAgo({ publishedAt: hoursBefore(3, 59) }, now), 3, '3 hours 59 minutes is still 3');
  assert.equal(hoursAgo({ publishedAt: hoursBefore(0, 30) }, now), 0);
  assert.equal(hoursAgo({ publishedAt: NOW }, now), 0, 'this very moment');
  assert.equal(hoursAgo({ publishedAt: hoursBefore(30) }, now), 30, 'more than a day is still counted in hours');
  // publishedAt that is in the future, missing, empty or not a time: firstSeenAt is the time
  const ahead = hoursBefore(-2);
  assert.equal(hoursAgo({ publishedAt: ahead, firstSeenAt: hoursBefore(5) }, now), 5, 'in the future');
  assert.equal(hoursAgo({ firstSeenAt: hoursBefore(5) }, now), 5, 'missing');
  assert.equal(hoursAgo({ publishedAt: null, firstSeenAt: hoursBefore(5) }, now), 5, 'null');
  assert.equal(hoursAgo({ publishedAt: '', firstSeenAt: hoursBefore(5) }, now), 5, 'empty');
  assert.equal(hoursAgo({ publishedAt: 'sometime yesterday', firstSeenAt: hoursBefore(5, 30) }, now), 5, 'not a time');
  // the later of the two wins: a story first seen an hour ago is new, whatever its lead headline says
  assert.equal(hoursAgo({ publishedAt: hoursBefore(4), firstSeenAt: hoursBefore(1) }, now), 1);
  assert.equal(hoursAgo({ publishedAt: hoursBefore(17), firstSeenAt: hoursBefore(0, 20) }, now), 0, 'the Apple outage of 11/17');
  assert.equal(hoursAgo({ publishedAt: hoursBefore(2), firstSeenAt: hoursBefore(6) }, now), 2);
  // neither one: null
  assert.equal(hoursAgo({}, now), null);
  assert.equal(hoursAgo(null, now), null);
  assert.equal(hoursAgo({ publishedAt: ahead }, now), null, 'a future publishedAt and no firstSeenAt');
  assert.equal(hoursAgo({ publishedAt: 'x', firstSeenAt: 'y' }, now), null);
  // never negative, even when firstSeenAt is ahead of the clock
  assert.equal(hoursAgo({ firstSeenAt: ahead }, now), 0);
});

test('editor: every story it sends has hoursAgo, from the later of publishedAt and firstSeenAt, from firstSeenAt when publishedAt is ahead of the clock or missing, and null when both are missing', async () => {
  const stories = [
    story('t1', 'flights', 'United Airlines system outage delays departing flights', { score: 90, publishedAt: hoursBefore(2, 40), firstSeenAt: hoursBefore(1) }),
    story('t2', 'hacks', 'Chase online banking outage lasts for hours', { score: 88, publishedAt: hoursBefore(-1), firstSeenAt: hoursBefore(6) }),
    story('t3', 'internet', 'Cloudflare outage takes down thousands of websites', { score: 86, publishedAt: undefined, firstSeenAt: hoursBefore(9, 59) }),
    story('t4', 'markets', 'Nasdaq falls into a correction after a tech sell-off', { score: 80, publishedAt: undefined, firstSeenAt: undefined }),
  ];
  const s = setup({ stories });
  const client = fakeClient(answer(GOOD));
  await run(s, client);
  const sent = JSON.parse(client.calls[0].messages[0].content).stories;
  const hours = Object.fromEntries(sent.map((x) => [x.id, x.hoursAgo]));
  assert.deepEqual(hours, { t1: 1, t2: 6, t3: 9, t4: null }, 't1 came out 2:40 ago and reached our feeds 1:00 ago');
  for (const one of sent) assert.ok('hoursAgo' in one, `${one.id} has the key, even when it is null`);
  // the clock moves it: an hour later the same story is an hour older
  const later = await run(s, client, { now: hoursBefore(-3) });
  assert.deepEqual(later.lines, ['editor: the stories are the same as at the last call'], 'the same stories: no second call');
  const t = setup({ stories });
  const c2 = fakeClient(answer(GOOD));
  await run(t, c2, { now: hoursBefore(-1) });
  assert.equal(JSON.parse(c2.calls[0].messages[0].content).stories.find((x) => x.id === 't1').hoursAgo, 2);
});

// ---- when the event began: startedHoursAgo -----------------------------------------------------------------

test('editor: startedHoursAgo is whole hours back from publishedAt, from firstSeenAt when publishedAt is missing or ahead of the clock, never under hoursAgo, and null when there is no moment', () => {
  const now = Date.parse(NOW);
  const ahead = hoursBefore(-2);
  // from publishedAt, the first headline, rounded down
  assert.equal(startedHoursAgo({ publishedAt: hoursBefore(3) }, now), 3);
  assert.equal(startedHoursAgo({ publishedAt: hoursBefore(3, 59) }, now), 3, '3 hours 59 minutes is still 3');
  assert.equal(startedHoursAgo({ publishedAt: hoursBefore(0, 30) }, now), 0);
  assert.equal(startedHoursAgo({ publishedAt: NOW }, now), 0, 'this very moment');
  assert.equal(startedHoursAgo({ publishedAt: hoursBefore(30) }, now), 30, 'more than a day is still counted in hours');
  // publishedAt is the start, whatever firstSeenAt says
  assert.equal(startedHoursAgo({ publishedAt: hoursBefore(5), firstSeenAt: hoursBefore(1) }, now), 5);
  assert.equal(startedHoursAgo({ publishedAt: hoursBefore(2), firstSeenAt: hoursBefore(6) }, now), 2);
  // the FAA ground stop: 3:00 PM ET on 11/16, with follow-ups still coming at 2:25 PM ET on 11/17
  const ground = { publishedAt: '2026-11-16T20:00:00.000Z', latestAt: '2026-11-17T19:10:00.000Z', firstSeenAt: '2026-11-16T20:15:00.000Z' };
  const afternoon = Date.parse('2026-11-17T19:25:00.000Z');
  assert.equal(hoursAgo(ground, afternoon), 0, 'its newest headline is minutes old');
  assert.equal(startedHoursAgo(ground, afternoon), 23, 'the event is a day old');
  // publishedAt missing, empty, not a time or in the future: firstSeenAt is the start
  for (const [name, publishedAt] of [['missing', undefined], ['null', null], ['empty', ''], ['not a time', 'sometime yesterday'], ['in the future', ahead]]) {
    assert.equal(startedHoursAgo({ publishedAt, firstSeenAt: hoursBefore(5, 30) }, now), 5, name);
  }
  assert.equal(startedHoursAgo({ firstSeenAt: hoursBefore(5) }, now), 5);
  assert.equal(startedHoursAgo({ firstSeenAt: ahead }, now), 0, 'a firstSeenAt in the future counts as now');
  assert.equal(startedHoursAgo({ publishedAt: ahead, firstSeenAt: ahead }, now), 0);
  // with only a newest headline to go on, the event began at least that long ago
  assert.equal(startedHoursAgo({ latestAt: hoursBefore(3) }, now), 3);
  assert.equal(startedHoursAgo({ publishedAt: ahead, latestAt: hoursBefore(3, 20) }, now), 3);
  assert.equal(startedHoursAgo({ publishedAt: 'x', latestAt: hoursBefore(3, 20), firstSeenAt: 'y' }, now), 3);
  // no moment at all: null, as hoursAgo
  assert.equal(startedHoursAgo({}, now), null);
  assert.equal(startedHoursAgo(null, now), null);
  assert.equal(startedHoursAgo(undefined, now), null);
  assert.equal(startedHoursAgo({ publishedAt: ahead }, now), null, 'a future publishedAt and nothing else');
  assert.equal(startedHoursAgo({ publishedAt: 'x', firstSeenAt: 'y' }, now), null);
  // every mix of the three times: a number exactly when hoursAgo is a number, and never under it
  const times = [undefined, null, 'x', ahead, hoursBefore(0, 10), hoursBefore(2), hoursBefore(17), hoursBefore(30)];
  for (const publishedAt of times) {
    for (const latestAt of times) {
      for (const firstSeenAt of times) {
        const one = { publishedAt, latestAt, firstSeenAt };
        const newest = hoursAgo(one, now);
        const started = startedHoursAgo(one, now);
        if (newest === null) assert.equal(started, null, JSON.stringify(one));
        else assert.ok(Number.isInteger(started) && started >= newest, JSON.stringify(one));
      }
    }
  }
});

test('editor: what it sends has now, the time in New York, and startedHoursAgo on every story, right after hoursAgo', async () => {
  const at = '2026-11-17T19:17:00.000Z'; // 2:17 PM Eastern
  const stories = [
    // the FAA ground stop of 11/16: follow-ups all through 11/17
    story('g1', 'flights', 'United Airlines system outage delays departing flights', { score: 90, publishedAt: '2026-11-16T20:00:00.000Z', latestAt: '2026-11-17T19:10:00.000Z', firstSeenAt: '2026-11-16T20:15:00.000Z' }),
    // the Apple outage: began overnight and is still going
    story('g2', 'internet', 'Cloudflare outage takes down thousands of websites', { score: 88, publishedAt: '2026-11-17T01:00:00.000Z', latestAt: '2026-11-17T19:00:00.000Z', firstSeenAt: '2026-11-17T01:30:00.000Z' }),
    story('g3', 'hacks', 'Chase online banking outage lasts for hours', { score: 86, publishedAt: hoursBefore(-1, 0, at), firstSeenAt: hoursBefore(6, 0, at) }),
    story('g4', 'markets', 'Nasdaq falls into a correction after a tech sell-off', { score: 80, publishedAt: undefined, firstSeenAt: hoursBefore(9, 59, at) }),
    story('g5', 'space', 'Bus-sized asteroid passes between Earth and the Moon', { score: 78, publishedAt: undefined, firstSeenAt: undefined }),
    story('g6', 'grid', 'Rolling blackouts hit regional grid as demand spikes', { score: 70, publishedAt: hoursBefore(2, 0, at), firstSeenAt: hoursBefore(2, 0, at) }),
  ];
  const s = setup({ stories });
  const client = fakeClient(answer(GOOD));
  await run(s, client, { now: at });
  const sent = JSON.parse(client.calls[0].messages[0].content);
  assert.deepEqual(Object.keys(sent), ['date', 'now', 'score', 'told', 'stories']);
  assert.equal(sent.now, '2:17 PM ET');
  const byId = Object.fromEntries(sent.stories.map((x) => [x.id, x]));
  assert.deepEqual(Object.keys(byId.g1), ['id', 'cat', 'title', 'source', 'outlets', 'serious', 'hoursAgo', 'startedHoursAgo']);
  assert.deepEqual(
    Object.fromEntries(Object.entries(byId).map(([id, x]) => [id, [x.hoursAgo, x.startedHoursAgo]])),
    { g1: [0, 23], g2: [0, 18], g3: [6, 6], g4: [9, 9], g5: [null, null], g6: [2, 2] },
    'g1 began yesterday afternoon and has a headline from minutes ago',
  );
  for (const one of sent.stories) assert.ok('startedHoursAgo' in one, `${one.id} has the key, even when it is null`);
  // the clock reads the same way in the morning and after noon, and the day's other hours
  for (const [iso, want] of [['2026-11-17T05:05:00.000Z', '12:05 AM ET'], ['2026-11-17T17:00:00.000Z', '12:00 PM ET'], ['2026-11-17T23:59:00.000Z', '6:59 PM ET']]) {
    const t = setup({ stories });
    const c = fakeClient(answer(GOOD));
    await run(t, c, { now: iso });
    assert.equal(JSON.parse(c.calls[0].messages[0].content).now, want, iso);
  }
});

test('editor: the prompt tells it when an event began and what the time is, that only today counts, and that an event must be real, word for word', () => {
  const p = EDITOR_SYSTEM_PROMPT;
  const shape = '{date, now, score, told, stories: [{id, cat, title, source, outlets, serious, hoursAgo, startedHoursAgo, trending}]}.';
  assert.ok(p.includes(`Input: one day's headlines as JSON: ${shape} now is the time in New York. Many headlines describe the same event.`), 'the shape, then what now is');
  const hours = "hoursAgo is how many hours ago the story's newest headline came out, and startedHoursAgo how many hours ago its first one did.";
  assert.equal(p.split(hours).length, 2, 'once');
  assert.ok(p.includes(`Many headlines describe the same event. ${hours} trending, when present,`), 'where the old hoursAgo sentence was');
  assert.ok(!p.includes('hoursAgo is how many hours ago the story came out.'), 'the old hoursAgo sentence is gone');
  const today =
    "Only today counts: skip an event that was over before today began, even when today's headlines are about it (its cause, an investigation, the cleanup, what changes now, how people coped). startedHoursAgo and now show when it began, and the headlines show whether it is still going on. An event still going on today counts, and so does one that happened again today.";
  const real =
    "Only real events: each needs two or more outlets, one outlet everybody knows, or an official reading (USGS, NOAA, NASA, the FAA, a status page, Downdetector). Skip a lone claim from a site people don't know.";
  assert.equal(p.split(today).length, 2, 'once');
  assert.equal(p.split(real).length, 2, 'once');
  const measured =
    'Flares, solar storms, quakes and asteroids are measured. A headline about one counts only when the input also has a reading of it from NOAA SWPC, USGS or NASA/JPL. Without one, it is about an older one.';
  assert.equal(p.split(measured).length, 2, 'once');
  assert.ok(p.includes(`and an older one only when that leaves fewer than 5. ${today} ${real} ${measured} A trending event that is a near miss always makes the list.`), 'in rule 2, after "fewer than 5.": today, real events, measured events, then the trending rule');
  assert.ok(!p.includes(EM) && !p.includes(String.fromCharCode(0x2013)), 'still no em or en dash');
});

// ---- no repeats: told -------------------------------------------------------------------------------------

const asEdition = (items, over = {}) => ({ date: '2026-11-01', by: 'editor', headline: 'A headline that says one thing about the day. Still here.', items, ...over });
const oneItem = (label, line, i = 0) => ({ emoji: '\u{1F5A5}️', ...(label === null ? {} : { label }), line, ids: [`old${i}`], quiet: false, cat: 'internet', title: `Old ${i}`, url: `https://pub.example/old${i}`, source: 'Pub A', outlets: 2 });

test('editor: told is the items of the two latest editions before today, newest first, as "label: line", the line alone when there is no label', () => {
  const editions = new Map([
    ['2026-11-13', asEdition([oneItem('Too old', 'Three days back.')])],
    ['2026-11-15', asEdition([oneItem('Day before', 'Told on the 15th.'), oneItem(null, 'No label here.'), oneItem('   ', 'Blank label.')], { by: 'hand' })],
    ['2026-11-16', asEdition([oneItem('Bank outage', 'Chase was down for hours.'), oneItem('Quake', 'A 6.6 near Indonesia.')])],
    [DATE, asEdition([oneItem('Today', 'Not told yet.')])],
    ['2026-11-18', asEdition([oneItem('Tomorrow', 'Not yet.')])],
  ]);
  assert.deepEqual(toldBefore(editions, DATE), [
    'Bank outage: Chase was down for hours.',
    'Quake: A 6.6 near Indonesia.',
    'Day before: Told on the 15th.',
    'No label here.',
    'Blank label.',
  ]);
  // an item with no line says nothing, and an edition with no items is not one of the two
  const odd = new Map([
    ['2026-11-14', asEdition([oneItem('Older', 'The older day.')])],
    ['2026-11-15', { date: '2026-11-15', by: 'editor' }],
    ['2026-11-16', asEdition([oneItem('Empty', ''), oneItem('Real', 'A real line.'), null, 'text'])],
  ]);
  assert.deepEqual(toldBefore(odd, DATE), ['Real: A real line.', 'Older: The older day.']);
  assert.deepEqual(toldBefore(new Map(), DATE), []);
  assert.deepEqual(toldBefore(new Map([[DATE, asEdition([oneItem('Today', 'Only today.')])]]), DATE), [], 'today alone tells nothing');
});

test('editor: told holds at most 12, and the newest day is kept first when there are more', () => {
  const day = (tag) => asEdition(Array.from({ length: 8 }, (_, i) => oneItem(`${tag} ${i + 1}`, `Line ${i + 1} of ${tag}.`, i)));
  const editions = new Map([
    ['2026-11-14', day('Oldest')],
    ['2026-11-15', day('Older')],
    ['2026-11-16', day('Newest')],
  ]);
  const told = toldBefore(editions, DATE);
  assert.equal(told.length, 12);
  assert.deepEqual(told.slice(0, 8), Array.from({ length: 8 }, (_, i) => `Newest ${i + 1}: Line ${i + 1} of Newest.`), 'all 8 of the newest edition');
  assert.deepEqual(told.slice(8), Array.from({ length: 4 }, (_, i) => `Older ${i + 1}: Line ${i + 1} of Older.`), 'then as many of the one before as fit');
  assert.ok(!told.some((t) => t.startsWith('Oldest')), 'the third edition back is never read');
});

test('editor: the request carries told from the two editions before today, hand or editor, and nothing from today\'s own edition', async () => {
  const hand = asEdition([oneItem('Bank outage', 'Chase was down for hours on Sunday.', 1), oneItem('Quake', 'A 6.6 quake shook Indonesia.', 2)], { date: '2026-11-15', by: 'hand' });
  const editor = asEdition([oneItem('Cloud outage', 'Cloudflare dropped thousands of sites.', 3), oneItem(null, 'A line with no label.', 4)], { date: '2026-11-16', by: 'editor' });
  const tooOld = asEdition([oneItem('Ancient', 'Told a long time ago.', 5)], { date: '2026-11-10', by: 'editor' });
  const s = setup({ editions: { '2026-11-10': tooOld, '2026-11-15': hand, '2026-11-16': editor, [DATE]: OLD } });
  const client = fakeClient(answer(GOOD));
  const r = await run(s, client);
  assert.equal(r.status, 'written', r.lines.join(' | '));
  const sent = JSON.parse(client.calls[0].messages[0].content);
  assert.deepEqual(sent.told, [
    'Cloud outage: Cloudflare dropped thousands of sites.',
    'A line with no label.',
    'Bank outage: Chase was down for hours on Sunday.',
    'Quake: A 6.6 quake shook Indonesia.',
  ]);
  assert.ok(sent.told.every((t) => typeof t === 'string'));
  assert.ok(!JSON.stringify(sent).includes('Old label') && !JSON.stringify(sent).includes('The old line for'), 'what the editor wrote earlier today is not told');
  assert.ok(!JSON.stringify(sent).includes('Told a long time ago'), 'three editions back is not told');
});

// ---- the money --------------------------------------------------------------------------------------------

const near = (a, b) => Math.abs(a - b) < 1e-9;
const usageOf = (input, output, extra = {}) => ({ input_tokens: input, output_tokens: output, ...extra });
// A different story set each time, so the same-stories rule never gets in the way of the money.
const withExtra = (s, n) => {
  const stories = [...dayStories(), ...Array.from({ length: n }, (_, i) => story(`x${i}`, 'hacks', `Retailer number ${i} confirms a security incident after passwords leak`))];
  fs.writeFileSync(path.join(s.dataDir, 'days', `${DATE}.json`), JSON.stringify({ date: DATE, score: 62, stories }));
};

test('editor: the budget and the prices are in the config: $1.40 a day, and Opus 5.5 per million tokens', () => {
  assert.equal(EDITOR_DAILY_BUDGET_USD, 1.4);
  assert.deepEqual(EDITOR_PRICES, { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 });
  assert.equal(cfg.editor.dailyBudgetUsd, 1.4);
  assert.deepEqual(cfg.editor.prices, EDITOR_PRICES);
  assert.equal(cfg.editor.dailyCap, 20);
  assert.equal(cfg.editor.minGapMinutes, 60);
  assert.equal(cfg.editor.model, EDITOR_MODEL);
  assert.equal(cfg.editor.maxStories, 80);
  assert.equal(cfg.x.dailyBudgetUsd + cfg.editor.dailyBudgetUsd, 2, 'the editor and X together stay inside the owner\'s $2 a day');
});

test('editor: costOf prices input, output, cache writes and cache reads per million tokens, and a missing or odd count costs nothing', () => {
  assert.ok(near(costOf(usageOf(1e6, 0)), 4));
  assert.ok(near(costOf(usageOf(0, 1e6)), 20));
  assert.ok(near(costOf({ cache_creation_input_tokens: 1e6 }), 5));
  assert.ok(near(costOf({ cache_read_input_tokens: 1e6 }), 0.2));
  assert.ok(near(costOf(usageOf(7735, 2413)), 0.0792), 'the first live call: 7735 in, 2413 out');
  assert.ok(near(costOf(usageOf(1000, 500, { cache_creation_input_tokens: 2000, cache_read_input_tokens: 10000 })), 0.026));
  assert.equal(costOf({}), 0);
  assert.equal(costOf(undefined), 0);
  assert.equal(costOf(null), 0);
  assert.equal(costOf('lots'), 0);
  assert.equal(costOf({ input_tokens: 'lots', output_tokens: -5, cache_read_input_tokens: null, cache_creation_input_tokens: NaN }), 0);
  assert.ok(near(costOf(usageOf(1e6, 0), { input: 1, output: 1, cacheWrite: 1, cacheRead: 1 }), 1), 'the prices can be passed in');
});

test('editor: each answered call adds its cost to usd, rounded to 4 decimals, and the written line shows that call\'s cost to 3', async () => {
  const s = setup();
  const first = await run(s, fakeClient(answer(GOOD, { usage: usageOf(7735, 2413) })));
  assert.equal(first.status, 'written');
  assert.deepEqual(first.lines, ['editor: wrote 5 items for 2026-11-17 (7735 in, 2413 out, $0.079)']);
  assert.equal(stateOf(s).usd, 0.0792);
  // two hours later, new stories, a call that used the cache: the cost adds up
  withExtra(s, 1);
  const second = await run(s, fakeClient(answer(GOOD, { usage: usageOf(1000, 500, { cache_creation_input_tokens: 2000, cache_read_input_tokens: 10000 }) })), { now: hoursBefore(-2) });
  assert.equal(second.status, 'written', second.lines.join(' | '));
  assert.deepEqual(second.lines, ['editor: wrote 5 items for 2026-11-17 (1000 in, 500 out, $0.026)'], 'this call, not the total');
  assert.equal(stateOf(s).usd, 0.1052);
  assert.equal(stateOf(s).calls, 2);
  // a long run of small calls stays rounded to 4 decimals
  const t = setup({ state: { date: DATE, calls: 0, usd: 0.1, lastWriteAt: null, lastIdsHash: null } });
  await run(t, fakeClient(answer(GOOD, { usage: usageOf(3, 7) })));
  assert.equal(stateOf(t).usd, 0.1002, '0.1 + 0.000152 is kept to 4 decimals');
  assert.equal(String(stateOf(t).usd).replace(/^\d+\.?/, '').length <= 4, true);
});

test('editor: a refused, cut-off or unreadable answer was still paid for, and a call that threw was not', async () => {
  const paid = [
    ['a refusal', answer('', { stop_reason: 'refusal', usage: usageOf(5000, 0) }), 0.02],
    ['a cut-off answer', answer('{"date":', { stop_reason: 'max_tokens', usage: usageOf(1000, 16000) }), 0.324],
    ['an answer that is not JSON', answer('{ nope', { usage: usageOf(2000, 100) }), 0.01],
    ['an edition that fails its checks', answer(withItems(GOOD.items.slice(0, 2)), { usage: usageOf(2500, 500) }), 0.02],
  ];
  for (const [name, response, usd] of paid) {
    const s = setup({ editions: { [DATE]: OLD } });
    const r = await run(s, fakeClient(response));
    assert.equal(r.status, 'kept', name);
    assert.ok(near(stateOf(s).usd, usd), `${name}: usd is ${stateOf(s).usd}, not ${usd}`);
  }
  // an answer with no usage costs nothing
  const none = setup();
  await run(none, fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(GOOD) }] }));
  assert.equal(stateOf(none).usd, 0);
  // a thrown call: nothing came back, so nothing is added
  const thrown = setup({ state: { date: DATE, calls: 2, usd: 0.3, lastWriteAt: null, lastIdsHash: null } });
  const failed = await run(thrown, fakeClient(() => {
    throw new Error('overloaded');
  }));
  assert.equal(failed.status, 'failed');
  assert.equal(stateOf(thrown).usd, 0.3, 'the same as before');
  assert.equal(stateOf(thrown).calls, 3, 'but it still counts as a call');
});

test('editor: at or over $1.40 it makes no call and says so in one line, and it takes the spend from a state that has none as zero', async () => {
  const at = (usd) => setup({ state: { date: DATE, calls: 3, usd, lastWriteAt: '2026-11-17T10:00:00.000Z', lastIdsHash: 'older' } });
  const cases = [
    [1.4, 'editor: already spent $1.40 today (the cap is $1.40)'],
    [1.4001, 'editor: already spent $1.40 today (the cap is $1.40)'],
    [1.4292, 'editor: already spent $1.43 today (the cap is $1.40)'],
    [2, 'editor: already spent $2.00 today (the cap is $1.40)'],
  ];
  for (const [usd, line] of cases) {
    const s = at(usd);
    const client = fakeClient(answer(GOOD));
    const r = await run(s, client);
    assert.equal(r.status, 'skipped', String(usd));
    assert.deepEqual(r.lines, [line], String(usd));
    assert.equal(client.calls.length, 0, `${usd}: no call`);
    assert.deepEqual(listFiles(path.join(s.dataDir, 'editions')), [], `${usd}: no edition`);
    assert.equal(stateOf(s).calls, 3, `${usd}: nothing is counted`);
  }
  // just under the budget, breaking news still calls (the last $0.25 is its reserve), and the call may end over the budget
  const under = setup({ stories: [...dayStories(), trendingStory()], state: { date: DATE, calls: 3, usd: 1.3999, lastWriteAt: '2026-11-17T10:00:00.000Z', lastIdsHash: 'older' } });
  const c1 = fakeClient(answer(GOOD, { usage: usageOf(1000, 100) }));
  assert.equal((await run(under, c1)).status, 'written');
  assert.equal(c1.calls.length, 1);
  assert.equal(stateOf(under).usd, 1.4059, '1.3999 + 0.006');
  // a state from before this existed has no usd: it counts as zero, and the file gains it
  const old = setup({ state: { date: DATE, calls: 2, lastWriteAt: null, lastIdsHash: null } });
  assert.equal((await run(old, fakeClient(answer(GOOD)))).status, 'written');
  assert.deepEqual(Object.keys(stateOf(old)), ['date', 'calls', 'usd', 'lastWriteAt', 'lastIdsHash', 'lastCallAt', 'breakingCalls', 'bigSent']);
  // a spend that is not a number counts as zero too
  for (const usd of ['lots', null, -4, NaN, {}]) {
    const odd = at(usd);
    assert.equal((await run(odd, fakeClient(answer(GOOD)))).status, 'written', JSON.stringify(usd));
  }
  // the budget comes from the config, and falls back to $1.40 when a config has none
  const small = { ...cfg, editor: { ...cfg.editor, dailyBudgetUsd: 0.05 } };
  const tiny = at(0.05);
  assert.deepEqual((await run(tiny, fakeClient(answer(GOOD)), { config: small })).lines, ['editor: already spent $0.05 today (the cap is $0.05)']);
  const bare = { ...cfg, editor: { model: cfg.editor.model, dailyCap: 20, minGapMinutes: 60, maxStories: 80 } };
  const spent = at(1.4);
  assert.deepEqual((await run(spent, fakeClient(answer(GOOD)), { config: bare })).lines, ['editor: already spent $1.40 today (the cap is $1.40)']);
  const priced = at(0);
  await run(priced, fakeClient(answer(GOOD, { usage: usageOf(1e6, 0) })), { config: bare });
  assert.equal(stateOf(priced).usd, 4, 'and the prices fall back too');
});

test('editor: the day\'s spend stops the day: a breaking call may start under $1.40 and end over it, then every later run skips, and tomorrow starts at zero', async () => {
  const s = setup({ stories: [...dayStories(), trendingStory()], state: { date: DATE, calls: 17, usd: 1.35, lastWriteAt: null, lastIdsHash: null } });
  const costly = () => fakeClient(answer(GOOD, { usage: usageOf(7735, 2413) }));
  assert.equal((await run(s, costly())).status, 'written');
  assert.equal(stateOf(s).usd, 1.4292, 'a call that starts under the budget may end over it');
  withExtra(s, 2);
  const blocked = costly();
  const next = await run(s, blocked, { now: hoursBefore(-2) });
  assert.equal(next.status, 'skipped');
  assert.deepEqual(next.lines, ['editor: already spent $1.43 today (the cap is $1.40)']);
  assert.equal(blocked.calls.length, 0);
  // the next morning: a new day, a new budget, and new stories (yesterday's ids are used up)
  const newDay = dayStories().map((st) => ({ ...st, id: st.id.replace(/^s/, 'n') }));
  fs.writeFileSync(path.join(s.dataDir, 'days', '2026-11-18.json'), JSON.stringify({ date: '2026-11-18', score: 50, stories: newDay }));
  fs.writeFileSync(s.file('data/latest.json'), JSON.stringify({ schema: 1, etDate: '2026-11-18', score: 50, quiet: { quiet: false }, stories: newDay }));
  const forNewDay = withItems(GOOD.items.map((it) => ({ ...it, ids: it.ids.map((id) => id.replace(/^s/, 'n')) })), { date: '2026-11-18' });
  const fresh = fakeClient(answer(forNewDay, { usage: usageOf(7735, 2413) }));
  const morning = await run(s, fresh, { now: '2026-11-18T15:00:00.000Z' });
  assert.equal(fresh.calls.length, 1, 'a call is made');
  assert.equal(morning.status, 'written', morning.lines.join(' | '));
  assert.equal(stateOf(s).date, '2026-11-18');
  assert.equal(stateOf(s).usd, 0.0792, 'only the new day\'s call');
  assert.equal(stateOf(s).calls, 1);
});

// ---- latestAt: a story is as new as its newest headline ------------------------------------------------------------

test('editor: hoursAgo and newestAt take the latest of latestAt, publishedAt and firstSeenAt, skip a latestAt or publishedAt in the future, and ignore one that is not a time', () => {
  const now = Date.parse(NOW);
  const ahead = hoursBefore(-2);
  // the Apple outage of 11/17: lead and first sighting say last night, the newest headline is from half an hour ago
  const apple = { publishedAt: hoursBefore(17), latestAt: hoursBefore(0, 30), firstSeenAt: hoursBefore(16) };
  assert.equal(hoursAgo(apple, now), 0);
  assert.equal(newestAt(apple, now), now - 30 * 60000);
  assert.equal(hoursAgo({ ...apple, latestAt: undefined }, now), 16, 'with no latestAt it is as before');
  // the latest of the three wins, whichever it is
  assert.equal(hoursAgo({ publishedAt: hoursBefore(4), latestAt: hoursBefore(2), firstSeenAt: hoursBefore(3) }, now), 2);
  assert.equal(hoursAgo({ publishedAt: hoursBefore(4), latestAt: hoursBefore(6), firstSeenAt: hoursBefore(5) }, now), 4);
  assert.equal(hoursAgo({ publishedAt: hoursBefore(9), latestAt: hoursBefore(8), firstSeenAt: hoursBefore(1) }, now), 1);
  // a latestAt or publishedAt ahead of the clock is skipped, a firstSeenAt ahead counts as now
  assert.equal(hoursAgo({ publishedAt: hoursBefore(5), latestAt: ahead }, now), 5);
  assert.equal(hoursAgo({ publishedAt: ahead, latestAt: hoursBefore(3) }, now), 3);
  assert.equal(hoursAgo({ latestAt: hoursBefore(3), firstSeenAt: ahead }, now), 0);
  assert.equal(hoursAgo({ latestAt: ahead }, now), null, 'a future latestAt and nothing else');
  // not a time: ignored
  for (const bad of [null, '', 'last night', {}, NaN]) assert.equal(hoursAgo({ publishedAt: hoursBefore(5), latestAt: bad }, now), 5, String(bad));
  assert.equal(hoursAgo({ latestAt: hoursBefore(3, 59) }, now), 3, 'whole hours, rounded down');
  assert.equal(hoursAgo({}, now), null);
  assert.equal(newestAt({}, now), null);
  assert.equal(newestAt(null, now), null);
  assert.equal(newestAt({ firstSeenAt: ahead }, now), now);
});

// ---- the new first, and what is trending -------------------------------------------------------------------------

const CATS = ['flights', 'hacks', 'internet', 'space', 'sun', 'earth', 'markets', 'ai', 'grid', 'germs', 'weather', 'animals'];
const busyDay = (n, over = (i) => ({})) =>
  Array.from({ length: n }, (_, i) =>
    story(`o${String(i).padStart(3, '0')}`, CATS[i % CATS.length], `Cloudflare outage number ${i} knocks thousands of sites offline`, {
      score: 200 - i,
      outlets: 9,
      publishedAt: hoursBefore(10),
      firstSeenAt: hoursBefore(10),
      ...over(i),
    }),
  );
const sentOf = (client) => JSON.parse(client.calls[0].messages[0].content).stories;

test('editor: the new are sent first, and the numbers for it are in the config: 6 hours, 30 stories, 80 in all', () => {
  assert.equal(EDITOR_FRESH_HOURS, 6);
  assert.equal(EDITOR_FRESH_MAX, 30);
  assert.equal(cfg.editor.freshHours, 6);
  assert.equal(cfg.editor.freshMax, 30);
  assert.equal(cfg.editor.maxStories, 80);
});

test('editor: a story with one outlet from 2 hours ago is sent, and sent first, even when 80 older stories outrank it', async () => {
  const fresh = story('new1', 'ai', 'ChatGPT is down for thousands of users', { score: 1, outlets: 1, publishedAt: hoursBefore(2), firstSeenAt: hoursBefore(2) });
  const stories = [...busyDay(85), fresh];
  const before = listingOrder(publishableStories(excluder, stories), cfg.variety);
  assert.ok(before.findIndex((x) => x.id === 'new1') >= 80, 'in the page\'s order it is past the 80');
  const s = setup({ stories });
  const client = fakeClient(answer(GOOD));
  await run(s, client);
  const sent = sentOf(client);
  assert.equal(sent.length, 80);
  assert.equal(sent[0].id, 'new1');
  assert.equal(sent[0].hoursAgo, 2);
  assert.equal(sent[0].outlets, 1);
  assert.deepEqual(sent.slice(1).map((x) => x.id), before.filter((x) => x.id !== 'new1').slice(0, 79).map((x) => x.id), 'then the rest in the order the page lists them');
  assert.equal(new Set(sent.map((x) => x.id)).size, 80, 'each story once');
});

test('editor: the new are every story of 6 hours or less, newest first, at most 30, and the rest come after in the page\'s order, each story once', async () => {
  // 40 stories that came out between 5 minutes and 6 hours ago (none older than 6:59), listed out of order, and 60 older ones
  const fresh = Array.from({ length: 40 }, (_, i) => {
    const minutesAgo = ((i * 17) % 40) * 9 + 5; // 5 .. 356 minutes, every one different
    return story(`f${String(i).padStart(2, '0')}`, CATS[i % CATS.length], `Slack outage number ${i} cuts off thousands of workers`, { score: 10 + i, outlets: 2, publishedAt: hoursBefore(0, minutesAgo), firstSeenAt: hoursBefore(0, minutesAgo) });
  });
  const old = busyDay(60);
  const stories = [...old, ...fresh];
  const listed = listingOrder(publishableStories(excluder, stories), cfg.variety);
  const s = setup({ stories });
  const client = fakeClient(answer(GOOD));
  await run(s, client);
  const sent = sentOf(client);
  const newestFirst = [...fresh].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).map((x) => x.id);
  assert.deepEqual(sent.slice(0, 30).map((x) => x.id), newestFirst.slice(0, 30), 'the 30 newest, newest first');
  for (let i = 1; i < 30; i += 1) assert.ok(sent[i - 1].hoursAgo <= sent[i].hoursAgo, 'never older before newer');
  assert.ok(sent.slice(0, 30).every((x) => x.hoursAgo <= 6));
  const taken = new Set(newestFirst.slice(0, 30));
  assert.deepEqual(sent.slice(30).map((x) => x.id), listed.filter((x) => !taken.has(x.id)).slice(0, 50).map((x) => x.id), 'the other 10 new ones and the old ones, in the page\'s order');
  assert.equal(sent.length, 80);
  assert.equal(new Set(sent.map((x) => x.id)).size, 80);
});

test('editor: a story is new when its newest headline is, whatever its lead says, and a story that was used, has no title or breaks a rule is never sent as new', async () => {
  const apple = story('apple', 'internet', 'Apple outage knocks iCloud and the App Store offline', {
    score: 1,
    outlets: 10,
    publishedAt: hoursBefore(17),
    latestAt: hoursBefore(0, 20),
    firstSeenAt: hoursBefore(17),
  });
  const used = story('usedfresh', 'hacks', 'Chase online banking outage lasts for hours', { publishedAt: hoursBefore(1), firstSeenAt: hoursBefore(1) });
  const rule = story('rulefresh', 'hacks', 'Gunman killed two people in a bank', { publishedAt: hoursBefore(1), firstSeenAt: hoursBefore(1) });
  const blank = story('blankfresh', 'internet', '   ', { publishedAt: hoursBefore(1), firstSeenAt: hoursBefore(1) });
  const earlier = { ...OLD, date: '2026-11-16', items: [{ ...OLD.items[0], ids: ['usedfresh'], best: undefined, line: 'Used line.' }, OLD.items[1], OLD.items[2]].map((x, i) => ({ ...x, ids: i === 0 ? ['usedfresh'] : [`x${i}`] })) };
  const s = setup({ stories: [...busyDay(85), apple, used, rule, blank], editions: { '2026-11-16': earlier } });
  const client = fakeClient(answer(GOOD));
  await run(s, client);
  const sent = sentOf(client);
  assert.equal(sent[0].id, 'apple', 'the newest headline was 20 minutes ago');
  assert.equal(sent[0].hoursAgo, 0);
  for (const gone of ['usedfresh', 'rulefresh', 'blankfresh']) assert.ok(!sent.some((x) => x.id === gone), `${gone} is not sent`);
  assert.equal(sent.length, 80);
});

test('editor: pickStories keeps the page\'s order for a day with nothing new, honours its limits, and never sends a story twice', () => {
  const now = Date.parse(NOW);
  const list = busyDay(100);
  assert.deepEqual(pickStories(list, now).map((x) => x.id), list.slice(0, 80).map((x) => x.id), 'nothing new: the first 80, in the order given');
  assert.equal(pickStories(list, now, { maxStories: 5 }).length, 5);
  assert.deepEqual(pickStories([], now), []);
  const mixed = [list[0], list[1], story('n1', 'ai', 'ChatGPT is down for thousands of users', { publishedAt: hoursBefore(1), firstSeenAt: hoursBefore(1) }), story('n2', 'ai', 'Slack is down for thousands of users', { publishedAt: hoursBefore(0, 10), firstSeenAt: hoursBefore(0, 10) }), story('n3', 'ai', 'Zoom is down for thousands of users', { publishedAt: hoursBefore(7), firstSeenAt: hoursBefore(7) })];
  assert.deepEqual(pickStories(mixed, now).map((x) => x.id), ['n2', 'n1', 'o000', 'o001', 'n3'], 'n3 is 7 hours old: not new');
  assert.deepEqual(pickStories(mixed, now, { freshHours: 7 }).map((x) => x.id), ['n2', 'n1', 'n3', 'o000', 'o001'], 'the hours are a setting');
  assert.deepEqual(pickStories(mixed, now, { freshMax: 1 }).map((x) => x.id), ['n2', 'o000', 'o001', 'n1', 'n3'], 'so is the count: the others wait in the page\'s order');
  // two new stories from the same minute keep the page's order
  const twins = [story('t1', 'ai', 'ChatGPT is down for thousands of users', { publishedAt: hoursBefore(2), firstSeenAt: hoursBefore(2) }), story('t2', 'ai', 'Slack is down for thousands of users', { publishedAt: hoursBefore(2), firstSeenAt: hoursBefore(2) })];
  assert.deepEqual(pickStories(twins, now).map((x) => x.id), ['t1', 't2']);
  assert.deepEqual(pickStories([...twins].reverse(), now).map((x) => x.id), ['t2', 't1']);
});

test('editor: a story that trended is sent with trending as a number, and every other story is sent without the key', async () => {
  const stories = [
    story('tr1', 'internet', 'Apple outage knocks iCloud and the App Store offline', { score: 90, trending: 50000 }),
    story('tr2', 'hacks', 'Chase online banking outage lasts for hours', { score: 80, trending: 500 }),
    story('tr3', 'flights', 'United Airlines system outage delays departing flights', { score: 70 }),
    story('tr4', 'grid', 'Rolling blackouts hit regional grid as demand spikes', { score: 60, trending: 0 }),
    story('tr5', 'space', 'Bus-sized asteroid passes between Earth and the Moon', { score: 50, trending: '50000' }),
    story('tr6', 'sun', 'Solar flare knocks out radio across the Pacific', { score: 40, trending: null }),
  ];
  const s = setup({ stories });
  const client = fakeClient(answer(GOOD));
  await run(s, client);
  const sent = sentOf(client);
  const byId = Object.fromEntries(sent.map((x) => [x.id, x]));
  assert.equal(byId.tr1.trending, 50000);
  assert.equal(typeof byId.tr1.trending, 'number');
  assert.equal(byId.tr2.trending, 500);
  assert.deepEqual(Object.keys(byId.tr1), ['id', 'cat', 'title', 'source', 'outlets', 'serious', 'hoursAgo', 'startedHoursAgo', 'trending'], 'trending is the ninth field, as the prompt says');
  for (const id of ['tr3', 'tr4', 'tr5', 'tr6']) {
    assert.ok(!('trending' in byId[id]), `${id} has no trending key`);
    assert.deepEqual(Object.keys(byId[id]), ['id', 'cat', 'title', 'source', 'outlets', 'serious', 'hoursAgo', 'startedHoursAgo']);
  }
  assert.ok(!client.calls[0].messages[0].content.includes('"trending":null'), 'never a null');
});

test('editor: the prompt tells it what trending is, and that a trending near miss always makes the list, word for word', () => {
  const p = EDITOR_SYSTEM_PROMPT;
  const sentence = 'trending, when present, is how many people in the US searched for the story on Google lately: it is what people are talking about right now.';
  assert.equal(p.split(sentence).length, 2, 'once');
  assert.ok(p.includes(`startedHoursAgo how many hours ago its first one did. ${sentence} told lists`), 'right after the hoursAgo sentences');
  assert.ok(p.includes('stories: [{id, cat, title, source, outlets, serious, hoursAgo, startedHoursAgo, trending}]'), 'the stories list names trending');
  const rule = 'A trending event that is a near miss always makes the list.';
  assert.equal(p.split(rule).length, 2, 'once');
  assert.ok(p.includes(`Without one, it is about an older one. ${rule} Skip any event already in told`), 'in rule 2, after the real and measured rules and before the told rule');
  assert.ok(!p.includes(EM) && !p.includes(String.fromCharCode(0x2013)), 'still no em or en dash');
});

// ---- big news jumps the line ---------------------------------------------------------------------------------------

const minutesAfter = (minutes, from = NOW) => new Date(Date.parse(from) + minutes * 60000).toISOString();
const sentAt = (client, n = 0) => JSON.parse(client.calls[n].messages[0].content).stories;
const putDay = (s, stories) => fs.writeFileSync(path.join(s.dataDir, 'days', `${DATE}.json`), JSON.stringify({ date: DATE, score: 62, stories }));
const BIG_TITLE = 'Apple outage knocks iCloud and the App Store offline';
const FAA_TITLE = 'FAA ground stop at ATL (nationwide)';
const FAA_ID = `sig:faa-stop:ATL:${DATE}`;

// The FAA signal as its source files it: the score is its rank, 8 for a nationwide stop, 4.5 for a hub, 3.5 for any other airport.
const faaStop = (score = 8, over = {}) =>
  story(FAA_ID, 'flights', FAA_TITLE, {
    kind: 'signal',
    source: 'FAA',
    outlets: 1,
    score,
    signal: { type: 'faa-ground-stop', airport: 'ATL', hub: true, nationwide: score >= 8, reason: 'nationwide' },
    ...over,
  });
const quake7 = () =>
  story('sig:quake:q10', 'earth', 'M 7.4 - 80 km SE of Somewhere, Japan', {
    kind: 'signal',
    source: 'USGS',
    outlets: 1,
    score: 6.5,
    quiet: true,
    signal: { type: 'quake', mag: 7.4, place: '80 km SE of Somewhere, Japan', pager: 'red', tsunami: true },
  });

// The day with only the stories given here able to be big: calmDay has none, and the quake of the day scores 4.5.
const withBig = (...extra) => [...calmDay(), ...extra];

// Where a run stands 20 minutes after the last call, which was the first of the day, at 9:40 AM.
const lately = (over = {}) => stateFor({ calls: 1, usd: 0.09, lastCallAt: minutesAfter(-20), ...over });

// One run in a folder of its own.
async function go(stories, state, over = {}) {
  const s = setup({ stories, state });
  const client = fakeClient(answer(GOOD));
  const r = await run(s, client, over);
  return { s, client, r };
}

test('editor: a story trending 50000 that the edition does not have gets a call 20 minutes after the last one, is sent first and goes into bigSent, and 20 minutes later brings no second breaking call', async () => {
  const s = setup({ stories: withBig(trendingStory()), state: lately() });
  const client = fakeClient(answer(GOOD));
  const r = await run(s, client);
  assert.equal(r.status, 'written', r.lines.join(' | '));
  assert.deepEqual(r.lines, [`editor: breaking news: ${BIG_TITLE}`, 'editor: wrote 5 items for 2026-11-17 (1200 in, 300 out, $0.011)'], 'the news line comes before the call');
  assert.equal(client.calls.length, 1);
  const sent = sentAt(client);
  assert.equal(sent[0].id, 'big1', 'sent first');
  assert.equal(sent[0].trending, 50000);
  assert.deepEqual(sent.slice(1).map((x) => x.id), listingOrder(publishableStories(excluder, withBig()), cfg.variety).map((x) => x.id), 'then the day in the page\'s order');
  const st = stateOf(s);
  assert.deepEqual([st.calls, st.breakingCalls, st.bigSent, st.lastCallAt], [2, 1, ['big1'], NOW]);
  // 20 minutes later it is not news again: the editor has been sent it
  const again = await run(s, client, { now: minutesAfter(20) });
  assert.equal(again.status, 'skipped');
  assert.equal(client.calls.length, 1, 'no second breaking call');
  assert.match(again.lines[0], /^editor: next regular call after \d+:\d\d AM ET \(\d+-minute gap; \$1\.05 left for 11 calls\)$/);
  assert.equal(again.lines.length, 1);
  assert.equal(stateOf(s).breakingCalls, 1);
  // and not four hours later either, when a regular call is due: that is a plain call, and the story is still not announced
  const later = await run(s, client, { now: minutesAfter(240) });
  assert.ok(!later.lines.some((l) => l.includes('breaking news')), later.lines.join(' | '));
});

test('editor: the first call of the day is a breaking call when a story is big, and it counts as one', async () => {
  const s = setup({ stories: withBig(trendingStory()) });
  const client = fakeClient(answer(GOOD));
  const r = await run(s, client);
  assert.equal(r.lines[0], `editor: breaking news: ${BIG_TITLE}`);
  assert.deepEqual([stateOf(s).calls, stateOf(s).breakingCalls, stateOf(s).bigSent], [1, 1, ['big1']]);
  // a day with nothing big: a plain first call, announced as nothing
  const calm = setup({ stories: calmDay() });
  const c2 = fakeClient(answer(GOOD));
  const r2 = await run(calm, c2);
  assert.ok(r2.lines.every((l) => !l.includes('breaking')), r2.lines.join(' | '));
  assert.deepEqual([stateOf(calm).calls, stateOf(calm).breakingCalls, stateOf(calm).bigSent], [1, 0, []]);
});

test('editor: a breaking call may spend the reserve and ignores the pacing, but the day\'s budget and the call cap still stop it', async () => {
  const day = withBig(trendingStory());
  // $1.20 spent: no regular call is left, and a breaking one is made
  const reserve = await go(day, lately({ calls: 12, usd: 1.2 }));
  assert.equal(reserve.r.status, 'written', reserve.r.lines.join(' | '));
  assert.equal(reserve.r.lines[0], `editor: breaking news: ${BIG_TITLE}`);
  assert.deepEqual([stateOf(reserve.s).calls, stateOf(reserve.s).breakingCalls], [13, 1]);
  // the same state with nothing big is the regular case, which saves the money
  const calm = await go(calmDay(), lately({ calls: 12, usd: 1.2 }));
  assert.equal(calm.client.calls.length, 0);
  assert.match(calm.r.lines[0], /saved for breaking news/);
  // $1.40 spent: the budget stops it
  const spent = await go(day, lately({ calls: 15, usd: 1.4 }));
  assert.equal(spent.r.status, 'skipped');
  assert.deepEqual(spent.r.lines, ['editor: already spent $1.40 today (the cap is $1.40)']);
  assert.equal(spent.client.calls.length, 0);
  assert.deepEqual([stateOf(spent.s).calls, stateOf(spent.s).breakingCalls], [15, 0]);
  // the call cap stops it too
  const capped = await go(day, lately({ calls: EDITOR_DAILY_CAP, usd: 0.5 }));
  assert.equal(capped.client.calls.length, 0);
  assert.match(capped.r.lines[0], /^editor: already called the API 20 times today \(the cap is 20\)$/);
  // pacing does not apply: $0.95 spent and the last call 20 minutes ago, and a regular call waits for hours
  const wait = await go(calmDay(), lately({ calls: 11, usd: 0.95 }));
  assert.equal(wait.r.status, 'skipped');
  assert.equal(wait.r.lines[0], 'editor: next regular call after 2:27 PM ET (287-minute gap; $0.20 left for 2 calls)');
  const jump = await go(day, lately({ calls: 11, usd: 0.95 }));
  assert.equal(jump.r.status, 'written', jump.r.lines.join(' | '));
  assert.equal(jump.client.calls.length, 1);
  // and the clock gap does not apply either: a regular call waits 60 minutes, a breaking one 15
  const clock = await go(calmDay(), lately({ lastCallAt: minutesAfter(-30) }));
  assert.equal(clock.client.calls.length, 0, 'a regular call 30 minutes after the last one');
  const quick = await go(day, lately({ lastCallAt: minutesAfter(-30) }));
  assert.equal(quick.client.calls.length, 1, 'a breaking call 30 minutes after the last one');
});

test('editor: a breaking call needs 15 minutes since the last call, and the skip line names the time and the story', async () => {
  const s = setup({ stories: withBig(trendingStory()), state: lately({ lastCallAt: minutesAfter(-10) }) });
  const client = fakeClient(answer(GOOD));
  const early = await run(s, client);
  assert.equal(early.status, 'skipped');
  assert.deepEqual(early.lines, [`editor: next breaking call after 10:05 AM ET (15-minute gap): ${BIG_TITLE}`]);
  assert.equal((await run(s, client, { now: minutesAfter(4) })).status, 'skipped', '14 minutes');
  assert.equal(client.calls.length, 0);
  assert.deepEqual([stateOf(s).calls, stateOf(s).breakingCalls], [1, 0], 'a skip counts nothing');
  const on = await run(s, client, { now: minutesAfter(5) });
  assert.equal(on.status, 'written', on.lines.join(' | '));
  assert.equal(client.calls.length, 1, 'exactly 15 minutes is enough');
});

test('editor: a big story that is already in today\'s edition is not breaking, whichever item holds it, and one that is not in it is', async () => {
  const held = (ids) => ({ ...OLD, items: [...OLD.items, { ...OLD.items[1], ids, line: 'The old line for the big one.' }] });
  for (const ids of [['big1'], ['s04', 'big1']]) {
    const s = setup({ stories: withBig(trendingStory()), editions: { [DATE]: held(ids) }, state: lately() });
    const client = fakeClient(answer(GOOD));
    const r = await run(s, client);
    assert.equal(r.status, 'skipped', ids.join());
    assert.equal(client.calls.length, 0);
    assert.match(r.lines[0], /^editor: next regular call after /);
    assert.deepEqual([stateOf(s).calls, stateOf(s).breakingCalls], [1, 0]);
  }
  // the same day with the edition on file holding other stories only: breaking
  const control = setup({ stories: withBig(trendingStory()), editions: { [DATE]: OLD }, state: lately() });
  const c = fakeClient(answer(GOOD));
  const r2 = await run(control, c);
  assert.equal(r2.lines[0], `editor: breaking news: ${BIG_TITLE}`);
  assert.equal(c.calls.length, 1);
});

test('editor: a signal scoring 5 or more is breaking, a signal scoring less is not, and a news story is never big by its score', async () => {
  const hit = await go(withBig(faaStop(8)), lately());
  assert.equal(hit.r.status, 'written', hit.r.lines.join(' | '));
  assert.equal(hit.r.lines[0], `editor: breaking news: ${FAA_TITLE}`);
  assert.equal(sentAt(hit.client)[0].id, FAA_ID);
  assert.deepEqual(stateOf(hit.s).bigSent, [FAA_ID]);
  // 5 is enough, and so is a quake of 7
  assert.equal((await go(withBig(faaStop(5)), lately())).r.lines[0], `editor: breaking news: ${FAA_TITLE}`);
  assert.equal((await go(withBig(quake7()), lately())).r.lines[0], 'editor: breaking news: M 7.4 - 80 km SE of Somewhere, Japan');
  // 4.9, the quake of the day (6.6 scores 4.5) and a news story scoring 8 are not
  const news8 = story('n8', 'internet', BIG_TITLE, { score: 8, outlets: 1 });
  for (const [label, extra] of [['a signal of 4.9', faaStop(4.9)], ['a hub ground stop', faaStop(4.5)], ['a news story of 8', news8]]) {
    const x = await go(withBig(extra), lately());
    assert.equal(x.r.status, 'skipped', label);
    assert.equal(x.client.calls.length, 0, label);
    assert.match(x.r.lines[0], /^editor: next regular call after /, label);
  }
  assert.ok(withBig().some((x) => x.id === 'sig:quake:q9'), 'the quake of the day is in every one of these days');
});

test('editor: a story in 9 outlets that first reached our feeds an hour ago is breaking, one from 5 hours ago is not, and neither is one in 7 outlets', async () => {
  const cases = [
    ['9 outlets first seen 1 hour ago', 9, hoursBefore(1), true],
    ['8 outlets first seen 1 hour ago', 8, hoursBefore(1), true],
    ['9 outlets first seen 2 hours 59 minutes ago', 9, hoursBefore(2, 59), true],
    ['9 outlets first seen 5 hours ago', 9, hoursBefore(5), false],
    ['9 outlets first seen exactly 3 hours ago', 9, hoursBefore(3), false],
    ['7 outlets first seen 1 hour ago', 7, hoursBefore(1), false],
  ];
  for (const [label, outlets, seen, breaking] of cases) {
    const crowd = story('crowd1', 'internet', BIG_TITLE, { score: 3, outlets, publishedAt: seen, firstSeenAt: seen });
    const x = await go(withBig(crowd), lately());
    if (breaking) {
      assert.equal(x.r.status, 'written', `${label}: ${x.r.lines.join(' | ')}`);
      assert.equal(x.r.lines[0], `editor: breaking news: ${BIG_TITLE}`, label);
      assert.equal(sentAt(x.client)[0].id, 'crowd1', label);
      assert.deepEqual(stateOf(x.s).bigSent, ['crowd1'], label);
    } else {
      assert.equal(x.r.status, 'skipped', label);
      assert.equal(x.client.calls.length, 0, label);
    }
  }
});

test('editor: the same stories as at the last call, but one has grown big: it calls, and without that it does not', async () => {
  const s = setup({ stories: withBig(trendingStory({ trending: 500 })) });
  const client = fakeClient(answer(GOOD));
  assert.equal((await run(s, client)).status, 'written', 'the first call of the day, with the story still small');
  // two hours later, nothing changed: the same stories, so no call
  const same = await run(s, client, { now: minutesAfter(120) });
  assert.deepEqual(same.lines, ['editor: the stories are the same as at the last call']);
  assert.equal(client.calls.length, 1);
  // 20 minutes after the call the story has grown to 50000 searches: the same ids, and it calls
  putDay(s, withBig(trendingStory()));
  const grown = await run(s, client, { now: minutesAfter(20) });
  assert.equal(grown.status, 'written', grown.lines.join(' | '));
  assert.equal(grown.lines[0], `editor: breaking news: ${BIG_TITLE}`);
  assert.equal(client.calls.length, 2);
  assert.deepEqual(sentAt(client, 1).map((x) => x.id).sort(), sentAt(client, 0).map((x) => x.id).sort(), 'the ids are the same');
  assert.equal(sentAt(client, 1)[0].id, 'big1', 'and now it comes first');
  assert.equal(sentAt(client, 1)[0].trending, 50000);
  // a day that never grows big is the plain skip
  const t = setup({ stories: withBig(trendingStory({ trending: 500 })) });
  const c2 = fakeClient(answer(GOOD));
  await run(t, c2);
  assert.equal((await run(t, c2, { now: minutesAfter(20) })).status, 'skipped');
  assert.equal(c2.calls.length, 1);
});

test('editor: at most 6 breaking calls a day: the sixth is made, the seventh is not, and the log says the six are used', async () => {
  const stories = withBig(trendingStory());
  const fifth = await go(stories, lately({ calls: 6, usd: 0.5, breakingCalls: 5 }));
  assert.equal(fifth.r.status, 'written', fifth.r.lines.join(' | '));
  assert.equal(stateOf(fifth.s).breakingCalls, 6);
  const seventh = await go(stories, lately({ calls: 7, usd: 0.5, breakingCalls: 6 }));
  assert.equal(seventh.r.status, 'skipped');
  assert.equal(seventh.client.calls.length, 0);
  assert.match(seventh.r.lines[0], /^editor: next regular call after \d+:\d\d [AP]M ET \(\d+-minute gap; \$0\.\d\d left for \d+ calls?\), and today's 6 breaking calls are used$/);
  assert.equal(stateOf(seventh.s).breakingCalls, 6);
  // with no regular money either, the line is the saved one, and it still says the six are used
  const poor = await go(stories, lately({ calls: 12, usd: 1.2, breakingCalls: 6 }));
  assert.equal(poor.r.lines[0], "editor: no regular call, the rest of today's money is saved for breaking news ($1.20 spent of $1.40), and today's 6 breaking calls are used");
  // a day with no big story says nothing about it
  const calm = await go(calmDay(), lately({ calls: 12, usd: 1.2, breakingCalls: 6 }));
  assert.equal(calm.r.lines[0], "editor: no regular call, the rest of today's money is saved for breaking news ($1.20 spent of $1.40)");
  // the six are a day's: a new day starts at none
  const yesterday = await go(stories, lately({ date: '2026-11-16', calls: 9, usd: 1, breakingCalls: 6, lastCallAt: '2026-11-17T04:00:00.000Z' }));
  assert.equal(yesterday.r.lines[0], `editor: breaking news: ${BIG_TITLE}`);
  assert.deepEqual([stateOf(yesterday.s).date, stateOf(yesterday.s).calls, stateOf(yesterday.s).breakingCalls], [DATE, 1, 1]);
});

test('editor: with two big stories the log names the first in the page\'s order, and both are sent first, in that order, ahead of the rest', async () => {
  // the signal scores 8 and the trending story 3, so the page lists the signal first
  const a = await go(withBig(trendingStory(), faaStop(8)), lately());
  assert.equal(a.r.lines[0], `editor: breaking news: ${FAA_TITLE}`);
  assert.deepEqual(sentAt(a.client).slice(0, 2).map((x) => x.id), [FAA_ID, 'big1']);
  assert.equal(sentAt(a.client).length, 12);
  assert.deepEqual(stateOf(a.s).bigSent.sort(), [FAA_ID, 'big1'].sort());
  // with the trending story scoring 95 it is the first, and is the one named
  const b = await go(withBig(trendingStory({ score: 95 }), faaStop(8)), lately());
  assert.equal(b.r.lines[0], `editor: breaking news: ${BIG_TITLE}`);
  assert.deepEqual(sentAt(b.client).slice(0, 2).map((x) => x.id), ['big1', FAA_ID]);
  // the big stories are announced once, in one line
  assert.equal(b.r.lines.filter((l) => l.includes('breaking news')).length, 1);
});

test('editor: big stories are sent first, ahead of the new ones, even when 85 older stories outrank them, and the 80 limit holds', async () => {
  const fresh = story('new1', 'ai', 'ChatGPT is down for thousands of users', { score: 1, outlets: 1, publishedAt: hoursBefore(2), firstSeenAt: hoursBefore(2) });
  const big = trendingStory({ publishedAt: hoursBefore(10), firstSeenAt: hoursBefore(10) });
  const stories = [...busyDay(85), fresh, big];
  const before = listingOrder(publishableStories(excluder, stories), cfg.variety);
  assert.ok(before.findIndex((x) => x.id === 'big1') >= 80, 'in the page\'s order it is past the 80');
  const x = await go(stories, lately());
  assert.equal(x.r.lines[0], `editor: breaking news: ${BIG_TITLE}`);
  const sent = sentAt(x.client);
  assert.equal(sent.length, 80);
  assert.deepEqual(sent.slice(0, 2).map((s) => s.id), ['big1', 'new1'], 'the big one, then the new one');
  assert.equal(new Set(sent.map((s) => s.id)).size, 80, 'each story once');
  assert.deepEqual(sent.slice(2).map((s) => s.id), before.filter((s) => s.id !== 'big1' && s.id !== 'new1').slice(0, 78).map((s) => s.id), 'then the rest in the page\'s order');
});

test('editor: a call that is not a breaking call sends big stories first too, and remembers them', async () => {
  // the six breaking calls are used and a regular call is due: a plain call, with the big story first
  const six = await go(withBig(trendingStory()), lately({ calls: 8, usd: 0.5, breakingCalls: 6, lastCallAt: et(7, 0) }));
  assert.equal(six.r.status, 'written', six.r.lines.join(' | '));
  assert.ok(six.r.lines.every((l) => !l.includes('breaking news')), 'a regular call is not announced');
  assert.equal(sentAt(six.client)[0].id, 'big1');
  assert.deepEqual([stateOf(six.s).breakingCalls, stateOf(six.s).bigSent], [6, ['big1']]);
  // a big story that is in today's edition is not breaking, and a call that is due sends it first and remembers it all the same
  const held = { ...OLD, items: [...OLD.items, { ...OLD.items[1], ids: ['big1'], line: 'The old line for the big one.' }] };
  const s = setup({ stories: withBig(trendingStory()), editions: { [DATE]: held }, state: lately({ lastCallAt: et(7, 0) }) });
  const client = fakeClient(answer(GOOD));
  const r = await run(s, client);
  assert.equal(r.status, 'written', r.lines.join(' | '));
  assert.ok(r.lines.every((l) => !l.includes('breaking news')));
  assert.equal(sentAt(client)[0].id, 'big1');
  assert.deepEqual([stateOf(s).breakingCalls, stateOf(s).bigSent], [0, ['big1']]);
});

test('editor: a breaking call that threw read nothing and is tried again 15 minutes later, and one that was answered but kept is not', async () => {
  const stories = withBig(trendingStory());
  const s = setup({ stories, state: lately() });
  const throwing = fakeClient(() => {
    throw new Error('overloaded');
  });
  const first = await run(s, throwing);
  assert.equal(first.status, 'failed');
  assert.deepEqual(first.lines, [`editor: breaking news: ${BIG_TITLE}`, 'editor: the call failed (overloaded), kept the current edition']);
  assert.deepEqual([stateOf(s).calls, stateOf(s).breakingCalls, stateOf(s).bigSent], [2, 1, []]);
  const soon = await run(s, throwing, { now: minutesAfter(10) });
  assert.deepEqual(soon.lines, [`editor: next breaking call after 10:15 AM ET (15-minute gap): ${BIG_TITLE}`]);
  const good = fakeClient(answer(GOOD));
  const retry = await run(s, good, { now: minutesAfter(15) });
  assert.equal(retry.status, 'written', retry.lines.join(' | '));
  assert.deepEqual([stateOf(s).calls, stateOf(s).breakingCalls, stateOf(s).bigSent], [3, 2, ['big1']]);
  // an answer that broke the checks was read, so the big story is not news again
  const t = setup({ stories, state: lately() });
  const kept = fakeClient(answer('not json'));
  assert.equal((await run(t, kept)).status, 'kept');
  assert.deepEqual(stateOf(t).bigSent, ['big1']);
  const after = await run(t, kept, { now: minutesAfter(20) });
  assert.equal(after.status, 'skipped');
  assert.equal(kept.calls.length, 1);
  assert.match(after.lines[0], /^editor: next regular call after /);
});

test('editor: bigSent keeps the newest 200 ids and starts again empty on a new day', async () => {
  const stories = withBig(trendingStory());
  const old = Array.from({ length: 200 }, (_, i) => `old${String(i).padStart(3, '0')}`);
  const full = await go(stories, lately({ bigSent: old }));
  assert.equal(full.r.status, 'written', full.r.lines.join(' | '));
  const kept = stateOf(full.s).bigSent;
  assert.equal(kept.length, 200);
  assert.equal(kept[199], 'big1', 'the newest is last');
  assert.equal(kept[0], 'old001', 'the oldest went');
  // the number is a setting
  const small = { ...cfg, editor: { ...cfg.editor, bigSentMax: 3 } };
  const t = await go(stories, lately({ bigSent: ['a', 'b', 'c'] }), { config: small });
  assert.deepEqual(stateOf(t.s).bigSent, ['b', 'c', 'big1']);
  // a new day: yesterday's list and count do not carry over, so the story is breaking again, and the list holds only today's
  const u = await go(stories, lately({ date: '2026-11-16', calls: 9, usd: 1.1, breakingCalls: 6, bigSent: ['big1', 'old000'], lastCallAt: '2026-11-17T04:30:00.000Z' }));
  assert.equal(u.r.lines[0], `editor: breaking news: ${BIG_TITLE}`);
  assert.deepEqual([stateOf(u.s).date, stateOf(u.s).calls, stateOf(u.s).breakingCalls, stateOf(u.s).bigSent], [DATE, 1, 1, ['big1']]);
});

test('editor: only the big stories that were sent are remembered: with room for 2 and 3 big stories, the third is breaking at the next call', async () => {
  const small = { ...cfg, editor: { ...cfg.editor, maxStories: 2 } };
  const stories = withBig(trendingStory(), faaStop(8), quake7());
  const x = await go(stories, lately(), { config: small });
  assert.deepEqual(sentAt(x.client).map((s) => s.id), [FAA_ID, 'sig:quake:q10'], 'the first two in the page\'s order');
  assert.deepEqual(stateOf(x.s).bigSent, [FAA_ID, 'sig:quake:q10']);
  const next = await run(x.s, x.client, { config: small, now: minutesAfter(20) });
  assert.equal(next.lines[0], `editor: breaking news: ${BIG_TITLE}`, 'the one that did not fit is still news');
});

test('editor: the gap is counted from the last call, not the last write: written 3 hours ago, called 20 minutes ago, and no regular call yet', async () => {
  const x = await go(calmDay(), lately({ lastWriteAt: minutesAfter(-180) }));
  assert.equal(x.r.status, 'skipped');
  assert.equal(x.client.calls.length, 0);
  // and the other way round: a write 20 minutes ago with a last call 3 hours ago is a call whose time has come
  const y = await go(calmDay(), lately({ lastWriteAt: minutesAfter(-20), lastCallAt: minutesAfter(-180) }));
  assert.equal(y.r.status, 'written', y.r.lines.join(' | '));
});

test('editor: odd values in the new state keys are read as empty or zero, and the run goes on', async () => {
  const stories = withBig(trendingStory());
  const a = await go(stories, lately({ bigSent: 'big1' }));
  assert.equal(a.r.lines[0], `editor: breaking news: ${BIG_TITLE}`, 'a bigSent that is not a list is empty');
  const b = await go(stories, lately({ bigSent: [1, null, 'big1', {}] }));
  assert.equal(b.r.status, 'skipped', 'only the strings count, and big1 was sent');
  const f = await go(stories, lately({ bigSent: [1, null, 'old1', {}] }));
  assert.deepEqual(stateOf(f.s).bigSent, ['old1', 'big1'], 'and only the strings are kept');
  const c = await go(stories, lately({ breakingCalls: 'many' }));
  assert.equal(stateOf(c.s).breakingCalls, 1);
  const d = await go(stories, lately({ breakingCalls: -3 }));
  assert.equal(stateOf(d.s).breakingCalls, 1, 'a count below zero is zero');
  const e = await go(stories, lately({ lastCallAt: 'sometime', lastWriteAt: minutesAfter(-10) }));
  assert.deepEqual(e.r.lines, [`editor: next breaking call after 10:05 AM ET (15-minute gap): ${BIG_TITLE}`], 'a last call that is no time: the last write stands in');
});

test('editor: the big news numbers are settings that reach the editor through cfg.editor, and a config without them uses the constants', async () => {
  const tweak = (over) => ({ ...cfg, editor: { ...cfg.editor, ...over } });
  const crowd = (hours, outlets) => story('crowd1', 'internet', BIG_TITLE, { score: 3, outlets, publishedAt: hoursBefore(hours), firstSeenAt: hoursBefore(hours) });
  const named = `editor: breaking news: ${BIG_TITLE}`;
  // searches
  assert.equal((await go(withBig(trendingStory()), lately(), { config: tweak({ breakingTrending: 60000 }) })).r.status, 'skipped', 'a bar of 60000 is not met by 50000');
  assert.equal((await go(withBig(trendingStory({ trending: 500 })), lately(), { config: tweak({ breakingTrending: 400 }) })).r.lines[0], named);
  // signal score
  assert.equal((await go(withBig(faaStop(4.5)), lately(), { config: tweak({ breakingSignalScore: 4.5 }) })).r.lines[0], `editor: breaking news: ${FAA_TITLE}`);
  assert.equal((await go(withBig(faaStop(8)), lately(), { config: tweak({ breakingSignalScore: 9 }) })).r.status, 'skipped');
  // outlets and how new
  assert.equal((await go(withBig(crowd(1, 5)), lately(), { config: tweak({ breakingOutlets: 5 }) })).r.lines[0], named);
  assert.equal((await go(withBig(crowd(5, 9)), lately(), { config: tweak({ breakingNewHours: 6 }) })).r.lines[0], named);
  assert.equal((await go(withBig(crowd(1, 9)), lately(), { config: tweak({ breakingNewHours: 1 }) })).r.status, 'skipped', 'exactly 1 hour is not under 1 hour');
  // the breaking gap
  const gap = await go(withBig(trendingStory()), lately(), { config: tweak({ breakingGapMinutes: 30 }) });
  assert.deepEqual(gap.r.lines, [`editor: next breaking call after 10:10 AM ET (30-minute gap): ${BIG_TITLE}`]);
  // the number of breaking calls, with the singular in the line
  const one = await go(withBig(trendingStory()), lately({ breakingCalls: 1 }), { config: tweak({ breakingMax: 1 }) });
  assert.equal(one.r.status, 'skipped');
  assert.match(one.r.lines[0], /, and today's 1 breaking call is used$/);
  // the budget: at $1.40 spent a breaking call is stopped, and with a budget of $2 it is made
  assert.equal((await go(withBig(trendingStory()), lately({ calls: 15, usd: 1.4 }), { config: tweak({ dailyBudgetUsd: 2 }) })).r.status, 'written');
  // a config with none of the new keys uses the constants
  const bare = { ...cfg, editor: { model: cfg.editor.model, dailyCap: cfg.editor.dailyCap, minGapMinutes: cfg.editor.minGapMinutes, maxStories: cfg.editor.maxStories } };
  const hit = await go(withBig(trendingStory()), lately(), { config: bare });
  assert.equal(hit.r.lines[0], named);
  assert.equal(stateOf(hit.s).breakingCalls, 1);
  const early = await go(withBig(trendingStory()), lately({ lastCallAt: minutesAfter(-10) }), { config: bare });
  assert.equal(early.r.lines[0], `editor: next breaking call after 10:05 AM ET (15-minute gap): ${BIG_TITLE}`);
  const calm = await go(calmDay(), lately({ calls: 12, usd: 1.2 }), { config: bare });
  assert.match(calm.r.lines[0], /^editor: no regular call, the rest of today's money is saved for breaking news \(\$1\.20 spent of \$1\.40\)$/);
});

test('editor: isBig is 20000 searches, a signal scoring 5, or 8 outlets that first reached our feeds under 3 hours ago, and nothing else', () => {
  const now = Date.parse(NOW);
  const mk = (over = {}) => story('x1', 'internet', BIG_TITLE, { outlets: 1, score: 3, firstSeenAt: hoursBefore(10), publishedAt: hoursBefore(10), ...over });
  assert.equal(isBig(mk(), now), false, 'a plain story');
  // searches
  assert.equal(isBig(mk({ trending: 20000 }), now), true);
  assert.equal(isBig(mk({ trending: 19999 }), now), false);
  assert.equal(isBig(mk({ trending: 1000000 }), now), true);
  for (const odd of ['50000', null, undefined, NaN, Infinity, {}]) assert.equal(isBig(mk({ trending: odd }), now), false, String(odd));
  // signals
  assert.equal(isBig(mk({ kind: 'signal', score: 5 }), now), true);
  assert.equal(isBig(mk({ kind: 'signal', score: 4.9 }), now), false);
  assert.equal(isBig(mk({ kind: 'signal', score: '8' }), now), false, 'a string is no score');
  assert.equal(isBig(mk({ kind: 'news', score: 90 }), now), false, 'a news score is a rank, not a severity');
  // outlets, while new
  const seen = (outlets, hours, minutes = 0) => mk({ outlets, firstSeenAt: hoursBefore(hours, minutes) });
  assert.equal(isBig(seen(8, 1), now), true);
  assert.equal(isBig(seen(7, 1), now), false);
  assert.equal(isBig(seen(9, 2, 59), now), true, 'under 3 hours');
  assert.equal(isBig(seen(9, 3), now), false, 'exactly 3 hours is not under 3 hours');
  assert.equal(isBig(seen(9, 5), now), false);
  assert.equal(isBig(mk({ outlets: 9, firstSeenAt: hoursBefore(-1) }), now), true, 'a firstSeenAt in the future counts as now');
  assert.equal(isBig(mk({ outlets: 9, firstSeenAt: undefined }), now), false, 'no firstSeenAt: no way to tell it is new');
  assert.equal(isBig(mk({ outlets: 9, firstSeenAt: 'not a time' }), now), false);
  assert.equal(isBig(mk({ outlets: 9, firstSeenAt: hoursBefore(10), publishedAt: hoursBefore(1), latestAt: hoursBefore(0, 5) }), now), false, 'only firstSeenAt counts');
  assert.equal(isBig(mk({ outlets: 9, firstSeenAt: Date.parse(hoursBefore(1)) }), now), true, 'a time as a number is a time');
  // nothing
  for (const nothing of [null, undefined, 'story', 7, []]) assert.equal(isBig(nothing, now), false);
  // the rules are settings
  assert.equal(isBig(mk({ trending: 100 }), now, { breakingTrending: 100 }), true);
  assert.equal(isBig(mk({ kind: 'signal', score: 3 }), now, { breakingSignalScore: 3 }), true);
  assert.equal(isBig(seen(5, 1), now, { breakingOutlets: 5 }), true);
  assert.equal(isBig(seen(9, 5), now, { breakingNewHours: 6 }), true);
  assert.equal(isBig(mk({ trending: 50000 }), now, { breakingTrending: 60000 }), false);
});
