// npm run update
//
// One run: ask every source what is happening, throw away what we do not
// publish (deaths, war, politics, off-topic), merge what is left into the
// archive without ever losing an earlier story, score the day, and write the
// files the site is built from. It exits 0 even when sources fail (a failed
// source reuses its last good reading and is marked stale); it exits non-zero
// only for a real bug or an unreadable archive file.
//
// Flags:  --verbose        print every kept story by category and every drop
//         --dump <file>    write kept and dropped lists as JSON for tuning
// Env:    DTWET_OFFLINE=1  send every request to a name that cannot resolve
//         DTWET_ROOT=dir   read and write somewhere else (tests, dry runs)
//         DTWET_NOW=iso    pretend it is this moment
//         DTWET_CACHE_DIR  development only: reuse recent responses
//         X_BEARER_TOKEN   turns the X source on (never printed)
//
// Files written (all JSON, two-space indent, atomic):
//   data/days/YYYY-MM-DD.json  { date, score, fired[], bumps[], change, updatedAt, stories[] }
//                              today's edition only: the same rolling 24 hour view
//                              the homepage shows, stories in listing order. Every
//                              run rewrites today's file; a day whose ET date has
//                              passed is never touched again, so its last snapshot
//                              is its final edition and its almanac score.
//                              updatedAt moves only when the content does.
//   data/days.json             [{ date, score, fired[], top{title,url,source,cat}, cats{} }], newest first
//   data/latest.json           what the homepage renders: rolling 24 h stories,
//                              score, fired[], bumps[], change vs yesterday's final
//                              score, yesterday, record, vital signs, quiet mode,
//                              per-source status, headlinesRead, buildTime
//   data/state/sources.json    per source: ok, count, error, lastTryAt, lastOkAt, last good vital
//   data/state/x.json          since_id, cached user ids, usage and estimated spend per UTC day
//   data/state/quiet.json      the automatic quiet mode hold
//
// A story: { id, cat, kind: news|signal|x, title, url, source, publishedAt (its oldest member's),
//   latestAt (its newest member's, never in the future), firstSeenAt, outlets, outletNames[],
//   trending? (the most Google searches any trend about it drew, kept while the story lives),
//   trendTerm? (the Google search of the trend it came from, kept while the story lives),
//   score, signal?, quiet?, quietReason? }
// Headlines are third-party text: stored as published, escaped when rendered.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { config as loadConfig } from './config.mjs';
import { createHttp } from './lib/http.mjs';
import { paths, REPO_ROOT } from './lib/paths.mjs';
import { readJsonLenient, writeJsonIfChanged } from './lib/json.mjs';
import { addDays, etDate, etStamp, HOUR_MS } from './lib/time.mjs';
import { mergeStories, selectForDay } from './lib/cluster.mjs';
import { computeDoom } from './lib/doom.mjs';
import { quietReason } from './lib/quietcards.mjs';
import { createGatekeeper, holdsXPost } from './lib/pipeline.mjs';
import { receiptsOrder } from './lib/order.mjs';
import { buildIndex, pruneBefore, readDay, recordDay, saveDay, saveIndex } from './lib/store.mjs';
import { emptyLatch, evaluateTopStories, normalizeLatch, readQuietFile, resolveQuiet } from './lib/quietmode.mjs';
import { withDevCache } from './lib/devcache.mjs';
import { normalizeState as normalizeXState } from './sources/x.mjs';
import * as google from './sources/google.mjs';
import * as bing from './sources/bing.mjs';
import * as gdelt from './sources/gdelt.mjs';
import * as hn from './sources/hn.mjs';
import * as usgs from './sources/usgs.mjs';
import * as swpc from './sources/swpc.mjs';
import * as jpl from './sources/jpl.mjs';
import * as faa from './sources/faa.mjs';
import * as status from './sources/status.mjs';
import * as xsrc from './sources/x.mjs';
import * as trends from './sources/trends.mjs';
import * as topstories from './sources/topstories.mjs';

export const SOURCES = [google, bing, gdelt, hn, usgs, swpc, jpl, faa, status, xsrc, trends, topstories];

