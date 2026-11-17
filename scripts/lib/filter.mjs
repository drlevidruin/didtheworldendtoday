// The hard exclusion filter and the per-category keyword gate.
//
// Exclusion terms are matched case-insensitively with word boundaries, unless
// a term says otherwise: { term, prefix: true } matches word starts ("Palestin"
// catches Palestine and Palestinian), { term, caseSensitive: true } is exact
// ("ICE" is caught, "ice storm" survives), { pattern } is a raw regex source.
// Families group the terms so a test (and the run summary) can say why a
// headline was dropped.

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

export function compileExcluder(families) {
  const compiled = families.map((fam) => ({
    name: fam.name,
    skipForSignals: Boolean(fam.skipForSignals),
    terms: (fam.terms || []).map(compileTerm),
    combos: (fam.combos || []).map((c) => ({ label: c.label, needs: c.needs.map(compileTerm) })),
    predicate: fam.predicate || null,
    label: fam.label || fam.name,
  }));
  return {
    families: compiled.map((f) => f.name),
    // Returns null when the title is fine, else { family, term }.
    test(title, { signal = false } = {}) {
      const t = String(title ?? '');
      for (const fam of compiled) {
        if (signal && fam.skipForSignals) continue;
        for (const term of fam.terms) {
          if (term.re.test(t)) return { family: fam.name, term: term.label };
        }
        for (const combo of fam.combos) {
          if (combo.needs.every((n) => n.re.test(t))) return { family: fam.name, term: combo.label };
        }
        if (fam.predicate && fam.predicate(t)) return { family: fam.name, term: fam.label };
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
