// The homepage and the day pages.
//
// The sign. A black band with the question, ALMOST. in black on yellow, a joke that points down at the
// list, and the Doom Score on a black board. The first screen of a phone holds all of that and the
// first near miss. The homepage is that screen and then a feed of days: today first, then up to six
// earlier days, yesterday's near misses open and the rest folded away. A day page is the same sign
// for another day, that day's near misses, and every headline we read that day. One share button a
// page, right after the rows it shares.
//
// A list of near misses shows its first five and keeps the rest behind a See more. Today's See more also
// holds the day's other headlines (the editor's picks first), so the share button is under all of it. A day
// page keeps every headline in its own list further down.
//
// A day is what resolveDays() hands over (scripts/lib/editions.mjs), plus the
// numbers the build adds:
//   { date, score, change, fired, headline, by, rows[], more[], stories[], total, byId }
import {
  ALL_HEADLINES,
  ALMANAC_LINK,
  CREDIT_URL,
  DESCRIPTION,
  FEED_END,
  FEED_END_QUIET,
  FOLLOW_QUIET,
  FOLLOW_TEXT,
  HEADLINES_SHOWN,
  NOTHING_FILED,
  NOTHING_YET,
  OLDER_DAYS,
  QUIET_DESCRIPTION,
  ROWS_SHOWN,
  SHARE_DAY,
  SHARE_TODAY,
  STALE_AFTER_HOURS,
  STALE_TEMPLATE,
  VERDICT,
  allHeadlinesLive,
  boardNote,
  checkLines,
  dayLabel,
  dayTitle,
  earlierDay,
  filledSquares,
  homeTitle,
  laterDay,
  longDate,
  sectionLine,
  shareText,
  shortDate,
  showRows,
  staleLine,
} from './copy.mjs';
import { esc, num } from './esc.mjs';
import { footer, page } from './layout.mjs';
import { headlines, rowsMore, squares } from './parts.mjs';
import { QUIP_SCRIPT, quipFor } from './quips.mjs';
import { HOUR_MS, addDays } from '../lib/time.mjs';

const jsonAttr = (value) => esc(JSON.stringify(value));

// What a row needs to know about its day. A day with no edition is shown as plain headlines: no
// rank, no label. In quiet mode no emoji is drawn.
const rowContext = (d, v) => ({
  byId: d.byId,
  quietMode: v.quiet.quiet,
  quietCaption: v.quietCaption,
  quietLink: v.quietLink,
  quietLinkIntl: v.quietLinkIntl,
  plain: d.by === 'fallback',
});

// Only an edition is ranked. A day of plain headlines, and the whole site in quiet mode, make no claim about order.
const isRanked = (d, v) => !v.quiet.quiet && d.by !== 'fallback';

// The share text of one day, and the same text without its link for share sheets
// that take the link on its own. The visitor's streak is added by the page script.
function shareAttrs(d, v) {
  const args = {
    live: d.date === v.today,
    date: d.date,
    score: d.score,
    change: d.change,
    fired: d.fired,
    categories: v.categories,
    host: v.siteHost,
    quiet: v.quiet.quiet,
    emojis: d.rows.slice(0, ROWS_SHOWN).map((r) => r.emoji),
    cap: num(v.doomCap, 99),
  };
  return ` data-share-text="${esc(shareText({ ...args, withUrl: false }))}" data-share-full="${esc(shareText(args))}" data-share-url="${esc(`${v.siteUrl}/day/${d.date}/`)}"`;
}

// ---- the sign -----------------------------------------------------------------------------------

// The black band across the top: the question, in yellow. The date is the edition's Eastern date,
// written into the page at build time; it is never swapped for the visitor's own date.
function band(v) {
  const d = v.day;
  const question = d.date === v.today ? 'Did the world end today?' : `Did the world end on ${shortDate(d.date)}?`;
  return `<div class="band"><h1 class="q">${esc(question)}</h1></div>`;
}

// The Doom Score on its board. A meter for screen readers: the number, the squares and the small print are
// the picture of it, so they are hidden or read as one thing.
function board(score, cap) {
  const s = Math.round(num(score));
  return `<div class="board" role="meter" aria-label="Doom Score" aria-valuenow="${s}" aria-valuemin="0" aria-valuemax="${cap}" aria-valuetext="${s} out of ${cap}">
<span class="bl">Doom Score</span>
<span class="bn">${s}</span>
<span class="bm"><span class="sq" aria-hidden="true">${squares(filledSquares(s))}</span><span class="bt">${esc(boardNote(cap))}</span></span>
</div>`;
}