// Sources whose success counts as "the feeds are alive".
const FEED_IDS = ['google', 'bing', 'gdelt', 'hn', 'usgs', 'swpc', 'jpl', 'faa', 'status'];
// Which part of the vital signs each instrument source owns.
const VITAL_KEYS = { usgs: ['quake'], swpc: ['kp'], jpl: ['asteroid'], faa: ['faa'], status: ['status'] };

const iso = (ms) => new Date(ms).toISOString();

async function runSource(src, ctx) {
  const t0 = Date.now();
  try {
    const r = await src.run(ctx);
    return { ...r, id: src.id, ok: Boolean(r.ok), count: r.count ?? 0, error: r.error ?? null, ms: Date.now() - t0 };
  } catch (err) {
    // Sources are written never to throw; if one does, it is a failed source, not a failed run.
    return { id: src.id, ok: false, count: 0, error: `crashed: ${err.message}`, crashed: true, ms: Date.now() - t0 };
  }
}

function validStoredStory(s) {
  return (
    s &&
    typeof s === 'object' &&
    typeof s.id === 'string' &&
    typeof s.title === 'string' &&
    typeof s.url === 'string' &&
    typeof s.cat === 'string' &&
    (s.kind === 'news' || s.kind === 'signal' || s.kind === 'x') &&
    Number.isFinite(Date.parse(s.publishedAt))
  );
}

// What became of this run's X posts, for the run's summary: how many passed the filters, the ones that did not and
// why, and how many stories hold an X post, in all and in today's list. The owner wants X posts on the page.
export function xTrace(kept, droppedList, merged, rolling) {
  return {
    passed: kept.filter((i) => i.kind === 'x').length,
    dropped: droppedList.filter((d) => d.via === 'x'),
    inAll: merged.filter(holdsXPost).length,
    onList: rolling.filter(holdsXPost).length,
  };
}

function bump(map, key, n = 1) {
  map[key] = (map[key] || 0) + n;
}

