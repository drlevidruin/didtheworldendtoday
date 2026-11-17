// Every word the site says, and the small formatters for dates, times and the
// share text, in one file. The voice rule lives here: facts may name companies,
// agencies and places, jokes never aim at people, and nothing we write has an em dash.

export const SITE_NAME = 'Did the world end today?';
export const VERDICT = 'ALMOST.';
export const TAGLINE = 'Live coverage of the end of the world, which keeps not happening.';
export const DESCRIPTION =
  "Live coverage of the end of the world, which keeps not happening. Today's near misses, a 0-99 Doom Score, and the Almanac of Almost. Checked every 15 minutes.";
export const QUIET_DESCRIPTION = "Today's near misses, a 0-99 Doom Score, and the Almanac of Almost. Checked every 15 minutes.";
export const COMMENT = "If the world has ended and this still says ALMOST., sorry. We'll update it when we're back.";

export const CREDIT_HANDLE = '@thelpdrive';
export const CREDIT_URL = 'https://x.com/thelpdrive';

// ---- the ladder, by score -----------------------------------------------------
// The headline of a day that has no written edition.

export const LADDER = [
  [0, 'Suspiciously quiet.'],
  [20, 'Routine background apocalypse.'],
  [40, 'The usual amount of almost.'],
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

export const STALE_TEMPLATE = "We haven't checked in {n} hours. That's on us, not the world.";

export function staleLine(hours) {
  const n = Math.max(STALE_AFTER_HOURS, Math.floor(Number(hours) || 0));
  return STALE_TEMPLATE.replace('{n}', String(n));
}

export const QUIET_LINE = 'Not a day for jokes. Back soon.';

export const FOOTER_LINES = [
  'Checked every 15 minutes by a robot with low standards.',
  'Headlines belong to their publishers. The dread is ours.',
  'Satire. Not financial, medical, or end-of-the-world advice.',
];
export const FOOTER_LINES_QUIET = ['Checked every 15 minutes.', 'Headlines belong to their publishers.'];

export const NOT_FOUND_LINE = "This page ended. The world didn't.";

// "Worst day so far" means nothing until there have been a few days to compare.
export const RECORD_MIN_EDITIONS = 7;

export function recordLine(record, editions = 0) {
  if (!record || !Number.isFinite(Number(record.score)) || !record.date) return '';
  if (!(Number(editions) >= RECORD_MIN_EDITIONS)) return '';
  return `Worst day so far: ${shortDate(record.date)}, Doom ${Number(record.score)}`;
}

// ---- the check sequence (tap ALMOST.) ---------------------------------------

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
const SHORT = fmt({ month: 'short', day: 'numeric' });
const MONTH_DAY = fmt({ month: 'long', day: 'numeric' });
const WEEKDAY_SHORT = fmt({ weekday: 'short', month: 'short', day: 'numeric' });
const WEEKDAY_LONG = fmt({ weekday: 'long', month: 'short', day: 'numeric' });
const WEEKDAY_ONLY = fmt({ weekday: 'long' });
const noon = (d) => new Date(`${d}T12:00:00Z`);
// A date that does not parse reads as nothing, never as an error or "Invalid Date".
const when = (format) => (d) => {
  const at = noon(d);
  return Number.isNaN(at.getTime()) ? '' : format.format(at);
};

export const longDate = when(LONG); // November 16, 2026
export const shortDate = when(SHORT); // Nov 16
export const monthDay = when(MONTH_DAY); // November 16
export const rowDate = when(WEEKDAY_SHORT); // Mon, Nov 16
export const weekdayDate = when(WEEKDAY_LONG); // Monday, Nov 16
export const weekdayName = when(WEEKDAY_ONLY); // Monday

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

// No yesterday, or no change: no arrow and no number at all.
export function changeText(change) {
  if (change === null || change === undefined || change === '' || !Number.isFinite(Number(change))) return '';
  const n = Math.round(Number(change));
  if (n > 0) return `↑${n}`;
  if (n < 0) return `↓${Math.abs(n)}`;
  return '';
}

// ---- the buttons and labels of the day feed -----------------------------------

export const GO_TEXT = 'See what almost got us \u2193';
export const GO_TEXT_QUIET = "See today's stories \u2193"; // quiet mode: no joke on the button
export const SHARE_TODAY = 'Share today';
export const SHARE_DAY = 'Share this day';
export const BEST_TAG = 'CLOSEST CALL';
export const TOP_TAG = 'TOP STORY'; // the first row when it is a quiet story, or the whole site is quiet
export const FEED_END = "That's every day we've checked. The world was fine before that too, probably.";
export const FEED_END_QUIET = "That's every day we've checked."; // quiet mode: no joke at the end either
export const OLDER_DAYS = 'Older days are in the Almanac of Almost \u2192';
export const ALMANAC_LINK = 'The Almanac of Almost \u2192';
export const ALL_HEADLINES = 'Every headline we read that day';
export const NOTHING_YET = 'Nothing new yet today.';
export const NOTHING_FILED = 'Nothing on file for this day.';
export const FIRST_DAY_PENDING = 'The first day is still being written.';

// The size class of a day headline: the longer the line, the smaller the type, so
// it never takes more than two lines on a phone. The classes are in the stylesheet.
export const HEADLINE_BUCKETS = { from: 40, to: 80, step: 2 };
export function headlineClass(text) {
  const { from, to, step } = HEADLINE_BUCKETS;
  const n = String(text ?? '').length;
  return `n${Math.min(to, Math.max(from, Math.ceil(n / step) * step))}`;
}

// "TODAY \u00b7 TUESDAY, NOV 17", "YESTERDAY \u00b7 MONDAY, NOV 16", "SUNDAY \u00b7 NOV 15".
// Returns the pieces so the page can color the first word.
export function dayLabel(date, today) {
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const wide = weekdayDate(date).toUpperCase();
  if (date === today) return { head: 'TODAY', rest: wide };
  if (date === yesterday.toISOString().slice(0, 10)) return { head: 'YESTERDAY', rest: wide };
  const name = weekdayName(date).toUpperCase();
  const md = shortDate(date).toUpperCase();
  return { head: name, rest: md, plain: true };
}

// "Read it \u00b7 32 outlets \u2192", or the source's own name for a story told by one outlet.
export function readText(outlets, source) {
  const n = Number(outlets);
  const tail = Number.isFinite(n) && n > 1 ? `${Math.floor(n)} outlets` : String(source || '').trim();
  return tail ? `Read it \u00b7 ${tail} \u2192` : 'Read it \u2192';
}

// "Plus 94 more headlines we read so you don't have to \u2192"; in quiet mode just "Plus 94 more headlines \u2192"
export function plusText(n, quiet = false) {
  const noun = n === 1 ? 'headline' : 'headlines';
  return quiet ? `Plus ${n} more ${noun} \u2192` : `Plus ${n} more ${noun} we read so you don't have to \u2192`;
}

// "Source \u00b7 32 outlets" under a headline on a day page; just the source for one outlet.
export function sourceText(outlets, source) {
  const n = Number(outlets);
  const name = String(source || '').trim();
  if (Number.isFinite(n) && n > 1) return name ? `${name} \u00b7 ${Math.floor(n)} outlets` : `${Math.floor(n)} outlets`;
  return name;
}

// ---- the share text ---------------------------------------------------------
// A day shares its headline and the emoji of its rows:
//
//   Did the world end today? ALMOST.        (a past day: "Did the world end on Nov 16? ALMOST.")
//   Asteroid missed. Banks back. Bags still lost. Still here.
//   \u2604\ufe0f\ud83c\udfe6\u2708\ufe0f\ud83e\uddf3\ud83d\udc8d\ud83d\udcb3
//   Nov 17 \u00b7 Doom 68/99
//   didtheworldendtoday.com/day/2026-11-17/
//
// A reader on a streak gets "Checked 3 days running." above the link, added by the
// page script. Quiet mode keeps its own text: the quiet line and the grid of
// fired categories (an emoji where one fired, a black square where none did).

export function shareText({ live, date, score, change, fired, categories, host, quiet = false, withUrl = true, headline = '', emojis = [] }) {
  const doom = Number.isFinite(Number(score)) ? Math.round(Number(score)) : 0;
  const first = live ? `Did the world end today? ${VERDICT}` : `Did the world end on ${shortDate(date)}? ${VERDICT}`;
  let lines;
  if (quiet) {
    const firedSet = new Set(fired || []);
    const cells = (categories || []).map((c) => (firedSet.has(c.id) ? c.emoji : '\u2b1b'));
    const rows = [];
    for (let i = 0; i < cells.length; i += 4) rows.push(cells.slice(i, i + 4).join(''));
    const arrow = changeText(change);
    lines = [first, QUIET_LINE, `${shortDate(date)} \u00b7 Doom ${doom}/99${arrow ? ` ${arrow}` : ''}`, ...rows];
  } else {
    const strip = (Array.isArray(emojis) ? emojis : []).join('');
    lines = [first, headline || subline(score), ...(strip ? [strip] : []), `${shortDate(date)} \u00b7 Doom ${doom}/99`];
  }
  if (withUrl) lines.push(`${host}/day/${date}/`);
  return lines.join('\n');
}

// The three pieces of the Doom line under the date.
export function checkedText(ms) {
  return `checked ${ago(ms)}`;
}

// ---- small helpers for the templates ----------------------------------------

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
