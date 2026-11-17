// The commit step only commits real changes. These tests use a throwaway git repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { checkData, sameWithoutVolatile, stripVolatile } from '../scripts/data-changed.mjs';
import { REPO, tmpRoot } from './helpers.mjs';

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, env: GIT_ENV, encoding: 'utf8' });
const write = (root, rel, value) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
};
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const LATEST = {
  schema: 1,
  buildTime: '2026-11-16T22:00:00.000Z',
  etStamp: '2026-11-16 17:00 ET',
  score: 18,
  headlinesRead: 120,
  lastSuccessAt: '2026-11-16T22:00:00.000Z',
  x: { enabled: false, skipped: 'off' },
  sources: { google: { ok: true, count: 40, error: null, lastOkAt: '2026-11-16T22:00:00.000Z' } },
  stories: [{ id: 'a1', title: 'Cloudflare outage' }],
};
const SOURCES = { google: { ok: true, count: 40, error: null, lastTryAt: '2026-11-16T22:00:00.000Z', lastOkAt: '2026-11-16T22:00:00.000Z' }, usgs: { ok: true, count: 1, error: null, lastTryAt: 'a', lastOkAt: 'a', vital: { quake: { mag: 6.1 } } } };
const DAY = { date: '2026-11-16', score: 18, fired: [], bumps: [], updatedAt: '2026-11-16T22:00:00.000Z', stories: [] };

function repo() {
  const root = tmpRoot('dtwet-git-');
  git(root, 'init', '-q', '-b', 'main');
  write(root, 'data/latest.json', LATEST);
  write(root, 'data/state/sources.json', SOURCES);
  write(root, 'data/days/2026-11-16.json', DAY);
  write(root, 'data/days.json', [{ date: '2026-11-16', score: 18 }]);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'seed');
  return root;
}
const cli = (root) => spawnSync(process.execPath, [path.join(REPO, 'scripts', 'data-changed.mjs')], { cwd: root, env: GIT_ENV, encoding: 'utf8' });

test('a run that only moved timestamps changes nothing: files are put back, exit 3', () => {
  const root = repo();
  write(root, 'data/latest.json', { ...LATEST, buildTime: '2026-11-16T22:15:00.000Z', etStamp: '2026-11-16 17:15 ET', headlinesRead: 133, lastSuccessAt: '2026-11-16T22:15:00.000Z', sources: { google: { ok: true, count: 41, error: null, lastOkAt: '2026-11-16T22:15:00.000Z' } } });
  write(root, 'data/state/sources.json', { ...SOURCES, google: { ...SOURCES.google, lastTryAt: 'later', lastOkAt: 'later', count: 41, error: '1 of 26 queries failed: HTTP 429 (blocked after 12 of 26 queries)' } });
  const before = { latest: read(root, 'data/latest.json') };
  assert.notEqual(before.latest, JSON.stringify(LATEST, null, 2) + '\n');
  const r = cli(root);
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stdout, /nothing to commit/);
  assert.equal(read(root, 'data/latest.json'), JSON.stringify(LATEST, null, 2) + '\n', 'restored to the committed version');
  assert.equal(read(root, 'data/state/sources.json'), JSON.stringify(SOURCES, null, 2) + '\n');
  assert.equal(git(root, 'status', '--porcelain'), '');
});

test('a real change in latest.json is a change, and exit 0', () => {
  const root = repo();
  write(root, 'data/latest.json', { ...LATEST, buildTime: 'x', score: 24 });
  const r = cli(root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /changed: data\/latest\.json/);
  assert.match(read(root, 'data/latest.json'), /"score": 24/, 'the real change is kept');
});

test('a new story is a change', () => {
  const root = repo();
  write(root, 'data/latest.json', { ...LATEST, stories: [...LATEST.stories, { id: 'b2', title: 'Another outage' }] });
  assert.equal(cli(root).status, 0);
});

test('a source going from ok to failed is a change, a different count is not', () => {
  const root = repo();
  write(root, 'data/state/sources.json', { ...SOURCES, google: { ...SOURCES.google, ok: false, error: 'HTTP 429' } });
  assert.equal(cli(root).status, 0);
  const root2 = repo();
  write(root2, 'data/state/sources.json', { ...SOURCES, google: { ...SOURCES.google, count: 12 } });
  assert.equal(cli(root2).status, 3);
});

test('a new day file or a changed day file is a change', () => {
  const fresh = repo();
  write(fresh, 'data/days/2026-11-17.json', { ...DAY, date: '2026-11-17' });
  const r = cli(fresh);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /2026-11-17\.json/);
  const edited = repo();
  write(edited, 'data/days/2026-11-16.json', { ...DAY, score: 30 });
  assert.equal(cli(edited).status, 0);
});

test('mixed: when something really changed, the timestamp-only files go in the same commit', () => {
  const root = repo();
  write(root, 'data/latest.json', { ...LATEST, buildTime: 'later', headlinesRead: 5 });
  write(root, 'data/days/2026-11-16.json', { ...DAY, score: 40 });
  const r = cli(root);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /changed: data\/days\/2026-11-16\.json/);
  assert.match(r.stdout, /committed along with it \(timestamps\): data\/latest\.json/);
  assert.match(read(root, 'data/latest.json'), /"buildTime": "later"/, 'the fresh timestamps are kept so the commit is current');
});

test('outside a git repository it says it could not tell (exit 1) rather than guess', () => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'data-changed.mjs')], { cwd: tmpRoot('dtwet-nogit-'), env: { ...GIT_ENV, GIT_CEILING_DIRECTORIES: '/tmp:/var:/private' }, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /data-changed failed/);
});

test('the comparison helpers ignore exactly the volatile fields', () => {
  assert.equal(sameWithoutVolatile('data/latest.json', LATEST, { ...LATEST, buildTime: 'z', etStamp: 'z', headlinesRead: 1, lastSuccessAt: 'z', sources: {}, x: { enabled: true } }), true);
  assert.equal(sameWithoutVolatile('data/latest.json', LATEST, { ...LATEST, score: 19 }), false);
  assert.equal(sameWithoutVolatile('data/latest.json', LATEST, { ...LATEST, fired: ['grid'] }), false);
  assert.equal(sameWithoutVolatile('data/days.json', [1], [1]), true);
  assert.deepEqual(stripVolatile('data/state/sources.json', SOURCES).google, { ok: true });
  assert.equal(stripVolatile('data/days/x.json', DAY), DAY);
});

test('checkData leaves the working tree matching the commit when only timestamps moved', () => {
  const root = repo();
  write(root, 'data/latest.json', { ...LATEST, buildTime: 'later' });
  const out = checkData(root);
  assert.deepEqual(out.changed, []);
  assert.deepEqual(out.restored, ['data/latest.json']);
});

test('checkData does not restore anything when there is a real change', () => {
  const root = repo();
  write(root, 'data/latest.json', { ...LATEST, buildTime: 'later' });
  write(root, 'data/days/2026-11-17.json', { ...DAY, date: '2026-11-17' });
  const out = checkData(root);
  assert.deepEqual(out.changed, ['data/days/2026-11-17.json']);
  assert.deepEqual(out.timestampOnly, ['data/latest.json']);
  assert.deepEqual(out.restored, []);
});