export async function runUpdate(opts = {}) {
  const env = opts.env ?? process.env;
  const now = opts.now ? new Date(opts.now) : env.DTWET_NOW ? new Date(env.DTWET_NOW) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error('Bad clock value for this run');
  const nowMs = now.getTime();
  const nowIso = iso(nowMs);
  const cfg = opts.config ?? loadConfig();
  const p = paths(opts.root ?? env.DTWET_ROOT ?? REPO_ROOT);
  const sources = opts.sources ?? SOURCES;

  let fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (env.DTWET_CACHE_DIR) fetchImpl = withDevCache(fetchImpl, env.DTWET_CACHE_DIR, Number(env.DTWET_CACHE_MINUTES) || 30);
  const http =
    opts.http ??
    createHttp({
      fetchImpl,
      offline: env.DTWET_OFFLINE === '1',
      sleep: opts.sleep,
      deadline: Date.now() + (opts.budgetMs ?? 6 * 60 * 1000),
      ...(opts.httpOptions || {}),
    });

  // ---- what we already have ----------------------------------------------
  const today = etDate(nowMs);
  // Nothing before the first edition is written or kept.
  const poolDates = [today, addDays(today, -1), addDays(today, -2)].filter((d) => d >= cfg.firstEdition);
  pruneBefore(p, cfg.firstEdition);
  const prevDays = {};
  const stored = [];
  for (const d of poolDates) {
    const day = readDay(p, d); // strict: a corrupt archive file stops the run
    prevDays[d] = day;
    for (const s of Array.isArray(day?.stories) ? day.stories : []) if (validStoredStory(s)) stored.push(s);
  }
  const prevSources = readJsonLenient(p.sourcesState, {}) || {};
  const prevLatest = readJsonLenient(p.latest, null);
  const xState = normalizeXState(readJsonLenient(p.xState, null));
  const latch = normalizeLatch(readJsonLenient(p.quietState, emptyLatch()));

  // ---- ask the world ------------------------------------------------------
  const ctx = { http, now, config: cfg, env, xState, prev: prevSources };
  const results = await Promise.all(sources.map((s) => runSource(s, ctx)));
  const byId = Object.fromEntries(results.map((r) => [r.id, r]));

  // ---- filter -------------------------------------------------------------
  const gk = createGatekeeper(cfg);
  const dropped = {};
  const droppedList = [];
  const kept = [];
  let headlinesRead = 0;
  for (const r of results) {
    for (const item of [...(r.items || []), ...(r.signals || [])]) {
      if (item.kind !== 'signal') headlinesRead += 1;
      const out = gk.admit(item, nowMs);
      if (out.keep) kept.push(out.keep);
      else {
        bump(dropped, out.drop);
        droppedList.push({ reason: out.drop, detail: out.detail || null, via: r.id, cat: item.cat ?? null, title: item.title, source: item.source });
      }
    }
  }

  const storedKept = [];
  const cleaned = {};
  for (const s of stored) {
    const out = gk.recheck(s);
    if (out.keep) storedKept.push(out.keep);
    else {
      bump(cleaned, out.drop);
      droppedList.push({ reason: `stored:${out.drop}`, detail: out.detail || null, via: 'archive', cat: s.cat, title: s.title, source: s.source });
    }
  }

  // ---- merge, then the one view everything is built from -------------------
  const merged = mergeStories(storedKept, kept, { now: nowMs, boilerplate: cfg.x?.boilerplate });
  for (const s of merged) {
    const reason = quietReason(s);
    if (reason) {
      s.quiet = true;
      s.quietReason = reason;
    } else {
      delete s.quiet;
      delete s.quietReason;
    }
  }

  // The homepage, today's day page, the share card and the score all read this
  // one list: the stories of the last 24 hours. Nothing published before the
  // first edition's day is ever shown.
  const eligible = merged.filter((s) => etDate(Date.parse(s.publishedAt)) >= cfg.firstEdition);
  const outOfWindow = merged.length - eligible.length;
  const doomCfg = { categories: cfg.categories, doom: cfg.doom };
  const selCfg = { floor: cfg.limits.perCategoryFloor, categoryCount: cfg.categories.length };
  const windowStart = nowMs - cfg.window.rollingHours * HOUR_MS;
  let rollingPool = eligible.filter((s) => {
    const t = Date.parse(s.publishedAt);
    return t >= windowStart && t <= nowMs + HOUR_MS;
  });
  let rollingFallback = false;
  if (!rollingPool.length && eligible.length) {
    // Nothing in the last 24 hours (a quiet midnight, or every feed down): keep the list from going empty.
    rollingPool = [...eligible].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, cfg.limits.fallbackStories);
    rollingFallback = true;
  }
  const rolling = selectForDay(rollingPool, { limit: cfg.limits.rollingStories, ...selCfg });
  // Stories shown only to keep the list from going empty are old news: they never count toward the score or a fired category.
  const rollingDoom = computeDoom(rollingFallback ? [] : rolling, doomCfg);
  // Listed so no one category fills the top of the page (see lib/order.mjs).
  const listing = receiptsOrder(rolling, cfg.variety);

  // Yesterday's file is its final edition: the rolling score is compared with that.
  const yesterdayDate = addDays(today, -1);
  const yesterdayDay = prevDays[yesterdayDate];
  const yesterday =
    yesterdayDay && yesterdayDay.date === yesterdayDate && Array.isArray(yesterdayDay.stories) && Number.isFinite(yesterdayDay.score)
      ? { date: yesterdayDate, score: yesterdayDay.score, fired: Array.isArray(yesterdayDay.fired) ? yesterdayDay.fired : [] }
      : null;
  const change = yesterday ? rollingDoom.score - yesterday.score : null;

  // Today's file is the same view, written every run. A day that has passed is never rewritten.
  if (today >= cfg.firstEdition) {
    saveDay(p, { date: today, score: rollingDoom.score, fired: rollingDoom.fired, bumps: rollingDoom.bumps, change, stories: listing }, prevDays[today], nowIso);
  }

  // The almanac index never lists a story the current rules would not publish, old days included.
  const index = buildIndex(p, cfg.firstEdition, (s) => !gk.excluder.test(s.title, { signal: s.kind === 'signal', source: s.source }));
  saveIndex(p, index);
  const record = recordDay(index);

  // ---- vital signs, with last-good reuse -----------------------------------
  const nextSources = {};
  const vital = {};
  for (const r of results) {
    const prev = prevSources[r.id] || {};
    const entry = {
      ok: r.ok,
      count: r.count,
      error: r.error,
      lastTryAt: nowIso,
      lastOkAt: r.ok && !r.skipped ? nowIso : prev.lastOkAt ?? null,
    };
    if (VITAL_KEYS[r.id]) {
      entry.vital = { ...(prev.vital || {}), ...(r.ok && r.vital ? r.vital : {}) };
      for (const key of VITAL_KEYS[r.id]) {
        if (r.ok && r.vital && key in r.vital) {
          vital[key] = r.vital[key];
        } else if (prev.vital && key in prev.vital) {
          const ageMs = prev.lastOkAt ? nowMs - Date.parse(prev.lastOkAt) : Infinity;
          const fresh = ageMs <= (cfg.staleHours[r.id] ?? 6) * HOUR_MS;
          vital[key] = fresh && prev.vital[key] ? { ...prev.vital[key], stale: true, staleSince: prev.lastOkAt } : { unavailable: true, stale: true, staleSince: prev.lastOkAt ?? null };
        } else {
          vital[key] = null;
        }
      }
    }
    nextSources[r.id] = entry;
  }
  vital.clock = cfg.clock;
  writeJsonIfChanged(p.sourcesState, nextSources);
  writeJsonIfChanged(p.xState, byId.x?.state ?? xState);

  // ---- quiet mode -----------------------------------------------------------
  const manual = readQuietFile(p.quiet);
  const top = byId.topstories;
  const auto =
    top && top.ok
      ? { checked: true, via: top.via, evaluation: evaluateTopStories(top.titles, cfg.quiet) }
      : { checked: false, via: null, error: top?.error ?? 'not run' };
  const quiet = resolveQuiet({ manual, auto, latch, nowMs, holdHours: cfg.quiet.holdHours });
  writeJsonIfChanged(p.quietState, quiet.latch);
  const { latch: _latch, ...quietOut } = quiet; // eslint-disable-line no-unused-vars

  // ---- latest.json: written last --------------------------------------------
  const feedOk = FEED_IDS.filter((id) => byId[id]?.ok);
  const lastOks = FEED_IDS.map((id) => nextSources[id]?.lastOkAt).filter(Boolean).sort();
  const lastSuccessAt = feedOk.length ? nowIso : lastOks.length ? lastOks[lastOks.length - 1] : prevLatest?.lastSuccessAt ?? null;
  const cats = {};
  for (const s of rolling) bump(cats, s.cat);
  const sourcesOut = {};
  for (const r of results) {
    const e = nextSources[r.id];
    sourcesOut[r.id] = { ok: e.ok, count: e.count, error: e.error, lastOkAt: e.lastOkAt, ...(r.skipped ? { skipped: r.skipped } : {}) };
  }
  const latest = {
    schema: 1,
    buildTime: nowIso,
    etDate: today,
    etStamp: etStamp(nowMs),
    score: rollingDoom.score,
    fired: rollingDoom.fired,
    bumps: rollingDoom.bumps,
    change,
    yesterday,
    record,
    headlinesRead: headlinesRead || prevLatest?.headlinesRead || 0,
    lastSuccessAt,
    rollingFallback,
    cats,
    vital,
    quiet: quietOut,
    x: { enabled: Boolean(byId.x?.enabled), skipped: byId.x?.skipped ?? null },
    sources: sourcesOut,
    stories: listing,
  };
  writeJsonIfChanged(p.latest, latest);

  const report = {
    now: nowIso,
    results: results.map(({ items, signals, titles, state, vital: v, ...r }) => r),
    headlinesRead,
    keptCount: kept.length,
    dropped,
    cleaned,
    outOfWindow,
    rollingCount: rolling.length,
    rollingFallback,
    score: rollingDoom.score,
    fired: rollingDoom.fired,
    quiet: quietOut,
    kept: rolling,
    droppedList,
    xTrace: xTrace(kept, droppedList, merged, rolling),
  };
  return { latest, report, results };
}

