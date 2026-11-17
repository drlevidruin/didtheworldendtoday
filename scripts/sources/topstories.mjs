// The quiet-mode check reads the day's top stories (Google News top stories)
// and counts mass-casualty headlines. If Google refuses, the first of the
// configured fallback feeds that answers is used instead, and latest.json says
// which one was used. This source only returns titles; the decision is in
// lib/quietmode.mjs.
import { parseRss } from '../lib/rss.mjs';
import { clean, stripPublisher } from '../lib/text.mjs';

export const id = 'topstories';

export function parseTopTitles(xml, topN) {
  const out = [];
  for (const it of parseRss(xml)) {
    const t = stripPublisher(it.title, it.source);
    if (t) out.push(clean(t));
    if (out.length >= topN) break;
  }
  return out;
}

export async function run(ctx) {
  const q = ctx.config.quiet;
  const feeds = [{ via: 'google-top-stories', url: q.topStoriesUrl }, ...(q.fallbackFeeds || [])];
  const errors = [];
  for (const feed of feeds) {
    try {
      const xml = await ctx.http.getText(feed.url, {
        key: new URL(feed.url).hostname,
        gapMs: 1000,
        accept: 'application/rss+xml, application/xml, text/xml',
      });
      const titles = parseTopTitles(xml, q.topN);
      if (!titles.length) throw new Error('feed had no headlines');
      return { id, ok: true, count: titles.length, error: null, via: feed.via, titles };
    } catch (err) {
      errors.push(`${feed.via}: ${err.message}`);
    }
  }
  return { id, ok: false, count: 0, error: errors.join('; '), via: null, titles: [] };
}
