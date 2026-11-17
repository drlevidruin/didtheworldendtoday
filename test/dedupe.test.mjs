import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeStories, selectForDay, storyId } from '../scripts/lib/cluster.mjs';
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
