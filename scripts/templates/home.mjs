// The homepage and the day pages.
//
// The homepage is a hero that fits one phone screen (the question, ALMOST., the
// day's headline, the Doom Score, one big button) and then a feed of days: today
// first, then up to six earlier days, each with its rows. A day page is the same
// hero for another day, that day's rows, and every headline we read that day.
//
// A day is what resolveDays() hands over (scripts/lib/editions.mjs), plus the
// numbers the build adds:
//   { date, score, change, fired, headline, rows[], stories[], total, byId }
import {
  ALL_HEADLINES,
  ALMANAC_LINK,
  DESCRIPTION,
  FEED_END,
  FEED_END_QUIET,
  GO_TEXT,
  GO_TEXT_QUIET,
  NOTHING_FILED,
  NOTHING_YET,
  OLDER_DAYS,
  QUIET_DESCRIPTION,
  SHARE_DAY,
  SHARE_TODAY,
  STALE_AFTER_HOURS,
  STALE_TEMPLATE,
  VERDICT,
  checkLines,
  checkedText,
  dayLabel,
  dayTitle,
  headlineClass,
  homeTitle,
  longDate,
  plusText,
  rowDate,
  shareText,
  shortDate,
  staleLine,
  weekdayDate,
} from './copy.mjs';
import { esc, num } from './esc.mjs';
import { footer, page } from './layout.mjs';
import { headlines, rows } from './parts.mjs';
import { HOUR_MS } from '../lib/time.mjs';

const jsonAttr = (value) => esc(JSON.stringify(value));

// What a row needs to know about its day.
const rowContext = (d, v) => ({
  byId: d.byId,
  quietMode: v.quiet.quiet,
  quietCaption: v.quietCaption,
  quietLink: v.quietLink,
  quietLinkIntl: v.quietLinkIntl,
});

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
    headline: d.headline,
    emojis: d.rows.map((r) => r.emoji),
  };
  return ` data-share-text="${esc(shareText({ ...args, withUrl: false }))}" data-share-full="${esc(shareText(args))}" data-share-url="${esc(`${v.siteUrl}/day/${d.date}/`)}"`;
}

// The fold: the question, ALMOST., the day's headline, the date with the Doom
// Score, the orange button. The date is the edition's Eastern date, written into
// the page at build time; it is never swapped for the visitor's own date.
function hero(v) {
  const d = v.day;
  const live = d.date === v.today;
  const score = Math.round(num(d.score));
  const cap = num(v.doomCap, 99);
  const checkedAt = v.lastSuccessAt || v.buildTime;
  const sinceMs = Math.max(0, v.nowMs - Date.parse(checkedAt));
  const question = live ? 'Did the world end today?' : `Did the world end on ${weekdayDate(d.date)}?`;
  const ago = live ? `<span class="sep wide" aria-hidden="true">&middot;</span><span class="ago" data-since="${esc(checkedAt)}">${esc(checkedText(Number.isFinite(sinceMs) ? sinceMs : 0))}</span>` : '';
  const staleHours = (Date.parse(v.buildTime) - Date.parse(v.lastSuccessAt || v.buildTime)) / HOUR_MS;
  const stale = live && Number.isFinite(staleHours) && staleHours > STALE_AFTER_HOURS;
  const lines = [];
  if (v.quiet.quiet && v.quiet.note) lines.push(`<p class="note">${esc(v.quiet.note)}</p>`);
  lines.push(`<p class="stale" id="stale" data-template="${esc(STALE_TEMPLATE)}"${stale ? '' : ' hidden'}>${stale ? esc(staleLine(staleHours)) : ''}</p>`);
  const go = v.quiet.quiet ? GO_TEXT_QUIET : GO_TEXT;
  const share = v.kind === 'home' ? `\n<button class="sh" type="button" data-act="share">${esc(SHARE_TODAY)}</button>` : '';
  return `<section class="hero" id="hero" data-lines="${jsonAttr(checkLines(v.headlinesRead))}">
<h1 class="ask"><span class="q">${esc(question)}</span><button class="vbox" type="button" data-act="check"><span class="verdict" id="verdict">${esc(VERDICT)}</span><span class="check" id="check" aria-hidden="true"></span></button></h1>
<p class="hl ${headlineClass(d.headline)}">${esc(d.headline)}</p>
<p class="doom"><span class="pts">${live ? '<span class="dot" aria-hidden="true"></span>' : ''}<span class="when">${esc(rowDate(d.date))}</span><span class="sep" aria-hidden="true">&middot;</span><span>Doom Score <b class="n">${score}</b> of ${cap}</span></span>${ago}</p>
<progress class="meter" max="${cap}" value="${score}" aria-label="Doom Score ${score} of ${cap}">${score}</progress>
${lines.join('\n')}
<a class="go" href="${v.kind === 'home' ? '#today' : '#rows'}">${esc(go)}</a>${share}
<p class="sr" id="said" role="status" aria-live="polite"></p>
</section>`;
}

