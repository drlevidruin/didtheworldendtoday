// X (Twitter) API v2, optional and budget-capped.
//
// Off unless X_BEARER_TOKEN is set. With a token it makes at most one search
// per 60 minutes: curated breaking-news accounts AND doom keywords, or any post
// at all from the accounts in X.everyPost (Downdetector), no retweets or
// replies, English, newest first since the last seen id. Author
// ids become handles through one cached users lookup, refreshed weekly. Every
// call is costed ($0.005 per post read, $0.01 per user read) against a daily
// cap (UTC day); a call that could push past the cap is skipped. The token is
// never logged, printed or stored.
import { clean, decodeEntities, truncate } from '../lib/text.mjs';

export const id = 'x';
export const SEARCH_URL = 'https://api.x.com/2/tweets/search/recent';
export const USERS_URL = 'https://api.x.com/2/users/by';
const MAX_QUERY_CHARS = 512;

export function emptyState() {
  return { sinceId: null, lastRunAt: null, users: {}, usersFetchedAt: null, usage: {} };
}

export function normalizeState(raw) {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    sinceId: typeof s.sinceId === 'string' && /^\d+$/.test(s.sinceId) ? s.sinceId : null,
    lastRunAt: typeof s.lastRunAt === 'string' ? s.lastRunAt : null,
    users: s.users && typeof s.users === 'object' && !Array.isArray(s.users) ? { ...s.users } : {},
    usersFetchedAt: typeof s.usersFetchedAt === 'string' ? s.usersFetchedAt : null,
    usage: s.usage && typeof s.usage === 'object' && !Array.isArray(s.usage) ? { ...s.usage } : {},
  };
}

export function budgetUsd(env, cfg) {
  const n = Number(env.X_DAILY_BUDGET_USD);
  return Number.isFinite(n) && n >= 0 && String(env.X_DAILY_BUDGET_USD).trim() !== '' ? n : cfg.dailyBudgetUsd;
}

export function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function spentToday(state, nowMs) {
  return Number(state.usage[utcDay(nowMs)]?.usd) || 0;
}

// True when a call that could cost `worstCaseUsd` still fits under the cap.
export function fitsBudget(state, nowMs, worstCaseUsd, budget) {
  return spentToday(state, nowMs) + worstCaseUsd <= budget + 1e-9;
}

export function recordUsage(state, nowMs, { posts = 0, users = 0 }, cfg) {
  const day = utcDay(nowMs);
  const cur = state.usage[day] || { calls: 0, posts: 0, users: 0, usd: 0 };
  const usd = posts * cfg.costPerPostRead + users * cfg.costPerUserRead;
  state.usage[day] = {
    calls: cur.calls + 1,
    posts: cur.posts + posts,
    users: cur.users + users,
    usd: Math.round((cur.usd + usd) * 10000) / 10000,
  };
}

export function pruneUsage(state, nowMs, keepDays) {
  const cutoff = utcDay(nowMs - keepDays * 86400000);
  for (const day of Object.keys(state.usage)) if (day < cutoff) delete state.usage[day];
}

// (Accounts AND keywords) OR every post from the everyPost accounts, trimmed so the whole query fits the
// API limit by dropping keywords from the end. X reads a space (AND) before OR, so the whole OR sits in
// one more pair of parentheses: without it the retweet, reply and English filters would reach only the
// last part.
export function buildQuery(cfg) {
  const from = `(${cfg.accounts.map((a) => `from:${a}`).join(' OR ')})`;
  const every = (cfg.everyPost || []).map((a) => `(from:${a})`);
  const tail = '-is:retweet -is:reply lang:en';
  const words = [...cfg.keywords];
  for (;;) {
    const watched = `(${from} (${words.join(' OR ')}))`;
    const q = `(${[watched, ...every].join(' OR ')}) ${tail}`;
    if (q.length <= MAX_QUERY_CHARS || words.length <= 1) return q;
    words.pop();
  }
}

function newerId(a, b) {
  if (!a) return b;
  if (!b) return a;
  return BigInt(b) > BigInt(a) ? b : a;
}

// Post text as a headline: links removed, entities decoded, cut to 200 chars.
export function postHeadline(text, chars) {
  const t = clean(decodeEntities(String(text ?? '')).replace(/https?:\/\/\S+/g, ' '));
  return truncate(t, chars);
}

