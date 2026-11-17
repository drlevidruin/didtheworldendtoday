// npm run build
//
// Renders the site from data/ into dist/. Nothing is downloaded and nothing
// is fetched: the data files, the committed font and the committed page script
// are all it needs.
//
//   dist/index.html                 the homepage (rolling 24 hours)
//   dist/day/YYYY-MM-DD/index.html  one page per stored day
//   dist/almanac/  dist/about/  dist/404.html
//   dist/feed.xml  dist/sitemap.xml  dist/robots.txt  dist/site.webmanifest
//   dist/api/today.json             public copy of latest.json (no state, no per-source status)
//   dist/og/YYYY-MM-DD.png, latest.png   1200x630 share images
//   dist/favicon.svg  dist/apple-touch-icon.png
//   dist/assets/app.js  dist/assets/anton.woff2
//
// Every internal link is relative (a ROOT prefix per page type), so the same
// build works at the root of a domain and inside a subfolder. Absolute URLs
// (canonical, share cards, feed, sitemap) use SITE_URL.
//
// Env: SITE_URL  default https://didtheworldendtoday.com
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config as loadConfig } from './config.mjs';
import { paths, REPO_ROOT } from './lib/paths.mjs';
import { readJsonLenient, toJson } from './lib/json.mjs';
import { etDate, etStamp, addDays } from './lib/time.mjs';
import { listDayDates, readDayLenient, indexEntry, recordDay } from './lib/store.mjs';
import { compareStories } from './lib/cluster.mjs';
import { createGatekeeper } from './lib/pipeline.mjs';
import { receiptsOrder } from './lib/order.mjs';
import { safeUrl } from './lib/text.mjs';
import { NOT_FOUND_LINE, QUIET_LINE, subline } from './templates/copy.mjs';
import { aboutPage, almanacPage } from './templates/pages.mjs';
import { feedXml } from './templates/feed.mjs';
import { faviconSvg, fontFileIn, ogSvg, renderPng } from './templates/graphics.mjs';
import { pageHtml } from './templates/home.mjs';
import { notFoundPage } from './templates/layout.mjs';
import { manifestJson, robotsTxt, sitemapXml } from './templates/seo.mjs';

export const DEFAULT_SITE_URL = 'https://didtheworldendtoday.com';
const ASSETS = path.join(REPO_ROOT, 'assets');

// What api/today.json shows the world: the page's own numbers and stories, and
// none of the machinery. It is a list of what is public, so a field added to the
// data later stays private until it is named here. The per-source status, the X
// state, and everything about why quiet mode is on (the manual switch, the
// automatic check and the headlines that tripped it) are not on the list.
// Quiet mode itself is public: whether it is on, and the note.
const PUBLIC_KEYS = ['schema', 'buildTime', 'etDate', 'etStamp', 'score', 'fired', 'bumps', 'change', 'yesterday', 'record', 'headlinesRead', 'lastSuccessAt', 'rollingFallback', 'cats', 'vital', 'stories'];

