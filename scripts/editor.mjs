// npm run edit
//
// Writes today's edition with the Claude API: a one-sentence headline and 5 to 10 items,
// one per near miss, each with a label, an emoji and a line, and up to EDITION.moreMax more
// stories worth a look (ids only, for "More from today"), from the headlines the update
// step just filed. It runs after `npm run update` and before `npm run build`, and it never
// fails the run: every problem becomes one log line, and the edition already on file stays.
// A missing or bad list of more stories is an empty list and never costs the edition.
//
// It reads the newest news first and does not tell the same event twice. It sends the big stories first (see
// "Big news" below), then the stories of the last EDITOR_FRESH_HOURS hours, newest first (at most EDITOR_FRESH_MAX),
// then the rest in the page's order, up to EDITOR_MAX_STORIES. Every story it sends has hoursAgo (whole hours since
// its newest headline came out), startedHoursAgo (since its first one did) and, when people searched for it on
// Google lately, trending (how many). The input also has now (the time in New York, like "2:17 PM ET") and told:
// the items of the last two editions before today, as "label: line".
//
// It does nothing, and says why in one line, when
//   - ANTHROPIC_API_KEY is empty;
//   - quiet mode is on (the switch or the automatic check);
//   - today's edition is hand-written (by: "hand"): it is never replaced;
//   - it already called the API EDITOR_DAILY_CAP times today;
//   - it already spent EDITOR_DAILY_BUDGET_USD today;
//   - it is not time for a call yet (see "When it calls");
//   - or the stories it would read are the same as at its last call (a breaking call does not mind).
//
// When it calls. Every gap is counted from the last call, whatever came of it: a call that failed or whose answer
// broke a rule still counts, so the next run does not pay for another one. The first call of an Eastern day is
// always allowed. After that, a regular call needs the larger of two gaps since the last call:
//   - the clock gap: EDITOR_MIN_GAP_MINUTES from 6:00 AM to midnight ET, EDITOR_NIGHT_GAP_MINUTES from midnight
//     to 5:59 AM ET (EDITOR_NIGHT_END_HOUR);
//   - the paced gap, which spreads the money until midnight. The regular money left is the daily budget minus
//     EDITOR_BREAKING_RESERVE_USD minus what is spent. A call is reckoned at the larger of EDITOR_COST_GUESS
//     and today's average cost. The paced gap is the minutes to midnight divided by the calls that money buys.
//     With less than one call's worth left there is no regular call: the rest is saved for breaking news.
//
// Big news. A story is big when it is in what the editor reads and its trending is at least
// EDITOR_BREAKING_TRENDING, or it is a signal scoring at least EDITOR_BREAKING_SIGNAL_SCORE, or it is in at least
// EDITOR_BREAKING_OUTLETS outlets and first reached our feeds in the last EDITOR_BREAKING_NEW_HOURS hours. A big
// story is breaking when today's edition does not have it and the editor has not been sent it while big today.
// A breaking story makes the call a breaking call: it needs only EDITOR_BREAKING_GAP_MINUTES since the last call,
// pacing does not apply, it may spend the reserve (the daily budget and the daily cap still stop it), and it is
// made even when the stories are the same ids as at the last call, because a story that grew big changes no id.
// At most EDITOR_BREAKING_MAX a day. It says "breaking news: <title>" before the call. Every call, breaking or
// regular, sends every big story first, and afterwards remembers them in bigSent.
//
// It writes only today's file in data/editions/. Past days are never rewritten.
// Its own state is data/state/editor.json: { date, calls, usd, lastWriteAt, lastIdsHash, lastCallAt,
// breakingCalls, bigSent }. usd is today's spend in dollars: every answered call adds what its usage costs at
// EDITOR_PRICES. lastCallAt is when the last call was made, breakingCalls counts the breaking calls, and bigSent
// holds the ids of the big stories already sent (at most EDITOR_BIG_SENT_MAX). All of it starts again with the Eastern day.
//
// Env: ANTHROPIC_API_KEY (read by the SDK), DTWET_ROOT and DTWET_NOW for dry runs.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  config as loadConfig,
  EDITOR_BIG_SENT_MAX,
  EDITOR_BREAKING_GAP_MINUTES,
  EDITOR_BREAKING_MAX,
  EDITOR_BREAKING_NEW_HOURS,
  EDITOR_BREAKING_OUTLETS,
  EDITOR_BREAKING_RESERVE_USD,
  EDITOR_BREAKING_SIGNAL_SCORE,
  EDITOR_BREAKING_TRENDING,
  EDITOR_COST_GUESS,
  EDITOR_DAILY_BUDGET_USD,
  EDITOR_FRESH_HOURS,
  EDITOR_FRESH_MAX,
  EDITOR_MAX_STORIES,
  EDITOR_MIN_GAP_MINUTES,
  EDITOR_NIGHT_END_HOUR,
  EDITOR_NIGHT_GAP_MINUTES,
  EDITOR_PRICES,
} from './config.mjs';
import { createGatekeeper } from './lib/pipeline.mjs';
import { editionFile, idsHash, listingOrder, publishableStories, readEditions, usedIdsBefore, validateEdition } from './lib/editions.mjs';
import { EDITOR_SYSTEM_PROMPT } from './lib/editor-prompt.mjs';
import { readJsonLenient, writeJsonIfChanged } from './lib/json.mjs';
import { quietCard } from './lib/quietcards.mjs';
import { readQuietFile } from './lib/quietmode.mjs';
import { REPO_ROOT } from './lib/paths.mjs';
import { clean } from './lib/text.mjs';
import { etClock } from './templates/copy.mjs';
import { HOUR_MS, etDate, etParts } from './lib/time.mjs';

