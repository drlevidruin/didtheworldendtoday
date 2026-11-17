// The pieces a page is made of: the rows of a day, the plain list of every
// headline, and the Almanac rows. Third-party text goes through esc(),
// third-party links through url(), and numbers through num().
import { BEST_TAG, TOP_TAG, readText, rowDate, sourceText } from './copy.mjs';
import { esc, num, url } from './esc.mjs';
import { quietCard } from '../lib/quietcards.mjs';
import { quietLinkFor } from '../lib/editions.mjs';

const REL = 'noopener';
const HELP_US = 'Donate to the Red Cross';
const HELP_INTL = 'Support the Red Cross and Red Crescent';

export function link(href, text, extra = '') {
  const safe = url(href);
  return safe ? `<a href="${safe}" target="_blank" rel="${REL}"${extra}>${esc(text)}</a>` : esc(text);
}

// "No jokes on this one." and, when people are likely hurt, where to help. which is
// 'redcross', 'ifrc' or null; a quake that is only big gets the caption alone.
function quietNote(which, ctx) {
  const help = which === 'ifrc' ? link(ctx.quietLinkIntl, HELP_INTL) : which === 'redcross' ? link(ctx.quietLink, HELP_US) : '';
  return `<p class="cap">${esc(ctx.quietCaption)}${help ? ` ${help}` : ''}</p>`;
}

// ---- the rows of a day -----------------------------------------------------------
// ctx: { byId: Map of the day's stories, quietMode, quietCaption, quietLink, quietLinkIntl }
// item: { emoji, line, ids, quiet, url, source, outlets }

export function row(item, index, ctx) {
  const quiet = Boolean(item.quiet);
  const tag = index === 0 ? `<p class="tag">${esc(quiet || ctx.quietMode ? TOP_TAG : BEST_TAG)}</p>\n` : '';
  const note = quiet ? `${quietNote(quietLinkFor(item, ctx.byId), ctx)}\n` : '';
  const read = `<p class="read">${link(item.url, readText(item.outlets, item.source))}</p>`;
  return `<li class="row${index === 0 ? ' best' : ''}${quiet ? ' quiet' : ''}">
<span class="em" aria-hidden="true">${esc(item.emoji)}</span>
<div class="rb">
${tag}<p class="txt">${esc(item.line)}</p>
${note}${read}
</div>
</li>`;
}

export function rows(items, ctx) {
  return `<ol class="rows">\n${items.map((item, i) => row(item, i, ctx)).join('\n')}\n</ol>`;
}

// ---- every headline of a day ---------------------------------------------------------
// Plain rows: the headline is the link, the source and the outlet count sit under it.
// A story that is a quiet card keeps its caption and its donate link.

export function headline(story, ctx) {
  const q = quietCard(story);
  const quiet = Boolean(story.quiet) || Boolean(q);
  const note = quiet ? `\n${quietNote(q ? q.link : null, ctx)}` : '';
  const src = sourceText(num(story.outlets, 1), story.source);
  return `<li class="hd${quiet ? ' quiet' : ''}">
<p class="ht">${link(story.url, story.title)}</p>${src ? `\n<p class="hs">${esc(src)}</p>` : ''}${note}
</li>`;
}

export function headlines(stories, ctx) {
  return `<ol class="heads">\n${stories.map((s) => headline(s, ctx)).join('\n')}\n</ol>`;
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
  return `<ol class="alm">\n${items.join('\n')}\n</ol>`;
}
