// npm run build
//
// Renders the site from data/ into dist/. Nothing is downloaded and nothing
// is fetched: the data files, the day editions, the committed fonts and the
// committed page script are all it needs.
//
//   dist/index.html                 the homepage: a feed of days, today first
//   dist/day/YYYY-MM-DD/index.html  one page per stored day
//   dist/almanac/  dist/about/  dist/404.html
//   dist/feed.xml  dist/sitemap.xml  dist/robots.txt  dist/site.webmanifest
//   dist/api/today.json             public copy of latest.json (no state, no per-source status)
//                                   plus today's headline and lines
//   dist/og/YYYY-MM-DD.png, latest.png   1200x630 share images
//   dist/favicon.svg  dist/apple-touch-icon.png
//   dist/assets/app.js  dist/assets/leaguegothic.woff2  dist/assets/librefranklin-{400,600,700}.woff2
//   dist/assets/OFL-LeagueGothic.txt  dist/assets/OFL-LibreFranklin.txt   the licenses of the two fonts
//
// Every internal link is relative (a ROOT prefix per page type), so the same
// build works at the root of a domain and inside a subfolder. Absolute URLs
// (canonical, share cards, feed, sitemap) use SITE_URL.
//
// What a day says about itself comes from data/editions/ when its edition passes
// the checks in scripts/lib/editions.mjs, and from its plain headlines when not.
//
// Env: SITE_URL  default https://didtheworldendtoday.com
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config as loadConfig } from './config.mjs';
import { paths, REPO_ROOT } from './lib/paths.mjs';
import { readJsonLenient, toJson } from './lib/json.mjs';
import { etDate, etStamp, addDays } from './lib/time.mjs';
import { listDayDates, readDayLenient, recordDay } from './lib/store.mjs';
import { createGatekeeper } from './lib/pipeline.mjs';
import { listingOrder, onePerId, publishableStories, readEditions, resolveDays } from './lib/editions.mjs';
import { safeUrl } from './lib/text.mjs';
import { NOT_FOUND_LINE, QUIET_LINE, subline } from './templates/copy.mjs';
import { aboutPage, almanacPage } from './templates/pages.mjs';
import { feedXml } from './templates/feed.mjs';
import { faviconSvg, fontFilesIn, ogSvg, renderPng } from './templates/graphics.mjs';
import { pageHtml } from './templates/home.mjs';
import { notFoundPage } from './templates/layout.mjs';
import { manifestJson, robotsTxt, sitemapXml } from './templates/seo.mjs';

export const DEFAULT_SITE_URL = 'https://didtheworldendtoday.com';
const ASSETS = path.join(REPO_ROOT, 'assets');

// The web fonts the pages ask for (see the stylesheet): Latin subsets, one file each.
export const WEB_FONTS = ['leaguegothic.woff2', 'librefranklin-400.woff2', 'librefranklin-600.woff2', 'librefranklin-700.woff2'];

// The subsets dropped the license names the fonts carry, so each license text is served beside them.
export const FONT_LICENSES = ['OFL-LeagueGothic.txt', 'OFL-LibreFranklin.txt'];

// What api/today.json shows the world: the page's own numbers and stories, and
// none of the machinery. It is a list of what is public, so a field added to the
// data later stays private until it is named here. The per-source status, the X
// state, and everything about why quiet mode is on (the manual switch, the
// automatic check and the headlines that tripped it) are not on the list.
// Quiet mode itself is public: whether it is on, and the note.
const PUBLIC_KEYS = ['schema', 'buildTime', 'etDate', 'etStamp', 'score', 'fired', 'bumps', 'change', 'yesterday', 'record', 'headlinesRead', 'lastSuccessAt', 'rollingFallback', 'cats', 'vital', 'stories'];

