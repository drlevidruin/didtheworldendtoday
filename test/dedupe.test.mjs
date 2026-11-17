import test from 'node:test';
import assert from 'node:assert/strict';
import { compileBoilerplate, mergeStories, selectForDay, storyId, uniqueIds } from '../scripts/lib/cluster.mjs';
import { newsRank, boostFor, recencyFor } from '../scripts/lib/rank.mjs';
import { titleKey, urlKey, stripPublisher, publisherKey } from '../scripts/lib/text.mjs';
import { newsItem } from './helpers.mjs';

const NOW = Date.parse('2026-11-16T22:00:00Z');
const merge = (existing, fresh, now = NOW) => mergeStories(existing, fresh, { now });

test('the same headline from two outlets is one story with two outlets', () => {
  const out = merge([], [
    newsItem({ title: 'Cloudflare outage knocks sites offline', source: 'The Verge', url: 'https://theverge.com/a' }),
    newsItem({ title: 'Cloudflare outage knocks sites offline!', source: 'Wired', url: 'https://wired.com/b' }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].outlets, 2);
  assert.deepEqual(out[0].outletNames.sort(), ['The Verge', 'Wired']);
});

test('title key: lowercase, no punctuation, first 12 words', () => {
  assert.equal(titleKey("It's a MASSIVE outage, again!"), 'its a massive outage again');
  const long = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen';
  assert.equal(titleKey(long), 'one two three four five six seven eight nine ten eleven twelve');
});

test('a Google "- Publisher" suffix is stripped only when it is the real publisher', () => {
  assert.equal(stripPublisher('Big outage hits banks - Reuters', 'Reuters'), 'Big outage hits banks');
  assert.equal(stripPublisher('Big outage - what we know - Reuters', 'Reuters'), 'Big outage - what we know');
  assert.equal(stripPublisher('Big outage - what we know', 'Reuters'), 'Big outage - what we know');
});

test('the same URL with tracking parameters is the same story', () => {
  assert.equal(urlKey('https://www.example.com/a/b/?utm_source=x&fbclid=1'), urlKey('https://example.com/a/b'));
  const out = merge([], [
    newsItem({ title: 'Grid failure plunges city into the dark', url: 'https://example.com/a?utm_source=x', source: 'A' }),
    newsItem({ title: 'Totally different words here about the same page', url: 'https://example.com/a', source: 'B' }),
  ]);
  assert.equal(out.length, 1);
});

test('near-identical rewrites of one headline merge; different stories do not', () => {
  const out = merge([], [
    newsItem({ title: 'FAA outage traced to aging copper-wire switch as expert warns air traffic system needs overhaul', source: 'WSB', url: 'https://a.com/1' }),
    newsItem({ title: 'FAA outage traced to aging copper-wire switch, expert warns air traffic system needs overhaul', source: 'KSL', url: 'https://b.com/2' }),
    newsItem({ title: 'Bank of America online banking outage leaves customers locked out', source: 'CNN', url: 'https://c.com/3' }),
  ]);
  assert.equal(out.length, 2);
  assert.equal(out.find((s) => /FAA/.test(s.title)).outlets, 2);
});

test('the earliest time is kept and the story is dated by it', () => {
  const out = merge([], [
    newsItem({ title: 'Cloudflare outage knocks sites offline', source: 'A', url: 'https://a.com/1', publishedAt: Date.parse('2026-11-16T21:00:00Z') }),
    newsItem({ title: 'Cloudflare outage knocks sites offline', source: 'B', url: 'https://b.com/1', publishedAt: Date.parse('2026-11-16T19:00:00Z') }),
  ]);
  assert.equal(out[0].publishedAt, '2026-11-16T19:00:00.000Z');
});

test('outlets are counted by publisher: "TechCrunch on MSN" is TechCrunch', () => {
  assert.equal(publisherKey('TechCrunch on MSN'), publisherKey('TechCrunch'));
  assert.equal(publisherKey('theregister.com'), publisherKey('The Register'));
  const out = merge([], [
    newsItem({ title: 'Cloudflare outage knocks sites offline', source: 'TechCrunch', url: 'https://a.com/1' }),
    newsItem({ title: 'Cloudflare outage knocks sites offline', source: 'TechCrunch on MSN', url: 'https://msn.com/1' }),
  ]);
  assert.equal(out[0].outlets, 1);
});

test('a direct publisher link beats a Google redirect', () => {
  const out = merge([], [
    newsItem({ title: 'Cloudflare outage knocks sites offline', source: 'A', url: 'https://news.google.com/rss/articles/CBMi123?oc=5' }),
    newsItem({ title: 'Cloudflare outage knocks sites offline', source: 'A', url: 'https://publisher.com/story' }),
  ]);
  assert.equal(out[0].url, 'https://publisher.com/story');
});

test('stored stories keep their id and first-seen time when new outlets join', () => {
  const first = merge([], [newsItem({ title: 'Cloudflare outage knocks sites offline', source: 'A', url: 'https://a.com/1' })]);
  const later = merge(first, [newsItem({ title: 'Cloudflare outage knocks sites offline', source: 'B', url: 'https://b.com/1' })], NOW + 3600e3);
  assert.equal(later.length, 1);
  assert.equal(later[0].id, first[0].id);
  assert.equal(later[0].firstSeenAt, first[0].firstSeenAt);
  assert.equal(later[0].outlets, 2);
});

test('nothing stored is lost when a run brings nothing new', () => {
  const first = merge([], [
    newsItem({ title: 'Cloudflare outage knocks sites offline', source: 'A', url: 'https://a.com/1' }),
    newsItem({ title: 'Rolling blackouts hit the regional grid', cat: 'grid', source: 'B', url: 'https://b.com/1' }),
  ]);
  const again = merge(first, [], NOW + 900e3);
  assert.deepEqual(again.map((s) => s.id).sort(), first.map((s) => s.id).sort());
});

test('the id comes from the title key, so it is stable', () => {
  const [a] = merge([], [newsItem({ title: 'Cloudflare outage knocks sites offline' })]);
  assert.equal(a.id, storyId(titleKey('Cloudflare outage knocks sites offline')));
});

// A stored story as the data file holds it.
const stored = (title, over = {}) => ({
  id: storyId(titleKey(title)),
  kind: 'news',
  cat: 'flights',
  title,
  url: `https://pub.example/${titleKey(title).replace(/ /g, '-')}`,
  source: 'Pub A',
  publishedAt: '2026-11-16T12:00:00.000Z',
  firstSeenAt: '2026-11-16T12:00:00.000Z',
  outlets: 1,
  outletNames: ['Pub A'],
  score: 1,
  ...over,
});

const UNITED = 'United Airlines ground stop delays flights across the country';
const FOX = 'Fox reports dozens of planes held back as FAA halts departures';

test('one id, one story: two stored stories that carry one id come out with an id each, and the story that made the id keeps it', () => {
  const united = stored(UNITED);
  const fox = stored(FOX, { id: united.id });
  for (const order of [[united, fox], [fox, united]]) {
    const out = merge(order, []);
    assert.equal(out.length, 2);
    assert.equal(new Set(out.map((s) => s.id)).size, 2, 'no two stories share an id');
    assert.equal(out.find((s) => s.title === UNITED).id, united.id, 'the story whose headline made the id keeps it');
    assert.equal(out.find((s) => s.title === FOX).id, storyId(titleKey(FOX)), 'the other takes the id of its own headline');
  }
  // and it stays settled: another run with nothing new changes no id
  const again = merge(merge([united, fox], []), [], NOW + 900e3);
  assert.deepEqual(again.map((s) => s.id).sort(), merge([united, fox], []).map((s) => s.id).sort());
});

test('one id, one story: a headline close to both of two stories joins them into one story with one id, and it stays one', () => {
  const united = stored('United ground stop halts departures nationwide');
  const faa = stored('FAA reports router fault halts departures nationwide', { firstSeenAt: '2026-11-16T13:00:00.000Z' });
  const bridge = newsItem({ title: 'United ground stop halts departures nationwide as FAA reports router fault', cat: 'flights', source: 'AP', url: 'https://ap.example/b' });
  const apart = merge([united, faa], []);
  assert.equal(apart.length, 2, 'on their own they are two stories');
  assert.equal(new Set(apart.map((s) => s.id)).size, 2);
  const joined = merge([united, faa], [bridge]);
  assert.equal(joined.length, 1, 'the bridge makes them one story');
  assert.equal(joined[0].id, united.id, 'the earlier story keeps its id');
  assert.equal(joined[0].outlets, 2);
  // and the merged story is merged again with the same headlines: still one story, one id
  const again = merge(joined, [bridge], NOW + 900e3);
  assert.deepEqual(again.map((s) => s.id), [united.id]);
});

test('uniqueIds: the story that made the id keeps it, the others take the id of their own headline, then a numbered one', () => {
  const owner = { id: storyId(titleKey('Alpha story title words here')), kind: 'news', title: 'Alpha story title words here' };
  const twin1 = { id: owner.id, kind: 'news', title: 'Beta story headline about something else' };
  const twin2 = { id: owner.id, kind: 'news', title: 'Beta story headline about something else' };
  const odd = { id: 'abc123abc123', kind: 'news', title: 'A headline that changed since its id was made' };
  const sig = { id: 'sig:kp:2026-11-16', kind: 'signal', title: 'Kp 5' };
  const out = uniqueIds([twin1, owner, twin2, odd, sig]);
  assert.equal(out.length, 5);
  assert.equal(new Set(out.map((s) => s.id)).size, 5, 'five stories, five ids');
  assert.equal(owner.id, storyId(titleKey('Alpha story title words here')), 'the owner is untouched');
  assert.equal(odd.id, 'abc123abc123', 'an id nobody shares is never changed');
  assert.equal(sig.id, 'sig:kp:2026-11-16');
  assert.equal(twin1.id, storyId(titleKey(twin1.title)), 'the first twin takes the id of its own headline');
  assert.equal(twin2.id, storyId(`${titleKey(twin2.title)}#1`), 'the second twin takes a numbered one');
  // already unique: nothing changes, in any order, and a second pass changes nothing either
  const ids = out.map((s) => s.id);
  assert.deepEqual(uniqueIds(out).map((s) => s.id), ids);
  assert.deepEqual(uniqueIds([]), []);
});

test('uniqueIds: a twin never takes the id of a story that shares its id with nobody, whatever the order', () => {
  const alpha = 'Alpha story title words here';
  const beta = 'Beta story headline about something else';
  const gamma = 'Gamma story that kept an older id';
  const make = () => ({
    keeper: { id: storyId(titleKey(alpha)), kind: 'news', title: alpha },
    twin: { id: storyId(titleKey(alpha)), kind: 'news', title: beta },
    // not shared with anyone, and it is the id the twin's own headline would make
    later: { id: storyId(titleKey(beta)), kind: 'news', title: gamma },
  });
  for (const order of [['keeper', 'twin', 'later'], ['keeper', 'later', 'twin'], ['later', 'twin', 'keeper'], ['twin', 'keeper', 'later'], ['later', 'keeper', 'twin'], ['twin', 'later', 'keeper']]) {
    const set = make();
    const before = { keeper: set.keeper.id, later: set.later.id };
    const out = uniqueIds(order.map((name) => set[name]));
    assert.equal(new Set(out.map((s) => s.id)).size, 3, `${order}: three stories, three ids`);
    assert.equal(set.keeper.id, before.keeper, `${order}: the keeper is untouched`);
    assert.equal(set.later.id, before.later, `${order}: a story whose id nobody shares is untouched`);
    assert.notEqual(set.twin.id, before.keeper, `${order}: the twin has left the shared id`);
    assert.notEqual(set.twin.id, before.later, `${order}: and has not landed on the id of the story beside it`);
    assert.equal(set.twin.id, storyId(`${titleKey(beta)}#1`), `${order}: it takes a numbered id of its own headline instead`);
  }
  // a twin whose own-headline id is free takes it, as before
  const free = { keeper: { id: storyId(titleKey(alpha)), kind: 'news', title: alpha }, twin: { id: storyId(titleKey(alpha)), kind: 'news', title: beta } };
  uniqueIds([free.keeper, free.twin]);
  assert.equal(free.twin.id, storyId(titleKey(beta)));
  // and the same through a merge of stored stories: the story with an unshared id keeps it
  const keeper = { id: storyId(titleKey(alpha)), kind: 'news', cat: 'flights', title: alpha, url: 'https://a.example/1', source: 'A', outlets: 1, outletNames: ['A'], publishedAt: '2026-11-16T12:00:00.000Z', firstSeenAt: '2026-11-16T12:00:00.000Z', score: 1 };
  const twin = { ...keeper, title: beta, url: 'https://b.example/2', source: 'B', outletNames: ['B'] };
  const later = { ...keeper, id: storyId(titleKey(beta)), title: gamma, url: 'https://c.example/3', source: 'C', outletNames: ['C'] };
  const merged = merge([keeper, twin, later], []);
  assert.equal(merged.length, 3);
  assert.equal(new Set(merged.map((x) => x.id)).size, 3);
  assert.equal(merged.find((x) => x.title === gamma).id, later.id, 'the later story keeps its stored id');
  assert.equal(merged.find((x) => x.title === alpha).id, keeper.id);
});

test('story rank = (1 + log2(outlets)) x boost x recency', () => {
  const t = NOW;
  assert.equal(newsRank({ outlets: 1, title: 'Plain outage', publishedAt: t, firstSeenAt: t }), 1);
  assert.equal(newsRank({ outlets: 4, title: 'Plain outage', publishedAt: t, firstSeenAt: t }), 3);
  assert.equal(newsRank({ outlets: 1, title: 'Massive outage', publishedAt: t, firstSeenAt: t }), 1.4);
  for (const w of ['global', 'worldwide', 'nationwide', 'massive', 'major', 'record', 'biggest', 'all flights', 'millions']) {
    assert.equal(boostFor(`A ${w} thing`), 1.4, w);
  }
  assert.equal(boostFor('A local thing'), 1);
  assert.equal(recencyFor(0), 1);
  assert.equal(recencyFor(36), 0.4);
  assert.ok(recencyFor(18) > 0.4 && recencyFor(18) < 1);
});

test('signals with one id merge, and the more severe reading wins', () => {
  const sig = (rank, title) => ({ kind: 'signal', id: 'sig:kp:2026-11-16', cat: 'sun', title, url: 'https://swpc.example/', source: 'NOAA SWPC', publishedAt: NOW, rank, signal: { type: 'kp', kp: 5 } });
  const first = merge([], [sig(3.5, 'Kp 5')]);
  const later = merge(first, [sig(6, 'Kp 7')], NOW + 1000);
  assert.equal(later.length, 1);
  assert.equal(later[0].title, 'Kp 7');
  assert.equal(later[0].score, 6);
});

test('a busy category cannot push another out of the day: each keeps its best few', () => {
  const stories = [];
  for (let i = 0; i < 80; i += 1) stories.push({ id: `a${i}`, cat: 'flights', score: 5 + i / 100, publishedAt: '2026-11-16T10:00:00.000Z' });
  for (let i = 0; i < 3; i += 1) stories.push({ id: `b${i}`, cat: 'animals', score: 0.7, publishedAt: '2026-11-16T10:00:00.000Z' });
  const out = selectForDay(stories, { limit: 60, floor: 4, categoryCount: 12 });
  assert.equal(out.length, 60);
  assert.equal(out.filter((s) => s.cat === 'animals').length, 3);
});

// ---- the newest time of a story, and what Google says about it ---------------------------------------------------

const CF = 'Cloudflare outage knocks sites offline';
const at = (iso) => Date.parse(iso);
const from = (source, iso, over = {}) => newsItem({ title: CF, source, url: `https://${source.toLowerCase().replace(/ /g, '')}.example/cf`, publishedAt: iso === null ? null : at(iso), ...over });

test('latestAt: the newest time of any member that is not in the future, while publishedAt stays the oldest', () => {
  const [s] = merge([], [from('A', '2026-11-16T19:00:00Z'), from('B', '2026-11-16T21:30:00Z'), from('C', '2026-11-16T20:00:00Z')]);
  assert.equal(s.publishedAt, '2026-11-16T19:00:00.000Z', 'publishedAt is as it always was: the oldest');
  assert.equal(s.latestAt, '2026-11-16T21:30:00.000Z');
  assert.equal(s.firstSeenAt, '2026-11-16T22:00:00.000Z');
  // a member dated after now is a feed mistake and does not count
  const [ahead] = merge([], [from('A', '2026-11-16T19:00:00Z'), from('B', '2026-11-16T22:30:00Z')]);
  assert.equal(ahead.latestAt, '2026-11-16T19:00:00.000Z');
  assert.equal(ahead.publishedAt, '2026-11-16T19:00:00.000Z');
  // a member dated this very moment counts
  assert.equal(merge([], [from('A', '2026-11-16T19:00:00Z'), from('B', '2026-11-16T22:00:00Z')])[0].latestAt, '2026-11-16T22:00:00.000Z');
  // with no usable time at all it is when we first saw the story
  const [none] = merge([], [from('A', null), from('B', '2026-11-16T22:40:00Z')]);
  assert.equal(none.latestAt, '2026-11-16T22:00:00.000Z');
  assert.equal(none.firstSeenAt, '2026-11-16T22:00:00.000Z');
  assert.equal(merge([], [from('A', null)])[0].latestAt, '2026-11-16T22:00:00.000Z');
  assert.equal(typeof merge([], [from('A', '2026-11-16T19:00:00Z')])[0].latestAt, 'string', 'one member: its own time');
});

test('latestAt: every story has it, and a run that no longer sees the newest article does not take it back', () => {
  const first = merge([], [from('A', '2026-11-16T19:00:00Z'), from('B', '2026-11-16T21:30:00Z')]);
  assert.equal(first[0].latestAt, '2026-11-16T21:30:00.000Z');
  // later runs: nothing new, then an older article, then a newer one
  const quiet = merge(first, [], NOW + 3600e3);
  assert.equal(quiet[0].latestAt, '2026-11-16T21:30:00.000Z', 'the newest article left the feed, the date stays');
  const older = merge(quiet, [from('C', '2026-11-16T18:00:00Z')], NOW + 7200e3);
  assert.equal(older[0].latestAt, '2026-11-16T21:30:00.000Z');
  assert.equal(older[0].publishedAt, '2026-11-16T18:00:00.000Z', 'publishedAt still follows the oldest');
  const newer = merge(older, [from('D', '2026-11-17T00:30:00Z')], NOW + 3 * 3600e3);
  assert.equal(newer[0].latestAt, '2026-11-17T00:30:00.000Z');
  // a stored story from before latestAt existed is dated by its publishedAt, and then by any newer member
  const legacy = stored(CF, { cat: 'internet', publishedAt: '2026-11-16T12:00:00.000Z', firstSeenAt: '2026-11-16T12:05:00.000Z' });
  assert.ok(!('latestAt' in legacy));
  assert.equal(merge([legacy], [], NOW)[0].latestAt, '2026-11-16T12:00:00.000Z');
  assert.equal(merge([legacy], [from('A', '2026-11-16T21:00:00Z')], NOW)[0].latestAt, '2026-11-16T21:00:00.000Z');
  // the Apple outage of 11/17: stored with last night's time, and a headline from this morning joins it
  const apple = stored('Apple outage knocks iCloud and the App Store offline', { cat: 'internet', publishedAt: '2026-11-16T23:30:00.000Z', firstSeenAt: '2026-11-17T17:00:00.000Z' });
  const joined = merge([apple], [newsItem({ title: apple.title, source: 'USA Today', url: 'https://usatoday.example/apple', publishedAt: at('2026-11-17T17:20:00Z') })], at('2026-11-17T18:00:00Z'));
  assert.equal(joined[0].publishedAt, '2026-11-16T23:30:00.000Z', 'it still carries last night');
  assert.equal(joined[0].latestAt, '2026-11-17T17:20:00.000Z', 'and knows it is new');
  // a signal is dated by its own reading, not by the moment of each run
  const sig = (over = {}) => ({ kind: 'signal', id: 'sig:faa-stop:ORD:2026-11-16', cat: 'flights', title: 'FAA ground stop at ORD', url: 'https://nasstatus.example/', source: 'FAA', rank: 3.5, signal: { type: 'faa-ground-stop' }, ...over });
  const s1 = merge([], [sig({ publishedAt: NOW })]);
  assert.equal(s1[0].latestAt, s1[0].publishedAt);
  const s2 = merge(s1, [sig({ publishedAt: NOW + 900e3 })], NOW + 900e3);
  assert.deepEqual(s2, s1, 'a second reading of the same stop changes nothing, so a quiet run leaves the day file alone');
});

test('latestAt and trending leave publishedAt and the score as they were', () => {
  const a = from('A', '2026-11-16T19:00:00Z');
  const b = from('B', '2026-11-16T21:30:00Z');
  const [plain] = merge([], [a, b]);
  const [trended] = merge([], [a, { ...b, trending: 50000 }]);
  assert.equal(trended.score, plain.score);
  assert.equal(trended.publishedAt, plain.publishedAt);
  assert.equal(plain.score, newsRank({ outlets: 2, title: CF, publishedAt: at('2026-11-16T19:00:00Z'), firstSeenAt: NOW }));
});

test('trending: the highest number of any member, kept while the story lives, and no key for a story that never trended', () => {
  const [never] = merge([], [from('A', '2026-11-16T19:00:00Z')]);
  assert.ok(!('trending' in never));
  const [one] = merge([], [from('A', '2026-11-16T19:00:00Z', { trending: 2000 }), from('B', '2026-11-16T19:10:00Z', { trending: 50000 }), from('C', '2026-11-16T19:20:00Z')]);
  assert.equal(one.trending, 50000, 'the highest');
  assert.equal(one.outlets, 3);
  // the trend is gone from the feed: the stored story keeps it
  const kept = merge([one], [from('D', '2026-11-16T21:00:00Z')], NOW + 3600e3);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].trending, 50000);
  assert.equal(merge(kept, [], NOW + 7200e3)[0].trending, 50000, 'and through a run with nothing new');
  // a smaller number later does not lower it, a bigger one raises it
  assert.equal(merge(kept, [from('E', '2026-11-16T21:30:00Z', { trending: 500 })], NOW + 3600e3)[0].trending, 50000);
  assert.equal(merge(kept, [from('E', '2026-11-16T21:30:00Z', { trending: 200000 })], NOW + 3600e3)[0].trending, 200000);
  // a story that never trended is not given a key by a neighbour
  const [other] = merge([one], [newsItem({ title: 'Rolling blackouts hit the regional grid', cat: 'grid', source: 'B', url: 'https://b.example/1' })], NOW + 3600e3).filter((s) => s.cat === 'grid');
  assert.ok(!('trending' in other));
  // only a real number counts
  for (const bad of [0, -5, NaN, '50000', null, undefined, Infinity]) {
    const [s] = merge([], [from('A', '2026-11-16T19:00:00Z', { trending: bad })]);
    assert.ok(!('trending' in s), String(bad));
  }
  const stored50k = stored(CF, { cat: 'internet', trending: 50000 });
  assert.equal(merge([stored50k], [], NOW)[0].trending, 50000);
  assert.ok(!('trending' in merge([stored(CF, { cat: 'internet', trending: 0 })], [], NOW)[0]), 'a stored zero is no number');
});

