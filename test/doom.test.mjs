import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../scripts/config.mjs';
import { computeDoom } from '../scripts/lib/doom.mjs';

const cfg = config();
const run = (stories) => computeDoom(stories, { categories: cfg.categories, doom: cfg.doom });
const news = (cat, source, n = 0) => ({ id: `${cat}-${source}-${n}`, kind: 'news', cat, title: `${cat} ${source} ${n}`, source, outletNames: [source] });
const sig = (cat, signal) => ({ id: `sig-${signal.type}`, kind: 'signal', cat, title: signal.type, source: 'x', outletNames: ['x'], signal });
const three = (cat) => [news(cat, 'A'), news(cat, 'B'), news(cat, 'C')];

test('a quiet day scores the floor of 11', () => {
  const d = run([]);
  assert.equal(d.score, 11);
  assert.deepEqual(d.fired, []);
});

test('a category fires with 3 distinct publishers, not 2, not the same one three times', () => {
  assert.deepEqual(run([news('grid', 'A'), news('grid', 'B')]).fired, []);
  assert.deepEqual(run([news('grid', 'A', 1), news('grid', 'A', 2), news('grid', 'A', 3)]).fired, []);
  assert.deepEqual(run(three('grid')).fired, ['grid']);
});

test('one story that many outlets ran counts each distinct outlet', () => {
  const s = { id: 'x', kind: 'news', cat: 'grid', title: 't', source: 'A', outletNames: ['A', 'B', 'C on MSN'] };
  assert.deepEqual(run([s]).fired, ['grid']);
});

test('score is 6 per fired category plus the fixed bumps', () => {
  const stories = [...three('grid'), ...three('germs'), ...three('animals'), ...three('markets'), ...three('ai'), ...three('weather')];
  const d = run(stories);
  assert.equal(d.fired.length, 6);
  assert.equal(d.score, 36);
});

test('instruments fire their category by themselves and add their bump', () => {
  const cases = [
    [sig('sun', { type: 'kp', kp: 5 }), 'sun', 6 + 5],
    [sig('sun', { type: 'kp', kp: 7.3 }), 'sun', 6 + 12],
    [sig('sun', { type: 'flare', cls: 'X1.2' }), 'sun', 6],
    [sig('earth', { type: 'quake', mag: 6.1 }), 'earth', 6 + 5],
    [sig('earth', { type: 'quake', mag: 7.2 }), 'earth', 6 + 12],
    [sig('space', { type: 'asteroid', ld: 0.8 }), 'space', 6 + 8],
    [sig('space', { type: 'asteroid', ld: 0.3 }), 'space', 6 + 15],
    [sig('flights', { type: 'faa-ground-stop', airport: 'BNA', hub: false }), 'flights', 6],
    [sig('flights', { type: 'faa-ground-stop', airport: 'ATL', hub: true }), 'flights', 6 + 6],
    [sig('flights', { type: 'faa-ground-stop', airport: 'ATL', hub: true, nationwide: true }), 'flights', 6 + 20],
    [sig('internet', { type: 'status', indicator: 'major' }), 'internet', 6 + 8],
    [sig('internet', { type: 'status', indicator: 'critical' }), 'internet', 6 + 8],
  ];
  for (const [story, cat, expected] of cases) {
    const d = run([story]);
    assert.deepEqual(d.fired, [cat], JSON.stringify(story.signal));
    assert.equal(d.total, expected, JSON.stringify(story.signal));
    assert.equal(d.score, Math.max(11, expected), JSON.stringify(story.signal));
  }
});

test('instruments below their thresholds do not fire anything', () => {
  for (const s of [
    sig('sun', { type: 'kp', kp: 4.67 }),
    sig('earth', { type: 'quake', mag: 5.9 }),
    sig('space', { type: 'asteroid', ld: 1.4 }),
    sig('internet', { type: 'status', indicator: 'minor' }),
  ]) {
    assert.deepEqual(run([s]).fired, [], JSON.stringify(s.signal));
  }
});

test('the score is always a whole number from 11 to 99, never 100', () => {
  const everything = [
    ...cfg.categories.flatMap((c) => three(c.id)),
    sig('sun', { type: 'kp', kp: 9 }),
    sig('earth', { type: 'quake', mag: 8.8 }),
    sig('space', { type: 'asteroid', ld: 0.05 }),
    sig('flights', { type: 'faa-ground-stop', hub: true, nationwide: true }),
    sig('internet', { type: 'status', indicator: 'critical' }),
  ];
  const d = run(everything);
  assert.equal(d.fired.length, 12);
  assert.ok(d.total > 99);
  assert.equal(d.score, 99);
});

test('bounds hold for 500 random days', () => {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 500; i += 1) {
    const stories = [];
    for (const c of cfg.categories) {
      const n = Math.floor(rnd() * 6);
      for (let k = 0; k < n; k += 1) stories.push(news(c.id, `P${Math.floor(rnd() * 5)}`, k));
    }
    if (rnd() > 0.5) stories.push(sig('sun', { type: 'kp', kp: rnd() * 9 }));
    if (rnd() > 0.5) stories.push(sig('earth', { type: 'quake', mag: 5 + rnd() * 4 }));
    if (rnd() > 0.5) stories.push(sig('space', { type: 'asteroid', ld: rnd() * 3 }));
    const { score } = run(stories);
    assert.ok(Number.isInteger(score) && score >= 11 && score <= 99, `score ${score}`);
  }
});

test('the same stories always give the same score', () => {
  const stories = [...three('grid'), sig('earth', { type: 'quake', mag: 6.4 })];
  assert.deepEqual(run(stories), run([...stories].reverse()));
});
