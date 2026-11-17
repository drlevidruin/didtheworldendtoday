// Google Trends: what people in the US are searching for right now.
//
// One read per run of the daily trending feed (no key). A trend is a search ("apple outage") with how
// many searches it drew ("50000+"), when it started trending, and up to three news stories about it.
// Each news story becomes one headline: its own title, link and publisher, no category (the keyword gate
// decides, as for X), dated when the trend started, and carrying the trend's number as `trending` and the
// search as `trendTerm`. The search itself is never a headline. Everything after this (the exclusion filter,
// the gate, the quality check, the clustering) treats these like any headline, so sports, celebrity and
// lottery trends drop out there. One difference: a headline that fits no category is filed by its search
// when that fits one ("apple outage" is internet), see lib/pipeline.mjs.
//
// Like every source it fails soft: a bad answer, a timeout or a block is one line and no items.
import { XMLParser } from 'fast-xml-parser';
import { clean } from '../lib/text.mjs';
import { newsItem, toMs } from './news-common.mjs';

export const id = 'trends';
export const FEED_URL = 'https://trends.google.com/trending/rss?geo=US';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: true,
  htmlEntities: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => name === 'item' || name === 'ht:news_item',
});

function textOf(node) {
  if (node === undefined || node === null) return '';
  if (typeof node === 'object') return clean(node['#text'] ?? '');
  return clean(node);
}

// How many searches a trend drew: "50000+" is 50000, "1,000+" is 1000, "200K+" is 200000, "1M+" is
// 1000000. Anything else is null.
export function searchCount(text) {
  const m = /^([\d,]*\.?\d+)\s*([KkMm])?\s*\+?$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, '')) * ({ k: 1e3, m: 1e6 }[(m[2] || '').toLowerCase()] ?? 1);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// { items, error }. A feed that is not the trends feed (a block page, a consent page) is no items and
// an error, never a throw.
export function parseTrends(xml) {
  let doc;
  try {
    doc = parser.parse(String(xml ?? ''));
  } catch (err) {
    return { items: [], error: `feed is not XML: ${err.message}` };
  }
  const channel = doc?.rss?.channel;
  if (!channel) return { items: [], error: 'feed has no channel (not an RSS response)' };
  const items = [];
  for (const trend of Array.isArray(channel.item) ? channel.item : []) {
    const trending = searchCount(textOf(trend['ht:approx_traffic']));
    const publishedAt = toMs(textOf(trend.pubDate));
    const search = textOf(trend.title);
    for (const story of Array.isArray(trend['ht:news_item']) ? trend['ht:news_item'] : []) {
      const item = newsItem({
        via: id,
        cat: null,
        title: textOf(story['ht:news_item_title']),
        url: textOf(story['ht:news_item_url']),
        source: textOf(story['ht:news_item_source']),
        publishedAt,
      });
      if (item) items.push({ ...item, ...(trending === null ? {} : { trending }), ...(search ? { trendTerm: search } : {}) });
    }
  }
  return { items, error: null };
}

export async function run(ctx) {
  try {
    const xml = await ctx.http.getText(FEED_URL, {
      key: 'trends.google.com',
      accept: 'application/rss+xml, application/xml, text/xml',
    });
    const { items, error } = parseTrends(xml);
    return { id, ok: !error, count: items.length, error, items };
  } catch (err) {
    return { id, ok: false, count: 0, error: String(err?.message ?? err), items: [] };
  }
}
