// The shape of the repository itself: config against the spec, the package file,
// the workflow, the public data copy, and the writing rules. The site build has
// its own file, site.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../scripts/config.mjs';
import { publicCopy } from '../scripts/build.mjs';
import { fixture, readJson, REPO } from './helpers.mjs';

const cfg = config();
const pkg = readJson(path.join(REPO, 'package.json'));
const workflow = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'update.yml'), 'utf8');

// ---- the 12 categories and their captions ----------------------------------------

const SPEC_CATEGORIES = [
  ['flights', '✈️', 'Grounded', "Nobody's going anywhere, which is technically safe."],
  ['hacks', '\u{1F3E6}', 'Hacked', 'Your data is out there, making friends.'],
  ['internet', '\u{1F310}', 'Internet down', 'Half the internet is down. You found the other half.'],
  ['space', '☄️', 'Space rocks', 'It missed. They always miss. So far.'],
  ['sun', '\u{1F31E}', 'Angry sun', 'The sun is having a moment.'],
  ['earth', '\u{1F30B}', 'Restless planet', 'The ground has opinions today.'],
  ['markets', '\u{1F4C9}', 'Markets', 'Line go down. Line usually comes back.'],
  ['ai', '\u{1F916}', 'Robots', 'The machines are learning. Slowly, we hope.'],
  ['grid', '⚡', 'Lights out', 'Somewhere, a very dark neighborhood.'],
  ['germs', '\u{1F9A0}', 'Germs', 'Something is spreading. Possibly just headlines.'],
  ['weather', '\u{1F300}', 'Weather', 'The sky is doing a bit.'],
  ['animals', '\u{1F41D}', 'Animal uprising', "The animals know something. They're not saying."],
];

test('the 12 categories are in the spec order with the spec emoji, labels and captions', () => {
  assert.equal(cfg.categories.length, 12);
  SPEC_CATEGORIES.forEach(([id, emoji, label, caption], i) => {
    const c = cfg.categories[i];
    assert.equal(c.id, id, `position ${i + 1}`);
    assert.equal(c.emoji, emoji, id);
    assert.equal(c.label, label, id);
    assert.ok(c.captions.includes(caption), `${id} keeps the section 9 caption`);
    assert.ok(c.queries.length >= 1 && c.keywords.length >= 1, id);
  });
});

test('every category has a news query and the instruments the spec names', () => {
  assert.equal(cfg.doom.floor, 11);
  assert.equal(cfg.doom.cap, 99);
  assert.equal(cfg.doom.perCategory, 6);
  assert.equal(cfg.doom.publishersToFire, 3);
  assert.deepEqual(cfg.clock, { secondsToMidnight: 85, setOn: '2026-01-27', url: 'https://thebulletin.org/doomsday-clock/' });
  assert.equal(cfg.quiet.topN, 30);
  assert.equal(cfg.quiet.tripAt, 3);
});

test('the headline cap is gentle: every query is a plain search string', () => {
  for (const c of cfg.categories) for (const q of c.queries) assert.ok(typeof q === 'string' && q.length > 5 && q.length < 400, `${c.id}: ${q}`);
});

// ---- package.json ----------------------------------------------------------------

test('package.json: ESM, Node 22, four scripts, two small dependencies', () => {
  assert.equal(pkg.type, 'module');
  assert.match(pkg.engines.node, />=\s?22/);
  assert.equal(pkg.scripts.update, 'node scripts/update.mjs');
  assert.equal(pkg.scripts.build, 'node scripts/build.mjs');
  assert.equal(pkg.scripts.serve, 'node scripts/serve.mjs');
  assert.match(pkg.scripts.test, /^node --test /);
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@resvg/resvg-js', 'fast-xml-parser']);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(fs.readFileSync(path.join(REPO, '.nvmrc'), 'utf8').trim(), '22');
  const ignore = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8');
  assert.match(ignore, /^node_modules$/m);
  assert.match(ignore, /^dist$/m);
});

test('quiet.json ships switched off', () => {
  assert.deepEqual(readJson(path.join(REPO, 'quiet.json')), { quiet: false, note: '' });
});

// ---- the workflow ----------------------------------------------------------------

function indexOfStep(text) {
  const at = workflow.indexOf(text);
  assert.ok(at >= 0, `workflow is missing: ${text}`);
  return at;
}

test('workflow: triggers, concurrency, permissions, environment', () => {
  assert.match(workflow, /schedule:\s*\n\s*- cron: '4,19,34,49 \* \* \* \*'/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /push:\s*\n\s*branches: \[main\]/);
  assert.match(workflow, /concurrency:\s*\n\s*group: site\s*\n\s*cancel-in-progress: false/);
  assert.match(workflow, /permissions:\s*\n\s*contents: write\s*\n\s*pages: write\s*\n\s*id-token: write/);
  assert.match(workflow, /SITE_URL: https:\/\/didtheworldendtoday\.com/);
  assert.match(workflow, /X_BEARER_TOKEN: \$\{\{ secrets\.X_BEARER_TOKEN \}\}/);
  assert.match(workflow, /X_DAILY_BUDGET_USD: \$\{\{ vars\.X_DAILY_BUDGET_USD \}\}/);
  assert.match(workflow, /environment:\s*\n\s*name: github-pages/);
  const jobsText = workflow.slice(workflow.indexOf('\njobs:\n') + 7);
  assert.deepEqual([...jobsText.matchAll(/^  ([a-z_-]+):\s*$/gm)].map((m) => m[1]), ['update'], 'one job only');
});

