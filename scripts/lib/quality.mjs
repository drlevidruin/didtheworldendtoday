// Headline quality: what makes a headline fit to publish, apart from what it
// is about (the exclusion families and category gates handle that).
//
// A headline is dropped when it
//   - is written in, or comes from a publisher named in, a script other than
//     Latin (Hangul, CJK, Cyrillic, Greek, Arabic, Hebrew, Thai, Devanagari...);
//   - starts with a bracketed tag like "[Photo]" or "[U.S. Stocks]";
//   - carries a star symbol (a sign of a stock-chat feed);
//   - is cut off with "..." or an ellipsis;
//   - comes from a publisher on the blocklist in config.
// Each check returns a reason the run summary can count.

// Letters of any script except Latin. Common and Inherited letters (modifier
// marks, the micro sign) are not a different alphabet, so they pass.
const NON_LATIN = /[\p{L}--[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]]/v;
const TAG = /^\s*\[[^\]]{1,40}\]/;
const STARS = /[☆★]/;
const CUT_OFF = /(?:\.{3}|…)\s*$/;

export function hasNonLatinScript(text) {
  return NON_LATIN.test(String(text ?? ''));
}

// "Moomoo", "moomoo.com" and "Moomoo on MSN" are one publisher.
export function blockKey(name) {
  let s = String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
  s = s.replace(/\s+(on|via)\s+(msn|yahoo|yahoo news|microsoft start)$/, '').replace(/^www\./, '');
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) s = s.slice(0, s.lastIndexOf('.'));
  return s.replace(/[^a-z0-9]+/g, '');
}

export function compileBlocklist(names) {
  return new Set((names || []).map(blockKey).filter(Boolean));
}

// Returns null when the headline passes, else { reason, detail }.
// publishers: every publisher name tied to the story (one for a fresh item).
export function qualityCheck(title, publishers, blocklist) {
  const t = String(title ?? '');
  if (hasNonLatinScript(t)) return { reason: 'quality:script', detail: 'title' };
  for (const name of publishers || []) {
    if (hasNonLatinScript(name)) return { reason: 'quality:script', detail: `publisher ${name}` };
    if (blocklist && blocklist.has(blockKey(name))) return { reason: 'quality:publisher', detail: String(name) };
  }
  if (TAG.test(t)) return { reason: 'quality:tag', detail: t.match(TAG)[0].trim() };
  if (STARS.test(t)) return { reason: 'quality:symbol', detail: 'star' };
  if (CUT_OFF.test(t)) return { reason: 'quality:truncated', detail: 'ends in an ellipsis' };
  return null;
}
