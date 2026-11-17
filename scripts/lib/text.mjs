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

// First letter up, the rest untouched: 'a popular AI chatbot' -> 'A popular AI chatbot'.
export function capFirst(text) {
  const t = String(text ?? '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
