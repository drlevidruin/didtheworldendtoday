// The homepage and the day pages share one body: the hero that fits a phone
// screen, then the closest call, the receipts, Doom Bingo, the vital signs and
// the Almanac. A day page is the same page for another ET day.
import {
  DESCRIPTION,
  QUIET_DESCRIPTION,
  QUIET_LINE,
  STALE_AFTER_HOURS,
  STALE_TEMPLATE,
  STREAK_TEMPLATE,
  TAGLINE,
  VERDICT,
  changeText,
  checkLines,
  checkedText,
  dayTitle,
  heroDate,
  homeTitle,
  longDate,
  monthDay,
  recordLine,
  shareText,
  shortDate,
  staleLine,
  subline,
} from './copy.mjs';
import { esc, num } from './esc.mjs';
import { footer, page } from './layout.mjs';
import { almanacRows, bingo, card, mathLine, receipts, vitals } from './parts.mjs';
import { HOUR_MS } from '../lib/time.mjs';

const jsonAttr = (value) => esc(JSON.stringify(value));

// The fold: the question, ALMOST., the date, the Doom line and two buttons.
function hero(v) {
  const score = Math.round(num(v.score));
  const chg = changeText(v.change);
  const checkedAt = v.lastSuccessAt || v.buildTime;
  const sinceMs = Math.max(0, v.nowMs - Date.parse(checkedAt));
  const tail = v.live
    ? `<span class="ago" data-since="${esc(checkedAt)}">${esc(checkedText(Number.isFinite(sinceMs) ? sinceMs : 0))}</span>`
    : `<span class="ago">final</span>`;
  const question = v.live ? 'Did the world end today?' : `Did the world end on ${monthDay(v.date)}?`;
  const buttons = v.live
    ? `<button class="btn" type="button" data-act="check">Check again</button>
<button class="btn" type="button" data-act="share">Share</button>`
    : `<button class="btn" type="button" data-act="share">Share</button>
<a class="btn" href="${esc(v.root)}">Today</a>`;
  return `<section class="hero" id="hero" data-lines="${jsonAttr(checkLines(v.headlinesRead))}">
<h1 class="ask"><span class="q">${esc(question)}</span><span class="vbox"><span class="verdict" id="verdict">${esc(VERDICT)}</span><span class="check" id="check" aria-hidden="true"></span></span></h1>
<p class="date"${v.live && v.kind === 'home' ? ' data-local="date"' : ''}>${esc(heroDate(v.date))}</p>
<p class="doom"><span class="dot" aria-hidden="true"></span><span>Doom</span> <b class="n">${score}</b>${chg ? ` <span class="chg">${esc(chg)}</span>` : ''}<span class="sep" aria-hidden="true">&middot;</span>${tail}</p>
<progress class="meter" max="99" value="${score}" aria-label="Doom Score ${score} of 99">${score}</progress>
<div class="btns">
${buttons}
</div>
<p class="sr" id="said" role="status" aria-live="polite"></p>
</section>`;
}

// Just below the fold: the voice line, the stale line, quiet mode, the streak.
function sub(v) {
  const staleHours = (Date.parse(v.buildTime) - Date.parse(v.lastSuccessAt || v.buildTime)) / HOUR_MS;
  const stale = v.live && Number.isFinite(staleHours) && staleHours > STALE_AFTER_HOURS;
  const lines = [];
  if (v.quiet.quiet) {
    lines.push(`<p class="line" id="line">${esc(QUIET_LINE)}</p>`);
    if (v.quiet.note) lines.push(`<p class="note">${esc(v.quiet.note)}</p>`);
  } else {
    lines.push(`<p class="line" id="line">${esc(subline(v.score))}</p>`);
    lines.push(`<p class="tag">${esc(TAGLINE)}</p>`);
  }
  lines.push(`<p class="stale" id="stale" data-template="${esc(STALE_TEMPLATE)}"${stale ? '' : ' hidden'}>${stale ? esc(staleLine(staleHours)) : ''}</p>`);
  if (v.live) lines.push(`<p class="streak" id="streak" data-template="${esc(STREAK_TEMPLATE)}" hidden></p>`);
  return `<div class="sub">\n${lines.join('\n')}\n</div>`;
}

