// Text helpers: cleaning, entity decoding, and the keys used for dedupe.
// Headlines are third-party text. We store them raw (no HTML escaping here;
// that happens at render time) but strip control characters and validate URLs.

export function clean(s) {
  return String(s ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/[\u200b\ufeff\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const NAMED = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '\u2013',
  mdash: '\u2014',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  copy: '©',
};

// One pass only, so "&amp;lt;" becomes "&lt;" and never "<".
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    const v = NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

// Cut to n characters (code points), adding an ellipsis when something was cut.
export function truncate(s, n) {
  const chars = Array.from(String(s ?? ''));
  if (chars.length <= n) return chars.join('');
  return chars.slice(0, n - 1).join('').trimEnd() + '…';
}

// Google News titles are "Headline - Publisher". Remove the suffix only when
// it is exactly the publisher we were told about, so a headline that merely
// contains " - " is left alone.
export function stripPublisher(title, publisher) {
  const t = clean(title);
  const p = clean(publisher);
  if (!p) return t;
  for (const sep of [' - ', ' \u2013 ', ' \u2014 ', ' | ']) {
    const tail = sep + p;
    if (t.length > tail.length && t.toLowerCase().endsWith(tail.toLowerCase())) {
      return t.slice(0, t.length - tail.length).trim();
    }
  }
  return t;
}

// ---- keys for dedupe -------------------------------------------------------

const STOP = new Set(
  (
    'the a an and or of to in on at for is are was were be been as by with from after amid over into ' +
    'its it this that these those has have had will would could should may might can than then so ' +
    'new says say said how why what when who which not no up out off just more most'
  ).split(' '),
);

function plain(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Spec: lowercase, drop punctuation, first 12 words.
export function titleKey(title, n = 12) {
  return plain(title).split(' ').filter(Boolean).slice(0, n).join(' ');
}

// Significant words, for the near-duplicate check.
export function tokens(title) {
  const out = new Set();
  for (const w of plain(title).split(' ')) {
    if (w.length >= 3 && !STOP.has(w)) out.add(w);
  }
  return out;
}

const TRACKING = /^(utm_|fbclid|gclid|mc_|ref$|ref_|cmpid|ocid|igshid|oc$|hl$|gl$|ceid$|taid)/i;

export function urlKey(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^(www|m|amp|mobile)\./, '');
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING.test(k))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`);
    return host + path + (params.length ? `?${params.join('&')}` : '');
  } catch {
    return String(url ?? '');
  }
}

const TLDS = new Set(['com', 'net', 'org', 'co', 'uk', 'io', 'gov', 'edu', 'news', 'tv', 'info', 'us', 'au', 'ca']);

// "The Register", "theregister.com" and "TechCrunch on MSN" should each count
// as one outlet, whichever feed they came through.
export function publisherKey(name) {
  let s = String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
  s = s.replace(/\s+(on|via)\s+(msn|yahoo|yahoo news|microsoft start)$/, '').replace(/^www\./, '');
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) {
    const labels = s.split('.').filter((l) => !TLDS.has(l));
    s = labels.length ? labels[labels.length - 1] : s;
  }
  s = s.replace(/[^a-z0-9]+/g, '');
  if (s.startsWith('the') && s.length > 6) s = s.slice(3);
  return s;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Only http(s) links, no embedded credentials, sane length. Returns the
// normalized href or null.
export function safeUrl(u) {
  try {
    const url = new URL(String(u ?? '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    const href = url.href;
    return href.length <= 2000 ? href : null;
  } catch {
    return null;
  }
}

// The address of an X post: https on x.com or twitter.com, like https://x.com/AP/status/123. Gives the link as
// safeUrl cleans it and the account the post is from, or null for anything else: not a string, another site, plain
// http, a port, an address with no account or no post in it (x.com/i/status/123 has no account to read).
export function xPost(u) {
  const href = typeof u === 'string' ? safeUrl(u) : null;
  if (!href) return null;
  const url = new URL(href);
  const host = hostOf(href);
  if (url.protocol !== 'https:' || url.port || (host !== 'x.com' && host !== 'twitter.com')) return null;
  const m = /^\/([A-Za-z0-9_]{1,15})\/status\/\d+(?:\/|$)/.exec(url.pathname);
  return m && m[1].toLowerCase() !== 'i' ? { href, handle: m[1] } : null;
}

// ---- sentences ---------------------------------------------------------------

// Words that end in a period without ending a sentence ("Gov. Healey", "Acme Inc. said").
export const ABBREVIATIONS = [
  'Mr',
  'Mrs',
  'Ms',
  'Dr',
  'St',
  'Jr',
  'Sr',
  'Inc',
  'Co',
  'Corp',
  'Ltd',
  'vs',
  'No',
  'Gov',
  'Sen',
  'Rep',
  'Gen',
  'Lt',
  'Mt',
  'Ft',
];
const ABBREVIATION = new Set(ABBREVIATIONS);
// Letters with periods between them: U.S, U.K, D.C (the last period is the one being asked about).
const LETTER_DOTS = /^(?:\p{L}\.)+\p{L}$/u;

// The word right before a period, without opening quotes or brackets.
function wordBefore(text, i) {
  const word = text.slice(0, i).match(/\S+$/)?.[0] ?? '';
  return word.replace(/^[^\p{L}\p{N}]+/u, '');
}

export function isAbbreviation(word) {
  return ABBREVIATION.has(word) || LETTER_DOTS.test(word);
}

// Closing quotes and brackets that can sit between a period and the space after it: ." .” .’ .)
const CLOSERS = /[\u201d\u2019"')\]}\u00bb]/;

// The text up to and including the first period that ends a sentence: a period followed by a
// space or by the end of the text, unless the word before it is an abbreviation. A closing quote or
// bracket may come between them (She said "It missed." Then left.). "2:59 AM ET." ends a sentence,
// "U.S. banks" and "Gov. Healey" do not, and "3.5" or "nasa.gov" never do.
// With no sentence end, the whole text.
export function firstSentence(text) {
  const t = String(text ?? '').trim();
  for (let i = t.indexOf('.'); i !== -1; i = t.indexOf('.', i + 1)) {
    let end = i + 1;
    while (end < t.length && CLOSERS.test(t[end])) end += 1;
    if (end < t.length && !/\s/.test(t[end])) continue;
    const word = wordBefore(t, i);
    if (!word || isAbbreviation(word)) continue;
    return t.slice(0, end);
  }
  return t;
}

// Words as a reader counts them: runs of non-space characters.
export function wordCount(text) {
  return String(text ?? '').split(/\s+/).filter(Boolean).length;
}

// First letter up, the rest untouched: 'passes in 3 hours' -> 'Passes in 3 hours'.
export function capFirst(text) {
  const t = String(text ?? '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// A list of names as a sentence: 'Cloudflare', 'Cloudflare and Claude', 'GitHub, Cloudflare, and Claude'.
export function joinNames(names) {
  const list = (Array.isArray(names) ? names : []).map((n) => String(n ?? '').trim()).filter(Boolean);
  if (list.length <= 1) return list.join('');
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}