// What the model must send back. Counts are checked in code (the schema cannot say
// "5 to 10"), and every object lists all of its keys.
export const EDITION_SCHEMA = {
  type: 'object',
  properties: {
    date: { type: 'string' },
    headline: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          emoji: { type: 'string' },
          label: { type: 'string' },
          line: { type: 'string' },
          ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['emoji', 'label', 'line', 'ids'],
        additionalProperties: false,
      },
    },
    more: { type: 'array', items: { type: 'string' } },
  },
  required: ['date', 'headline', 'items', 'more'],
  additionalProperties: false,
};

// The SDK is loaded only when a call is really going to be made.
async function makeClient() {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return new Anthropic({ timeout: 120_000, maxRetries: 2 }); // reads ANTHROPIC_API_KEY
}

// One request. A safety decline is retried on another model by the API itself.
export function askEditor(client, { model, date, now, score, told = [], stories }) {
  return client.beta.messages.create({
    model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: EDITION_SCHEMA } },
    system: EDITOR_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify({ date, now, score, told, stories }) }],
  });
}

function dataFiles(dataDir) {
  const root = path.dirname(dataDir);
  return {
    root,
    latest: path.join(dataDir, 'latest.json'),
    day: (date) => path.join(dataDir, 'days', `${date}.json`),
    editions: path.join(dataDir, 'editions'),
    state: path.join(dataDir, 'state', 'editor.json'),
    quiet: path.join(root, 'quiet.json'),
  };
}

// A message that is safe to print: no key, and not longer than one line.
function oneLine(text, secret) {
  let t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (secret) t = t.split(secret).join('[key]');
  return t.length > 200 ? `${t.slice(0, 199)}...` : t;
}

function tokensOf(response) {
  const u = response && response.usage;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return `${n(u && u.input_tokens)} in, ${n(u && u.output_tokens)} out`;
}

// What one answered call cost, in dollars: the tokens of each kind the API reports, times that kind's
// price per million. A kind the answer does not report counts as zero.
export function costOf(usage, prices = EDITOR_PRICES) {
  const u = usage && typeof usage === 'object' ? usage : {};
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  return (
    (n(u.input_tokens) * prices.input +
      n(u.output_tokens) * prices.output +
      n(u.cache_creation_input_tokens) * prices.cacheWrite +
      n(u.cache_read_input_tokens) * prices.cacheRead) /
    1e6
  );
}