// today: the day the homepage shows ({ headline, rows }). When it is given the copy
// also carries the day's headline and its rows (emoji, label, line, url).
export function publicCopy(latest, today = null) {
  if (!latest || typeof latest !== 'object') return null;
  const out = {};
  for (const key of PUBLIC_KEYS) if (key in latest) out[key] = latest[key];
  const q = latest.quiet && typeof latest.quiet === 'object' ? latest.quiet : {};
  out.quiet = { quiet: Boolean(q.quiet), note: typeof q.note === 'string' ? q.note : '' };
  if (today) {
    out.headline = today.headline;
    out.items = (today.rows || []).map((r) => ({ emoji: r.emoji, label: r.label || '', line: r.line, url: safeUrl(r.url) || '' }));
  }
  return out;
}

function siteUrlFrom(value) {
  const href = safeUrl(value || DEFAULT_SITE_URL) || DEFAULT_SITE_URL;
  return href.replace(/[?#].*$/, '').replace(/\/+$/, '');
}

function emptyLatest(cfg, nowMs) {
  return {
    schema: 1,
    buildTime: new Date(nowMs).toISOString(),
    etDate: etDate(nowMs),
    etStamp: etStamp(nowMs),
    score: cfg.doom.floor,
    fired: [],
    bumps: [],
    change: null,
    yesterday: null,
    record: null,
    headlinesRead: 0,
    lastSuccessAt: null,
    rollingFallback: false,
    cats: {},
    vital: {},
    quiet: { quiet: false, why: null, note: '' },
    x: { enabled: false, skipped: 'off' },
    stories: [],
  };
}

// A day file is never rewritten once its day has passed, so a rule that tightens
// later (the taste filter) is applied here: see publishableStories. The stories of
// a day come out in the order the page lists them.
function readDays(p, firstEdition, gk, variety) {
  const days = [];
  for (const date of listDayDates(p)) {
    if (firstEdition && date < firstEdition) continue;
    const day = readDayLenient(p, date);
    if (day && day.date === date && Array.isArray(day.stories)) days.push({ ...day, stories: listingOrder(publishableStories(gk.excluder, day.stories), variety) });
  }
  return days; // newest first
}

// A page stays under 100 KB raw, CSS included. A normal page is about 60 KB; if a
// very busy one would go over, the last items of its list (the lowest-ranked
// headlines of a day page, the oldest days of the homepage and then the lowest of
// today's other headlines) are left off the page (api/today.json still has every story).
export const PAGE_BUDGET = 96 * 1000;

function fitPage(render, list, budget = PAGE_BUDGET) {
  let keep = list.length;
  let html = render(list);
  while (Buffer.byteLength(html) > budget && keep > 1) {
    keep = Math.max(1, keep - Math.max(1, Math.ceil(keep * 0.05)));
    html = render(list.slice(0, keep));
  }
  return html;
}

export function build(rootOrOpts, maybeOpts) {
  const opts = typeof rootOrOpts === 'string' ? { ...(maybeOpts || {}), root: rootOrOpts } : rootOrOpts || {};
  const cfg = opts.config ?? loadConfig();
  const p = paths(opts.root ?? REPO_ROOT);
  const assets = opts.assets ?? ASSETS;
  const siteUrl = siteUrlFrom(opts.siteUrl ?? process.env.SITE_URL);
  const siteHost = siteUrl.replace(/^https?:\/\//, '');
  const nowMs = opts.now ? new Date(opts.now).getTime() : Date.now();
  const gk = createGatekeeper(cfg);

  const stored = readJsonLenient(p.latest, null);
  const hasData = Boolean(stored && typeof stored === 'object' && Array.isArray(stored.stories));
  const latest = hasData ? { ...stored, stories: onePerId(publishableStories(gk.excluder, stored.stories), cfg.variety) } : emptyLatest(cfg, nowMs);
  const today = latest.etDate;

  // Today's day is the homepage's own snapshot: its day page reads the same numbers
  // and stories, so the page, the share text and the share card cannot disagree.
  // Every other day is read from its file as it was left. When today has no file yet
  // the snapshot stands in for it.
  const read = readDays(p, cfg.firstEdition, gk, cfg.variety);
  const snapshot = { date: today, score: latest.score, fired: latest.fired, bumps: latest.bumps, change: latest.change, updatedAt: latest.buildTime, stories: listingOrder(latest.stories, cfg.variety) };
  let days = read.map((d) => (hasData && d.date === today ? { ...d, score: latest.score, fired: latest.fired, bumps: latest.bumps, change: latest.change, stories: snapshot.stories } : d));
  if (hasData && !days.some((d) => d.date === today) && (!cfg.firstEdition || today >= cfg.firstEdition)) days = [snapshot, ...days].sort((a, b) => (a.date < b.date ? 1 : -1));

  const quiet = {
    quiet: Boolean(latest.quiet && latest.quiet.quiet),
    note: latest.quiet && typeof latest.quiet.note === 'string' ? latest.quiet.note : '',
  };

  // ---- what each day says about itself ------------------------------------------------
  const emojiByCat = new Map(cfg.categories.map((c) => [c.id, c.emoji]));
  const resolved = resolveDays({
    days,
    editions: readEditions(p),
    excluder: gk.excluder,
    quietMode: quiet.quiet,
    fallbackHeadline: (day) => (quiet.quiet ? QUIET_LINE : subline(day.score)),
    emojiByCat,
  });

  // Only known categories count as fired, and only real objects as extra points.
  const known = new Set(cfg.categories.map((c) => c.id));
  const firedOf = (list) => (Array.isArray(list) ? list.filter((id) => known.has(id)) : []);
  const viewOf = (day, before) => {
    const r = resolved.get(day.date);
    // A day's change is what it said on the day; an older file without one is worked out from the day before.
    const change = 'change' in day ? (Number.isFinite(Number(day.change)) && day.change !== null ? Number(day.change) : null) : before ? day.score - before.score : null;
    return {
      date: day.date,
      score: day.score,
      change,
      fired: firedOf(day.fired),
      updatedAt: day.updatedAt,
      headline: r.headline,
      by: r.by,
      rows: r.rows,
      byId: r.byId,
      stories: day.stories,
      total: day.stories.length,
    };
  };
  const views = days.map((d, i) => viewOf(d, days[i + 1] && days[i + 1].date === addDays(d.date, -1) ? days[i + 1] : null));
  const emptyDay = () => ({
    date: today,
    score: latest.score,
    change: null,
    fired: [],
    updatedAt: latest.buildTime,
    headline: quiet.quiet ? QUIET_LINE : subline(latest.score),
    by: 'fallback',
    rows: [],
    byId: new Map(),
    stories: [],
    total: 0,
  });
  const todayView = views.find((v) => v.date === today) || emptyDay();

  // A day with nothing filed yet (the first hours after midnight Eastern) is not listed in the Almanac or the feed.
  const filed = views.filter((v) => v.total > 0);
  const record = recordDay(filed.map((v) => ({ date: v.date, score: v.score }))) || latest.record || null;
  const entries = filed.map((v) => ({ date: v.date, score: v.score, headline: v.headline }));

  const shared = {
    siteUrl,
    siteHost,
    categories: cfg.categories,
    doomCap: cfg.doom.cap,
    quietCaption: cfg.quiet.quietCaption,
    quietLink: cfg.quiet.quietLink,
    quietLinkIntl: cfg.quiet.quietLinkIntl,
    quiet,
    today,
    buildTime: latest.buildTime,
    nowMs: Date.parse(latest.buildTime) || nowMs,
    lastSuccessAt: latest.lastSuccessAt,
    headlinesRead: Number(latest.headlinesRead) || 0,
    todayTotal: todayView.total,
  };
  // What the footer of every page says besides its own links: when the data was last read, and today's headlines.
  const foot = { updatedMs: Date.parse(latest.lastSuccessAt || latest.buildTime), today, headlineCount: todayView.total };

  const out = [];
  const write = (rel, content) => {
    const file = path.join(p.dist, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    out.push(rel);
  };

  fs.rmSync(p.dist, { recursive: true, force: true });
  fs.mkdirSync(p.dist, { recursive: true });

  // ---- the homepage: today, then up to six earlier days ---------------------------------
  // Today's See more holds every other headline of the day. A page over its budget gives up its earlier days
  // first, and only then the lowest of those headlines.
  const feed = [todayView, ...filed.filter((v) => v.date < today)];
  const feedDays = feed.slice(0, cfg.edition.homeDays);
  const homeHtml = (days, stories) => pageHtml({ ...shared, root: './', kind: 'home', day: todayView, days: [{ ...todayView, stories }, ...days.slice(1)], olderDays: feed.length - days.length });
  const homeBudget = opts.pageBudget ?? PAGE_BUDGET;
  let home = fitPage((days) => homeHtml(days, todayView.stories), feedDays, homeBudget);
  if (Buffer.byteLength(home) > homeBudget) home = fitPage((stories) => homeHtml(feedDays.slice(0, 1), stories), todayView.stories, homeBudget);
  write('index.html', home);

  // ---- one page per stored day -------------------------------------------------------------
  const dates = views.map((v) => v.date);
  views.forEach((view, i) => {
    write(
      `day/${view.date}/index.html`,
      fitPage((stories) => pageHtml({ ...shared, root: '../../', kind: 'day', day: { ...view, stories }, prev: dates[i + 1] || null, next: dates[i - 1] || null }), view.stories, opts.pageBudget),
    );
  });

  // ---- the other pages --------------------------------------------------------------------
  write('almanac/index.html', almanacPage({ root: '../', siteUrl, entries, record, quiet: quiet.quiet, foot }));
  write('about/index.html', aboutPage({ root: '../', siteUrl, cfg, quiet: quiet.quiet, xEnabled: Boolean(latest.x && latest.x.enabled), foot }));
  write('404.html', notFoundPage({ siteUrl, line: NOT_FOUND_LINE, linkText: 'Back to today' }));

  // ---- data, feed, search and app files ------------------------------------------------------
  write('api/today.json', toJson(publicCopy(latest, todayView)));
  write('feed.xml', feedXml({ siteUrl, days: filed, buildTime: latest.buildTime, doomCap: cfg.doom.cap }));
  write('sitemap.xml', sitemapXml({ siteUrl, dates, lastmod: latest.buildTime }));
  write('robots.txt', robotsTxt(siteUrl));
  write('site.webmanifest', manifestJson());
  write('favicon.svg', faviconSvg());
  write('assets/app.js', fs.readFileSync(path.join(assets, 'app.js')));
  for (const font of WEB_FONTS) write(`assets/${font}`, fs.readFileSync(path.join(assets, 'fonts', font)));
  for (const license of FONT_LICENSES) write(`assets/${license}`, fs.readFileSync(path.join(assets, 'fonts', license)));

  // ---- pictures --------------------------------------------------------------------------------
  // The card is the sign: the question on the black band, ALMOST., the first sentence of the day's headline
  // and the Doom Score board. In quiet mode the headline is the quiet line, the page is white and nothing is red.
  const fontFiles = fontFilesIn(assets);
  const og = (view) => renderPng(ogSvg({ date: view.date, score: view.score, host: siteHost, headline: view.headline, fontFiles, live: view.date === today, quiet: quiet.quiet }), { fontFiles, width: 1200 });
  write('og/latest.png', og(todayView));
  // The homepage points at today's own card, so it has one even before today's file exists.
  if (!dates.includes(today)) write(`og/${today}.png`, og(todayView));
  for (const view of views) write(`og/${view.date}.png`, og(view));
  write('apple-touch-icon.png', renderPng(faviconSvg(), { fontFiles, width: 180 }));

  return { dist: p.dist, hasData, days: dates, files: out };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = build({});
  console.log(`build: wrote ${result.files.length} files to ${path.relative(process.cwd(), result.dist) || 'dist'}, ${result.days.length} day page${result.days.length === 1 ? '' : 's'}${result.hasData ? '' : ' (no data yet)'}`);
}
