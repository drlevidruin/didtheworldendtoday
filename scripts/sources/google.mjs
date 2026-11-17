// Google News RSS: the primary news source.
// Title is "Headline - Publisher"; <source> names the publisher. The link is a
// Google redirect, which is fine to link. Calls are spaced about 1 s apart,
// and the first 429 or 403 stops the run for this source (we never push on
// a block).
import { parseRss } from '../lib/rss.mjs';
import { stripPublisher } from '../lib/text.mjs';
import { newsItem, runQueries, toMs } from './news-common.mjs';

export const id = 'google';
export const SPACING_MS = 1000;

export function searchUrl(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}+when:1d&hl=en-US&gl=US&ceid=US:en`;
}

export function parseGoogle(xml, cat) {
  const items = [];
  for (const it of parseRss(xml)) {
    const item = newsItem({
      via: id,
      cat,
      title: stripPublisher(it.title, it.source),
      url: it.link,
      source: it.source,
      publishedAt: toMs(it.pubDate),
    });
    if (item) items.push(item);
  }
  return items;
}

export async function run(ctx) {
  return runQueries(ctx, { id, host: 'news.google.com', spacingMs: SPACING_MS, searchUrl, parse: parseGoogle });
}
