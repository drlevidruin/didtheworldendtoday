// RSS parsing shared by Google News, Bing News and the top-stories check.
import { XMLParser } from 'fast-xml-parser';
import { clean } from './text.mjs';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: true,
  htmlEntities: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => name === 'item',
});

function textOf(node) {
  if (node === undefined || node === null) return '';
  if (typeof node === 'object') return clean(node['#text'] ?? '');
  return clean(node);
}

// Returns [{ title, link, pubDate, source, sourceUrl, bingSource, description }].
// Throws when the body is not an RSS feed (consent pages, block pages, HTML).
export function parseRss(xml) {
  let doc;
  try {
    doc = parser.parse(String(xml ?? ''));
  } catch (err) {
    throw new Error(`feed is not XML: ${err.message}`);
  }
  const channel = doc?.rss?.channel;
  if (!channel) throw new Error('feed has no channel (not an RSS response)');
  const items = Array.isArray(channel.item) ? channel.item : [];
  return items.map((it) => ({
    title: textOf(it.title),
    link: textOf(it.link),
    pubDate: textOf(it.pubDate),
    source: textOf(it.source),
    sourceUrl: it.source && typeof it.source === 'object' ? clean(it.source['@_url'] ?? '') : '',
    bingSource: textOf(it['News:Source']),
    description: textOf(it.description),
  }));
}