export function publicCopy(latest) {
  if (!latest || typeof latest !== 'object') return null;
  const out = {};
  for (const key of PUBLIC_KEYS) if (key in latest) out[key] = latest[key];
  const q = latest.quiet && typeof latest.quiet === 'object' ? latest.quiet : {};
  out.quiet = { quiet: Boolean(q.quiet), note: typeof q.note === 'string' ? q.note : '' };
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

// A story list holds plain objects and nothing else, so one odd entry in a data
// file cannot stop the whole site from building.
const plainStories = (list) => (Array.isArray(list) ? list.filter((s) => s && typeof s === 'object' && !Array.isArray(s)) : []);

// The Doomsday Clock tile needs its two facts; if the data lost them, the config has them.
const validClock = (c) => (c && Number.isFinite(Number(c.secondsToMidnight)) && /^\d{4}-\d\d-\d\d$/.test(String(c.setOn)) && typeof c.url === 'string' ? c : null);

// A day file is never rewritten once its day has passed, so a rule that tightens
// later (the taste filter) is applied here instead: a story the current
// exclusion rules would not publish is left off every page, the almanac and the
// feed. The data file itself is not changed.
function publishable(gk, list) {
  return plainStories(list).filter((s) => {
    try {
      return !gk.excluder.test(s.title, { signal: s.kind === 'signal' });
    } catch {
      return false; // a story too odd to check is not published
    }
  });
}

// One day's stories in the order the page lists them. It depends only on the
// stories themselves, so a day written in rank order and a day written in
// listing order come out the same.
const listingOrder = (stories, variety) => receiptsOrder([...stories].sort(compareStories), variety);

function readDays(p, firstEdition, gk, variety) {
  const days = [];
  for (const date of listDayDates(p)) {
    if (firstEdition && date < firstEdition) continue;
    const day = readDayLenient(p, date);
    if (day && day.date === date && Array.isArray(day.stories)) days.push({ ...day, stories: listingOrder(publishable(gk, day.stories), variety) });
  }
  return days; // newest first
}

// A page stays under 100 KB raw, CSS included. A normal day is about 60 KB; if a
// very busy one would go over, the lowest-ranked receipts are left off the
// page (api/today.json still has every story).
export const PAGE_BUDGET = 96 * 1000;

function fitPage(render, stories, budget = PAGE_BUDGET) {
  let keep = stories.length;
  let html = render(stories);
  while (Buffer.byteLength(html) > budget && keep > 1) {
    keep = Math.max(1, keep - Math.max(1, Math.ceil(keep * 0.05)));
    html = render(stories.slice(0, keep));
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
  const latest = hasData ? { ...stored, stories: publishable(gk, stored.stories) } : emptyLatest(cfg, nowMs);
  // Today's edition is the homepage's own snapshot: its day page reads the same
  // numbers and stories, so the page, the share text and the share card cannot
  // disagree. Every other day is read from its file as it was left.
  const read = readDays(p, cfg.firstEdition, gk, cfg.variety);
  const days = read.map((d) =>
    hasData && d.date === latest.etDate ? { ...d, score: latest.score, fired: latest.fired, bumps: latest.bumps, change: latest.change, stories: latest.stories } : d,
  );
  const index = days.map(indexEntry);
  const record = recordDay(index) || latest.record || null;
  // A day with nothing filed yet (the first hours after midnight Eastern) is not listed in the Almanac or the feed.
  const listed = index.filter((e) => e.top && e.top.title);
  const filedDays = days.filter((d) => d.stories.length > 0);

  const quiet = {
    quiet: Boolean(latest.quiet && latest.quiet.quiet),
    note: latest.quiet && typeof latest.quiet.note === 'string' ? latest.quiet.note : '',
  };
  const shared = {
    siteUrl,
    siteHost,
    categories: cfg.categories,
    doom: cfg.doom,
    clock: validClock(latest.vital && latest.vital.clock) || cfg.clock,
    quietCaption: cfg.quiet.quietCaption,
    quietLink: cfg.quiet.quietLink,
    quietLinkIntl: cfg.quiet.quietLinkIntl,
    quiet,
    record,
    editions: listed.length,
    buildTime: latest.buildTime,
    nowMs: Date.parse(latest.buildTime) || nowMs,
    lastSuccessAt: latest.lastSuccessAt,
    headlinesRead: Number(latest.headlinesRead) || 0,
  };

  // Only known categories count as fired, and only real objects as extra points.
  const known = new Set(cfg.categories.map((c) => c.id));
  const firedOf = (list) => (Array.isArray(list) ? list.filter((id) => known.has(id)) : []);
  const bumpsOf = (list) => (Array.isArray(list) ? list.filter((b) => b && typeof b === 'object') : []);

  const out = [];
  const write = (rel, content) => {
    const file = path.join(p.dist, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    out.push(rel);
  };

  fs.rmSync(p.dist, { recursive: true, force: true });
  fs.mkdirSync(p.dist, { recursive: true });

  // ---- the homepage -------------------------------------------------------
  write(
    'index.html',
    fitPage(
      (stories) =>
        pageHtml({
          ...shared,
          root: './',
          kind: 'home',
          live: true,
          date: latest.etDate,
          score: latest.score,
          change: latest.change,
          fired: firedOf(latest.fired),
          bumps: bumpsOf(latest.bumps),
          stories, // already in listing order
          vital: latest.vital || {},
          almanac: listed.slice(0, 7),
        }),
      latest.stories || [],
      opts.pageBudget,
    ),
  );

  // ---- one page per stored day -------------------------------------------------
  const dates = days.map((d) => d.date);
  days.forEach((day, i) => {
    const before = days[i + 1] && days[i + 1].date === addDays(day.date, -1) ? days[i + 1] : null;
    const isToday = day.date === latest.etDate;
    // A day's change is what it said on the day; an older file without one is worked out from the day before.
    const change = 'change' in day ? (Number.isFinite(Number(day.change)) && day.change !== null ? Number(day.change) : null) : before ? day.score - before.score : null;
    write(
      `day/${day.date}/index.html`,
      fitPage(
        (stories) =>
          pageHtml({
            ...shared,
            root: '../../',
            kind: 'day',
            live: isToday,
            date: day.date,
            score: day.score,
            change,
            fired: firedOf(day.fired),
            bumps: bumpsOf(day.bumps),
            stories,
            vital: isToday ? latest.vital || {} : null,
            almanac: [],
            prev: dates[i + 1] || null,
            next: dates[i - 1] || null,
          }),
        day.stories,
        opts.pageBudget,
      ),
    );
  });

  // ---- the other pages --------------------------------------------------------
  write('almanac/index.html', almanacPage({ root: '../', siteUrl, entries: listed, record, categories: cfg.categories, quiet: quiet.quiet }));
  write('about/index.html', aboutPage({ root: '../', siteUrl, cfg, quiet: quiet.quiet, xEnabled: Boolean(latest.x && latest.x.enabled) }));
  write('404.html', notFoundPage({ siteUrl, line: NOT_FOUND_LINE, linkText: 'Back to today' }));

  // ---- data, feed, search and app files ------------------------------------------
  write('api/today.json', toJson(publicCopy(latest)));
  write('feed.xml', feedXml({ siteUrl, days: filedDays, categories: cfg.categories, buildTime: latest.buildTime }));
  write('sitemap.xml', sitemapXml({ siteUrl, dates, lastmod: latest.buildTime }));
  write('robots.txt', robotsTxt(siteUrl));
  write('site.webmanifest', manifestJson());
  write('favicon.svg', faviconSvg());
  write('assets/app.js', fs.readFileSync(path.join(assets, 'app.js')));
  write('assets/anton.woff2', fs.readFileSync(path.join(assets, 'fonts', 'anton.woff2')));

  // ---- pictures ----------------------------------------------------------------
  // The card carries the same line the page puts under ALMOST. (or the quiet line, in quiet mode).
  const fontFile = fontFileIn(assets);
  const og = (date, score, fired) =>
    renderPng(ogSvg({ date, score, fired, categories: cfg.categories, host: siteHost, line: quiet.quiet ? QUIET_LINE : subline(score) }), { fontFile, width: 1200 });
  write('og/latest.png', og(latest.etDate, latest.score, firedOf(latest.fired)));
  // The homepage points at today's own card, so it has one even before today's file exists.
  if (!dates.includes(latest.etDate)) write(`og/${latest.etDate}.png`, og(latest.etDate, latest.score, firedOf(latest.fired)));
  for (const day of days) write(`og/${day.date}.png`, og(day.date, day.score, firedOf(day.fired)));
  write('apple-touch-icon.png', renderPng(faviconSvg({ rounded: false }), { fontFile, width: 180 }));

  return { dist: p.dist, hasData, days: dates, files: out };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = build({});
  console.log(`build: wrote ${result.files.length} files to ${path.relative(process.cwd(), result.dist) || 'dist'}, ${result.days.length} day page${result.days.length === 1 ? '' : 's'}${result.hasData ? '' : ' (no data yet)'}`);
}
