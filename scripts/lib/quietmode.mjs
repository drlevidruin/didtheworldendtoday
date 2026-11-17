// Quiet mode: the kill switch for jokes.
//
// 1. Manual: quiet.json at the repo root, { "quiet": false, "note": "" }.
//    A missing file means off. A file that cannot be read means ON, because
//    when the switch is broken the safe answer is no jokes.
// 2. Automatic: when 3 or more of the top 30 headlines match mass-casualty
//    terms, quiet mode trips for this run, and stays on for a few hours
//    (the "hold") so the site does not flicker as the news cycle moves.
import fs from 'node:fs';
import { HOUR_MS } from './time.mjs';

const TRUE_WORDS = new Set(['true', '1', 'yes', 'on']);
const FALSE_WORDS = new Set(['false', '0', 'no', 'off', '']);

export function readQuietFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { quiet: false, note: '', problem: null };
    return { quiet: true, note: '', problem: `quiet.json unreadable (${err.code || err.message}), staying quiet` };
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    return { quiet: true, note: '', problem: 'quiet.json is not valid JSON, staying quiet' };
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { quiet: true, note: '', problem: 'quiet.json is not an object, staying quiet' };
  }
  const note = typeof json.note === 'string' ? json.note.slice(0, 300) : '';
  const v = json.quiet;
  if (v === true) return { quiet: true, note, problem: null };
  if (v === false || v === undefined || v === null) return { quiet: false, note, problem: null };
  const word = String(v).trim().toLowerCase();
  if (TRUE_WORDS.has(word)) return { quiet: true, note, problem: null };
  if (FALSE_WORDS.has(word)) return { quiet: false, note, problem: null };
  return { quiet: true, note, problem: 'quiet.json "quiet" is not true or false, staying quiet' };
}

// Counts mass-casualty headlines among the top N.
export function evaluateTopStories(titles, { terms, topN, tripAt }) {
  const head = (Array.isArray(titles) ? titles : []).slice(0, topN);
  const matches = [];
  for (const title of head) {
    const hit = terms.find((re) => re.test(title));
    if (hit) matches.push({ title, term: hit.source });
  }
  return { checked: head.length, matched: matches.length, matches, tripped: matches.length >= tripAt, tripAt };
}

export function emptyLatch() {
  return { holdUntil: null, lastTrippedAt: null };
}

export function normalizeLatch(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    holdUntil: typeof r.holdUntil === 'string' && Number.isFinite(Date.parse(r.holdUntil)) ? r.holdUntil : null,
    lastTrippedAt: typeof r.lastTrippedAt === 'string' ? r.lastTrippedAt : null,
  };
}

// auto: { checked: bool, via, error, evaluation? } from this run.
export function resolveQuiet({ manual, auto, latch, nowMs, holdHours }) {
  const next = normalizeLatch(latch);
  let autoOn = false;
  let reason = null;
  const ev = auto.evaluation;
  if (auto.checked && ev?.tripped) {
    autoOn = true;
    next.lastTrippedAt = new Date(nowMs).toISOString();
    next.holdUntil = new Date(nowMs + holdHours * HOUR_MS).toISOString();
    reason = `${ev.matched} of the top ${ev.checked} headlines match mass-casualty terms`;
  }
  const holding = !autoOn && next.holdUntil && Date.parse(next.holdUntil) > nowMs;
  if (holding) reason = `holding quiet until ${next.holdUntil} after an automatic trip`;
  if (!autoOn && !holding && next.holdUntil) next.holdUntil = null; // hold expired

  const why = manual.quiet ? 'manual' : autoOn ? 'auto' : holding ? 'hold' : null;
  return {
    quiet: Boolean(manual.quiet || autoOn || holding),
    why,
    note: manual.quiet ? manual.note : '',
    manual: { quiet: manual.quiet, note: manual.note, problem: manual.problem },
    auto: {
      checked: Boolean(auto.checked),
      via: auto.via ?? null,
      error: auto.error ?? null,
      headlines: ev?.checked ?? 0,
      matched: ev?.matched ?? 0,
      tripAt: ev?.tripAt ?? null,
      tripped: autoOn,
      reason: autoOn ? reason : null,
      matches: (ev?.matches ?? []).map((m) => m.title),
    },
    holdUntil: next.holdUntil,
    reason: manual.quiet ? manual.problem || 'quiet.json says quiet' : reason,
    latch: next,
  };
}
