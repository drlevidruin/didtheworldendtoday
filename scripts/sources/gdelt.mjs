// GDELT DOC 2.0: a bounded bonus. It rate-limits hard, so: at most 4 calls a
// run, 6 s apart, categories rotate run to run, and the first refusal (a
// plain-text "please limit requests" reply, a 429, anything) ends the run for
// this source. It can never fail the run.
import { clean, decodeEntities, hostOf } from '../lib/text.mjs';
import { newsItem } from './news-common.mjs';

export const id = 'gdelt';

export function articlesUrl(query) {
  const u = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  u.searchParams.set('query', `${query} sourcelang:english`);
  u.searchParams.set('mode', 'artlist');
  u.searchParams.set('format', 'json');
  u.searchParams.set('timespan', '24h');
  u.searchParams.set('maxrecords', '50');
  u.searchParams.set('sort', 'hybridrel');
  return u.toString();
}

// "20261116T221500Z" to milliseconds.
export function parseSeenDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(s || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

export function parseGdelt(json, cat) {
  const items = [];
  for (const a of Array.isArray(json?.articles) ? json.articles : []) {
    if (a.language && String(a.language).toLowerCase() !== 'english') continue;
    const item = newsItem({
      via: id,
      cat,
      title: clean(decodeEntities(a.title)),
      url: a.url,
      source: a.domain || hostOf(a.url),
      publishedAt: parseSeenDate(a.seendate),
    });
    if (item) items.push(item);
  }
  return items;
}

// A rotating slice of the categories that have a GDELT query.
export function pickCategories(categories, now, perRun) {
  const withQuery = categories.filter((c) => c.gdelt);
  if (!withQuery.length) return [];
  const slot = Math.floor(now.getTime() / (15 * 60 * 1000));
  const start = (slot * perRun) % withQuery.length;
  const out = [];
  for (let i = 0; i < Math.min(perRun, withQuery.length); i += 1) out.push(withQuery[(start + i) % withQuery.length]);
  return out;
}

export async function run(ctx) {
  const { callsPerRun, spacingMs } = ctx.config.gdelt;
  const picks = pickCategories(ctx.config.categories, ctx.now, callsPerRun);
  const items = [];
  let okCalls = 0;
  let error = null;
  for (const c of picks) {
    try {
      const json = await ctx.http.getJson(articlesUrl(c.gdelt), { key: 'api.gdeltproject.org', gapMs: spacingMs, retries: 0 });
      items.push(...parseGdelt(json, c.id));
      okCalls += 1;
    } catch (err) {
      error = err.status === 429 || /not JSON/.test(err.message) ? `rate limited (${err.message})` : err.message;
      break;
    }
  }
  return { id, ok: okCalls > 0, count: items.length, error: okCalls > 0 && !error ? null : error, items };
}