test('trendTerm: the Google search a trend story came from is kept with it, the stored one first, and a story that did not come from a trend has no key', () => {
  const [plain] = merge([], [from('A', '2026-11-16T19:00:00Z')]);
  assert.ok(!('trendTerm' in plain));
  const [one] = merge([], [from('A', '2026-11-16T19:00:00Z', { trendTerm: 'cloudflare outage', trending: 2000 })]);
  assert.equal(one.trendTerm, 'cloudflare outage');
  assert.equal(one.trending, 2000);
  // the stored story keeps it when the trend is gone, and through a run with nothing new
  assert.equal(merge([one], [], NOW + 3600e3)[0].trendTerm, 'cloudflare outage');
  assert.equal(merge([one], [from('B', '2026-11-16T21:00:00Z')], NOW + 3600e3)[0].trendTerm, 'cloudflare outage', 'a plain neighbour does not take it away');
  // two searches for the same story: the stored one stays, else the first in alphabetical order, so feed order changes nothing
  assert.equal(merge([one], [from('B', '2026-11-16T21:00:00Z', { trendTerm: 'a different search' })], NOW + 3600e3)[0].trendTerm, 'cloudflare outage');
  const a = from('A', '2026-11-16T19:00:00Z', { trendTerm: 'zeta' });
  const b = from('B', '2026-11-16T19:10:00Z', { trendTerm: 'alpha' });
  assert.equal(merge([], [a, b])[0].trendTerm, 'alpha');
  assert.equal(merge([], [b, a])[0].trendTerm, 'alpha');
  // a neighbour that never trended is not given one
  const [other] = merge([one], [newsItem({ title: 'Rolling blackouts hit the regional grid', cat: 'grid', source: 'B', url: 'https://b.example/1' })], NOW + 3600e3).filter((s) => s.cat === 'grid');
  assert.ok(!('trendTerm' in other));
  // only a non-empty string counts
  for (const bad of ['', 0, 5, null, undefined, {}, ['x']]) {
    const [s] = merge([], [from('A', '2026-11-16T19:00:00Z', { trendTerm: bad })]);
    assert.ok(!('trendTerm' in s), String(bad));
    assert.ok(!('trendTerm' in merge([stored(CF, { cat: 'internet', trendTerm: bad })], [], NOW)[0]), `stored ${String(bad)}`);
  }
});

