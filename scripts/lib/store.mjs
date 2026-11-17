// Day files and the almanac index.
//
// data/days/YYYY-MM-DD.json  { date, score, fired, bumps, updatedAt, stories[] }
// data/days.json             [{ date, score, fired, top, cats }], newest first
//
// The site has a first edition (config FIRST_EDITION). A day before it was
// never published, so it is never written and never kept.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, readJsonLenient, writeJsonIfChanged } from './json.mjs';
import { isDateStr } from './time.mjs';

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;

export function dayFile(p, date) {
  if (!isDateStr(date)) throw new Error(`Not a date: ${date}`);
  return path.join(p.days, `${date}.json`);
}

// Newest first.
export function listDayDates(p) {
  let names = [];
  try {
    names = fs.readdirSync(p.days);
  } catch {
    return [];
  }
  return names
    .map((n) => DAY_FILE.exec(n)?.[1])
    .filter((d) => d && isDateStr(d))
    .sort()
    .reverse();
}

// Strict: a corrupt day file stops the run rather than being overwritten.
export function readDay(p, date) {
  return readJson(dayFile(p, date), null);
}

export function readDayLenient(p, date) {
  return readJsonLenient(dayFile(p, date), null);
}

export function sameDayContent(a, b) {
  if (!a || !b) return false;
  const strip = ({ updatedAt, ...rest }) => rest; // eslint-disable-line no-unused-vars
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

// Writes the day only when something besides the timestamp changed, so a
// quiet run leaves the file (and git) alone.
export function saveDay(p, day, prev, nowIso) {
  const next = { ...day };
  if (prev && sameDayContent(prev, next)) {
    next.updatedAt = prev.updatedAt;
  } else {
    next.updatedAt = nowIso;
  }
  writeJsonIfChanged(dayFile(p, day.date), next);
  return next;
}

export function indexEntry(day) {
  const stories = Array.isArray(day.stories) ? day.stories : [];
  const top = stories[0] || null;
  const cats = {};
  for (const s of stories) cats[s.cat] = (cats[s.cat] || 0) + 1;
  return {
    date: day.date,
    score: day.score,
    fired: Array.isArray(day.fired) ? day.fired : [],
    top: top ? { title: top.title, url: top.url, source: top.source, cat: top.cat } : null,
    cats,
  };
}

// Removes any day file dated before the first edition. Returns the dates.
export function pruneBefore(p, floor) {
  const removed = [];
  for (const date of listDayDates(p)) {
    if (floor && date < floor) {
      fs.rmSync(dayFile(p, date), { force: true });
      removed.push(date);
    }
  }
  return removed;
}

export function buildIndex(p, floor = null) {
  const out = [];
  for (const date of listDayDates(p)) {
    if (floor && date < floor) continue;
    const day = readDayLenient(p, date);
    if (day && day.date === date && Array.isArray(day.stories)) out.push(indexEntry(day));
  }
  return out;
}

export function saveIndex(p, entries) {
  return writeJsonIfChanged(p.daysIndex, entries);
}

// "Worst day so far": the highest stored score; the earliest day wins a tie.
export function recordDay(entries) {
  let best = null;
  for (const e of [...entries].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    if (typeof e.score === 'number' && (!best || e.score > best.score)) best = { date: e.date, score: e.score };
  }
  return best;
}