export function formatSummary(report) {
  const lines = [];
  lines.push(`update ${etStamp(Date.parse(report.now))}`);
  for (const r of report.results) {
    const state = r.ok ? (r.skipped ? `skip (${r.skipped})` : 'ok') : 'FAIL';
    const detail = r.error ? `  ${String(r.error).slice(0, 110)}` : '';
    lines.push(`  ${r.id.padEnd(10)} ${state.padEnd(12)} ${String(r.count).padStart(5)}${detail}`);
  }
  const reasons = Object.entries(report.dropped)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(', ');
  lines.push(`  read ${report.headlinesRead} headlines, kept ${report.keptCount}, dropped: ${reasons || 'none'}`);
  const xt = report.xTrace;
  if (xt && (xt.passed || xt.dropped.length)) {
    lines.push(`  x posts: ${xt.passed} passed the filters, ${xt.dropped.length} dropped; stories that hold one: ${xt.inAll} in all, ${xt.onList} in today's list`);
    for (const d of xt.dropped.slice(0, 10)) lines.push(`    dropped ${d.reason}${d.detail ? ` [${d.detail}]` : ''}: ${String(d.title).slice(0, 90)}`);
  }
  const cleaned = Object.entries(report.cleaned)
    .map(([k, n]) => `${k} ${n}`)
    .join(', ');
  if (cleaned) lines.push(`  removed from the archive by the current rules: ${cleaned}`);
  lines.push(`  stories: ${report.rollingCount} in the last 24 h${report.rollingFallback ? ' (none that new, so the latest are shown and not scored)' : ''}`);
  lines.push(`  doom ${report.score}, fired: ${report.fired.join(' ') || 'none'}`);
  const q = report.quiet;
  lines.push(
    `  quiet: ${q.quiet ? `ON (${q.why}: ${q.reason})` : 'off'}; auto check ${
      q.auto.checked ? `${q.auto.matched} of ${q.auto.headlines} headlines match, via ${q.auto.via}` : `unavailable (${String(q.auto.error).slice(0, 80)})`
    }`,
  );
  // A switch file nobody can read means quiet, and the run says so out loud.
  if (q.manual && q.manual.problem) lines.push(`  quiet.json PROBLEM: ${q.manual.problem}`);
  return lines.join('\n');
}

