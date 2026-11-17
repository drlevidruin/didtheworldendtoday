// The jokes under ALMOST.: the 100 lines, the rules they keep, the small script that deals them out
// one at a time, the hash the page policy holds for it, and the page script that asks for the next one.
// Everything runs offline: the script runs in node:vm against a fake document and a fake localStorage.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { config } from '../scripts/config.mjs';
import { badText } from '../scripts/lib/editions.mjs';
import { createGatekeeper } from '../scripts/lib/pipeline.mjs';
import { CSP } from '../scripts/templates/layout.mjs';
import { readCmap } from '../scripts/templates/graphics.mjs';
import { QUIPS, QUIP_CSP, QUIP_HASH, QUIP_SCRIPT, quipFor, quipHash, quipScript } from '../scripts/templates/quips.mjs';
import { fixture, REPO } from './helpers.mjs';

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const KEY = 'dtwet-quips';
const WANT = fixture('quips.txt').replace(/\n$/, '').split('\n');

// ---- the list ---------------------------------------------------------------------------------------------

test('quips: exactly 100, all different, each the same as its line in the owner\'s list, in that order, and the list cannot be changed', () => {
  assert.equal(WANT.length, 100, 'the list has 100 lines');
  assert.ok(WANT.every((line) => line !== '' && line === line.trim() && !line.includes('\r')), 'no blank line, stray space or carriage return in the list');
  assert.equal(QUIPS.length, 100);
  assert.equal(new Set(QUIPS).size, 100, 'all different');
  assert.deepEqual([...QUIPS], WANT, 'character for character, in order');
  assert.equal(QUIPS.filter((q) => q.includes('\u2019')).length > 10, true, 'they use the curly apostrophe');
  assert.ok(Object.isFrozen(QUIPS));
  assert.throws(() => QUIPS.push('one more'), TypeError);
  assert.throws(() => {
    QUIPS[0] = 'changed';
  }, TypeError);
  assert.equal(QUIPS[0], 'The universe missed again. The receipts are below.');
  assert.equal(QUIPS[99], 'Somehow still here. Here\u2019s the near miss list, scariest first.');
});

test('quips: each is at most 64 characters and ends with a period, with no ! ? ; straight quote, long dash or emoji, and none says a word that dates it', () => {
  for (const q of QUIPS) {
    assert.ok(q.length <= 64, `${q.length} characters: ${q}`);
    assert.ok(q.endsWith('.'), `no period at the end: ${q}`);
    assert.ok(!/[!?;'"]/.test(q), `a mark we do not use: ${q}`);
    assert.ok(!q.includes(EM) && !q.includes(EN), `a long dash: ${q}`);
    assert.ok(!/\p{Extended_Pictographic}|\uFE0F|\u200D|\p{Regional_Indicator}/u.test(q), `an emoji: ${q}`);
    assert.equal(badText(q), null, `the house text rules: ${q}`);
    assert.ok(!/\b(?:today|tonight|yesterday|this morning|this week)\b/i.test(q), `a word that dates it: ${q}`);
    assert.equal(q, q.normalize('NFC'), `not in composed form: ${q}`);
  }
});

test('quips: every one points down at the list', () => {
  const POINTS_DOWN = /\b(below|down|scroll|beneath|underneath)\b|\bhere(\u2019s| are)\b/i;
  for (const q of QUIPS) assert.match(q, POINTS_DOWN, q);
});

test('quips: the taste filter passes every one, except its format family, whose "here\u2019s what" rule is for headline explainers and not for our jokes', () => {
  const { excluder } = createGatekeeper(config());
  const hits = QUIPS.map((q) => [q, excluder.test(q, { signal: false, source: '' })]).filter(([, hit]) => hit);
  for (const [q, hit] of hits) assert.equal(hit.family, 'format', `${q} is blocked by ${hit.family} (${hit.term})`);
  assert.ok(hits.length > 0 && hits.every(([q]) => /here\u2019s what/i.test(q)), 'and the only ones the format family catches are the "here\u2019s what" lines');
});

// ---- which one the HTML carries -------------------------------------------------------------------------

test('quipFor: the days from 1970-01-01 to the date, modulo 100, so every date has one line and a run of 100 days has all 100', () => {
  const daysSince = (date) => Math.round((Date.UTC(...date.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n)))) - Date.UTC(1970, 0, 1)) / 86400000);
  assert.equal(quipFor('1970-01-01'), QUIPS[0]);
  assert.equal(quipFor('1970-01-02'), QUIPS[1]);
  assert.equal(quipFor('1970-04-11'), QUIPS[0], 'day 100');
  assert.equal(quipFor('1970-04-12'), QUIPS[1]);
  assert.equal(daysSince('2026-11-17'), 20774);
  assert.equal(quipFor('2026-11-17'), QUIPS[74]);
  assert.equal(quipFor('2026-11-17'), 'Still here. Somehow. Scroll down to see how.');
  for (const date of ['2026-11-16', '2026-12-31', '2028-02-29', '2100-03-01', '1999-12-31']) assert.equal(quipFor(date), QUIPS[daysSince(date) % 100], date);
  // the same date gives the same line, and the next date the next line
  assert.equal(quipFor('2026-11-17'), quipFor('2026-11-17'));
  assert.equal(quipFor('2026-11-18'), QUIPS[75]);
  assert.equal(quipFor('2026-12-31'), QUIPS[(daysSince('2026-12-31') % 100)]);
  const run = new Set();
  for (let n = 0; n < 100; n += 1) run.add(quipFor(new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10)));
  assert.equal(run.size, 100, '100 days in a row show all 100');
  // before 1970 the count is negative and still lands on a line; a date that is not a date gets the first
  assert.equal(quipFor('1969-12-31'), QUIPS[99]);
  for (const odd of ['', 'today', '2026-13-01', '2026-1-1', '11/17/2026', null, undefined, 20261117]) assert.equal(quipFor(odd), QUIPS[0], String(odd));
});

