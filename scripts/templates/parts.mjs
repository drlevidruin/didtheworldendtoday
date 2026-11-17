// The pieces a page is made of: the rows of a day, the plain list of every
// headline, and the Almanac rows. Third-party text goes through esc(),
// third-party links through url(), and numbers through num().
//
// One story, one link. A row is a card whose link is stretched over the whole row by
// the stylesheet, so the whole row opens the story. The donate link of a quiet row sits
// next to the card, never inside it, so a link never holds another link.
import { BEST_TAG, HELP_INTL, HELP_US, HEADLINES_SHOWN, READ_IT, TOP_TAG, headlineMeta, moreHeadlines, rowDate, sourceParts } from './copy.mjs';
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
  return `<a class="help" href="${href}" target="_blank" rel="${REL}">${esc(`${text} \u2192`)}</a>`;
}

// In the list of every headline the caption is a line of its own under the link.
function quietNote(which, ctx) {
  const caption = `<p class="cap">${esc(ctx.quietCaption)}</p>`;
  const help = quietHelp(which, ctx);
  return help ? `${caption}\n${help}` : caption;
}

// ---- the rows of a day -----------------------------------------------------------
// ctx: { byId: Map of the day's stories, quietMode, quietCaption, quietLink, quietLinkIntl }
// item: { emoji, line, ids, quiet, url, source, outlets }
// The rank is the place in the list: the list is already in order, closest call first.

export function row(item, index, ctx) {
  const quiet = Boolean(item.quiet);
  const rank = index + 1;
  const href = url(item.url);
  const { name, count } = sourceParts(num(item.outlets, 1), item.source);
  const tag = index === 0 ? `<p class="tag">${esc(quiet || ctx.quietMode ? TOP_TAG : BEST_TAG)}</p>\n` : '';
  // The source is two lines: the name, then how many news sites told it (nothing when only one did).
  const src = `<span class="src">${name ? `<span class="sn">${esc(name)}</span>` : ''}${count ? `<span class="sc">${esc(count)}</span>` : ''}</span>`;
  const bar = name || count || href ? `<span class="bar">${src}${href ? `<span class="cta">${esc(READ_IT)}</span>` : ''}</span>` : '';
  // The caption is part of the card, between the line and the bar. The donate link is not: it is
  // its own link after the card, so a link never holds another link.
  const cap = quiet ? `<span class="cap">${esc(ctx.quietCaption)}</span>` : '';
  const inner = `<span class="sr">${rank}. </span><span class="txt">${esc(item.line)}</span>${cap}${bar}`;
  // A story whose link is not safe still reads; it just has nothing to open.
  const card = href ? `<a class="card" href="${href}" target="_blank" rel="${REL}">${inner}</a>` : `<div class="card">${inner}</div>`;
  const help = quiet ? quietHelp(quietLinkFor(item, ctx.byId), ctx) : '';
  return `<li class="row${index === 0 ? ' best' : ''}${quiet ? ' quiet' : ''}">
<div class="rk" aria-hidden="true"><span class="rn">${rank}</span><span class="em">${esc(item.emoji)}</span></div>
<div class="rb">
${tag}${card}${help ? `\n${help}` : ''}
</div>
</li>`;
}

export function rows(items, ctx) {
  return `<ol class="rows" role="list">\n${items.map((item, i) => row(item, i, ctx)).join('\n')}\n</ol>`;
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
