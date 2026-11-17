// Bing News RSS: the second news source. Item links go through
// bing.com/news/apiclick.aspx with the publisher URL in the url parameter;
// we decode it and link the publisher directly.
import { parseRss } from '../lib/rss.mjs';
import { newsItem, runQueries, toMs } from './news-common.mjs';

export const id = 'bing';
export const SPACING_MS = 1000;

export function searchUrl(query) {
  // interval "7" is the last 24 hours.
  return `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&qft=interval%3d%227%22`;
}

export function decodeBingLink(link) {
  try {
    const u = new URL(link);
    if (/(^|\.)bing\.com$/.test(u.hostname) && u.pathname.toLowerCase().includes('/news/apiclick')) {
      const target = u.searchParams.get('url');
      if (target) return target;
    }
  } catch {
    // fall through to the raw link
  }
  return link;
}

export function parseBing(xml, cat) {
  const items = [];
  for (const it of parseRss(xml)) {
    const item = newsItem({
      via: id,
      cat,
      title: it.title,
      url: decodeBingLink(it.link),
      source: it.bingSource || it.source,
      publishedAt: toMs(it.pubDate),
    });
    if (item) items.push(item);
  }
  return items;
}

export async function run(ctx) {
  return runQueries(ctx, { id, host: 'www.bing.com', spacingMs: SPACING_MS, searchUrl, parse: parseBing });
}
