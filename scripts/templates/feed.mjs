// RSS: one item per day with its verdict and top stories. Every headline and
// source name is escaped as text, every link is checked, and the HTML inside
// each item is escaped once more because RSS carries it as text.
import { SITE_NAME, TAGLINE, VERDICT, longDate } from './copy.mjs';
import { esc, num, url } from './esc.mjs';

export const FEED_DAYS = 30;
const TOP_STORIES = 8;

function itemHtml(day, categories) {
  const emoji = new Map(categories.map((c) => [c.id, c.emoji]));
  const fired = (Array.isArray(day.fired) ? day.fired : []).map((id) => emoji.get(id) || '').join('');
  const items = (day.stories || []).slice(0, TOP_STORIES).map((s) => {
    const href = url(s.url);
    const title = href ? `<a href="${href}">${esc(s.title)}</a>` : esc(s.title);
    return `<li>${title} (${esc(s.source)})</li>`;
  });
  return `<p>Doom ${num(day.score)}/99. ${esc(fired)}</p>${items.length ? `<ul>${items.join('')}</ul>` : ''}`;
}

export function feedXml({ siteUrl, days, categories, buildTime }) {
  const items = days.slice(0, FEED_DAYS).map((day) => {
    const link = `${siteUrl}/day/${day.date}/`;
    const stamp = new Date(Date.parse(day.updatedAt) || Date.parse(buildTime) || 0).toUTCString();
    return `<item>
<title>${esc(`Did the world end on ${longDate(day.date)}? ${VERDICT} Doom ${num(day.score)}/99`)}</title>
<link>${esc(link)}</link>
<guid isPermaLink="true">${esc(link)}</guid>
<pubDate>${stamp}</pubDate>
<description>${esc(itemHtml(day, categories))}</description>
</item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${esc(SITE_NAME)}</title>
<link>${esc(siteUrl)}/</link>
<description>${esc(TAGLINE)}</description>
<language>en-us</language>
<lastBuildDate>${new Date(Date.parse(buildTime) || 0).toUTCString()}</lastBuildDate>
<atom:link href="${esc(siteUrl)}/feed.xml" rel="self" type="application/rss+xml"/>
${items.join('\n')}
</channel>
</rss>
`;
}