// ---- the feed of days ---------------------------------------------------------------

function dayBlock(d, v) {
  const isToday = d.date === v.today;
  const label = dayLabel(d.date, v.today);
  const score = Math.round(num(d.score));
  const head = `<h2 class="dl"><span${isToday ? ' class="hot"' : ''}>${esc(label.head)}</span><span> &middot; ${esc(label.rest)}</span></h2>`;
  // Today's headline is already in the hero, so only the earlier days repeat theirs.
  const intro = isToday ? '' : `\n<p class="dh">${esc(d.headline)}</p>\n<p class="ds">Doom Score ${score} of ${num(v.doomCap, 99)}</p>`;
  const body = d.rows.length ? rows(d.rows, rowContext(d, v)) : `<p class="empty">${esc(isToday ? NOTHING_YET : NOTHING_FILED)}</p>`;
  const more = d.total - d.rows.length;
  const plus = more > 0 ? `<a class="plus" href="${esc(v.root)}day/${esc(d.date)}/">${esc(plusText(more, v.quiet.quiet))}</a>\n` : '';
  return `<section class="day"${isToday ? ' id="today"' : ''}${shareAttrs(d, v)}>
${head}${intro}
${body}
<div class="df">
${plus}<button class="btn" type="button" data-act="share">${esc(SHARE_DAY)}</button>
</div>
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
  const ctx = rowContext(d, v);
  const parts = [];
  parts.push(`<section class="day" id="rows">\n${d.rows.length ? rows(d.rows, ctx) : `<p class="empty">${esc(NOTHING_FILED)}</p>`}\n</section>`);
  if (d.stories.length) parts.push(`<section id="all">\n<h2 class="sec">${esc(ALL_HEADLINES)}</h2>\n${headlines(d.stories, ctx)}\n</section>`);
  parts.push(`<div class="df">\n<button class="btn" type="button" data-act="share">${esc(SHARE_DAY)}</button>\n</div>`);
  const prev = v.prev ? `<a href="../${esc(v.prev)}/">&larr; ${esc(shortDate(v.prev))}</a>` : '<span></span>';
  const next = v.next ? `<a href="../${esc(v.next)}/">${esc(shortDate(v.next))} &rarr;</a>` : '<span></span>';
  parts.push(`<nav class="dnav" aria-label="Other days">\n${prev}\n${next}\n</nav>`);
  return `<div class="wrap">\n${parts.join('\n')}\n</div>`;
}

export function mainHtml(v) {
  return `<main id="main"${shareAttrs(v.day, v)} data-build="${esc(v.buildTime)}">
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
  const body = `${mainHtml(v)}\n${footer({ root: v.root, quiet: v.quiet.quiet })}`;
  return page({ root: v.root, title, description, canonical, image, body, data });
}
