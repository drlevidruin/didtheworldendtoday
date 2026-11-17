// RSS: one item per day. The title is the day's headline and the description
// lists its rows as "Label: line". Every label, line and source is escaped as text, every link is
// checked, and the HTML inside each item is escaped once more because RSS
// carries it as text. Dates are written in Eastern time with their real offset.
import { SITE_NAME, TAGLINE, rfc822ET, rowDate } from './copy.mjs';
import { esc, num, url } from './esc.mjs';

export const FEED_DAYS = 30;

// day: { date, score, headline, rows[] }. The first line reads like the page: the weekday and
// date, then the Doom Score out of the cap. A row reads "Label: line"; a row with no label is its line alone.
export const feedRowText = (r) => (r.label ? `${r.label}: ${r.line}` : String(r.line ?? ''));

function itemHtml(day, cap) {
  const lines = (day.rows || []).map((r) => {
    const href = url(r.url);
    const read = href ? ` <a href="${href}">Read it</a>` : '';
    return `<li>${esc(r.emoji)} ${esc(feedRowText(r))}${read}</li>`;
  });
  return `<p>${esc(rowDate(day.date))} \u00b7 Doom Score ${num(day.score)} of ${cap}</p>${lines.length ? `<ol>${lines.join('')}</ol>` : ''}`;
}

export function feedXml({ siteUrl, days, buildTime, doomCap }) {
  const cap = num(doomCap, 99);
  const items = days.slice(0, FEED_DAYS).map((day) => {
    const link = `${siteUrl}/day/${day.date}/`;
    const stamp = rfc822ET(Date.parse(day.updatedAt) || Date.parse(buildTime) || 0);
    return `<item>
<title>${esc(day.headline)}</title>
<link>${esc(link)}</link>
<guid isPermaLink="true">${esc(link)}</guid>
<pubDate>${stamp}</pubDate>
<description>${esc(itemHtml(day, cap))}</description>
</item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${esc(SITE_NAME)}</title>
<link>${esc(siteUrl)}/</link>
<description>${esc(TAGLINE)}</description>
<language>en-us</language>
<lastBuildDate>${rfc822ET(Date.parse(buildTime) || 0)}</lastBuildDate>
<atom:link href="${esc(siteUrl)}/feed.xml" rel="self" type="application/rss+xml"/>
${items.join('\n')}
</channel>
</rss>
`;
}