// A time as milliseconds, or null when it is not one.
const toMs = (v) => {
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

// The moment a story came out, in milliseconds: the latest of its latestAt, its publishedAt and its firstSeenAt,
// or null with none of them. A latestAt or publishedAt in the future is a feed mistake and is skipped, and a
// firstSeenAt in the future counts as now. The latest one, because a story's publishedAt is its oldest member's
// and a story that first reached our feeds an hour ago is new news even when its lead says last night (the
// Apple outage of 11/17 did that). latestAt is its newest member's time.
export function newestAt(story, nowMs) {
  const seen = toMs(story && story.firstSeenAt);
  const times = [toMs(story && story.latestAt), toMs(story && story.publishedAt)].filter((t) => t !== null && t <= nowMs);
  if (seen !== null) times.push(Math.min(seen, nowMs));
  return times.length ? Math.max(...times) : null;
}

// Whole hours from the moment a story came out (newestAt) to now, rounded down and never below zero; null when
// it has no moment.
export function hoursAgo(story, nowMs) {
  const at = newestAt(story, nowMs);
  return at === null ? null : Math.floor((nowMs - at) / HOUR_MS);
}

// Whole hours from the moment a story began to now, rounded down: from its publishedAt, which is its first
// headline, or from its firstSeenAt when publishedAt is missing, not a time or in the future (a firstSeenAt in
// the future counts as now). Never below hoursAgo, and null when the story has no moment. hoursAgo says how new
// its newest headline is, this says how old the event is: the FAA ground stop of 11/16 kept getting follow-ups on
// 11/17, so its hoursAgo was 0 while the event was about a day old. It reads times the way newestAt does.
export function startedHoursAgo(story, nowMs) {
  const newest = hoursAgo(story, nowMs);
  if (newest === null) return null;
  const first = newestAt({ publishedAt: story.publishedAt }, nowMs) ?? newestAt({ firstSeenAt: story.firstSeenAt }, nowMs);
  return first === null ? newest : Math.max(newest, Math.floor((nowMs - first) / HOUR_MS));
}

// The stories the editor reads, from the ones the page lists in its order. First the new ones: every story with
// hoursAgo of freshHours or less, newest first (the page's order breaks a tie), at most freshMax. Then all the
// others in the page's order. At most maxStories in all, and each story once. So a busy day of old, well covered
// news cannot push out something that broke an hour ago and has one outlet so far.
export function pickStories(listed, nowMs, { maxStories = EDITOR_MAX_STORIES, freshHours = EDITOR_FRESH_HOURS, freshMax = EDITOR_FRESH_MAX } = {}) {
  const fresh = listed
    .map((story, index) => ({ story, index, at: newestAt(story, nowMs), hours: hoursAgo(story, nowMs) }))
    .filter((x) => x.hours !== null && x.hours <= freshHours)
    .sort((a, b) => b.at - a.at || a.index - b.index)
    .slice(0, freshMax)
    .map((x) => x.story);
  const first = new Set(fresh);
  return [...fresh, ...listed.filter((story) => !first.has(story))].slice(0, maxStories);
}

// Whether a story is big, which means the editor should hear of it now. A story is big when it has one of three
// signs. A number of Google searches, trending, at least breakingTrending (a string is no number). A signal whose
// score, its severity on the same scale as a news rank, is at least breakingSignalScore: a nationwide ground stop,
// a quake of 7 or more, a G3 storm, an X5 flare, an asteroid inside 0.1 lunar distances, a critical outage on a
// status page. Or at least breakingOutlets outlets, while it is new to us: first seen less than breakingNewHours
// ago (a firstSeenAt in the future counts as now), because a story that has been everywhere since the morning is
// not news at supper.
export function isBig(story, nowMs, rules = {}) {
  const {
    breakingTrending = EDITOR_BREAKING_TRENDING,
    breakingSignalScore = EDITOR_BREAKING_SIGNAL_SCORE,
    breakingOutlets = EDITOR_BREAKING_OUTLETS,
    breakingNewHours = EDITOR_BREAKING_NEW_HOURS,
  } = rules;
  if (!story || typeof story !== 'object') return false;
  if (Number.isFinite(story.trending) && story.trending >= breakingTrending) return true;
  if (story.kind === 'signal' && Number.isFinite(story.score) && story.score >= breakingSignalScore) return true;
  const seen = toMs(story.firstSeenAt);
  return Number(story.outlets) >= breakingOutlets && seen !== null && nowMs - Math.min(seen, nowMs) < breakingNewHours * HOUR_MS;
}

// What a regular call needs, as of nowMs, from today's spend, today's calls and the time of the last call (NaN
// when there was none). It returns { left, callsLeft, saved, dueMs, gapMinutes }:
//   left       the regular money left, in dollars: the budget, less the reserve for breaking news, less the spend;
//   callsLeft  how many calls that buys, each reckoned at the larger of costGuess and today's average cost;
//   saved      true when callsLeft is under 1: there is no regular call, the rest is for breaking news;
//   dueMs      the earliest moment the next regular call may be made, or null with no last call (the first call of
//              the day) or when saved. It is the later of two moments: the last call plus the clock gap (minGapMinutes,
//              or nightGapMinutes from midnight until nightEndHour ET), and the moment when the last call is as far
//              back as the minutes still to run until midnight, divided by callsLeft. That second moment is the paced
//              gap worked out exactly: the gap shrinks as midnight comes nearer, and a regular call is made as soon
//              as the time since the last call has caught up with it. A clock-change day is an hour off, ignored;
//   gapMinutes the gap between the last call and dueMs, to the minute, or null with dueMs.
export function regularPlan(nowMs, { usd, calls, lastCallMs }, settings = {}) {
  const {
    minGapMinutes = EDITOR_MIN_GAP_MINUTES,
    nightGapMinutes = EDITOR_NIGHT_GAP_MINUTES,
    nightEndHour = EDITOR_NIGHT_END_HOUR,
    dailyBudgetUsd = EDITOR_DAILY_BUDGET_USD,
    breakingReserveUsd = EDITOR_BREAKING_RESERVE_USD,
    costGuess = EDITOR_COST_GUESS,
  } = settings;
  const left = Math.round((dailyBudgetUsd - breakingReserveUsd - usd) * 1e4) / 1e4;
  const cost = Math.max(costGuess > 0 ? costGuess : EDITOR_COST_GUESS, calls > 0 ? usd / calls : 0);
  // 1e-9: money a hair under a whole call, from floating point, is a whole call.
  const callsLeft = Math.floor(left / cost + 1e-9);
  if (callsLeft < 1) return { left, callsLeft: Math.max(0, callsLeft), saved: true, dueMs: null, gapMinutes: null };
  if (!Number.isFinite(lastCallMs)) return { left, callsLeft, saved: false, dueMs: null, gapMinutes: null };

  const p = etParts(nowMs);
  const secondsPast = p.hour * 3600 + p.minute * 60 + p.second;
  const midnightMs = nowMs + (86400 - secondsPast) * 1000;
  const pacedMs = (callsLeft * lastCallMs + midnightMs) / (callsLeft + 1);
  let clockMs = lastCallMs + minGapMinutes * 60000;
  if (p.hour < nightEndHour) {
    // At night the gap is the long one, unless it would run past the end of the night, and then the day gap takes over at that hour.
    const dayMs = nowMs + (nightEndHour * 3600 - secondsPast) * 1000;
    const nightMs = lastCallMs + nightGapMinutes * 60000;
    clockMs = nightMs < dayMs ? nightMs : Math.max(dayMs, clockMs);
  }
  const dueMs = Math.max(clockMs, pacedMs);
  return { left, callsLeft, saved: false, dueMs, gapMinutes: Math.round((dueMs - lastCallMs) / 60000) };
}

// What the last two editions before today told, newest edition first, as "label: line" (just the line
// when an item has no label). At most 12, so the input stays small. A hand-written edition counts like
// any other. The editor reads this so it does not tell an event again from new story ids.
export const TOLD_MAX = 12;
export function toldBefore(editions, today) {
  const dates = [...editions.keys()]
    .filter((d) => d < today && Array.isArray(editions.get(d).items))
    .sort()
    .reverse()
    .slice(0, 2);
  const told = [];
  for (const date of dates) {
    for (const item of editions.get(date).items) {
      const line = clean(item && item.line);
      if (!line) continue;
      const label = clean(item.label);
      told.push(label ? `${label}: ${line}` : line);
    }
  }
  return told.slice(0, TOLD_MAX);
}

// runEditor({ client, now, dataDir, env, log, config })
//   client   a Claude client (tests pass a fake); built from the SDK when missing
//   now      the clock, as a Date, a number or an ISO string
//   dataDir  the data folder
//   env      the environment, for ANTHROPIC_API_KEY
// Returns { status: 'skipped' | 'written' | 'kept' | 'failed', line, written }.
export async function runEditor({ client, now = Date.now(), dataDir, env = process.env, log = console.log, config: cfg = loadConfig() } = {}) {
  const key = String((env && env.ANTHROPIC_API_KEY) ?? '').trim();
  const say = (message) => {
    const line = `editor: ${oneLine(message, key)}`;
    log(line);
    return line;
  };
  const done = (status, message, extra = {}) => ({ status, line: say(message), written: 0, ...extra });

  try {
    const nowMs = new Date(now).getTime();
    const nowIso = new Date(nowMs).toISOString();
    const today = etDate(nowMs);
    const f = dataFiles(dataDir);
    const {
      model,
      dailyCap,
      minGapMinutes = EDITOR_MIN_GAP_MINUTES,
      nightGapMinutes = EDITOR_NIGHT_GAP_MINUTES,
      nightEndHour = EDITOR_NIGHT_END_HOUR,
      maxStories = EDITOR_MAX_STORIES,
      freshHours,
      freshMax,
      dailyBudgetUsd = EDITOR_DAILY_BUDGET_USD,
      breakingReserveUsd = EDITOR_BREAKING_RESERVE_USD,
      costGuess = EDITOR_COST_GUESS,
      prices = EDITOR_PRICES,
      breakingTrending = EDITOR_BREAKING_TRENDING,
      breakingSignalScore = EDITOR_BREAKING_SIGNAL_SCORE,
      breakingOutlets = EDITOR_BREAKING_OUTLETS,
      breakingNewHours = EDITOR_BREAKING_NEW_HOURS,
      breakingGapMinutes = EDITOR_BREAKING_GAP_MINUTES,
      breakingMax = EDITOR_BREAKING_MAX,
      bigSentMax = EDITOR_BIG_SENT_MAX,
    } = cfg.editor;

    if (!key) return done('skipped', 'no ANTHROPIC_API_KEY, so no edition written');

    const latest = readJsonLenient(f.latest, null);
    const manual = readQuietFile(f.quiet);
    if (manual.quiet || (latest && latest.quiet && latest.quiet.quiet)) return done('skipped', 'quiet mode is on, so no edition written');

    // An edition written by hand is never replaced: no call, nothing counted.
    const onFile = readJsonLenient(editionFile({ editions: f.editions }, today), null);
    if (onFile && onFile.by === 'hand') return done('skipped', "today's edition is hand-written, leaving it");

    const saved = readJsonLenient(f.state, null);
    const spent = saved ? Number(saved.usd) : 0;
    const asTime = (v) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);
    const state =
      saved && saved.date === today
        ? {
            date: today,
            calls: Number(saved.calls) || 0,
            usd: Number.isFinite(spent) && spent > 0 ? spent : 0,
            lastWriteAt: saved.lastWriteAt || null,
            lastIdsHash: saved.lastIdsHash || null,
            // A state file from before lastCallAt has none: its last write is the best answer.
            lastCallAt: asTime(saved.lastCallAt) || asTime(saved.lastWriteAt),
            breakingCalls: Math.max(0, Math.floor(Number(saved.breakingCalls) || 0)),
            bigSent: Array.isArray(saved.bigSent) ? saved.bigSent.filter((id) => typeof id === 'string').slice(-bigSentMax) : [],
          }
        : { date: today, calls: 0, usd: 0, lastWriteAt: null, lastIdsHash: null, lastCallAt: null, breakingCalls: 0, bigSent: [] };

    if (state.calls >= dailyCap) return done('skipped', `already called the API ${state.calls} times today (the cap is ${dailyCap})`);
    if (state.usd >= dailyBudgetUsd) return done('skipped', `already spent $${state.usd.toFixed(2)} today (the cap is $${dailyBudgetUsd.toFixed(2)})`);

    // ---- what the editor reads ----------------------------------------------------
    const day = readJsonLenient(f.day(today), null);
    if (!day || !Array.isArray(day.stories)) return done('skipped', `no stories filed for ${today} yet`);
    const gk = createGatekeeper(cfg);
    const editions = readEditions({ editions: f.editions });
    const used = usedIdsBefore({ days: [], editions, excluder: gk.excluder, date: today });
    const listed = listingOrder(publishableStories(gk.excluder, day.stories), cfg.variety);
    const readable = listed.filter((s) => s.id && clean(s.title) && !used.has(s.id));
    // The big stories go first, in the page's order, so the first is the biggest. The new ones and the rest follow.
    const big = readable.filter((s) => isBig(s, nowMs, { breakingTrending, breakingSignalScore, breakingOutlets, breakingNewHours }));
    const bigSet = new Set(big);
    const chosen = [
      ...big,
      ...pickStories(
        readable.filter((s) => !bigSet.has(s)),
        nowMs,
        { maxStories: Math.max(0, maxStories - big.length), freshHours, freshMax },
      ),
    ].slice(0, maxStories);
    if (!chosen.length) return done('skipped', 'no new stories to write about');
    const stories = chosen.map((s) => ({
      id: s.id,
      cat: s.cat,
      title: clean(s.title),
      source: s.source,
      outlets: Number(s.outlets) || 1,
      serious: Boolean(s.quiet) || Boolean(quietCard(s)),
      hoursAgo: hoursAgo(s, nowMs),
      startedHoursAgo: startedHoursAgo(s, nowMs),
      // Only a story people searched for on Google has the key.
      ...(Number.isFinite(s.trending) && s.trending > 0 ? { trending: s.trending } : {}),
    }));
    const told = toldBefore(editions, today);
    const hash = idsHash(stories.map((s) => s.id));

    // ---- is it time ---------------------------------------------------------------------
    // A big story is breaking when today's edition does not have it and it was not sent to the editor while big.
    const inEdition = new Set();
    for (const item of Array.isArray(onFile && onFile.items) ? onFile.items : []) {
      for (const id of Array.isArray(item && item.ids) ? item.ids : []) if (typeof id === 'string') inEdition.add(id);
    }
    const sentBefore = new Set(state.bigSent);
    const breaking = big.filter((s) => !inEdition.has(s.id) && !sentBefore.has(s.id));
    const lastCallMs = state.lastCallAt ? Date.parse(state.lastCallAt) : NaN;
    // A time the way the pages write it ("4:05 PM ET"), rounded up to the minute so that no run before it is allowed.
    const at = (ms) => etClock(Math.ceil(ms / 60000) * 60000);

    let breakingCall = false;
    let breakingDueMs = null; // when a breaking call is held back only by its short gap: the moment it may go
    if (breaking.length && state.breakingCalls < breakingMax) {
      const dueMs = Number.isFinite(lastCallMs) ? lastCallMs + breakingGapMinutes * 60000 : -Infinity;
      if (nowMs >= dueMs) breakingCall = true;
      else breakingDueMs = dueMs;
    }

    if (!breakingCall) {
      const plan = regularPlan(nowMs, { usd: state.usd, calls: state.calls, lastCallMs }, { minGapMinutes, nightGapMinutes, nightEndHour, dailyBudgetUsd, breakingReserveUsd, costGuess });
      const notYet = plan.dueMs !== null && nowMs < plan.dueMs;
      if (plan.saved || notYet) {
        // The line says when the next call can be. Big news waiting on its short gap is the sooner call, so it is the one named.
        if (breakingDueMs !== null) return done('skipped', `next breaking call after ${at(breakingDueMs)} (${breakingGapMinutes}-minute gap): ${clean(breaking[0].title)}`);
        const exhausted = breaking.length && state.breakingCalls >= breakingMax ? `, and today's ${breakingMax} breaking call${breakingMax === 1 ? ' is' : 's are'} used` : '';
        if (plan.saved) return done('skipped', `no regular call, the rest of today's money is saved for breaking news ($${state.usd.toFixed(2)} spent of $${dailyBudgetUsd.toFixed(2)})${exhausted}`);
        return done(
          'skipped',
          `next regular call after ${at(plan.dueMs)} (${plan.gapMinutes}-minute gap; $${plan.left.toFixed(2)} left for ${plan.callsLeft} call${plan.callsLeft === 1 ? '' : 's'})${exhausted}`,
        );
      }
      if (hash === state.lastIdsHash) return done('skipped', 'the stories are the same as at the last call');
    }

    // ---- the call ---------------------------------------------------------------------
    if (breakingCall) say(`breaking news: ${clean(breaking[0].title)}`);
    // The call is counted before it is made, so a run that dies halfway still counts.
    state.calls += 1;
    state.lastCallAt = nowIso;
    if (breakingCall) state.breakingCalls += 1;
    state.lastIdsHash = hash;
    writeJsonIfChanged(f.state, state);

    let response;
    try {
      const api = client || (await makeClient());
      response = await askEditor(api, { model, date: today, now: etClock(nowMs), score: day.score, told, stories });
    } catch (err) {
      return done('failed', `the call failed (${oneLine(err && err.message ? err.message : err, key)}), kept the current edition`);
    }

    // An answered call is paid for, whatever the answer says, so its cost is added at once. It has also read the big
    // stories it was sent, so they are not breaking again today. A call that threw has read nothing: it is tried again.
    const cost = costOf(response && response.usage, prices);
    state.usd = Math.round((state.usd + cost) * 1e4) / 1e4;
    state.bigSent = [...new Set([...state.bigSent, ...chosen.filter((s) => bigSet.has(s)).map((s) => s.id)])].slice(-bigSentMax);
    writeJsonIfChanged(f.state, state);

    if (!response || response.stop_reason !== 'end_turn') {
      const why = response && response.stop_reason ? String(response.stop_reason) : 'no answer';
      const category = response && response.stop_reason === 'refusal' && response.stop_details && response.stop_details.category;
      return done('kept', `the model stopped with ${why}${category ? ` (${category})` : ''}, kept the current edition (${tokensOf(response)})`);
    }

    const text = (Array.isArray(response.content) ? response.content : [])
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return done('kept', `the answer was not valid JSON, kept the current edition (${tokensOf(response)})`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.items)) {
      return done('kept', `the answer had no items, kept the current edition (${tokensOf(response)})`);
    }

    // ---- turn the answer into an edition ----------------------------------------------
    const byId = new Map(chosen.map((s) => [s.id, s]));
    let items = [];
    for (const entry of parsed.items) {
      if (!entry || typeof entry !== 'object') continue;
      const ids = [...new Set(Array.isArray(entry.ids) ? entry.ids.filter((id) => typeof id === 'string' && byId.has(id)) : [])];
      if (!ids.length) continue;
      items.push({ emoji: entry.emoji, label: entry.label, line: entry.line, ids });
    }
    // The order of the items is the rank: the editor lists them most world-ending first.
    items = items.map((it) => {
      const lead = byId.get(it.ids[0]);
      return {
        emoji: it.emoji,
        label: it.label,
        line: it.line,
        ids: it.ids,
        quiet: Boolean(lead.quiet) || Boolean(quietCard(lead)),
        cat: lead.cat,
        title: lead.title,
        url: lead.url,
        source: lead.source,
        outlets: lead.outlets,
      };
    });

    const raw = { date: today, by: 'editor', writtenAt: nowIso, headline: parsed.headline, items, more: parsed.more };
    const checked = validateEdition(raw, { date: today, used, byId, excluder: gk.excluder });
    if (!checked.ok) return done('kept', `the edition failed its checks (${checked.reason}), kept the current edition (${tokensOf(response)})`);

    writeJsonIfChanged(editionFile({ editions: f.editions }, today), checked.edition);
    state.lastWriteAt = nowIso;
    writeJsonIfChanged(f.state, state);
    const n = checked.edition.items.length;
    // How many "more" stories made it, and how many the editor named that the checks left out.
    const m = Array.isArray(checked.edition.more) ? checked.edition.more.length : 0;
    const named = Array.isArray(parsed.more) ? parsed.more.length : 0;
    const moreNote = m || named ? ` and ${m} more${named > m ? ` (${named - m} left out)` : ''}` : '';
    // What was dropped, or kept without its label, goes in the same line so a bad day can be traced.
    const notes = checked.dropped.map((d) => `item ${d.index + 1} ${d.kept ? 'kept without a label' : 'dropped'} (${d.reason})`);
    return done('written', `wrote ${n} item${n === 1 ? '' : 's'}${moreNote} for ${today} (${tokensOf(response)}, $${cost.toFixed(3)})${notes.length ? `; ${notes.join(', ')}` : ''}`, { written: n });
  } catch (err) {
    return done('failed', `stopped (${oneLine(err && err.message ? err.message : err, key)}), kept the current edition`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.env.DTWET_ROOT || REPO_ROOT;
  const now = process.env.DTWET_NOW ? new Date(process.env.DTWET_NOW) : new Date();
  try {
    await runEditor({ now, dataDir: path.join(root, 'data'), env: process.env });
  } catch (err) {
    console.log(`editor: stopped (${oneLine(err && err.message ? err.message : err)})`);
  }
  process.exitCode = 0;
}
