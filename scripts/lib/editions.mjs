// Editions: what each day says about itself.
//
// data/editions/YYYY-MM-DD.json   { date, by, writtenAt, headline, items[] }
//
// by is "hand" or "editor". The headline is one short line that ends in "Still
// here.". Each item is one near miss, closest call first:
//   { emoji, line, ids[], best?, quiet, cat, title, url, source, outlets }
// ids[0] is the lead story. cat, title, url, source and outlets are copied from
// the lead when the edition is written, so an edition never depends on a story
// still being in the rolling window.
//
// One function (validateEdition) decides whether an edition can be used. The
// build calls it for every day and the editor calls it before it writes. An
// edition that fails shows the day's plain headlines instead (fallbackEdition).
//
// A story id runs once. "Used ids" are the ids in the editions of every earlier
// day. They never appear in a later edition or in a later day's plain headlines.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EDITION } from '../config.mjs';
import { compareStories } from './cluster.mjs';
import { readJsonLenient } from './json.mjs';
import { receiptsOrder } from './order.mjs';
import { looksNotEnglish } from './quality.mjs';
import { quietCard } from './quietcards.mjs';
import { clean, safeUrl } from './text.mjs';
import { isDateStr } from './time.mjs';

export const STILL_HERE = EDITION.headlineEnd;

const EDITION_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;

// ---- the stories a day is made of -------------------------------------------

const plain = (list) => (Array.isArray(list) ? list.filter((s) => s && typeof s === 'object' && !Array.isArray(s)) : []);

// A day file is never rewritten once its day has passed, so a rule that tightens
// later (the taste filter, the English check) is applied here: a story the current
// rules would not publish is left off every page. The data file itself is not changed.
export function publishableStories(excluder, list) {
  return plain(list).filter((s) => {
    try {
      if (s.kind !== 'signal' && looksNotEnglish(s.title)) return false;
      return !excluder.test(s.title, { signal: s.kind === 'signal', source: s.source });
    } catch {
      return false; // a story too odd to check is not published
    }
  });
}

// The first story of each id, in the order given. An id belongs to one story, so a second story with
// the same id (a data file can still hold a pair) is left off and never published.
export function dedupeById(list) {
  const seen = new Set();
  return plain(list).filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

// One day's stories in the order the page lists them. It depends only on the
// stories themselves, so a day written in rank order and a day written in
// listing order come out the same. No id is listed twice: the first in this order keeps it.
export const listingOrder = (stories, variety) => dedupeById(receiptsOrder([...stories].sort(compareStories), variety));

// The same stories in their own order with the second story of any id left off. Which one stays is
// decided by the listing order, so the page and the data it came from agree.
export function onePerId(stories, variety) {
  const keep = new Set(listingOrder(stories, variety));
  return plain(stories).filter((s) => keep.has(s));
}

// ---- files ---------------------------------------------------------------------

export function editionFile(p, date) {
  if (!isDateStr(date)) throw new Error(`Not a date: ${date}`);
  return path.join(p.editions, `${date}.json`);
}

// Oldest first.
export function listEditionDates(p) {
  let names = [];
  try {
    names = fs.readdirSync(p.editions);
  } catch {
    return [];
  }
  return names
    .map((n) => EDITION_FILE.exec(n)?.[1])
    .filter((d) => d && isDateStr(d))
    .sort();
}

// A file that is missing or broken counts as no edition. It never stops a build.
export function readEditions(p) {
  const out = new Map();
  for (const date of listEditionDates(p)) {
    const raw = readJsonLenient(editionFile(p, date), null);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) out.set(date, raw);
  }
  return out;
}

// ---- validation ---------------------------------------------------------------