// ---- the font ---------------------------------------------------------------------------------------------

// The code points a woff2 font holds. The tables of a woff2 sit in one Brotli stream and the cmap is stored as it is, so its
// bytes can be handed to the same reader the share card uses, inside a one-table font file.
const TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

function woff2CodePoints(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.toString('latin1', 0, 4), 'wOF2', `${file} is a woff2`);
  const at = { i: 48 };
  const base128 = () => {
    let value = 0;
    for (let n = 0; n < 5; n += 1) {
      const byte = buf[at.i++];
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error('bad UIntBase128');
  };
  const tables = [];
  for (let n = 0; n < buf.readUInt16BE(12); n += 1) {
    const flags = buf[at.i++];
    let tag = TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 63) {
      tag = buf.toString('latin1', at.i, at.i + 4);
      at.i += 4;
    }
    let length = base128();
    const version = flags >> 6;
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    if (transformed) length = base128();
    tables.push({ tag, length });
  }
  const raw = zlib.brotliDecompressSync(buf.subarray(at.i, at.i + buf.readUInt32BE(20)));
  let offset = 0;
  let cmap = null;
  for (const t of tables) {
    if (t.tag === 'cmap') cmap = raw.subarray(offset, offset + t.length);
    offset += t.length;
  }
  assert.ok(cmap, `${file} has a cmap`);
  const sfnt = Buffer.alloc(28 + cmap.length);
  sfnt.writeUInt16BE(1, 4);
  sfnt.write('cmap', 12, 'latin1');
  sfnt.writeUInt32BE(28, 20);
  sfnt.writeUInt32BE(cmap.length, 24);
  cmap.copy(sfnt, 28);
  return readCmap(sfnt);
}

test('quips: the bold Libre Franklin the joke is set in has a glyph for every character the 100 lines use, the curly apostrophe included', () => {
  const have = woff2CodePoints(path.join(REPO, 'assets', 'fonts', 'librefranklin-700.woff2'));
  assert.ok(have.size > 200, `${have.size} characters in the font`);
  assert.ok(have.has(0x2019), 'U+2019, the curly apostrophe');
  const used = [...new Set(QUIPS.join(''))];
  assert.deepEqual(used.filter((c) => !have.has(c.codePointAt(0))), [], 'no character of any line is missing from the font');
});

