// Hacker News (Algolia): tech outages and breaches that people are actually
// talking about (stories from the last 24 hours with real points).
import { clean, decodeEntities, hostOf } from '../lib/text.mjs';
import { Breaker, newsItem } from './news-common.mjs';

export const id = 'hn';
export const SPACING_MS = 300;

export function searchUrl(query, sinceSec, minPoints) {
  const u = new URL('https://hn.algolia.com/api/v1/search_by_date');
  u.searchParams.set('query', query);
  u.searchParams.set('tags', 'story');
  u.searchParams.set('numericFilters', `created_at_i>${sinceSec},points>${minPoints}`);
  return u.toString();
}

export function parseHn(json, cat) {
  const items = [];
  for (const hit of Array.isArray(json?.hits) ? json.hits : []) {
    const title = clean(decodeEntities(hit.title));
    const url = hit.url || (hit.objectID ? `https://news.ycombinator.com/item?id=${hit.objectID}` : '');
    const item = newsItem({
      via: id,
      cat,
      title,
      url,
      source: hostOf(url) || 'news.ycombinator.com',
      publishedAt: Number.isFinite(hit.created_at_i) ? hit.created_at_i * 1000 : null,
    });
    if (item) items.push(item);
  }
  return items;
}

export async function run(ctx) {
  const since = Math.floor(ctx.now.getTime() / 1000) - 86400;
  const { queries, minPoints } = ctx.config.hn;
  const items = [];
  let okCalls = 0;
  let failed = 0;
  let firstError = '';
  const breaker = new Breaker(3);
  for (const { q, cat } of queries) {
    try {
      const json = await ctx.http.getJson(searchUrl(q, since, minPoints), { key: 'hn.algolia.com', gapMs: SPACING_MS });
      items.push(...parseHn(json, cat));
      okCalls += 1;
      breaker.ok();
    } catch (err) {
      failed += 1;
      breaker.fail();
      firstError ||= err.message;
      if (breaker.open) break;
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
