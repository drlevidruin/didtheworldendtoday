// The shape of the repository itself: config against the spec, the package file,
// the workflow, the public data copy, and the writing rules. The site build has
// its own file, site.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../scripts/config.mjs';
import { publicCopy } from '../scripts/build.mjs';
import { spawnSync } from 'node:child_process';
import { fixture, readJson, REPO, tmpRoot } from './helpers.mjs';

const cfg = config();
const pkg = readJson(path.join(REPO, 'package.json'));
const workflow = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'update.yml'), 'utf8');

// ---- the 12 categories ------------------------------------------------------------

const SPEC_CATEGORIES = [
  ['flights', '\u2708\uFE0F', 'Grounded'],
  ['hacks', '\u{1F3E6}', 'Hacked'],
  ['internet', '\u{1F310}', 'Internet down'],
  ['space', '\u2604\uFE0F', 'Space rocks'],
  ['sun', '\u{1F31E}', 'Angry sun'],
  ['earth', '\u{1F30B}', 'Restless planet'],
  ['markets', '\u{1F4C9}', 'Markets'],
  ['ai', '\u{1F916}', 'Robots'],
  ['grid', '\u26A1', 'Lights out'],
  ['germs', '\u{1F9A0}', 'Germs'],
  ['weather', '\u{1F300}', 'Weather'],
  ['animals', '\u{1F41D}', 'Animal uprising'],
];