// ---- the script -------------------------------------------------------------------------------------------

// A small seeded generator, so a run is the same every time.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One visitor's browser: the storage outlives the page loads, and each load() is a new page running the script once.
//   storage  'works', 'throws' (every read and write throws), 'blocked' (touching window.localStorage throws),
//            'none' (there is no localStorage at all) or 'full' (reads work, writes throw)
function browser({ state, storage = 'works', random = seeded(7), script = QUIP_SCRIPT, quipElement = true } = {}) {
  const store = new Map(state === undefined ? [] : [[KEY, state]]);
  const real = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => void store.set(k, String(v)) };
  const throwing = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('SecurityError');
    },
  };
  return {
    store,
    saved: () => JSON.parse(store.get(KEY)),
    load() {
      const element = { textContent: '' };
      let window = { localStorage: real };
      if (storage === 'throws') window = { localStorage: throwing };
      if (storage === 'none') window = {};
      if (storage === 'full') window = { localStorage: { getItem: real.getItem, setItem: throwing.setItem } };
      if (storage === 'blocked') {
        window = {};
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new Error('SecurityError');
          },
        });
      }
      const document = { getElementById: (id) => (id === 'quip' && quipElement ? element : null) };
      const result = vm.runInNewContext(script, { window, document, Math: { floor: Math.floor, random } });
      return { element, window, result, text: element.textContent };
    },
  };
}

const indexOf = (text) => QUIPS.indexOf(text);

test('script: 100 loads in a row show all 100 lines, and the 101st is not the one on screen', () => {
  const b = browser();
  const shown = [];
  for (let n = 0; n < 100; n += 1) {
    const page = b.load();
    assert.ok(indexOf(page.text) >= 0, `load ${n + 1} shows one of the 100: ${page.text}`);
    shown.push(page.text);
  }
  assert.equal(new Set(shown).size, 100, 'all 100 before any repeats');
  assert.deepEqual(b.saved().bag, [], 'and the bag is empty');
  const next = b.load();
  assert.notEqual(next.text, shown[99], 'load 101 is not load 100');
  assert.equal(b.saved().bag.length, 99, 'the new bag holds the other 99');
  assert.equal(b.saved().h, QUIP_HASH);
  assert.equal(indexOf(next.text), b.saved().last, 'last is the line that is on screen');
  assert.deepEqual(Object.keys(b.saved()).sort(), ['bag', 'h', 'last']);
});

test('script: over many refills no bag starts with the line the last one ended on, and every bag shows all 100 before it repeats', () => {
  const b = browser({ random: seeded(2026) });
  const page = b.load();
  let previous = page.text;
  const stats = { cycles: 0 };
  let seen = new Set([previous]);
  // dtwetQuip is the function a page calls for the next line; each call reads and writes the bag the same way a load does
  for (let n = 1; n < 100 * 400; n += 1) {
    page.window.dtwetQuip();
    const now = page.element.textContent;
    assert.notEqual(now, previous, `call ${n + 1} repeats the line on screen`);
    if (n % 100 === 0) {
      assert.equal(seen.size, 100, `bag ${stats.cycles + 1} showed all 100`);
      seen = new Set();
      stats.cycles += 1;
    }
    seen.add(now);
    previous = now;
  }
  assert.equal(stats.cycles, 399);
});

test('script: a refill never starts with the line on screen, whatever the shuffle comes out as', () => {
  // two fixed shuffles (a generator stuck low and one stuck high), and every line taken as the last one shown
  for (const fixed of [0, 0.999999, 0.5]) {
    for (let last = 0; last < 100; last += 1) {
      const b = browser({ state: JSON.stringify({ h: QUIP_HASH, bag: [], last }), random: () => fixed });
      assert.notEqual(b.load().text, QUIPS[last], `generator ${fixed}, last ${last}`);
    }
  }
});