// The line under ALMOST. It is a quip that points down at the list (scripts/templates/quips.mjs). The HTML
// carries the quip picked from the date, for a visitor with no JavaScript and for a crawler, and the script
// right after it swaps in the next quip from the visitor's own bag. Nothing sits between the two tags and
// nothing is added inside the script, because the page policy allows that script by the hash of its text.
// The day's headline is not in the hero any more: it keeps its place in the share card, the feed, the
// earlier-day blocks, the almanac and the day page's description. Quiet mode has no jokes, so the line
// stays the day's quiet headline, with no id and no script.
function deck(d, v) {
  if (v.quiet.quiet) return `<p class="deck">${esc(d.headline)}</p>`;
  return `<p class="deck" id="quip">${esc(quipFor(d.date))}</p><script>${QUIP_SCRIPT}</script>`;
}

// The first screen after the band, top to bottom: ALMOST., the notes that belong with it, the quip and the
// Doom Score board. Every clock time on the page is Eastern.
function hero(v) {
  const d = v.day;
  const live = d.date === v.today;
  const cap = num(v.doomCap, 99);
  const checkedMs = Date.parse(v.lastSuccessAt || v.buildTime);
  const staleHours = (Date.parse(v.buildTime) - checkedMs) / HOUR_MS;
  const stale = live && Number.isFinite(staleHours) && staleHours > STALE_AFTER_HOURS;
  const note = v.quiet.quiet && v.quiet.note ? `<p class="note">${esc(v.quiet.note)}</p>\n` : '';
  return `<section class="hero" id="hero" data-lines="${jsonAttr(checkLines(v.headlinesRead))}">
<button class="vbox" type="button" data-act="check"><span class="verdict" id="verdict">${esc(VERDICT)}</span><span class="check" id="check" aria-hidden="true"></span></button>
${note}${deck(d, v)}
${board(d.score, cap)}
<p class="stale" id="stale" data-template="${esc(STALE_TEMPLATE)}"${stale ? '' : ' hidden'}>${stale ? esc(staleLine(checkedMs)) : ''}</p>
<p class="sr" id="said" role="status" aria-live="polite"></p>
</section>`;
}

// ---- the feed of days ---------------------------------------------------------------

const noRows = (isToday) => `<p class="empty">${esc(isToday ? NOTHING_YET : NOTHING_FILED)}</p>`;

// The headlines of today that are not already one of its near misses (a near miss holds the ids of every story
// it was made from), split in two: the editor's picks (d.more, ids, best first), in its order, and the rest, in the
// page's order. A pick that is no longer one of the day's stories is skipped.
export function splitHeadlines(d) {
  const told = new Set(d.rows.flatMap((r) => (Array.isArray(r.ids) ? r.ids : [])));
  const left = (Array.isArray(d.stories) ? d.stories : []).filter((s) => !told.has(s.id));
  const byId = new Map(left.map((s) => [s.id, s]));
  const picks = [...new Set(Array.isArray(d.more) ? d.more : [])].map((id) => byId.get(id)).filter(Boolean);
  const picked = new Set(picks);
  return { picks, rest: left.filter((s) => !picked.has(s)) };
}

// The headlines that wait behind today's See more. The editor's picks come first, in its order, and all of them show.
// The rest of the headlines follow in the page's order behind the fold, at most restMax of them (the homepage cuts the
// rest from its end, never the picks). With no picks the first ten show, as before.
export function otherHeadlines(d, restMax = Infinity) {
  const { picks, rest } = splitHeadlines(d);
  return { others: [...picks, ...rest.slice(0, restMax)], shown: picks.length || HEADLINES_SHOWN };
}

// Today's block starts with the line over its rows and ends with the one share button of the page. Its
// first five rows show; the rest of the near misses and then the day's other headlines wait behind a See more
// above the button. An earlier day keeps its kicker, its date, its headline and its score (today's are in the
// sign above). Yesterday's rows show; the days before it fold their rows behind a button. Any list of more than
// five rows keeps the rest behind its own See more.
function dayBlock(d, v) {
  const isToday = d.date === v.today;
  const ranked = isRanked(d, v);
  const ctx = rowContext(d, v);
  if (isToday) {
    const body = d.rows.length ? `<h2 class="sec">${esc(sectionLine({ today: true, ranked }))}</h2>\n${rowsMore(d.rows, ctx, { ranked, ...otherHeadlines(d, v.restMax) })}` : noRows(true);
    return `<section class="day" id="today">
${body}
<div class="df">
<button class="btn" type="button" data-act="share">${esc(SHARE_TODAY)}</button>
</div>
</section>`;
  }
  const label = dayLabel(d.date, v.today);
  const score = Math.round(num(d.score));
  const open = d.date === addDays(v.today, -1);
  const head = `<p class="dk">${esc(label.head)}</p>
<h2 class="dl"><a href="${esc(v.root)}day/${esc(d.date)}/">${esc(label.rest)}</a></h2>
<p class="dh">${esc(d.headline)}</p>
<p class="ds">Doom Score ${score} <span class="sq" aria-hidden="true">${squares(filledSquares(score))}</span></p>`;
  let body;
  if (!d.rows.length) body = noRows(false);
  else if (open) body = rowsMore(d.rows, ctx, { ranked });
  else body = `<details class="dd">\n<summary>${esc(showRows(d.rows.length, ranked))}</summary>\n${rowsMore(d.rows, ctx, { ranked })}\n</details>`;
  return `<section class="day" id="day-${esc(d.date)}">
${head}
${body}
</section>`;
}

