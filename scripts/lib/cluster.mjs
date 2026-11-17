// Dedupe and merge.
//
// mergeStories(existing, fresh) takes the stories already stored plus the
// items found this run and returns the merged story list. Two news items are
// the same story when they share a normalized title key (lowercase, no
// punctuation, first 12 words) or the same URL; a conservative word-overlap
// check also joins near-verbatim rewrites of one headline. Merged stories
// keep the earliest time (publishedAt), know the newest (latestAt) and count
// distinct outlets. Stored stories keep their id and first-seen time, so
// nothing is ever lost or re-dated.
import { createHash } from 'node:crypto';
import { titleKey, urlKey, tokens, publisherKey, hostOf } from './text.mjs';
import { newsRank, MAX_OUTLETS } from './rank.mjs';

export const FUZZY = { minShared: 4, minOverlap: 0.75 };

export function storyId(tkey) {
  return createHash('sha1').update(tkey).digest('hex').slice(0, 12);
}

// A "direct" link goes to the publisher; Google News links are redirects.
export function isDirectUrl(url) {
  const host = hostOf(url);
  return host !== 'news.google.com' && !host.endsWith('.bing.com') && host !== 'bing.com';
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function toMs(v) {
  if (v === null || v === undefined || v === '') return null;
  const ms = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

// How many people searched for a story on Google lately: a number above zero, else null.
function trendOf(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

// The Google search a trend story came from: a non-empty string, else null.
function termOf(v) {
  return typeof v === 'string' && v ? v : null;
}

function fromStory(s) {
  return {
    stored: true,
    id: s.id,
    kind: s.kind,
    cat: s.cat,
    title: s.title,
    url: s.url,
    source: s.source,
    names: Array.isArray(s.outletNames) && s.outletNames.length ? s.outletNames : [s.source],
    publishedAt: toMs(s.publishedAt),
    latestAt: toMs(s.latestAt),
    trending: trendOf(s.trending),
    trendTerm: termOf(s.trendTerm),
    firstSeenAt: toMs(s.firstSeenAt) ?? 0,
    signal: s.signal,
    score: s.score,
  };
}

function fromItem(item, now) {
  return {
    stored: false,
    id: item.id || null,
    kind: item.kind,
    cat: item.cat,
    title: item.title,
    url: item.url,
    source: item.source,
    names: [item.source],
    publishedAt: toMs(item.publishedAt),
    latestAt: null,
    trending: trendOf(item.trending),
    trendTerm: termOf(item.trendTerm),
    firstSeenAt: now,
    signal: item.signal,
    score: item.rank,
  };
}

class Dsu {
  constructor(n) {
    this.p = Array.from({ length: n }, (_, i) => i);
  }
  find(i) {
    while (this.p[i] !== i) {
      this.p[i] = this.p[this.p[i]];
      i = this.p[i];
    }
    return i;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.p[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

function similar(a, b, cfg) {
  if (a.cat !== b.cat) return false;
  const [small, large] = a.tok.size <= b.tok.size ? [a.tok, b.tok] : [b.tok, a.tok];
  if (small.size < cfg.minShared) return false;
  let shared = 0;
  for (const t of small) if (large.has(t)) shared += 1;
  return shared >= cfg.minShared && shared / small.size >= cfg.minOverlap;
}

function distinctNames(members) {
  const seen = new Map();
  for (const m of members) {
    for (const name of m.names) {
      const key = publisherKey(name);
      if (key && !seen.has(key)) seen.set(key, name);
    }
  }
  return [...seen.values()].slice(0, MAX_OUTLETS);
}

function minOf(values) {
  const v = values.filter((x) => Number.isFinite(x));
  return v.length ? Math.min(...v) : null;
}

function maxOf(values) {
  const v = values.filter((x) => Number.isFinite(x));
  return v.length ? Math.max(...v) : null;
}

// The newest time a story has been dated, for the editor. The newest member time that is not in the
// future: a member's publishedAt, or for a stored story the latestAt it was saved with (a story is only
// stored as its oldest time, so without this a run that no longer sees the newest article would take
// the date back). With none, when we first saw the story.
function latestOf(members, nowMs, firstSeenAt) {
  const times = members.flatMap((m) => [m.latestAt, m.publishedAt]).filter((t) => Number.isFinite(t) && t <= nowMs);
  return maxOf(times) ?? firstSeenAt;
}

function buildNews(members, now) {
  const stored = members.filter((m) => m.stored).sort((a, b) => a.firstSeenAt - b.firstSeenAt || (a.id < b.id ? -1 : 1));
  const rep = [...members].sort(
    (a, b) =>
      Number(isDirectUrl(b.url)) - Number(isDirectUrl(a.url)) ||
      Number(b.stored) - Number(a.stored) ||
      (a.publishedAt ?? Infinity) - (b.publishedAt ?? Infinity) ||
      (a.url < b.url ? -1 : a.url > b.url ? 1 : 0),
  )[0];
  const names = distinctNames([...stored, ...members.filter((m) => !m.stored)]);
  const firstSeenAt = stored.length ? Math.min(...stored.map((s) => s.firstSeenAt)) : now;
  const publishedAt = minOf(members.map((m) => m.publishedAt)) ?? firstSeenAt;
  const latestAt = latestOf(members, now, firstSeenAt);
  const trending = maxOf(members.map((m) => m.trending));
  // The stored search stays; with none stored, the first of the new ones in alphabetical order, so the
  // story does not change from run to run with the order of the feeds.
  const trendTerm = members.filter((m) => m.trendTerm).sort((a, b) => Number(b.stored) - Number(a.stored) || (a.trendTerm < b.trendTerm ? -1 : a.trendTerm > b.trendTerm ? 1 : 0))[0]?.trendTerm ?? null;
  const earliest = [...members].sort(
    (a, b) => (a.publishedAt ?? Infinity) - (b.publishedAt ?? Infinity) || (titleKey(a.title) < titleKey(b.title) ? -1 : 1),
  )[0];
  const id = stored.length ? stored[0].id : storyId(titleKey(earliest.title));
  const outlets = Math.max(1, names.length);
  const base = {
    id,
    cat: stored.length ? stored[0].cat : rep.cat,
    kind: stored.length ? stored[0].kind : rep.kind,
    title: rep.title,
    url: rep.url,
    source: rep.source,
    publishedAt: iso(publishedAt),
    latestAt: iso(latestAt),
    firstSeenAt: iso(firstSeenAt),
    outlets,
    outletNames: names,
  };
  // A story that was ever a Google trend keeps the biggest number it had, for as long as it lives. One that
  // never trended has no such key.
  if (trending !== null) base.trending = trending;
  // A trend story keeps its Google search, whether the search or its own headline filed it: the next run files it the
  // same way, and the editor can tell that two stories are about one search.
  if (trendTerm !== null) base.trendTerm = trendTerm;
  base.score = newsRank({ outlets, title: rep.title, publishedAt, firstSeenAt });
  return base;
}

function buildSignal(members, now) {
  const stored = members.find((m) => m.stored);
  // Highest severity wins; on a tie the stored copy stays (members are stored-first).
  const best = members.reduce((a, b) => (b.score > a.score ? b : a));
  const publishedAt = minOf(members.map((m) => m.publishedAt)) ?? (stored ? stored.firstSeenAt : now);
  const firstSeenAt = stored ? stored.firstSeenAt : now;
  // A signal is one instrument reading, dated by when the reading began. The FAA and the status pages date
  // every run with the moment of the run, so the newest of them would move this on every run and rewrite
  // the day for nothing.
  const latestAt = publishedAt <= now ? publishedAt : firstSeenAt;
  return {
    id: members[0].id,
    cat: best.cat,
    kind: 'signal',
    title: best.title,
    url: best.url,
    source: best.source,
    publishedAt: iso(publishedAt),
    latestAt: iso(latestAt),
    firstSeenAt: iso(firstSeenAt),
    outlets: 1,
    outletNames: [best.source],
    score: best.score,
    signal: best.signal,
  };
}

// One id, one story. A merged story takes the id of the earliest stored story in its group. A group can
// join two different stories through a third headline that is close to both; when that headline leaves the
// window the two come apart, and both can carry the id of the one they once shared. Here the story whose
// own headline made the id keeps it (or, when none did, the first to carry it). Every other story with that
// id takes the id of its own headline, or a numbered one when that is in use. An id carried by one story is
// never touched, so a stored story keeps its id, and a new id never lands on one that is in use.
export function uniqueIds(stories) {
  const count = new Map();
  for (const s of stories) count.set(s.id, (count.get(s.id) || 0) + 1);
  const keeper = new Map();
  for (const s of stories) {
    if (count.get(s.id) > 1 && s.kind !== 'signal' && !keeper.has(s.id) && storyId(titleKey(s.title)) === s.id) keeper.set(s.id, s);
  }
  for (const s of stories) {
    if (count.get(s.id) > 1 && !keeper.has(s.id)) keeper.set(s.id, s);
  }
  const taken = new Set(count.keys());
  for (const s of stories) {
    if (count.get(s.id) < 2 || keeper.get(s.id) === s) continue;
    const key = titleKey(s.title);
    let id = storyId(key);
    for (let n = 1; taken.has(id); n += 1) id = storyId(`${key}#${n}`);
    s.id = id;
    taken.add(id);
  }
  return stories;
}

export function mergeStories(existing, fresh, { now, fuzzy = FUZZY } = {}) {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const storedNodes = existing.map(fromStory).sort((a, b) => (a.id < b.id ? -1 : 1));
  const freshNodes = fresh
    .map((f) => fromItem(f, nowMs))
    .sort((a, b) => (a.publishedAt ?? nowMs) - (b.publishedAt ?? nowMs) || (a.url < b.url ? -1 : 1));
  const nodes = [...storedNodes, ...freshNodes];

  const signalGroups = new Map();
  const newsNodes = [];
  for (const n of nodes) {
    if (n.kind === 'signal') {
      if (!signalGroups.has(n.id)) signalGroups.set(n.id, []);
      signalGroups.get(n.id).push(n);
    } else {
      newsNodes.push(n);
    }
  }

  for (const n of newsNodes) {
    n.tkey = titleKey(n.title);
    n.ukey = urlKey(n.url);
    n.tok = tokens(n.title);
  }

  const dsu = new Dsu(newsNodes.length);
  const byTitle = new Map();
  const byUrl = new Map();
  const byId = new Map();
  newsNodes.forEach((n, i) => {
    if (n.stored) byId.set(n.id, i);
  });
  newsNodes.forEach((n, i) => {
    if (n.tkey) {
      if (byTitle.has(n.tkey)) dsu.union(i, byTitle.get(n.tkey));
      else byTitle.set(n.tkey, i);
    }
    if (byUrl.has(n.ukey)) dsu.union(i, byUrl.get(n.ukey));
    else byUrl.set(n.ukey, i);
    if (!n.stored) {
      const sid = byId.get(storyId(n.tkey));
      if (sid !== undefined) dsu.union(i, sid);
    }
  });
  for (let i = 0; i < newsNodes.length; i += 1) {
    for (let j = i + 1; j < newsNodes.length; j += 1) {
      if (dsu.find(i) !== dsu.find(j) && similar(newsNodes[i], newsNodes[j], fuzzy)) dsu.union(i, j);
    }
  }

  const groups = new Map();
  newsNodes.forEach((n, i) => {
    const root = dsu.find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(n);
  });

  const out = [];
  for (const members of groups.values()) out.push(buildNews(members, nowMs));
  for (const members of signalGroups.values()) out.push(buildSignal(members, nowMs));
  return uniqueIds(out);
}

export function compareStories(a, b) {
  return (
    b.score - a.score ||
    Date.parse(b.publishedAt) - Date.parse(a.publishedAt) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

// Top N by rank, but never let a category vanish just because a busier one
// crowded it out: the best few of each category are always kept, so the
// "3 publishers" test sees the same stories whether it runs before or after.
export function selectForDay(stories, { limit = 60, floor = 4, categoryCount = 12 } = {}) {
  const sorted = [...stories].sort(compareStories);
  if (sorted.length <= limit) return sorted;
  const perCat = Math.min(floor, Math.floor(limit / Math.max(1, categoryCount)));
  const keep = new Set();
  const seen = new Map();
  for (const s of sorted) {
    const n = seen.get(s.cat) ?? 0;
    if (n < perCat) {
      keep.add(s.id);
      seen.set(s.cat, n + 1);
    }
  }
  for (const s of sorted) {
    if (keep.size >= limit) break;
    keep.add(s.id);
  }
  return sorted.filter((s) => keep.has(s.id));
}
