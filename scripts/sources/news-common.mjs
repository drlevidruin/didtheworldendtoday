// Pieces shared by the news-search sources.
import { clean, decodeEntities, safeUrl } from '../lib/text.mjs';

export function toMs(s) {
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

// Every query the news sources run: one entry per (category, query).
export function queryList(categories) {
  const out = [];
  for (const c of categories) {
    for (const q of c.queries || []) out.push({ cat: c.id, query: q });
  }
  return out;
}

export function newsItem({ via, cat, title, url, source, publishedAt }) {
  const t = clean(title);
  const u = safeUrl(url);
  if (!t || !u) return null;
  return { via, kind: 'news', cat, title: t, url: u, source: clean(source) || 'unknown', publishedAt: publishedAt ?? null };
}

export { decodeEntities };

// Stops a source from grinding through dozens of doomed calls: after this many
// failures in a row (a dead network, a block page) the source gives up.
export class Breaker {
  constructor(limit = 4) {
    this.limit = limit;
    this.streak = 0;
  }
  ok() {
    this.streak = 0;
  }
  fail() {
    this.streak += 1;
  }
  get open() {
    return this.streak >= this.limit;
  }
}

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

// How far the starting query moves each run: about a third of the list, and
// never a number that shares a factor with the list length, so the starting
// point visits every query over time.
export function rotationStep(total) {
  const want = Math.max(1, Math.round(total / 3));
  for (let d = 0; d < total; d += 1) {
    for (const cand of [want + d, want - d]) {
      if (cand >= 1 && cand < total && gcd(cand, total) === 1) return cand;
    }
  }
  return 1;
}

const SLOT_MS = 15 * 60 * 1000;

// Which query a run starts with. It depends only on the clock (one step per
// 15 minute slot), so it needs no saved state.
export function startIndex(nowMs, total) {
  if (total <= 1) return 0;
  return (Math.floor(nowMs / SLOT_MS) * rotationStep(total)) % total;
}

// The shared loop of the two RSS search sources. Queries run one at a time,
// spaced out, beginning at a starting point that moves every run. The first
// refusal (429 or 403) ends the run for this source, so a source that only
// allows a dozen calls at a time still covers every query over a few runs
// instead of always the same ones. A dead network gives up after a few
// failures in a row.
export async function runQueries(ctx, { id, host, spacingMs, searchUrl, parse }) {
  const queries = queryList(ctx.config.categories);
  const start = startIndex(ctx.now.getTime(), queries.length);
  const items = [];
  const breaker = new Breaker();
  let okCalls = 0;
  let failed = 0;
  let firstError = '';
  for (let i = 0; i < queries.length; i += 1) {
    const { cat, query } = queries[(start + i) % queries.length];
    try {
      const text = await ctx.http.getText(searchUrl(query), {
        key: host,
        gapMs: spacingMs,
        accept: 'application/rss+xml, application/xml, text/xml',
      });
      items.push(...parse(text, cat));
      okCalls += 1;
      breaker.ok();
    } catch (err) {
      failed += 1;
      breaker.fail();
      firstError ||= err.message;
      if (err.status === 429 || err.status === 403) {
        firstError = `${err.message} (blocked after ${okCalls} of ${queries.length} queries)`;
        break;
      }
      if (breaker.open) {
        firstError = `${firstError} (gave up after ${breaker.limit} failures in a row)`;
        break;
      }
    }
  }
  return {
    id,
    ok: okCalls > 0,
    count: items.length,
    error: failed ? `${failed} of ${queries.length} queries failed: ${firstError}` : null,
    items,
  };
}
