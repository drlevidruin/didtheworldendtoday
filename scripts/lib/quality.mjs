// Headline quality: what makes a headline fit to publish, apart from what it
// is about (the exclusion families and category gates handle that).
//
// A headline is dropped when it
//   - is written in, or comes from a publisher named in, a script other than
//     Latin (Hangul, CJK, Cyrillic, Greek, Arabic, Hebrew, Thai, Devanagari...);
//   - is written in a language other than English (a simple stopword count; the
//     taste filter only reads English, so a headline it cannot read is not published);
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

// ---- language ---------------------------------------------------------------
// Small words that are not English, from Spanish, Portuguese, French, Italian,
// German, Dutch, Indonesian, Turkish, Polish and the Nordic languages. A word that
// is also a common English word ("no", "son", "van", "per", "die", "was", "door",
// "met") is left out, so an English headline cannot trip on it.
const FOREIGN = new Set(
  (
    'el los las del que por para una uno unos unas su sus al es como pero sobre entre tras ante desde hasta ' +
    'este esta estos estas ese esa lo les nuestro nuestra han fue ser sin también cuando donde muy ya y hay tiene tienen ' +
    'contra durante según nos mil ' +
    'os do da dos das em na nas nos um uma são se mais não foi tem ao aos pelo pela após sem ainda ' +
    'le la les des du de un une et est sont dans sur avec ce cette ces qui mais ou où ses leur leurs il elle ils elles ' +
    'nous vous fait après avant sous chez très aussi selon dont ' +
    'il lo gli le di della dei delle che è un una con su da nel nella nei nelle non sono più ma anche dopo tra fra ' +
    'alla alle allo degli dal dalla sul sulla ' +
    'der das den dem des und ist sind nicht mit für von auf bei zu im ein eine einen einem wie nach aus über wird ' +
    'werden hat haben auch sich nur noch oder aber wegen gegen zum zur vom beim ' +
    'het een en op voor niet zijn wordt naar ook maar uit aan dat dit deze ' +
    'yang dan di ke dari untuk dengan pada ini itu dalam tidak akan adalah oleh karena juga sudah telah atau saat ' +
    'bir ve için ile ama gibi daha çok olarak ' +
    'się jest nie że dla przez oraz ' +
    'och att det som för är inte av på till'
  ).split(' '),
);

const ENGLISH = new Set(
  (
    'the and of to in on at for with by from as is are was were be been has have had it its this that these those ' +
    'after over new not but or will says say said up out into than how why what who when where which about more all ' +
    'can could would may now just you your they their he she his her we our no off down amid before during under ' +
    'between against if so there here an do does did being also very'
  ).split(' '),
);

const WORDS = /[\p{L}]+/gu;

// True when the headline reads as another language: at least two lowercase foreign
// small words, and more than twice as many of them as English ones. A capitalised
// word after the first ("La Nina", "El Salvador", "Los Angeles") is a name, not a count,
// and neither is a small word right before a capitalised one ("Día de los Muertos").
export function looksNotEnglish(text) {
  const t = String(text ?? '');
  const words = [...t.matchAll(WORDS)];
  let foreign = 0;
  let english = 0;
  words.forEach((m, i) => {
    const word = m[0];
    const lower = word.toLowerCase();
    if (ENGLISH.has(lower)) {
      english += 1;
      return;
    }
    if (!FOREIGN.has(lower) || !(word === lower || i === 0)) return;
    const next = words[i + 1];
    const partOfName = next && /^\p{Lu}/u.test(next[0]) && /^\s+$/.test(t.slice(m.index + word.length, next.index));
    if (!partOfName) foreign += 1;
  });
  return foreign >= 2 && foreign > 2 * english;
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
  if (looksNotEnglish(t)) return { reason: 'quality:language', detail: 'not English' };
  for (const name of publishers || []) {
    if (hasNonLatinScript(name)) return { reason: 'quality:script', detail: `publisher ${name}` };
    if (blocklist && blocklist.has(blockKey(name))) return { reason: 'quality:publisher', detail: String(name) };
  }
  if (TAG.test(t)) return { reason: 'quality:tag', detail: t.match(TAG)[0].trim() };
  if (STARS.test(t)) return { reason: 'quality:symbol', detail: 'star' };
  if (CUT_OFF.test(t)) return { reason: 'quality:truncated', detail: 'ends in an ellipsis' };
  return null;
}