test('script: a bag it trusts is dealt from the end, a bag it cannot trust is thrown away, and a new bag is a full one', () => {
  const good = browser({ state: JSON.stringify({ h: QUIP_HASH, bag: [7, 8, 9], last: 3 }) });
  assert.equal(good.load().text, QUIPS[9]);
  assert.deepEqual(good.saved(), { h: QUIP_HASH, bag: [7, 8], last: 9 });
  assert.equal(good.load().text, QUIPS[8]);
  assert.equal(good.load().text, QUIPS[7]);
  assert.deepEqual(good.saved().bag, []);
  const refilled = good.load();
  assert.notEqual(refilled.text, QUIPS[7], 'the refill does not repeat the line it ended on');
  assert.equal(good.saved().bag.length, 99);

  const bad = {
    'bad JSON': '{ not json',
    'an empty string': '',
    'text': 'hello',
    'a number': '5',
    'null': 'null',
    'a list': '[1,2,3]',
    'a wrong h': JSON.stringify({ h: 'zzzzzzzz', bag: [1, 2, 3], last: 5 }),
    'no h': JSON.stringify({ bag: [1, 2, 3], last: 5 }),
    'an index of 100': JSON.stringify({ h: QUIP_HASH, bag: [100, 1, 2], last: 5 }),
    'an index of -1': JSON.stringify({ h: QUIP_HASH, bag: [-1, 1, 2], last: 5 }),
    'an index of 1.5': JSON.stringify({ h: QUIP_HASH, bag: [1.5, 1, 2], last: 5 }),
    'a repeat in the bag': JSON.stringify({ h: QUIP_HASH, bag: [4, 5, 4], last: 0 }),
    'a bag that is not a list': JSON.stringify({ h: QUIP_HASH, bag: 'abc', last: 0 }),
    'a bag that is an object': JSON.stringify({ h: QUIP_HASH, bag: { 0: 1 }, last: 0 }),
    'no bag': JSON.stringify({ h: QUIP_HASH, last: 0 }),
    'a bag of strings': JSON.stringify({ h: QUIP_HASH, bag: ['1', '2'], last: 0 }),
    'a bag of nulls': JSON.stringify({ h: QUIP_HASH, bag: [null, 1], last: 0 }),
    'a last that is not an index': JSON.stringify({ h: QUIP_HASH, bag: [1, 2, 3], last: 100 }),
    'a last that is a string': JSON.stringify({ h: QUIP_HASH, bag: [1, 2, 3], last: '2' }),
  };
  for (const [name, state] of Object.entries(bad)) {
    const b = browser({ state });
    const first = b.load();
    assert.ok(indexOf(first.text) >= 0, name);
    assert.equal(b.saved().bag.length, 99, `${name}: it starts a fresh bag of 100 and deals one`);
    assert.equal(b.saved().h, QUIP_HASH, name);
    const shown = new Set([first.text]);
    for (let n = 1; n < 100; n += 1) shown.add(b.load().text);
    assert.equal(shown.size, 100, `${name}: and the fresh bag shows all 100`);
  }
  // no key at all is the same: a fresh bag
  const none = browser();
  none.load();
  assert.equal(none.saved().bag.length, 99);
  // a bag from an older list (another hash) is not used, so an edit to the list never points at lines that moved
  assert.notEqual(quipHash(['one']), QUIP_HASH);
  const old = browser({ state: JSON.stringify({ h: quipHash(['one']), bag: [0], last: 0 }) });
  old.load();
  assert.equal(old.saved().bag.length, 99);
});

test('script: storage that throws, is blocked, is missing or is full still shows a line, and never throws', () => {
  for (const storage of ['throws', 'blocked', 'none', 'full']) {
    const b = browser({ storage });
    const page = b.load();
    assert.ok(indexOf(page.text) >= 0, `${storage}: ${page.text}`);
    assert.equal(typeof page.window.dtwetQuip, 'function', storage);
    // and the next line, again and again, is always a line, and never the one on screen
    let previous = page.text;
    for (let n = 0; n < 300; n += 1) {
      assert.doesNotThrow(() => page.window.dtwetQuip(), storage);
      const now = page.element.textContent;
      assert.ok(indexOf(now) >= 0, `${storage}: ${now}`);
      if (storage !== 'full') assert.notEqual(now, previous, `${storage}: call ${n + 1} repeats the line on screen`);
      previous = now;
    }
  }
  // with working reads and failing writes the page keeps showing a line from the bag it read
  const full = browser({ storage: 'full', state: JSON.stringify({ h: QUIP_HASH, bag: [10, 11], last: 3 }) });
  assert.equal(full.load().text, QUIPS[11]);
  // a different line over many loads when storage gives nothing: the random choice is not stuck on one line
  const spread = new Set();
  const dead = browser({ storage: 'throws', random: seeded(99) });
  for (let n = 0; n < 40; n += 1) spread.add(dead.load().text);
  assert.ok(spread.size > 20, `${spread.size} different lines in 40 loads with no storage`);
});

