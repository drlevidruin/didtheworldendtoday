// npm run edit
//
// Writes today's edition with the Claude API: a one-sentence headline and 4 to 6 items,
// one per near miss, each with a label, an emoji and a line, from the headlines the update
// step just filed. It runs after `npm run update` and before `npm run build`, and it never
// fails the run: every problem becomes one log line, and the edition already on file stays.
//
// It reads the newest news first and does not tell the same event twice. Every story it sends
// has hoursAgo (whole hours since it came out), and the input has told: the items of the last two
// editions before today, as "label: line".
//
// It does nothing, and says why in one line, when
//   - ANTHROPIC_API_KEY is empty;
//   - quiet mode is on (the switch or the automatic check);
//   - today's edition is hand-written (by: "hand"): it is never replaced;
//   - its last write for today was under EDITOR_MIN_GAP_MINUTES ago;
//   - it already called the API EDITOR_DAILY_CAP times today;
//   - it already spent EDITOR_DAILY_BUDGET_USD today;
//   - or the stories it would read are the same as at its last call.
//
// It writes only today's file in data/editions/. Past days are never rewritten.
// Its own state is data/state/editor.json: { date, calls, usd, lastWriteAt, lastIdsHash }. usd is
// today's spend in dollars: every answered call adds what its usage costs at EDITOR_PRICES.
//
// Env: ANTHROPIC_API_KEY (read by the SDK), DTWET_ROOT and DTWET_NOW for dry runs.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config as loadConfig, EDITOR_DAILY_BUDGET_USD, EDITOR_PRICES } from './config.mjs';
import { createGatekeeper } from './lib/pipeline.mjs';
import { editionFile, idsHash, listingOrder, publishableStories, readEditions, usedIdsBefore, validateEdition } from './lib/editions.mjs';
import { EDITOR_SYSTEM_PROMPT } from './lib/editor-prompt.mjs';
import { readJsonLenient, writeJsonIfChanged } from './lib/json.mjs';
import { quietCard } from './lib/quietcards.mjs';
import { readQuietFile } from './lib/quietmode.mjs';
import { REPO_ROOT } from './lib/paths.mjs';
import { clean } from './lib/text.mjs';
import { HOUR_MS, etDate } from './lib/time.mjs';

// What the model must send back. Counts are checked in code (the schema cannot say
// "4 to 6"), and every object lists all of its keys.
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
  },
  required: ['date', 'headline', 'items'],
  additionalProperties: false,
};

// The SDK is loaded only when a call is really going to be made.
async function makeClient() {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return new Anthropic({ timeout: 120_000, maxRetries: 2 }); // reads ANTHROPIC_API_KEY
}

// One request. A safety decline is retried on another model by the API itself.
export function askEditor(client, { model, date, score, told = [], stories }) {
  return client.beta.messages.create({
    model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: EDITION_SCHEMA } },
    system: EDITOR_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify({ date, score, told, stories }) }],
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

