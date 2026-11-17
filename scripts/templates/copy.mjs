// Every word the site says, and the small formatters for dates, times and the
// share text, in one file. The voice rule lives here: facts may name companies,
// agencies and places, jokes never aim at people, and nothing we write has an em dash
// or an arrow (neither of our two fonts has one).

export const SITE_NAME = 'Did the world end today?';
export const VERDICT = 'ALMOST.';
export const TAGLINE = 'Live coverage of the end of the world, which keeps not happening.';
export const DESCRIPTION =
  "Live coverage of the end of the world, which keeps not happening. Today's near misses, ranked from most world-ending to least. Checked every 15 minutes.";
export const QUIET_DESCRIPTION = "Today's top stories and a 0-99 Doom Score. Checked every 15 minutes.";
export const COMMENT = "If the world has ended and this still says ALMOST., sorry. We'll update it when we're back.";

export const CREDIT_HANDLE = '@thelpdrive';
export const CREDIT_URL = 'https://x.com/thelpdrive';

// ---- the ladder, by score -----------------------------------------------------
// The headline of a day that has no written edition. Every line ends in "Still here."

export const LADDER = [
  [0, 'A quiet day in the news. Suspiciously quiet. Still here.'],
  [20, 'A few small things went wrong today. Still here.'],
  [40, 'The usual number of things went wrong today. Still here.'],
  [60, 'More went wrong today than usual. Still here.'],
  [80, 'A lot went wrong today. Still here.'],
  [95, 'Nearly everything went wrong today. Still here.'],
];

export function subline(score) {
  const s = Number.isFinite(Number(score)) ? Number(score) : 0;
  let line = LADDER[0][1];
  for (const [from, text] of LADDER) if (s >= from) line = text;
  return line;
}

// ---- stale data, quiet mode, footer ----------------------------------------

export const STALE_AFTER_HOURS = 2;

// {time} is the Eastern clock time of the last good check, written like "6:12 AM ET".
// The page script fills in the same template the same way.
export const STALE_TEMPLATE = "Last checked {time}. That's on us, not the world.";

// ms: when the data was last read well, as epoch milliseconds.
export function staleLine(ms) {
  return STALE_TEMPLATE.replace('{time}', etClock(ms));
}

export const QUIET_LINE = 'Not a day for jokes. Back soon.';

export const FOOTER_LINES = [
  'Checked every 15 minutes by a robot with low standards.',
  'Headlines belong to their publishers. The jokes are ours.',
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

export const homeTitle = `${SITE_NAME} ${VERDICT}`;
export const dayTitle = (d) => `Did the world end on ${longDate(d)}? ${VERDICT}`;
export const pageTitle = (name) => `${name} | ${SITE_NAME}`;

// ---- Eastern clock times --------------------------------------------------------
// Every clock time the site shows is Eastern, written like "6:12 AM ET". The page script
// (assets/app.js) builds it the same way, from the hour and minute alone, so no engine's own
// spacing or punctuation can make the page script and the server say two different things.

const ET_CLOCK = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' });
const isInstant = (ms) => ms !== null && ms !== undefined && ms !== '' && typeof ms !== 'boolean' && Number.isFinite(Number(ms));

// ms: epoch milliseconds. Anything that is not a time reads as nothing.
export function etClock(ms) {
  if (!isInstant(ms)) return '';
  const at = new Date(Number(ms));
  if (Number.isNaN(at.getTime())) return '';
  const part = {};
  for (const p of ET_CLOCK.formatToParts(at)) part[p.type] = p.value;
  const hour = Number(part.hour) % 24;
  return `${hour % 12 || 12}:${part.minute} ${hour < 12 ? 'AM' : 'PM'} ET`; // 6:12 AM ET
}

// "Updated 6:12 AM ET", the line next to the Doom Score.
export function updatedText(ms) {
  const time = etClock(ms);
  return time ? `Updated ${time}` : '';
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ET_FIELDS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
});

