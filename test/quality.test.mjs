import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../scripts/config.mjs';
import { createGatekeeper } from '../scripts/lib/pipeline.mjs';
import { blockKey, compileBlocklist, hasNonLatinScript, qualityCheck } from '../scripts/lib/quality.mjs';
import { runUpdate } from '../scripts/update.mjs';
import { fakeSource, newsItem, readJson, tmpRoot } from './helpers.mjs';

const cfg = config();
const gk = createGatekeeper(cfg);
const blocked = compileBlocklist(cfg.blockedPublishers);
const NOW = Date.parse('2026-11-16T22:00:00Z');
const admit = (over) => gk.admit(newsItem({ publishedAt: NOW - 3600e3, ...over }), NOW);

const SCRIPTS = {
  Hangul: '코스피 급락',
  Chinese: '全球互联网大面积宕机',
  Japanese: 'システム障害で空港が混乱',
  Cyrillic: 'Массовый сбой интернета',
  Greek: 'Μαζική διακοπή ρεύματος',
  Arabic: 'انقطاع واسع للإنترنت',
  Hebrew: 'תקלה רחבה באינטרנט',
  Thai: 'อินเทอร์เน็ตล่มทั่วประเทศ',
  Devanagari: 'इंटरनेट सेवा ठप',
};

for (const [script, sample] of Object.entries(SCRIPTS)) {
  test(`${script} in a title or a publisher name is dropped`, () => {
    assert.equal(hasNonLatinScript(sample), true);
    assert.equal(admit({ title: `Cloudflare outage hits ${sample} customers` }).drop, 'quality:script');
    assert.equal(admit({ source: sample }).drop, 'quality:script');
  });
}

test('Latin letters with accents and marks are not another script', () => {
  for (const ok of ['Café', 'Québec', 'Hawaiʻi', 'Zürich', 'Ångström', 'Peña', 'Łódź', '5 µm', '₩5,000 and €4', 'São Paulo', 'Ōsaka']) {
    assert.equal(hasNonLatinScript(ok), false, ok);
  }
  assert.equal(admit({ title: 'Cloudflare outage hits Québec and Zürich customers', source: 'Le Journal de Montréal' }).keep?.cat, 'internet');
});

test('a title that starts with a bracketed tag is dropped', () => {
  for (const title of ['[Photo] Cloudflare outage knocks thousands of sites offline', '[U.S. Stocks] Dow plunges as selloff deepens', '  [Video] Cloudflare outage knocks sites offline']) {
    assert.equal(qualityCheck(title, ['Example'], blocked)?.reason, 'quality:tag', title);
    assert.equal(admit({ title }).drop, 'quality:tag');
  }
  assert.equal(admit({ title: 'Cloudflare outage hits [Springfield] customers hard' }).keep?.cat, 'internet', 'a bracket in the middle is fine');
});

test('a title with a star symbol is dropped', () => {
  assert.equal(admit({ title: '☆ Cloudflare outage knocks thousands of sites offline' }).drop, 'quality:symbol');
  assert.equal(admit({ title: 'Cloudflare outage knocks thousands of sites offline ★' }).drop, 'quality:symbol');
});

test('a title cut off with three dots or an ellipsis is dropped, one that only has dots inside is not', () => {
  assert.equal(admit({ title: 'Cloudflare outage knocks thousands of sites off...' }).drop, 'quality:truncated');
  assert.equal(admit({ title: 'Cloudflare outage knocks thousands of sites off…' }).drop, 'quality:truncated');
  assert.equal(admit({ title: 'Cloudflare outage knocks thousands of sites off…  ' }).drop, 'quality:truncated');
  assert.equal(admit({ title: 'Wait... a Cloudflare outage knocks thousands of sites offline' }).keep?.cat, 'internet');
  assert.equal(admit({ title: 'Cloudflare outage knocks thousands of sites offline..' }).keep?.cat, 'internet');
});

