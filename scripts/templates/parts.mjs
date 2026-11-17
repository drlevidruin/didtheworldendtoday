// The pieces a page is made of: the rows of a day, the plain list of every
// headline, and the Almanac rows. Third-party text goes through esc(),
// third-party links through url(), and numbers through num().
//
// One story, one link. A row is a card whose link is stretched over the whole row by
// the stylesheet, so the whole row opens the story. The donate link of a quiet row sits
// next to the card, never inside it, so a link never holds another link.
//
// A row of near misses, left to right: its rank (red for the closest call), its emoji, then the
// label, the line and the source. A day that has no edition is not ranked: its rows have no rank and
// show the publisher's own headline in place of a label. In quiet mode no emoji is drawn at all.
import { HELP_INTL, HELP_US, HEADLINES_SHOWN, headlineMeta, moreHeadlines, rowDate, rowSource } from './copy.mjs';
import { esc, num, url } from './esc.mjs';
import { quietCard } from '../lib/quietcards.mjs';
import { quietLinkFor } from '../lib/editions.mjs';

const REL = 'noopener';

// "No jokes on this one." and, when people are likely hurt, where to help. which is
// 'redcross', 'ifrc' or null; a story that is only big gets the caption alone.
function quietHelp(which, ctx) {
  const href = url(which === 'ifrc' ? ctx.quietLinkIntl : which === 'redcross' ? ctx.quietLink : '');
  if (!href) return '';
  const text = which === 'ifrc' ? HELP_INTL : HELP_US;
  return `<a class="help" href="${href}" target="_blank" rel="${REL}">${esc(text)}</a>`;
}

// In the list of every headline the caption is a line of its own under the link.
function quietNote(which, ctx) {
  const caption = `<p class="cap">${esc(ctx.quietCaption)}</p>`;
  const help = quietHelp(which, ctx);
  return help ? `${caption}\n${help}` : caption;
}

// ---- the rows of a day -----------------------------------------------------------
// ctx: { byId: Map of the day's stories, quietMode, quietCaption, quietLink, quietLinkIntl, plain }
// item: { emoji, label, line, ids, quiet, title, url, source, outlets }
// plain: the day has no edition, so its rows are the day's own headlines and are not ranked.
// The rank is the place in the list: the list is already in order, closest call first.

// What a row says: the label over the line. A row without a label shows its line where the label
// would be; a row of plain headlines shows the publisher's headline there and has no line.
function words(item, plain) {
  if (plain) return { label: item.title || item.line || '', line: '' };
  if (item.label) return { label: item.label, line: item.line || '' };
  return { label: item.line || '', line: '' };
}

export function row(item, index, ctx) {
  const quiet = Boolean(item.quiet);
  const plain = Boolean(ctx.plain);
  const rank = index + 1;
  const href = url(item.url);
  const { label, line } = words(item, plain);
  const source = rowSource(item.source);
  const text = [
    plain ? '' : `<span class="sr">${rank}. </span>`,
    label ? `<span class="lb">${esc(label)}</span>` : '',
    line ? `<span class="ln">${esc(line)}</span>` : '',
    // The caption is part of the card, between the line and the source. The donate link is not: it is
    // its own link after the card, so a link never holds another link.
    quiet ? `<span class="cap">${esc(ctx.quietCaption)}</span>` : '',
    source ? `<span class="src">${esc(source)}</span>` : '',
  ]
    .filter(Boolean)
    .join(' ');
  // A story whose link is not safe still reads; it just has nothing to open.
  const card = href ? `<a class="card" href="${href}" target="_blank" rel="${REL}">${text}</a>` : `<div class="card">${text}</div>`;
  const help = quiet ? quietHelp(quietLinkFor(item, ctx.byId), ctx) : '';
  const emoji = !ctx.quietMode && item.emoji ? `<span class="em" aria-hidden="true">${esc(item.emoji)}</span>\n` : '';
  const rankCell = plain ? '' : `<span class="rn" aria-hidden="true">${rank}</span>\n`;
  const cls = ['row', !plain && index === 0 ? 'best' : '', plain ? 'plain' : '', quiet ? 'quiet' : ''].filter(Boolean).join(' ');
  return `<li class="${cls}">
${rankCell}${emoji}<div class="rb">
${card}${help ? `\n${help}` : ''}
</div>
</li>`;
}

export function rows(items, ctx) {
  return `<ol class="rows" role="list">\n${items.map((item, i) => row(item, i, ctx)).join('\n')}\n</ol>`;
}

// ---- the board of ten squares -------------------------------------------------------------
// filled of ten squares are solid; the rest are outlines. Drawn by the stylesheet, hidden from screen readers.
export function squares(filled) {
  const n = Math.max(0, Math.min(10, Math.round(num(filled))));
  return Array.from({ length: 10 }, (_, i) => `<span${i < n ? ' class="f"' : ''}></span>`).join('');
}

// ---- every headline of a day ---------------------------------------------------------
// Plain rows: the headline is the link, the source and the news site count sit under it.
// A story that is a quiet card keeps its caption and its donate link.

export function headline(story, ctx) {
  const q = quietCard(story);
  const quiet = Boolean(story.quiet) || Boolean(q);
  const href = url(story.url);
  const meta = headlineMeta(num(story.outlets, 1), story.source, Boolean(href));
  const inner = `<span class="ht">${esc(story.title)}</span>${meta ? `<span class="hs">${esc(meta)}</span>` : ''}`;
  const main = href ? `<a class="hla" href="${href}" target="_blank" rel="${REL}">${inner}</a>` : `<div class="hla">${inner}</div>`;
  const note = quiet ? `\n${quietNote(q ? q.link : null, ctx)}` : '';
  return `<li class="hd${quiet ? ' quiet' : ''}">${main}${note}</li>`;
}

// The first headlines show; the rest wait behind "Show N more headlines".
export function headlines(stories, ctx, shown = HEADLINES_SHOWN) {
  const list = (items) => `<ol class="heads" role="list">\n${items.map((s) => headline(s, ctx)).join('\n')}\n</ol>`;
  const rest = stories.slice(shown);
  if (!rest.length) return list(stories);
  return `${list(stories.slice(0, shown))}\n<details class="more">\n<summary>${esc(moreHeadlines(rest.length))}</summary>\n${list(rest)}\n</details>`;
}

// ---- the Almanac -------------------------------------------------------------------
// entries: [{ date, score, headline }], newest first. The whole row is the link.

export function almanacRows(entries, { root }) {
  const items = entries.map(
    (e) => `<li>
<a class="al" href="${esc(root)}day/${esc(e.date)}/">
<span class="ad">${esc(rowDate(e.date))} &middot; Doom ${num(e.score)}</span>
<span class="ah">${esc(e.headline)}</span>
</a>
</li>`,
  );
  return `<ol class="alm" role="list">\n${items.join('\n')}\n</ol>`;
}