export function formatVerbose(report) {
  const lines = ['', 'KEPT (last 24 h, by category)'];
  const byCat = new Map();
  for (const s of report.kept) {
    if (!byCat.has(s.cat)) byCat.set(s.cat, []);
    byCat.get(s.cat).push(s);
  }
  for (const [cat, list] of byCat) {
    lines.push(`  ${cat} (${list.length})`);
    for (const s of list) lines.push(`    ${String(s.score).padStart(5)}  ${s.outlets}x  ${s.title}  [${s.source}]${s.quiet ? '  (quiet card)' : ''}`);
  }
  lines.push('', 'DROPPED');
  const groups = new Map();
  for (const d of report.droppedList) {
    const key = d.reason.replace(/^stored:/, 'stored:');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }
  for (const [reason, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`  ${reason} (${list.length})`);
    for (const d of list.slice(0, 40)) lines.push(`    ${d.detail ? `[${d.detail}] ` : ''}${d.title}  [${d.source}]`);
    if (list.length > 40) lines.push(`    ... and ${list.length - 40} more`);
  }
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const dumpAt = args.indexOf('--dump');
  const dumpFile = dumpAt >= 0 ? args[dumpAt + 1] : null;
  const { report } = await runUpdate({});
  console.log(formatSummary(report));
  // Shows as a yellow note on the Actions run page.
  if (report.quiet.manual && report.quiet.manual.problem) console.log(`::warning::${report.quiet.manual.problem}`);
  if (args.includes('--verbose')) console.log(formatVerbose(report));
  if (dumpFile) fs.writeFileSync(dumpFile, JSON.stringify({ kept: report.kept, dropped: report.droppedList }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`update failed: ${err.stack || err.message}`);
    process.exitCode = 1;
  });
}