// The date and time for RSS (RFC 822) in Eastern time with its real offset:
// "Tue, 17 Nov 2026 05:55:10 -0500", and -0400 in summer.
export function rfc822ET(ms) {
  if (!isInstant(ms)) return '';
  const at = new Date(Number(ms));
  if (Number.isNaN(at.getTime())) return '';
  const f = {};
  for (const p of ET_FIELDS.formatToParts(at)) f[p.type] = Number(p.value);
  const hour = f.hour % 24;
  // The Eastern wall clock read as if it were UTC, minus the real instant, is the offset.
  const wall = Date.UTC(f.year, f.month - 1, f.day, hour, f.minute, f.second);
  const offset = Math.round((wall - Math.floor(at.getTime() / 1000) * 1000) / 60000);
  const two = (n) => String(n).padStart(2, '0');
  const abs = Math.abs(offset);
  const weekday = WEEKDAY_NAMES[new Date(Date.UTC(f.year, f.month - 1, f.day)).getUTCDay()];
  return `${weekday}, ${two(f.day)} ${MONTH_NAMES[f.month - 1]} ${f.year} ${two(hour)}:${two(f.minute)}:${two(f.second)} ${offset < 0 ? '-' : '+'}${two(Math.floor(abs / 60))}${two(abs % 60)}`;
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

export const SHARE_TODAY = 'Share today';
export const SHARE_DAY = 'Share this day';
export const FEED_END = "That's every day we've checked. The world was fine before that too, probably.";
export const FEED_END_QUIET = "That's every day we've checked."; // quiet mode: no joke at the end either
export const EVERY_DAY = 'Every day so far';
export const OLDER_DAYS = EVERY_DAY;
export const ALMANAC_LINK = EVERY_DAY;
export const ALMANAC_LEAD = "Every day we've checked, newest first.";
export const TODAY_LINK = 'Today';
export const ALMANAC_NAV = 'Almanac';
// The two ends of a day page: the stored day before it and the stored day after it.
export const earlierDay = (d) => `Earlier: ${shortDate(d)}`;
export const laterDay = (d) => `Later: ${shortDate(d)}`;
// The line over the rows of a day. Only an edition is ranked: plain headlines, and every day in
// quiet mode, are "top stories". The homepage's today block says "today's", a day page does not.
export const SECTION_TODAY = 'TODAY\u2019S NEAR MISSES';
export const SECTION_TODAY_PLAIN = 'TODAY\u2019S TOP STORIES';
export const SECTION_DAY = 'NEAR MISSES';
export const SECTION_DAY_PLAIN = 'TOP STORIES';
export const sectionLine = ({ today, ranked }) => (today ? (ranked ? SECTION_TODAY : SECTION_TODAY_PLAIN) : ranked ? SECTION_DAY : SECTION_DAY_PLAIN);
export const ALL_HEADLINES = 'Every headline we read that day';
export const NOTHING_YET = 'Nothing new yet today.';
export const NOTHING_FILED = 'Nothing on file for this day.';
export const FIRST_DAY_PENDING = 'The first day is still being written.';
export const FOLLOW_TEXT = `Follow ${CREDIT_HANDLE} for tomorrow's ${VERDICT}`;
export const FOLLOW_QUIET = `Follow ${CREDIT_HANDLE}`;
export const READ_IT = 'Read it';
export const HELP_US = 'Donate to the Red Cross';
export const HELP_INTL = 'Support the Red Cross and Red Crescent';
// The small link after a row whose story has an X post: the sign X uses for itself, then the account ("𝕏 @AP").
export const X_SIGN = '\u{1D54F}';
export const xPostText = (handle) => `${X_SIGN} @${handle}`;

// The About page
export const ET_NOTE = 'Days run midnight to midnight, Eastern time. Every time on this site is Eastern.';
export const HOW_WE_RANK = "Each day's list goes from most world-ending to least: how many people it could reach, how much of the world, and how close it came.";
export const QUIET_CARDS_ABOUT =
  'A quiet card is a story about something that could hurt people, like a big quake, a flood or a fire. It gets no joke. Just the plain facts. ' +
  'When people or homes are hurt, or likely hurt, it also links to a charity: the Red Cross for a place in the United States, ' +
  'or the international Red Cross and Red Crescent for a place in another country.';

// How many of a day's headlines show before "Show N more headlines".
export const HEADLINES_SHOWN = 10;

// The list label on a day page. The live day's list is the last 24 hours, so it says when it was read.
export function allHeadlinesLive(ms) {
  const time = etClock(ms);
  return time ? `Headlines from the last 24 hours, as of ${time}` : 'Headlines from the last 24 hours';
}

// The small line on the board under the squares.
export const boardNote = (cap) => `out of ${cap}. 0 is a quiet day. ${cap} is the end.`;

// How many of the ten squares on the board are filled: the Doom Score over ten, rounded, kept from 0 to 10.
export const filledSquares = (score) => {
  const n = Number(score);
  return Number.isFinite(n) ? Math.min(10, Math.max(0, Math.round(n / 10))) : 0;
};
export const moreHeadlines = (n) => `Show ${n} more ${n === 1 ? 'headline' : 'headlines'}`;

// The label over an earlier day on the homepage: "YESTERDAY" over "MONDAY, NOV 16", or the
// weekday over the date ("SUNDAY" over "NOV 15"). Returns the two pieces.
export function dayLabel(date, today) {
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (date === today) return { head: 'TODAY', rest: weekdayDate(date).toUpperCase() };
  if (date === yesterday.toISOString().slice(0, 10)) return { head: 'YESTERDAY', rest: weekdayDate(date).toUpperCase() };
  return { head: weekdayName(date).toUpperCase(), rest: shortDate(date).toUpperCase() };
}

// The door to an earlier day's rows: "Show the 6 near misses", or "Show the 5 top stories" for a day
// with no edition.
export const showRows = (n, ranked) => (ranked ? `Show the ${n} near ${n === 1 ? 'miss' : 'misses'}` : `Show the ${n} top ${n === 1 ? 'story' : 'stories'}`);

// A list of rows shows its first 5, and the share text names the emoji of those 5. The rest wait behind "See N more".
export const ROWS_SHOWN = 5;

// The door to what a list keeps back. Only rows are left: "See 3 more near misses", or "See 3 more top stories" for
// rows that make no claim about order. Only today's other headlines are left: "See 84 more headlines". Both are
// left: "See 87 more", counting everything it opens.
export function seeMore(rows, headlines, ranked) {
  if (rows > 0 && headlines > 0) return `See ${rows + headlines} more`;
  if (headlines > 0) return `See ${headlines} more ${headlines === 1 ? 'headline' : 'headlines'}`;
  const [one, many] = ranked ? ['near miss', 'near misses'] : ['top story', 'top stories'];
  return `See ${rows} more ${rows === 1 ? one : many}`;
}

// The small heading, inside today's See more, over the headlines that are not near misses.
export const MORE_TODAY = 'More from today';

// The footer's door to the day page that lists every headline read.
export const everyHeadline = (n) => `Every headline we read today (${n})`;

// A source that is a web address ("https://www.example.co.uk/") reads as its host
// ("example.co.uk"). Every view of a source goes through here.
export function sourceName(source) {
  const s = String(source ?? '').trim();
  if (!s) return '';
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
  if (scheme || /^www\./i.test(s) || /^[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*$/i.test(s)) {
    try {
      const host = new URL(scheme ? s : `https://${s}`).hostname.replace(/^www\./i, '');
      if (host) return host;
    } catch {
      /* not an address after all: show it as it is */
    }
  }
  return s;
}

// The two parts of a source: its name and, when more than one news site told the story, the count
// ("32 news sites"). A card shows them on two lines; the list of every headline puts them on one.
export function sourceParts(outlets, source) {
  const n = Number(outlets);
  return { name: sourceName(source), count: Number.isFinite(n) && n > 1 ? `${Math.floor(n)} news sites` : '' };
}

// "CBS News \u00b7 32 news sites" on one line; just the name when one news site told it.
export function sourceText(outlets, source) {
  const { name, count } = sourceParts(outlets, source);
  return [name, count].filter(Boolean).join(' \u00b7 ');
}

// A row of near misses names its source and nothing else: no count, no "Read it".
export const rowSource = (source) => sourceName(source);

// "CBS News \u00b7 32 news sites \u00b7 Read it" under a headline in the full list. Without a link there is nothing to read.
// (A row of the day's near misses shows the source name alone: sourceName.)
export function headlineMeta(outlets, source, linked = true) {
  return [sourceText(outlets, source), linked ? READ_IT : ''].filter(Boolean).join(' \u00b7 ');
}

// ---- the share text ---------------------------------------------------------
// A day shares like a Wordle grid: the question, the emoji of its rows in rank order, and the Doom
// Score as ten squares, black for the score and yellow for what is left:
//
//   Did the world end today? ALMOST.        (a past day: "Did the world end on Nov 16? ALMOST.")
//   \u2604\ufe0f \u2708\ufe0f \ud83d\udcb3 \ud83c\udfe6 \ud83c\udf9f\ufe0f \ud83d\udc8d
//   Doom Score 92 \u2b1b\u2b1b\u2b1b\u2b1b\u2b1b\u2b1b\u2b1b\u2b1b\u2b1b\ud83d\udfe8
//   didtheworldendtoday.com/day/2026-11-17/
//
// A day with no rows has no emoji line. A reader on a streak gets "Checked 3 days running." above the
// link, added by the page script. Quiet mode keeps its own text: the quiet line and the grid of
// fired categories (an emoji where one fired, a black square where none did).

// Ten squares: a black one for each tenth of the score, and a yellow one for each tenth left.
export const scoreSquares = (score) => {
  const filled = filledSquares(score);
  return '\u2b1b'.repeat(filled) + '\ud83d\udfe8'.repeat(10 - filled);
};

export function shareText({ live, date, score, change, fired, categories, host, quiet = false, withUrl = true, emojis = [], cap = 99 }) {
  const doom = Number.isFinite(Number(score)) ? Math.round(Number(score)) : 0;
  const top = Number.isFinite(Number(cap)) && Number(cap) > 0 ? Math.round(Number(cap)) : 99;
  const first = live ? `Did the world end today? ${VERDICT}` : `Did the world end on ${shortDate(date)}? ${VERDICT}`;
  let lines;
  if (quiet) {
    const firedSet = new Set(fired || []);
    const cells = (categories || []).map((c) => (firedSet.has(c.id) ? c.emoji : '\u2b1b'));
    const rows = [];
    for (let i = 0; i < cells.length; i += 4) rows.push(cells.slice(i, i + 4).join(''));
    const arrow = changeText(change);
    lines = [first, QUIET_LINE, `${rowDate(date)} \u00b7 Doom Score ${doom} of ${top}${arrow ? ` ${arrow}` : ''}`, ...rows];
  } else {
    const strip = (Array.isArray(emojis) ? emojis : []).filter(Boolean).join(' ');
    lines = [first, ...(strip ? [strip] : []), `Doom Score ${doom} ${scoreSquares(doom)}`];
  }
  if (withUrl) lines.push(`${host}/day/${date}/`);
  return lines.join('\n');
}

// ---- small helpers for the templates ----------------------------------------

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