export function postsToItems(posts, handles, cfg) {
  const items = [];
  for (const p of Array.isArray(posts) ? posts : []) {
    const handle = handles[p.author_id];
    const title = postHeadline(p.text, cfg.headlineChars);
    if (!handle || !title || !/^\d+$/.test(String(p.id))) continue;
    const created = Date.parse(p.created_at);
    items.push({
      via: id,
      kind: 'x',
      cat: null,
      title,
      url: `https://x.com/${handle}/status/${p.id}`,
      source: `@${handle} on X`,
      publishedAt: Number.isFinite(created) ? created : null,
    });
  }
  return items;
}

function redact(message, token) {
  return token ? String(message).split(token).join('[token]') : String(message);
}

export async function run(ctx) {
  const cfg = ctx.config.x;
  const token = String(ctx.env?.X_BEARER_TOKEN ?? '').trim();
  const state = normalizeState(ctx.xState);
  if (!token) return { id, ok: true, count: 0, error: null, enabled: false, skipped: 'off', items: [], state };

  const nowMs = ctx.now.getTime();
  const budget = budgetUsd(ctx.env ?? {}, cfg);
  const minGap = cfg.minIntervalMinutes * 60000;
  if (state.lastRunAt && nowMs - Date.parse(state.lastRunAt) < minGap) {
    return { id, ok: true, count: 0, error: null, enabled: true, skipped: 'interval', items: [], state };
  }

  const headers = { authorization: `Bearer ${token}` };
  const done = (extra) => {
    pruneUsage(state, nowMs, cfg.usageKeepDays);
    return { id, enabled: true, state, items: [], count: 0, ...extra };
  };

  // Handles: one cached lookup, refreshed weekly. (An account that does not
  // exist never triggers a refresh, so a typo cannot drain the budget.)
  const age = state.usersFetchedAt ? nowMs - Date.parse(state.usersFetchedAt) : Infinity;
  const needUsers = !Object.keys(state.users).length || age > cfg.userRefreshDays * 86400000;
  // since_id older than the 7-day search window is dropped.
  if (state.lastRunAt && nowMs - Date.parse(state.lastRunAt) > 6 * 86400000) state.sinceId = null;
  state.lastRunAt = new Date(nowMs).toISOString();

  try {
    if (needUsers) {
      const worst = cfg.accounts.length * cfg.costPerUserRead;
      if (!fitsBudget(state, nowMs, worst, budget)) {
        return done({ ok: true, skipped: 'budget', error: null });
      }
      const url = `${USERS_URL}?usernames=${encodeURIComponent(cfg.accounts.join(','))}`;
      const json = await ctx.http.getJson(url, { headers, key: 'api.x.com' });
      const users = {};
      for (const u of Array.isArray(json?.data) ? json.data : []) {
        if (u?.id && u?.username) users[String(u.id)] = String(u.username);
      }
      recordUsage(state, nowMs, { users: Array.isArray(json?.data) ? json.data.length : 0 }, cfg);
      state.users = users;
      state.usersFetchedAt = new Date(nowMs).toISOString();
    }

    const worst = cfg.maxResults * cfg.costPerPostRead;
    if (!fitsBudget(state, nowMs, worst, budget)) {
      return done({ ok: true, skipped: 'budget', error: null });
    }
    const u = new URL(SEARCH_URL);
    u.searchParams.set('query', buildQuery(cfg));
    u.searchParams.set('max_results', String(cfg.maxResults));
    u.searchParams.set('tweet.fields', 'created_at,author_id');
    if (state.sinceId) u.searchParams.set('since_id', state.sinceId);
    const json = await ctx.http.getJson(u.toString(), { headers, key: 'api.x.com' });
    const posts = Array.isArray(json?.data) ? json.data : [];
    recordUsage(state, nowMs, { posts: posts.length }, cfg);
    let newest = state.sinceId;
    for (const p of posts) if (/^\d+$/.test(String(p.id))) newest = newerId(newest, String(p.id));
    newest = newerId(newest, /^\d+$/.test(String(json?.meta?.newest_id)) ? String(json.meta.newest_id) : null);
    state.sinceId = newest;
    const items = postsToItems(posts, state.users, cfg);
    return done({ ok: true, skipped: null, error: null, items, count: items.length });
  } catch (err) {
    return done({ ok: false, skipped: null, error: redact(err.message, token) });
  }
}
