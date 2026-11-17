// The homepage and the day pages.
//
// The sign. A black band with the question, ALMOST. in black on yellow, the day's headline, and the
// Doom Score on a black board. The first screen of a phone holds all of that and the first near
// miss. The homepage is that screen and then a feed of days: today first, then up to six earlier
// days, yesterday's near misses open and the rest folded away. A day page is the same sign for
// another day, that day's near misses, and every headline we read that day. One share button a
// page, right after the rows it shares.
//
// A day is what resolveDays() hands over (scripts/lib/editions.mjs), plus the
// numbers the build adds:
//   { date, score, change, fired, headline, by, rows[], stories[], total, byId }
import {
  ALL_HEADLINES,
  ALMANAC_LINK,
  CREDIT_URL,
  DESCRIPTION,
  FEED_END,
  FEED_END_QUIET,
  FOLLOW_QUIET,
  FOLLOW_TEXT,
  NOTHING_FILED,
  NOTHING_YET,
  OLDER_DAYS,
  QUIET_DESCRIPTION,
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
import { headlines, rows, squares } from './parts.mjs';
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
    emojis: d.rows.map((r) => r.emoji),
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

// The first screen after the band, top to bottom: ALMOST., the notes that belong with it, the day's
// headline and the Doom Score board. Every clock time on the page is Eastern.
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
${note}<p class="deck">${esc(d.headline)}</p>
${board(d.score, cap)}
<p class="stale" id="stale" data-template="${esc(STALE_TEMPLATE)}"${stale ? '' : ' hidden'}>${stale ? esc(staleLine(checkedMs)) : ''}</p>
<p class="sr" id="said" role="status" aria-live="polite"></p>
</section>`;
}

// ---- the feed of days ---------------------------------------------------------------

const noRows = (isToday) => `<p class="empty">${esc(isToday ? NOTHING_YET : NOTHING_FILED)}</p>`;

// Today's block starts with the line over its rows and ends with the one share button of the page. An
// earlier day keeps its kicker, its date, its headline and its score (today's are in the sign above).
// Yesterday's rows show; the days before it fold their rows behind a button.
function dayBlock(d, v) {
  const isToday = d.date === v.today;
  const ranked = isRanked(d, v);
  const ctx = rowContext(d, v);
  if (isToday) {
    const body = d.rows.length ? `<h2 class="sec">${esc(sectionLine({ today: true, ranked }))}</h2>\n${rows(d.rows, ctx)}` : noRows(true);
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
  else if (open) body = rows(d.rows, ctx);
  else body = `<details class="dd">\n<summary>${esc(showRows(d.rows.length, ranked))}</summary>\n${rows(d.rows, ctx)}\n</details>`;
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
  const list = d.rows.length ? `<h2 class="sec">${esc(sectionLine({ today: false, ranked: isRanked(d, v) }))}</h2>\n${rows(d.rows, ctx)}` : noRows(false);
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