test('script: dtwetQuip is the function that shows the next line, and neither it nor the script returns anything', () => {
  const b = browser();
  const page = b.load();
  assert.equal(page.result, undefined, 'the script returns nothing');
  assert.equal(typeof page.window.dtwetQuip, 'function');
  assert.equal(page.window.dtwetQuip(), undefined, 'and neither does the function');
  const shown = new Set([page.text]);
  const second = page.element.textContent;
  shown.add(second);
  assert.notEqual(second, page.text, 'one call, one new line');
  assert.equal(b.saved().bag.length, 98, 'and one more line is out of the bag');
  for (let n = 2; n < 100; n += 1) {
    page.window.dtwetQuip();
    shown.add(page.element.textContent);
  }
  assert.equal(shown.size, 100, 'a page load and 99 calls show all 100');
  // the next page load carries on from the same bag
  const before = page.element.textContent;
  const reload = b.load();
  assert.notEqual(reload.text, before);
});

test('script: with no #quip on the page it changes nothing, takes nothing out of the bag and does not throw', () => {
  const b = browser({ quipElement: false, state: JSON.stringify({ h: QUIP_HASH, bag: [1, 2, 3], last: 0 }) });
  const page = b.load();
  assert.equal(page.text, '');
  assert.deepEqual(b.saved(), { h: QUIP_HASH, bag: [1, 2, 3], last: 0 }, 'the saved bag is as it was');
  assert.doesNotThrow(() => page.window.dtwetQuip());
  assert.deepEqual(b.saved(), { h: QUIP_HASH, bag: [1, 2, 3], last: 0 });
});

