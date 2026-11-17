// Every word the site says, and the small formatters for dates, times and the
// share text, in one file. The voice rule lives here: jokes aim at systems and
// physics, never at people or places, and nothing we write has an em dash.

export const SITE_NAME = 'Did the world end today?';
export const VERDICT = 'ALMOST.';
export const TAGLINE = 'Live coverage of the end of the world, which keeps not happening.';
export const DESCRIPTION =
  "Live coverage of the end of the world, which keeps not happening. Today's near misses, a 0-99 Doom Score, and the Almanac of Almost. Checked every 15 minutes.";
export const QUIET_DESCRIPTION = "Today's near misses, a 0-99 Doom Score, and the Almanac of Almost. Checked every 15 minutes.";
export const COMMENT = "If the world has ended and this still says ALMOST., sorry. We'll update it when we're back.";

export const CREDIT_HANDLE = '@thelpdrive';
export const CREDIT_URL = 'https://x.com/thelpdrive';

// ---- the subline ladder, by score -------------------------------------------

export const LADDER = [
  [0, 'Suspiciously quiet.'],
  [20, 'Routine background apocalypse.'],
  [40, 'A normal amount of ending.'],
  [60, 'Louder than usual. Still here.'],
  [80, 'Not for lack of trying.'],
  [95, 'Honestly, impressive. Still no.'],
];

export function subline(score) {
  const s = Number.isFinite(Number(score)) ? Number(score) : 0;
  let line = LADDER[0][1];
  for (const [from, text] of LADDER) if (s >= from) line = text;
  return line;
}

// ---- stale data, quiet mode, footer ----------------------------------------

export const STALE_AFTER_HOURS = 2;

export const STALE_TEMPLATE = 'Feeds went quiet {n} hours ago. Probably us.';

export function staleLine(hours) {
  const n = Math.max(STALE_AFTER_HOURS, Math.floor(Number(hours) || 0));
  return STALE_TEMPLATE.replace('{n}', String(n));
}

export const QUIET_LINE = 'Not a day for jokes. Back soon.';

export const FOOTER_LINES = [
  'Checked every 15 minutes by a robot with low standards.',
  'Headlines belong to their publishers. The dread is ours.',
  'Satire. Not financial, medical, or eschatological advice.',
];
export const FOOTER_LINES_QUIET = ['Checked every 15 minutes.', 'Headlines belong to their publishers.'];

export const NOT_FOUND_LINE = "This page ended. The world didn't.";

// The streak line is filled in by the page script; this is its sentence.
export const STREAK_TEMPLATE = 'Day {n} of checking. Still here.';

export function recordLine(record) {
  if (!record || !Number.isFinite(Number(record.score)) || !record.date) return '';
  return `Worst day so far: ${shortDate(record.date)}, Doom ${Number(record.score)}`;
}

// ---- the Check again sequence ----------------------------------------------

export function checkLines(headlines) {
  const n = Math.max(0, Math.floor(Number(headlines) || 0));
  return [
    'Checking the sky...',
    'Pinging the internet... it pinged back.',
    'Counting continents... 7. Good.',
    'Asking the sun to take it easy...',
    `Skimming ${n.toLocaleString('en-US')} headlines...`,
    "Confirming you're still here...",
  ];
}

// ---- dates -----------------------------------------------------------------
// Edition dates are 'YYYY-MM-DD' calendar dates, so they are formatted as UTC
// noon of that date: no time zone can move them to a neighbouring day.

const fmt = (opts) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts });
const LONG = fmt({ year: 'numeric', month: 'long', day: 'numeric' });
const HERO = fmt({ weekday: 'long', month: 'long', day: 'numeric' });
const SHORT = fmt({ month: 'short', day: 'numeric' });
const MONTH_DAY = fmt({ month: 'long', day: 'numeric' });
const WEEKDAY_SHORT = fmt({ weekday: 'short', month: 'short', day: 'numeric' });
const noon = (d) => new Date(`${d}T12:00:00Z`);
// A date that does not parse reads as nothing, never as an error or "Invalid Date".
const when = (format) => (d) => {
  const at = noon(d);
  return Number.isNaN(at.getTime()) ? '' : format.format(at);
};

export const longDate = when(LONG); // November 16, 2026
export const heroDate = when(HERO); // Monday, November 16
export const shortDate = when(SHORT); // Nov 16
export const monthDay = when(MONTH_DAY); // November 16
export const rowDate = when(WEEKDAY_SHORT); // Mon, Nov 16

const ET_CLOCK = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
export const etClock = (ms) => (Number.isFinite(Number(ms)) ? `${ET_CLOCK.format(new Date(Number(ms)))} ET` : ''); // 3:05 PM ET

export const homeTitle = `${SITE_NAME} ${VERDICT}`;
export const dayTitle = (d) => `Did the world end on ${longDate(d)}? ${VERDICT}`;
export const pageTitle = (name) => `${name} | ${SITE_NAME}`;

// ---- times -----------------------------------------------------------------
// The page script uses the same rules, so a card never changes wording when
// the script takes over from the server.

export function ago(ms) {
  const sec = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

// ---- the Doom change arrow ---------------------------------------------------

export function changeText(change) {
  if (change === null || change === undefined || !Number.isFinite(Number(change))) return '';
  const n = Math.round(Number(change));
  if (n > 0) return `↑${n}`;
  if (n < 0) return `↓${Math.abs(n)}`;
  return '→0';
}

// ---- the share text ---------------------------------------------------------
// Wordle-shaped: the fired categories show their emoji, the rest a black
// square, four to a row in category order.

export function shareText({ live, date, score, change, fired, categories, host, withUrl = true }) {
  const firedSet = new Set(fired || []);
  const cells = categories.map((c) => (firedSet.has(c.id) ? c.emoji : '⬛'));
  const rows = [];
  for (let i = 0; i < cells.length; i += 4) rows.push(cells.slice(i, i + 4).join(''));
  const arrow = changeText(change);
  const doom = Number.isFinite(Number(score)) ? Math.round(Number(score)) : 0;
  const lines = [
    live ? `Did the world end today? ${VERDICT}` : `Did the world end on ${shortDate(date)}? ${VERDICT}`,
    `${shortDate(date)} · Doom ${doom}/99${arrow ? ` ${arrow}` : ''}`,
    ...rows,
  ];
  if (withUrl) lines.push(`${host}/day/${date}`);
  return lines.join('\n');
}

// The three pieces of the Doom line under the date.
export function checkedText(ms) {
  return `checked ${ago(ms)}`;
}

// ---- small helpers for the templates ----------------------------------------

// FNV-1a: a stable number from a story id, so a story always gets the same joke.
export function hashOf(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text ?? '')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function pick(list, key) {
  if (!Array.isArray(list) || !list.length) return '';
  return list[hashOf(key) % list.length];
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
