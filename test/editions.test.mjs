// Editions: what each day says about itself. One check (validateEdition) decides
// whether an edition can be used, a day without one shows plain headlines, and a
// story is told once across days. Offline, on made-up stories.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { config, EDITION } from '../scripts/config.mjs';
import { createGatekeeper } from '../scripts/lib/pipeline.mjs';
import {
  STILL_HERE,
  badText,
  dedupeById,
  editionFile,
  fallbackRows,
  idsHash,
  listEditionDates,
  listingOrder,
  onePerId,
  publishableStories,
  quietLinkFor,
  readEditions,
  resolveDays,
  usedIdsBefore,
  validateEdition,
} from '../scripts/lib/editions.mjs';
import { QUIET_LINE, subline } from '../scripts/templates/copy.mjs';
import { fixtureJson, REPO, tmpRoot } from './helpers.mjs';

const cfg = config();
const { excluder } = createGatekeeper(cfg);
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const emojiByCat = new Map(cfg.categories.map((c) => [c.id, c.emoji]));
const TODAY = '2026-11-17';

// ---- made-up stories and editions ----------------------------------------------------------

const story = (id, over = {}) => ({
  id,
  kind: 'news',
  cat: 'internet',
  title: `Cloudflare outage number ${id} knocks sites offline`,
  url: `https://pub.example/${id}`,
  source: 'Pub A',
  publishedAt: '2026-11-17T12:00:00.000Z',
  firstSeenAt: '2026-11-17T12:00:00.000Z',
  outlets: 3,
  outletNames: ['Pub A', 'Pub B', 'Pub C'],
  score: 50,
  ...over,
});

const item = (id, over = {}) => ({
  emoji: '\u{1F5A5}️',
  label: 'Service outage',
  line: `A service went down for an hour and came back. Story ${id}.`,
  ids: [id],
  quiet: false,
  cat: 'internet',
  title: `Cloudflare outage number ${id} knocks sites offline`,
  url: `https://pub.example/${id}`,
  source: 'Pub A',
  outlets: 3,
  ...over,
});

// One plain sentence, then "Still here.": what every edition in these tests says unless a test says otherwise.
const HEADLINE = 'Banks went dark for an hour in three states. Still here.';

const edition = (date, ids, over = {}) => ({
  date,
  by: 'editor',
  writtenAt: `${date}T15:00:00.000Z`,
  headline: HEADLINE,
  items: ids.map((id) => item(id)),
  ...over,
});

const byIdOf = (stories) => new Map(stories.map((s) => [s.id, s]));
const ctx = (over = {}) => ({ date: TODAY, used: new Set(), byId: new Map(), excluder, ...over });
const reasons = (result) => result.dropped.map((d) => d.reason);

// ---- the one check -----------------------------------------------------------------------

test('validation: a good edition passes, the first row is the closest call, and the keys are stored in a steady order', () => {
  const raw = edition(TODAY, ['a', 'b', 'c', 'd']);
  raw.items[2].best = true; // an item that claims to be best is not
  const r = validateEdition(raw, ctx());
  assert.equal(r.ok, true);
  assert.deepEqual(r.dropped, []);
  assert.equal(r.edition.date, TODAY);
  assert.equal(r.edition.by, 'editor');
  assert.equal(r.edition.headline, HEADLINE);
  assert.deepEqual(r.edition.items.map((i) => i.ids), [['a'], ['b'], ['c'], ['d']]);
  assert.deepEqual(r.edition.items.map((i) => Boolean(i.best)), [true, false, false, false], 'only the first row is the closest call');
  assert.deepEqual(Object.keys(r.edition.items[0]), ['emoji', 'line', 'ids', 'best', 'quiet', 'cat', 'title', 'url', 'source', 'outlets', 'label']);
  assert.deepEqual(Object.keys(r.edition.items[1]), ['emoji', 'line', 'ids', 'quiet', 'cat', 'title', 'url', 'source', 'outlets', 'label']);
  assert.equal(r.edition.items[0].label, 'Service outage');
  assert.equal(STILL_HERE, 'Still here.');
});

test('validation: the edition must be for the day it is checked for, and the input is never changed', () => {
  const raw = edition('2026-11-16', ['a', 'b', 'c']);
  const before = JSON.stringify(raw);
  const wrong = validateEdition(raw, ctx());
  assert.deepEqual([wrong.ok, wrong.reason], [false, 'wrong date']);
  assert.equal(JSON.stringify(raw), before, 'the input is untouched');
  const fine = validateEdition(raw, ctx({ date: '2026-11-16' }));
  assert.equal(fine.ok, true);
  assert.equal(JSON.stringify(raw), before, 'still untouched after a good run');
});

test('validation: anything that is not an edition fails with a reason and never throws', () => {
  for (const odd of [null, undefined, 'text', 42, [], [1, 2, 3], {}, { date: TODAY }, { date: TODAY, headline: 'Still here.', items: 'no' }, { date: TODAY, headline: 'Still here.', items: {} }]) {
    const r = validateEdition(odd, ctx());
    assert.equal(r.ok, false, JSON.stringify(odd));
    assert.equal(typeof r.reason, 'string');
  }
  // items that are not objects are dropped, the rest count
  const mixed = edition(TODAY, ['a', 'b', 'c']);
  mixed.items.push(null, 'text', 7, [], {});
  const r = validateEdition(mixed, ctx());
  assert.equal(r.ok, true);
  assert.equal(r.edition.items.length, 3);
  assert.equal(r.dropped.length, 5);
});

