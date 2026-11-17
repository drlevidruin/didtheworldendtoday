// The real command, run as a child process with the network switched off.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config } from '../scripts/config.mjs';
import { runUpdate } from '../scripts/update.mjs';
import { build } from '../scripts/build.mjs';
import { fakeSource, newsItem, readJson, REPO, tmpRoot } from './helpers.mjs';

const cfg = config();
const SECRET = 'AAAA-offline-test-token-DO-NOT-PRINT';

function cli(script, root, now, extraEnv = {}) {
  return spawnSync(process.execPath, [path.join(REPO, script)], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, DTWET_OFFLINE: '1', DTWET_ROOT: root, DTWET_NOW: now, ...extraEnv },
    encoding: 'utf8',
    timeout: 120000,
  });
}
const latestOf = (root) => readJson(path.join(root, 'data', 'latest.json'));

test('npm run update with no network and no data exits 0 and writes a valid quiet day', () => {
  const root = tmpRoot();
  const r = cli('scripts/update.mjs', root, '2026-11-16T22:30:00Z');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^update 2026-11-16 17:30 ET/);
  assert.match(r.stdout, /google\s+FAIL/);
  assert.match(r.stdout, /doom 11, fired: none/);
  const latest = latestOf(root);
  assert.equal(latest.score, 11);
  assert.deepEqual(latest.stories, []);
  assert.equal(latest.sources.x.ok, true);
  assert.ok(fs.existsSync(path.join(root, 'data', 'days', '2026-11-16.json')));
  assert.ok(fs.existsSync(path.join(root, 'data', 'state', 'sources.json')));
  assert.equal(r.stderr, '');
});

test('with network off it reuses what it has, marks the readings stale, and the site still builds', async () => {
  const root = tmpRoot();
  const quake = { mag: 6.1, place: 'Somewhere', time: '2026-11-16T19:00:00.000Z', url: 'https://example.com/q', pager: null, tsunami: false };
  const items = ['Cloudflare outage knocks thousands of sites offline', 'Major AWS outage disrupts popular apps', 'Slack is down for users across the US'].map((title, i) =>
    newsItem({ cat: 'internet', title, source: `Pub ${i}`, url: `https://pub${i}.example/a`, publishedAt: Date.parse('2026-11-16T20:00:00Z') }),
  );
  await runUpdate({
    root,
    now: '2026-11-16T22:00:00Z',
    env: {},
    config: cfg,
    sources: [fakeSource('google', { count: 3, items }), fakeSource('usgs', { vital: { quake } })],
  });
  const before = latestOf(root);
  const dayBefore = fs.readFileSync(path.join(root, 'data', 'days', '2026-11-16.json'), 'utf8');

  const r = cli('scripts/update.mjs', root, '2026-11-16T22:15:00Z');
  assert.equal(r.status, 0, r.stderr);
  const after = latestOf(root);
  assert.deepEqual(after.stories, before.stories);
  assert.equal(after.score, before.score);
  assert.deepEqual(after.vital.quake, { ...quake, stale: true, staleSince: '2026-11-16T22:00:00.000Z' });
  assert.equal(after.lastSuccessAt, '2026-11-16T22:00:00.000Z');
  assert.equal(after.headlinesRead, before.headlinesRead);
  assert.equal(after.sources.google.ok, false);
  assert.equal(fs.readFileSync(path.join(root, 'data', 'days', '2026-11-16.json'), 'utf8'), dayBefore);

  const b = build(root);
  assert.equal(b.hasData, true);
  const today = readJson(path.join(root, 'dist', 'api', 'today.json'));
  assert.deepEqual(today.stories, before.stories);
  assert.ok(!('sources' in today));
  const html = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
  assert.match(html, /ALMOST\./);
});

test('a bearer token is never printed or saved, even when the call fails', () => {
  const root = tmpRoot();
  const r = cli('scripts/update.mjs', root, '2026-11-16T22:30:00Z', { X_BEARER_TOKEN: SECRET });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes(SECRET) && !r.stderr.includes(SECRET), 'not on screen');
  assert.match(r.stdout, /x\s+FAIL/, 'the X call failed because the network is off');
  const all = [];
  const walk = (dir) => {
    for (const n of fs.readdirSync(dir)) {
      const f = path.join(dir, n);
      if (fs.statSync(f).isDirectory()) walk(f);
      else all.push(fs.readFileSync(f, 'utf8'));
    }
  };
  walk(root);
  assert.ok(all.length >= 4);
  for (const text of all) assert.ok(!text.includes(SECRET), 'not in any saved file');
});

test('--verbose prints the kept and dropped lists and still exits 0', () => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'update.mjs'), '--verbose'], {
    env: { PATH: process.env.PATH, DTWET_OFFLINE: '1', DTWET_ROOT: tmpRoot(), DTWET_NOW: '2026-11-16T22:30:00Z' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /KEPT/);
  assert.match(r.stdout, /DROPPED/);
});

test('a malformed quiet.json is read as quiet ON, the run says so out loud, and it still exits 0', () => {
  for (const content of ['{ "quiet": tru', '', '[]', '{"quiet": "maybe"}']) {
    const root = tmpRoot();
    fs.writeFileSync(path.join(root, 'quiet.json'), content);
    const r = cli('scripts/update.mjs', root, '2026-11-16T22:30:00Z');
    assert.equal(r.status, 0, `"${content}": ${r.stderr}`);
    assert.match(r.stdout, /quiet: ON \(manual: /);
    assert.match(r.stdout, /quiet\.json PROBLEM: /);
    assert.match(r.stdout, /^::warning::quiet\.json /m, 'shows as a note on the run page');
    const latest = latestOf(root);
    assert.equal(latest.quiet.quiet, true);
    assert.ok(latest.quiet.manual.problem);
    const out = build(root, { siteUrl: 'https://didtheworldendtoday.com' });
    assert.match(fs.readFileSync(path.join(out.dist, 'index.html'), 'utf8'), /<html lang="en"[^>]*data-quiet="1"/, 'and the site goes quiet');
  }
});

test('a real bug (a nonsense clock) fails loudly instead of pretending', () => {
  const r = cli('scripts/update.mjs', tmpRoot(), 'not a time');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /update failed/);
});

test('an unreadable archive file stops the run and leaves the file alone', () => {
  const root = tmpRoot();
  const file = path.join(root, 'data', 'days', '2026-11-16.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ broken');
  const r = cli('scripts/update.mjs', root, '2026-11-16T22:30:00Z');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Corrupt JSON/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ broken');
});