// ---- boilerplate: wording that many headlines share does not join them -----------------------------------------------

const BOILER = [/^residents report widespread problems with\b/i, /\s+since (?:early )?this morning\b/i];
const ROBLOX = 'Residents report widespread problems with Roblox since this morning';
const DISCORD = 'Residents report widespread problems with Discord since this morning';
const mergeWith = (existing, fresh, boilerplate) => mergeStories(existing, fresh, { now: NOW, boilerplate });
const two = (a, b) => [
  newsItem({ title: a, source: 'Pub A', url: 'https://pub-a.example/1' }),
  newsItem({ title: b, source: 'Pub B', url: 'https://pub-b.example/2' }),
];

test('boilerplate: headlines that share only the same sentence are one story until the sentence is cut out, and the cut changes nothing else', () => {
  assert.equal(mergeWith([], two(ROBLOX, DISCORD), undefined).length, 1, 'with no list they join on the six words they share');
  assert.equal(mergeWith([], two(ROBLOX, DISCORD), []).length, 1);
  const out = mergeWith([], two(ROBLOX, DISCORD), BOILER);
  assert.equal(out.length, 2, 'with the list each is its own story');
  assert.deepEqual(out.map((s) => s.title).sort(), [DISCORD, ROBLOX], 'the headline shown is whole');
  assert.deepEqual(out.map((s) => s.url).sort(), ['https://pub-a.example/1', 'https://pub-b.example/2']);
  assert.deepEqual(out.map((s) => s.id).sort(), [storyId(titleKey(DISCORD)), storyId(titleKey(ROBLOX))].sort(), 'the id still comes from the whole headline');
  assert.equal(merge([], two(ROBLOX, DISCORD)).length, 1, 'the merge helper above passes no list, as before');
});