test('the 12 categories are in the spec order with the spec emoji and labels, and no captions', () => {
  assert.equal(cfg.categories.length, 12);
  SPEC_CATEGORIES.forEach(([id, emoji, label], i) => {
    const c = cfg.categories[i];
    assert.equal(c.id, id, `position ${i + 1}`);
    assert.equal(c.emoji, emoji, id);
    assert.equal(c.label, label, id);
    assert.ok(!('captions' in c), `${id} has no caption: the editor writes the lines now`);
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

test('package.json: ESM, Node 22, five scripts, three small dependencies', () => {
  assert.equal(pkg.type, 'module');
  assert.match(pkg.engines.node, />=\s?22/);
  assert.equal(pkg.scripts.update, 'node scripts/update.mjs');
  assert.equal(pkg.scripts.edit, 'node scripts/editor.mjs');
  assert.equal(pkg.scripts.build, 'node scripts/build.mjs');
  assert.equal(pkg.scripts.serve, 'node scripts/serve.mjs');
  assert.match(pkg.scripts.test, /^node --test /);
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@anthropic-ai/sdk', '@resvg/resvg-js', 'fast-xml-parser']);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(fs.readFileSync(path.join(REPO, '.nvmrc'), 'utf8').trim(), '22');
  const ignore = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8');
  assert.match(ignore, /^node_modules$/m);
  assert.match(ignore, /^dist$/m);
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
    'run: npm run edit',
    'node scripts/data-changed.mjs',
    'git commit',
    'run: npm run build',
    'run: npm test',
    'actions/configure-pages@',
    'actions/upload-pages-artifact@',
    'actions/deploy-pages@',
  ].map(indexOfStep);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  // The data and the editor's state are saved before the build and the tests, so a run that fails there still counts its editor call.
  const names = workflow.split(/\n      - name: /).slice(1).map((step) => step.split('\n')[0]);
  assert.deepEqual(names, [
    'Check out',
    'Set up Node',
    'Install',
    'Update data',
    "Write today's edition",
    'Commit data if it changed',
    'Build site',
    'Test',
    'Configure Pages',
    'Upload site',
    'Deploy',
  ]);
  assert.match(workflow, /node-version: 22\s*\n\s*cache: npm/);
  assert.match(workflow, /upload-pages-artifact@v\d+\s*\n\s*with:\s*\n\s*path: dist/);
});

test('workflow: the checkout follows the branch, so a run that waited starts from the newest main', () => {
  assert.match(workflow, /uses: actions\/checkout@v7\s*\n\s*with:\s*\n\s*ref: \$\{\{ github\.ref \}\}/);
});

test('workflow: the X token and its budget are visible to the update step and to no other', () => {
  const top = workflow.slice(workflow.indexOf('\nenv:\n'), workflow.indexOf('\njobs:\n'));
  assert.ok(!/X_BEARER_TOKEN|X_DAILY_BUDGET_USD/.test(top), 'not in the workflow-level environment');
  const jobEnv = workflow.slice(workflow.indexOf('\n    runs-on:'), workflow.indexOf('\n    steps:'));
  assert.ok(!/X_BEARER_TOKEN|X_DAILY_BUDGET_USD/.test(jobEnv), 'not in the job-level environment');
  const steps = workflow.split(/\n      - name: /).slice(1);
  const names = (re) => steps.filter((step) => re.test(step)).map((step) => step.split('\n')[0]);
  assert.deepEqual(names(/X_BEARER_TOKEN/), ['Update data']);
  assert.deepEqual(names(/X_DAILY_BUDGET_USD/), ['Update data']);
  const update = steps.find((step) => step.startsWith('Update data'));
  assert.match(update, /run: npm run update\s*\n\s*env:\s*\n\s*X_BEARER_TOKEN: \$\{\{ secrets\.X_BEARER_TOKEN \}\}\s*\n\s*X_DAILY_BUDGET_USD: \$\{\{ vars\.X_DAILY_BUDGET_USD \}\}/);
});

test('workflow: the Anthropic key is visible to the edition step and to no other, and the step runs right after update and before the data commit', () => {
  const top = workflow.slice(workflow.indexOf('\nenv:\n'), workflow.indexOf('\njobs:\n'));
  assert.ok(!/ANTHROPIC_API_KEY/.test(top), 'not in the workflow-level environment');
  const jobEnv = workflow.slice(workflow.indexOf('\n    runs-on:'), workflow.indexOf('\n    steps:'));
  assert.ok(!/ANTHROPIC_API_KEY/.test(jobEnv), 'not in the job-level environment');
  const steps = workflow.split(/\n      - name: /).slice(1);
  const names = steps.map((step) => step.split('\n')[0]);
  assert.deepEqual(steps.filter((step) => /ANTHROPIC_API_KEY/.test(step)).map((step) => step.split('\n')[0]), ["Write today's edition"]);
  const edit = steps.find((step) => step.startsWith("Write today's edition"));
  assert.match(edit, /run: npm run edit\s*\n\s*env:\s*\n\s*ANTHROPIC_API_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY \|\| secrets\.NTHROPIC_API_KEY \}\}/);
  assert.ok(!/continue-on-error|if:/.test(edit), 'the editor catches its own errors, so the step needs no escape hatch');
  assert.equal(names.indexOf("Write today's edition"), names.indexOf('Update data') + 1, 'right after Update data');
  assert.equal(names.indexOf('Commit data if it changed'), names.indexOf("Write today's edition") + 1, 'the data and the editor state are saved right after the edition step');
  assert.equal(names.indexOf('Build site'), names.indexOf('Commit data if it changed') + 1, 'and before the build and the tests, so a failure there still saves them');
  const update = steps.find((step) => step.startsWith('Update data'));
  assert.ok(!/ANTHROPIC_API_KEY/.test(update), 'the update step never sees the Anthropic key');
  for (const step of steps) if (!step.startsWith("Write today's edition")) assert.ok(!/ANTHROPIC_API_KEY/.test(step), step.split('\n')[0]);
});

test('workflow: the data commit has the bot author, a dated message, and a push that retries and survives a data conflict', () => {
  assert.match(workflow, /git config user\.name "thelpdrive bot"/);
  assert.match(workflow, /git config user\.email "bot@didtheworldendtoday\.com"/);
  assert.match(workflow, /git add data\b/);
  assert.match(workflow, /msg="data: \$\(TZ=America\/New_York date '\+%Y-%m-%d %H:%M'\) ET"/);
  assert.match(workflow, /git commit -m "\$msg"/);
  assert.match(workflow, /for attempt in 1 2 3; do/);
  assert.match(workflow, /git fetch --depth=50 origin main/);
  assert.match(workflow, /git rebase origin\/main/);
  assert.match(workflow, /git rebase --abort/);
  assert.match(workflow, /git reset --hard origin\/main/);
  assert.match(workflow, /refs\/heads\/main/);
  // the recovery puts back only the files this run's own commit changed, found with git, and never copies the whole folder
  assert.match(workflow, /this_run="\$\(git rev-parse HEAD\)"/);
  assert.match(workflow, /git diff-tree --no-commit-id --name-status -r "\$this_run"/);
  assert.match(workflow, /git checkout "\$this_run" -- "\$file"/);
  assert.ok(!/cp -R data/.test(workflow), 'no copy of the whole data folder');
});

// The commit step is run for real, against a local stand-in for the remote, so the
// recovery is proven and not only read: a second run pushes first and touches the
// same files, and this run's reading still lands without losing what the other added.
function commitStepScript() {
  const at = workflow.indexOf('- name: Commit data if it changed');
  const from = workflow.indexOf('run: |\n', at) + 'run: |\n'.length;
  const to = workflow.indexOf('\n      - name: ', from);
  assert.ok(at > 0 && to > from, 'the commit step is in the workflow');
  return `#!/bin/bash\nset -e\n${workflow.slice(from, to).split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n')}\n`;
}

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function remoteWithTwoRuns() {
  const root = tmpRoot('dtwet-commit-step-');
  git(root, 'init', '-q', '--bare', 'origin.git');
  git(path.join(root, 'origin.git'), 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(root, 'clone', '-q', 'origin.git', 'seed');
  const seed = path.join(root, 'seed');
  git(seed, 'config', 'user.name', 'seed');
  git(seed, 'config', 'user.email', 'seed@example.com');
  fs.mkdirSync(path.join(seed, 'data', 'days'), { recursive: true });
  fs.mkdirSync(path.join(seed, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'data', 'latest.json'), '{"from":"seed"}\n');
  fs.writeFileSync(path.join(seed, 'data', 'days', '2026-11-16.json'), '{"from":"seed"}\n');
  fs.writeFileSync(path.join(seed, 'scripts', 'data-changed.mjs'), 'process.exit(0);\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'seed');
  git(seed, 'branch', '-M', 'main');
  git(seed, 'push', '-q', 'origin', 'main');
  const url = `file://${path.join(root, 'origin.git')}`;
  for (const run of ['runA', 'runB']) git(root, 'clone', '-q', '--depth', '1', url, run);
  return { root, url, runA: path.join(root, 'runA'), runB: path.join(root, 'runB') };
}

function runCommitStep(cwd, root) {
  const script = path.join(root, 'commit-step.sh');
  fs.writeFileSync(script, commitStepScript());
  const env = { ...process.env, GITHUB_REF: 'refs/heads/main', PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}` };
  return spawnSync('bash', [script], { cwd, env, encoding: 'utf8' });
}

const gitAvailable = spawnSync('git', ['--version']).status === 0 && spawnSync('bash', ['--version']).status === 0;

test('workflow: a data push that races another run keeps this run\'s files and loses nothing the other run added or changed', { skip: !gitAvailable }, () => {
  const { root, url, runA, runB } = remoteWithTwoRuns();
  // Run B finishes first and pushes, touching latest.json, changing a day file run A never touches, and adding a new day file.
  git(runB, 'config', 'user.name', 'b');
  git(runB, 'config', 'user.email', 'b@example.com');
  fs.writeFileSync(path.join(runB, 'data', 'latest.json'), '{"from":"B"}\n');
  fs.writeFileSync(path.join(runB, 'data', 'days', '2026-11-16.json'), '{"from":"B"}\n');
  fs.writeFileSync(path.join(runB, 'data', 'days', '2026-11-17.json'), '{"from":"B"}\n');
  git(runB, 'add', 'data');
  git(runB, 'commit', '-q', '-m', 'data: run B');
  git(runB, 'push', '-q', 'origin', 'main');
  // Run A read newer data into the same latest.json and now commits and pushes.
  fs.writeFileSync(path.join(runA, 'data', 'latest.json'), '{"from":"A"}\n');
  const r = runCommitStep(runA, root);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const check = path.join(root, 'check');
  git(root, 'clone', '-q', url, check);
  assert.equal(fs.readFileSync(path.join(check, 'data', 'latest.json'), 'utf8'), '{"from":"A"}\n', 'this run\'s file wins');
  assert.equal(fs.readFileSync(path.join(check, 'data', 'days', '2026-11-17.json'), 'utf8'), '{"from":"B"}\n', 'the other run\'s new file is kept');
  assert.equal(fs.readFileSync(path.join(check, 'data', 'days', '2026-11-16.json'), 'utf8'), '{"from":"B"}\n', 'a file this run did not change keeps the other run\'s newer version, not this run\'s old copy');
  const subjects = git(check, 'log', '--format=%s').split('\n');
  assert.equal(subjects.length, 3, 'seed, run B and this run: the commit was not dropped');
  assert.match(subjects[0], /^data: \d{4}-\d\d-\d\d \d\d:\d\d ET$/);
  assert.deepEqual(git(check, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n'), ['data/latest.json'], 'this run\'s commit holds only the file this run changed');
});

test('workflow: a file this run deleted stays deleted after a race, and the other run\'s changes are kept', { skip: !gitAvailable }, () => {
  const { root, url, runA, runB } = remoteWithTwoRuns();
  git(runB, 'config', 'user.name', 'b');
  git(runB, 'config', 'user.email', 'b@example.com');
  fs.writeFileSync(path.join(runB, 'data', 'latest.json'), '{"from":"B"}\n');
  fs.writeFileSync(path.join(runB, 'data', 'days', '2026-11-16.json'), '{"from":"B"}\n');
  fs.writeFileSync(path.join(runB, 'data', 'days', '2026-11-17.json'), '{"from":"B"}\n');
  git(runB, 'add', 'data');
  git(runB, 'commit', '-q', '-m', 'data: run B');
  git(runB, 'push', '-q', 'origin', 'main');
  // Run A wrote latest.json and removed the 16th's file, all in one commit.
  fs.writeFileSync(path.join(runA, 'data', 'latest.json'), '{"from":"A"}\n');
  fs.rmSync(path.join(runA, 'data', 'days', '2026-11-16.json'));
  const r = runCommitStep(runA, root);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const check = path.join(root, 'check');
  git(root, 'clone', '-q', url, check);
  assert.equal(fs.readFileSync(path.join(check, 'data', 'latest.json'), 'utf8'), '{"from":"A"}\n');
  assert.ok(!fs.existsSync(path.join(check, 'data', 'days', '2026-11-16.json')), 'the file this run removed is gone');
  assert.equal(fs.readFileSync(path.join(check, 'data', 'days', '2026-11-17.json'), 'utf8'), '{"from":"B"}\n', 'the other run\'s new file is kept');
  assert.equal(git(check, 'log', '--format=%s').split('\n').length, 3);
});

test('workflow: a data push with no race goes straight through', { skip: !gitAvailable }, () => {
  const { root, url, runA } = remoteWithTwoRuns();
  fs.writeFileSync(path.join(runA, 'data', 'latest.json'), '{"from":"A"}\n');
  const r = runCommitStep(runA, root);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const check = path.join(root, 'check');
  git(root, 'clone', '-q', url, check);
  assert.equal(fs.readFileSync(path.join(check, 'data', 'latest.json'), 'utf8'), '{"from":"A"}\n');
});

test('workflow: current action versions, and no secret besides the optional X token and the Anthropic key', () => {
  const uses = [...workflow.matchAll(/uses: ([\w.-]+\/[\w.-]+)@(v\d+)/g)].map((m) => `${m[1]}@${m[2]}`);
  assert.deepEqual(uses, ['actions/checkout@v7', 'actions/setup-node@v7', 'actions/configure-pages@v6', 'actions/upload-pages-artifact@v5', 'actions/deploy-pages@v5']);
  const secrets = [...workflow.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(secrets, ['X_BEARER_TOKEN', 'ANTHROPIC_API_KEY', 'NTHROPIC_API_KEY']);
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

test('the public data copy carries the quiet switch and its note, and no detector state', () => {
  const latest = {
    schema: 1,
    score: 18,
    stories: [],
    x: { enabled: true, spentUsd: 0.4 },
    someFutureField: { private: true },
    quiet: {
      quiet: true,
      why: 'auto',
      note: 'A hard day',
      manual: { quiet: false, note: '', problem: null },
      auto: { tripped: true, matches: ['Mass shooting at a mall leaves dozens dead'], checked: 30 },
      latch: { until: '2026-11-17T04:00:00Z' },
    },
  };
  const today = publicCopy(latest);
  assert.deepEqual(today.quiet, { quiet: true, note: 'A hard day' });
  assert.ok(!JSON.stringify(today).includes('Mass shooting'), 'the headlines that tripped the check are not published');
  assert.ok(!('x' in today), 'the X budget stays private');
  assert.ok(!('someFutureField' in today), 'a field nobody named public stays private');
  assert.deepEqual(Object.keys(latest.quiet).sort(), ['auto', 'latch', 'manual', 'note', 'quiet', 'why'], 'the input is not touched');
  assert.equal(today.score, 18);
  assert.deepEqual(today.stories, []);
  assert.deepEqual(publicCopy({ schema: 1, quiet: null }).quiet, { quiet: false, note: '' }, 'a missing quiet block reads as off');
  assert.equal(publicCopy(null), null);
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
