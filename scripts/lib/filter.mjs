// The hard exclusion filter and the per-category keyword gate.
//
// Exclusion terms are matched case-insensitively with word boundaries, unless
// a term says otherwise: { term, prefix: true } matches word starts ("Palestin"
// catches Palestine and Palestinian), { term, caseSensitive: true } is exact
// ("ICE" is caught, "ice storm" survives), { pattern } is a raw regex source.
// Families group the terms so a test (and the run summary) can say why a
// headline was dropped.
//
// A family can also name sources and titles instead of terms:
//   { name, sources: ['PR Newswire'] }   a story from that news site is dropped; the name is
//                                        matched ignoring case and punctuation, as whole words,
//                                        and a web address of the site counts too
//   { name, titles: ['drastic step'] }   a title that holds that lowercase text is dropped

const WORD = '[\\p{L}\\p{N}_]';

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileTerm(def) {
  const d = typeof def === 'string' ? { term: def } : def;
  const caseSensitive = Boolean(d.caseSensitive);
  const flags = caseSensitive ? 'u' : 'iu';
  let body;
  let label;
  let startB = true;
  let endB = !d.prefix;
  if (d.pattern !== undefined) {
    body = d.pattern;
    label = d.label || d.pattern;
  } else {
    label = d.term;
    body = escapeRe(d.term).replace(/ /g, '\\s+');
    startB = /^[\p{L}\p{N}_]/u.test(d.term);
    endB = !d.prefix && /[\p{L}\p{N}_]$/u.test(d.term);
  }
  const src = (startB ? `(?<!${WORD})` : '') + `(?:${body})` + (endB ? `(?!${WORD})` : '');
  return { label, re: new RegExp(src, flags) };
}

// A news site's name as letters and numbers in single spaces: "EIN Presswire", "ein-presswire" and
// "EIN Presswire (press release)" all read the same up to the extra words. A web address reads the same
// way: "www.einpresswire.com" is the words www, einpresswire and com.
function sourceKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function compileSources(names) {
  return (names || [])
    .map((name) => ({ name, key: sourceKey(name) }))
    .filter((r) => r.key)
    .map((r) => ({ name: r.name, spaced: ` ${r.key} `, joined: r.key.replace(/ /g, '') }));
}

// The rule a source name matches, or null. Whole words only, so "openPR" does not catch "Open Prairie
// Reporter". A rule also matches when whole words of the source run together to its name, which is how
// "PR Newswire" catches "PRNewswire", "Globe Newswire (press release)" and "prnewswire.com".
function sourceRule(rules, source) {
  const key = sourceKey(source);
  if (!key) return null;
  const spaced = ` ${key} `;
  const words = key.split(' ');
  const longest = Math.max(...rules.map((r) => r.joined.length));
  const runs = new Set();
  for (let i = 0; i < words.length; i += 1) {
    let run = '';
    for (let j = i; j < words.length && run.length <= longest; j += 1) {
      run += words[j];
      runs.add(run);
    }
  }
  return rules.find((r) => spaced.includes(r.spaced) || runs.has(r.joined)) || null;
}

export function compileExcluder(families) {
  const compiled = families.map((fam) => ({
    name: fam.name,
    skipForSignals: Boolean(fam.skipForSignals),
    terms: (fam.terms || []).map(compileTerm),
    combos: (fam.combos || []).map((c) => ({ label: c.label, needs: c.needs.map(compileTerm) })),
    predicate: fam.predicate || null,
    sources: compileSources(fam.sources),
    titles: (fam.titles || []).map((t) => String(t).toLowerCase()).filter(Boolean),
    label: fam.label || fam.name,
  }));
  return {
    families: compiled.map((f) => f.name),
    // Returns null when the title is fine, else { family, term }. source is the news site's name;
    // without it the source rules cannot match.
    test(title, { signal = false, source = '' } = {}) {
      const t = String(title ?? '');
      const lower = t.toLowerCase();
      for (const fam of compiled) {
        if (signal && fam.skipForSignals) continue;
        for (const term of fam.terms) {
          if (term.re.test(t)) return { family: fam.name, term: term.label };
        }
        for (const combo of fam.combos) {
          if (combo.needs.every((n) => n.re.test(t))) return { family: fam.name, term: combo.label };
        }
        if (fam.predicate && fam.predicate(t)) return { family: fam.name, term: fam.label };
        const rule = fam.sources.length ? sourceRule(fam.sources, source) : null;
        if (rule) return { family: fam.name, term: rule.name };
        const piece = fam.titles.find((x) => lower.includes(x));
        if (piece) return { family: fam.name, term: piece };
      }
      return null;
    },
  };
}

// ---- category gate ---------------------------------------------------------
// keywords: array of RegExp, or arrays of RegExp (every one of those must match).
// reject: RegExp[] that veto the category even when a keyword matched.

function entryMatches(entry, title) {
  return Array.isArray(entry) ? entry.every((re) => re.test(title)) : entry.test(title);
}

export function compileGate(categories) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const order = categories.map((c) => c.id);

  function matches(catId, title) {
    const c = byId.get(catId);
    if (!c) return false;
    const t = String(title ?? '');
    if ((c.reject || []).some((re) => re.test(t))) return false;
    return c.keywords.some((entry) => entryMatches(entry, t));
  }

  // The category a headline belongs to. A category may "claim" a headline
  // (bank outages are Hacked, whichever query found them); otherwise the one
  // the query asked for when it matches, otherwise the first category in grid
  // order that does.
  function pick(title, hint) {
    const t = String(title ?? '');
    for (const id of order) {
      const c = byId.get(id);
      if (c.claim && c.claim.some((re) => re.test(t)) && matches(id, t)) return id;
    }
    if (hint && matches(hint, title)) return hint;
    for (const id of order) {
      if (id !== hint && matches(id, title)) return id;
    }
    return null;
  }

  return { matches, pick, order };
}