test('boilerplate: the title key and the link still join headlines, cut or not', () => {
  const sameTitle = mergeWith([], two(ROBLOX, ROBLOX), BOILER);
  assert.equal(sameTitle.length, 1, 'the same headline from two outlets');
  assert.equal(sameTitle[0].outlets, 2);
  const sameLink = mergeWith([], [
    newsItem({ title: ROBLOX, source: 'Pub A', url: 'https://pub.example/a?utm_source=x' }),
    newsItem({ title: DISCORD, source: 'Pub B', url: 'https://pub.example/a' }),
  ], BOILER);
  assert.equal(sameLink.length, 1, 'the same link');
});

test('boilerplate: a stored story is cut the same way, so it takes in no new headline that shares only the sentence', () => {
  const [storedRoblox] = mergeWith([], [two(ROBLOX, DISCORD)[0]], BOILER);
  assert.equal(mergeWith([storedRoblox], [two(ROBLOX, DISCORD)[1]], undefined).length, 1, 'without the list the stored story takes it in');
  const next = mergeWith([storedRoblox], [two(ROBLOX, DISCORD)[1]], BOILER);
  assert.equal(next.length, 2);
  assert.ok(next.some((s) => s.id === storedRoblox.id && s.outlets === 1), 'the stored story is as it was');
  // two stored stories are compared with each other too
  const [storedDiscord] = mergeWith([], [two(ROBLOX, DISCORD)[1]], BOILER);
  assert.equal(mergeWith([storedRoblox, storedDiscord], [], undefined).length, 1);
  assert.equal(mergeWith([storedRoblox, storedDiscord], [], BOILER).length, 2);
});