// After the last block: every day shown, or a way to the older ones.
function feedEnd(v) {
  const almanac = `${esc(v.root)}almanac/`;
  if (v.olderDays > 0) return `<p class="end"><a href="${almanac}">${esc(OLDER_DAYS)}</a></p>`;
  return `<div class="end">\n<p>${esc(v.quiet.quiet ? FEED_END_QUIET : FEED_END)}</p>\n<a href="${almanac}">${esc(ALMANAC_LINK)}</a>\n</div>`;
}

function homeBody(v) {
  return `<div class="wrap">
${v.days.map((d) => dayBlock(d, v)).join('\n')}
${feedEnd(v)}
</div>`;
}

// ---- a day page -----------------------------------------------------------------------

function dayBody(v) {
  const d = v.day;
  const quiet = v.quiet.quiet;
  const live = d.date === v.today;
  const ctx = rowContext(d, v);
  const parts = [];
  const ranked = isRanked(d, v);
  const list = d.rows.length ? `<h2 class="sec">${esc(sectionLine({ today: false, ranked }))}</h2>\n${rowsMore(d.rows, ctx, { ranked })}` : noRows(false);
  const follow = `<a class="follow" href="${esc(CREDIT_URL)}" target="_blank" rel="noopener">${esc(quiet ? FOLLOW_QUIET : FOLLOW_TEXT)}</a>`;
  parts.push(`<section class="day" id="rows">\n${list}\n<div class="df">\n<button class="btn" type="button" data-act="share">${esc(SHARE_DAY)}</button>\n${follow}\n</div>\n</section>`);
  if (d.stories.length) {
    const label = live ? allHeadlinesLive(Date.parse(v.lastSuccessAt || v.buildTime)) : ALL_HEADLINES;
    parts.push(`<section id="all">\n<h2 class="sec">${esc(label)}</h2>\n${headlines(d.stories, ctx)}\n</section>`);
  }
  const prev = v.prev ? `<a href="../${esc(v.prev)}/">${esc(earlierDay(v.prev))}</a>` : '<span></span>';
  const next = v.next ? `<a href="../${esc(v.next)}/">${esc(laterDay(v.next))}</a>` : '<span></span>';
  parts.push(`<nav class="dnav" aria-label="Other days">\n${prev}\n${next}\n</nav>`);
  return `<div class="wrap">\n${parts.join('\n')}\n</div>`;
}

export function mainHtml(v) {
  return `<main id="main"${shareAttrs(v.day, v)} data-build="${esc(v.buildTime)}">
${band(v)}
${hero(v)}
${v.kind === 'home' ? homeBody(v) : dayBody(v)}
</main>`;
}

export function pageHtml(v) {
  const isDay = v.kind === 'day';
  const d = v.day;
  const title = isDay ? dayTitle(d.date) : homeTitle;
  const description = isDay
    ? `${d.headline} Doom Score ${Math.round(num(d.score))} of ${num(v.doomCap, 99)} on ${longDate(d.date)}. Every story links to its source.`
    : v.quiet.quiet
      ? QUIET_DESCRIPTION
      : DESCRIPTION;
  const canonical = isDay ? `${v.siteUrl}/day/${d.date}/` : `${v.siteUrl}/`;
  // Both read the card for the day's own date, so what gets shared is what the page says.
  const image = `${v.siteUrl}/og/${d.date}.png`;
  const data = {
    build: v.buildTime,
    success: v.lastSuccessAt || v.buildTime,
    date: d.date,
    live: d.date === v.today ? '1' : '0',
    quiet: v.quiet.quiet ? '1' : '0',
    page: v.kind,
  };
  const body = `${mainHtml(v)}\n${footer({ root: v.root, quiet: v.quiet.quiet, home: v.kind === 'home', updatedMs: Date.parse(v.lastSuccessAt || v.buildTime), today: v.today, headlineCount: v.todayTotal })}`;
  return page({ root: v.root, title, description, canonical, image, body, data });
}