// Characters and words that never go on the page in our own text. They are
// checked on our headline and our lines, never on a third-party title.
const BAD_TEXT = [
  [/\u2014/, 'em dash'],
  [/\u2013/, 'en dash'],
  [/;/, 'semicolon'],
  [/!/, 'exclamation mark'],
  [/javascript:/i, 'javascript:'],
  [/undefined/i, 'undefined'],
  [/\bNaN\b/, 'NaN'],
  [/\[object/i, '[object'],
];

export function badText(text) {
  const t = String(text ?? '');
  for (const [re, label] of BAD_TEXT) if (re.test(t)) return label;
  return null;
}

// The hard exclusion filter, or a reason when it cannot be asked.
function excludedBy(excluder, text, signal, source = '') {
  if (!excluder || typeof excluder.test !== 'function') return null;
  try {
    return excluder.test(String(text ?? ''), { signal, source });
  } catch {
    return { family: 'unreadable', term: '' };
  }
}

const isSignalId = (id) => String(id).startsWith('sig:');

function checkItem(raw, { used, taken, byId, excluder }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { reason: 'not an item' };

  const line = typeof raw.line === 'string' ? clean(raw.line) : '';
  if (!line) return { reason: 'empty line' };
  if (line.length > EDITION.lineMax) return { reason: 'line too long' };
  const bad = badText(line);
  if (bad) return { reason: `line has ${bad}` };

  const emoji = typeof raw.emoji === 'string' ? raw.emoji.trim() : '';
  if (!emoji) return { reason: 'empty emoji' };
  if (emoji.length > EDITION.emojiMax) return { reason: 'emoji too long' };
  // It has to be an emoji, not letters: "LOL" is not one.
  if (!/\p{Extended_Pictographic}/u.test(emoji)) return { reason: 'not an emoji' };

  const asked = Array.isArray(raw.ids) ? [...new Set(raw.ids.filter((id) => typeof id === 'string' && id.trim()))] : [];
  if (!asked.length) return { reason: 'no ids' };
  // The first id is the story the link and the title belong to. When it was told already, by an earlier
  // day or by an earlier row, the whole item goes: moving on to the next id would leave the line pointing
  // at the old story. Any later id that was told already is just left out.
  if (used.has(asked[0])) return { reason: 'first id already used' };
  if (taken.has(asked[0])) return { reason: 'first id already in an earlier row' };
  const ids = asked.filter((id) => !used.has(id) && !taken.has(id));

  const href = safeUrl(raw.url);
  if (!href || !href.startsWith('https://')) return { reason: 'url is not https' };

  const title = typeof raw.title === 'string' ? clean(raw.title) : '';
  const source = typeof raw.source === 'string' ? raw.source : '';
  const hit = excludedBy(excluder, line, false) || excludedBy(excluder, title, isSignalId(asked[0]), source);
  if (hit) return { reason: `excluded: ${hit.family}` };

  // A quiet-card lead stays quiet, whatever the edition says.
  const lead = byId.get(ids[0]);
  const quiet = Boolean(raw.quiet) || Boolean(lead && (quietCard(lead) || lead.quiet));

  const outlets = Number(raw.outlets);
  return {
    item: {
      emoji,
      line,
      ids,
      quiet,
      cat: typeof raw.cat === 'string' ? raw.cat : '',
      title,
      url: href,
      source: typeof raw.source === 'string' ? clean(raw.source) : '',
      outlets: Number.isFinite(outlets) && outlets >= 1 ? Math.floor(outlets) : 1,
    },
  };
}

// raw: an edition as read from a file or as the editor built it.
// ctx: { date, used: Set of ids from earlier days, byId: Map of the day's stories, excluder }
// Returns { ok: true, edition, dropped } or { ok: false, reason, dropped }.
export function validateEdition(raw, { date, used = new Set(), byId = new Map(), excluder = null } = {}) {
  const dropped = [];
  const fail = (reason) => ({ ok: false, reason, dropped });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('not an edition');
  if (raw.date !== date) return fail('wrong date');

  const headline = typeof raw.headline === 'string' ? clean(raw.headline) : '';
  if (!headline || headline.length > EDITION.headlineMax) return fail('headline length');
  if (!headline.endsWith(STILL_HERE)) return fail('headline does not end with Still here.');
  const badHead = badText(headline);
  if (badHead) return fail(`headline has ${badHead}`);
  if (excludedBy(excluder, headline, false)) return fail('headline excluded');

  if (!Array.isArray(raw.items)) return fail('no items');
  const items = [];
  const taken = new Set();
  raw.items.forEach((entry, index) => {
    const checked = checkItem(entry, { used, taken, byId, excluder });
    if (checked.item) {
      items.push(checked.item);
      for (const id of checked.item.ids) taken.add(id);
    } else dropped.push({ index, reason: checked.reason });
  });
  const kept = items.slice(0, EDITION.maxItems);
  if (kept.length < EDITION.minItems) return fail(`only ${kept.length} usable item${kept.length === 1 ? '' : 's'}`);
  // Only the first row is the closest call.
  const ordered = kept.map((item, i) => (i === 0 ? { ...item, best: true } : item));

  return {
    ok: true,
    dropped,
    edition: {
      date,
      by: raw.by === 'editor' ? 'editor' : 'hand',
      writtenAt: typeof raw.writtenAt === 'string' ? raw.writtenAt : '',
      headline,
      items: ordered.map((item) => orderKeys(item)),
    },
  };
}

// Stored in a steady order so a file diff shows only what changed.
function orderKeys(item) {
  const out = { emoji: item.emoji, line: item.line, ids: item.ids };
  if (item.best) out.best = true;
  out.quiet = item.quiet;
  out.cat = item.cat;
  out.title = item.title;
  out.url = item.url;
  out.source = item.source;
  out.outlets = item.outlets;
  return out;
}

// ---- the plain fallback ---------------------------------------------------------

// A day with no usable edition, or any day while quiet mode is on: up to 5 of the
// day's stories in listing order, skipping used ids and stories with no title, at
// most 2 from one category. The line is the cleaned headline and never carries a joke.
export function fallbackRows({ stories, used = new Set(), emojiByCat = new Map() }) {
  const rows = [];
  const perCat = new Map();
  for (const s of plain(stories)) {
    if (rows.length >= EDITION.fallbackRows) break;
    const title = clean(s.title);
    if (!title) continue;
    if (used.has(s.id)) continue;
    if ((perCat.get(s.cat) || 0) >= EDITION.fallbackPerCategory) continue;
    perCat.set(s.cat, (perCat.get(s.cat) || 0) + 1);
    const outlets = Number(s.outlets);
    const row = {
      emoji: emojiByCat.get(s.cat) || '📰',
      line: title,
      ids: [s.id],
      quiet: Boolean(s.quiet) || Boolean(quietCard(s)),
      cat: typeof s.cat === 'string' ? s.cat : '',
      title,
      url: typeof s.url === 'string' ? s.url : '',
      source: typeof s.source === 'string' ? clean(s.source) : '',
      outlets: Number.isFinite(outlets) && outlets >= 1 ? Math.floor(outlets) : 1,
    };
    rows.push(row);
  }
  if (rows[0]) rows[0] = orderKeys({ ...rows[0], best: true });
  return rows.map((r, i) => (i === 0 ? r : orderKeys(r)));
}

// ---- every day, oldest first ------------------------------------------------------

// Walks the days from the oldest. Each day sees the ids the days before it used.
// days: [{ date, stories }] with stories already published and in listing order.
// editions: Map of date -> raw edition. Returns one step per date.
function walk({ days, editions, excluder, until = null }) {
  const byDate = new Map(plain(days).map((d) => [d.date, d]));
  const dates = [...new Set([...byDate.keys(), ...editions.keys()])].sort();
  const used = new Set();
  const steps = [];
  for (const date of dates) {
    if (until && date >= until) break;
    const day = byDate.get(date) || null;
    const stories = day ? plain(day.stories) : [];
    const byId = new Map(stories.map((s) => [s.id, s]));
    const before = new Set(used);
    const raw = editions.get(date);
    const checked = raw ? validateEdition(raw, { date, used: before, byId, excluder }) : null;
    if (checked && checked.ok) for (const item of checked.edition.items) for (const id of item.ids) used.add(id);
    steps.push({ date, day, stories, byId, used: before, checked });
  }
  return { steps, used };
}

// The ids that earlier days already told, for the editor to leave out.
export function usedIdsBefore({ days, editions, excluder, date }) {
  return walk({ days, editions, excluder, until: date }).used;
}

// What each day shows: its edition, or its plain headlines.
// fallbackHeadline(day) is the line over the plain headlines (the ladder line, or the quiet line).
// Returns a Map of date -> { date, by: 'hand' | 'editor' | 'fallback', headline, rows, byId, edition }.
export function resolveDays({ days, editions, excluder, quietMode = false, fallbackHeadline, emojiByCat }) {
  const out = new Map();
  for (const step of walk({ days, editions, excluder }).steps) {
    if (!step.day) continue;
    const usable = step.checked && step.checked.ok && !quietMode;
    if (usable) {
      const { edition } = step.checked;
      out.set(step.date, { date: step.date, by: edition.by, headline: edition.headline, rows: edition.items, byId: step.byId, edition });
    } else {
      out.set(step.date, {
        date: step.date,
        by: 'fallback',
        headline: fallbackHeadline(step.day),
        rows: fallbackRows({ stories: step.stories, used: step.used, emojiByCat }),
        byId: step.byId,
        edition: step.checked && step.checked.ok ? step.checked.edition : null,
      });
    }
  }
  return out;
}

// Where a quiet row points: 'redcross', 'ifrc' or null. It is read from the lead
// story while that story is still in the day's stories, and there is no link otherwise.
export function quietLinkFor(item, byId) {
  const lead = item && Array.isArray(item.ids) ? byId.get(item.ids[0]) : null;
  const q = lead ? quietCard(lead) : null;
  return q ? q.link : null;
}

// A short stable hash of a set of ids, in any order.
export function idsHash(ids) {
  return createHash('sha1')
    .update([...new Set(ids)].sort().join('\n'))
    .digest('hex')
    .slice(0, 16);
}
