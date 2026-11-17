// The pieces a page is made of: story cards, filter chips, the Doom Bingo
// grid, the vital signs and the Almanac rows. Third-party text goes through
// esc(), third-party links through url(), and numbers through num().
import { ago, etClock, hashOf, plural, rowDate, shortDate } from './copy.mjs';
import { esc, num, url } from './esc.mjs';
import { capFirst, joinNames } from '../lib/text.mjs';
import { quietCard } from '../lib/quietcards.mjs';

const REL = 'noopener';
const HELP_US = 'Donate to the Red Cross';
const HELP_INTL = 'Support the Red Cross and Red Crescent';

function link(href, text, extra = '') {
  const safe = url(href);
  return safe ? `<a href="${safe}" target="_blank" rel="${REL}"${extra}>${esc(text)}</a>` : esc(text);
}

// ---- story cards ------------------------------------------------------------
// ctx: { cats: Map id -> category, nowMs, live, quietMode, quietCaption, quietLink, quietLinkIntl, used }

// A story always starts from the same joke (its id picks it), but two cards
// in a row from one category never repeat it: the second takes the next one.
function captionFor(cat, key, ctx) {
  const list = Array.isArray(cat.captions) ? cat.captions : [];
  if (!list.length) return '';
  let at = hashOf(key) % list.length;
  const used = ctx.used instanceof Map ? ctx.used : null;
  if (used && list.length > 1 && used.get(cat.id) === at) at = (at + 1) % list.length;
  if (used) used.set(cat.id, at);
  return list[at];
}

export function card(story, ctx, { lead = false } = {}) {
  const cat = ctx.cats.get(story.cat) || { id: story.cat, emoji: '', label: String(story.cat ?? '') };
  const at = Date.parse(story.publishedAt);
  const stamp = Number.isFinite(at)
    ? `<time datetime="${new Date(at).toISOString()}"${ctx.live ? ' class="rel"' : ''}>${esc(ctx.live ? ago(ctx.nowMs - at) : etClock(at))}</time>`
    : '';
  const more = num(story.outlets, 1) > 1 ? ` + ${num(story.outlets, 1) - 1} more` : '';
  const meta = [`${esc(story.source)}${more}`, stamp].filter(Boolean).join(' &middot; ');
  let caption = '';
  if (story.quiet) {
    // The charity link only shows when people are likely hurt; a quake that is big and nothing more gets the caption alone.
    const q = quietCard(story);
    const help = q && q.link === 'ifrc' ? link(ctx.quietLinkIntl, HELP_INTL) : q && q.link === 'redcross' ? link(ctx.quietLink, HELP_US) : '';
    caption = `<p class="cap">${esc(ctx.quietCaption)}${help ? ` ${help}` : ''}</p>`;
  } else if (!ctx.quietMode) {
    const text = captionFor(cat, story.id, ctx);
    if (text) caption = `<p class="cap">${esc(text)}</p>`;
  }
  const headline = link(story.url, story.title);
  return `<li class="card${lead ? ' lead' : ''}" data-cat="${esc(cat.id)}">
<p class="cat"><span aria-hidden="true">${esc(cat.emoji)}</span> ${esc(cat.label)}</p>
<h3>${headline}</h3>
<p class="meta">${meta}</p>
${caption}</li>`;
}

// ---- the receipts -------------------------------------------------------------

export function chips(stories, categories) {
  const counts = new Map();
  for (const s of stories) counts.set(s.cat, (counts.get(s.cat) || 0) + 1);
  const buttons = [`<button class="chip" type="button" data-cat="all" aria-pressed="true">All<small>${stories.length}</small></button>`];
  for (const c of categories) {
    const n = counts.get(c.id) || 0;
    if (!n) continue;
    buttons.push(
      `<button class="chip" type="button" data-cat="${esc(c.id)}" aria-pressed="false"><span class="e" aria-hidden="true">${esc(c.emoji)}</span>${esc(c.label)}<small>${n}</small></button>`,
    );
  }
  return `<div class="chips" role="group" aria-label="Filter by category" hidden>\n${buttons.join('\n')}\n</div>`;
}

export const FIRST_SHOWN = 30;

export function receipts(stories, ctx, categories) {
  if (!stories.length) return `<p class="empty">${ctx.live ? 'Nothing filed yet today.' : 'Nothing on file for this day.'}</p>`;
  const head = stories.slice(0, FIRST_SHOWN);
  const rest = stories.slice(FIRST_SHOWN);
  const list = (items) => items.map((s) => card(s, ctx)).join('\n');
  const more = rest.length
    ? `\n<details class="more">\n<summary>Show ${rest.length} more</summary>\n<ol class="cards">\n${list(rest)}\n</ol>\n</details>`
    : '';
  return `${chips(stories, categories)}\n<ol class="cards" id="list">\n${list(head)}\n</ol>${more}`;
}

// ---- Doom Bingo ---------------------------------------------------------------

export function bingo(fired, categories) {
  const on = new Set(fired);
  const cells = categories
    .map(
      (c) =>
        `<li class="cell ${on.has(c.id) ? 'on' : 'off'}"><span aria-hidden="true">${esc(c.emoji)}</span><small>${esc(c.label)}</small><span class="sr">${on.has(c.id) ? ', fired' : ', quiet'}</span></li>`,
    )
    .join('\n');
  return `<ol class="bingo">\n${cells}\n</ol>`;
}