test('boilerplate: what is left after the cut still joins near-verbatim rewrites, and the patterns may carry any flags', () => {
  const a = 'Residents report widespread problems with Roblox, Discord and Fortnite since this morning, officials say';
  const b = 'Residents report widespread problems with Discord, Roblox and Fortnite since this morning, officials said';
  for (const list of [BOILER, [/^residents report widespread problems with\b/gi, /\s+since this morning\b/g]]) {
    assert.equal(mergeWith([], two(a, b), list).length, 1);
  }
});

test('compileBoilerplate: cuts every match without fusing the words around it, and a list that is missing or holds something else cuts nothing', () => {
  const cut = compileBoilerplate([/\bfoo\b/i, /\bbar\b/]);
  const words = (title) => cut(title).split(/\s+/).filter(Boolean);
  assert.deepEqual(words('foo one Foo two bar three'), ['one', 'two', 'three']);
  assert.deepEqual(words('one-foo-two'), ['one-', '-two'], 'what is left is not joined into a new word');
  assert.equal(cut('nothing to cut'), 'nothing to cut');
  assert.equal(cut(null), '');
  assert.equal(cut('foo one foo'), cut('foo one foo'), 'a pattern keeps no position between calls');
  for (const none of [undefined, null, [], 'foo', {}, ['foo', 5, null]]) assert.equal(compileBoilerplate(none)('foo bar'), 'foo bar', String(none));
});
