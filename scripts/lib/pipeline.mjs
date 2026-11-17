// The gate every item passes before it is stored: link check, age check,
// headline quality (script, tags, cut-off titles, blocked publishers), the
// hard exclusion filter, and the category keyword gate. Each drop has a named
// reason so the run summary can show what was thrown away and why.
import { compileExcluder, compileGate } from './filter.mjs';
import { compileBlocklist, hasNonLatinScript, blockKey, qualityCheck } from './quality.mjs';
import { clean, safeUrl } from './text.mjs';
import { HOUR_MS } from './time.mjs';

export function createGatekeeper(cfg) {
  const excluder = compileExcluder(cfg.exclude);
  const gate = compileGate(cfg.categories);
  const blocked = compileBlocklist(cfg.blockedPublishers);
  const maxAgeMs = cfg.window.maxAgeHours * HOUR_MS;

  // Our own signals (quakes, ground stops, outages) are built here from
  // instrument data and need none of this. A post's text is cut to length by
  // us on purpose, so only news is held to the cut-off rule.
  function quality(kind, title, publishers) {
    if (kind === 'signal') return null;
    const q = qualityCheck(title, publishers, blocked);
    if (q && q.reason === 'quality:truncated' && kind === 'x') return null;
    return q;
  }

  // Returns { keep: item } or { drop: reason }. Items may be news, x or signal.
  function admit(raw, nowMs) {
    const title = clean(raw.title);
    const url = safeUrl(raw.url);
    if (!url) return { drop: 'bad-link' };
    if (!title || title.split(' ').length < 2 || title.length < 12) return { drop: 'too-short' };
    let publishedAt = raw.publishedAt === null || raw.publishedAt === undefined ? null : Number(raw.publishedAt);
    if (publishedAt !== null && !Number.isFinite(publishedAt)) publishedAt = null;
    if (publishedAt !== null && publishedAt < nowMs - maxAgeMs) return { drop: 'old' };
    // A date in the future is a feed mistake: count it as just now.
    if (publishedAt !== null && publishedAt > nowMs + HOUR_MS) publishedAt = nowMs;

    const q = quality(raw.kind, title, [raw.source]);
    if (q) return { drop: q.reason, detail: q.detail };

    const hit = excluder.test(title, { signal: raw.kind === 'signal' });
    if (hit) return { drop: `excluded:${hit.family}`, detail: hit.term };

    if (raw.kind === 'signal') {
      return { keep: { ...raw, title, url, publishedAt: publishedAt ?? nowMs } };
    }
    const cat = gate.pick(title, raw.cat);
    if (!cat) return { drop: 'off-topic' };
    return { keep: { ...raw, cat, title, url, publishedAt } };
  }

  // Re-check a stored story against the current rules (so tightening the
  // lists cleans old entries inside the 3-day window). Returns the story to
  // keep, with its category re-picked if the gate moved it, or a drop reason.
  function recheck(story) {
    const q = quality(story.kind, story.title, [story.source]);
    if (q) return { drop: q.reason, detail: q.detail };
    const hit = excluder.test(story.title, { signal: story.kind === 'signal' });
    if (hit) return { drop: `excluded:${hit.family}`, detail: hit.term };
    if (story.kind === 'signal') return { keep: story };
    const cat = gate.pick(story.title, story.cat);
    if (!cat) return { drop: 'off-topic' };
    let next = cat === story.cat ? story : { ...story, cat };
    // A story told by several outlets keeps only the ones we would publish.
    if (Array.isArray(story.outletNames)) {
      const names = story.outletNames.filter((n) => !hasNonLatinScript(n) && !blocked.has(blockKey(n)));
      if (names.length !== story.outletNames.length) {
        if (!names.length) return { drop: 'quality:publisher', detail: String(story.source) };
        next = { ...next, outletNames: names, outlets: names.length };
      }
    }
    return { keep: next };
  }

  return { admit, recheck, excluder, gate };
}