// One plain line that shows the arithmetic, so the score never looks made up.
export function mathLine({ fired, bumps, score, doom }) {
  const n = Array.isArray(fired) ? fired.length : 0;
  const extra = (Array.isArray(bumps) ? bumps : []).reduce((sum, b) => sum + num(b && b.points), 0);
  const base = `${n} fired at ${doom.perCategory} points each`;
  const raw = n * doom.perCategory + extra;
  if (raw < doom.floor) return `${base}. The floor is ${doom.floor}, because there is always something.`;
  if (raw > doom.cap) return `${base}, plus ${extra} from instruments. The cap is ${doom.cap}.`;
  return extra ? `${base}, plus ${extra} from instruments.` : `${base}.`;
}

// ---- vital signs ----------------------------------------------------------------

function inWords(ms) {
  const min = Math.round(ms / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `in ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `in ${plural(hours, 'hour')}`;
  return `in ${plural(Math.round(hours / 24), 'day')}`;
}

function tile(label, big, small = '') {
  return `<div class="v"><dt>${esc(label)}</dt><dd><span class="big">${big}</span>${small ? `<span class="sm">${small}</span>` : ''}</dd></div>`;
}

const NO_READING = (label) => tile(label, 'No reading');

function staleTag(x) {
  return x && x.stale ? ' (last good reading)' : '';
}

export function vitals(v, { nowMs, clock }) {
  const out = [];
  const st = v && v.status;
  if (!st || st.unavailable) out.push(NO_READING('Internet'));
  else {
    const pages = Array.isArray(st.pages) ? st.pages : [];
    const bad = pages.filter((p) => p && p.indicator && !['none', 'maintenance'].includes(p.indicator));
    out.push(
      tile(
        'Internet',
        bad.length ? `${bad.length} of ${pages.length} wobbling` : 'All calm',
        bad.length ? esc(joinNames(bad.map((p) => p.name))) + esc(staleTag(st)) : `${pages.length} status pages checked${esc(staleTag(st))}`,
      ),
    );
  }

  const a = v && v.asteroid;
  if (!a || a.unavailable) out.push(a ? NO_READING('Closest asteroid') : tile('Closest asteroid', 'None close', 'Nothing near this week'));
  else {
    const when = Date.parse(a.at);
    const timing = Number.isFinite(when) ? (when > nowMs ? `passes ${inWords(when - nowMs)}` : `passed ${ago(nowMs - when)}`) : '';
    out.push(
      tile(
        'Closest asteroid',
        `${num(a.ld).toFixed(2)} lunar distances`,
        `${link(a.url, a.des)}${a.size ? `, about the size of ${esc(a.size)}` : ''}${timing ? `. ${esc(capFirst(timing))}` : ''}${esc(staleTag(a))}`,
      ),
    );
  }

  const kp = v && v.kp;
  if (!kp || kp.unavailable) out.push(NO_READING('Kp index'));
  else out.push(tile('Kp index', `Kp ${num(kp.value).toFixed(1)}`, `peak ${num(kp.max24).toFixed(1)} in 24 hours${esc(staleTag(kp))}`));

  const q = v && v.quake;
  if (!q || q.unavailable) out.push(q ? NO_READING('Biggest quake') : tile('Biggest quake', 'Quiet', 'Nothing above M4.5 in 24 hours'));
  else {
    const t = Date.parse(q.time);
    out.push(tile('Biggest quake', `M ${num(q.mag).toFixed(1)}`, `${link(q.url, q.place)}${Number.isFinite(t) ? `. ${esc(capFirst(ago(nowMs - t)))}` : ''}${esc(staleTag(q))}`));
  }

  const f = v && v.faa;
  if (!f || f.unavailable) out.push(NO_READING('FAA ground stops'));
  else {
    const stops = Array.isArray(f.groundStops) ? f.groundStops : [];
    const where = stops.map((s) => `${esc(s.airport)}${s.reason ? ` (${esc(s.reason)})` : ''}`).join(', ');
    const delays = num(f.groundDelays) ? `${plural(num(f.groundDelays), 'ground delay program')}` : '';
    const big = f.nationwide ? 'Nationwide stop' : stops.length ? plural(stops.length, 'ground stop') : 'None';
    out.push(tile('FAA ground stops', big, [where, esc(capFirst(delays))].filter(Boolean).join('. ') + esc(staleTag(f))));
  }

  out.push(
    tile(
      'Doomsday Clock',
      `${num(clock.secondsToMidnight)} seconds`,
      `to midnight, set ${esc(shortDate(clock.setOn))}, ${esc(String(clock.setOn).slice(0, 4))}. ${link(clock.url, 'Bulletin of the Atomic Scientists')}`,
    ),
  );
  return `<dl class="vit">\n${out.join('\n')}\n</dl>`;
}

// ---- the Almanac -------------------------------------------------------------------

export function almanacRows(entries, { root, categories, withFired = true }) {
  const emoji = new Map(categories.map((c) => [c.id, c.emoji]));
  const rows = entries.map((e) => {
    const top = e.top && e.top.title ? link(e.top.url, e.top.title) : '';
    const fired = withFired
      ? `<span class="f" aria-hidden="true">${(Array.isArray(e.fired) ? e.fired : []).map((id) => esc(emoji.get(id) || '')).join('')}</span>`
      : '';
    return `<li>
<a class="d" href="${esc(root)}day/${esc(e.date)}/">${esc(rowDate(e.date))}</a>
<span class="s">${num(e.score)}</span>
<span class="t">${top}${fired}</span>
</li>`;
  });
  return `<ol class="alm">\n${rows.join('\n')}\n</ol>`;
}
