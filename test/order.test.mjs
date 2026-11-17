import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../scripts/config.mjs';
import { receiptsOrder } from '../scripts/lib/order.mjs';
import { runUpdate } from '../scripts/update.mjs';
import { fakeSource, newsItem, tmpRoot } from './helpers.mjs';

const cfg = config();
const VARIETY = cfg.variety;

// A ranked list: n stories per category, listed best first the way rank would.
function ranked(plan) {
  const out = [];
  let rank = 100;
  for (const [cat, n] of plan) for (let i = 0; i < n; i += 1) out.push({ id: `${cat}-${i}`, cat, score: rank-- });
  return out.sort((a, b) => b.score - a.score);
}
const countIn = (list, cat, n) => list.slice(0, n).filter((s) => s.cat === cat).length;

test('the variety rule is the one in the brief: 3 of the first 12, 6 of the first 30', () => {
  assert.deepEqual(VARIETY, { first: 12, firstMax: 3, second: 30, secondMax: 6 });
});

test('19 markets and 18 hacks stories cannot fill the first screen', () => {
  const plan = [['markets', 19], ['hacks', 18], ['internet', 8], ['grid', 6], ['flights', 5], ['space', 4], ['earth', 4]];
  const list = ranked(plan);
  const out = receiptsOrder(list);
  for (const [cat] of plan) {
    assert.ok(countIn(out, cat, 12) <= 3, `${cat} in the first 12`);
    assert.ok(countIn(out, cat, 13) <= 3, `${cat} in the first 13 (the lead plus 12 receipts)`);
    assert.ok(countIn(out, cat, 30) <= 6, `${cat} in the first 30`);
    assert.ok(countIn(out, cat, 31) <= 6, `${cat} in the first 31`);
  }
  assert.equal(out.length, list.length);
});

test('nothing is lost or repeated, and the input is left alone', () => {
  const list = ranked([['markets', 19], ['hacks', 18], ['internet', 4]]);
  const before = list.map((s) => s.id);
  const out = receiptsOrder(list);
  assert.deepEqual(list.map((s) => s.id), before);
  assert.deepEqual([...out.map((s) => s.id)].sort(), [...before].sort());
});

test('inside a category the stories stay in rank order, and the best story leads', () => {
  const list = ranked([['markets', 19], ['hacks', 18], ['internet', 4]]);
  const out = receiptsOrder(list);
  assert.equal(out[0].id, list[0].id);
  for (const cat of ['markets', 'hacks', 'internet']) {
    const scores = out.filter((s) => s.cat === cat).map((s) => s.score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a), `${cat} keeps its rank order`);
  }
});

test('a held-back story lands as soon as its category has room, in rank order', () => {
  const list = ['A1', 'A2', 'A3', 'B1', 'B2', 'C1'].map((id, i) => ({ id, cat: id[0], score: 10 - i }));
  const out = receiptsOrder(list, { first: 1, firstMax: 1, second: 3, secondMax: 2 });
  assert.deepEqual(out.map((s) => s.id), ['A1', 'B1', 'A2', 'B2', 'A3', 'C1']);
});

test('when too few categories exist to meet the rule, the top stays as mixed as it can be', () => {
  const list = ranked([['markets', 19], ['hacks', 18], ['internet', 4], ['grid', 3], ['flights', 2]]);
  const out = receiptsOrder(list);
  assert.equal(out.length, 46);
  // The rule holds for as long as there is anything else to show (21 places) ...
  for (const [cat, max] of [['markets', 6], ['hacks', 6], ['internet', 4], ['grid', 3], ['flights', 2]]) assert.ok(countIn(out, cat, 21) <= max, cat);
  // ... then the two big ones share what is left evenly.
  assert.ok(Math.abs(countIn(out, 'markets', 31) - countIn(out, 'hacks', 31)) <= 1);
});

test('when only one category is left the cap gives way instead of dropping stories', () => {
  const list = ranked([['markets', 10]]);
  const out = receiptsOrder(list);
  assert.deepEqual(out.map((s) => s.id), list.map((s) => s.id), 'ten markets stories stay in rank order');
});

test('a list that already has variety is left exactly as it was', () => {
  const list = ranked([['markets', 3], ['hacks', 3], ['internet', 3], ['grid', 3]]);
  const interleaved = [0, 1, 2].flatMap((i) => ['markets', 'hacks', 'internet', 'grid'].map((c) => list.find((s) => s.id === `${c}-${i}`)));
  const out = receiptsOrder(interleaved);
  assert.deepEqual(out.map((s) => s.id), interleaved.map((s) => s.id));
});

test('empty and odd input give an empty list', () => {
  assert.deepEqual(receiptsOrder([]), []);
  assert.deepEqual(receiptsOrder(null), []);
  assert.deepEqual(receiptsOrder(undefined), []);
});

test('a custom rule works the same way', () => {
  const list = ranked([['markets', 6], ['hacks', 6], ['internet', 6], ['grid', 6]]);
  const out = receiptsOrder(list, { first: 3, firstMax: 1, second: 6, secondMax: 2 });
  for (const cat of ['markets', 'hacks', 'internet', 'grid']) {
    assert.ok(countIn(out, cat, 4) <= 1, `${cat} in the first 4`);
    assert.ok(countIn(out, cat, 7) <= 2, `${cat} in the first 7`);
  }
});

test('the stored list is written in listing order, and the per-category counts still count every story', async () => {
  const root = tmpRoot();
  const T = {
    flights: ['Flights grounded at Newark after system glitch', 'Southwest flights delayed by a major IT outage', 'Airlines recover after nationwide FAA ground stop'],
    hacks: ['Hackers breach customer database at retailer', 'Data breach exposes millions of customer records', 'Ransomware attack takes city systems offline'],
    internet: ['Cloudflare outage knocks thousands of sites offline', 'Major AWS outage disrupts popular apps', 'Slack is down for users across the US'],
    grid: ['Rolling blackouts hit regional grid as demand spikes', 'Power outage leaves 50,000 customers in the dark', 'Blackout hits city after substation failure'],
    markets: ['Stocks plunge in sudden flash crash', 'Trading halted as Nasdaq selloff deepens', 'Bitcoin crashes below 60,000 in wild swing'],
  };
  const items = Object.entries(T).flatMap(([cat, titles], c) =>
    titles.map((title, i) => newsItem({ cat, title, source: `Pub ${i}`, url: `https://pub${i}.example/${cat}/${i}`, publishedAt: Date.parse('2026-11-16T14:00:00Z') - (c * 3 + i) * 60e3 })),
  );
  const tight = { ...cfg, variety: { first: 4, firstMax: 1, second: 9, secondMax: 2 } };
  const { latest } = await runUpdate({ root, now: '2026-11-16T15:00:00Z', env: {}, config: tight, sources: [fakeSource('google', { count: items.length, items })] });
  assert.equal(latest.stories.length, 15);
  for (const cat of Object.keys(T)) {
    assert.ok(countIn(latest.stories, cat, 5) <= 1, `${cat} in the first 5`);
    assert.ok(countIn(latest.stories, cat, 10) <= 2, `${cat} in the first 10`);
    assert.equal(latest.cats[cat], 3, 'the count for a category includes all of its stories');
  }
});