test('workflow: the steps come in the spec order', () => {
  const order = [
    'actions/checkout@',
    'actions/setup-node@',
    'run: npm ci',
    'run: npm run update',
    'run: npm run build',
    'run: npm test',
    'node scripts/data-changed.mjs',
    'git commit',
    'actions/configure-pages@',
    'actions/upload-pages-artifact@',
    'actions/deploy-pages@',
  ].map(indexOfStep);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.match(workflow, /node-version: 22\s*\n\s*cache: npm/);
  assert.match(workflow, /upload-pages-artifact@v\d+\s*\n\s*with:\s*\n\s*path: dist/);
});

test('workflow: the data commit has the bot author, a dated message, and a retrying push', () => {
  assert.match(workflow, /git config user\.name "thelpdrive bot"/);
  assert.match(workflow, /git config user\.email "bot@didtheworldendtoday\.com"/);
  assert.match(workflow, /git add data\b/);
  assert.match(workflow, /git commit -m "data: \$\(TZ=America\/New_York date '\+%Y-%m-%d %H:%M'\) ET"/);
  assert.match(workflow, /for attempt in 1 2 3; do/);
  assert.match(workflow, /git pull --rebase && git push/);
  assert.match(workflow, /refs\/heads\/main/);
});

test('workflow: current action versions, and no secret besides the optional X token', () => {
  const uses = [...workflow.matchAll(/uses: ([\w.-]+\/[\w.-]+)@(v\d+)/g)].map((m) => `${m[1]}@${m[2]}`);
  assert.deepEqual(uses, ['actions/checkout@v7', 'actions/setup-node@v7', 'actions/configure-pages@v6', 'actions/upload-pages-artifact@v5', 'actions/deploy-pages@v5']);
  const secrets = [...workflow.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(secrets, ['X_BEARER_TOKEN']);
  assert.ok(!/pull_request_target/.test(workflow));
  assert.ok(!/\$\{\{\s*github\.event\.(?:issue|pull_request|comment)/.test(workflow), 'no untrusted text is put into a script');
});

// ---- the public copy of the data ----------------------------------------------------

test('the public data copy keeps what the page needs and drops the per-source status', () => {
  const latest = { schema: 1, score: 18, fired: ['grid'], stories: [{ id: 'a', title: 'x' }], sources: { google: { ok: true } } };
  const today = publicCopy(latest);
  assert.equal(today.score, 18);
  assert.deepEqual(today.stories, latest.stories);
  assert.ok(!('sources' in today), 'per-source status stays private');
  assert.ok('sources' in latest, 'the input is not touched');
});

// ---- writing rules ---------------------------------------------------------------

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

function* files(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (['node_modules', '.git', 'dist', 'data', '.cache'].includes(name)) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) yield* files(full);
    else if (name !== 'package-lock.json' && !/\.(?:png|woff2|ttf)$/.test(name)) yield full;
  }
}

test('no em dash or en dash in any file we author', () => {
  const found = [];
  let count = 0;
  for (const file of files(REPO)) {
    count += 1;
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes(EM) || text.includes(EN)) found.push(path.relative(REPO, file));
  }
  assert.ok(count > 30, `scanned ${count} files`);
  assert.deepEqual(found, []);
});

test('a dash from a publisher is the only dash allowed, and it is replaced before it is stored', () => {
  // Fixtures are authored without dashes, so real-world dashes never reach the scan above.
  for (const name of ['google.xml', 'bing.xml', 'top-stories-ordinary.json', 'usgs.json']) assert.ok(!fixture(name).includes(EM) && !fixture(name).includes(EN), name);
});

test('no key or token is written into the repository', () => {
  const hits = [];
  for (const file of files(REPO)) {
    const text = fs.readFileSync(file, 'utf8');
    if (/AAAAAAAAAAAAAAAAAAAA[A-Za-z0-9%]{20,}/.test(text) || /ghp_[A-Za-z0-9]{30,}/.test(text) || /sk-[A-Za-z0-9]{30,}/.test(text)) hits.push(path.relative(REPO, file));
  }
  assert.deepEqual(hits, []);
});

test('no test touches the network: nothing here calls the global fetch', () => {
  const offenders = [];
  for (const file of files(path.join(REPO, 'test'))) {
    if (!file.endsWith('.mjs') || file.endsWith('repo.test.mjs')) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (/globalThis\.fetch|[^.\w]fetch\(\s*['"`]https?:/.test(text)) offenders.push(path.relative(REPO, file));
  }
  assert.deepEqual(offenders, []);
});
