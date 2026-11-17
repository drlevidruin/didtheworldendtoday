// Decides whether a run changed anything worth committing.
//
// Every run rewrites a few timestamps (when we checked, how many headlines we
// read). A commit for that alone would put a new commit in the history every
// 15 minutes for nothing. So: compare each changed file in data/ with the last
// commit after removing those timestamp-only fields. If every changed file
// differs only there, put them all back as committed and report nothing to
// commit. If any file changed for real, leave everything as written, so the
// commit carries the freshest timestamps along with the real change.
//
//   node scripts/data-changed.mjs     exit 0: something real changed, commit it
//                                     exit 3: nothing real changed (files restored)
//                                     exit 1: could not tell
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Top-level keys of each file that change on every run without meaning anything.
const VOLATILE_TOP = {
  'data/latest.json': ['buildTime', 'etStamp', 'headlinesRead', 'lastSuccessAt', 'sources', 'x'],
};
// Per-source keys inside data/state/sources.json.
const VOLATILE_SOURCE_KEYS = ['lastTryAt', 'lastOkAt', 'count', 'error'];

export function stripVolatile(relPath, value) {
  if (!value || typeof value !== 'object') return value;
  if (VOLATILE_TOP[relPath]) {
    const copy = { ...value };
    for (const k of VOLATILE_TOP[relPath]) delete copy[k];
    return copy;
  }
  if (relPath === 'data/state/sources.json') {
    const out = {};
    for (const [id, entry] of Object.entries(value)) {
      const e = { ...(entry || {}) };
      for (const k of VOLATILE_SOURCE_KEYS) delete e[k];
      out[id] = e;
    }
    return out;
  }
  return value;
}

export function sameWithoutVolatile(relPath, a, b) {
  return JSON.stringify(stripVolatile(relPath, a)) === JSON.stringify(stripVolatile(relPath, b));
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// Returns { changed, timestampOnly, restored }. Files that differ from the last
// commit only by timestamps are put back as committed when nothing else changed.
export function checkData(cwd, dir = 'data') {
  const status = git(cwd, ['status', '--porcelain=v1', '-z', '--', dir]);
  const entries = status.split('\0').filter(Boolean);
  const changed = [];
  const timestampOnly = [];
  for (const entry of entries) {
    const code = entry.slice(0, 2);
    const rel = entry.slice(3);
    if (code.includes('?') || code.includes('A') || code.includes('D') || code.includes('R') || !rel.endsWith('.json')) {
      changed.push(rel);
      continue;
    }
    let committed;
    let current;
    try {
      committed = JSON.parse(git(cwd, ['show', `HEAD:${rel}`]));
      current = JSON.parse(fs.readFileSync(path.join(cwd, rel), 'utf8'));
    } catch {
      changed.push(rel);
      continue;
    }
    if (sameWithoutVolatile(rel, committed, current)) timestampOnly.push(rel);
    else changed.push(rel);
  }
  const restored = [];
  if (!changed.length) {
    for (const rel of timestampOnly) {
      git(cwd, ['checkout', '--', rel]);
      restored.push(rel);
    }
  }
  return { changed, timestampOnly, restored };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { changed, timestampOnly, restored } = checkData(process.cwd());
    if (restored.length) console.log(`only timestamps changed, restored: ${restored.join(', ')}`);
    if (changed.length) {
      console.log(`changed: ${changed.join(', ')}`);
      if (timestampOnly.length) console.log(`committed along with it (timestamps): ${timestampOnly.join(', ')}`);
      process.exitCode = 0;
    } else {
      console.log('nothing to commit');
      process.exitCode = 3;
    }
  } catch (err) {
    console.error(`data-changed failed: ${err.message}`);
    process.exitCode = 1;
  }
}