test('script: it holds every line as it is, it is plain ES5, and it is small', () => {
  assert.ok(QUIPS.every((q) => QUIP_SCRIPT.includes(JSON.stringify(q))), 'every line is in the script, word for word');
  assert.ok(Buffer.byteLength(QUIP_SCRIPT) < 8000, `${Buffer.byteLength(QUIP_SCRIPT)} bytes`);
  assert.ok(!QUIP_SCRIPT.includes('</') && !QUIP_SCRIPT.includes('<!--'), 'nothing in it can close the tag early or open a comment');
  assert.ok(!QUIP_SCRIPT.includes('\r'), 'no carriage return, which would change the bytes the hash covers');
  const code = QUIP_SCRIPT.replace(/var Q = \[[^\n]*\];/, 'var Q = [];');
  assert.ok(code.length < 4000 && code.includes('var Q = [];'), 'the list is one line, and the code is what is left');
  for (const [re, what] of [[/=>/, 'an arrow function'], [/\blet\b|\bconst\b/, 'let or const'], [/`/, 'a template string'], [/\.\.\./, 'a spread'], [/\bclass\b/, 'a class'], [/\basync\b|\bawait\b/, 'async'], [/\?\./, 'optional chaining'], [/\?\?/, 'nullish coalescing'], [/\bfunction\s*\*/, 'a generator'], [/\bfetch\b|\bXMLHttpRequest\b|\beval\b|\bdocument\.write\b/, 'a network call or eval'], [/\/\/|\/\*/, 'a comment']]) {
    assert.ok(!re.test(code), `the script uses ${what}`);
  }
  assert.ok(code.includes("'use strict'"), 'strict');
  assert.ok(!/https?:/.test(code), 'it calls no address');
  // it compiles as a classic script, with no module syntax
  assert.doesNotThrow(() => new vm.Script(QUIP_SCRIPT));
});

test('script: a "<" in a line is escaped, so a line like that could never close the tag or open a comment', () => {
  const nasty = ['Close it </script> early.', 'Open a comment <!-- here. Scroll down.', 'Plain one. See below.'];
  const script = quipScript(nasty);
  assert.ok(!script.includes('</') && !script.includes('<!--'), 'no "</" and no "<!--" in the script');
  assert.ok(script.includes('\\u003c/script>') && script.includes('\\u003c!-- here'), 'written as \\u003c');
  // and it still shows the line exactly as written
  const shown = new Set();
  const b = browser({ script });
  for (let n = 0; n < 3; n += 1) shown.add(b.load().text);
  assert.deepEqual([...shown].sort(), [...nasty].sort(), 'the text comes out with its "<" back');
  assert.notEqual(quipHash(nasty), QUIP_HASH);
  assert.equal(quipScript(QUIPS), QUIP_SCRIPT, 'the page script is this function applied to the 100 lines');
});

// ---- the policy -------------------------------------------------------------------------------------------

test('policy: QUIP_CSP is the sha256 of the script text, in base64 over its UTF-8 bytes, and the page policy lists it and changes nothing else', () => {
  const digest = createHash('sha256').update(Buffer.from(QUIP_SCRIPT, 'utf8')).digest('base64');
  assert.equal(QUIP_CSP, `'sha256-${digest}'`);
  assert.match(QUIP_CSP, /^'sha256-[A-Za-z0-9+/]{43}='$/);
  assert.equal(
    CSP,
    `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' ${QUIP_CSP}; connect-src 'self'; font-src 'self'`,
    'only script-src gained the hash',
  );
  // a script that differs by one byte has another hash, so the policy would refuse it
  const other = createHash('sha256').update(`${QUIP_SCRIPT} `, 'utf8').digest('base64');
  assert.notEqual(other, digest);
});

// ---- the page script asks for the next line ---------------------------------------------------------------

const APP = fs.readFileSync(path.join(REPO, 'assets', 'app.js'), 'utf8');
const settle = async () => {
  for (let n = 0; n < 6; n += 1) await new Promise((resolve) => setImmediate(resolve));
};

// A page with the real page script running in it: a document with the few elements it reads, a fetch that
// answers when it is told to, and window.dtwetQuip that writes down every call.
function livePage({ quiet = '0', today = null, pageOk = true, gate = false, withQuipScript = false, dtwetQuip = 'count', random = seeded(5) } = {}) {
  const BUILD = '2026-11-17T15:00:00.000Z';
  const attrs = { 'data-root': './', 'data-live': '1', 'data-build': BUILD, 'data-success': BUILD, 'data-quiet': quiet, 'data-date': '2026-11-17' };
  const listeners = {};
  const appended = [];
  const seen = { quip: 0, swaps: 0, reloads: 0, fetches: [] };
  const node = (extra = {}) => ({ classList: { add() {}, remove() {} }, textContent: '', getAttribute: () => null, setAttribute() {}, remove() {}, addEventListener() {}, ...extra });
  const quipEl = node({ textContent: quipFor('2026-11-17') });
  const nodes = {
    '#hero': node({ getAttribute: (k) => (k === 'data-lines' ? '[]' : null) }),
    '#verdict': node({ textContent: 'ALMOST.', offsetWidth: 0 }),
    '#check': node(),
    '#said': node(),
    '#main': node({
      replaceWith() {
        seen.swaps += 1;
      },
    }),
  };
  let release = () => {};
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const document = {
    hidden: false,
    documentElement: { getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => void (attrs[k] = String(v)) },
    body: { appendChild: (n) => appended.push(n) },
    querySelector: (sel) => nodes[sel] || null,
    querySelectorAll: () => [],
    getElementById: (id) => (id === 'quip' ? quipEl : null),
    createElement: () => node({ className: '', type: '', _on: {}, addEventListener(type, fn) { this._on[type] = fn; } }),
    addEventListener: (type, fn) => void (listeners[type] = fn),
    adoptNode: (n) => n,
  };
  const store = new Map();
  const window = {
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => void store.set(k, String(v)) },
    location: {
      pathname: '/',
      reload() {
        seen.reloads += 1;
      },
    },
  };
  const fetch = async (url) => {
    seen.fetches.push(String(url));
    if (String(url).includes('api/today.json')) {
      if (gate) await held;
      return { ok: true, json: async () => today };
    }
    return { ok: pageOk, text: async () => '<html></html>' };
  };
  function DOMParser() {}
  DOMParser.prototype.parseFromString = () => ({ querySelector: (sel) => (sel === '#main' ? node() : null), documentElement: { getAttribute: () => null } });
  const sandbox = { document, window, navigator: {}, fetch, DOMParser, setInterval: () => 0, setTimeout: () => 0, clearTimeout() {}, Math: { floor: Math.floor, random } };
  if (withQuipScript) vm.runInNewContext(QUIP_SCRIPT, sandbox);
  if (dtwetQuip === 'count') {
    window.dtwetQuip = () => {
      seen.quip += 1;
    };
  } else if (dtwetQuip === 'throws') {
    window.dtwetQuip = () => {
      throw new Error('boom');
    };
  } else if (dtwetQuip !== 'real') window.dtwetQuip = dtwetQuip;
  vm.runInNewContext(APP, sandbox);
  const tap = () => listeners.click({ target: { closest: () => ({ getAttribute: () => 'check' }) } });
  return { attrs, listeners, appended, seen, nodes, quipEl, tap, release, window, bar: () => appended.find((n) => n.className === 'fresh') };
}

const LATER = { buildTime: '2026-11-17T16:00:00.000Z', quiet: { quiet: false, note: '' } };
const SAME = { buildTime: '2026-11-17T15:00:00.000Z', quiet: { quiet: false, note: '' } };

test('page script: a tap on ALMOST. shows the next line once, and only after the check has finished', async () => {
  const page = livePage({ today: SAME, gate: true });
  page.tap();
  await settle();
  assert.equal(page.seen.quip, 0, 'the check is still waiting for its answer, so no new line yet');
  page.tap();
  await settle();
  assert.equal(page.seen.quip, 0, 'a second tap during the check does nothing');
  page.release();
  await settle();
  assert.equal(page.seen.quip, 1, 'the check is done: one new line, not two');
  assert.equal(page.nodes['#said'].textContent, 'Checked. ALMOST.');
  // each tap after that is one more line
  page.tap();
  await settle();
  page.tap();
  await settle();
  assert.equal(page.seen.quip, 3);
  assert.equal(page.seen.swaps, 0, 'nothing newer, so no swap');
});

test('page script: a tap that finds newer data swaps the page in place and still advances the line once, not twice', async () => {
  const page = livePage({ today: LATER });
  page.tap();
  await settle();
  assert.equal(page.seen.swaps, 1, 'the page was swapped once');
  assert.equal(page.seen.quip, 1, 'and the line advanced once');
  assert.equal(page.seen.reloads, 0);
  // a swap that fails does not break the check: the line still advances once
  const failing = livePage({ today: LATER, pageOk: false });
  failing.tap();
  await settle();
  assert.equal(failing.seen.swaps, 0);
  assert.equal(failing.seen.quip, 1);
  assert.equal(failing.nodes['#said'].textContent, 'Checked. ALMOST.', 'the check still finishes');
});

test('page script: the refresh bar swaps the page in place and shows the next line once; a swap that fails reloads and shows none', async () => {
  const page = livePage({ today: LATER });
  page.listeners.visibilitychange();
  await settle();
  const bar = page.bar();
  assert.ok(bar, 'newer data shows the bar');
  assert.equal(page.seen.quip, 0, 'showing the bar changes no line');
  bar._on.click();
  await settle();
  assert.equal(page.seen.swaps, 1);
  assert.equal(page.seen.quip, 1, 'one swap, one new line');
  assert.equal(page.seen.reloads, 0);
  const broken = livePage({ today: LATER, pageOk: false });
  broken.listeners.visibilitychange();
  await settle();
  broken.bar()._on.click();
  await settle();
  assert.equal(broken.seen.reloads, 1, 'the page reloads, and the reload brings its own line');
  assert.equal(broken.seen.quip, 0);
});

test('page script: quiet mode has no jokes, so no tap and no swap asks for a line, and a page that turns quiet in the middle of a check does not either', async () => {
  const quiet = livePage({ quiet: '1', today: { ...SAME, quiet: { quiet: true, note: '' } } });
  quiet.tap();
  await settle();
  assert.equal(quiet.seen.quip, 0);
  const swapped = livePage({ quiet: '1', today: { ...LATER, quiet: { quiet: true, note: '' } } });
  swapped.tap();
  await settle();
  assert.equal(swapped.seen.swaps, 1);
  assert.equal(swapped.seen.quip, 0, 'a swap in quiet mode asks for nothing');
  const goingQuiet = livePage({ quiet: '0', today: { ...SAME, quiet: { quiet: true, note: '' } } });
  goingQuiet.tap();
  await settle();
  assert.equal(goingQuiet.attrs['data-quiet'], '1', 'the check learns the site went quiet');
  assert.equal(goingQuiet.seen.quip, 0, 'and so it shows no new joke');
  const bar = livePage({ quiet: '1', today: { ...LATER, quiet: { quiet: true, note: '' } } });
  bar.listeners.visibilitychange();
  await settle();
  bar.bar()._on.click();
  await settle();
  assert.equal(bar.seen.swaps, 1);
  assert.equal(bar.seen.quip, 0);
  // the quiet lifted: jokes are back
  const lifted = livePage({ quiet: '1', today: { ...SAME, quiet: { quiet: false, note: '' } } });
  lifted.tap();
  await settle();
  assert.equal(lifted.seen.quip, 1);
});

test('page script: it asks only when window.dtwetQuip is a function, and a function that throws changes nothing else', async () => {
  for (const missing of [undefined, null, 'quip', 42, {}]) {
    const page = livePage({ today: SAME, dtwetQuip: missing });
    page.tap();
    await settle();
    assert.equal(page.nodes['#said'].textContent, 'Checked. ALMOST.', `${String(missing)}: the check still finishes`);
    page.tap();
    await settle();
    assert.equal(page.nodes['#said'].textContent, 'Checked. ALMOST.');
  }
  const throwing = livePage({ today: LATER, dtwetQuip: 'throws' });
  throwing.tap();
  await settle();
  assert.equal(throwing.seen.swaps, 1, 'the swap still happened');
  assert.equal(throwing.nodes['#said'].textContent, 'Checked. ALMOST.', 'and the check finished');
  throwing.nodes['#said'].textContent = '';
  throwing.tap();
  await settle();
  assert.equal(throwing.nodes['#said'].textContent, 'Checked. ALMOST.', 'the button is not stuck: a second tap checks again');
  assert.equal(APP.replace(/\/\/.*$/gm, '').split('dtwetQuip').length - 1, 2, 'the page script names it twice in its code: once to test for it and once to call it');
  assert.ok(Buffer.byteLength(APP) < 15 * 1000, `${Buffer.byteLength(APP)} bytes: the page script stays small`);
});

test('page script: with the real quip script on the page, the page load and each tap show 100 different lines before any repeat, and no tap repeats the one on screen', async () => {
  const page = livePage({ today: SAME, withQuipScript: true, dtwetQuip: 'real' });
  const shown = [page.quipEl.textContent];
  assert.ok(indexOf(shown[0]) >= 0, 'the page load swapped the line from the date for one from the bag');
  for (let n = 0; n < 99; n += 1) {
    page.tap();
    await settle();
    shown.push(page.quipEl.textContent);
  }
  assert.equal(new Set(shown).size, 100, 'all 100 before any repeat');
  for (let n = 0; n < 150; n += 1) {
    const before = page.quipEl.textContent;
    page.tap();
    await settle();
    assert.notEqual(page.quipEl.textContent, before, `tap ${n + 1} repeats the line on screen`);
  }
  assert.equal(page.nodes['#said'].textContent, 'Checked. ALMOST.');
});