test('validation: the headline is one sentence and then "Still here.", up to 110 characters', () => {
  const run = (headline) => validateEdition(edition(TODAY, ['a', 'b', 'c'], { headline }), ctx());
  assert.equal(EDITION.headlineMax, 110);
  assert.equal(EDITION.lineMax, 110);
  assert.equal(run(HEADLINE).ok, true);
  assert.equal(run('An asteroid the size of a bus missed Earth at 2:59 AM ET. Still here.').ok, true);
  assert.equal(run('U.S. banks went dark for an hour in three states. Still here.').ok, true, 'U.S. does not end the first sentence');
  assert.equal(run('   Banks went dark for an hour in three states.   Still here.  ').edition.headline, HEADLINE, 'spaces are tidied');
  // exactly as long as the limit passes, one character more does not
  const sized = (n) => {
    const start = 'Banks went dark for an hour in';
    const end = '. Still here.';
    const room = n - start.length - end.length; // characters for the words in between
    return `${start}${' many'.repeat(Math.floor(room / 5))}${'s'.repeat(room % 5)}${end}`;
  };
  assert.equal(sized(EDITION.headlineMax).length, EDITION.headlineMax);
  assert.equal(run(sized(EDITION.headlineMax)).ok, true, 'at the limit');
  assert.equal(run(sized(EDITION.headlineMax + 1)).ok, false, 'one over');
  assert.equal(run(sized(170)).ok, false, 'the old limit is gone');
  for (const bad of [
    '',
    'Banks went dark for an hour in three states.',
    'Still here. Banks went dark for an hour in three states.',
    'Banks went dark for an hour in three states. Still here',
    'Still here.',
    `Banks went dark ${EM} for an hour in three states. Still here.`,
    `Banks went dark for an hour ${EN} in three states. Still here.`,
    'Banks went dark; planes were late in three states. Still here.',
    'Banks went dark for an hour in three states! Still here.',
    'Banks went undefined for an hour in three states. Still here.',
    'Trump says banks went dark for an hour in three states. Still here.',
  ]) {
    const r = run(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
  for (const odd of [undefined, null, 7, [], {}]) assert.equal(run(odd).ok, false, String(odd));
  assert.match(run('Banks went dark for an hour in three states.').reason, /Still here/);
  assert.match(run(`Banks went dark for an hour. ${'a'.repeat(200)}. Still here.`).reason, /length/);
});

test('validation: the text before "Still here." is at least 5 words, and the first sentence at least 4 and not the whole headline', () => {
  const run = (headline) => validateEdition(edition(TODAY, ['a', 'b', 'c'], { headline }), ctx());
  assert.equal(EDITION.headlineMinWords, 5);
  assert.equal(EDITION.firstSentenceMinWords, 4);
  // 5 words before "Still here." passes, 4 does not (phase 7's 8-word rule is gone)
  assert.equal(run('Banks went dark again today. Still here.').ok, true, '5 words');
  const four = run('Banks went dark again. Still here.');
  assert.equal(four.ok, false);
  assert.match(four.reason, /headline too short/);
  // a first sentence of 4 words passes, 3 does not, even when the whole headline is long enough
  assert.equal(run('Banks went dark again. Planes were late in three cities. Still here.').ok, true);
  const short = run('Banks went dark. Planes were late in three cities across the country. Still here.');
  assert.equal(short.ok, false);
  assert.match(short.reason, /first sentence too short/);
  // no sentence end at all before "Still here." means the first sentence is the whole headline
  const whole = run('Banks went dark for an hour in three states and Still here.');
  assert.equal(whole.ok, false);
  assert.match(whole.reason, /no sentence before/);
});

test('validation: an abbreviation we do not list cuts the first sentence short, and the headline fails', () => {
  const run = (headline) => validateEdition(edition(TODAY, ['a', 'b', 'c'], { headline }), ctx());
  // "Nov." is not on the list, so the sentence would end there: what follows starts with a number or a lowercase letter
  const number = run('Banks went dark on Nov. 17 for an hour. Still here.');
  assert.equal(number.ok, false);
  assert.match(number.reason, /cut short/);
  const lower = run('Banks went dark in Nov. and planes were late. Still here.');
  assert.equal(lower.ok, false);
  assert.match(lower.reason, /cut short/);
  // listed abbreviations and initials are fine, and so is a second real sentence that starts with a capital
  assert.equal(run('Gov. Healey says banks went dark for an hour. Still here.').ok, true);
  assert.equal(run('Banks went dark for an hour. Planes were late in three cities. Still here.').ok, true);
  assert.equal(run('Banks went dark for an hour. 3 planes were late. Still here.').ok, false, 'a digit after sentence one reads as a cut');
});

test('validation: a line with a dash, a semicolon, an exclamation mark or a stray token is dropped, and its neighbours stay', () => {
  const lines = {
    em: `Banks went down ${EM} then came back.`,
    en: `Banks went down ${EN} then came back.`,
    semicolon: 'Banks went down; then came back.',
    bang: 'Banks went down and came back!',
    undef: 'Banks went down and came back undefined.',
    nan: 'Banks went down NaN hours and came back.',
    object: 'Banks went down [object Object] and came back.',
    js: 'Banks went down. See javascript:alert(1) for more.',
    long: 'a'.repeat(EDITION.lineMax + 1),
    empty: '   ',
  };
  const items = [item('ok1'), item('ok2'), item('ok3'), ...Object.entries(lines).map(([k, line]) => item(`bad-${k}`, { line }))];
  const r = validateEdition(edition(TODAY, [], { items }), ctx());
  assert.equal(r.ok, true);
  assert.deepEqual(r.edition.items.map((i) => i.ids[0]), ['ok1', 'ok2', 'ok3']);
  assert.equal(r.dropped.length, Object.keys(lines).length, 'every bad line is named in dropped');
  for (const d of r.dropped) assert.equal(typeof d.reason, 'string');
  assert.match(reasons(r)[0], /em dash/);
  assert.match(reasons(r)[1], /en dash/);
  assert.match(reasons(r)[2], /semicolon/);
  assert.match(reasons(r)[3], /exclamation/);
  assert.equal(badText('A plain line.'), null);
  assert.equal(badText('A "quoted" line, with commas: and a colon.'), null);
});

test('validation: a label is 1 to 4 words with no period, and a missing or bad one keeps the row and is listed with the dropped reasons', () => {
  assert.equal(EDITION.labelMax, 32);
  assert.equal(EDITION.labelMaxWords, 4);
  const run = (label) => validateEdition(edition(TODAY, [], { items: [item('a', { label }), item('b'), item('c')] }), ctx());
  // good labels are kept, with their spaces tidied
  for (const [label, kept] of [
    ['FAA outage', 'FAA outage'],
    ['Asteroid 2026 WA', 'Asteroid 2026 WA'],
    ['Nvidia', 'Nvidia'],
    ['  Outlook   outage  ', 'Outlook outage'],
    ['Aaaaaaaa Aaaaaaaa Aaaaaaaa Aaaaa', 'Aaaaaaaa Aaaaaaaa Aaaaaaaa Aaaaa'], // 4 words and exactly 32 characters
  ]) {
    const r = run(label);
    assert.equal(r.ok, true, label);
    assert.equal(r.edition.items[0].label, kept);
    assert.deepEqual(r.dropped, [], label);
  }
  // 5 words, a period, too many characters, a dash, a semicolon, an exclamation mark, an excluded topic, and nothing at all:
  // the row stays without a label, and the reason is listed
  for (const [label, why] of [
    ['One two three four five', /more than 4 words/],
    ['FAA outage.', /period/],
    ['Aaaaaaaa Aaaaaaaa Aaaaaaaa Aaaaaa', /too long/],
    [`FAA ${EM} outage`, /em dash/],
    ['FAA; outage', /semicolon/],
    ['FAA outage!', /exclamation/],
    ['Trump outage', /excluded/],
    ['', /missing/],
    ['   ', /missing/],
    [undefined, /missing/],
    [null, /missing/],
    [7, /missing/],
  ]) {
    const r = run(label);
    assert.equal(r.ok, true, `${String(label)}: the row stays`);
    assert.deepEqual(r.edition.items.map((i) => i.ids[0]), ['a', 'b', 'c']);
    assert.equal(r.edition.items[0].label, '', `${String(label)}: no label`);
    assert.equal(r.edition.items[0].line, item('a').line, 'the line is untouched');
    assert.equal(r.dropped.length, 1);
    assert.equal(r.dropped[0].index, 0);
    assert.equal(r.dropped[0].kept, true, 'listed, but the row is kept');
    assert.match(r.dropped[0].reason, why, String(label));
  }
  // rows without labels still count toward the 3 an edition needs
  const bare = validateEdition(edition(TODAY, [], { items: ['a', 'b', 'c'].map((id) => item(id, { label: undefined })) }), ctx());
  assert.equal(bare.ok, true);
  assert.deepEqual(bare.edition.items.map((i) => i.label), ['', '', '']);
  assert.equal(bare.dropped.length, 3);
});

test('validation: a line on an excluded topic is dropped, in the line or in the story it points at', () => {
  const items = [
    item('ok1'),
    item('ok2'),
    item('ok3'),
    item('bad1', { line: 'Congress says the outage was fixed in an hour.' }),
    item('bad2', { line: 'A gunman killed two people at the airport.' }),
    item('bad3', { title: 'Trump outage report', line: 'A service went down for an hour.' }),
  ];
  const r = validateEdition(edition(TODAY, [], { items }), ctx());
  assert.equal(r.ok, true);
  assert.deepEqual(r.edition.items.map((i) => i.ids[0]), ['ok1', 'ok2', 'ok3']);
  assert.equal(r.dropped.length, 3);
  for (const reason of reasons(r)) assert.match(reason, /^excluded: /);
});

test('validation: an item needs an emoji of a sensible size, at least one id and an https link', () => {
  const items = [
    item('ok1'),
    item('ok2'),
    item('ok3'),
    item('bad-emoji-empty', { emoji: '' }),
    item('bad-emoji-long', { emoji: 'x'.repeat(EDITION.emojiMax + 1) }),
    item('bad-emoji-type', { emoji: 7 }),
    item('x', { ids: [] }),
    item('x', { ids: [' ', 7, null] }),
    item('x', { ids: 'x' }),
    item('bad-http', { url: 'http://pub.example/bad-http' }),
    item('bad-js', { url: 'javascript:alert(1)' }),
    item('bad-no-url', { url: undefined }),
    item('bad-ftp', { url: 'ftp://pub.example/x' }),
    item('bad-login', { url: 'https://user:pass@pub.example/x' }),
  ];
  const r = validateEdition(edition(TODAY, [], { items }), ctx());
  assert.equal(r.ok, true);
  assert.deepEqual(r.edition.items.map((i) => i.ids[0]), ['ok1', 'ok2', 'ok3']);
  assert.equal(r.dropped.length, items.length - 3);
});

test('validation: fewer than 3 usable items fails, 3 passes, 10 pass, and an eleventh is cut', () => {
  assert.equal(EDITION.minItems, 3);
  assert.equal(EDITION.maxItems, 10);
  const two = validateEdition(edition(TODAY, ['a', 'b']), ctx());
  assert.deepEqual([two.ok, two.reason], [false, 'only 2 usable items']);
  assert.equal(validateEdition(edition(TODAY, ['a']), ctx()).reason, 'only 1 usable item');
  assert.equal(validateEdition(edition(TODAY, []), ctx()).reason, 'only 0 usable items');
  const bad = [item('a'), item('b'), item('c', { line: `bad ${EM} line` })];
  assert.equal(validateEdition(edition(TODAY, [], { items: bad }), ctx()).ok, false, 'two good items and one bad one is two');
  assert.equal(validateEdition(edition(TODAY, ['a', 'b', 'c']), ctx()).ok, true);
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'];
  const ten = validateEdition(edition(TODAY, ids.slice(0, 10)), ctx());
  assert.equal(ten.ok, true, 'an edition of 10 items passes');
  assert.deepEqual(ten.edition.items.map((i) => i.ids[0]), ids.slice(0, 10));
  const eleven = validateEdition(edition(TODAY, ids), ctx());
  assert.equal(eleven.ok, true);
  assert.deepEqual(eleven.edition.items.map((i) => i.ids[0]), ids.slice(0, 10), 'an eleventh is cut, the closest ten stay in order');
});

test('validation: an item whose first id an earlier day used is dropped whole, a later id that was told is left out, and a story shows once a day', () => {
  const used = new Set(['old1', 'old2']);
  const items = [
    item('a', { ids: ['old1', 'a', 'a2'] }), // its first id was told on an earlier day: the item goes, it does not move on to 'a'
    item('b', { ids: ['old2'] }), // told on an earlier day: dropped
    item('g', { ids: ['g', 'old1', 'g2'] }), // a later id that was told is just left out
    item('c', { ids: ['g'] }), // a row before it already took this id: dropped
    item('h', { ids: ['g', 'h'] }), // its first id is in an earlier row: dropped whole, it does not move on to 'h'
    item('d'),
    item('e', { ids: ['e', 'e', 'e2'] }), // repeated ids are one
    item('f'),
  ];
  const r = validateEdition(edition(TODAY, [], { items }), ctx({ used }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.edition.items.map((i) => i.ids), [['g', 'g2'], ['d'], ['e', 'e2'], ['f']]);
  assert.deepEqual(reasons(r), ['first id already used', 'first id already used', 'first id already in an earlier row', 'first id already in an earlier row']);
  assert.deepEqual(r.edition.items.map((i) => i.url), ['g', 'd', 'e', 'f'].map((id) => `https://pub.example/${id}`), 'every kept line still points at its own story');
  assert.deepEqual([...used].sort(), ['old1', 'old2'], 'the set it was given is not changed');
});

test('validation: the emoji has to be an emoji, so "LOL" is dropped and real ones are kept in every form', () => {
  const good = ['\u2708\uFE0F', '\u{1F9F3}', '\u2604\uFE0F', '\u{1F3E6}', '\u{1F469}\u200D\u{1F680}', '\u{1F44D}\u{1F3FD}', '\u{1F5A5}\uFE0F\u{1F4C9}'];
  for (const emoji of good) {
    const r = validateEdition(edition(TODAY, [], { items: [item('a', { emoji }), item('b'), item('c')] }), ctx());
    assert.equal(r.ok, true, emoji);
    assert.equal(r.edition.items[0].emoji, emoji);
    assert.deepEqual(r.dropped, [], emoji);
  }
  for (const emoji of ['LOL', 'lol', 'ok', '123', '!!', 'x', '...', ' LOL ']) {
    const r = validateEdition(edition(TODAY, [], { items: [item('x', { emoji }), item('a'), item('b'), item('c')] }), ctx());
    assert.equal(r.ok, true, emoji);
    assert.deepEqual(r.edition.items.map((i) => i.ids[0]), ['a', 'b', 'c'], `${emoji} is dropped`);
    assert.deepEqual(reasons(r), ['not an emoji'], emoji);
  }
  // with only two real ones left the edition fails, so a model that writes words for emoji gets nothing through
  const words = validateEdition(edition(TODAY, [], { items: ['LOL', 'OMG', 'WOW'].map((emoji, i) => item(`w${i}`, { emoji })) }), ctx());
  assert.deepEqual([words.ok, words.reason], [false, 'only 0 usable items']);
});

test('validation: a quiet story stays quiet whatever the edition says, and a quiet flag from the edition is kept', () => {
  const quake = story('sig:quake:q1', { cat: 'earth', kind: 'signal', title: 'M 6.8 - 20 km S of Somewhere', source: 'USGS', quiet: true, signal: { type: 'quake', mag: 6.8, place: '20 km S of Somewhere, Chile', pager: 'orange', tsunami: false } });
  const items = [item('a'), item('sig:quake:q1', { quiet: false, cat: 'earth', title: quake.title }), item('b', { quiet: true }), item('c')];
  const r = validateEdition(edition(TODAY, [], { items }), ctx({ byId: byIdOf([quake]) }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.edition.items.map((i) => i.quiet), [false, true, true, false]);
});

test('validation: the used ids of one day are the edition ids of every day before it', () => {
  const editions = new Map([
    ['2026-11-15', edition('2026-11-15', ['a', 'b', 'c'])],
    ['2026-11-16', edition('2026-11-16', ['d', 'e', 'f'])],
    ['2026-11-17', edition('2026-11-17', ['g', 'h', 'i'])],
  ]);
  const ids = (set) => [...set].sort();
  assert.deepEqual(ids(usedIdsBefore({ days: [], editions, excluder, date: '2026-11-15' })), []);
  assert.deepEqual(ids(usedIdsBefore({ days: [], editions, excluder, date: '2026-11-16' })), ['a', 'b', 'c']);
  assert.deepEqual(ids(usedIdsBefore({ days: [], editions, excluder, date: '2026-11-17' })), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(ids(usedIdsBefore({ days: [], editions, excluder, date: '2026-11-18' })), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
  // an edition that fails its checks tells nothing, so its ids stay free
  editions.set('2026-11-16', edition('2026-11-16', ['d', 'e', 'f'], { headline: 'No ending here' }));
  assert.deepEqual(ids(usedIdsBefore({ days: [], editions, excluder, date: '2026-11-17' })), ['a', 'b', 'c']);
  // and a later edition never takes ids from an earlier one
  editions.set('2026-11-16', edition('2026-11-16', ['a', 'e', 'f', 'g']));
  const second = validateEdition(editions.get('2026-11-16'), ctx({ date: '2026-11-16', used: usedIdsBefore({ days: [], editions, excluder, date: '2026-11-16' }) }));
  assert.deepEqual(second.edition.items.map((i) => i.ids), [['e'], ['f'], ['g']], 'a was told on the 15th');
});

// ---- the plain fallback ---------------------------------------------------------------------

test('fallback: up to 5 stories in the order given, the category emoji, the headline as the line, no jokes', () => {
  assert.equal(EDITION.fallbackRows, 5);
  assert.equal(EDITION.fallbackPerCategory, 2);
  const cats = ['flights', 'hacks', 'internet', 'markets', 'space', 'grid', 'weather'];
  const stories = cats.map((cat, i) => story(`s${i}`, { cat, title: `  A   plain headline   ${i} about ${cat}  ` }));
  const rows = fallbackRows({ stories, emojiByCat });
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.ids[0]), ['s0', 's1', 's2', 's3', 's4']);
  assert.deepEqual(rows.map((r) => r.emoji), cats.slice(0, 5).map((c) => emojiByCat.get(c)));
  rows.forEach((r, i) => {
    assert.equal(r.line, `A plain headline ${i} about ${cats[i]}`, 'the cleaned headline');
    assert.equal(r.line, r.title, 'no joke: the line is the headline');
    assert.equal(r.label, '', 'no label: the page shows the headline in its place');
    assert.equal(r.url, `https://pub.example/s${i}`);
    assert.equal(r.source, 'Pub A');
    assert.equal(r.outlets, 3);
    assert.equal(r.quiet, false);
  });
  assert.deepEqual(rows.map((r) => Boolean(r.best)), [true, false, false, false, false]);
});

test('fallback: used ids and stories with no title are skipped, and at most 2 come from one category', () => {
  const stories = [
    story('a', { cat: 'internet' }),
    story('b', { cat: 'internet' }),
    story('c', { cat: 'internet' }),
    story('used', { cat: 'hacks' }),
    story('blank', { cat: 'hacks', title: '   ' }),
    story('none', { cat: 'hacks', title: undefined }),
    story('d', { cat: 'hacks' }),
    story('e', { cat: 'hacks' }),
    story('f', { cat: 'hacks' }),
    story('g', { cat: 'markets' }),
    story('h', { cat: 'markets' }),
  ];
  const rows = fallbackRows({ stories, used: new Set(['used']), emojiByCat });
  assert.deepEqual(rows.map((r) => r.ids[0]), ['a', 'b', 'd', 'e', 'g'], 'two from internet, two from hacks, then markets');
  for (const cat of new Set(rows.map((r) => r.cat))) assert.ok(rows.filter((r) => r.cat === cat).length <= 2, cat);
  assert.deepEqual(fallbackRows({ stories: [], emojiByCat }), []);
  for (const odd of [undefined, null, 'text', 7, {}, [null, 'x', 3]]) assert.deepEqual(fallbackRows({ stories: odd, emojiByCat }), [], String(odd));
});

test('fallback: a quiet story is a quiet row, an unknown category gets a newspaper, and odd fields never break a row', () => {
  const quake = story('sig:quake:q2', { cat: 'earth', kind: 'signal', title: 'M 6.6 - 148 km WSW of Tual, Indonesia', source: 'USGS', quiet: true, outlets: undefined, signal: { type: 'quake', mag: 6.6, place: '148 km WSW of Tual, Indonesia', pager: 'orange', tsunami: false } });
  const odd = story('odd', { cat: 'zzz', outlets: 'many', source: undefined, url: 42 });
  const rows = fallbackRows({ stories: [quake, odd], emojiByCat });
  assert.equal(rows[0].quiet, true);
  assert.equal(rows[0].outlets, 1);
  assert.equal(rows[1].emoji, '\u{1F4F0}');
  assert.equal(rows[1].outlets, 1);
  assert.equal(rows[1].source, '');
  assert.equal(rows[1].url, '');
  assert.equal(quietLinkFor(rows[0], byIdOf([quake])), 'ifrc', 'outside the US, a quake that hurt people goes to the international Red Cross');
  assert.equal(quietLinkFor(rows[1], byIdOf([odd])), null);
  assert.equal(quietLinkFor(rows[0], new Map()), null, 'a lead story that has left the window gives no link');
  assert.equal(quietLinkFor(null, new Map()), null);
  for (const r of rows) for (const v of Object.values(r)) assert.ok(!/undefined|NaN|\[object/.test(String(v)), String(v));
});

// ---- every day, with the used ids carried forward -----------------------------------------------

function threeDays() {
  const day = (date, ids) => ({ date, stories: ids.map((id, i) => story(id, { cat: ['internet', 'hacks', 'flights', 'markets', 'space', 'grid'][i % 6], score: 90 - i })) });
  // heavy overlap, as in the real rolling windows
  return [day('2026-11-15', ['a', 'b', 'c', 'd', 'e', 'f']), day('2026-11-16', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']), day('2026-11-17', ['d', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n'])];
}

const resolve = (days, editions, over = {}) => resolveDays({ days, editions, excluder, fallbackHeadline: (d) => subline(d.score ?? 50), emojiByCat, ...over });
const rowIds = (r) => r.rows.flatMap((row) => row.ids);

test('days: a story told on one day is never told on a later day, in an edition or in plain headlines', () => {
  const days = threeDays();
  const editions = new Map([
    ['2026-11-15', edition('2026-11-15', ['a', 'b', 'c'])],
    ['2026-11-16', edition('2026-11-16', ['a', 'g', 'h', 'i'])], // tries to tell "a" again
  ]);
  const out = resolve(days, editions);
  assert.deepEqual([...out.keys()].sort(), ['2026-11-15', '2026-11-16', '2026-11-17']);
  assert.deepEqual(rowIds(out.get('2026-11-15')), ['a', 'b', 'c']);
  assert.equal(out.get('2026-11-15').by, 'editor');
  assert.deepEqual(rowIds(out.get('2026-11-16')), ['g', 'h', 'i'], 'a was told on the 15th');
  // the 17th has no edition: its plain headlines skip everything told before (two per category, five rows)
  const third = out.get('2026-11-17');
  assert.equal(third.by, 'fallback');
  assert.equal(third.headline, subline(50));
  assert.deepEqual(rowIds(third), ['d', 'e', 'f', 'j', 'k']);
  // across every day: no id twice
  const seen = new Set();
  for (const date of ['2026-11-15', '2026-11-16', '2026-11-17']) {
    for (const id of rowIds(out.get(date))) {
      assert.ok(!seen.has(id), `${id} shows twice`);
      seen.add(id);
    }
  }
});

test('days: an earlier day does not lose a story because a later day tells it, and plain headlines are not "told"', () => {
  const days = threeDays();
  const editions = new Map([['2026-11-17', edition('2026-11-17', ['d', 'e', 'f', 'k'])]]);
  const out = resolve(days, editions);
  assert.equal(out.get('2026-11-17').by, 'editor');
  assert.deepEqual(rowIds(out.get('2026-11-17')), ['d', 'e', 'f', 'k']);
  // the earlier days come first in time, so they still show d, e and f
  assert.deepEqual(rowIds(out.get('2026-11-15')), ['a', 'b', 'c', 'd', 'e']);
  // only an edition marks a story as told: the 16th's plain rows do not stop the 15th's from showing the same ones
  assert.deepEqual(rowIds(out.get('2026-11-16')), ['a', 'b', 'c', 'd', 'e']);
});

test('days: a day whose edition fails shows plain headlines, and its ids stay free for the next day', () => {
  const days = threeDays();
  const editions = new Map([
    ['2026-11-16', edition('2026-11-16', ['g', 'h', 'i'], { headline: 'No ending' })], // fails
    ['2026-11-17', edition('2026-11-17', ['g', 'h', 'i', 'j'])],
  ]);
  const out = resolve(days, editions);
  assert.equal(out.get('2026-11-16').by, 'fallback');
  assert.equal(out.get('2026-11-16').edition, null);
  assert.equal(out.get('2026-11-17').by, 'editor', 'g, h and i were never told on the 16th, so the 17th can tell them');
  assert.deepEqual(rowIds(out.get('2026-11-17')), ['g', 'h', 'i', 'j']);
});

test('days: a day with no edition shows its plain headline from the ladder, and quiet mode puts every day on plain headlines', () => {
  const days = threeDays().map((d, i) => ({ ...d, score: [10, 45, 83][i] }));
  const editions = new Map([['2026-11-16', edition('2026-11-16', ['a', 'b', 'c'])]]);
  const out = resolve(days, editions);
  assert.equal(out.get('2026-11-15').headline, subline(10));
  assert.equal(out.get('2026-11-16').headline, HEADLINE);
  assert.equal(out.get('2026-11-17').headline, subline(83));
  // quiet mode: no day uses its edition, and every plain day says the quiet line
  const quiet = resolve(days, editions, { quietMode: true, fallbackHeadline: () => QUIET_LINE });
  for (const date of ['2026-11-15', '2026-11-16', '2026-11-17']) {
    assert.equal(quiet.get(date).by, 'fallback', date);
    assert.equal(quiet.get(date).headline, QUIET_LINE, date);
    assert.ok(quiet.get(date).rows.length >= 1 && quiet.get(date).rows.every((r) => r.line === r.title), `${date}: plain rows`);
  }
  assert.equal(quiet.get('2026-11-16').edition.by, 'editor', 'the edition is kept, ready for when quiet mode ends');
});

test('days: a date with an edition and no stories is skipped, an edition for nothing breaks nothing, and odd input is safe', () => {
  const editions = new Map([['2026-11-10', edition('2026-11-10', ['a', 'b', 'c'])]]);
  assert.equal(resolve([], editions).size, 0);
  assert.equal(resolve(undefined, new Map()).size, 0);
  assert.equal(resolve([null, 'x', { date: '2026-11-17', stories: 'no' }], new Map()).size, 1);
});

// ---- publishable stories and ordering ---------------------------------------------------------

test('publishable stories: the taste filter and the English check apply to every day, frozen or not', () => {
  const stories = [
    story('ok', { title: 'Cloudflare outage knocks thousands of sites offline' }),
    story('dead', { title: 'Cloudflare outage leaves two dead at a data center' }),
    story('es', { cat: 'weather', title: 'Por el derecho de la niñez a crecer en familia, las Aldeas Infantiles SOS convocan a una carrera pedestre' }),
    story('en', { cat: 'ai', title: 'Microsoft blames the major global drop in Outlook, Teams, and Copilot on a latent software failure since July', source: 'Demócrata' }),
    story('sig:asteroid:x', { kind: 'signal', cat: 'space', title: 'Asteroid 2026 WA passes at 0.3 lunar distances', source: 'NASA/JPL' }),
    null,
    'text',
    7,
    [],
  ];
  assert.deepEqual(publishableStories(excluder, stories).map((s) => s.id), ['ok', 'en', 'sig:asteroid:x']);
  assert.deepEqual(publishableStories(excluder, undefined), []);
  assert.deepEqual(publishableStories(excluder, 'nope'), []);
  assert.deepEqual(publishableStories({ test() { throw new Error('broken'); } }, [story('x')]), [], 'a story too odd to check is not published');
});

test('listing order: the same stories come out in the same order however they arrive', () => {
  const cats = ['flights', 'hacks', 'internet', 'markets', 'space', 'grid', 'weather', 'ai'];
  const stories = Array.from({ length: 40 }, (_, i) => story(`s${String(i).padStart(2, '0')}`, { cat: cats[i % cats.length], score: 100 - (i % 7) * 3, publishedAt: `2026-11-17T${String(i % 24).padStart(2, '0')}:00:00.000Z` }));
  const a = listingOrder(stories, cfg.variety).map((s) => s.id);
  const b = listingOrder([...stories].reverse(), cfg.variety).map((s) => s.id);
  const c = listingOrder([...stories].sort((x, y) => (x.cat < y.cat ? -1 : 1)), cfg.variety).map((s) => s.id);
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
  assert.equal(a.length, 40);
  assert.equal(new Set(a).size, 40);
  for (const run of [a.slice(0, 12)]) for (const cat of cats) assert.ok(run.filter((id) => stories.find((s) => s.id === id).cat === cat).length <= cfg.variety.firstMax, `${cat} in the first 12`);
});

test('publishable stories: a story from a press-release wire is not published, whatever its headline says', () => {
  const stories = [
    story('wire', { title: 'Cloudflare outage knocks thousands of sites offline for an hour', source: 'EIN Presswire' }),
    story('wire2', { title: 'Cloudflare outage knocks thousands of sites offline for an hour', source: 'ein-presswire' }),
    story('news', { title: 'Cloudflare outage knocks thousands of sites offline for an hour', source: 'The Verge' }),
    story('close', { title: 'Cloudflare outage knocks thousands of sites offline for an hour', source: 'Presswire Daily Review' }),
  ];
  assert.deepEqual(publishableStories(excluder, stories).map((s) => s.id), ['news', 'close']);
  // the same check runs on an edition item, by the source it carries
  const wire = validateEdition(edition(TODAY, ['a', 'b', 'c']), ctx());
  assert.equal(wire.ok, true);
  const raw = edition(TODAY, ['a', 'b', 'c', 'd']);
  raw.items[3].source = 'EIN Presswire';
  const checked = validateEdition(raw, ctx());
  assert.equal(checked.edition.items.length, 3);
  assert.deepEqual(reasons(checked), ['excluded: press release']);
});

test('one id, one story: the first story of an id in the listing order stays, and the page never lists an id twice', () => {
  const a = story('dup', { title: 'United Airlines ground stop delays flights across the country', score: 90, publishedAt: '2026-11-17T10:00:00.000Z' });
  const b = story('dup', { title: 'Fox News reports dozens of flights canceled as FAA halts departures', score: 40, publishedAt: '2026-11-17T11:00:00.000Z' });
  const c = story('solo', { title: 'Chase online banking was down for hours on Monday afternoon', cat: 'hacks', score: 60 });
  // dedupeById keeps the first of an id, in the order given, and never changes a story
  assert.deepEqual(dedupeById([b, c, a]).map((s) => s.title), [b.title, c.title]);
  assert.deepEqual(dedupeById([a, b, c]).map((s) => s.title), [a.title, c.title]);
  assert.equal(dedupeById([a, b, c])[0], a, 'the story itself, not a copy');
  assert.deepEqual(dedupeById([a, null, 'text', 7, [], c]).map((s) => s.id), ['dup', 'solo']);
  assert.deepEqual(dedupeById(undefined), []);
  // the listing order is the same however the pair arrives: the higher ranked story keeps the id
  for (const order of [[a, b, c], [b, a, c], [c, b, a]]) {
    const listed = listingOrder(order, cfg.variety);
    assert.deepEqual(listed.map((s) => s.id).sort(), ['dup', 'solo'], 'each id once');
    assert.equal(listed.find((s) => s.id === 'dup').title, a.title, 'the higher ranked story of the pair stays');
  }
  // onePerId leaves the stories in their own order, only without the second one of an id
  assert.deepEqual(onePerId([b, c, a], cfg.variety).map((s) => s.title), [c.title, a.title]);
  assert.deepEqual(onePerId([a, b, c], cfg.variety).map((s) => s.title), [a.title, c.title]);
  assert.deepEqual(onePerId([c], cfg.variety), [c]);
  assert.deepEqual(onePerId([], cfg.variety), []);
  // a plain day built from the listing order shows that story once
  const rows = fallbackRows({ stories: listingOrder([a, b, c], cfg.variety), emojiByCat });
  assert.deepEqual(rows.map((r) => r.ids[0]).sort(), ['dup', 'solo']);
});

test('ids hash: the same set in any order is the same, a different set is not', () => {
  assert.match(idsHash(['a', 'b', 'c']), /^[0-9a-f]{16}$/);
  assert.equal(idsHash(['a', 'b', 'c']), idsHash(['c', 'a', 'b']));
  assert.equal(idsHash(['a', 'b', 'c']), idsHash(['a', 'a', 'b', 'c']));
  assert.notEqual(idsHash(['a', 'b', 'c']), idsHash(['a', 'b', 'd']));
  assert.notEqual(idsHash(['a', 'b', 'c']), idsHash(['a', 'b']));
});

// ---- the files ---------------------------------------------------------------------------------------

test('edition files: read by date, oldest first; a broken or odd file counts as no edition', () => {
  const root = tmpRoot('dtwet-editions-');
  const p = { editions: path.join(root, 'data', 'editions') };
  assert.deepEqual(listEditionDates(p), [], 'no folder is no editions');
  assert.equal(readEditions(p).size, 0);
  fs.mkdirSync(p.editions, { recursive: true });
  fs.writeFileSync(editionFile(p, '2026-11-17'), JSON.stringify(edition('2026-11-17', ['a', 'b', 'c'])));
  fs.writeFileSync(editionFile(p, '2026-11-16'), JSON.stringify(edition('2026-11-16', ['d', 'e', 'f'])));
  fs.writeFileSync(path.join(p.editions, '2026-11-15.json'), '{ not json');
  fs.writeFileSync(path.join(p.editions, '2026-11-14.json'), '[1,2,3]');
  fs.writeFileSync(path.join(p.editions, 'notes.txt'), 'hello');
  fs.writeFileSync(path.join(p.editions, '2026-13-45.json'), '{}');
  fs.writeFileSync(path.join(p.editions, 'latest.json'), '{}');
  assert.deepEqual(listEditionDates(p), ['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17']);
  const read = readEditions(p);
  assert.deepEqual([...read.keys()], ['2026-11-16', '2026-11-17']);
  assert.throws(() => editionFile(p, 'not-a-date'), /Not a date/);
  assert.throws(() => editionFile(p, '../x'), /Not a date/);
});

// ---- the two editions written by hand at launch ---------------------------------------------------------

const launch = (date) => fixtureJson(`edition-launch-${date}.json`);

test('launch editions: both pass the one check exactly as written, and the 17th counts the 16th\'s ids as used', () => {
  const sixteenth = validateEdition(launch('2026-11-16'), ctx({ date: '2026-11-16' }));
  assert.equal(sixteenth.ok, true, sixteenth.reason);
  assert.deepEqual(sixteenth.dropped, [], 'nothing was dropped');
  assert.equal(sixteenth.edition.items.length, 6);
  assert.equal(sixteenth.edition.by, 'hand');
  assert.equal(sixteenth.edition.headline, 'Microsoft says a bug hiding since July knocked out Outlook worldwide. Still here.');
  const used = new Set(sixteenth.edition.items.flatMap((i) => i.ids));
  const seventeenth = validateEdition(launch('2026-11-17'), ctx({ date: '2026-11-17', used }));
  assert.equal(seventeenth.ok, true, seventeenth.reason);
  assert.deepEqual(seventeenth.dropped, [], 'nothing was dropped, so no id of the 17th was told on the 16th');
  assert.equal(seventeenth.edition.items.length, 6);
  assert.equal(seventeenth.edition.by, 'hand');
  assert.equal(seventeenth.edition.headline, 'An asteroid the size of a bus missed Earth at 2:59 AM ET. Still here.');
  for (const e of [sixteenth.edition, seventeenth.edition]) {
    assert.deepEqual(e.items.map((i) => Boolean(i.best)), [true, false, false, false, false, false], 'the closest call is first');
    assert.ok(e.headline.length <= EDITION.headlineMax, 'a one-sentence headline of 110 characters or fewer');
    for (const it of e.items) {
      assert.ok(!badText(it.line), it.line);
      assert.ok(it.url.startsWith('https://'), it.url);
      assert.ok(it.line.length <= EDITION.lineMax);
      assert.ok(it.label && it.label.length <= EDITION.labelMax && !it.label.includes('.'), `a label on every item: ${it.label}`);
    }
  }
  // no id in both
  const second = new Set(seventeenth.edition.items.flatMap((i) => i.ids));
  for (const id of second) assert.ok(!used.has(id), `${id} is on both days`);
  assert.equal(sixteenth.edition.items.find((i) => i.cat === 'earth').quiet, true, 'the quake is a quiet row');
  // and as one walk over the two days, the way the build does it
  const editions = new Map([['2026-11-16', launch('2026-11-16')], ['2026-11-17', launch('2026-11-17')]]);
  const days = ['2026-11-16', '2026-11-17'].map((date) => ({ date, stories: [] }));
  const out = resolve(days, editions);
  assert.deepEqual([out.get('2026-11-16').by, out.get('2026-11-17').by], ['hand', 'hand']);
});

// The committed data/editions folder is not read here. Once the editor is on, its files are
// model-written text that changes every run, and a bad one never blocks a deploy: the build
// already falls back to plain headlines. These test files are the hand-written ones, frozen.
test('launch editions: every edition-launch fixture passes the one check, day by day', () => {
  const dir = path.join(REPO, 'test', 'fixtures');
  const files = fs.readdirSync(dir).filter((name) => /^edition-launch-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
  assert.ok(files.length >= 2, 'the two launch editions are there');
  const used = new Set();
  for (const file of files) {
    const date = file.slice('edition-launch-'.length, -'.json'.length);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const r = validateEdition(raw, ctx({ date, used: new Set(used) }));
    assert.equal(r.ok, true, `${date}: ${r.reason}`);
    assert.deepEqual(r.dropped, [], `${date}: nothing dropped`);
    for (const it of r.edition.items) for (const id of it.ids) used.add(id);
  }
});