// Whole hours from the moment a story came out to now, rounded down and never below zero. The moment is
// publishedAt when it parses and is not in the future, else firstSeenAt, else there is none and the answer is null.
export function hoursAgo(story, nowMs) {
  const ms = (v) => {
    const t = typeof v === 'number' ? v : Date.parse(v);
    return Number.isFinite(t) ? t : null;
  };
  const published = ms(story && story.publishedAt);
  const seen = ms(story && story.firstSeenAt);
  const at = published !== null && published <= nowMs ? published : seen;
  return at === null ? null : Math.max(0, Math.floor((nowMs - at) / HOUR_MS));
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
  const done = (status, message, extra = {}) => {
    const line = `editor: ${oneLine(message, key)}`;
    log(line);
    return { status, line, written: 0, ...extra };
  };

  try {
    const nowMs = new Date(now).getTime();
    const nowIso = new Date(nowMs).toISOString();
    const today = etDate(nowMs);
    const f = dataFiles(dataDir);
    const { model, dailyCap, minGapMinutes, maxStories, dailyBudgetUsd = EDITOR_DAILY_BUDGET_USD, prices = EDITOR_PRICES } = cfg.editor;

    if (!key) return done('skipped', 'no ANTHROPIC_API_KEY, so no edition written');

    const latest = readJsonLenient(f.latest, null);
    const manual = readQuietFile(f.quiet);
    if (manual.quiet || (latest && latest.quiet && latest.quiet.quiet)) return done('skipped', 'quiet mode is on, so no edition written');

    // An edition written by hand is never replaced: no call, nothing counted.
    const onFile = readJsonLenient(editionFile({ editions: f.editions }, today), null);
    if (onFile && onFile.by === 'hand') return done('skipped', "today's edition is hand-written, leaving it");

    const saved = readJsonLenient(f.state, null);
    const spent = saved ? Number(saved.usd) : 0;
    const state =
      saved && saved.date === today
        ? {
            date: today,
            calls: Number(saved.calls) || 0,
            usd: Number.isFinite(spent) && spent > 0 ? spent : 0,
            lastWriteAt: saved.lastWriteAt || null,
            lastIdsHash: saved.lastIdsHash || null,
          }
        : { date: today, calls: 0, usd: 0, lastWriteAt: null, lastIdsHash: null };

    const lastWrite = Date.parse(state.lastWriteAt);
    if (Number.isFinite(lastWrite) && nowMs - lastWrite < minGapMinutes * 60000) {
      const ago = Math.max(0, Math.round((nowMs - lastWrite) / 60000));
      return done('skipped', `last edition was written ${ago} minutes ago, waiting ${minGapMinutes} between writes`);
    }
    if (state.calls >= dailyCap) return done('skipped', `already called the API ${state.calls} times today (the cap is ${dailyCap})`);
    if (state.usd >= dailyBudgetUsd) return done('skipped', `already spent $${state.usd.toFixed(2)} today (the cap is $${dailyBudgetUsd.toFixed(2)})`);

    // ---- what the editor reads ----------------------------------------------------
    const day = readJsonLenient(f.day(today), null);
    if (!day || !Array.isArray(day.stories)) return done('skipped', `no stories filed for ${today} yet`);
    const gk = createGatekeeper(cfg);
    const editions = readEditions({ editions: f.editions });
    const used = usedIdsBefore({ days: [], editions, excluder: gk.excluder, date: today });
    const listed = listingOrder(publishableStories(gk.excluder, day.stories), cfg.variety);
    const chosen = listed.filter((s) => s.id && clean(s.title) && !used.has(s.id)).slice(0, maxStories);
    if (!chosen.length) return done('skipped', 'no new stories to write about');
    const stories = chosen.map((s) => ({
      id: s.id,
      cat: s.cat,
      title: clean(s.title),
      source: s.source,
      outlets: Number(s.outlets) || 1,
      serious: Boolean(s.quiet) || Boolean(quietCard(s)),
      hoursAgo: hoursAgo(s, nowMs),
    }));
    const told = toldBefore(editions, today);
    const hash = idsHash(stories.map((s) => s.id));
    if (hash === state.lastIdsHash) return done('skipped', 'the stories are the same as at the last call');

    // ---- the call ---------------------------------------------------------------------
    // The call is counted before it is made, so a run that dies halfway still counts.
    state.calls += 1;
    state.lastIdsHash = hash;
    writeJsonIfChanged(f.state, state);

    let response;
    try {
      const api = client || (await makeClient());
      response = await askEditor(api, { model, date: today, score: day.score, told, stories });
    } catch (err) {
      return done('failed', `the call failed (${oneLine(err && err.message ? err.message : err, key)}), kept the current edition`);
    }

    // An answered call is paid for, whatever the answer says, so its cost is added at once.
    const cost = costOf(response && response.usage, prices);
    state.usd = Math.round((state.usd + cost) * 1e4) / 1e4;
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

    const raw = { date: today, by: 'editor', writtenAt: nowIso, headline: parsed.headline, items };
    const checked = validateEdition(raw, { date: today, used, byId, excluder: gk.excluder });
    if (!checked.ok) return done('kept', `the edition failed its checks (${checked.reason}), kept the current edition (${tokensOf(response)})`);

    writeJsonIfChanged(editionFile({ editions: f.editions }, today), checked.edition);
    state.lastWriteAt = nowIso;
    writeJsonIfChanged(f.state, state);
    const n = checked.edition.items.length;
    // What was dropped, or kept without its label, goes in the same line so a bad day can be traced.
    const notes = checked.dropped.map((d) => `item ${d.index + 1} ${d.kept ? 'kept without a label' : 'dropped'} (${d.reason})`);
    return done('written', `wrote ${n} item${n === 1 ? '' : 's'} for ${today} (${tokensOf(response)}, $${cost.toFixed(3)})${notes.length ? `; ${notes.join(', ')}` : ''}`, { written: n });
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
