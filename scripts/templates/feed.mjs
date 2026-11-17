// RSS: one item per day. The title is the day's headline and the description
// lists its lines. Every line and source is escaped as text, every link is
// checked, and the HTML inside each item is escaped once more because RSS
// carries it as text.
import { SITE_NAME, TAGLINE, shortDate } from './copy.mjs';
import { esc, num, url } from './esc.mjs';

export const FEED_DAYS = 30;

// day: { date, score, headline, rows[] }
function itemHtml(day) {
  const lines = (day.rows || []).map((r) => {
    const href = url(r.url);
    const read = href ? ` <a href="${href}">Read it</a>` : '';
    return `<li>${esc(r.emoji)} ${esc(r.line)}${read}</li>`;
  });
  return `<p>${esc(shortDate(day.date))} \u00b7 Doom ${num(day.score)}/99</p>${lines.length ? `<ol>${lines.join('')}</ol>` : ''}`;
}

export function feedXml({ siteUrl, days, buildTime }) {
  const items = days.slice(0, FEED_DAYS).map((day) => {
    const link = `${siteUrl}/day/${day.date}/`;
    const stamp = new Date(Date.parse(day.updatedAt) || Date.parse(buildTime) || 0).toUTCString();
    return `<item>
<title>${esc(day.headline)}</title>
<link>${esc(link)}</link>
<guid isPermaLink="true">${esc(link)}</guid>
<pubDate>${stamp}</pubDate>
<description>${esc(itemHtml(day))}</description>
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
