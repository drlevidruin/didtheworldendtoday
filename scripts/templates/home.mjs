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
  CREDIT_URL,
  DESCRIPTION,
  EVERY_DAY,
  FEED_END,
  FEED_END_QUIET,
  FOLLOW_QUIET,
  FOLLOW_TEXT,
  GO_TEXT,
  GO_TEXT_QUIET,
  NOTHING_FILED,
  NOTHING_YET,
  OLDER_DAYS,
  QUIET_DESCRIPTION,
  RANK_HEADING,
  RANK_HEADING_QUIET,
  RANK_NOTE,
  SHARE_DAY,
  SHARE_TODAY,
  STALE_AFTER_HOURS,
  STALE_TEMPLATE,
  TODAY_LINK,
  VERDICT,
  allHeadlinesLive,
  checkLines,
  dayLabel,
  dayTitle,
  headlineClass,
  homeTitle,
  longDate,
  mastText,
  plusText,
  rowDate,
  scaleText,
  shareText,
  shortDate,
  staleLine,
  updatedText,
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
    cap: num(v.doomCap, 99),
  };
  return ` data-share-text="${esc(shareText({ ...args, withUrl: false }))}" data-share-full="${esc(shareText(args))}" data-share-url="${esc(`${v.siteUrl}/day/${d.date}/`)}"`;
}

// The fold: the question, ALMOST., the day's headline, the date with the Doom
// Score, the orange button, the share pill. The date is the edition's Eastern date,
// written into the page at build time; it is never swapped for the visitor's own date.
// Every clock time here is Eastern.
function hero(v) {
  const d = v.day;
  const live = d.date === v.today;
  const score = Math.round(num(d.score));
  const cap = num(v.doomCap, 99);
  const checkedMs = Date.parse(v.lastSuccessAt || v.buildTime);
  const question = live ? 'Did the world end today?' : `Did the world end on ${weekdayDate(d.date)}?`;
  const updated = live ? updatedText(checkedMs) : '';
  const upd = updated ? `<span class="sep wide" aria-hidden="true">&middot;</span><span class="upd">${esc(updated)}</span>` : '';
  const staleHours = (Date.parse(v.buildTime) - checkedMs) / HOUR_MS;
  const stale = live && Number.isFinite(staleHours) && staleHours > STALE_AFTER_HOURS;
  const lines = [];
  if (v.quiet.quiet && v.quiet.note) lines.push(`<p class="note">${esc(v.quiet.note)}</p>`);
  lines.push(`<p class="stale" id="stale" data-template="${esc(STALE_TEMPLATE)}"${stale ? '' : ' hidden'}>${stale ? esc(staleLine(checkedMs)) : ''}</p>`);
  const go = v.quiet.quiet ? GO_TEXT_QUIET : GO_TEXT;
  return `<section class="hero" id="hero" data-lines="${jsonAttr(checkLines(v.headlinesRead))}">
<h1 class="ask"><span class="q">${esc(question)}</span><button class="vbox" type="button" data-act="check"><span class="verdict" id="verdict">${esc(VERDICT)}</span><span class="check" id="check" aria-hidden="true"></span></button></h1>
<p class="hl ${headlineClass(d.headline)}">${esc(d.headline)}</p>
<p class="doom"><span class="pts">${live ? '<span class="dot" aria-hidden="true"></span>' : ''}<span class="when">${esc(rowDate(d.date))}</span><span class="sep" aria-hidden="true">&middot;</span><span>Doom Score <b class="n">${score}</b> of ${cap}</span></span>${upd}</p>
<progress class="meter" max="${cap}" value="${score}" aria-label="Doom Score ${score} of ${cap}">${score}</progress>
<p class="scale">${esc(scaleText(cap))}</p>
${lines.join('\n')}
<a class="go" href="${v.kind === 'home' ? '#today' : '#rows'}">${esc(go)}</a>
<button class="sh" type="button" data-act="share">${esc(v.kind === 'home' ? SHARE_TODAY : SHARE_DAY)}</button>
<p class="mast">${esc(mastText(v.siteHost))}</p>
<p class="sr" id="said" role="status" aria-live="polite"></p>
</section>`;
}

// ---- the feed of days ---------------------------------------------------------------

function dayBlock(d, v) {
  const isToday = d.date === v.today;
  const label = dayLabel(d.date, v.today);
  const score = Math.round(num(d.score));
  const head = `<h2 class="dl"><span${isToday ? ' class="hot"' : ''}>${esc(label.head)}</span><span> &middot; ${esc(label.rest)}</span></h2>`;
  // Today's headline is already in the hero, so only the earlier days repeat theirs. Today says
  // how its rows are ordered; a day of plain headlines, and the quiet page, make no claim about order.
  const ranked = !v.quiet.quiet && d.by !== 'fallback';
  const rank = d.rows.length && ranked ? `\n<p class="rank">${esc(RANK_NOTE)}</p>` : '';
  const intro = isToday ? rank : `\n<p class="dh">${esc(d.headline)}</p>\n<p class="ds">Doom Score ${score} of ${num(v.doomCap, 99)}</p>`;
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

// Above the hero, so someone who lands here from a shared link can get to today or to every day.
function dayTop(v) {
  return `<div class="wrap">
<div class="top"><a href="${esc(v.root)}">${esc(TODAY_LINK)}</a><a href="${esc(v.root)}almanac/">${esc(EVERY_DAY)}</a></div>
</div>`;
}

function dayBody(v) {
  const d = v.day;
  const quiet = v.quiet.quiet;
  const live = d.date === v.today;
  const ctx = rowContext(d, v);
  const parts = [];
  // Only an edition is ranked. Plain headlines, and every day in quiet mode, are "Top stories".
  const ranked = !quiet && d.by !== 'fallback';
  const list = d.rows.length ? `<h2 class="sec">${esc(ranked ? RANK_HEADING : RANK_HEADING_QUIET)}</h2>\n${rows(d.rows, ctx)}` : `<p class="empty">${esc(NOTHING_FILED)}</p>`;
  const follow = `<a class="follow" href="${esc(CREDIT_URL)}" target="_blank" rel="noopener">${esc(quiet ? FOLLOW_QUIET : FOLLOW_TEXT)}</a>`;
  parts.push(`<section class="day" id="rows">\n${list}\n<div class="df">\n<button class="btn" type="button" data-act="share">${esc(SHARE_DAY)}</button>\n${follow}\n</div>\n</section>`);
  if (d.stories.length) {
    const label = live ? allHeadlinesLive(Date.parse(v.lastSuccessAt || v.buildTime)) : ALL_HEADLINES;
    parts.push(`<section id="all">\n<h2 class="sec">${esc(label)}</h2>\n${headlines(d.stories, ctx)}\n</section>`);
  }
  const prev = v.prev ? `<a href="../${esc(v.prev)}/">&larr; ${esc(shortDate(v.prev))}</a>` : '<span></span>';
  const next = v.next ? `<a href="../${esc(v.next)}/">${esc(shortDate(v.next))} &rarr;</a>` : '<span></span>';
  parts.push(`<nav class="dnav" aria-label="Other days">\n${prev}\n${next}\n</nav>`);
  return `<div class="wrap">\n${parts.join('\n')}\n</div>`;
}

export function mainHtml(v) {
  return `<main id="main"${shareAttrs(v.day, v)} data-build="${esc(v.buildTime)}">
${v.kind === 'home' ? '' : `${dayTop(v)}\n`}${hero(v)}
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