export function mainHtml(v) {
  const cats = new Map(v.categories.map((c) => [c.id, c]));
  const ctx = { cats, nowMs: v.nowMs, live: v.live, quietMode: v.quiet.quiet, quietCaption: v.quietCaption, quietLink: v.quietLink, used: new Map() };
  const shareArgs = { live: v.live, date: v.date, score: v.score, change: v.change, fired: v.fired, categories: v.categories, host: v.siteHost };
  const [lead, ...rest] = v.stories;

  const sections = [];
  if (lead) {
    const label = (lead.quiet || v.quiet.quiet ? 'Top story' : 'Closest call') + (v.live ? ' today' : '');
    sections.push(`<section id="lead">
<h2 class="sec">${esc(label)}</h2>
<ol class="cards">
${card(lead, ctx, { lead: true })}
</ol>
</section>`);
  }
  sections.push(`<section id="receipts">
<h2 class="sec">The receipts</h2>
${receipts(rest, ctx, v.categories)}
</section>`);
  const record = v.live ? recordLine(v.record) : '';
  sections.push(`<section id="bingo">
<h2 class="sec">Doom Bingo</h2>
${bingo(v.fired, v.categories)}
<div class="math"><span>${esc(mathLine({ fired: v.fired, bumps: v.bumps, score: v.score, doom: v.doom }))}</span><button class="btn" type="button" data-act="share">Share</button></div>
${record ? `<p class="record">${esc(record)}</p>` : ''}
</section>`);
  if (v.live && v.vital) {
    sections.push(`<section id="vitals">
<h2 class="sec">Vital signs of civilization</h2>
${vitals(v.vital, { nowMs: v.nowMs, clock: v.clock })}
</section>`);
  }
  if (v.kind === 'home') {
    sections.push(`<section id="almanac">
<h2 class="sec">The Almanac of Almost</h2>
${almanacRows(v.almanac, { root: v.root, categories: v.categories, withFired: false })}
<a class="all" href="${esc(v.root)}almanac/">Every day so far</a>
</section>`);
  } else {
    const prev = v.prev ? `<a href="../${esc(v.prev)}/">&larr; ${esc(shortDate(v.prev))}</a>` : '<span></span>';
    const next = v.next ? `<a href="../${esc(v.next)}/">${esc(shortDate(v.next))} &rarr;</a>` : '<span></span>';
    sections.push(`<nav class="dnav" aria-label="Other days">\n${prev}\n${next}\n</nav>`);
  }

  return `<main id="main" data-share-text="${esc(shareText({ ...shareArgs, withUrl: false }))}" data-share-full="${esc(shareText(shareArgs))}" data-share-url="${esc(`${v.siteUrl}/day/${v.date}/`)}" data-build="${esc(v.buildTime)}">
${hero(v)}
<div class="wrap">
${sub(v)}
${sections.join('\n')}
</div>
</main>`;
}

export function pageHtml(v) {
  const isDay = v.kind === 'day';
  const title = isDay ? dayTitle(v.date) : homeTitle;
  const description = isDay
    ? `Doom ${Math.round(num(v.score))}/99 on ${longDate(v.date)}. ${v.stories.length} near misses, every one linked to its source. The Almanac of Almost.`
    : v.quiet.quiet
      ? QUIET_DESCRIPTION
      : DESCRIPTION;
  const canonical = isDay ? `${v.siteUrl}/day/${v.date}/` : `${v.siteUrl}/`;
  const image = isDay ? `${v.siteUrl}/og/${v.date}.png` : `${v.siteUrl}/og/latest.png`;
  const data = {
    build: v.buildTime,
    success: v.lastSuccessAt || v.buildTime,
    date: v.date,
    live: v.live ? '1' : '0',
    quiet: v.quiet.quiet ? '1' : '0',
    page: v.kind,
  };
  const body = `${mainHtml(v)}\n${footer({ root: v.root, quiet: v.quiet.quiet })}`;
  return page({ root: v.root, title, description, canonical, image, body, data });
}