test('the publisher blocklist covers every name in the brief, in any casing or form', () => {
  assert.deepEqual(
    [...cfg.blockedPublishers].sort(),
    ['BigGo Finance', 'Chiang Rai Times', 'Fakti.bg', 'Moomoo', 'Pluang', 'Traders Union', 'TradingKey', 'note'].sort(),
  );
  const forms = {
    note: ['note', 'Note', 'note.com'],
    'BigGo Finance': ['BigGo Finance', 'biggo finance', 'BIGGO FINANCE'],
    Moomoo: ['Moomoo', 'moomoo.com', 'www.moomoo.com', 'Moomoo on MSN', 'MOOMOO'],
    Pluang: ['Pluang', 'pluang.com'],
    'Traders Union': ['Traders Union', 'tradersunion.com', 'TradersUnion'],
    TradingKey: ['TradingKey', 'tradingkey.com', 'Trading Key'],
    'Fakti.bg': ['Fakti.bg', 'fakti.bg', 'FAKTI.BG'],
    'Chiang Rai Times': ['Chiang Rai Times', 'chiangraitimes.com'],
  };
  for (const [name, list] of Object.entries(forms)) {
    for (const form of list) {
      const out = admit({ source: form });
      assert.equal(out.drop, 'quality:publisher', `${name} as "${form}"`);
    }
  }
  for (const fine of ['Notebook Review', 'Note Weekly', 'Noted', 'Moomoo Daily', 'The Pluang Post', 'Reuters', 'AP News']) {
    assert.equal(admit({ source: fine }).keep?.cat, 'internet', fine);
  }
  assert.equal(blockKey('Moomoo on MSN'), blockKey('moomoo.com'));
});

const JUNK = [
  'must know', 'black friday', 'cyber monday', 'promo code', 'coupon', 'life hack', 'hack you', 'hacks for', 'hacks to', 'travel hack', 'money hack', 'best deals', '% off',
];

for (const phrase of JUNK) {
  test(`the off-topic phrase "${phrase}" is excluded`, () => {
    const title = phrase === '% off' ? 'Cloudflare outage brings 50% off at the airline shop' : `Cloudflare outage: ${phrase} this week at the shop`;
    assert.equal(admit({ title }).drop, 'excluded:junk', title);
    assert.equal(admit({ title: title.toUpperCase() }).drop, 'excluded:junk', 'upper case too');
  });
}

test('the four headlines named in the brief are gone, whoever published them', () => {
  const four = [
    { title: 'The Genius Meta Muse Black Friday Hack You Absolutely Must Know', source: 'note', why: 'quality:publisher', alone: 'excluded:junk' },
    { title: '[Photo] KOSPI falls below 5,000 intraday...', source: '아시아경제', why: 'quality:script', alone: 'quality:tag' },
    { title: 'Bitcoin plunges 17.7% from $75k to $62k amid he...', source: 'Pluang', why: 'quality:publisher', alone: 'quality:truncated' },
    { title: '[U.S. Stocks] Dow plunges $739 ... Replacement', source: 'Moomoo', why: 'quality:publisher', alone: 'quality:tag' },
  ];
  for (const f of four) {
    assert.equal(admit({ title: f.title, source: f.source, cat: 'markets' }).drop, f.why, `${f.source}: ${f.title}`);
    assert.equal(admit({ title: f.title, source: 'Reuters', cat: 'markets' }).drop, f.alone, `a trusted outlet cannot save it: ${f.title}`);
  }
});

test('our own signals are not held to the headline rules, and a post cut to length by us is kept', () => {
  const quake = gk.admit({ kind: 'signal', cat: 'earth', title: 'M 6.4 earthquake near Hualien City, Taiwan', url: 'https://earthquake.usgs.gov/e/1', source: 'USGS', publishedAt: NOW - 60e3, signal: { type: 'quake' } }, NOW);
  assert.ok(quake.keep);
  const post = { kind: 'x', cat: 'internet', title: 'Cloudflare outage knocks thousands of sites offline across several regions and a long list of providers…', url: 'https://x.com/a/status/1', source: '@BNONews', publishedAt: NOW - 60e3 };
  assert.ok(gk.admit(post, NOW).keep, 'a long post is cut by us, not by the source');
  assert.equal(gk.admit({ ...post, title: '[Photo] ' + post.title }, NOW).drop, 'quality:tag');
  assert.equal(gk.admit({ ...post, kind: 'news', source: 'Example' }, NOW).drop, 'quality:truncated', 'the same text as news is a cut-off headline');
});

