import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeStories, selectForDay, storyId, uniqueIds } from '../scripts/lib/cluster.mjs';
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
