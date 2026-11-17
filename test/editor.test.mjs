// The editor (npm run edit): it writes today's edition with the Claude API and never
// fails a run. Every case here uses a fake client, so nothing leaves the machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config, EDITOR_DAILY_CAP, EDITOR_MAX_STORIES, EDITOR_MIN_GAP_MINUTES, EDITOR_MODEL } from '../scripts/config.mjs';
import { createGatekeeper } from '../scripts/lib/pipeline.mjs';
import { listingOrder, publishableStories, validateEdition } from '../scripts/lib/editions.mjs';
import { EDITOR_SYSTEM_PROMPT } from '../scripts/lib/editor-prompt.mjs';
import { EDITION_SCHEMA, askEditor, runEditor } from '../scripts/editor.mjs';
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

const QUAKE = story('sig:quake:q9', 'earth', 'M 6.6 - 148 km WSW of Tual, Indonesia', {
  kind: 'signal',
  source: 'USGS',
  outlets: 1,
  score: 45,
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
  headline: 'Planes late. Banks down. Servers back. Still here.',
  best: 's03',
  items: [
    { emoji: '✈️', line: 'United systems went down for an hour and departures were delayed.', ids: ['s01'] },
    { emoji: '\u{1F3E6}', line: 'Chase online banking was down for hours on Monday.', ids: ['s02'] },
    { emoji: '\u{1F5A5}️', line: 'Cloudflare went down and took thousands of sites with it.', ids: ['s03', 's07'] },
    { emoji: '\u{1F4C9}', line: 'The Nasdaq fell into a correction. Line went down. It usually comes back.', ids: ['s04'] },
    { emoji: '☄️', line: 'A bus-sized asteroid passed between Earth and the Moon. It missed.', ids: ['s05'] },
  ],
};
const withItems = (items, over = {}) => ({ ...GOOD, items, ...over });

// An edition the editor wrote earlier today, and the same one written by hand.
const OLD = {
  date: DATE,
  by: 'editor',
  writtenAt: '2026-11-17T09:00:00.000Z',
  headline: 'Old headline here. Still here.',
  items: ['s01', 's02', 's03'].map((id) => ({
    emoji: '\u{1F5A5}️',
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

const HAND = { ...OLD, by: 'hand', headline: 'Hand written headline here. Still here.' };

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

test('editor: after the daily cap of calls it stops, and a new day starts at zero', async () => {
  assert.equal(EDITOR_DAILY_CAP, 12);
  assert.equal(cfg.editor.dailyCap, 12);
  const s = setup({ state: { date: DATE, calls: EDITOR_DAILY_CAP, lastWriteAt: null, lastIdsHash: null } });
  const client = fakeClient(answer(GOOD));
  const r = await run(s, client);
  assert.equal(r.status, 'skipped');
  assert.equal(client.calls.length, 0);
  assert.match(r.lines[0], /already called the API 12 times today \(the cap is 12\)/);
  // yesterday's count does not carry over
  const fresh = setup({ state: { date: '2026-11-16', calls: EDITOR_DAILY_CAP, lastWriteAt: '2026-11-16T22:00:00.000Z', lastIdsHash: 'abc' } });
  const next = fakeClient(answer(GOOD));
  assert.equal((await run(fresh, next)).status, 'written');
  assert.deepEqual(stateOf(fresh).calls, 1);
  assert.equal(stateOf(fresh).date, DATE);
  // the cap counts calls, successful or not: three calls with a cap of two
  const small = { ...cfg, editor: { ...cfg.editor, dailyCap: 2, minGapMinutes: 0 } };
  const t = setup();
  const failing = fakeClient(() => answer('not json'));
  const days = [dayStories(), [...dayStories(), story('s10', 'hacks', 'Retailer confirms security incident after passwords leak')], [...dayStories(), story('s10', 'hacks', 'Retailer confirms security incident after passwords leak'), story('s11', 'grid', 'Thousands without power after substation failure')]];
  const lines = [];
  for (const stories of days) {
    fs.writeFileSync(path.join(t.dataDir, 'days', `${DATE}.json`), JSON.stringify({ date: DATE, score: 62, stories }));
    lines.push((await run(t, failing, { config: small })).status);
  }
  assert.deepEqual(lines, ['kept', 'kept', 'skipped'], 'two failed calls use up a cap of two');
  assert.equal(failing.calls.length, 2);
  assert.equal(stateOf(t).calls, 2);
});

test('editor: it waits 120 minutes after a write, and not a minute less, so a day\'s 12 calls spread over 24 hours', async () => {
  assert.equal(EDITOR_MIN_GAP_MINUTES, 120);
  assert.equal(cfg.editor.minGapMinutes, 120);
  assert.equal(EDITOR_DAILY_CAP * EDITOR_MIN_GAP_MINUTES, 24 * 60);
  const lastWriteAt = '2026-11-17T13:00:00.000Z';
  const base = { date: DATE, calls: 1, lastWriteAt, lastIdsHash: 'older' };
  const s = setup({ state: base });
  const client = fakeClient(answer(GOOD));
  const early = await run(s, client, { now: '2026-11-17T14:59:00.000Z' }); // 119 minutes
  assert.equal(early.status, 'skipped');
  assert.equal(client.calls.length, 0);
  assert.match(early.lines[0], /last edition was written 119 minutes ago, waiting 120 between writes/);
  const exactly = await run(s, client, { now: '2026-11-17T15:00:00.000Z' }); // 120 minutes
  assert.equal(exactly.status, 'written');
  assert.equal(client.calls.length, 1);
  // a failed call is not a write, so it does not start the wait
  const t = setup({ state: base });
  const failing = fakeClient(() => {
    throw new Error('overloaded');
  });
  assert.equal((await run(t, failing)).status, 'failed');
  assert.equal(stateOf(t).lastWriteAt, lastWriteAt, 'the last write time only moves on a write');
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

test('editor: the request has the shape the API wants, and each story is sent with six plain fields', async () => {
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
  assert.deepEqual(Object.keys(sent), ['date', 'score', 'stories']);
  assert.equal(sent.date, DATE);
  assert.equal(sent.score, 62);
  for (const one of sent.stories) assert.deepEqual(Object.keys(one), ['id', 'cat', 'title', 'source', 'outlets', 'serious']);
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
  assert.deepEqual(Object.keys(EDITION_SCHEMA.properties).sort(), ['best', 'date', 'headline', 'items']);
  assert.deepEqual(Object.keys(EDITION_SCHEMA.properties.items.items.properties).sort(), ['emoji', 'ids', 'line']);
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
  assert.deepEqual(r.lines, ['editor: wrote 5 items for 2026-11-17 (1200 in, 300 out)'], 'one line: items, tokens in, tokens out');
  const e = readJson(editionPath(s));
  assert.deepEqual(Object.keys(e), ['date', 'by', 'writtenAt', 'headline', 'items']);
  assert.equal(e.date, DATE);
  assert.equal(e.by, 'editor');
  assert.equal(e.writtenAt, NOW);
  assert.equal(e.headline, GOOD.headline);
  const lead = e.items[0];
  assert.deepEqual(Object.keys(lead), ['emoji', 'line', 'ids', 'best', 'quiet', 'cat', 'title', 'url', 'source', 'outlets']);
  assert.deepEqual([lead.cat, lead.title, lead.url, lead.source, lead.outlets], ['internet', 'Cloudflare outage takes down thousands of websites', 'https://pub.example/s03', 'Pub A', 7], 'copied from the lead story, s03');
  assert.deepEqual(e.items[0].ids, ['s03', 's07']);
  assert.ok(!JSON.stringify(e).includes('claude') && !JSON.stringify(e).includes('opus'), 'no model name in the file');
  assert.ok(!s.read('data/editions/2026-11-17.json').includes(KEY));
  // it passes the same check the build runs
  const checked = validateEdition(e, { date: DATE, used: new Set(), byId: new Map(), excluder });
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.dropped, []);
  // the state: four keys, one call, the write time and the hash of the stories it read
  assert.deepEqual(Object.keys(stateOf(s)), ['date', 'calls', 'lastWriteAt', 'lastIdsHash']);
  assert.deepEqual([stateOf(s).date, stateOf(s).calls, stateOf(s).lastWriteAt], [DATE, 1, NOW]);
  assert.match(stateOf(s).lastIdsHash, /^[0-9a-f]{16}$/);
});

test('editor: the closest call goes first, and the others keep their order', async () => {
  const s = setup();
  const client = fakeClient(answer({ ...GOOD, best: 's05' }));
  await run(s, client);
  const e = readJson(editionPath(s));
  assert.deepEqual(e.items.map((i) => i.ids[0]), ['s05', 's01', 's02', 's03', 's04']);
  assert.deepEqual(e.items.map((i) => Boolean(i.best)), [true, false, false, false, false]);
  // a best id that is the lead of a later item, or one of its other ids, still moves that item
  const t = setup();
  await run(t, fakeClient(answer({ ...GOOD, best: 's07' })));
  assert.deepEqual(readJson(editionPath(t)).items.map((i) => i.ids[0]), ['s03', 's01', 's02', 's04', 's05']);
  // an unknown best changes nothing
  const u = setup();
  await run(u, fakeClient(answer({ ...GOOD, best: 'nope' })));
  assert.deepEqual(readJson(editionPath(u)).items.map((i) => i.ids[0]), ['s01', 's02', 's03', 's04', 's05']);
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
  assert.deepEqual(e.items.map((i) => i.ids), [['s03', 's07'], ['s01'], ['s02'], ['s08'], ['s09']], 'the closest call first, unknown ids gone, the invented item gone');
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
  assert.deepEqual(e.items.map((i) => i.ids[0]), ['s03', 's01', 's02', 's04', 's05']);
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
  for (const headline of ['Planes late. Banks down.', `Planes late ${EM} banks down. Still here.`, 'Planes late! Still here.', '']) {
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
  const bad = ['{ not json', '', 'Here is the edition: {}', '[]', '"text"', '42', 'null', '{"items": 5}', '{"headline": "x"}', '{"date":"2026-11-17","headline":"Still here.","best":"s01"}'];
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
  assert.match(r.lines[0], /\(5 in, 6 out\)$/);
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
  const fresh = { ...GOOD, date: '2026-11-18', best: 's04', items: ['s04', 's05', 's06', 's07'].map((id, i) => ({ emoji: '\u{1F4C9}', line: `A new line number ${i + 1} about ${id}.`, ids: [id] })) };
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
  const out = await askEditor(client, { model: 'm', date: DATE, score: 12, stories: [{ id: 'x' }] });
  assert.deepEqual(out, { ok: true });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].model, 'm');
  assert.equal(JSON.parse(seen[0].messages[0].content).score, 12);
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