const stored = (over = {}) => ({
  id: 'abc123',
  cat: 'internet',
  kind: 'news',
  title: 'Cloudflare outage knocks thousands of sites offline',
  url: 'https://example.com/a',
  source: 'Reuters',
  publishedAt: '2026-11-16T20:00:00.000Z',
  firstSeenAt: '2026-11-16T20:05:00.000Z',
  outlets: 3,
  outletNames: ['Reuters', 'Moomoo', 'AP News'],
  score: 2.58,
  ...over,
});

test('a stored story is re-checked: blocked outlets leave its count, a blocked lead drops it', () => {
  const trimmed = gk.recheck(stored()).keep;
  assert.deepEqual(trimmed.outletNames, ['Reuters', 'AP News']);
  assert.equal(trimmed.outlets, 2);
  assert.equal(gk.recheck(stored({ outletNames: ['Reuters', 'AP News'], outlets: 2 })).keep.outlets, 2, 'nothing to remove, nothing changes');
  assert.equal(gk.recheck(stored({ source: 'Pluang', outletNames: ['Pluang', 'AP News'] })).drop, 'quality:publisher');
  assert.equal(gk.recheck(stored({ outletNames: ['Reuters', '아시아경제'] })).keep.outletNames.length, 1);
  assert.equal(gk.recheck(stored({ title: 'Cloudflare outage knocks thousands of sites offline...' })).drop, 'quality:truncated');
  assert.equal(gk.recheck(stored({ title: '[Photo] Cloudflare outage knocks thousands of sites offline' })).drop, 'quality:tag');
});

test('a full run never stores the dropped headlines, and cleans old ones out of the archive', async () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'data', 'days'), { recursive: true });
  const old = stored({ id: 'old1', title: 'Bitcoin plunges 17.7% from $75k to $62k amid he...', cat: 'markets', source: 'Pluang', outletNames: ['Pluang'], outlets: 1 });
  fs.writeFileSync(
    path.join(root, 'data', 'days', '2026-11-16.json'),
    JSON.stringify({ date: '2026-11-16', score: 11, fired: [], bumps: [], stories: [old], updatedAt: '2026-11-16T15:00:00.000Z' }),
  );
  const at = (h) => Date.parse('2026-11-16T15:00:00Z') + h * 60e3;
  const items = [
    newsItem({ title: 'The Genius Meta Muse Black Friday Hack You Absolutely Must Know', source: 'note', cat: 'hacks', url: 'https://note.example/1', publishedAt: at(1) }),
    newsItem({ title: '[Photo] KOSPI falls below 5,000 intraday...', source: '아시아경제', cat: 'markets', url: 'https://kr.example/1', publishedAt: at(2) }),
    newsItem({ title: '[U.S. Stocks] Dow plunges $739 ... Replacement', source: 'Moomoo', cat: 'markets', url: 'https://moomoo.example/1', publishedAt: at(3) }),
    newsItem({ title: 'Cloudflare outage knocks thousands of sites offline', source: 'Reuters', url: 'https://reuters.example/1', publishedAt: at(4) }),
  ];
  const { latest, report } = await runUpdate({ root, now: '2026-11-16T22:00:00Z', env: {}, config: cfg, sources: [fakeSource('google', { count: items.length, items })] });
  assert.deepEqual(latest.stories.map((s) => s.title), ['Cloudflare outage knocks thousands of sites offline']);
  assert.deepEqual(readJson(path.join(root, 'data', 'days', '2026-11-16.json')).stories.map((s) => s.source), ['Reuters']);
  assert.equal(report.dropped['quality:publisher'], 2);
  assert.equal(report.dropped['quality:script'], 1);
  assert.equal(report.cleaned['quality:publisher'], 1, 'the stored Pluang story is cleaned out');
});
