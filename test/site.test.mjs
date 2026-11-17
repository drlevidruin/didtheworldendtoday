// The site: what `npm run build` writes into dist/ from data and editions, checked
// against SPEC sections 8, 9 and 10 and the day-by-day design. Everything runs
// offline on data made in a temp folder. The committed data is only read, never written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import resvg from '@resvg/resvg-js';
import { config } from '../scripts/config.mjs';
import { build, publicCopy } from '../scripts/build.mjs';
import { runUpdate } from '../scripts/update.mjs';
import { createServer, resolveStatic, SUBFOLDER } from '../scripts/serve.mjs';
import * as copy from '../scripts/templates/copy.mjs';
import { almanacRows, headline as headlineRow, headlines as headlineRows, row as dayRow, rows as dayRows, rowsMore } from '../scripts/templates/parts.mjs';
import { CSP } from '../scripts/templates/layout.mjs';
import { QUIPS, QUIP_CSP, QUIP_SCRIPT, quipFor } from '../scripts/templates/quips.mjs';
import { feedXml } from '../scripts/templates/feed.mjs';
import { esc, num, url } from '../scripts/templates/esc.mjs';
import { capFirst, firstSentence, joinNames } from '../scripts/lib/text.mjs';
import { headlineLink, isUsPlace, quietCard } from '../scripts/lib/quietcards.mjs';
import { validateEdition } from '../scripts/lib/editions.mjs';
import { createGatekeeper } from '../scripts/lib/pipeline.mjs';
import { BODY, DISPLAY, drawable, faviconSvg, readCmap, fitQuestion, fitSentence, fontFilesIn, ogSvg, questionText, renderPng } from '../scripts/templates/graphics.mjs';
import { INK, RED, WHITE, YELLOW } from '../scripts/templates/palette.mjs';
import { css, css404 } from '../scripts/templates/css.mjs';
import * as usgs from '../scripts/sources/usgs.mjs';
import * as faa from '../scripts/sources/faa.mjs';
import * as jpl from '../scripts/sources/jpl.mjs';
import { fakeSource, fixture, fixtureJson, newsItem, readJson, REPO, tmpRoot } from './helpers.mjs';

const cfg = config();
// The fixture has a day before the real first edition, so it builds with an earlier floor.
const EARLY = { ...cfg, firstEdition: '2026-11-14' };
const SITE = 'https://didtheworldendtoday.com';
const BUILD_AT = '2026-11-16T22:30:00Z';
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

// ---- data made the way the pipeline makes it -----------------------------------------

const T = {
  flights: ['Flights grounded at Newark after system glitch', 'Southwest flights delayed by a major IT outage', 'Airlines recover after nationwide FAA ground stop'],
  hacks: ['Hackers breach customer database at retailer', 'Data breach exposes millions of customer records', 'Ransomware attack takes city systems offline'],
  internet: ['Cloudflare outage knocks thousands of sites offline', 'Major AWS outage disrupts popular apps', 'Slack is down for users across the US'],
  grid: ['Rolling blackouts hit regional grid as demand spikes', 'Power outage leaves 50,000 customers in the dark', 'Blackout hits city after substation failure'],
  markets: ['Stocks plunge in sudden flash crash', 'Trading halted as Nasdaq selloff deepens', 'Bitcoin crashes below 60,000 in wild swing'],
};
const PUBS = ['Pub A', 'Pub B', 'Pub C'];
const cat3 = (cat, at) => T[cat].map((title, i) => newsItem({ cat, title, source: PUBS[i], url: `https://pub${i}.example/${cat}/${i}`, publishedAt: Date.parse(at) }));
const feed = (items, id = 'google') => fakeSource(id, { count: items.length, items });

async function seedRoot() {
  const root = tmpRoot('dtwet-site-');
  const run = (now, sources) => runUpdate({ root, now, env: {}, sources, config: EARLY });
  await run('2026-11-15T23:00:00Z', [feed(cat3('grid', '2026-11-15T15:00:00Z'))]);
  const at = new Date(BUILD_AT);
  const quake = usgs.parseUsgs(fixtureJson('usgs.json'), { minMag: 6 });
  const stop = faa.parseFaa(fixture('faa-stops.xml'), cfg.faa);
  const rock = jpl.parseCad(fixtureJson('jpl.json'), at, cfg.signals);
  const news = ['flights', 'hacks', 'internet', 'markets'].flatMap((c) => cat3(c, '2026-11-16T20:00:00Z'));
  const pages = [
    { id: 'github', name: 'GitHub', indicator: 'none', description: 'All Systems Operational' },
    { id: 'cloudflare', name: 'Cloudflare', indicator: 'minor', description: 'Minor Service Outage' },
    { id: 'claude', name: 'Claude', indicator: 'minor', description: 'Minor Service Outage' },
  ];
  await run(BUILD_AT, [
    feed(news),
    fakeSource('usgs', { count: 1, vital: { quake: quake.vital }, signals: quake.signals }),
    fakeSource('faa', { count: 2, vital: { faa: faa.faaVital(stop) }, signals: faa.faaSignals(stop, at.getTime()) }),
    fakeSource('jpl', { count: 1, vital: { asteroid: rock.vital }, signals: rock.signals }),
    fakeSource('swpc', { count: 1, vital: { kp: { value: 3.3, time: '2026-11-16T21:00:00.000Z', max24: 4 } } }),
    fakeSource('status', { count: 2, vital: { status: { worst: 'minor', pages, unreachable: 0 } } }),
  ]);
  return root;
}

// Stories no pipeline would let through. The page must still be safe if one ever
// gets into the data by another road.
const HOSTILE = [
  {
    id: 'hostile:1',
    kind: 'news',
    cat: 'internet',
    title: '<img src=x onerror=alert(1)>',
    url: 'javascript:alert(1)',
    source: '<script>alert(2)</script>',
    publishedAt: '2026-11-16T21:00:00.000Z',
    firstSeenAt: '2026-11-16T21:00:00.000Z',
    outlets: 2,
    outletNames: ['<b>x</b>', 'y'],
    score: 40,
  },
  {
    id: 'hostile:2',
    kind: 'news',
    cat: 'hacks',
    title: '" onmouseover="alert(3)" x="',
    url: 'https://example.com/?q="><script>alert(4)</script>',
    source: "O'Reilly & <Sons>",
    publishedAt: '2026-11-16T20:50:00.000Z',
    firstSeenAt: '2026-11-16T20:50:00.000Z',
    outlets: 1,
    outletNames: ["O'Reilly & <Sons>"],
    score: 39,
  },
];

const latestFile = (root) => path.join(root, 'data', 'latest.json');
const dayFile = (root, d) => path.join(root, 'data', 'days', `${d}.json`);
const edit = (file, fn) => {
  const json = readJson(file);
  fn(json);
  fs.writeFileSync(file, JSON.stringify(json));
};

function plant(root) {
  edit(latestFile(root), (l) => l.stories.splice(3, 0, ...HOSTILE));
  edit(dayFile(root, '2026-11-16'), (d) => d.stories.splice(3, 0, ...HOSTILE));
}

function copyRoot(root) {
  const next = tmpRoot('dtwet-site-copy-');
  fs.cpSync(path.join(root, 'data'), path.join(next, 'data'), { recursive: true });
  return next;
}

const root = await seedRoot();
plant(root);
const result = build(root, { siteUrl: SITE, config: EARLY });
const dist = result.dist;
const latest = readJson(latestFile(root));
const read = (rel, base = dist) => fs.readFileSync(path.join(base, rel), 'utf8');
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#96;/g, '`').replace(/&amp;/g, '&');
const attr = (html, name) => {
  const m = html.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? unesc(m[1]) : null;
};

function listDist(base) {
  const map = new Map();
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else map.set(path.relative(base, full).split(path.sep).join('/'), full);
    }
  })(base);
  return map;
}

const TEXT = /\.(html|json|xml|txt|svg|js|webmanifest)$/;
const has = (html, needle) => assert.ok(html.includes(needle), `missing: ${String(needle).slice(0, 90)}`);

function pngSize(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file} is a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

// ---- the checks every build must pass (SPEC section 10) ------------------------------
//
// Two kinds of check, kept apart on purpose.
//  - Structure: every page and file exists, JSON and XML parse, every internal link lands on a
//    file, the pictures are the right size, nothing runs inline, and nothing our own templates
//    print says undefined, NaN or [object.
//  - Our words: no long dash, no repository link, no javascript: link, no real name.
// A fixture build holds only text we wrote, so it gets both. A live build holds whatever
// publishers sent, and one odd headline must never block a deploy, so it gets structure only,
// with the publishers' own text taken out of what is scanned (`live` is the list of those
// strings, see thirdPartyStrings). Our own static pages are still held to the words.

// The four web fonts the pages use: League Gothic for the big type, Libre Franklin 400, 600 and 700 for the rest.
// Each font's license ships beside them.
const WEB_FONTS = ['leaguegothic.woff2', 'librefranklin-400.woff2', 'librefranklin-600.woff2', 'librefranklin-700.woff2'];
const FONT_LICENSES = ['OFL-LeagueGothic.txt', 'OFL-LibreFranklin.txt'];
// A font license names the font's own project address, so it is the one text file allowed to say github.com.
const isLicense = (rel) => /^assets\/OFL-[A-Za-z]+\.txt$/.test(rel);
const TOKENS = ['undefined', 'NaN', '[object'];
// Words and hooks of features that were cut. They are ours, so no page may say them.
const CUT_WORDS = ['Doom Bingo', 'Vital signs', 'The receipts', 'Check again', 'Closest call today', 'Your first check'];
const CUT_HOOKS = ['id="bingo"', 'id="vitals"', 'id="receipts"', 'id="lead"', 'id="almanac"', 'id="streak"', 'class="cell', 'class="btns"', 'class="chips"', 'class="chip'];
const OWN_FILES = new Set(['about/index.html', '404.html', 'assets/app.js', 'robots.txt', 'site.webmanifest', 'favicon.svg']);
const xmlEsc = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// Every string a publisher or an instrument sent, in the shapes it takes on a page, in JSON and in the feed.
function thirdPartyStrings(dataRoot) {
  const found = new Set();
  const walk = (value, min) => {
    if (typeof value === 'string') {
      if (value.length >= min) found.add(value);
    } else if (Array.isArray(value)) value.forEach((v) => walk(v, min));
    else if (value && typeof value === 'object') Object.values(value).forEach((v) => walk(v, min));
  };
  const dir = path.join(dataRoot, 'data');
  const files = [path.join(dir, 'latest.json')];
  const days = path.join(dir, 'days');
  if (fs.existsSync(days)) for (const name of fs.readdirSync(days)) files.push(path.join(days, name));
  for (const file of files) {
    let json = null;
    try {
      json = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    for (const story of json && Array.isArray(json.stories) ? json.stories : []) {
      if (story && typeof story === 'object') walk([story.title, story.source, story.url, story.outletNames], 3);
    }
    walk(json && json.vital, 8);
  }
  // The editor writes the edition files at run time, so their headline and lines are live text too: the audit checks the page's
  // structure, never a model's words, and a line it wrote can never fail a deploy.
  const editions = path.join(dir, 'editions');
  if (fs.existsSync(editions)) {
    for (const name of fs.readdirSync(editions)) {
      let edition = null;
      try {
        edition = JSON.parse(fs.readFileSync(path.join(editions, name), 'utf8'));
      } catch {
        continue;
      }
      if (!edition || typeof edition !== 'object') continue;
      walk(edition.headline, 3);
      for (const item of Array.isArray(edition.items) ? edition.items : []) {
        if (item && typeof item === 'object') walk([item.line, item.title, item.source, item.url], 3);
      }
    }
  }
  const shapes = new Set();
  for (const text of found) for (const shape of [text, esc(text), xmlEsc(text), xmlEsc(esc(text)), JSON.stringify(text).slice(1, -1), url(text)]) if (shape.length >= 3) shapes.add(shape);
  return [...shapes].sort((a, b) => b.length - a.length);
}

const without = (text, strings) => strings.reduce((rest, one) => (rest.includes(one) ? rest.split(one).join(' ') : rest), text);

// The jokes under ALMOST. are our own words and the list holds all 100 of them in the page's one inline script, one of
// which says "The receipts are below." The words of the cut features are looked for in the page without the jokes.
const withoutQuips = (text) => text.replace(/(<p class="deck" id="quip">)[^<]*(<\/p>)<script>[\s\S]*?<\/script>/, '$1$2');

function isInternal(ref) {
  return ref.trim() !== '' && !/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(ref);
}

function refsIn(html) {
  const out = [];
  for (const m of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) out.push(unesc(m[1]));
  for (const m of html.matchAll(/url\(([^)]+)\)/g)) out.push(m[1].replace(/^["']|["']$/g, ''));
  return out;
}

function auditSite(base, { label = 'site', needDay = true, live = null } = {}) {
  const files = listDist(base);
  const strings = live || [];
  const tokens = live ? TOKENS.filter((t) => !strings.some((one) => one.includes(t))) : TOKENS;
  const ownWords = (rel) => !live || OWN_FILES.has(rel);
  const ours = (text) => (live ? without(text, strings) : text);
  const pages = [...files.keys()].filter((r) => r.endsWith('.html'));
  for (const need of ['index.html', 'about/index.html', 'almanac/index.html', '404.html', 'feed.xml', 'api/today.json', 'og/latest.png', 'robots.txt', 'sitemap.xml', 'favicon.svg', 'apple-touch-icon.png', 'site.webmanifest', 'assets/app.js', ...WEB_FONTS.map((f) => `assets/${f}`), ...FONT_LICENSES.map((f) => `assets/${f}`)]) {
    assert.ok(files.has(need), `${label}: ${need} exists`);
  }
  assert.ok(!files.has('CNAME') && !files.has('.nojekyll'), `${label}: no CNAME and no .nojekyll`);
  if (needDay) assert.ok(pages.some((p) => p.startsWith('day/')), `${label}: at least one day page`);

  for (const [rel, full] of files) {
    if (rel.endsWith('.png')) {
      const [w, h] = pngSize(full);
      if (rel.startsWith('og/')) assert.deepEqual([w, h], [1200, 630], `${label}: ${rel} is 1200x630`);
      if (rel === 'apple-touch-icon.png') assert.deepEqual([w, h], [180, 180], `${label}: apple-touch-icon is 180x180`);
      continue;
    }
    if (!TEXT.test(rel)) continue;
    const text = fs.readFileSync(full, 'utf8');
    for (const t of tokens) assert.ok(!ours(text).includes(t), `${label}: ${rel} contains ${t}`);
    if (ownWords(rel)) {
      for (const d of [EM, EN]) assert.ok(!text.includes(d), `${label}: ${rel} contains a long dash`);
      if (!isLicense(rel)) assert.ok(!/github\.com/i.test(text), `${label}: ${rel} links the repository`);
      assert.ok(!/drlevidruin|levidruin/i.test(text), `${label}: ${rel} names a person`);
    }
    if (rel.endsWith('.json') || rel.endsWith('.webmanifest')) JSON.parse(text);
    if (rel.endsWith('.xml')) assert.equal(XMLValidator.validate(text), true, `${label}: ${rel} is valid XML`);
  }

  const sized = (rel) => fs.statSync(files.get(rel)).size;
  assert.ok(sized('index.html') < 100 * 1000, `${label}: index.html is ${sized('index.html')} bytes`);
  assert.ok(sized('assets/app.js') < 15 * 1000, `${label}: app.js is ${sized('assets/app.js')} bytes`);
  for (const font of WEB_FONTS) assert.ok(sized(`assets/${font}`) < 50 * 1000, `${label}: ${font} is ${sized(`assets/${font}`)} bytes`);
  assert.ok(!files.has('assets/anton.woff2') && ![...files.keys()].some((f) => /newsreader/i.test(f)), `${label}: the old fonts are gone`);
  assert.deepEqual([...files.keys()].filter((f) => /\.(?:ttf|otf|woff)$/.test(f)), [], `${label}: no font file but the four woff2 ships`);
  for (const license of FONT_LICENSES) assert.match(fs.readFileSync(files.get(`assets/${license}`), 'utf8'), /SIL OPEN FONT LICENSE Version 1\.1/, `${label}: ${license} is the license text`);

  for (const rel of pages) {
    const raw = fs.readFileSync(files.get(rel), 'utf8');
    const html = ours(raw);
    const where = `${label}: ${rel}`;
    assert.ok(raw.startsWith(`<!doctype html>\n<!-- ${copy.COMMENT} -->\n<html lang="en"`) || rel === '404.html', `${where} opens with the comment`);
    if (rel === '404.html') assert.ok(raw.includes(`<!-- ${copy.COMMENT} -->`), `${where} has the comment`);
    assert.ok(raw.includes(`<meta http-equiv="Content-Security-Policy" content="${esc(CSP)}">`), `${where} has the policy`);
    for (const word of CUT_WORDS) assert.ok(!withoutQuips(html).includes(word), `${where} still says "${word}"`);
    for (const hook of CUT_HOOKS) assert.ok(!raw.includes(hook), `${where} still has ${hook}`);
    // "chip" is a word a publisher's headline can use, so only a build of text we wrote is held to it
    if (!live) assert.ok(!/\bchips?\b/i.test(withoutQuips(raw)), `${where} mentions a chip`);
    assert.ok(/<title>[^<]+<\/title>/.test(raw), `${where} has a title`);
    for (const tag of ['og:title', 'og:description', 'og:image', 'og:url']) assert.ok(raw.includes(`property="${tag}"`), `${where} has ${tag}`);
    assert.ok(raw.includes('name="twitter:card" content="summary_large_image"') && raw.includes('name="twitter:image"'), `${where} has the twitter card`);
    assert.ok(raw.includes('<meta name="twitter:site" content="@thelpdrive">'), `${where} names the account on the twitter card`);
    const image = raw.match(/property="og:image" content="([^"]+)"/)[1];
    assert.ok(image.startsWith(`${SITE}/og/`) && image.endsWith('.png'), `${where} points the share image at this site`);
    assert.ok(files.has(image.slice(SITE.length + 1)), `${where}: ${image} exists`);

    // nothing runs inline but the one quip script, which the page policy allows by its hash, and nothing loads from elsewhere
    const scripts = [...raw.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    for (const [, one] of scripts.filter((m) => /\ssrc=/.test(m[1]))) assert.ok(/\ssrc="[^"]*assets\/app\.js"/.test(one) && !/https?:/.test(one), `${where}: only the one local script`);
    const inline = scripts.filter((m) => !/\ssrc=/.test(m[1]));
    assert.ok(inline.length <= 1, `${where}: at most one inline script`);
    for (const [, attrs, text] of inline) {
      assert.equal(attrs, '', `${where}: the inline script has no attributes`);
      assert.equal(text, QUIP_SCRIPT, `${where}: and it is the quip script`);
      assert.ok(CSP.includes(`'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`), `${where}: the policy allows it by its hash`);
    }
    assert.ok(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(html), `${where} has an inline event handler`);
    assert.ok(!/<[a-z][^>]*\sstyle\s*=/i.test(html), `${where} has an inline style attribute`);
    assert.ok(!/href="\s*javascript:/i.test(raw), `${where} has a javascript: link`);
    if (ownWords(rel)) assert.ok(!/javascript:/i.test(raw), `${where} says javascript:`);
    for (const m of raw.matchAll(/<(?:script|img|iframe|link)\b[^>]*>/gi)) {
      const tag = m[0];
      if (/rel="(?:canonical|alternate)"/.test(tag)) continue;
      const target = tag.match(/\s(?:src|href)="([^"]*)"/);
      if (target) assert.ok(!/^(?:https?:)?\/\//i.test(target[1]), `${where} loads ${target[1]} from elsewhere`);
    }
    for (const m of raw.matchAll(/<a\b[^>]*\shref="(https?:[^"]*)"[^>]*>/g)) {
      if (m[1].startsWith(SITE)) continue;
      assert.ok(/target="_blank"/.test(m[0]) && /rel="noopener"/.test(m[0]), `${where}: ${m[1]} opens in a new tab with noopener`);
    }

    // every relative reference lands on a file, from the root and from a subfolder.
    // Read from `html`, the page without the publishers' words: a headline that says "url(x)" is text, not a reference.
    const pagePath = `/${rel.replace(/index\.html$/, '')}`;
    for (const ref of refsIn(html).filter(isInternal)) {
      assert.ok(!ref.startsWith('/'), `${where}: ${ref} is root-absolute`);
      for (const prefix of ['', SUBFOLDER]) {
        const target = new URL(ref, `http://example.test${prefix}${pagePath}`);
        if (prefix) assert.ok(target.pathname.startsWith(`${prefix}/`), `${where}: ${ref} escapes the subfolder`);
        const hit = resolveStatic(base, target.pathname, { prefix });
        assert.equal(hit.status, 200, `${where}: ${ref} (${prefix || 'root'}) is ${hit.status}`);
        assert.ok(fs.existsSync(hit.file), `${where}: ${ref} is a file`);
      }
    }
  }

  // the sitemap and the feed name pages that exist
  for (const doc of ['sitemap.xml', 'feed.xml']) {
    const text = fs.readFileSync(files.get(doc), 'utf8');
    for (const m of text.matchAll(/<(?:loc|link)>([^<]+)<\/(?:loc|link)>/g)) {
      if (!m[1].startsWith(SITE)) continue;
      const hit = resolveStatic(base, new URL(m[1]).pathname, { prefix: '' });
      assert.equal(hit.status, 200, `${label}: ${doc} lists ${m[1]}`);
    }
  }
  const manifest = JSON.parse(fs.readFileSync(files.get('site.webmanifest'), 'utf8'));
  for (const icon of manifest.icons) assert.ok(files.has(icon.src), `${label}: manifest icon ${icon.src}`);
  return { files, pages };
}

// ---- the build, as a whole ---------------------------------------------------------------

test('the build writes every page and file the spec names, and the pipeline data passes every check', () => {
  assert.equal(result.hasData, true);
  assert.deepEqual(result.days, ['2026-11-16', '2026-11-15']);
  for (const rel of ['day/2026-11-15/index.html', 'day/2026-11-16/index.html', 'og/2026-11-15.png', 'og/2026-11-16.png']) assert.ok(fs.existsSync(path.join(dist, rel)), rel);
  const { pages } = auditSite(dist, { label: 'fixture' });
  assert.deepEqual(pages.sort(), ['404.html', 'about/index.html', 'almanac/index.html', 'day/2026-11-15/index.html', 'day/2026-11-16/index.html', 'index.html']);
});

test('the committed data builds into a sound site too, whatever the world sent', () => {
  const real = tmpRoot('dtwet-real-');
  fs.cpSync(path.join(REPO, 'data'), path.join(real, 'data'), { recursive: true });
  const out = build(real, { siteUrl: SITE });
  assert.equal(out.hasData, true, 'data/latest.json is committed');
  // Live data is whatever publishers sent, so only the structure is audited, never their words.
  auditSite(out.dist, { label: 'committed data', live: thirdPartyStrings(real) });
  const stored = readJson(path.join(REPO, 'data', 'latest.json'));
  assert.ok(stored.score >= 0 && stored.score <= 99);
  assert.ok(read('index.html', out.dist).includes('ALMOST.'));
});

test('an edition the editor wrote can use words we cut from our own pages and the audit still passes: model text never fails a deploy', () => {
  const real = tmpRoot('dtwet-model-');
  fs.cpSync(path.join(REPO, 'data'), path.join(real, 'data'), { recursive: true });
  const day = readJson(path.join(real, 'data', 'latest.json')).etDate;
  const lines = [
    "Doom Bingo is back, and so are The receipts. Check again later, it's fine.",
    'The Nvidia chips went down & up again.',
    'Your first check found nothing. Vital signs look fine.',
  ];
  const edition = {
    date: day,
    by: 'editor',
    writtenAt: `${day}T15:00:00.000Z`,
    headline: 'Check again tomorrow for more of this news. Doom Bingo is not coming back. Still here.',
    items: lines.map((line, i) => ({
      emoji: '\u{1F527}',
      line,
      ids: [`model:${i}`],
      best: i === 0,
      quiet: false,
      cat: 'internet',
      title: `Model title ${i}`,
      url: `https://example.com/model/${i}`,
      source: 'Example',
      outlets: 2,
    })),
  };
  fs.mkdirSync(path.join(real, 'data', 'editions'), { recursive: true });
  fs.writeFileSync(path.join(real, 'data', 'editions', `${day}.json`), JSON.stringify(edition));
  const out = build(real, { siteUrl: SITE });
  const home = read('index.html', out.dist);
  for (const line of lines) assert.ok(home.includes(esc(line)), `the page carries the model's line: ${line}`);
  assert.equal(todayHeadline(out.dist), 'Check again tomorrow for more of this news. Doom Bingo is not coming back. Still here.', 'and its headline is in the data file');
  assert.ok(read(`day/${day}/index.html`, out.dist).includes('Check again tomorrow for more of this news. Doom Bingo is not coming back. Still here.'), 'and on the day page');
  auditSite(out.dist, { label: 'model text', live: thirdPartyStrings(real) });
});

test('a live headline that links github.com, says javascript: or holds a long dash does not fail the audit', () => {
  const r = copyRoot(root);
  const odd = {
    id: 'live:odd',
    kind: 'news',
    cat: 'internet',
    title: `GitHub Actions delayed, javascript:void(0) ${EM} status page says github.com is investigating`,
    url: 'https://github.com/example/status/issues/1',
    source: 'github.com',
    publishedAt: '2026-11-16T21:30:00.000Z',
    firstSeenAt: '2026-11-16T21:30:00.000Z',
    outlets: 3,
    outletNames: ['github.com', 'Pub B', 'Pub C'],
    score: 90,
  };
  edit(latestFile(r), (l) => l.stories.unshift(odd));
  edit(dayFile(r, '2026-11-16'), (d) => d.stories.unshift(odd));
  const out = build(r, { siteUrl: SITE, config: EARLY });
  const home = read('index.html', out.dist);
  assert.ok(home.includes('https://github.com/example/status/issues/1') && home.includes('javascript:void(0)') && home.includes(EM), 'the page really carries the odd headline');
  const strings = thirdPartyStrings(r);
  assert.ok(strings.includes(odd.title) && strings.includes(odd.url), 'its text is what gets left out of the scan');
  // The live audit passes: it checks the structure and our own words, not the headline.
  auditSite(out.dist, { label: 'live', live: strings });
  // The word rules are for a build of text we wrote. Held against this build they do refuse it, which proves the two are kept apart.
  assert.throws(() => auditSite(out.dist, { label: 'words' }), /long dash|repository|javascript/);
});

test('a live headline that says url(x) is text, not a reference, so it cannot block a deploy', () => {
  const r = copyRoot(root);
  const odd = {
    id: 'live:css',
    kind: 'news',
    cat: 'internet',
    title: 'Outage hits video sites as error page shows url(x) and url( ) in the banner',
    url: 'https://example.test/status/css',
    source: 'example.test',
    publishedAt: '2026-11-16T21:30:00.000Z',
    firstSeenAt: '2026-11-16T21:30:00.000Z',
    outlets: 3,
    outletNames: ['example.test', 'Pub B', 'Pub C'],
    score: 90,
  };
  edit(latestFile(r), (l) => l.stories.unshift(odd));
  edit(dayFile(r, '2026-11-16'), (d) => d.stories.unshift(odd));
  const out = build(r, { siteUrl: SITE, config: EARLY });
  const home = read('index.html', out.dist);
  assert.ok(home.includes('url(x)') && home.includes('url( )'), 'the page really carries the headline');
  // The live audit reads the page with the publishers' words taken out, so the headline is not a reference.
  auditSite(out.dist, { label: 'live url(x)', live: thirdPartyStrings(r) });
  // Held against the whole page, the same words would read as a missing file, which is what the live audit must not do.
  assert.throws(() => auditSite(out.dist, { label: 'words' }), /url|is 404|is a file/);
});

test('with no data at all the build still writes a whole site that says ALMOST.', () => {
  const none = tmpRoot('dtwet-none-');
  const out = build(none, { siteUrl: SITE, now: BUILD_AT });
  assert.equal(out.hasData, false);
  auditSite(out.dist, { label: 'no data', needDay: false });
  assert.ok(read('index.html', out.dist).includes('>ALMOST.<'));
});

test('ragged data never prints undefined, NaN or [object]', () => {
  const rag = tmpRoot('dtwet-ragged-');
  fs.mkdirSync(path.join(rag, 'data', 'days'), { recursive: true });
  const ragged = {
    schema: 1,
    etDate: '2026-11-16',
    buildTime: BUILD_AT,
    score: '74',
    fired: ['flights', 'nope'],
    bumps: [{ key: 'x', points: 'lots' }, null],
    headlinesRead: 'many',
    lastSuccessAt: null,
    change: 'up',
    record: { date: 'someday', score: 'high' },
    stories: [
      {},
      { id: 'b', cat: 'zzz', title: null, url: 42, source: undefined, publishedAt: 'garbage', outlets: 'many', score: 'x' },
      { id: 'c', cat: 'flights', title: 'A real one', url: 'https://example.com/c', source: 'Example', publishedAt: '2026-11-16T20:00:00Z', outlets: -3 },
    ],
    vital: { quake: {}, kp: { value: 'high' }, asteroid: { ld: 'close', at: 'soon' }, faa: { groundStops: 'many' }, status: { pages: 'none', worst: 7 }, clock: {} },
    quiet: { quiet: 'yes' },
  };
  fs.writeFileSync(path.join(rag, 'data', 'latest.json'), JSON.stringify(ragged));
  fs.writeFileSync(path.join(rag, 'data', 'days', '2026-11-16.json'), JSON.stringify({ date: '2026-11-16', score: 'abc', stories: [{}, { title: 7 }, 'text', null] }));
  fs.writeFileSync(path.join(rag, 'data', 'days', 'not-a-date.json'), '{}');
  const out = build(rag, { siteUrl: SITE });
  auditSite(out.dist, { label: 'ragged' });
});

test('a very busy day stays under 100 KB: the day page leaves its lowest headlines off, and the data file keeps every story', () => {
  const busy = tmpRoot('dtwet-busy-');
  fs.mkdirSync(path.join(busy, 'data', 'days'), { recursive: true });
  const cats = cfg.categories.map((c) => c.id);
  const stories = Array.from({ length: 200 }, (_, i) => ({
    id: `s${i}`,
    kind: 'news',
    cat: cats[i % cats.length],
    title: `Story number ${i} with a long headline that goes on and on to take up room on the page and then some more`,
    url: `https://news${i}.example.com/${'section/'.repeat(40)}story-${i}?utm_source=${'x'.repeat(200)}`,
    source: `Publisher ${i}`,
    publishedAt: '2026-11-16T20:00:00.000Z',
    firstSeenAt: '2026-11-16T20:00:00.000Z',
    outlets: 3,
    outletNames: ['a', 'b', 'c'],
    score: 200 - i,
  }));
  fs.writeFileSync(path.join(busy, 'data', 'latest.json'), JSON.stringify({ ...latest, stories }));
  fs.writeFileSync(path.join(busy, 'data', 'days', '2026-11-16.json'), JSON.stringify({ date: '2026-11-16', score: latest.score, fired: latest.fired, bumps: [], stories, updatedAt: BUILD_AT }));
  const out = build(busy, { siteUrl: SITE, config: EARLY });
  const home = read('index.html', out.dist);
  assert.ok(Buffer.byteLength(home) < 100 * 1000, `index.html is ${Buffer.byteLength(home)} bytes`);
  assert.equal((home.match(/<li class="row/g) || []).length, cfg.edition.fallbackRows, 'the homepage shows a handful of rows, not the day');
  assert.ok(home.includes('Every headline we read today (200)'), 'and the footer says how many there are, with a door to the day page that lists them');
  // today's See more holds the other headlines, and a page over its budget gives up the lowest of them
  const homeHeads = (home.match(/<li class="hd/g) || []).length;
  assert.ok(homeHeads >= 10 && homeHeads < 195, `${homeHeads} of the other headlines are on the homepage`);
  assert.ok(home.includes(`<summary>See ${homeHeads} more headlines</summary>`), 'and the See more counts the ones that are there');
  const day = read('day/2026-11-16/index.html', out.dist);
  assert.ok(Buffer.byteLength(day) < 100 * 1000, `the day page is ${Buffer.byteLength(day)} bytes`);
  const shown = (day.match(/<li class="hd/g) || []).length;
  assert.ok(shown >= 30 && shown < 200, `${shown} headlines shown`);
  assert.ok(day.includes('Story number 0 '), 'the top story stays');
  assert.equal(readJson(path.join(out.dist, 'api', 'today.json')).stories.length, 200, 'the data file keeps every story');
  const small = build(busy, { siteUrl: SITE, config: EARLY, pageBudget: 50 * 1000 });
  assert.ok(fs.statSync(path.join(small.dist, 'day', '2026-11-16', 'index.html')).size <= 50 * 1000, 'a smaller budget trims the day page further');
  assert.ok(fs.statSync(path.join(small.dist, 'index.html')).size <= 50 * 1000, 'and the homepage stays inside it');
  const smallHeads = (read('index.html', small.dist).match(/<li class="hd/g) || []).length;
  assert.ok(smallHeads >= 1 && smallHeads < homeHeads, `a smaller budget trims the homepage's headlines too: ${smallHeads}`);
});


// ---- the editions these tests write ---------------------------------------------------------
//
// The seeded site has no editions, so every day shows its plain headlines. The edition
// site is the same data with two hand-written editions next to it, one per day.

const gk = createGatekeeper(EARLY);
const stored15 = readJson(dayFile(root, '2026-11-15'));
const stored16 = readJson(dayFile(root, '2026-11-16'));
const storyOf = (day, start) => {
  const hit = day.stories.find((s) => s.title.startsWith(start));
  assert.ok(hit, `fixture story "${start}"`);
  return hit;
};
const itemOf = (s, emoji, label, line, over = {}) => ({ emoji, label, line, ids: [s.id], quiet: false, cat: s.cat, title: s.title, url: s.url, source: s.source, outlets: s.outlets, ...over });

const AIRLINES = storyOf(stored16, 'Airlines recover');
const AWS = storyOf(stored16, 'Major AWS outage');
const BREACH = storyOf(stored16, 'Data breach exposes');
const NASDAQ = storyOf(stored16, 'Trading halted');
const ROCK = storyOf(stored16, 'Asteroid 2026 WA');
const QUAKE = storyOf(stored16, 'M 6.6');
const SUBSTATION = storyOf(stored15, 'Blackout hits city');
const FIFTY = storyOf(stored15, 'Power outage leaves');
const ROLLING = storyOf(stored15, 'Rolling blackouts');

const ED16 = {
  date: '2026-11-16',
  by: 'hand',
  writtenAt: '2026-11-17T09:16:00.000Z',
  headline: 'A nationwide ground stop kept planes on the tarmac for hours. Still here.',
  items: [
    itemOf(AIRLINES, '✈️', 'Ground stop', 'Airlines are digging out after a nationwide ground stop. Your bag is probably fine.'),
    itemOf(AWS, '🖥️', 'AWS outage', 'A big AWS outage knocked a bunch of your favorite apps offline for a while.'),
    itemOf(BREACH, '🔓', 'Retail breach', 'A retailer lost millions of customer records. Good day to change a password.'),
    itemOf(NASDAQ, '📉', 'Nasdaq halt', 'Trading got halted as the Nasdaq slid. It usually comes back.'),
    itemOf(ROCK, '☄️', 'Asteroid pass', "An asteroid the size of a bus passed us at a third of the moon's distance. It kept going."),
    itemOf(QUAKE, '🌋', 'Tual quake', 'A magnitude 6.6 quake hit near Tual, Indonesia.'),
  ],
};
const ED15 = {
  date: '2026-11-15',
  by: 'hand',
  writtenAt: '2026-11-16T04:00:00.000Z',
  headline: 'A substation failure left a whole city in the dark for a while. Still here.',
  items: [
    itemOf(SUBSTATION, '⚡', 'City blackout', 'A substation failed and a whole city lost power for a while.'),
    itemOf(FIFTY, '🔌', 'Power outage', 'Fifty thousand customers sat in the dark. The lights came back.'),
    itemOf(ROLLING, '🌡️', 'Grid blackouts', 'Demand spiked and the regional grid rolled some blackouts. Nobody panicked.'),
  ],
};
const EDITIONS = { '2026-11-15': ED15, '2026-11-16': ED16 };

function writeEditions(r, editions = EDITIONS) {
  fs.mkdirSync(path.join(r, 'data', 'editions'), { recursive: true });
  for (const [date, raw] of Object.entries(editions)) fs.writeFileSync(path.join(r, 'data', 'editions', `${date}.json`), typeof raw === 'string' ? raw : JSON.stringify(raw));
}
const buildAt = (r, config = EARLY) => build(r, { siteUrl: SITE, config });
// A copy of the seeded site with these editions beside its days, built.
function withEditions(editions = EDITIONS, tweak = null) {
  const r = copyRoot(root);
  writeEditions(r, editions);
  if (tweak) tweak(r);
  return { root: r, ...buildAt(r) };
}

const edRoot = copyRoot(root);
writeEditions(edRoot);
const edDist = buildAt(edRoot).dist;

// ---- reading a page the way a person does --------------------------------------------------------

const heroOf = (html) => html.slice(html.indexOf('<section class="hero"'), html.indexOf('</section>', html.indexOf('<section class="hero"')) + '</section>'.length);
// The day blocks of a homepage, top to bottom.
const blocksOf = (html) => html.split('<section class="day"').slice(1).map((c) => `<section class="day"${c.slice(0, c.indexOf('</section>') + '</section>'.length)}`);
const rowsOf = (html) => html.split('<li class="row').slice(1).map((c) => `<li class="row${c.slice(0, c.indexOf('</li>') + '</li>'.length)}`);
const headsOf = (html) => html.split('<li class="hd').slice(1).map((c) => `<li class="hd${c.slice(0, c.indexOf('</li>') + '</li>'.length)}`);
function rowFacts(html) {
  const get = (re) => {
    const m = html.match(re);
    return m ? unesc(m[1]) : null;
  };
  return {
    best: /^<li class="row[^"]*\bbest\b/.test(html),
    quiet: /^<li class="row[^"]*\bquiet\b/.test(html),
    plain: /^<li class="row[^"]*\bplain\b/.test(html),
    rank: get(/<span class="rn" aria-hidden="true">([^<]*)<\/span>/),
    emoji: get(/<span class="em" aria-hidden="true">([^<]*)<\/span>/),
    // what the row says: the label over the line. A row with no label has its line where the label goes.
    label: get(/<span class="lb">([^<]*)<\/span>/),
    line: get(/<span class="ln">([^<]*)<\/span>/),
    // the source: the news site's name and nothing else
    src: get(/<span class="src">([^<]*)<\/span>/),
    href: get(/<a class="card" href="([^"]*)"/),
    cap: get(/<span class="cap">([\s\S]*?)<\/span>/),
    help: get(/<a class="help" href="([^"]*)"/),
    helpText: get(/<a class="help"[^>]*>([^<]*)<\/a>/),
  };
}
const factsIn = (html) => rowsOf(html).map(rowFacts);
// every caption on a page: a row's is inside its card, a headline's is a line of its own under it
const capsIn = (html) => [...html.matchAll(/<(?:p|span) class="cap">([^<]*)/g)].map((m) => m[1]);
// The line under ALMOST.: a quip on a normal page (it has an id, so the script can swap it) and the day's quiet line in quiet mode.
const deckOf = (html) => unesc((heroOf(html).match(/<p class="deck"(?: id="quip")?>([^<]*)<\/p>/) || [])[1] || '');
// The day's headline is not in the hero any more. A day page still says it in its description, and the homepage's is in
// api/today.json, the copy of the day the homepage shows.
const descriptionOf = (html) => unesc((html.match(/<meta name="description" content="([^"]*)">/) || [])[1] || '');
const dayHeadlineOf = (html) => descriptionOf(html).replace(/ Doom Score \d+ of \d+ on .*$/, '');
const todayHeadline = (base = dist) => readJson(path.join(base, 'api', 'today.json')).headline;
const lineCount = (html) => (html.match(/<li class="row/g) || []).length;
const wordOf = (n) => (n === 1 ? 'headline' : 'headlines');

test('the editions this file writes pass the same check the build and the editor use, so no test below passes by falling back', () => {
  for (const raw of [ED15, ED16]) {
    const byId = new Map([...stored15.stories, ...stored16.stories].map((s) => [s.id, s]));
    const checked = validateEdition(raw, { date: raw.date, byId, excluder: gk.excluder });
    assert.equal(checked.ok, true, `${raw.date}: ${checked.reason}`);
    assert.deepEqual(checked.dropped, [], `${raw.date} drops nothing`);
    assert.equal(checked.edition.items.length, raw.items.length);
  }
  assert.ok(ED16.headline.length <= cfg.edition.headlineMax && ED16.headline.endsWith('Still here.'));
  assert.equal(ED16.items.length, 6, 'the closest call and five more');
  for (const ed of [ED15, ED16]) for (const item of ed.items) assert.ok(item.label && item.label.split(' ').length <= cfg.edition.labelMaxWords, `${ed.date}: "${item.label}" is a label of one to four words`);
  // The two builds really differ: one reads the editions, one reads the plain headlines.
  assert.equal(todayHeadline(edDist), ED16.headline);
  assert.equal(todayHeadline(dist), copy.subline(latest.score));
});

// ---- the homepage ------------------------------------------------------------------------------------

test('the first screen reads top to bottom: the black band and its question, ALMOST., the headline, the Doom Score board, the line over the rows, the first row and its source', () => {
  for (const [label, base, head, firstRow] of [
    ['editions', edDist, ED16.headline, '<li class="row best'],
    ['plain headlines', dist, copy.subline(latest.score), '<li class="row plain'],
  ]) {
    const home = read('index.html', base);
    const marks = ['<main', 'class="band"', 'class="q"', 'class="hero"', 'data-act="check"', 'id="verdict"', 'class="deck"', 'role="meter"', 'class="bn"', 'class="sq"', 'id="stale"', 'id="today"', 'class="sec"', firstRow, 'class="src"', 'data-act="share"', 'class="end"', '<footer>'].map((m) => home.indexOf(m));
    assert.ok(marks.every((n) => n > 0), `${label}: ${marks}`);
    assert.deepEqual(marks, [...marks].sort((a, b) => a - b), `${label}: in this order`);
    has(home, '<div class="band"><h1 class="q">Did the world end today?</h1></div>');
    const hero = heroOf(home);
    has(hero, '<button class="vbox" type="button" data-act="check"><span class="verdict" id="verdict">ALMOST.</span><span class="check" id="check" aria-hidden="true"></span></button>');
    // the joke under ALMOST.: the quip for the date, and the one script right after it
    has(hero, `<p class="deck" id="quip">${esc(quipFor('2026-11-16'))}</p><script>${QUIP_SCRIPT}</script>`);
    assert.ok(hero.indexOf('id="verdict"') < hero.indexOf('class="deck"') && hero.indexOf('class="deck"') < hero.indexOf('role="meter"'), `${label}: ALMOST., the joke under it, then the board`);
    // the day's headline is not on the first screen, but it is still the day's: the data file, the card and the feed have it
    assert.equal(todayHeadline(base), head, `${label}: the day's headline`);
    assert.ok(!home.includes(esc(head)), `${label}: and it is not on the homepage's first screen or anywhere else on the page`);
    // the board is one meter for a screen reader: the number, the ten squares and the small print are its picture
    const score = latest.score;
    has(hero, `<div class="board" role="meter" aria-label="Doom Score" aria-valuenow="${score}" aria-valuemin="0" aria-valuemax="99" aria-valuetext="${score} out of 99">`);
    has(hero, '<span class="bl">Doom Score</span>');
    has(hero, `<span class="bn">${score}</span>`);
    has(hero, '<span class="sq" aria-hidden="true">');
    has(hero, '<span class="bt">out of 99. 0 is a quiet day. 99 is the end.</span>');
    const filled = Math.round(score / 10);
    assert.equal((hero.match(/<span class="f"><\/span>/g) || []).length, filled, `${label}: ${filled} of ten squares are solid`);
    assert.equal((hero.match(/<span><\/span>/g) || []).length, 10 - filled, `${label}: the rest are outlines`);
    assert.ok(hero.indexOf('role="meter"') < hero.indexOf('id="stale"'), `${label}: the stale line, hidden here, sits under the board`);
    has(hero, 'id="stale" data-template="Last checked {time}. That&#39;s on us, not the world." hidden></p>');
    assert.ok(!hero.includes(copy.TAGLINE), `${label}: the tagline is for the footer`);
    // the old first screen is gone: no date line, no number line, no thin meter, no URL-and-handle line, no share button
    for (const gone of ['class="when"', 'class="doom"', 'class="meter"', '<progress', 'class="scale"', 'Updated', 'class="mast"', 'class="go"', 'class="sh"', 'didtheworldendtoday.com', '@thelpdrive', 'Share']) assert.ok(!hero.includes(gone), `${label}: the hero has no ${gone}`);
    assert.ok(!/[↑↓→←]/.test(hero), `${label}: no arrow on the first screen`);
    assert.equal((hero.match(/<button\b/g) || []).length, 1, `${label}: ALMOST. is the one button in the hero`);
    assert.equal((home.match(/id="today"/g) || []).length, 1, `${label}: today's block is there once`);
    // the share button comes once, after today's rows, and nothing else on the page says share
    assert.equal((home.match(/data-act="share"/g) || []).length, 1, `${label}: one share button`);
    assert.equal((blocksOf(home)[0].match(/<button\b/g) || []).length, 1, `${label}: and it is in today's block`);
    // the footer closes it: when the page was checked, the way to every headline, the pages, the credit
    assert.ok(home.indexOf('<p class="tagline">') > home.indexOf('<footer>'), `${label}: the tagline is in the footer`);
    has(home, '<p class="up">Updated 5:30 PM ET</p>');
    assert.ok(home.indexOf('class="up"') > home.indexOf('<footer>'), `${label}: "Updated" lives in the footer`);
    for (const line of copy.FOOTER_LINES) assert.ok(home.includes(line), `${label}: ${line}`);
    // the words themselves, not only whatever the constant says
    for (const line of ['Checked every 15 minutes by a robot with low standards.', 'Headlines belong to their publishers. The jokes are ours.', 'Satire. Not financial, medical, or end-of-the-world advice.']) has(home, `<p>${line}</p>`);
    has(home, '<a href="https://x.com/thelpdrive" target="_blank" rel="noopener">@thelpdrive</a>');
    for (const link of ['href="./about/">About</a>', 'href="./feed.xml">RSS</a>', 'href="./almanac/">Almanac</a>']) has(home, link);
  }
  // one control is filled: the black share button. Nothing is filled with the red.
  const sheet = read('index.html', edDist).match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(sheet, /\.btn\{[^}]*background:var\(--ink\)/, 'the share button is black');
  assert.ok(!/\.btn\{[^}]*#D81E05/i.test(sheet), 'and it is not red');
});

test('today and yesterday are day blocks: today has the line over its rows and the one share button, yesterday has its label, its date, its headline, its score and its rows', () => {
  for (const [label, base, ranked] of [['editions', edDist, true], ['plain headlines', dist, false]]) {
    const home = read('index.html', base);
    const [today, yesterday, ...more] = blocksOf(home);
    assert.equal(more.length, 0, `${label}: two days, two blocks`);
    // today
    assert.match(today, /^<section class="day" id="today">/);
    has(today, `<h2 class="sec">${ranked ? 'TODAY’S NEAR MISSES' : 'TODAY’S TOP STORIES'}</h2>`);
    assert.ok(today.indexOf('class="sec"') < today.indexOf('class="rows"'), `${label}: the line sits above the rows`);
    assert.ok(!today.includes('class="dl"') && !today.includes('class="dh"') && !today.includes('class="ds"'), `${label}: today's label, headline and score are already in the sign above`);
    assert.ok(!/WORST FIRST|CLOSEST CALL|Ranked from|class="rank"|class="tag"/.test(home), `${label}: no separate note about the order`);
    has(today, '<button class="btn" type="button" data-act="share">Share today</button>');
    assert.ok(today.indexOf('class="rows"') < today.indexOf('data-act="share"'), `${label}: the share button comes right after the rows`);
    // yesterday: a kicker, the date as a link to its page, a headline, a score with ten squares, the rows (open), no share button of its own
    assert.match(yesterday, /^<section class="day" id="day-2026-11-15">/);
    has(yesterday, '<p class="dk">YESTERDAY</p>');
    has(yesterday, '<h2 class="dl"><a href="./day/2026-11-15/">SUNDAY, NOV 15</a></h2>');
    has(yesterday, '<p class="ds">Doom Score 11 <span class="sq" aria-hidden="true">');
    assert.equal((yesterday.match(/<span class="f"><\/span>/g) || []).length, 1, `${label}: a score of 11 fills one of the ten squares`);
    assert.equal((yesterday.match(/<span><\/span>/g) || []).length, 9, `${label}: and leaves nine`);
    const at = (m) => yesterday.indexOf(m);
    assert.ok(at('class="dk"') < at('class="dl"') && at('class="dl"') < at('class="dh"') && at('class="dh"') < at('class="ds"') && at('class="ds"') < at('class="rows"'), `${label}: kicker, date, headline, score, rows`);
    assert.ok(!yesterday.includes('id="today"') && !yesterday.includes('class="sec"') && !yesterday.includes('data-act="share"'), `${label}: only today's block has the line over its rows and the share button`);
    assert.ok(!yesterday.includes('<details'), `${label}: yesterday's rows are open`);
    // a ranked day numbers its rows from 1 and marks only the first; a day of plain headlines does neither
    for (const block of [today, yesterday]) {
      const facts = rowsOf(block).map(rowFacts);
      assert.ok(facts.length >= 2, `${label}: ${facts.length} rows`);
      if (ranked) {
        assert.deepEqual(facts.map((f) => f.best), facts.map((_, i) => i === 0), `${label}: only the first row is best`);
        assert.deepEqual(facts.map((f) => f.rank), facts.map((_, i) => String(i + 1)), `${label}: the rank is the place in the list, 1 first`);
        assert.ok(facts.every((f) => !f.plain), `${label}: no row is plain`);
      } else {
        assert.ok(facts.every((f) => f.plain && !f.best && f.rank === null), `${label}: plain headlines have no rank and no best`);
      }
    }
  }
});

test('an edition is what its day says: the headline, then each row as rank, emoji, label, line and source, in the order the edition gave, with one link to the story behind it', () => {
  const home = read('index.html', edDist);
  const [today, yesterday] = blocksOf(home);
  assert.ok(!yesterday.includes(`<p class="dh">${esc(ED16.headline)}</p>`), "today's headline is the sign's, not repeated");
  has(yesterday, `<p class="dh">${esc(ED15.headline)}</p>`);
  for (const [block, ed] of [[today, ED16], [yesterday, ED15]]) {
    const rows = rowsOf(block);
    const facts = rows.map(rowFacts);
    assert.deepEqual(facts.map((f) => f.label), ed.items.map((i) => i.label), `${ed.date}: every label, in the order the edition gave`);
    assert.deepEqual(facts.map((f) => f.line), ed.items.map((i) => i.line), `${ed.date}: every line`);
    assert.deepEqual(facts.map((f) => f.emoji), ed.items.map((i) => i.emoji), `${ed.date}: every emoji`);
    assert.deepEqual(facts.map((f) => f.rank), ed.items.map((_, i) => String(i + 1)), `${ed.date}: the ranks`);
    // the rank and the emoji are pictures: a screen reader hears "1. Asteroid pass. ..." from the card and nothing twice
    for (const row of rows) {
      assert.ok(row.includes('<span class="rn" aria-hidden="true">') && row.includes('<span class="em" aria-hidden="true">'), `${ed.date}: the rank and the emoji are hidden from screen readers`);
      const at = (m) => row.indexOf(m);
      assert.ok(at('class="rn"') < at('class="em"') && at('class="em"') < at('class="lb"') && at('class="lb"') < at('class="ln"') && at('class="ln"') < at('class="src"'), `${ed.date}: rank, emoji, label, line, source`);
    }
    facts.forEach((f, i) => {
      assert.equal(f.href, ed.items[i].url, `${ed.date} row ${i}: its own story`);
      assert.equal(f.src, copy.rowSource(ed.items[i].source), `${ed.date} row ${i}: the news site, and nothing else`);
      assert.ok(!/news sites?|Read it/.test(rows[i]), `${ed.date} row ${i}: no count and no "Read it"`);
    });
    for (const m of block.matchAll(/<a class="card" ([^>]*)>/g)) assert.match(m[1], /target="_blank" rel="noopener"/);
  }
  // the lines are ours: no joke is added, no headline is swapped in
  assert.ok(!today.includes(esc(AIRLINES.title)), "the edition's label and line stand in for the publisher's headline");
  // the old doors are gone: the rest of the day's headlines are in the footer
  assert.ok(!home.includes('class="plus"') && !home.includes('more headlines we read'), 'no "Plus N more" link');
  has(home, `<p class="all"><a href="./day/2026-11-16/#all">Every headline we read today (${stored16.stories.length})</a></p>`);
});

test('a day with no edition shows its plain headlines: up to five, two a category at most, each as its publisher wrote it, with no rank', () => {
  const home = read('index.html');
  const [today, yesterday] = blocksOf(home);
  const facts = rowsOf(today).map(rowFacts);
  assert.equal(facts.length, cfg.edition.fallbackRows, 'five rows');
  const catOf = new Map(stored16.stories.map((s) => [s.title, s.cat]));
  const storyOfTitle = new Map(stored16.stories.map((s) => [s.title, s]));
  const emojiOf = new Map(cfg.categories.map((c) => [c.id, c.emoji]));
  const per = new Map();
  for (const f of facts) {
    assert.ok(catOf.has(f.label), `"${f.label}" is one of the day's own headlines`);
    per.set(catOf.get(f.label), (per.get(catOf.get(f.label)) || 0) + 1);
    const story = storyOfTitle.get(f.label);
    assert.equal(f.src, copy.rowSource(story.source), `"${f.label}": the source`);
    assert.equal(f.line, null, 'a plain headline has no line under it');
    assert.equal(f.rank, null, 'and no rank');
    assert.equal(f.emoji, emojiOf.get(catOf.get(f.label)), 'it wears the emoji of its category');
  }
  assert.ok([...per.values()].every((n) => n <= cfg.edition.fallbackPerCategory), `no category twice over: ${[...per]}`);
  assert.ok(facts.every((f) => f.plain && !f.best), 'no row is the closest call');
  assert.deepEqual(factsIn(yesterday).map((f) => f.label), ['Blackout hits city after substation failure', 'Power outage leaves 50,000 customers in the dark'], 'two grid stories at most, in the usual order');
  assert.ok(!home.includes('class="plus"'), 'no "Plus N more" link');
  assert.ok(home.includes(`<p class="dh">${copy.subline(11)}</p>`), "yesterday's headline is the ladder line for its score");
  // no joke anywhere: the only caption on the page is the plain line of a quiet story
  const captions = capsIn(home);
  assert.ok(captions.length >= 1 && captions.every((c) => c.startsWith('No jokes on this one.')), `captions: ${captions}`);
});

test('an edition that breaks a rule is not used: its day shows plain headlines and the other days are untouched', () => {
  const homeOf = (editions) => withEditions(editions).dist;
  const bad = (change) => ({ ...ED16, ...change });
  const plainRows = factsIn(blocksOf(read('index.html'))[0]).map((f) => f.label);
  const noEnding = 'A nationwide ground stop kept planes on the tarmac for hours today.';
  const cases = {
    'no "Still here." at the end': bad({ headline: noEnding }),
    'a headline with a dash in it': bad({ headline: `A nationwide ground stop kept planes on the tarmac ${EM} for hours. Still here.` }),
    'a headline with an exclamation mark': bad({ headline: 'A nationwide ground stop kept planes on the tarmac for hours! Still here.' }),
    'a headline that is too long': bad({ headline: `${'Everything is fine and nothing is wrong at all today. '.repeat(4)}Still here.` }),
    'a headline of two words and "Still here."': bad({ headline: 'Planes stopped. Still here.' }),
    'a first sentence of three words': bad({ headline: 'Planes stopped today. A big AWS outage knocked your favorite apps offline. Still here.' }),
    'a headline with no sentence before "Still here."': bad({ headline: 'A nationwide ground stop kept planes on the tarmac for hours, Still here.' }),
    'a first sentence cut short by an abbreviation we do not list': bad({ headline: 'A nationwide ground stop began on Nov. 16 and kept planes on the tarmac. Still here.' }),
    'only two usable lines': bad({ items: ED16.items.slice(0, 2) }),
    'the wrong date': bad({ date: '2026-11-17' }),
    'no items': bad({ items: 'six' }),
    'every link bad': bad({ items: ED16.items.map((i) => ({ ...i, url: 'javascript:alert(1)' })) }),
    'lines with a semicolon': bad({ items: ED16.items.map((i) => ({ ...i, line: `${i.line.replace('.', ';')}` })) }),
  };
  for (const [name, raw] of Object.entries(cases)) {
    const dist16 = homeOf({ ...EDITIONS, '2026-11-16': raw });
    const home = read('index.html', dist16);
    assert.equal(todayHeadline(dist16), copy.subline(latest.score), `${name}: the ladder line stands in`);
    assert.deepEqual(factsIn(blocksOf(home)[0]).map((f) => f.label), plainRows, `${name}: the plain headlines stand in`);
    has(blocksOf(home)[1], `<p class="dh">${esc(ED15.headline)}</p>`);
    assert.ok(!home.includes(ED16.items[0].line), `${name}: none of the lines`);
  }
  assert.ok(noEnding.length <= cfg.edition.headlineMax, 'the first case fails for its missing ending, not for its length');
  // a file that is not JSON at all counts as no edition
  const junk = withEditions({ ...EDITIONS, '2026-11-16': '{"headline": "Oops. Still here.", ' });
  assert.equal(todayHeadline(junk.dist), copy.subline(latest.score));
  auditSite(junk.dist, { label: 'broken edition file' });
});

test('one bad line is dropped and the rest stay: the closest call is then the first line that is left', () => {
  const bad = { ...ED16, items: ED16.items.map((i, n) => (n === 0 ? { ...i, line: 'Airlines are back! Mostly.' } : i)) };
  const { dist: out } = withEditions({ ...EDITIONS, '2026-11-16': bad });
  const home = read('index.html', out);
  assert.equal(todayHeadline(out), ED16.headline, 'the edition still stands');
  const facts = factsIn(blocksOf(home)[0]);
  assert.deepEqual(facts.map((f) => f.line), ED16.items.slice(1).map((i) => i.line));
  assert.deepEqual(facts.map((f) => f.rank), ['1', '2', '3', '4', '5'], 'the ranks start over');
  assert.deepEqual(facts.map((f) => f.best), [true, false, false, false, false]);
});

test('a label that is missing or bad does not cost the row: it keeps its emoji, its link and its place, and shows its line where the label goes', () => {
  const items = ED16.items.map((i, n) => {
    if (n === 1) return { ...i, label: '' }; // missing
    if (n === 2) return { ...i, label: 'Five words is too many' };
    if (n === 3) return { ...i, label: 'Nasdaq halt.' }; // a period
    return i;
  });
  const { dist: out } = withEditions({ ...EDITIONS, '2026-11-16': { ...ED16, items } });
  const home = read('index.html', out);
  assert.equal(todayHeadline(out), ED16.headline, 'the edition still stands');
  const rows = rowsOf(blocksOf(home)[0]);
  const facts = rows.map(rowFacts);
  assert.equal(facts.length, 6, 'every row stays');
  assert.deepEqual(facts.map((f) => f.rank), ['1', '2', '3', '4', '5', '6']);
  assert.deepEqual(facts.map((f) => f.emoji), ED16.items.map((i) => i.emoji));
  assert.deepEqual(facts.map((f) => f.href), ED16.items.map((i) => i.url));
  assert.deepEqual(facts.map((f) => f.label), [ED16.items[0].label, ED16.items[1].line, ED16.items[2].line, ED16.items[3].line, ED16.items[4].label, ED16.items[5].label], 'a row with no label shows its line where the label goes');
  assert.deepEqual(facts.map((f) => f.line), [ED16.items[0].line, null, null, null, ED16.items[4].line, ED16.items[5].line], 'and has no second line');
  const kept = JSON.parse(fs.readFileSync(path.join(out, 'api', 'today.json'), 'utf8')).items.map((i) => i.label);
  assert.deepEqual(kept, [ED16.items[0].label, '', '', '', ED16.items[4].label, ED16.items[5].label], 'the data file has no label for them either');
});

// ---- a story is told once -----------------------------------------------------------------------------
//
// A story can sit in two days' files, because the pipeline keeps the last three days in view.
// Once an earlier day's edition has told it, no later edition and no later plain headline tells it again.

const SHARED = { id: 'shared:1', kind: 'news', cat: 'internet', title: 'Slack outage drags on past midnight for thousands of users', url: 'https://pub0.example/shared/1', source: 'Pub A', publishedAt: '2026-11-15T23:30:00.000Z', firstSeenAt: '2026-11-15T23:30:00.000Z', outlets: 3, outletNames: PUBS, score: 50 };
const SHARED_15 = 'Slack went down late Sunday and was still wobbling at midnight.';
const SHARED_16 = 'Slack was still down on Monday morning.';
const ED15_SHARED = { ...ED15, items: [...ED15.items, itemOf(SHARED, '💬', 'Slack outage', SHARED_15)] };
const ED16_SHARED = { ...ED16, items: [ED16.items[0], itemOf(SHARED, '💬', 'Slack outage', SHARED_16), ...ED16.items.slice(1)] };

function sharedSite(editions) {
  const r = copyRoot(root);
  edit(dayFile(r, '2026-11-15'), (d) => d.stories.unshift(SHARED));
  edit(dayFile(r, '2026-11-16'), (d) => d.stories.unshift(SHARED));
  edit(latestFile(r), (l) => l.stories.unshift(SHARED));
  writeEditions(r, editions);
  return buildAt(r).dist;
}

test('a story told by an earlier day\'s edition is left out of every later edition and every later plain headline list', () => {
  // The 15th tells the story, the 16th tries to: its line is dropped and the other six stand.
  const both = sharedSite({ '2026-11-15': ED15_SHARED, '2026-11-16': ED16_SHARED });
  const home = read('index.html', both);
  const [today, yesterday] = blocksOf(home);
  assert.deepEqual(factsIn(yesterday).map((f) => f.line), [...ED15.items.map((i) => i.line), SHARED_15], 'the 15th tells it');
  assert.deepEqual(factsIn(today).map((f) => f.line), ED16.items.map((i) => i.line), 'the 16th does not');
  assert.equal(todayHeadline(both), ED16.headline, 'and its edition still stands');
  assert.ok(!home.includes(SHARED_16));
  const day16 = read('day/2026-11-16/index.html', both);
  assert.ok(!rowsOf(day16).some((r) => r.includes(SHARED_16)), 'not in the day page rows either');
  assert.ok(headsOf(day16).some((h) => h.includes(esc(SHARED.title))), 'but "every headline we read that day" still lists it');

  // The 15th tells it and the 16th has no edition: the plain headlines skip it, though it is the day's biggest story.
  const plain16 = sharedSite({ '2026-11-15': ED15_SHARED });
  const plain = factsIn(blocksOf(read('index.html', plain16))[0]).map((f) => f.label);
  assert.ok(plain.length === cfg.edition.fallbackRows && !plain.includes(SHARED.title), `plain headlines: ${plain}`);
  assert.ok(headsOf(read('day/2026-11-16/index.html', plain16)).some((h) => h.includes(esc(SHARED.title))), 'still on the day page list');

  // An earlier day with no usable edition told nothing, so the story is still free the next day.
  const free = sharedSite({ '2026-11-15': { ...ED15_SHARED, headline: 'The grid blinked three times.' } });
  const first = factsIn(blocksOf(read('index.html', free))[0])[0];
  assert.equal(first.label, SHARED.title, 'its own score makes it the first plain headline');
});

test('a day shows a story once: a second line about an id an earlier line took is dropped', () => {
  const twice = { ...ED16, items: [ED16.items[0], itemOf(AIRLINES, '🧳', 'Same story', 'Same story, second line.'), ...ED16.items.slice(1)] };
  const { dist: out } = withEditions({ ...EDITIONS, '2026-11-16': twice });
  const facts = factsIn(blocksOf(read('index.html', out))[0]);
  assert.deepEqual(facts.map((f) => f.line), ED16.items.map((i) => i.line));
});

// ---- the words that went with the cut features -----------------------------------------------------------

test('no page says chip, Doom Bingo, Vital signs, The receipts or Check again, and none has the markup that went with them', () => {
  const pages = (base) => [...listDist(base).keys()].filter((r) => r.endsWith('.html'));
  for (const [label, base] of [['plain headlines', dist], ['editions', edDist]]) {
    assert.ok(pages(base).length >= 6, label);
    for (const rel of pages(base)) {
      const raw = withoutQuips(read(rel, base));
      for (const word of ['Doom Bingo', 'Vital signs', 'The receipts', 'Check again', 'Closest call today']) assert.ok(!raw.includes(word), `${label} ${rel}: ${word}`);
      assert.ok(!/\bchips?\b/i.test(raw), `${label} ${rel}: chip`);
      for (const hook of ['id="bingo"', 'id="vitals"', 'id="receipts"', 'id="lead"', 'class="cell', 'class="chip', 'class="btns"']) assert.ok(!raw.includes(hook), `${label} ${rel}: ${hook}`);
    }
  }
  const code = read('assets/app.js');
  for (const word of ['Check again', 'bingo', 'vitals', 'receipts', 'streak-line']) assert.ok(!code.includes(word), `app.js: ${word}`);
});

// ---- the share text -----------------------------------------------------------------------------------------

test('the share text is the question, the emoji of the first five rows in order, the Doom Score with ten squares, and the day address', () => {
  const home = read('index.html', edDist);
  const squares = (n) => '⬛'.repeat(n) + '🟨'.repeat(10 - n);
  const full = attr(home, 'data-share-full').split('\n');
  assert.deepEqual(full, [
    'Did the world end today? ALMOST.',
    ED16.items.slice(0, 5).map((i) => i.emoji).join(' '),
    `Doom Score ${latest.score} ${squares(Math.round(latest.score / 10))}`,
    'didtheworldendtoday.com/day/2026-11-16/',
  ]);
  assert.ok(!full.some((line) => line.includes('Still here')), 'the headline is not in the share: the picture carries it');
  assert.deepEqual(attr(home, 'data-share-text').split('\n'), full.slice(0, -1), 'the share sheet gets the same text and takes the link on its own');
  assert.equal(attr(home, 'data-share-url'), `${SITE}/day/2026-11-16/`);
  // the page carries the share text of the day it shows, once, on the page itself: the one share button reads it
  assert.match(home, /<main id="main" data-share-text=/);
  assert.equal((home.match(/data-share-full=/g) || []).length, 1, 'one share text on the page');
  const [today, yesterday] = blocksOf(home);
  assert.equal(attr(today, 'data-share-full'), null, 'a block of the page does not carry a second one');
  assert.equal(attr(yesterday, 'data-share-full'), null);
  const day15 = attr(read('day/2026-11-15/index.html', edDist), 'data-share-full');
  assert.deepEqual(day15.split('\n'), ['Did the world end on Nov 15? ALMOST.', ED15.items.map((i) => i.emoji).join(' '), `Doom Score 11 ${squares(1)}`, 'didtheworldendtoday.com/day/2026-11-15/']);
  assert.equal(attr(read('day/2026-11-15/index.html', edDist), 'data-share-url'), `${SITE}/day/2026-11-15/`);
  // plain headlines share the emoji of their categories, which the rows draw too
  const plainHome = read('index.html');
  const plain = attr(plainHome, 'data-share-full').split('\n');
  assert.equal(plain.length, 4);
  const catOf = new Map(stored16.stories.map((s) => [s.title, s.cat]));
  const emojiOf = new Map(cfg.categories.map((c) => [c.id, c.emoji]));
  assert.equal(plain[1], factsIn(blocksOf(plainHome)[0]).map((f) => emojiOf.get(catOf.get(f.label))).join(' '));
  assert.equal(plain[2], `Doom Score ${latest.score} ${squares(Math.round(latest.score / 10))}`);
  assert.ok(!full.some((line) => /[↑↓→←]/.test(line)), 'no arrow in a share of a normal day');
});

test('shareText: the text the owner asked for, a past day, no emoji, and the quiet text with its grid', () => {
  const fired = ['flights', 'hacks', 'space', 'earth', 'markets', 'grid', 'weather'];
  const emojis = ['☄️', '✈️', '💳', '🏦', '🎟️', '💍'];
  const base = { score: 92, change: 9, fired, categories: cfg.categories, host: 'didtheworldendtoday.com', emojis };
  // exactly this, for the 17th
  assert.equal(
    copy.shareText({ ...base, live: true, date: '2026-11-17' }),
    'Did the world end today? ALMOST.\n☄️ ✈️ 💳 🏦 🎟️ 💍\nDoom Score 92 ⬛⬛⬛⬛⬛⬛⬛⬛⬛🟨\ndidtheworldendtoday.com/day/2026-11-17/',
  );
  assert.deepEqual(
    copy.shareText({ ...base, live: false, date: '2026-11-16', score: 71 }).split('\n'),
    ['Did the world end on Nov 16? ALMOST.', '☄️ ✈️ 💳 🏦 🎟️ 💍', 'Doom Score 71 ⬛⬛⬛⬛⬛⬛⬛🟨🟨🟨', 'didtheworldendtoday.com/day/2026-11-16/'],
    'a past day asks about its own date',
  );
  assert.equal(copy.shareText({ ...base, live: true, date: '2026-11-17', withUrl: false }).split('\n').length, 3, 'no address, one line fewer');
  assert.deepEqual(copy.shareText({ ...base, live: true, date: '2026-11-17', emojis: [] }).split('\n'), ['Did the world end today? ALMOST.', 'Doom Score 92 ⬛⬛⬛⬛⬛⬛⬛⬛⬛🟨', 'didtheworldendtoday.com/day/2026-11-17/'], 'no rows, no emoji line');
  assert.ok(!copy.shareText({ ...base, live: true, date: '2026-11-17', headline: 'A headline. Still here.' }).includes('Still here'), 'the headline is not in the text');
  // the squares: one black for each tenth, rounded, kept from 0 to 10
  const squaresOf = (score) => copy.shareText({ ...base, live: true, date: '2026-11-17', score, emojis: [] }).split('\n')[1];
  assert.equal(squaresOf(0), 'Doom Score 0 🟨🟨🟨🟨🟨🟨🟨🟨🟨🟨');
  assert.equal(squaresOf(4), 'Doom Score 4 🟨🟨🟨🟨🟨🟨🟨🟨🟨🟨');
  assert.equal(squaresOf(5), 'Doom Score 5 ⬛🟨🟨🟨🟨🟨🟨🟨🟨🟨');
  assert.equal(squaresOf(62), 'Doom Score 62 ⬛⬛⬛⬛⬛⬛🟨🟨🟨🟨');
  assert.equal(squaresOf(99), 'Doom Score 99 ⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛');
  assert.equal(squaresOf('nope'), 'Doom Score 0 🟨🟨🟨🟨🟨🟨🟨🟨🟨🟨', 'a score that is not a number reads as 0');
  assert.deepEqual([0, 4, 5, 11, 62, 92, 95, 99, 150, -3, NaN, null].map(copy.filledSquares), [0, 0, 1, 1, 6, 9, 10, 10, 10, 0, 0, 0]);
  // quiet mode keeps its own text: the quiet line, the date and score, and the grid of fired categories
  const quiet = copy.shareText({ ...base, score: 71, live: true, date: '2026-11-16', quiet: true }).split('\n');
  assert.deepEqual(quiet, ['Did the world end today? ALMOST.', 'Not a day for jokes. Back soon.', 'Mon, Nov 16 · Doom Score 71 of 99 ↑9', '✈️🏦⬛☄️', '⬛🌋📉⬛', '⚡⬛🌀⬛', 'didtheworldendtoday.com/day/2026-11-16/'], 'quiet mode shares the quiet line and the grid, not the emoji of the rows');
  assert.equal(copy.shareText({ ...base, score: 71, change: 0, live: true, date: '2026-11-16', quiet: true }).split('\n')[2], 'Mon, Nov 16 · Doom Score 71 of 99', 'no change, no arrow');
  for (const bad of [0, null, undefined, '', NaN, 'up']) assert.equal(copy.changeText(bad), '', String(bad));
  assert.equal(copy.changeText(9), '↑9');
  assert.equal(copy.changeText(-4), '↓4');
  assert.equal(copy.shareText({ live: true, date: '2026-11-16', score: 'nope', categories: [], host: 'h', quiet: true }).split('\n').at(-2), 'Mon, Nov 16 · Doom Score 0 of 99', 'a score that is not a number reads as 0');
  assert.equal(copy.shareText({ ...base, live: true, date: '2026-11-17', score: 92, cap: 50, quiet: true }).split('\n')[2], 'Tue, Nov 17 · Doom Score 92 of 50 ↑9');
});



test('the quiet page shares the quiet text, with a grid of twelve squares', () => {
  const r = copyRoot(edRoot);
  edit(latestFile(r), (l) => (l.quiet = { ...l.quiet, quiet: true, note: '' }));
  const full = attr(read('index.html', buildAt(r).dist), 'data-share-full').split('\n');
  assert.equal(full.length, 7, 'verdict, quiet line, date and score, three grid rows, address');
  assert.equal(full[1], copy.QUIET_LINE);
  assert.equal(full[2], `Mon, Nov 16 · Doom Score ${latest.score} of 99 ↑${latest.change}`);
  const cells = full.slice(3, 6).map((row) => [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(row)].length);
  assert.deepEqual(cells, [4, 4, 4]);
  assert.equal(full[6], 'didtheworldendtoday.com/day/2026-11-16/');
});

// ---- the share image --------------------------------------------------------------------------------------------

const FONT_FILES = fontFilesIn(path.join(REPO, 'assets'));
const countOf = (svg, color) => (svg.match(new RegExp(color, 'gi')) || []).length;

test('the share image carries the first sentence of the day\'s headline, in sentence case, as big as fits in two lines', () => {
  const fontFiles = FONT_FILES;
  const base = { date: '2026-11-16', score: 62, host: 'didtheworldendtoday.com', fontFiles };
  const first = firstSentence(ED16.headline);
  assert.equal(first, 'A nationwide ground stop kept planes on the tarmac for hours.');
  const fit = fitSentence(first, { width: 1072, fontFiles });
  assert.equal(fit.lines.join(' '), first, 'sentence case, the words as they were written');
  assert.ok(fit.lines.length <= 2 && fit.size >= 30 && fit.size <= 56, `${fit.size} px on ${fit.lines.length} lines`);
  const svg = ogSvg({ ...base, headline: ED16.headline });
  for (const line of fit.lines) has(svg, `font-family="${BODY}" font-weight="600" font-size="${fit.size}" fill="${INK}">${esc(line)}</text>`);
  // only the first sentence is on the card: not "Still here."
  assert.ok(!svg.includes('Still here'), 'the card shows sentence one alone');
  assert.ok(svg.indexOf('>ALMOST.<') < svg.indexOf(`>${fit.lines[0]}</text>`) && svg.indexOf(`>${fit.lines[0]}</text>`) < svg.indexOf('>didtheworldendtoday.com<'), 'under ALMOST., above the address');
  assert.equal((svg.match(/<text /g) || []).length, 5 + fit.lines.length, 'the question, ALMOST., DOOM SCORE, the number, the sentence lines and the address');
  // a short sentence is set at 56 on one line, a longer one smaller on two, and one too long for two lines is cut at 30
  const short = fitSentence('Quiet day.', { width: 1072, fontFiles });
  const medium = fitSentence('An asteroid the size of a bus missed Earth at 2:59 AM ET and kept going toward the sun.', { width: 1072, fontFiles });
  const huge = fitSentence('Airlines across the country were held on the ground for more than an hour and a half while a system that tracks every crew and every plane was rebuilt by hand from the start.', { width: 1072, fontFiles });
  assert.deepEqual([short.size, short.lines.length], [56, 1]);
  assert.ok(medium.size < 56 && medium.size >= 30 && medium.lines.length === 2, `${medium.size} px on ${medium.lines.length} lines`);
  assert.deepEqual([huge.size, huge.lines.length], [30, 2], 'two lines at 30px when nothing bigger will do');
  assert.ok(huge.lines[1].endsWith('…'), 'and the end is cut with an ellipsis');
  // abbreviations and numbers do not end the sentence, so the card shows all of it
  const abbreviations = 'Gov. Healey closed the U.S. Capitol for 3.5 hours on Monday. Banks stayed open. Still here.';
  assert.equal(fitSentence(firstSentence(abbreviations), { width: 1072, fontFiles }).lines.join(' '), 'Gov. Healey closed the U.S. Capitol for 3.5 hours on Monday.');
  // emoji are left out, and so is nothing else the fonts can draw: the degree sign and the accents stay
  assert.deepEqual(fitSentence('Planes ✈️ stopped for hours.', { width: 1072, fontFiles }).lines, ['Planes stopped for hours.'], 'neither font draws emoji, so none is asked for');
  assert.deepEqual(fitSentence('It hit 118°F in Phoenix.', { width: 1072, fontFiles }).lines, ['It hit 118°F in Phoenix.'], 'the degree sign stays');
  assert.deepEqual(fitSentence('Dončić and Erdoğan met in Łódź.', { width: 1072, fontFiles }).lines, ['Dončić and Erdoğan met in Łódź.'], 'Latin Extended letters stay');
  assert.equal(drawable('118°F ✈️ 🇺🇸', FONT_FILES), '118°F', 'drawable keeps what the font has');
  assert.equal(drawable('118°F ✈️ 🇺🇸'), '118°F', 'and with no font to ask, a degree sign is still kept');
  assert.ok(ogSvg({ ...base, headline: '<b>&"' }).includes('&lt;b&gt;&amp;&quot;'), 'the sentence is escaped');
  assert.equal((ogSvg(base).match(/<text /g) || []).length, 5, 'no headline, no sentence text');
  assert.deepEqual(fitSentence('', { width: 1072, fontFiles }).lines, []);
  // the pictures the build writes are these cards
  const card = (headline, d = {}) => renderPng(ogSvg({ date: '2026-11-16', score: latest.score, host: 'didtheworldendtoday.com', headline, fontFiles, live: true, ...d }), { fontFiles, width: 1200 });
  assert.ok(fs.readFileSync(path.join(edDist, 'og', 'latest.png')).equals(card(ED16.headline)), "today's headline on the latest card");
  assert.ok(fs.readFileSync(path.join(edDist, 'og', '2026-11-16.png')).equals(card(ED16.headline)), "and on today's own card");
  assert.ok(fs.readFileSync(path.join(edDist, 'og', '2026-11-15.png')).equals(card(ED15.headline, { date: '2026-11-15', score: 11, live: false })), "yesterday's headline on yesterday's card, which asks about its own date");
  assert.ok(fs.readFileSync(path.join(dist, 'og', '2026-11-16.png')).equals(card(copy.subline(latest.score))), 'the ladder line when a day has no edition');
  assert.ok(!card(ED16.headline).equals(card(copy.subline(latest.score))), 'the picture changes with the headline');
  const r = copyRoot(edRoot);
  edit(latestFile(r), (l) => (l.quiet = { ...l.quiet, quiet: true, note: '' }));
  assert.ok(fs.readFileSync(path.join(buildAt(r).dist, 'og', 'latest.png')).equals(card(copy.QUIET_LINE, { quiet: true })), 'the quiet line in quiet mode');
});

test('the share image is drawn with both fonts: League Gothic for the big type, Libre Franklin for the sentence and the small words', () => {
  const fontFiles = FONT_FILES;
  assert.deepEqual(fontFiles.map((f) => path.basename(f)), ['LeagueGothic-Regular.ttf', 'LibreFranklin-SemiBold.ttf', 'LibreFranklin-Bold.ttf']);
  for (const f of fontFiles) assert.ok(fs.existsSync(f) && fs.statSync(f).size > 10000, `${f} is there`);
  assert.deepEqual([DISPLAY, BODY], ['League Gothic', 'Libre Franklin']);
  const svg = ogSvg({ date: '2026-11-16', score: 62, host: 'didtheworldendtoday.com', headline: ED16.headline, fontFiles });
  assert.deepEqual([...new Set([...svg.matchAll(/font-family="([^"]*)"/g)].map((m) => m[1]))].sort(), ['League Gothic', 'Libre Franklin'], 'no other family is asked for');
  assert.deepEqual([...new Set([...svg.matchAll(/font-weight="(\d+)"/g)].map((m) => m[1]))].sort(), ['600', '700'], 'the sentence is semibold and the small words are bold');
  // resvg quietly uses another font when a family name is not one it knows, so prove each name finds its own file:
  // the same text is a different width in each family, and a family is a different width without its file
  const { Resvg } = resvg;
  const width = (family, files) => new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="8000" height="300" viewBox="0 0 8000 300"><text x="0" y="200" font-family="${family}" font-weight="600" font-size="100">Did the world end today</text></svg>`, { font: { fontFiles: files, loadSystemFonts: false, defaultFontFamily: DISPLAY } }).getBBox().width;
  const gothic = width(DISPLAY, fontFiles);
  const franklin = width(BODY, fontFiles);
  assert.ok(gothic > 100 && franklin > 100 && Math.abs(gothic - franklin) > 100, `League Gothic ${Math.round(gothic)}, Libre Franklin ${Math.round(franklin)}`);
  assert.equal(Math.round(width(BODY, [fontFiles[0]])), Math.round(gothic), 'with no Libre Franklin file the name falls back to League Gothic');
  assert.ok(Math.abs(width(DISPLAY, [fontFiles[1]]) - width(BODY, [fontFiles[1]])) < 1, 'and with no League Gothic file it falls back to Libre Franklin');
  // and the picture shows it: each file, taken away, changes the card
  const both = renderPng(svg, { fontFiles, width: 1200 });
  const without = (n) => renderPng(svg, { fontFiles: fontFiles.filter((_, i) => i !== n), width: 1200 });
  for (const n of [0, 1, 2]) assert.ok(!both.equals(without(n)), `the card needs ${path.basename(fontFiles[n])}`);
  // the sentence is measured with the font it is drawn in: the same words are narrower in League Gothic, so they would be set bigger
  const long = 'An asteroid the size of a bus missed Earth at 2:59 AM ET and kept going toward the sun.';
  assert.equal(fitSentence(long, { width: 1072, fontFiles: [fontFiles[0]] }).size, 56, 'measured in League Gothic the sentence would fit at the top size');
  assert.ok(fitSentence(long, { width: 1072, fontFiles }).size < 56, 'measured in Libre Franklin, the font it is drawn in, it has to shrink');
  // both fonts really drew the card: the picture has big black letters on yellow and yellow letters on black
  const pixels = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 }, font: { fontFiles, loadSystemFonts: false, defaultFontFamily: DISPLAY } }).render().pixels;
  const at = (x, y) => [pixels[(y * 1200 + x) * 4], pixels[(y * 1200 + x) * 4 + 1], pixels[(y * 1200 + x) * 4 + 2]];
  const dark = (x0, y0, x1, y1) => {
    let n = 0;
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) if (at(x, y)[0] < 60 && at(x, y)[1] < 60) n += 1;
    return n;
  };
  assert.ok(dark(64, 152, 757, 377) > 20000, 'ALMOST. is drawn in black over the yellow page');
  assert.ok(dark(64, 405, 900, 540) > 8000, 'and so is the sentence');
});

test('the share image uses yellow, black and one red: the red is the Doom Score number and nothing else, and quiet mode has none', () => {
  const fontFiles = FONT_FILES;
  const base = { date: '2026-11-16', score: 62, host: 'didtheworldendtoday.com', headline: ED16.headline, fontFiles };
  const normal = ogSvg(base);
  assert.equal(countOf(normal, RED), 1, 'the red is the Doom Score number alone');
  has(normal, `<text x="822" y="321" font-family="${DISPLAY}" font-size="150" fill="${RED}">62</text>`);
  has(normal, `<rect width="1200" height="630" fill="${YELLOW}"/>`);
  has(normal, `<rect width="1200" height="110" fill="${INK}"/>`);
  has(normal, `<rect x="800" y="154" width="336" height="221" fill="${INK}"/>`);
  assert.equal((normal.match(new RegExp(`<rect x="\\d+" y="335" width="20" height="20" fill="${YELLOW}"/>`, 'g')) || []).length, 6, 'six of the ten squares are solid for a 62');
  assert.equal((normal.match(/<rect [^>]*fill="none"/g) || []).length, 4, 'and four are outlines');
  const quiet = ogSvg({ ...base, headline: copy.QUIET_LINE, quiet: true });
  assert.equal(countOf(quiet, RED), 0, 'quiet mode draws no red');
  assert.equal(countOf(quiet, YELLOW), 0, 'and no yellow: the page is white');
  has(quiet, `<rect width="1200" height="630" fill="${WHITE}"/>`);
  has(quiet, `font-size="150" fill="${WHITE}">62</text>`);
  assert.ok(quiet.includes('Not a day for jokes.') && !quiet.includes('Back soon'), 'and the quiet line, its first sentence');
  for (const [svg, allowed] of [[normal, [YELLOW, INK, RED]], [quiet, [WHITE, INK]]]) for (const color of svg.match(/#[0-9a-fA-F]{6}/g)) assert.ok(allowed.includes(color.toUpperCase()), `${color} is one of the card's colors`);
  assert.ok(!/<text[^>]*>[\u{1F000}-\u{1FAFF}]/u.test(normal + quiet) && !/\p{Extended_Pictographic}/u.test(normal + quiet), 'no emoji is drawn on the card');
  // and the picture itself: the red and the yellow are on the normal card, and not one pixel of either is on the quiet card
  const { Resvg } = resvg;
  const count = (svg, test) => {
    const pixels = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 }, font: { fontFiles, loadSystemFonts: false, defaultFontFamily: DISPLAY } }).render().pixels;
    let n = 0;
    for (let i = 0; i < pixels.length; i += 4) if (test(pixels[i], pixels[i + 1], pixels[i + 2])) n += 1;
    return n;
  };
  const red = (r, g, b) => r > 150 && g < 70 && b < 90;
  const yellow = (r, g, b) => r > 200 && g > 160 && b < 80;
  assert.ok(count(normal, red) > 1000, 'the normal card has red in it');
  assert.ok(count(normal, red) < 20000, 'and only the number is red');
  assert.ok(count(normal, yellow) > 100000, 'and a yellow page');
  assert.equal(count(quiet, red), 0, 'the quiet card has no red in it');
  assert.equal(count(quiet, yellow), 0, 'and no yellow');
  assert.ok(!/(?:drlevidruin|levidruin|github|@thelpdrive)/i.test(normal + quiet), 'no repository link and no name on the card');
});

test('the share image asks the question in yellow on the black band, names the date on a past day, and keeps ALMOST. clear of the board', () => {
  const fontFiles = FONT_FILES;
  assert.equal(questionText('2026-11-17', true), 'DID THE WORLD END TODAY?');
  assert.equal(questionText('2026-11-17', false), 'DID THE WORLD END ON NOV 17?', 'a past day names its date, in capitals');
  assert.equal(questionText('2026-11-16', false), 'DID THE WORLD END ON NOV 16?');
  assert.equal(questionText('nope', false), 'DID THE WORLD END TODAY?', 'a date that is not a date leaves the question as it is');
  const live = ogSvg({ date: '2026-11-17', score: 92, host: 'didtheworldendtoday.com', headline: 'Asteroid missed Earth by a mile. Still here.', fontFiles, live: true });
  const past = ogSvg({ date: '2026-11-17', score: 92, host: 'didtheworldendtoday.com', headline: 'Asteroid missed Earth by a mile. Still here.', fontFiles, live: false });
  assert.match(live, /<text x="600" y="\d+" text-anchor="middle" font-family="League Gothic" font-size="\d+" letter-spacing="[\d.]+" fill="#FFD100">DID THE WORLD END TODAY\?<\/text>/, 'the question: centered on the black band, League Gothic, yellow');
  assert.match(past, /<text x="600" y="\d+" text-anchor="middle" font-family="League Gothic" font-size="\d+" [^>]*>DID THE WORLD END ON NOV 17\?<\/text>/);
  assert.ok(!live.includes('ON NOV'), 'the live card does not name a date in the question');
  assert.match(live, /<text x="824" y="\d+" font-family="Libre Franklin" font-weight="700" font-size="24" letter-spacing="[\d.]+" fill="#FFD100">DOOM SCORE<\/text>/, 'DOOM SCORE on the board, in yellow');
  assert.match(live, /<text x="822" y="\d+" font-family="League Gothic" font-size="150" fill="#D81E05">92<\/text>/, 'and the number, in red');
  assert.match(live, /<text x="59" y="375" font-family="League Gothic" font-size="300" fill="#000000">ALMOST\.<\/text>/, 'ALMOST. in huge black type, left');
  assert.equal((past.match(/<text /g) || []).length, 6, 'the question, ALMOST., DOOM SCORE, the number, one line of the sentence and the address');
  assert.equal((live.match(/<text /g) || []).length, 6);
  const { Resvg } = resvg;
  const box = (textEl) => new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">${textEl}</svg>`, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: DISPLAY } }).getBBox();
  // ALMOST. ends well before the board starts, and sits on the page, not on the band
  const verdict = box(live.match(/<text x="59"[^>]*>ALMOST\.<\/text>/)[0]);
  assert.ok(verdict.x >= 60 && verdict.x + verdict.width <= 800 - 24, `ALMOST. runs from ${Math.round(verdict.x)}px to ${Math.round(verdict.x + verdict.width)}px, the board starts at 800px`);
  assert.ok(verdict.y >= 110, 'and starts under the band');
  // the question fits the band, measured with the real font, for every weekday and month, live and past
  const day = Date.parse('2026-11-17T12:00:00Z');
  for (let i = 0; i < 400; i += 3) {
    const date = new Date(day + i * 86400e3).toISOString().slice(0, 10);
    for (const isLive of [true, false]) {
      const svg = ogSvg({ date, score: 92, host: 'h', headline: '', fontFiles, live: isLive });
      const q = box(svg.match(/<text x="600"[^>]*>[^<]*<\/text>/)[0]);
      assert.ok(q.x >= 64 && q.x + q.width <= 1136, `${date} ${isLive ? 'live' : 'past'}: the question runs ${Math.round(q.x)}px to ${Math.round(q.x + q.width)}px`);
      assert.ok(fitQuestion(questionText(date, isLive), { fontFiles }) >= 44, `${date}: the question stays big`);
    }
  }
  // the address is the site's, in the bottom left, and the card names no one
  assert.match(live, /<text x="64" y="598"[^>]*>didtheworldendtoday\.com<\/text>/, 'the address');
  assert.ok(!/drlevidruin|levidruin|github/i.test(live + past), 'no link to the repository and no name of a person');
});

test('the homepage share image is today\'s own card, and the latest card is still written', () => {
  const home = read('index.html', edDist);
  assert.equal(home.match(/property="og:image" content="([^"]+)"/)[1], `${SITE}/og/2026-11-16.png`);
  assert.equal(home.match(/name="twitter:image" content="([^"]+)"/)[1], `${SITE}/og/2026-11-16.png`);
  assert.deepEqual(pngSize(path.join(edDist, 'og', '2026-11-16.png')), [1200, 630]);
  assert.deepEqual(pngSize(path.join(edDist, 'og', 'latest.png')), [1200, 630]);
  assert.ok(read('day/2026-11-15/index.html', edDist).includes(`${SITE}/og/2026-11-15.png`), 'a past day keeps its own card');
  // The first hours after midnight Eastern: no day file yet, and the homepage still has a card of its own.
  const r = copyRoot(edRoot);
  fs.rmSync(dayFile(r, '2026-11-16'));
  const out = buildAt(r);
  assert.ok(read('index.html', out.dist).includes(`${SITE}/og/2026-11-16.png`));
  assert.deepEqual(pngSize(path.join(out.dist, 'og', '2026-11-16.png')), [1200, 630]);
  assert.ok(fs.existsSync(path.join(out.dist, 'og', 'latest.png')));
});

// ---- api/today.json -----------------------------------------------------------------------------------------------

const MACHINERY = {
  why: 'auto',
  manual: { quiet: false, note: '', problem: null },
  auto: { checked: true, tripped: true, matches: ['Mass shooting at a mall leaves dozens dead'], headlines: 30 },
  holdUntil: '2026-11-17T04:00:00.000Z',
  reason: 'automatic check',
};

test('api/today.json is the public copy: the numbers, the stories, the headline, the labels and the lines, and none of the machinery', () => {
  const r = copyRoot(edRoot);
  edit(latestFile(r), (l) => {
    l.quiet = { quiet: false, note: 'A hard day', ...MACHINERY };
    l.x = { enabled: true, spentUsd: 0.41, skipped: null };
    l.somethingElse = { internal: 'state' };
  });
  const json = readJson(path.join(buildAt(r).dist, 'api', 'today.json'));
  assert.deepEqual(json.quiet, { quiet: false, note: 'A hard day' });
  for (const key of ['sources', 'x', 'somethingElse']) assert.ok(!(key in json), `${key} stays private`);
  assert.ok(!JSON.stringify(json).includes('Mass shooting'), 'the headlines that tripped the check are not published');
  assert.equal(json.score, latest.score);
  assert.equal(json.stories.length, readJson(latestFile(r)).stories.length, 'every story is there');
  assert.ok(json.buildTime && json.etDate && Array.isArray(json.fired) && json.vital && json.cats, 'what the page needs is there');
  // the day's headline and lines, as the page reads them
  assert.equal(json.headline, ED16.headline);
  assert.deepEqual(json.items.map((i) => i.label), ED16.items.map((i) => i.label));
  assert.deepEqual(json.items.map((i) => i.line), ED16.items.map((i) => i.line));
  assert.deepEqual(json.items.map((i) => i.emoji), ED16.items.map((i) => i.emoji));
  assert.deepEqual(json.items.map((i) => i.url), ED16.items.map((i) => new URL(i.url).href));
  assert.deepEqual(Object.keys(json.items[0]).sort(), ['emoji', 'label', 'line', 'url'], 'a row has an emoji, a label, a line and a link, nothing else');
  // the main build, where no edition exists, says the ladder line and the plain headlines
  const plain = readJson(path.join(dist, 'api', 'today.json'));
  assert.deepEqual(plain.quiet, { quiet: false, note: '' });
  assert.equal(plain.headline, copy.subline(latest.score));
  assert.equal(plain.items.length, cfg.edition.fallbackRows);
  assert.ok(!('sources' in plain) && !('x' in plain));
  // quiet mode: the quiet line, and the plain headlines
  edit(latestFile(r), (l) => (l.quiet = { ...l.quiet, quiet: true, ...MACHINERY }));
  const quiet = readJson(path.join(buildAt(r).dist, 'api', 'today.json'));
  assert.deepEqual(quiet.quiet, { quiet: true, note: 'A hard day' });
  assert.equal(quiet.headline, copy.QUIET_LINE);
  assert.ok(!quiet.items.some((i) => ED16.items.some((e) => e.line === i.line)), 'the editions rest in quiet mode');
  assert.ok(!JSON.stringify(quiet).includes('Mass shooting'));
});

test('publicCopy names what is public, drops bad links, and leaves the headline and lines off unless it is handed a day', () => {
  assert.equal(publicCopy(null), null);
  assert.equal(publicCopy('text'), null);
  const sample = { schema: 1, score: 40, x: { enabled: true }, sources: { a: 1 }, secret: 1, quiet: { quiet: true, note: 7, auto: { matches: ['x'] } }, stories: [] };
  assert.deepEqual(publicCopy(sample), { schema: 1, score: 40, stories: [], quiet: { quiet: true, note: '' } });
  const day = { headline: 'Quiet one. Still here.', rows: [{ emoji: '✈️', label: 'First label', line: 'First.', url: 'javascript:alert(1)', ids: ['a'] }, { emoji: '🌋', line: 'Second.', url: 'https://a.example/x' }] };
  assert.deepEqual(publicCopy(sample, day).items, [{ emoji: '✈️', label: 'First label', line: 'First.', url: '' }, { emoji: '🌋', label: '', line: 'Second.', url: 'https://a.example/x' }]);
  assert.equal(publicCopy(sample, day).headline, 'Quiet one. Still here.');
  assert.deepEqual(publicCopy(sample, { headline: 'H. Still here.' }).items, []);
});

// ---- quiet mode ------------------------------------------------------------------------------------------------------

test('quiet mode: every day goes plain, the editions rest, nothing jokes, the page is white with no red, no yellow and no emoji, and the long footer is gone', () => {
  const r = copyRoot(edRoot);
  edit(latestFile(r), (l) => (l.quiet = { ...l.quiet, quiet: true, note: 'Thinking of everyone affected.' }));
  const out = buildAt(r);
  auditSite(out.dist, { label: 'quiet mode' });
  const home = read('index.html', out.dist);
  const hero = heroOf(home);
  assert.equal(deckOf(home), copy.QUIET_LINE);
  assert.ok(!home.includes('id="quip"') && !heroOf(home).includes('<script'), 'quiet mode has no joke and no inline script');
  has(hero, '<p class="note">Thinking of everyone affected.</p>');
  assert.ok(hero.indexOf('id="verdict"') < hero.indexOf('class="note"') && hero.indexOf('class="note"') < hero.indexOf('class="deck"'), 'the note sits under ALMOST., over the quiet line');
  assert.ok(!hero.includes('class="go"') && !hero.includes('See what almost got us'), 'no button to scroll, and no joke on one');
  assert.match(home, /<html lang="en"[^>]*data-quiet="1"/);
  // a white page: no red and no yellow anywhere in it, and black text and a black band
  const sheet = sheetOf(home);
  assert.ok(!/#D81E05/i.test(home) && !/#FFD100/i.test(home), 'neither the red nor the yellow is anywhere on a quiet page');
  has(sheet, ':root{--bg:#FFFFFF;--ink:#000000;--on:#FFFFFF;');
  has(home, '<meta name="theme-color" content="#FFFFFF">');
  // a page that turns quiet while it is open does the same through the html attribute
  assert.ok(sheet.includes('html[data-quiet="1"]{--bg:#FFFFFF;--on:#FFFFFF}') && sheet.includes('html[data-quiet="1"] .bn{color:#FFFFFF}') && sheet.includes('html[data-quiet="1"] .em{display:none}'), 'the runtime rules are in the sheet');
  const normalSheet = sheetOf(read('index.html', edDist));
  assert.ok(normalSheet.includes(':root{--bg:#FFD100;') && normalSheet.includes('#D81E05'), 'a normal page is yellow and has its red');
  // no emoji is drawn in a quiet page: the rows have no place for one
  assert.ok(!home.includes('class="em"') && !/\p{Extended_Pictographic}/u.test(home.replace(/<main[^>]*>/, '')), 'no emoji is drawn on a quiet page');
  has(home, '<h2 class="sec">TODAY’S TOP STORIES</h2>');
  assert.ok(!home.includes(copy.TAGLINE), 'no tagline');
  assert.ok(!home.includes('robot with low standards'));
  for (const line of copy.FOOTER_LINES_QUIET) assert.ok(home.includes(line), line);
  for (const line of ['Checked every 15 minutes.', 'Headlines belong to their publishers.']) has(home, `<p>${line}</p>`);
  has(home, `<meta name="description" content="${esc(copy.QUIET_DESCRIPTION)}">`);
  // each day lists its plain headlines with no rank and no closest call, and the quiet caption where it belongs
  for (const block of blocksOf(home)) {
    const facts = factsIn(block);
    assert.ok(facts.length >= 2);
    assert.ok(facts.every((f) => f.plain && !f.best && f.rank === null && f.emoji === null), 'plain rows: no rank, no emoji');
  }
  const [today, yesterday] = blocksOf(home);
  assert.deepEqual(factsIn(today).map((f) => f.label), factsIn(blocksOf(read('index.html'))[0]).map((f) => f.label), 'the same plain headlines as a day with no edition');
  for (const item of [...ED16.items, ...ED15.items]) assert.ok(!home.includes(esc(item.line)) && !home.includes(`<span class="lb">${esc(item.label)}</span>`), `the edition's words stay off: ${item.label}`);
  for (const text of [ED16.headline, ED15.headline]) assert.ok(!home.includes(esc(text)) && !read('almanac/index.html', out.dist).includes(esc(text)) && !read('feed.xml', out.dist).includes(esc(text)), text);
  has(yesterday, `<p class="dh">${copy.QUIET_LINE}</p>`);
  const captions = capsIn(home);
  assert.ok(captions.length >= 1 && captions.every((c) => c.startsWith('No jokes on this one.')), `${captions}`);
  assert.match(read('index.html'), /data-quiet="0"/);
  // the day pages say the same, and so do the about and almanac pages: a quiet page is white all through
  for (const rel of ['day/2026-11-16/index.html', 'day/2026-11-15/index.html']) assert.equal(deckOf(read(rel, out.dist)), copy.QUIET_LINE, rel);
  for (const rel of ['almanac/index.html', 'about/index.html', 'day/2026-11-16/index.html']) {
    const html = read(rel, out.dist);
    assert.match(html, /<html lang="en"[^>]*data-quiet="1"/, `${rel} is quiet`);
    assert.ok(!/#D81E05/i.test(html) && !/#FFD100/i.test(html), `${rel}: no red and no yellow`);
  }
});

test('a quiet build has no joke left anywhere: the end of the feed and the page script are plain', () => {
  const JOKES = ['fine before that too', 'New near misses', "so you don't have to", 'so you don&#39;t have to'];
  const r = copyRoot(edRoot);
  edit(latestFile(r), (l) => (l.quiet = { ...l.quiet, quiet: true, note: '' }));
  const quiet = buildAt(r).dist;
  const home = read('index.html', quiet);
  // the place that jokes on a normal page is there, in its plain form
  has(home, `<div class="end">\n<p>${esc("That's every day we've checked.")}</p>`);
  assert.ok(!home.includes('class="plus"'), 'there is no "Plus N more" link in any build');
  // and not one file of the build says any of the jokes, the page script included
  let looked = 0;
  for (const [rel, full] of listDist(quiet)) {
    if (!TEXT.test(rel)) continue;
    looked += 1;
    const text = fs.readFileSync(full, 'utf8');
    for (const joke of JOKES) assert.ok(!text.includes(joke), `${rel} says "${joke}"`);
  }
  assert.ok(looked >= 10, `${looked} text files looked at`);
  // a normal build still says the end-of-feed joke, so the check above can fail
  const normal = read('index.html', edDist);
  assert.ok(normal.includes(esc(copy.FEED_END)), 'a normal build still jokes at the end of the feed, so this check can fail');
});

// ---- quiet rows ----------------------------------------------------------------------------------------------------------

const quakeStory = (over = {}, sig = {}) => ({
  id: 'sig:quake:q1',
  cat: 'earth',
  kind: 'signal',
  title: 'M 6.8 - 20 km S of Somewhere',
  url: 'https://earthquake.usgs.gov/earthquakes/eventpage/q1',
  source: 'USGS',
  quiet: true,
  signal: { type: 'quake', mag: 6.8, place: '20 km S of Somewhere, Chile', pager: 'green', tsunami: false, ...sig },
  ...over,
});

test('quiet cards: a USGS quake links when PAGER is yellow, orange or red or a tsunami flag is up, and a headline links only when it reports harm', () => {
  assert.deepEqual(quietCard(quakeStory()), { reason: 'quake M6.5 or more', link: null }, 'green and no tsunami: nothing says anyone was hurt');
  assert.equal(quietCard(quakeStory({}, { pager: undefined })).link, null, 'no PAGER reading reads as green');
  assert.equal(quietCard(quakeStory({}, { pager: null })).link, null);
  for (const pager of ['yellow', 'orange', 'red', 'Orange']) assert.equal(quietCard(quakeStory({}, { pager })).link, 'ifrc', pager);
  assert.equal(quietCard(quakeStory({}, { tsunami: true })).link, 'ifrc', 'a tsunami flag, PAGER green');
  const headline = (title) => ({ id: 'n', cat: 'weather', kind: 'news', title, url: 'https://example.com/n', source: 'Example', quiet: true });
  // a warning, a forecast, a big quake or a wave that hurt no one, or harm with no place named: the caption alone
  for (const title of [
    'Magnitude 7.1 earthquake strikes off the coast',
    'Magnitude 7.1 earthquake prompts tsunami warning',
    'Tornado warning issued for the Bay Area',
    'Tsunami waves reach Sri Lanka and Indonesia after the quake',
    'Flash flood warning for the valley',
    'Hurricane makes landfall on the coast',
    'Tornado crosses the county',
    'Floods leave dozens dead',
    'Wildfire forces evacuations near town',
    'Wildfire evacuation order lifted in California',
    'Typhoon dies down over Japan',
  ]) assert.equal(quietCard(headline(title)).link, null, title);
  // harm to people or homes in the US goes to the US Red Cross
  for (const title of [
    'Oklahoma tornado destroys homes',
    'Wildfire forces evacuations near Santa Barbara, CA',
    'Flood displaced hundreds in Louisiana',
    'Wildfire destroys homes in Moore, OK',
    'Tornado kills two in Alabama',
    'Hiker dies in wildfire near Phoenix',
    'Flood damaged homes in Georgia, US',
  ]) assert.equal(quietCard(headline(title)).link, 'redcross', title);
  // harm to people or homes abroad goes to the international Red Cross and Red Crescent
  for (const title of ['Tornadoes in NSW and Queensland damaged homes', 'Cyclone leaves thousands displaced in Bangladesh', 'Flood deaths rise to 40 in Indonesia']) assert.equal(quietCard(headline(title)).link, 'ifrc', title);
  assert.equal(quietCard(headline('Typhoon damaged homes in Guam and Japan')).link, 'redcross', 'a US place wins when a headline names one and a place abroad');
  assert.equal(quietCard(headline('Cloudflare outage knocks thousands of sites offline')), null, 'not a quiet card at all');
});

test('quiet cards: a USGS quake outside the US goes to the international Red Cross, everything else to the US one', () => {
  const outside = ['148 km WSW of Tual, Indonesia', '20 km S of Somewhere, Chile', 'near the coast of Peru', '12 km W of Tbilisi, Georgia', 'Baja California, Mexico', 'Gulf of California', '30 km N of Kamchatka, Russia', 'Yukon, Canada'];
  const inside = ['10 km W of Anchorage, Alaska', '5 km SE of Ridgecrest, CA', '12 km NE of Pahala, Hawaii', 'Puerto Rico region', 'Guam region', 'Southern California', '20 km S of Atlanta, GA', 'Aleutian Islands, Alaska', 'Virgin Islands region', '8 km N of Reno, NV'];
  for (const place of outside) {
    assert.equal(isUsPlace(place), false, place);
    assert.equal(quietCard(quakeStory({}, { pager: 'yellow', place })).link, 'ifrc', place);
  }
  for (const place of inside) {
    assert.equal(isUsPlace(place), true, place);
    assert.equal(quietCard(quakeStory({}, { pager: 'yellow', place })).link, 'redcross', place);
  }
  assert.equal(isUsPlace(''), false);
  assert.equal(isUsPlace(undefined), false);
  assert.equal(quietCard(quakeStory({ title: 'M 6.8 - Alaska' }, { tsunami: true, place: 'Gulf of Alaska' })).link, 'redcross', 'a US quake with a tsunami flag');
  const news = (title) => ({ id: 'n2', cat: 'earth', kind: 'news', title, url: 'https://example.com/n2', source: 'Example', quiet: true });
  assert.equal(quietCard(news('Flood leaves 40 dead in Indonesia')).link, 'ifrc', 'a news story is read by its headline, and the place decides the charity');
  assert.equal(quietCard(news('Deadly flood hits a town in Indonesia')).link, null, 'no harm in the words, so no link');
  assert.equal(cfg.quiet.quietLink, 'https://www.redcross.org/donate');
  assert.equal(cfg.quiet.quietLinkIntl, 'https://www.ifrc.org/');
});

test('phase 6 donate rule: the four headlines the owner saw, by the rule and on the page', () => {
  const ctx = { byId: new Map(), quietMode: false, quietCaption: 'No jokes on this one.', quietLink: cfg.quiet.quietLink, quietLinkIntl: cfg.quiet.quietLinkIntl };
  const story = (title) => ({ id: 'n', cat: 'weather', kind: 'news', title, url: 'https://example.com/n', source: 'Example', outlets: 2 });
  const cases = [
    // a warning with nobody hurt, in a US city: a quiet card and no link
    ['Tornado warning, waterspouts and hail sweep Bay Area in rare severe storm', null],
    // homes damaged, outside the US: the international Red Cross and Red Crescent
    ['A possible tornado has damaged dozens of homes while giant 10cm hail and destructive storms lashed NSW and Queensland', 'ifrc'],
    // a big quake and a wave that did not come: quiet by size, and nothing says anyone was hurt
    ['No tsunami threat to Sri Lanka after 6.6-magnitude earthquake near Indonesia', null],
    // homes destroyed in the US: the US Red Cross
    ['Tornado destroys homes in Oklahoma town', 'redcross'],
  ];
  for (const [title, link] of cases) {
    const card = quietCard(story(title));
    assert.ok(card, `${title}: a quiet card`);
    assert.equal(card.link, link, title);
    const html = headlineRow(story(title), ctx);
    assert.ok(html.includes('<p class="cap">No jokes on this one.</p>'), `${title}: the plain line`);
    const expected = { ifrc: 'https://www.ifrc.org/', redcross: 'https://www.redcross.org/donate' }[link];
    if (!expected) assert.ok(!html.includes('class="help"'), `${title}: no donate link on the page`);
    else {
      assert.equal(html.match(/<a class="help" href="([^"]*)"/)?.[1], expected, title);
      assert.ok(html.indexOf('</a>') < html.indexOf('class="help"'), `${title}: the donate link sits outside the headline link`);
      assert.equal((html.match(/<a /g) || []).length, 2, `${title}: the headline link and the donate link only`);
    }
  }
  // the sentence on the About page says the same thing the rule does
  assert.match(copy.QUIET_CARDS_ABOUT, /hurt, or likely hurt, it also links to a charity/);
  assert.match(copy.QUIET_CARDS_ABOUT, /Red Cross for a place in the United States/);
  assert.match(copy.QUIET_CARDS_ABOUT, /international Red Cross and Red Crescent for a place in another country/);
});

test('a quiet story is a quiet row even when its edition says it is not, and a quake that is only big gets the plain line and no donate link', () => {
  assert.equal(ED16.items[5].quiet, false, 'the edition does not call the quake quiet');
  for (const [label, base] of [['edition', edDist], ['plain headlines', dist]]) {
    const home = read('index.html', base);
    const quiet = rowsOf(home).filter((r) => /^<li class="row[^"]*\bquiet\b/.test(r));
    assert.equal(quiet.length, 1, `${label}: the quake is the one quiet row`);
    assert.match(quiet[0], /M 6\.6|magnitude 6\.6/i, `${label}: it is the Tual quake`);
    assert.equal(rowFacts(quiet[0]).cap, 'No jokes on this one.', `${label}: the line stands alone, with no donate link`);
    assert.ok(!home.includes('redcross.org') && !home.includes('ifrc.org'), `${label}: no donate link anywhere on the page`);
  }
  // on the day page the same quake keeps its caption in the list of every headline
  const heads = headsOf(read('day/2026-11-16/index.html')).filter((h) => h.startsWith('<li class="hd quiet'));
  assert.equal(heads.length, 1);
  assert.ok(heads[0].includes('<p class="cap">No jokes on this one.</p>'));
});

test('quiet cards: the page shows the right link, opening safely, for each case', () => {
  const quakeRow = (signal) => {
    const r = copyRoot(edRoot);
    const patch = (list) => list.forEach((st) => st.id.startsWith('sig:quake') && Object.assign(st, { signal: { ...st.signal, ...signal } }));
    edit(latestFile(r), (l) => patch(l.stories));
    edit(dayFile(r, '2026-11-16'), (d) => patch(d.stories));
    const home = read('index.html', buildAt(r).dist);
    const row = rowsOf(home).find((x) => /^<li class="row[^"]*\bquiet\b/.test(x));
    assert.ok(row, 'the quake row is there');
    return row;
  };
  // the caption is a line of the card, and the donate link is its own link after the card, never inside it
  const abroad = quakeRow({ pager: 'orange' });
  assert.ok(abroad.includes('</a>\n<a class="help" href="https://www.ifrc.org/" target="_blank" rel="noopener">Support the Red Cross and Red Crescent</a>'), 'Tual, Indonesia, PAGER orange');
  const home = quakeRow({ pager: 'yellow', place: '10 km W of Anchorage, Alaska' });
  assert.ok(home.includes('</a>\n<a class="help" href="https://www.redcross.org/donate" target="_blank" rel="noopener">Donate to the Red Cross</a>'), 'Anchorage, Alaska, PAGER yellow');
  assert.ok(quakeRow({ tsunami: true }).includes('href="https://www.ifrc.org/"'), 'a tsunami flag outside the US');
  const green = quakeRow({ pager: 'green', tsunami: false });
  assert.ok(green.includes('<span class="cap">No jokes on this one.</span>') && !green.includes('class="help"'), 'back to green: no link');
  for (const row of [abroad, home, green]) assert.equal(rowFacts(row).cap, 'No jokes on this one.', 'the caption is in the card');
  for (const row of [abroad, home]) {
    const facts = rowFacts(row);
    assert.ok(row.indexOf('</a>') < row.indexOf('class="help"'), 'the card closes before the donate link opens');
    assert.equal((row.match(/<a /g) || []).length, 2, 'the card and the donate link, and nothing else');
    assert.ok(facts.help && /^(?:Donate to the Red Cross|Support the Red Cross and Red Crescent)$/.test(facts.helpText) && !/[→←]/.test(facts.helpText), 'the link says what it does, with no arrow');
  }
});

test('a quiet line whose story has left the day keeps its caption and has no link to guess at', () => {
  const gone = { ...ED16, items: ED16.items.map((i, n) => (n === 5 ? { ...i, ids: ['gone:quake'], quiet: true } : i)) };
  const { dist: out } = withEditions({ ...EDITIONS, '2026-11-16': gone });
  const row = rowsOf(read('index.html', out)).find((x) => /^<li class="row[^"]*\bquiet\b/.test(x));
  assert.ok(row && row.includes('<span class="cap">No jokes on this one.</span>') && !row.includes('class="help"'));
});

// ---- hostile text ---------------------------------------------------------------------------------------------------------

test('a headline that is HTML, with a javascript: link, renders as inert text: in the rows, in the list of every headline, and on the pages', () => {
  for (const rel of ['index.html', 'day/2026-11-16/index.html']) {
    const html = read(rel);
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), `${rel}: shown as text`);
    assert.ok(!html.includes('<img src=x'), `${rel}: never as a tag`);
    assert.ok(!html.includes('<script>alert'), `${rel}: no script from a publisher name`);
    assert.ok(!/<[a-z][^>]*\sonerror\s*=/i.test(html) && !/<[a-z][^>]*\sonmouseover\s*=/i.test(html), `${rel}: no handler attribute`);
    assert.ok(!/href="javascript:/i.test(html), `${rel}: no javascript: link`);
    const first = rowsOf(html).find((r) => r.includes('&lt;img src=x'));
    assert.ok(first && !first.includes('<a '), `${rel}: the row has no link at all`);
    assert.ok(first.includes('<span class="src">&lt;script&gt;alert(2)&lt;/script&gt;</span>') && !first.includes('Read it'), `${rel}: but it still says where it came from, and offers nothing to open`);
    assert.ok(html.includes('&quot; onmouseover=&quot;alert(3)&quot; x=&quot;'), `${rel}: quotes are escaped`);
    const second = rowsOf(html).find((r) => r.includes('onmouseover'));
    assert.ok(second.includes('href="https://example.com/?q=%22%3E%3Cscript%3Ealert(4)%3C/script%3E"'), `${rel}: the link cannot break out of its attribute`);
    assert.ok(!second.includes('"><script>'), `${rel}: no break out in the link`);
    assert.ok(second.includes('O&#39;Reilly &amp; &lt;Sons&gt;'), `${rel}: the publisher is escaped`);
  }
  // in the list of every headline: the same, and the linkless one has no anchor
  const day = read('day/2026-11-16/index.html');
  const heads = headsOf(day);
  const bad = heads.find((h) => h.includes('&lt;img src=x'));
  assert.ok(bad && !bad.includes('<a '), 'no link on a headline with no safe link');
  assert.ok(bad.includes('&lt;script&gt;alert(2)&lt;/script&gt;'), 'the publisher name is text');
  assert.ok(heads.find((h) => h.includes('onmouseover')).includes('href="https://example.com/?q=%22%3E%3Cscript%3Ealert(4)%3C/script%3E"'));
});

test('a line the editor wrote that is HTML is just as inert: the headline, the labels, the lines, the source, the link, the share text, the feed and the card', () => {
  const hostile = {
    ...ED16,
    headline: '<i>All fine</i> & "ok" <script>alert(5)</script> said the page. Still here.',
    items: [
      itemOf(AIRLINES, '<b>\u{1F4A5}', '<b>Boom</b>', '<img src=x onerror=alert(1)> and "quotes" & <b>bold</b>', { source: '<script>alert(2)</script>', title: '" onmouseover="alert(3)" x="', url: 'https://example.com/?q="><script>alert(4)</script>', outlets: 1 }),
      itemOf(AWS, '🖥️', '"quote" & <i>it</i>', 'Second line with <a href="https://evil.example">a link</a> in it', { source: "O'Reilly & <Sons>", outlets: 1 }),
      itemOf(BREACH, '🔓', 'Plain label', 'Third line is plain.', { outlets: 'many' }),
    ],
  };
  const out = withEditions({ ...EDITIONS, '2026-11-16': hostile });
  assert.equal(validateEdition(hostile, { date: '2026-11-16', excluder: gk.excluder }).ok, true, 'it passes the check, so the page must be the one to keep it safe');
  auditSite(out.dist, { label: 'hostile edition' });
  const home = read('index.html', out.dist);
  // the headline is not on the homepage's first screen any more: the day page says it, as text, in its description
  has(read('day/2026-11-16/index.html', out.dist), '&lt;i&gt;All fine&lt;/i&gt; &amp; &quot;ok&quot; &lt;script&gt;alert(5)&lt;/script&gt; said the page. Still here.');
  assert.equal(todayHeadline(out.dist), hostile.headline, 'and in the data file it is the same text');
  const facts = factsIn(blocksOf(home)[0]);
  assert.deepEqual(facts.map((f) => f.label), ['<b>Boom</b>', '"quote" & <i>it</i>', 'Plain label']);
  assert.deepEqual(facts.map((f) => f.line), ['<img src=x onerror=alert(1)> and "quotes" & <b>bold</b>', 'Second line with <a href="https://evil.example">a link</a> in it', 'Third line is plain.']);
  assert.equal(facts[0].href, 'https://example.com/?q=%22%3E%3Cscript%3Ealert(4)%3C/script%3E');
  assert.equal(facts[0].src, '<script>alert(2)</script>', 'the news site, as text');
  assert.equal(facts[2].src, BREACH.source, 'a count that is not a number changes nothing: a row names its source and nothing else');
  for (const rel of ['index.html', 'day/2026-11-16/index.html', 'almanac/index.html', 'feed.xml']) {
    const text = read(rel, out.dist);
    for (const tag of ['<img src=x', '<script>alert', '<i>All', '<b>bold', '<b>Boom', '<i>it', '<b>\u{1F4A5}', '<a href="https://evil.example"']) assert.ok(!text.includes(tag), `${rel}: ${tag}`);
  }
  // the feed is still valid XML, and what a reader's app decodes from it is still text
  const xml = read('feed.xml', out.dist);
  assert.equal(XMLValidator.validate(xml), true);
  const item = [].concat(new XMLParser().parse(xml).rss.channel.item)[0];
  assert.equal(item.title, hostile.headline, 'a title is plain text in RSS');
  const leftover = item.description.replace(/<\/?(?:p|ol|li)>/g, '').replace(/<a href="[^"]*">Read it<\/a>/g, '');
  assert.ok(!leftover.includes('<'), `the description is escaped HTML, so no tag of theirs is in it: ${leftover.slice(0, 120)}`);
  // the share text is an attribute: the quotes cannot end it, and the card holds nothing of theirs but text
  assert.ok(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(home));
  const card = ogSvg({ date: '2026-11-16', score: 62, host: 'didtheworldendtoday.com', headline: hostile.headline, fontFiles: FONT_FILES });
  assert.ok(!card.includes('<script') && !card.includes('<i>') && card.includes('&lt;i&gt;All fine&lt;/i&gt;'), 'on the card it is escaped text too');
});

test('esc, url and num', () => {
  assert.equal(esc(`<a href="x" onclick='y'>&\``), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&#96;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(42), '42');
  assert.equal(url('https://example.com/a?b=1&c="2"'), 'https://example.com/a?b=1&amp;c=%222%22');
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,hi', 'vbscript:x', 'file:///etc/passwd', '//evil.example/x', '/relative', '', null, undefined, 42, ' javascript:alert(1)']) assert.equal(url(bad), '', String(bad));
  assert.equal(num('12'), 12);
  assert.equal(num('x'), 0);
  assert.equal(num(NaN, 5), 5);
  assert.equal(num(Infinity), 0);
  assert.equal(capFirst('a popular AI chatbot'), 'A popular AI chatbot');
  assert.equal(capFirst(''), '');
  assert.equal(joinNames(['Cloudflare', 'Claude']), 'Cloudflare and Claude');
});

test('a row with a bad link shows its text and no anchor, and a row with missing fields still prints', () => {
  const ctx = { byId: new Map(), quietMode: false, quietCaption: 'q', quietLink: 'https://www.redcross.org/donate', quietLinkIntl: 'https://www.ifrc.org/', plain: false };
  const bad = dayRow({ emoji: '🌐', label: '<b>L</b>', line: '<b>hi</b>', ids: ['a'], quiet: false, url: 'javascript:alert(1)', source: 'S', outlets: 1 }, 1, ctx);
  assert.ok(bad.includes('<span class="lb">&lt;b&gt;L&lt;/b&gt;</span>') && bad.includes('<span class="ln">&lt;b&gt;hi&lt;/b&gt;</span>'));
  assert.ok(!bad.includes('<a '), 'no anchor');
  assert.ok(bad.includes('<span class="src">S</span>') && !bad.includes('Read it'), 'the words stay, and there is nothing to open');
  // no label: the line takes the label place and the row has no second line
  const bare = dayRow({ emoji: '🌐', label: '', line: 'Only a line', ids: ['a'], url: 'https://example.com/', source: 'S' }, 0, ctx);
  assert.ok(bare.includes('<span class="lb">Only a line</span>') && !bare.includes('class="ln"'));
  // a plain headline is its own title in the label place, with no rank and no line
  const plain = dayRow({ emoji: '🌐', label: '', line: 'A line', title: 'The publisher\'s own headline', ids: ['a'], url: 'https://example.com/', source: 'S' }, 0, { ...ctx, plain: true });
  assert.ok(plain.includes('<span class="lb">The publisher&#39;s own headline</span>') && !plain.includes('class="ln"') && !plain.includes('class="rn"') && !plain.includes('class="sr"'));
  assert.ok(plain.startsWith('<li class="row plain">'));
  for (const odd of [{}, { line: 'Only a line' }, { emoji: null, line: undefined, url: 42, outlets: 'x', source: undefined }, null]) {
    for (const plainRow of [false, true]) {
      const html = dayRow(odd || {}, 0, { ...ctx, plain: plainRow });
      for (const token of ['undefined', 'NaN', '[object']) assert.ok(!html.includes(token), `${token} in ${JSON.stringify(odd)}`);
    }
  }
  const heads = headlineRow({ id: 'z', cat: 'zzz', title: 't', url: 'https://example.com', source: 's', outlets: 'x' }, ctx);
  for (const token of ['undefined', 'NaN', '[object']) assert.ok(!heads.includes(token), token);
  assert.ok(!headlineRow({}, ctx).includes('undefined'));
  assert.ok(dayRows([{ emoji: 'e', line: 'l', url: 'https://example.com/', source: 's', outlets: 1 }], ctx).startsWith('<ol class="rows" role="list">') && headlineRows([{ title: 't' }], ctx).startsWith('<ol class="heads" role="list">'));
  assert.ok(almanacRows([{ date: '2026-11-16', score: 'x', headline: '<b>x</b>' }], { root: '../' }).includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(!almanacRows([{}], { root: '../' }).includes('undefined'));
});

// ---- day pages --------------------------------------------------------------------------------------------------------------

const headFacts = (html) => {
  const get = (re) => {
    const m = html.match(re);
    return m ? unesc(m[1]) : null;
  };
  return {
    quiet: /^<li class="hd quiet/.test(html),
    title: get(/<span class="ht">([^<]*)<\/span>/),
    href: get(/<a class="hla" href="([^"]*)"/),
    source: get(/<span class="hs">([^<]*)<\/span>/),
    cap: get(/<p class="cap">([\s\S]*?)<\/p>/),
    help: get(/<a class="help" href="([^"]*)"/),
  };
};

test('day pages: the same sign for another day, that day\'s near misses, every headline we read that day, and a way to the next and previous', () => {
  const past = read('day/2026-11-15/index.html', edDist);
  has(past, '<title>Did the world end on November 15, 2026? ALMOST.</title>');
  has(past, '<div class="band"><h1 class="q">Did the world end on Nov 15?</h1></div>');
  assert.equal(dayHeadlineOf(past), ED15.headline);
  has(past, '<div class="board" role="meter" aria-label="Doom Score" aria-valuenow="11" aria-valuemin="0" aria-valuemax="99" aria-valuetext="11 out of 99">');
  has(past, '<span class="bn">11</span>');
  assert.ok(!past.includes('class="go"') && !past.includes('class="sh"') && !past.includes('Share today'), 'Share today is for the homepage');
  assert.equal((past.match(/data-act="share"/g) || []).length, 1, 'one share button on the page');
  has(past, '<button class="btn" type="button" data-act="share">Share this day</button>');
  has(past, '<section class="day" id="rows">');
  has(past, '<h2 class="sec">NEAR MISSES</h2>');
  assert.deepEqual(factsIn(past).map((f) => f.label), ED15.items.map((i) => i.label));
  assert.deepEqual(factsIn(past).map((f) => f.line), ED15.items.map((i) => i.line));
  // the same sign as the homepage, for that day, then the share button right after the rows
  const marks = ['class="band"', 'class="hero"', 'data-act="check"', 'class="deck"', 'role="meter"', 'class="sec"', '<li class="row best', 'class="src"', 'data-act="share"', 'id="all"', 'class="dnav"', '<footer>'].map((m) => past.indexOf(m));
  assert.ok(marks.every((n) => n > 0), `${marks}`);
  assert.deepEqual(marks, [...marks].sort((a, b) => a - b), 'the day page reads in the same order');
  has(past, `${SITE}/og/2026-11-15.png`);
  has(past, 'data-live="0"');
  assert.ok(past.includes(`<meta name="description" content="${esc(ED15.headline)} Doom Score 11 of 99 on November 15, 2026. Every story links to its source.">`), 'the description says the headline, the score, the day, and that every story links to its source');
  has(past, '<nav class="dnav" aria-label="Other days">\n<span></span>\n<a href="../2026-11-16/">Later: Nov 16</a>\n</nav>');
  assert.ok(!past.includes('Earlier:'), 'no day before it');
  assert.ok(!/[→←]|&rarr;|&larr;/.test(past.slice(past.indexOf('<nav'))), 'no arrows in the way to the next day, or in the footer');
  has(past, '<h2 class="sec">Every headline we read that day</h2>');
  assert.deepEqual(headsOf(past).map((h) => headFacts(h).title).sort(), stored15.stories.map((s) => s.title).sort(), 'every story of the day, once');

  const today = read('day/2026-11-16/index.html', edDist);
  has(today, '<title>Did the world end on November 16, 2026? ALMOST.</title>');
  has(today, '<div class="band"><h1 class="q">Did the world end today?</h1></div>');
  assert.equal(dayHeadlineOf(today), ED16.headline);
  has(today, 'data-live="1"');
  assert.ok(!today.includes('data-since'), 'no ticking time');
  has(today, '<nav class="dnav" aria-label="Other days">\n<a href="../2026-11-15/">Earlier: Nov 15</a>\n<span></span>\n</nav>');
  assert.ok(!today.includes('Later:'), 'nothing after today');
  has(today, '<h2 class="sec">Headlines from the last 24 hours, as of 5:30 PM ET</h2>');
  assert.deepEqual(factsIn(today).map((f) => f.line), ED16.items.map((i) => i.line));
  const heads = headsOf(today).map(headFacts);
  assert.deepEqual(heads.map((h) => h.title).sort(), stored16.stories.map((s) => s.title).sort(), 'all of them, the ones in the rows too');
  // each headline is the link, with its source and outlet count under it
  const cloud = heads.find((h) => h.title === 'Cloudflare outage knocks thousands of sites offline');
  assert.equal(cloud.href, 'https://pub0.example/internet/0');
  assert.equal(cloud.source, 'Pub A · Read it', 'the news site, then what the headline does');
  assert.equal(heads.find((h) => h.title === '<img src=x onerror=alert(1)>').source, '<script>alert(2)</script> · 2 news sites', 'no link, so no "Read it"');
  assert.equal(heads.filter((h) => h.quiet).length, 1);
  for (const m of today.matchAll(/<a class="hla" ([^>]*)>/g)) assert.match(m[1], /target="_blank" rel="noopener"/);
  // a plain-headline day reads the same way
  assert.equal(dayHeadlineOf(read('day/2026-11-16/index.html')), copy.subline(latest.score));
  assert.equal(lineCount(read('day/2026-11-16/index.html')), cfg.edition.fallbackRows);
});

test('a day page for a day with no stories and no edition says so plainly', () => {
  const r = copyRoot(root);
  edit(dayFile(r, '2026-11-15'), (d) => (d.stories = []));
  const out = buildAt(r);
  const page = read('day/2026-11-15/index.html', out.dist);
  has(page, '<p class="empty">Nothing on file for this day.</p>');
  assert.ok(!page.includes('Every headline we read that day'), 'no empty list');
  assert.equal(dayHeadlineOf(page), copy.subline(11), 'the ladder line');
  assert.deepEqual(almanacRowsOf(read('almanac/index.html', out.dist)).map((row) => row[0]), ['../day/2026-11-16/'], 'a day with nothing filed is not in the Almanac');
  auditSite(out.dist, { label: 'an empty day' });
});

// ---- the Almanac ----------------------------------------------------------------------------------------------------------------

const almanacRowsOf = (html) => [...html.matchAll(/<a class="al" href="([^"]*)">\s*<span class="ad">([^<]*)<\/span>\s*<span class="ah">([^<]*)<\/span>/g)].map((m) => [m[1], m[2], unesc(m[3])]);

test('the Almanac lists every day, newest first: each row is a link with its date, its Doom Score and its headline', () => {
  for (const [label, base, heads] of [
    ['editions', edDist, [ED16.headline, ED15.headline]],
    ['plain headlines', dist, [copy.subline(latest.score), copy.subline(11)]],
  ]) {
    const html = read('almanac/index.html', base);
    assert.deepEqual(almanacRowsOf(html), [
      ['../day/2026-11-16/', `Mon, Nov 16 &middot; Doom ${latest.score}`, heads[0]],
      ['../day/2026-11-15/', 'Sun, Nov 15 &middot; Doom 11', heads[1]],
    ], label);
    has(html, '<h1 class="pg">The Almanac of Almost</h1>');
    has(html, '<p class="lead">Every day we&#39;ve checked, newest first.</p>');
    assert.ok(html.indexOf('class="pg"') < html.indexOf('class="lead"') && html.indexOf('class="lead"') < html.indexOf('class="alm"'), `${label}: the lead sits between the title and the list`);
    has(html, '<ol class="alm" role="list">');
    assert.ok(!html.includes('Worst day so far'), `${label}: two editions are too few for a record line`);
    assert.ok(!/<script/i.test(html));
    has(html, '<a class="band" href="../"><span class="q">Did the world end today?</span></a>');
    has(html, '<a href="../">Today</a>');
    assert.ok(!/[→←]/.test(html), `${label}: no arrow`);
  }
});

// The seeded site has two days; this one has `count`, the extra days being older ones.
const LONG_RUN = { ...cfg, firstEdition: '2026-11-01' };
function rootWithDays(count) {
  const r = copyRoot(root);
  for (let i = 0; i < count - 2; i += 1) {
    const date = `2026-11-${String(14 - i).padStart(2, '0')}`;
    const story = { id: `old${i}`, kind: 'news', cat: 'internet', title: `Cloudflare outage knocks thousands of sites offline, take ${i}`, url: `https://pub0.example/old/${i}`, source: 'Pub A', publishedAt: `${date}T15:00:00.000Z`, firstSeenAt: `${date}T15:00:00.000Z`, outlets: 3, outletNames: PUBS, score: 10 };
    fs.writeFileSync(dayFile(r, date), JSON.stringify({ date, score: 20 + i, fired: ['internet'], bumps: [], change: null, updatedAt: `${date}T23:59:00.000Z`, stories: [story] }));
  }
  return r;
}

test('the record line, "Worst day so far", is on the Almanac only, and waits until there are 7 editions', () => {
  for (const [count, shown] of [[2, false], [6, false], [7, true], [9, true]]) {
    const out = build(rootWithDays(count), { siteUrl: SITE, config: LONG_RUN });
    assert.equal(out.days.length, count);
    assert.equal(read('almanac/index.html', out.dist).includes('Worst day so far'), shown, `${count} editions`);
    assert.ok(!read('index.html', out.dist).includes('Worst day so far'), `${count} editions: never on the homepage`);
  }
  const html = read('almanac/index.html', build(rootWithDays(7), { siteUrl: SITE, config: LONG_RUN }).dist);
  has(html, `<p class="record">Worst day so far: Nov 16, Doom ${latest.score}</p>`);
  assert.ok(html.indexOf('class="record"') < html.indexOf('class="alm"'), 'above the list');
  assert.equal(copy.recordLine({ date: '2026-11-16', score: 71 }, 6), '');
  assert.equal(copy.recordLine({ date: '2026-11-16', score: 71 }, 7), 'Worst day so far: Nov 16, Doom 71');
  assert.equal(copy.recordLine({ date: '2026-11-16', score: 71 }), '', 'no edition count reads as none');
  assert.equal(copy.RECORD_MIN_EDITIONS, 7);
});

test('the homepage shows today and up to six earlier days, yesterday open and the rest folded, then a way to the older ones', () => {
  const seven = build(rootWithDays(7), { siteUrl: SITE, config: LONG_RUN });
  const home7 = read('index.html', seven.dist);
  assert.equal(blocksOf(home7).length, 7);
  has(home7, '<div class="end">');
  has(home7, `<p>${esc(copy.FEED_END)}</p>`);
  has(home7, '<a href="./almanac/">Every day so far</a>');
  assert.ok(!home7.includes('Older days') && !home7.includes('The Almanac of Almost →') && !/[→←]/.test(home7.replace(/<main[\s\S]*<\/main>/, '')), 'no arrows in the words around the feed');

  const nine = build(rootWithDays(9), { siteUrl: SITE, config: LONG_RUN });
  const home9 = read('index.html', nine.dist);
  const blocks = blocksOf(home9);
  assert.equal(blocks.length, 7, 'seven blocks, not nine');
  has(blocks[2], '<p class="dk">SATURDAY</p>');
  has(blocks[2], '<h2 class="dl"><a href="./day/2026-11-14/">NOV 14</a></h2>');
  has(blocks[2], '<p class="ds">Doom Score 20 <span class="sq" aria-hidden="true">');
  has(home9, '<p class="end"><a href="./almanac/">Every day so far</a></p>');
  assert.ok(!home9.includes(esc(copy.FEED_END)), 'and not "that is every day"');
  assert.ok(!home9.includes('NOV 8') && !home9.includes('NOV 9'), 'the two oldest days are not on the homepage');
  assert.equal((read('almanac/index.html', nine.dist).match(/class="al"/g) || []).length, 9, 'the Almanac has all nine');
  assert.ok(fs.existsSync(path.join(nine.dist, 'day', '2026-11-08', 'index.html')), 'and each has its own page');
  // yesterday's rows are open; every day before it is folded behind a button
  assert.ok(!blocks[1].includes('<details'), "yesterday's rows are open");
  for (const block of blocks.slice(2)) {
    assert.equal((block.match(/<details class="dd">/g) || []).length, 1, 'an older day has its rows behind one details');
    assert.match(block, /<details class="dd">\n<summary>Show the 1 top story<\/summary>\n<ol class="rows" role="list">/, 'its summary says how many, and these have no edition');
    assert.ok(block.indexOf('class="ds"') < block.indexOf('<details'), 'the kicker, date, headline and score stay in view above it');
  }
  auditSite(nine.dist, { label: 'nine days' });
});

// ---- phase 12: five rows, then a See more -----------------------------------------------------------
//
// A list of rows shows its first five and keeps the rest behind one See more, numbered on. Today's See more also holds
// the day's other headlines, so today's share button sits under all of it.

const EMOJI8 = ['✈️', '🖥️', '🔓', '📉', '☄️', '🌋', '⚡', '🔌'];
const CATS5 = ['internet', 'grid', 'hacks', 'markets', 'flights'];

// A copy of the seeded site where each given day has `near` stories that its edition names as its near misses, and
// `other` stories that nothing names. A day with no near misses has no edition, so it shows plain headlines.
function crowdedSite(days) {
  const r = copyRoot(root);
  const editions = {};
  for (const { date, near = 0, other = 0 } of days) {
    const make = (kind, words, n) =>
      Array.from({ length: n }, (_, i) => ({
        id: `${date}:${kind}${i}`,
        kind: 'news',
        cat: CATS5[i % CATS5.length],
        title: `${words} number ${i + 1} of ${date} with a headline of its own`,
        url: `https://pub${i}.example/${date}/${kind}/${i}`,
        source: PUBS[i % PUBS.length],
        publishedAt: `${date}T20:00:00.000Z`,
        firstSeenAt: `${date}T20:00:00.000Z`,
        outlets: 2,
        outletNames: ['a', 'b'],
        score: 100 - i - (kind === 'o' ? 50 : 0),
      }));
    const nears = make('n', 'Near miss', near);
    const stories = [...nears, ...make('o', 'Other headline', other)];
    const file = dayFile(r, date);
    if (fs.existsSync(file)) {
      edit(file, (d) => {
        d.stories = stories;
      });
    } else fs.writeFileSync(file, JSON.stringify({ date, score: 20, fired: ['internet'], bumps: [], change: null, updatedAt: `${date}T23:59:00.000Z`, stories }));
    if (date === latest.etDate) {
      edit(latestFile(r), (l) => {
        l.stories = stories;
      });
    }
    if (near) {
      editions[date] = {
        date,
        by: 'hand',
        writtenAt: `${date}T23:00:00.000Z`,
        headline: 'A busy day of near misses came and went. Still here.',
        items: nears.map((s, i) => itemOf(s, EMOJI8[i % EMOJI8.length], `Near miss ${i + 1}`, `Close call ${i + 1} passed without a scratch.`)),
      };
    }
  }
  writeEditions(r, editions);
  return { root: r, ...buildAt(r) };
}

// The <details> that starts at `from`, down to the </details> that closes it, with any details inside it.
function detailsAt(html, from) {
  let depth = 0;
  for (const m of html.slice(from).matchAll(/<details\b|<\/details>/g)) {
    depth += m[0] === '</details>' ? -1 : 1;
    if (depth === 0) return html.slice(from, from + m.index + m[0].length);
  }
  return null;
}
const seeMoreIn = (html) => {
  const at = html.indexOf('<details class="more">');
  return at < 0 ? null : detailsAt(html, at);
};
const summaryOf = (details) => unesc((details.match(/<summary>([^<]*)<\/summary>/) || [])[1]);
const ranksIn = (html) => rowsOf(html).map((r) => rowFacts(r).rank);
const titlesIn = (html) => headsOf(html).map((h) => headFacts(h).title);
const insideOf = (details) => details.slice(details.indexOf('</summary>') + '</summary>'.length);

test('phase 12: today shows five near misses, then a See more with the rest and the day\'s other headlines, and the share button is under all of it', () => {
  const site = crowdedSite([{ date: '2026-11-16', near: 8, other: 20 }]);
  const home = read('index.html', site.dist);
  assert.equal(readJson(path.join(site.dist, 'api', 'today.json')).stories.length, 28, 'the day has 8 near misses and 20 other stories');
  const [today] = blocksOf(home);
  // the first five rows, as they were, then the See more
  const door = today.indexOf('<details class="more">');
  assert.ok(door > 0, 'a See more');
  assert.deepEqual(ranksIn(today.slice(0, door)), ['1', '2', '3', '4', '5']);
  assert.ok(today.slice(0, door).trimEnd().endsWith('</ol>'), 'right after row 5');
  const more = seeMoreIn(today);
  assert.equal(summaryOf(more), 'See 23 more', 'it counts all it opens: three near misses and twenty headlines');
  // inside: rows 6 to 8 in the same markup, and only the first row of the day is the closest call
  const inside = insideOf(more);
  assert.deepEqual(ranksIn(inside), ['6', '7', '8']);
  assert.deepEqual(rowsOf(inside).map((r) => rowFacts(r).label), ['Near miss 6', 'Near miss 7', 'Near miss 8']);
  assert.ok(rowsOf(today).map(rowFacts).every((f, i) => f.best === (i === 0) && !f.plain), 'only #1 is the closest call');
  // then a small heading and the day's other headlines, without the stories the near misses are made of
  assert.equal((today.match(/<h3 class="sub">More from today<\/h3>/g) || []).length, 1, 'one small heading');
  assert.ok(inside.lastIndexOf('<li class="row') < inside.indexOf('<h3 class="sub">') && inside.indexOf('<h3 class="sub">') < inside.indexOf('<li class="hd'), 'near misses, the heading, then the headlines');
  const titles = titlesIn(inside);
  assert.equal(titles.length, 20, 'the twenty other headlines');
  assert.equal(new Set(titles).size, 20, 'each once');
  assert.ok(titles.every((t) => t.startsWith('Other headline number ')), `not one of the eight near misses' stories: ${titles}`);
  assert.ok(!today.includes('Near miss number'), "the near misses' own headlines are not repeated below them");
  // the list is the one a day page shows: ten show, the rest wait behind their own fold
  const fold = detailsAt(inside, inside.indexOf('<details class="more">'));
  assert.equal(summaryOf(fold), 'Show 10 more headlines');
  assert.equal(titlesIn(inside.slice(0, inside.indexOf('<details'))).length, 10, 'ten shown first');
  assert.equal(titlesIn(fold).length, 10, 'and ten in the fold');
  assert.equal((today.match(/<details/g) || []).length, 2, 'the See more and the fold inside it');
  // the share button is under all of it, and the way to every headline is the footer's alone
  assert.equal((today.match(/data-act="share"/g) || []).length, 1);
  assert.ok(today.indexOf('data-act="share"') > today.lastIndexOf('</details>'), 'the share button comes after the See more');
  assert.ok(!today.includes('class="all"') && !today.includes('#all'), "today's block has no link of its own to every headline");
  has(home, '<p class="all"><a href="./day/2026-11-16/#all">Every headline we read today (28)</a></p>');
  assert.equal((home.match(/More from today/g) || []).length, 1, 'said once on the page');
  auditSite(site.dist, { label: 'a crowded day' });
});

test('phase 12: eight near misses and nothing else read "See 3 more near misses" with rows 6 to 8, and one left reads "See 1 more near miss"', () => {
  for (const [near, summary, ranks] of [[8, 'See 3 more near misses', ['6', '7', '8']], [6, 'See 1 more near miss', ['6']]]) {
    const [today] = blocksOf(read('index.html', crowdedSite([{ date: '2026-11-16', near }]).dist));
    assert.deepEqual(ranksIn(today.slice(0, today.indexOf('<details'))), ['1', '2', '3', '4', '5'], `${near} near misses: five rows first`);
    const more = seeMoreIn(today);
    assert.equal(summaryOf(more), summary);
    assert.deepEqual(ranksIn(insideOf(more)), ranks, `${near} near misses: numbered on from 6`);
    assert.ok(!more.includes('<h3') && !more.includes('<li class="hd') && !more.includes('<details', 10), 'only rows are in it: no heading, no headlines, no fold');
    assert.ok(today.indexOf('data-act="share"') > today.lastIndexOf('</details>'), 'the share button is under it');
  }
});

test('phase 12: exactly five near misses, or fewer, have no See more at all', () => {
  for (const near of [3, 5]) {
    const [today] = blocksOf(read('index.html', crowdedSite([{ date: '2026-11-16', near }]).dist));
    assert.equal(rowsOf(today).length, near);
    assert.ok(!today.includes('<details') && !today.includes('See ') && !today.includes('More from today'), `${near} near misses and no other headline: nothing to open`);
  }
});

test('phase 12: five near misses and other headlines make a See more of headlines alone, and one headline reads "See 1 more headline"', () => {
  for (const [other, summary, fold] of [[12, 'See 12 more headlines', 'Show 2 more headlines'], [1, 'See 1 more headline', null]]) {
    const [today] = blocksOf(read('index.html', crowdedSite([{ date: '2026-11-16', near: 5, other }]).dist));
    assert.equal(rowsOf(today).length, 5, 'the five near misses, and no others');
    const more = seeMoreIn(today);
    assert.equal(summaryOf(more), summary);
    const inside = insideOf(more);
    assert.equal(rowsOf(inside).length, 0, 'no near miss is left to list');
    assert.ok(inside.trimStart().startsWith('<h3 class="sub">More from today</h3>'), 'the small heading, then the headlines');
    assert.equal(titlesIn(inside).length, other);
    assert.equal(inside.includes('<details'), Boolean(fold));
    if (fold) assert.equal(summaryOf(detailsAt(inside, inside.indexOf('<details'))), fold);
  }
});

test('phase 12: a day with no edition works the same way: five plain rows, then a See more of the day\'s other headlines', () => {
  const home = read('index.html');
  const [today] = blocksOf(home);
  const left = stored16.stories.length - cfg.edition.fallbackRows;
  assert.equal(rowsOf(today.slice(0, today.indexOf('<details'))).length, cfg.edition.fallbackRows, 'five plain rows first, as before');
  const more = seeMoreIn(today);
  assert.equal(summaryOf(more), `See ${left} more headlines`, 'only headlines are left');
  const inside = insideOf(more);
  assert.equal(rowsOf(inside).length, 0);
  assert.equal(titlesIn(inside).length, left);
  const rowTitles = factsIn(today).map((f) => f.label);
  assert.ok(rowTitles.every((t) => !titlesIn(inside).includes(t)), 'a story that is a plain row is not listed again');
  assert.ok(today.indexOf('data-act="share"') > today.lastIndexOf('</details>'), 'the share button is under it');
  has(home, `Every headline we read today (${stored16.stories.length})`);
});

test('phase 12: the share text names the emoji of the first five rows only, so it stays one short line', () => {
  const site = crowdedSite([{ date: '2026-11-16', near: 8, other: 20 }]);
  for (const page of ['index.html', 'day/2026-11-16/index.html']) {
    const lines = attr(read(page, site.dist), 'data-share-full').split('\n');
    assert.equal(lines.length, 4, page);
    assert.equal(lines[1], EMOJI8.slice(0, 5).join(' '), `${page}: five emoji when there are eight items`);
    assert.equal(attr(read(page, site.dist), 'data-share-text').split('\n')[1], lines[1], `${page}: and the share sheet gets the same line`);
  }
});

test('phase 12: a day page and the earlier days on the homepage show five near misses and a See more, and the day page keeps every headline in its own list', () => {
  const site = crowdedSite([
    { date: '2026-11-16', near: 8, other: 20 },
    { date: '2026-11-15', near: 8, other: 4 },
    { date: '2026-11-14', near: 8, other: 4 },
  ]);
  // the day page: the rows, five and a See more of the other three near misses, and then every headline in its own list
  const day = read('day/2026-11-16/index.html', site.dist);
  const rowsPart = day.slice(day.indexOf('<section class="day" id="rows">'), day.indexOf('<section id="all">'));
  assert.deepEqual(ranksIn(rowsPart.slice(0, rowsPart.indexOf('<details'))), ['1', '2', '3', '4', '5']);
  const dayMore = seeMoreIn(rowsPart);
  assert.equal(summaryOf(dayMore), 'See 3 more near misses', 'rows only: the day page lists the headlines below');
  assert.deepEqual(ranksIn(insideOf(dayMore)), ['6', '7', '8']);
  assert.ok(!dayMore.includes('<li class="hd') && !day.includes('More from today'), 'no headlines in it');
  assert.ok(rowsPart.indexOf('data-act="share"') > rowsPart.lastIndexOf('</details>'), 'the share button is under it');
  const all = day.slice(day.indexOf('<section id="all">'));
  assert.equal(titlesIn(all).length, 28, 'every headline of the day, the near misses too, in the list that was always there');
  assert.equal(summaryOf(seeMoreIn(all)), 'Show 18 more headlines', 'with its own fold');
  // the homepage: yesterday open, the day before folded, and the same five and See more in both
  const home = read('index.html', site.dist);
  const [, yesterday, older] = blocksOf(home);
  assert.ok(!yesterday.includes('<details class="dd">'), "yesterday's rows are open");
  assert.deepEqual(ranksIn(yesterday.slice(0, yesterday.indexOf('<details'))), ['1', '2', '3', '4', '5']);
  assert.equal(summaryOf(seeMoreIn(yesterday)), 'See 3 more near misses', 'an earlier day has no headlines in its See more');
  assert.ok(!yesterday.includes('<li class="hd') && !yesterday.includes('More from today'));
  const dd = detailsAt(older, older.indexOf('<details class="dd">'));
  assert.equal(summaryOf(dd), 'Show the 8 near misses', 'the fold keeps its button');
  const olderBody = insideOf(dd);
  assert.deepEqual(ranksIn(olderBody.slice(0, olderBody.indexOf('<details'))), ['1', '2', '3', '4', '5'], 'inside the fold: five rows');
  const olderMore = seeMoreIn(olderBody);
  assert.equal(summaryOf(olderMore), 'See 3 more near misses', 'and the See more');
  assert.deepEqual(ranksIn(insideOf(olderMore)), ['6', '7', '8']);
  // only the first row of a day is the closest call, wherever the row sits
  for (const block of blocksOf(home)) assert.deepEqual(rowsOf(block).map((r) => rowFacts(r).best), rowsOf(block).map((_, i) => i === 0), 'only #1 is red');
});

test('phase 12: the words and the list of a See more: near misses, plain top stories, and what is left to count', () => {
  assert.equal(copy.ROWS_SHOWN, 5);
  assert.equal(copy.MORE_TODAY, 'More from today');
  assert.deepEqual(
    [copy.seeMore(3, 0, true), copy.seeMore(1, 0, true), copy.seeMore(3, 0, false), copy.seeMore(1, 0, false), copy.seeMore(0, 84, true), copy.seeMore(0, 1, false), copy.seeMore(3, 84, true), copy.seeMore(1, 1, false)],
    ['See 3 more near misses', 'See 1 more near miss', 'See 3 more top stories', 'See 1 more top story', 'See 84 more headlines', 'See 1 more headline', 'See 87 more', 'See 2 more'],
  );
  const ctx = { byId: new Map(), quietMode: false, quietCaption: '', quietLink: '', quietLinkIntl: '', plain: true };
  const plainRows = (n) => Array.from({ length: n }, (_, i) => ({ emoji: '📰', label: '', line: `Headline ${i + 1}`, ids: [`p${i}`], quiet: false, title: `Headline ${i + 1}`, url: `https://pub.example/${i}`, source: 'Pub A', outlets: 1 }));
  // plain rows: no rank, "top stories", and the rows after the fifth are in the See more
  const eight = rowsMore(plainRows(8), ctx, { ranked: false });
  assert.equal(summaryOf(seeMoreIn(eight)), 'See 3 more top stories');
  assert.equal(rowsOf(eight.slice(0, eight.indexOf('<details'))).length, 5);
  assert.equal(rowsOf(insideOf(seeMoreIn(eight))).length, 3);
  assert.ok(!eight.includes('class="rn"') && rowsOf(eight).every((r) => rowFacts(r).plain && !rowFacts(r).best), 'no rank and no closest call');
  assert.ok(!rowsMore(plainRows(5), ctx, { ranked: false }).includes('<details'), 'five plain rows are all there is');
  // plain rows with other headlines: both are counted
  const both = rowsMore(plainRows(7), ctx, { ranked: false, others: [{ id: 'x', title: 'Other one', url: 'https://pub.example/x', source: 'Pub B', outlets: 1 }, { id: 'y', title: 'Other two', url: 'https://pub.example/y', source: 'Pub B', outlets: 1 }] });
  assert.equal(summaryOf(seeMoreIn(both)), 'See 4 more');
  // ranked rows number on from 6 and mark nothing red but the first
  const ranked = rowsMore(plainRows(7), { ...ctx, plain: false }, { ranked: true });
  assert.equal(summaryOf(seeMoreIn(ranked)), 'See 2 more near misses');
  assert.deepEqual(ranksIn(ranked), ['1', '2', '3', '4', '5', '6', '7']);
  assert.deepEqual(rowsOf(ranked).map((r) => rowFacts(r).best), [true, false, false, false, false, false, false]);
  assert.deepEqual(ranksIn(dayRows(plainRows(2), { ...ctx, plain: false }, 5)), ['6', '7'], 'rows(items, ctx, from) carries the rank on');
});

test('phase 12: a refresh swaps the whole page, so a See more that closes again is all that changes', () => {
  const code = fs.readFileSync(path.join(REPO, 'assets', 'app.js'), 'utf8');
  assert.ok(code.includes("old.replaceWith(doc.adoptNode(fresh))") && code.includes("next.querySelector('#main')"), 'the new #main replaces the old one');
  assert.ok(code.includes("doc.addEventListener('click', onClick)") && code.includes("closest('[data-act]')"), 'taps are heard by the document, so a swapped page needs no new listeners');
  for (const token of ['details', 'summary', '.more', '.rows', '.heads']) assert.ok(!code.includes(token), `the script never touches ${token}, so it cannot be broken by a See more`);
});

test('a new day with nothing filed yet shows "Nothing new yet today." and stays out of the Almanac and the feed', () => {
  const r = copyRoot(edRoot);
  edit(latestFile(r), (l) => {
    l.etDate = '2026-11-17';
    l.buildTime = '2026-11-17T05:30:00.000Z';
    l.stories = [];
    l.fired = [];
    l.bumps = [];
    l.score = 11;
    l.change = null;
  });
  const out = buildAt(r);
  auditSite(out.dist, { label: 'midnight' });
  const home = read('index.html', out.dist);
  const [today, yesterday] = blocksOf(home);
  assert.ok(!today.includes('class="sec"') && !today.includes('class="rows"'), 'no line over rows that are not there');
  has(today, '<p class="empty">Nothing new yet today.</p>');
  assert.ok(!today.includes('class="plus"'));
  has(yesterday, '<p class="dk">YESTERDAY</p>');
  has(yesterday, '<h2 class="dl"><a href="./day/2026-11-16/">MONDAY, NOV 16</a></h2>');
  assert.deepEqual(factsIn(yesterday).map((f) => f.line), ED16.items.map((i) => i.line), 'yesterday keeps its edition');
  assert.equal(todayHeadline(out.dist), copy.subline(11), 'the ladder line over the empty day');
  assert.deepEqual(almanacRowsOf(read('almanac/index.html', out.dist)).map((row) => row[0]), ['../day/2026-11-16/', '../day/2026-11-15/']);
  assert.equal([].concat(new XMLParser().parse(read('feed.xml', out.dist)).rss.channel.item).length, 2);
});

// ---- the feed ----------------------------------------------------------------------------------------------------------------------

test('the feed is valid RSS: one item per day, the headline for a title, the lines in the body, links absolute, no repository link', () => {
  for (const [label, base, titles] of [
    ['editions', edDist, [ED16.headline, ED15.headline]],
    ['plain headlines', dist, [copy.subline(latest.score), copy.subline(11)]],
  ]) {
    const xml = read('feed.xml', base);
    assert.equal(XMLValidator.validate(xml), true);
    const items = [].concat(new XMLParser().parse(xml).rss.channel.item);
    assert.deepEqual(items.map((i) => i.link), [`${SITE}/day/2026-11-16/`, `${SITE}/day/2026-11-15/`], label);
    assert.deepEqual(items.map((i) => i.title), titles, label);
    assert.ok(!/github\.com/i.test(xml));
    assert.ok(!xml.includes('<img src=x') && !xml.includes('<script>alert'), `${label}: hostile text stays inert in the feed`);
  }
  const first = [].concat(new XMLParser().parse(read('feed.xml', edDist)).rss.channel.item)[0];
  for (const item of ED16.items) assert.ok(first.description.includes(esc(item.line)), `the body has: ${item.line}`);
  assert.ok(first.description.includes(`<p>Mon, Nov 16 · Doom Score ${latest.score} of 99</p>`), 'the first line reads like the page');
  assert.ok(!first.description.includes('/99'), 'no fraction');
  assert.ok(first.description.includes(`<a href="${new URL(ED16.items[0].url).href}">Read it</a>`), 'each line links its story');
});

// ---- the first words and the check -------------------------------------------------------------------------------------------

test('the subline ladder breaks exactly where the spec says, and every line is two plain sentences or so and ends with "Still here."', () => {
  const quiet = 'A quiet day in the news. Suspiciously quiet. Still here.';
  const ladder = [
    [0, quiet], [19, quiet],
    [20, 'A few small things went wrong today. Still here.'], [39, 'A few small things went wrong today. Still here.'],
    [40, 'The usual number of things went wrong today. Still here.'], [59, 'The usual number of things went wrong today. Still here.'],
    [60, 'More went wrong today than usual. Still here.'], [79, 'More went wrong today than usual. Still here.'],
    [80, 'A lot went wrong today. Still here.'], [94, 'A lot went wrong today. Still here.'],
    [95, 'Nearly everything went wrong today. Still here.'], [99, 'Nearly everything went wrong today. Still here.'],
  ];
  for (const [score, line] of ladder) assert.equal(copy.subline(score), line, String(score));
  assert.equal(copy.subline('nope'), quiet);
  assert.deepEqual(copy.LADDER.map(([from]) => from), [0, 20, 40, 60, 80, 95], 'the same thresholds as before');
  for (const [, line] of copy.LADDER) {
    assert.ok(line.endsWith(' Still here.'), `"${line}" ends with Still here.`);
    assert.ok(!line.includes(EM) && !line.includes(EN) && !line.includes(' - '), `"${line}" has no dash`);
    assert.ok(!/[!;:]/.test(line), `"${line}" is plain`);
    assert.ok(line.length <= cfg.edition.headlineMax, `"${line}" fits the headline limit`);
    assert.ok(firstSentence(line).length < line.length, `"${line}" has a first sentence the card can show alone`);
  }
});

test('the home page says what section 9 says', () => {
  const home = read('index.html');
  has(home, '<title>Did the world end today? ALMOST.</title>');
  has(home, `<meta name="description" content="${esc(copy.DESCRIPTION)}">`);
  assert.equal(copy.DESCRIPTION, "Live coverage of the end of the world, which keeps not happening. Today's near misses, ranked from most world-ending to least. Checked every 15 minutes.");
  assert.equal(copy.QUIET_DESCRIPTION, "Today's top stories and a 0-99 Doom Score. Checked every 15 minutes.");
  for (const text of [copy.DESCRIPTION, copy.QUIET_DESCRIPTION]) assert.ok(text.length <= 160, `${text.length} characters, short enough for a search result`);
  assert.equal(copy.TAGLINE, 'Live coverage of the end of the world, which keeps not happening.');
  assert.equal(copy.COMMENT, "If the world has ended and this still says ALMOST., sorry. We'll update it when we're back.");
  assert.ok(home.startsWith(`<!doctype html>\n<!-- ${copy.COMMENT} -->\n`), 'the comment under the doctype');
  has(home, '<p class="tagline">Live coverage of the end of the world, which keeps not happening.</p>');
  assert.ok(!home.includes('Worst day so far'), 'two editions are too few for a record line');
});

test('tapping ALMOST. runs the six lines from the spec, with the real headline count', () => {
  const lines = JSON.parse(attr(read('index.html'), 'data-lines'));
  assert.ok(latest.headlinesRead > 0);
  assert.deepEqual(lines, [
    'Checking the sky...',
    'Pinging the internet... it pinged back.',
    'Counting continents... 7. Good.',
    'Asking the sun to take it easy...',
    `Skimming ${latest.headlinesRead.toLocaleString('en-US')} headlines...`,
    "Confirming you're still here...",
  ]);
  assert.equal(copy.checkLines(1234)[4], 'Skimming 1,234 headlines...');
  assert.match(read('index.html'), /<button class="vbox" type="button" data-act="check"><span class="verdict" id="verdict">ALMOST\.<\/span>/, 'ALMOST. is the button');
});

test('the stale line appears when the newest good read is more than two hours old, and not before, and it names the time in Eastern', () => {
  const stale = (minutes) => {
    const r = copyRoot(root);
    edit(latestFile(r), (l) => (l.lastSuccessAt = new Date(Date.parse(l.buildTime) - minutes * 60000).toISOString()));
    return read('index.html', buildAt(r).dist);
  };
  const said = (clock) => esc(`Last checked ${clock}. That's on us, not the world.`);
  const late = stale(210); // built 5:30 PM Eastern, last good read 2:00 PM
  assert.match(late, /<p class="stale" id="stale" data-template="[^"]*">/);
  assert.ok(late.includes(`">${said('2:00 PM ET')}</p>`), 'three and a half hours late says the clock time of the last good read');
  assert.ok(stale(121).includes(`">${said('3:29 PM ET')}</p>`), 'two hours and a bit says its clock time too');
  assert.match(stale(120), /<p class="stale" id="stale" data-template="[^"]*" hidden><\/p>/);
  assert.match(read('index.html'), /<p class="stale" id="stale" data-template="[^"]*" hidden><\/p>/);
  assert.match(late, /data-template="Last checked \{time\}\. That&#39;s on us, not the world\."/, 'the page script fills the same sentence in');
  assert.equal(copy.staleLine(Date.parse('2026-11-16T22:30:00Z')), "Last checked 5:30 PM ET. That's on us, not the world.");
  assert.ok(!/hours? ago|We haven/.test(late), 'no count of hours, no "we haven\'t"');
  assert.ok(!/Probably us|went quiet/.test(late), 'the old joke is gone');
  // a past day was finished long ago, so it never says we have not checked
  const r = copyRoot(root);
  edit(latestFile(r), (l) => (l.lastSuccessAt = new Date(Date.parse(l.buildTime) - 600 * 60000).toISOString()));
  assert.ok(!/Last checked \d/.test(read('day/2026-11-15/index.html', buildAt(r).dist)));
});

test('the 404 says its line and links home by the site address', () => {
  const html = read('404.html');
  assert.ok(html.includes(`<h1>${esc(copy.NOT_FOUND_LINE)}</h1>`));
  assert.equal(copy.NOT_FOUND_LINE, "This page ended. The world didn't.");
  assert.ok(html.includes(`<a href="${SITE}/">Back to today</a>`));
  assert.ok(!/<script/i.test(html));
  assert.ok(html.includes('name="robots" content="noindex"'));
});

test('the About page says what the site does in plain words, and Claude is named plainly, in the credit and in the status pages we watch', () => {
  const about = read('about/index.html');
  for (const needle of [
    'We leave out headlines about people being killed, hurt or attacked.',
    '<h2 id="doom-score">The Doom Score</h2>',
    'Where it comes from',
    'Quiet cards and quiet mode',
    'We read the news and watch the sky and the internet: asteroids, solar storms, earthquakes, and the big status pages.',
    'It comes on when a deadly disaster takes over the news, or when someone switches it on by hand.',
    'We show headlines and links only. Publishers who want a headline removed can DM <a href="https://x.com/thelpdrive" target="_blank" rel="noopener">@thelpdrive</a> on X.',
    'Built by <a href="https://x.com/thelpdrive" target="_blank" rel="noopener">@thelpdrive</a> with Claude, an AI. Claude writes each day\'s headline and the short line on each story, from that day\'s headlines. It can get things wrong, so every line links to its source.',
    'The Doom Score is a number from 0 to 99. It is just adding, with no secret formula.',
    'Each category that counts adds 6 points.',
    'The lowest score is 11, because there is always something going on.',
    'The highest is 99, because it is never 100.',
  ]) assert.ok(about.includes(needle), needle);
  assert.ok(/<a [^>]*>Claude<\/a>/.test(about), 'the status pages we watch are listed with Claude among them');
  for (const word of ['vital', 'Vital', 'bingo', 'Bingo', 'mass-casualty', 'nobody is doing on purpose']) assert.ok(!about.includes(word), word);
  assert.ok(!/a popular AI chatbot/i.test(about + read('index.html')), 'no stand-in name');
  for (const rel of ['almanac/index.html', '404.html', 'feed.xml', 'day/2026-11-15/index.html']) assert.ok(!/claude/i.test(read(rel)), `${rel} does not say Claude`);
});

test('the About page: every fact the Doom Score runs on is there in plain words, the numbers come from the code, and the time and the ranking are explained', () => {
  const about = read('about/index.html');
  const d = cfg.doom;
  // the numbers are the ones the code uses, so the page cannot drift from the rule
  const bullets = [...about.matchAll(/<li>((?:A space storm|An earthquake|An asteroid|A ground stop|Any big website)[^<]*)<\/li>/g)].map((m) => unesc(m[1]));
  assert.deepEqual(bullets, [
    `A space storm of Kp ${d.kp.at} or more: +${d.kp.points} (Kp ${d.kp.bigAt} or more: +${d.kp.bigPoints} instead)`,
    `An earthquake of magnitude ${d.quake.at} or more: +${d.quake.points} (magnitude ${d.quake.bigAt} or more: +${d.quake.bigPoints} instead)`,
    'An asteroid passing closer than the Moon, in the last day or the next two days: +8 (closer than halfway to the Moon: +15 instead)',
    `A ground stop at a major hub airport: +${d.faa.hubPoints} (a ground stop for the whole country: +${d.faa.nationwidePoints} instead)`,
    `Any big website in a major outage: +${d.status.points}`,
  ]);
  assert.equal(d.asteroid.points, 8);
  assert.equal(d.asteroid.closePoints, 15);
  assert.equal(d.asteroid.withinLd, 1);
  assert.equal(d.asteroid.closeLd, 0.5);
  assert.deepEqual([cfg.signals.asteroidWindow.pastHours, cfg.signals.asteroidWindow.nextHours], [24, 48], 'the window the About page names is the one the asteroid reader uses');
  // the sentence that says when a category counts
  assert.ok(about.includes(`A category counts when ${d.publishersToFire} or more different publishers have a headline about it in the last 24 hours.`));
  for (const fact of ['a ground stop from the FAA (planes must stay on the ground)', 'an asteroid that passes closer than the Moon', 'a space storm of Kp 5 or more', 'an X-class flare alert from the Sun', 'an earthquake of magnitude 6 or more', 'a big website that says it is in a major outage']) assert.ok(about.includes(fact), fact);
  // the section has its own anchor, and the time and the ranking are explained
  assert.equal((about.match(/id="doom-score"/g) || []).length, 1);
  assert.ok(about.indexOf('id="doom-score"') < about.indexOf('Days run midnight to midnight'), 'the time note is in the Doom Score section');
  assert.ok(about.includes('<p>Days run midnight to midnight, Eastern time. Every time on this site is Eastern.</p>'));
  assert.ok(about.includes('<h2>How we rank</h2>'));
  assert.ok(about.includes("<p>Each day&#39;s list goes from most world-ending to least: how many people it could reach, how much of the world, and how close it came.</p>"));
  assert.ok(about.indexOf('How we rank') < about.indexOf('Where it comes from'));
  assert.ok(about.includes('When people or homes are hurt, or likely hurt, it also links to a charity: the Red Cross for a place in the United States, or the international Red Cross and Red Crescent for a place in another country.'), 'the donate rule the cards follow');
  // plain words: none of the long ones the first version used
  for (const word of ['fires when', 'arithmetic', 'instrument trips', 'lunar distance', 'status page in major outage', 'inside 1']) assert.ok(!about.includes(word), `"${word}" is gone`);
  // and a week that is not the default: the bullets follow the config
  const odd = { ...cfg, doom: { ...cfg.doom, perCategory: 7, floor: 9, cap: 98 }, signals: { ...cfg.signals, asteroidWindow: { ...cfg.signals.asteroidWindow, pastHours: 12, nextHours: 72 } } };
  const r = copyRoot(root);
  const page = read('about/index.html', build(r, { siteUrl: SITE, config: { ...odd, firstEdition: '2026-11-14' } }).dist);
  assert.ok(page.includes('Each category that counts adds 7 points. The lowest score is 9') && page.includes('The highest is 98'));
  assert.ok(page.includes('in the last 12 hours or the next three days'), 'the window reads from the code');
});

// The stylesheet of a page, as its inlined text. A rule is `selector{declarations}`.
const sheetOf = (html) => html.match(/<style>([\s\S]*?)<\/style>/)[1];
const rulesOf = (sheet) => [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
const ruleFor = (sheet, selector) => {
  const hit = rulesOf(sheet).find((r) => r.selector === selector);
  assert.ok(hit, `the style sheet has ${selector}`);
  return hit.body;
};

test('design tokens: yellow, black and one red, white when quiet, League Gothic for the big type, Libre Franklin for the rest, and no other font', () => {
  assert.deepEqual([YELLOW, INK, RED, WHITE], ['#FFD100', '#000000', '#D81E05', '#FFFFFF']);
  const home = read('index.html');
  const sheet = sheetOf(home);
  has(sheet, ':root{--bg:#FFD100;--ink:#000000;--on:#FFD100;--disp:"League Gothic","League Gothic Fit",sans-serif;--text:"Libre Franklin","Helvetica Neue",Arial,sans-serif;color-scheme:light}');
  assert.ok(sheet.includes('color-scheme:light') && !/prefers-color-scheme/.test(sheet), 'light only');
  assert.ok(sheet.includes('html{background:var(--bg);color:var(--ink);'), 'black on yellow');
  has(home, '<meta name="theme-color" content="#FFD100">');
  has(home, '<meta name="color-scheme" content="light">');
  // the fonts: League Gothic for the display type, Libre Franklin 400, 600 and 700 for the rest
  has(sheet, '@font-face{font-family:"League Gothic";src:url(./assets/leaguegothic.woff2) format("woff2");font-weight:400;font-style:normal;font-display:swap}');
  for (const weight of [400, 600, 700]) has(sheet, `@font-face{font-family:"Libre Franklin";src:url(./assets/librefranklin-${weight}.woff2) format("woff2");font-weight:${weight};font-style:normal;font-display:swap}`);
  assert.equal((sheet.match(/font-display:swap/g) || []).length, 4, 'text shows at once, in a fallback, while a font loads');
  assert.equal((sheet.match(/@font-face/g) || []).length, 5, 'four font files, and the stand-in that holds the width of ALMOST. while League Gothic loads');
  has(sheet, '@font-face{font-family:"League Gothic Fit";src:local("Arial Bold")');
  assert.ok(sheet.includes('size-adjust:52%'), 'the stand-in is set to the width of League Gothic');
  assert.ok(read('day/2026-11-16/index.html').includes('url(../../assets/leaguegothic.woff2)'), 'the fonts are relative to the page, two folders down too');
  for (const gone of ['Newsreader', 'Anton', 'anton.woff2', 'system-ui', 'ui-monospace', '-apple-system', 'BlinkMacSystemFont']) assert.ok(!sheet.includes(gone), `${gone} is not in the style sheet`);
  assert.ok(!/(?<!sans-)serif/.test(sheet), 'no serif face');
  assert.ok(!/fonts\.(?:googleapis|gstatic)/.test(home), 'no font comes from another site');
  // the files the first screen needs are preloaded
  assert.deepEqual(
    [...home.matchAll(/<link rel="preload" href="([^"]*)" as="font" type="font\/woff2" crossorigin>/g)].map((m) => m[1]),
    ['./assets/leaguegothic.woff2', './assets/librefranklin-600.woff2', './assets/librefranklin-700.woff2', './assets/librefranklin-400.woff2'],
  );
  assert.deepEqual(
    [...read('day/2026-11-16/index.html').matchAll(/<link rel="preload" href="([^"]*)"/g)].map((m) => m[1]),
    ['../../assets/leaguegothic.woff2', '../../assets/librefranklin-600.woff2', '../../assets/librefranklin-700.woff2', '../../assets/librefranklin-400.woff2'],
  );
  // the things that went with the earlier looks are gone
  for (const old of ['.n40{', '.go{', '.sh{', '.mast', '.hl{', '.pulse', '@keyframes pulse', 'border-radius:999px', 'border-radius:14px', 'border-radius:12px', '.cta', '.sn{', '.sc{', '--hot', '--mute', '--line', '--paper', '.meter', '.doom', '.when', '.tag{', '.txt{', '.plus']) assert.ok(!sheet.includes(old), `${old} is gone`);
  // no corner is rounded, anywhere
  assert.deepEqual([...new Set([...sheet.matchAll(/border-radius:([^;}]+)/g)].map((m) => m[1]))], ['0'], 'every corner is square');
  // a font on every page: the 404 reads the two it needs from the site's own address
  const css404Text = css404(SITE);
  assert.ok(css404Text.includes(`url(${SITE}/assets/leaguegothic.woff2)`) && css404Text.includes(`url(${SITE}/assets/librefranklin-700.woff2)`));
  assert.ok(css404Text.includes('background:#FFD100') && css404Text.includes('color:#000000'), 'the 404 is yellow and black too');
  assert.ok(!/Newsreader/.test(css404Text), 'and has none of the old font');
});

test('the type and the spacing are the ones the design names', () => {
  const sheet = sheetOf(read('index.html'));
  // the first screen
  has(ruleFor(sheet, '.band'), 'height:56px');
  has(ruleFor(sheet, '.band'), 'background:var(--ink)');
  has(ruleFor(sheet, '.band .q'), 'font:400 26px/1 var(--disp)');
  has(ruleFor(sheet, '.band .q'), 'text-transform:uppercase');
  has(ruleFor(sheet, '.hero'), 'max-width:600px');
  has(ruleFor(sheet, '.hero'), 'padding:20px 20px 28px');
  has(ruleFor(sheet, '.verdict'), 'font:400 min(31vw,120px)/.8 var(--disp)');
  has(ruleFor(sheet, '.verdict'), 'overflow-wrap:anywhere');
  has(ruleFor(sheet, '.deck'), 'font:700 22px/1.25 var(--text)');
  has(ruleFor(sheet, '.deck'), 'min-height:2.5em');
  has(ruleFor(sheet, '.deck'), 'max-width:330px');
  has(ruleFor(sheet, '.deck'), 'text-wrap:balance');
  has(ruleFor(sheet, '.board'), 'min-height:120px');
  has(ruleFor(sheet, '.board'), 'background:var(--ink)');
  has(ruleFor(sheet, '.board'), 'color:var(--on)');
  has(ruleFor(sheet, '.bn'), 'font:400 72px/.8 var(--disp)');
  has(ruleFor(sheet, '.bl'), 'font:700 12px/1.2 var(--text)');
  has(ruleFor(sheet, '.bt'), 'font:400 13px/1.3 var(--text)');
  has(ruleFor(sheet, '.sq span'), 'width:14px');
  // the rows: a 2px rule, 16px of room, the rank in a 32px column, the emoji in a 48px one
  has(ruleFor(sheet, '.sec'), 'font:400 24px/1.1 var(--disp)');
  has(ruleFor(sheet, '.row'), 'border-top:2px solid var(--ink)');
  has(ruleFor(sheet, '.row'), 'padding:16px 0');
  has(ruleFor(sheet, '.row'), 'min-height:48px');
  has(ruleFor(sheet, '.rn'), 'flex:0 0 32px');
  has(ruleFor(sheet, '.rn'), 'font:400 36px/1 var(--disp)');
  has(ruleFor(sheet, '.em'), 'flex:0 0 48px');
  has(ruleFor(sheet, '.em'), 'font:400 40px/1 var(--text)');
  has(ruleFor(sheet, '.lb'), 'font:700 18px/1.25 var(--text)');
  has(ruleFor(sheet, '.row.plain .lb'), 'font-size:16px');
  has(ruleFor(sheet, '.ln'), 'font:400 15px/1.4 var(--text)');
  has(ruleFor(sheet, '.src'), 'font:400 14px/1.4 var(--text)');
  has(ruleFor(sheet, '.src'), 'text-decoration:underline');
  has(ruleFor(sheet, '.wrap'), 'max-width:600px');
  has(ruleFor(sheet, '.wrap'), 'padding:0 20px');
  // earlier days: a 48px gap and a 3px rule, the kicker, the date in League Gothic 30px, the headline, the score with ten 10px squares
  has(ruleFor(sheet, '.day+.day'), 'margin-top:48px');
  has(ruleFor(sheet, '.day+.day'), 'border-top:3px solid var(--ink)');
  has(ruleFor(sheet, '.dl'), 'font:400 30px/1.05 var(--disp)');
  // the date of an earlier day links to its page: a 48px tap target
  has(ruleFor(sheet, '.dl a'), 'min-height:48px');
  has(ruleFor(sheet, '.dh'), 'font:600 18px/1.3 var(--text)');
  has(ruleFor(sheet, '.ds .sq span'), 'width:10px');
  has(ruleFor(sheet, '.ds .sq span'), 'height:10px');
  has(ruleFor(sheet, '.dd summary,.more summary'), 'min-height:48px');
  // one black share button, the width of the page, 52px tall, and square
  has(ruleFor(sheet, '.btn'), 'width:100%');
  has(ruleFor(sheet, '.btn'), 'height:52px');
  has(ruleFor(sheet, '.btn'), 'background:var(--ink)');
  has(ruleFor(sheet, '.btn'), 'border-radius:0');
  has(ruleFor(sheet, '.btn'), 'font:700 18px/1 var(--text)');
  // the footer: Updated, every headline, the pages, who made it
  has(ruleFor(sheet, 'footer'), 'border-top:3px solid var(--ink)');
  has(ruleFor(sheet, 'footer .all a'), 'min-height:48px');
  has(ruleFor(sheet, 'footer .fl a'), 'min-height:48px');
  // no text is smaller than 12px, and nothing but the display type, the emoji and the joke under ALMOST. is above 20px
  const sizes = rulesOf(sheet).flatMap((r) => [...r.body.matchAll(/font:(\d+) (\d+)px\/[\d.]+ var\(--(text|disp)\)/g)].map((m) => ({ selector: r.selector, weight: Number(m[1]), px: Number(m[2]), face: m[3] })));
  assert.ok(sizes.length >= 20);
  assert.ok(Math.min(...sizes.map((x) => x.px)) >= 12, 'nothing is smaller than 12px');
  assert.ok(sizes.filter((x) => x.face === 'text' && x.selector !== '.em' && x.selector !== '.deck').every((x) => x.px <= 20), 'Libre Franklin is never above 20px, except in the emoji column, which holds a picture, and the joke under ALMOST.');
  assert.deepEqual(sizes.filter((x) => x.selector === '.deck').map((x) => [x.weight, x.px]), [[700, 22]], 'the joke is the punchline: bold, 22px');
  assert.ok(sizes.filter((x) => x.face === 'text').every((x) => [400, 600, 700].includes(x.weight)), 'and only in the three weights that ship');
  assert.ok(sizes.filter((x) => x.face === 'disp').every((x) => x.weight === 400), 'League Gothic only in its one weight');
  // flat: no gradients or text shadows, and the one box shadow is the ring on a hovered button
  assert.ok(!/text-shadow|linear-gradient|radial-gradient|backdrop-filter|filter:/.test(sheet), 'flat: no shadows on text and no gradients');
  assert.deepEqual([...sheet.matchAll(/box-shadow:([^;}]+)/g)].map((m) => m[1]), ['inset 0 0 0 3px var(--ink)'], 'the hover ring of the share button is the only shadow');
  assert.ok(!/(?:^|[;{])\s*opacity:(?!1\b)(?!0\b)/.test(sheet.replace(/\.toast[^}]*\}/g, '')), 'nothing is faded to grey with opacity');
  // the first screen fits a 320px phone: the side padding is 20px, so 280px of room, and the board and ALMOST. are told to give way
  assert.ok(sheet.includes('@media (max-width:339px){') || /@media\s*\(max-width:339px\)/.test(sheet), 'the smallest phones get a smaller number on the board');
  has(ruleFor(sheet, '.board'), 'grid-template-columns:auto minmax(0,1fr)');
  has(ruleFor(sheet, '.rb'), 'min-width:0');
  assert.ok(/html\{[^}]*overflow-x:hidden/.test(sheet) && /body\{[^}]*overflow-x:hidden/.test(sheet), 'a page never scrolls sideways, whatever a font does');
});

test('the red is used in two places only: the Doom Score number on the board and the number 1 of the closest call, and a quiet page has none', () => {
  const sheet = sheetOf(read('index.html', edDist));
  assert.equal(sheet.split('#D81E05').length - 1, 2, 'the red is written twice');
  const using = rulesOf(sheet).filter((r) => /#D81E05/i.test(r.body)).map((r) => r.selector).sort();
  assert.deepEqual(using, ['.bn', '.row.best:not(.quiet) .rn'], 'only these two rules take the red');
  // and the closest call is red only when it is a closest call: a quiet row, or a quiet page, is not
  assert.ok(sheet.includes('.row.best:not(.quiet) .rn{color:#D81E05}') && !sheet.includes('.row.best .rn{color:#D81E05}'));
  has(ruleFor(sheet, '.bn'), 'color:#D81E05');
  // no grey, no orange, no cream anywhere in the sheet: every hex is one of the four
  const hexes = new Set((sheet.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((h) => h.toUpperCase()));
  assert.deepEqual([...hexes].sort(), ['#000000', '#D81E05', '#FFD100', '#FFFFFF'].sort(), 'yellow, black, red and the white of quiet mode');
  assert.ok(!/rgba?\(|hsla?\(|gr[ae]y|opacity:\.|color-mix/.test(sheet), 'no color is written any other way');
  // a quiet build never prints the red or the yellow: the two rules go white and black, and the page is white
  const r = copyRoot(edRoot);
  edit(latestFile(r), (l) => (l.quiet = { ...l.quiet, quiet: true, note: '' }));
  const quiet = sheetOf(read('index.html', buildAt(r).dist));
  assert.ok(!/#D81E05/i.test(quiet) && !/#FFD100/i.test(quiet), 'a quiet build never prints the red or the yellow');
  has(quiet, ':root{--bg:#FFFFFF;--ink:#000000;--on:#FFFFFF;');
  has(ruleFor(quiet, '.bn'), 'color:#FFFFFF');
  assert.ok(quiet.includes('.row.best:not(.quiet) .rn{color:#000000}'), 'and rank 1 is black');
  // a page that turns quiet while it is open gets the same from the html attribute
  assert.ok(sheet.includes('html[data-quiet="1"] .bn{color:#FFFFFF}') && sheet.includes('html[data-quiet="1"] .row.best:not(.quiet) .rn{color:#000000}') && sheet.includes('html[data-quiet="1"]{--bg:#FFFFFF;--on:#FFFFFF}'));
  // no page prints the red anywhere but its style sheet
  const bare = read('index.html', edDist).replace(/<style>[\s\S]*?<\/style>/, '');
  assert.ok(!/#D81E05/i.test(bare), 'the red is not in the markup');
  // a day with no edition is not ranked: no rank numbers, no closest call, so the only red on its page is the score
  const plain = read('index.html');
  assert.ok(!plain.includes('class="rn"') && !plain.includes('class="row best') && !plain.includes('CLOSEST CALL'), 'a plain day has nothing numbered and nothing red');
  const plainDay = read('day/2026-11-16/index.html');
  assert.ok(!plainDay.includes('class="rn"') && !plainDay.includes('class="row best'), 'and neither does its day page');
  // a ranked day marks one row, the first. The page holds two ranked days: today's six rows are five and then the sixth
  // in its See more, which marks none, and yesterday's three are one list.
  const lists = read('index.html', edDist).match(/<ol class="rows" role="list">[\s\S]*?<\/ol>/g) || [];
  assert.equal(lists.length, 3, "today's five, today's sixth in its See more, and yesterday's three");
  assert.deepEqual(lists.map((list) => (list.match(/class="row best/g) || []).length), [1, 0, 1], 'one closest call a day, and none in a list that carries on');
  for (const list of [lists[0], lists[2]]) assert.ok(list.startsWith('<ol class="rows" role="list">\n<li class="row best'), 'it is the first row');
});

// Every file we wrote that draws or styles something, read as text.
function authored(dirRel, pattern) {
  const out = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (pattern.test(name)) out.push(full);
    }
  })(path.join(REPO, dirRel));
  return out;
}

test('no color of an old look is left in scripts/ or assets/: only the four of this one', () => {
  const OLD = ['#0B0B0F', '#F2EFE8', '#FF6A00', '#FF8230', '#6A6A74', '#7A7A84', '#9A9AA3', '#A3A3AC', '#8C8C94', '#5A2E10', '#34343E', '#2A2A33', '#24242C', '#15151B', '#F4EFE4', '#171512', '#C8102E', '#6B655B', '#D8D1C2'];
  const FOUR = new Set([YELLOW, INK, RED, WHITE].map((c) => c.toLowerCase()));
  const long = (hex) => (hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex).toLowerCase();
  const files = [...authored('scripts', /\.(?:mjs|js|json|css|svg|html)$/), ...authored('assets', /\.(?:js|css|svg|json|html)$/)];
  assert.ok(files.length >= 20, `${files.length} files looked at`);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const where = path.relative(REPO, file);
    for (const hex of text.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) || []) {
      assert.ok(!OLD.some((old) => old.toLowerCase() === hex.toLowerCase()), `${where} still has ${hex} from an old look`);
      assert.ok(FOUR.has(long(hex)), `${where} uses ${hex}, which is not one of the four`);
    }
    assert.ok(!/\bAnton\b|\bNewsreader\b/.test(text), `${where} still names a font of an old look`);
  }
  // the font files of the old looks are gone, and the two families come with their licenses
  const fonts = fs.readdirSync(path.join(REPO, 'assets', 'fonts')).sort();
  assert.deepEqual(fonts, ['LeagueGothic-Regular.ttf', 'LibreFranklin-Bold.ttf', 'LibreFranklin-SemiBold.ttf', 'OFL-LeagueGothic.txt', 'OFL-LibreFranklin.txt', 'leaguegothic.woff2', 'librefranklin-400.woff2', 'librefranklin-600.woff2', 'librefranklin-700.woff2']);
  for (const license of ['OFL-LeagueGothic.txt', 'OFL-LibreFranklin.txt']) assert.ok(/SIL OPEN FONT LICENSE/i.test(fs.readFileSync(path.join(REPO, 'assets', 'fonts', license), 'utf8')), `${license} is the license text`);
  // League Gothic is the Google Fonts release, whose license declares no Reserved Font Name, so a subset is not a Modified Version
  const gothicLicense = fs.readFileSync(path.join(REPO, 'assets', 'fonts', 'OFL-LeagueGothic.txt'), 'utf8');
  assert.ok(gothicLicense.startsWith('Copyright 2010 The League Gothic Project Authors'), 'the copyright line of the Google Fonts release');
  assert.ok(!/with Reserved Font Names?/i.test(gothicLicense.split('\n').slice(0, 3).join(' ')), 'and it reserves no name');
});

test('robots, sitemap, manifest and the icons', () => {
  assert.equal(read('robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
  const locs = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, [`${SITE}/`, `${SITE}/almanac/`, `${SITE}/about/`, `${SITE}/day/2026-11-16/`, `${SITE}/day/2026-11-15/`]);
  const manifest = readJson(path.join(dist, 'site.webmanifest'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.background_color, '#FFD100');
  assert.equal(manifest.theme_color, '#FFD100');
  // the icons: a black League Gothic A on a yellow square, drawn from the font's own outlines so no font is needed
  const icon = read('favicon.svg');
  assert.ok(icon.includes(`fill="${YELLOW}"`) && icon.includes(`fill="${INK}"`) && !icon.includes(RED) && !icon.includes(WHITE), 'a black A on yellow, and nothing else');
  assert.ok(!icon.includes('<text') && !icon.includes('font-family') && !icon.includes('rx='), 'outlines, not text, with square corners');
  assert.equal(icon, faviconSvg());
  assert.deepEqual(pngSize(path.join(dist, 'apple-touch-icon.png')), [180, 180]);
  assert.ok(fs.readFileSync(path.join(dist, 'apple-touch-icon.png')).equals(renderPng(faviconSvg(), { fontFiles: FONT_FILES, width: 180 })), 'the apple icon is the same drawing');
  // and the picture shows it: black letter, yellow square, nothing in between but the edges of the letter
  const { Resvg } = resvg;
  const px = new Resvg(icon, { fitTo: { mode: 'width', value: 64 } }).render().pixels;
  const at = (x, y) => [px[(y * 64 + x) * 4], px[(y * 64 + x) * 4 + 1], px[(y * 64 + x) * 4 + 2]];
  assert.deepEqual(at(1, 1), [0xff, 0xd1, 0x00], 'the corner is yellow');
  let dark = 0;
  let bright = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] < 40 && px[i + 1] < 40) dark += 1;
    if (px[i] > 240 && px[i + 1] > 200 && px[i + 2] < 20) bright += 1;
  }
  assert.ok(dark > 300 && dark < 1400, `${dark} black pixels make the A`);
  assert.ok(bright > 2400, `${bright} yellow pixels around it`);
  assert.ok(at(32, 32)[0] < 40 || at(32, 38)[0] < 40 || at(32, 44)[0] < 40, 'the letter is in the middle');
});

test('the web fonts keep what a name can need: Latin Extended-A, the comma-below letters and the degree sign, and the licenses ship beside them', () => {
  // A woff2 is a Brotli stream behind a table directory. The cmap table is not transformed, so it can be read straight out of it.
  const TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB'];
  const charsOf = (file) => {
    const b = fs.readFileSync(file);
    assert.equal(b.toString('latin1', 0, 4), 'wOF2', `${file} is a woff2`);
    let at = 48;
    const base128 = () => {
      let n = 0;
      for (let i = 0; i < 5; i += 1) {
        const byte = b[at];
        at += 1;
        n = n * 128 + (byte & 0x7f);
        if (!(byte & 0x80)) return n;
      }
      throw new Error('bad UIntBase128');
    };
    const tables = [];
    for (let i = 0; i < b.readUInt16BE(12); i += 1) {
      const flags = b[at];
      at += 1;
      const index = flags & 0x3f;
      const tag = index === 63 ? b.toString('latin1', at, (at += 4)) : TAGS[index];
      const version = flags >> 6;
      const length = base128();
      const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
      tables.push({ tag, size: transformed ? base128() : length });
    }
    const raw = zlib.brotliDecompressSync(b.subarray(at, at + b.readUInt32BE(20)));
    let offset = 0;
    for (const t of tables) {
      if (t.tag === 'cmap') {
        const sfnt = Buffer.alloc(28 + t.size);
        sfnt.writeUInt16BE(1, 4);
        sfnt.write('cmap', 12, 'latin1');
        sfnt.writeUInt32BE(28, 20);
        raw.copy(sfnt, 28, offset, offset + t.size);
        return readCmap(sfnt);
      }
      offset += t.size;
    }
    throw new Error(`${file} has no cmap`);
  };
  const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const WANT = [0x41, 0x7a, 0x30, 0x2e, 0x27, 0x2019, 0xb0, 0xc9, 0xf1, ...range(0x100, 0x17f), ...range(0x218, 0x21b)];
  const fonts = fs.readdirSync(path.join(REPO, 'assets', 'fonts'));
  const full = (name) => readCmap(fs.readFileSync(path.join(REPO, 'assets', 'fonts', name)));
  // the full fonts are the references: League Gothic is itself missing 22 of the Latin Extended-A letters (a few with a circumflex or breve, and the like), so what must be kept is whatever the full font can draw
  const reference = { 'leaguegothic.woff2': full('LeagueGothic-Regular.ttf'), 'librefranklin-400.woff2': full('LibreFranklin-SemiBold.ttf'), 'librefranklin-600.woff2': full('LibreFranklin-SemiBold.ttf'), 'librefranklin-700.woff2': full('LibreFranklin-Bold.ttf') };
  assert.deepEqual(Object.keys(reference).sort(), WEB_FONTS.filter((f) => f.endsWith('.woff2')).sort(), 'every web font is checked');
  assert.ok(fonts.includes('LeagueGothic-Regular.ttf'));
  for (const [name, source] of Object.entries(reference)) {
    const chars = charsOf(path.join(dist, 'assets', name));
    const kept = WANT.filter((cp) => source.has(cp));
    assert.ok(kept.length >= 105, `${name}: the full font draws ${kept.length} of the ones named`);
    for (const cp of kept) assert.ok(chars.has(cp), `${name} has U+${cp.toString(16).toUpperCase().padStart(4, '0')}, which the full font draws`);
    for (const cp of [0x41, 0x7a, 0x30, 0x2e, 0x27, 0x2019, 0xb0, 0xc9, 0xf1, 0x106, 0x10d, 0x11f, 0x141, 0x17a, 0x218, 0x219, 0x21a, 0x21b]) assert.ok(chars.has(cp), `${name} has U+${cp.toString(16).toUpperCase().padStart(4, '0')}: Dončić, Erdoğan, Łódź, Brașov and the degree sign`);
    assert.ok(!chars.has(0x2190) && !chars.has(0x2192), `${name} has no arrows, so none is used`);
  }
  // the card's own copies are complete fonts: Dončić, Erdoğan, Łódź and a degree sign all draw
  for (const file of FONT_FILES) {
    const chars = readCmap(fs.readFileSync(file));
    for (const ch of 'ćčğŁóź°') assert.ok(chars.has(ch.codePointAt(0)), `${path.basename(file)} has ${ch}`);
  }
  // each license is copied beside the fonts in dist
  for (const license of ['OFL-LeagueGothic.txt', 'OFL-LibreFranklin.txt']) assert.equal(read(`assets/${license}`), fs.readFileSync(path.join(REPO, 'assets', 'fonts', license), 'utf8'), `${license} ships beside the fonts`);
});

// ---- one date --------------------------------------------------------------------------------------------------------------------------

test('one date everywhere: the edition\'s Eastern date, whatever the machine clock or time zone says', () => {
  const was = process.env.TZ;
  try {
    for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Tokyo', 'America/Los_Angeles']) {
      process.env.TZ = tz;
      assert.equal(copy.rowDate('2026-11-16'), 'Mon, Nov 16', tz);
      assert.equal(copy.shortDate('2026-11-16'), 'Nov 16', tz);
      assert.equal(copy.longDate('2026-11-16'), 'November 16, 2026', tz);
      assert.equal(copy.weekdayDate('2026-11-16'), 'Monday, Nov 16', tz);
      assert.equal(copy.dayLabel('2026-11-15', '2026-11-16').head, 'YESTERDAY', tz);
      assert.equal(copy.dayLabel('2026-11-14', '2026-11-16').rest, 'NOV 14', tz);
    }
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
  // 10:40 pm Eastern on the 16th is already the 17th in UTC; the page still says the 16th.
  const r = copyRoot(edRoot);
  edit(latestFile(r), (l) => {
    l.buildTime = '2026-11-17T03:40:00.000Z';
    l.etDate = '2026-11-16';
  });
  const built = buildAt(r).dist;
  const home = read('index.html', built);
  const yesterday = copy.dayLabel('2026-11-15', '2026-11-16');
  has(home, `<p class="dk">${yesterday.head}</p>\n<h2 class="dl"><a href="./day/2026-11-15/">${yesterday.rest}</a></h2>`);
  has(home, '<h1 class="q">Did the world end today?</h1>');
  assert.equal(attr(home, 'data-share-full').split('\n')[0], 'Did the world end today? ALMOST.', 'the 16th is still today at 10:40 pm Eastern');
  assert.equal(attr(read('day/2026-11-15/index.html', built), 'data-share-full').split('\n')[0], 'Did the world end on Nov 15? ALMOST.');
  has(read('day/2026-11-16/index.html', built), '<h1 class="q">Did the world end today?</h1>');
  assert.ok(!/Nov 17|NOV 17/.test(home), 'no UTC date on the page');
  assert.ok(!fs.existsSync(path.join(built, 'day', '2026-11-17')), 'and no page for it');
  // Nothing on the page or in the script reads the visitor's own calendar date.
  assert.ok(!home.includes('data-local'));
  const code = fs.readFileSync(path.join(REPO, 'assets', 'app.js'), 'utf8');
  for (const token of ['localDate', 'toLocaleDateString', 'getDate(', 'getFullYear', 'getMonth', 'data-local']) assert.ok(!code.includes(token), token);
  assert.ok(code.includes("'America/New_York'"), 'the only calendar the script uses is Eastern');
});

// ---- the page script ---------------------------------------------------------------------------------------------------------------

// The page script loaded outside a browser. `globals` stands in for what a browser would give it.
function pageScript(globals = {}) {
  const sandbox = { module: { exports: {} }, ...globals };
  vm.runInNewContext(fs.readFileSync(path.join(REPO, 'assets', 'app.js'), 'utf8'), sandbox);
  return sandbox.module.exports;
}

test('the page and its script agree: every hook the script reads is on the page, and every share button sits in a block with its share text', () => {
  const code = fs.readFileSync(path.join(REPO, 'assets', 'app.js'), 'utf8');
  for (const [label, base] of [['editions', edDist], ['plain headlines', dist]]) {
    const home = read('index.html', base);
    for (const hook of ['id="hero"', 'id="verdict"', 'id="check"', 'id="said"', 'id="stale"', 'id="main"', '<footer>', 'data-lines="', 'data-act="check"', 'data-act="share"']) assert.ok(home.includes(hook), `${label}: ${hook}`);
    for (const name of ['root', 'live', 'build', 'success', 'quiet', 'date', 'page']) assert.ok(new RegExp(`<html [^>]*data-${name}="`).test(home), `${label}: data-${name}`);
    for (const once of ['id="main"', '<footer>', 'id="hero"', 'id="verdict"']) assert.equal(home.split(once).length - 1, 1, `${label}: ${once} once, so the page can be swapped in place`);
    assert.match(home, /<main id="main" data-share-text="[^"]*" data-share-full="[^"]*" data-share-url="[^"]*" data-build="/, `${label}: Share today reads the main block`);
    const [today, earlier, ...rest] = blocksOf(home);
    assert.equal(rest.length, 0);
    assert.equal((home.match(/data-share-full="/g) || []).length, 1, `${label}: one share text on the page, on the main block`);
    assert.ok(!today.includes('data-share-full') && !earlier.includes('data-share-full'), `${label}: a day block does not carry a second one`);
    assert.equal((today.match(/data-act="share"/g) || []).length, 1, `${label}: today's block ends with the one button`);
    assert.ok(!earlier.includes('data-act="share"'), `${label}: an earlier day has no button; its own page has one`);
    assert.equal((home.match(/data-act="share"/g) || []).length, 1, `${label}: one share button on the page`);
    assert.equal((home.match(/data-act="check"/g) || []).length, 1, `${label}: ALMOST. is the one check button`);
  }
  for (const token of ["'[data-share-full]'", "'data-share-text'", "'data-share-full'", "'data-share-url'", "'#main'", "'#hero'", "'#verdict'", "'#check'", "'#said'", "'#stale'", "'data-lines'", "'data-template'"]) assert.ok(code.includes(token), `app.js reads ${token}`);
  assert.ok(!code.includes('data-since'), 'the page no longer carries a ticking "checked" time, so the script does not look for one');
  const day = read('day/2026-11-16/index.html', edDist);
  for (const hook of ['id="hero"', 'id="main"', 'data-live="1"', 'data-page="day"']) assert.ok(day.includes(hook), `a day page: ${hook}`);
  assert.ok(day.includes('<script src="../../assets/app.js" defer></script>'), 'a day page loads the script from two folders up');
  assert.ok(read('index.html', edDist).includes('<script src="./assets/app.js" defer></script>'));
  for (const rel of ['about/index.html', 'almanac/index.html']) assert.ok(!/<script/i.test(read(rel, edDist)), `${rel} needs no script`);
});

// ---- the joke under ALMOST. -------------------------------------------------------------------------------------------------------

// The scripts a page runs from inside itself, and the policy its meta tag states.
const inlineScripts = (html) => [...html.matchAll(/<script\b(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
const policyOf = (html) => unesc((html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/) || [])[1] || '');

test('the homepage and every day page carry the joke for their date with the one script right after it, and the policy allows exactly that script', () => {
  for (const [label, base] of [['editions', edDist], ['plain headlines', dist]]) {
    for (const [rel, date] of [['index.html', '2026-11-16'], ['day/2026-11-16/index.html', '2026-11-16'], ['day/2026-11-15/index.html', '2026-11-15']]) {
      const html = read(rel, base);
      const where = `${label}: ${rel}`;
      // the deck is the joke, and the script follows its closing tag with nothing between
      const m = html.match(/<p class="deck" id="quip">([^<]*)<\/p><script>([\s\S]*?)<\/script>/);
      assert.ok(m, `${where}: the deck is #quip and the script comes right after it`);
      assert.equal(unesc(m[1]), quipFor(date), `${where}: the joke picked from the date`);
      assert.equal(deckOf(html), quipFor(date), `${where}: it is what the hero says under ALMOST.`);
      const hero = heroOf(html);
      assert.ok(hero.indexOf('id="verdict"') < hero.indexOf('id="quip"') && hero.indexOf('id="quip"') < hero.indexOf('role="meter"'), `${where}: under ALMOST. and over the board`);
      // the script is the one in the module, byte for byte, and the policy holds the hash of the text taken from the page
      const text = m[2];
      assert.equal(text, QUIP_SCRIPT, `${where}: the script is the quip script`);
      const hash = createHash('sha256').update(text, 'utf8').digest('base64');
      assert.ok(policyOf(html).includes(`script-src 'self' 'sha256-${hash}'; connect-src`), `${where}: the policy allows sha256-${hash}`);
      assert.ok(policyOf(html).includes(QUIP_CSP), `${where}: and it is QUIP_CSP`);
      assert.equal(policyOf(html), CSP, `${where}: the policy is the one policy`);
      // one inline script, which cannot close its tag early or open a comment, and is small
      assert.equal(inlineScripts(html).length, 1, `${where}: one inline script`);
      assert.ok(!text.includes('</') && !text.includes('<!--'), `${where}: nothing in it can end the tag early`);
      assert.ok(Buffer.byteLength(text) < 8000, `${where}: ${Buffer.byteLength(text)} bytes`);
      // the page's other script is the local file, deferred, so it starts only after the joke and its script are in the page
      const external = [...html.matchAll(/<script\b([^>]*\ssrc="([^"]*)"[^>]*)><\/script>/g)];
      assert.equal(external.length, 1, `${where}: one script file`);
      assert.ok(external[0][2].endsWith('assets/app.js'), `${where}: ${external[0][2]}`);
      assert.ok(/\sdefer(\s|$)/.test(external[0][1]), `${where}: the page script is deferred`);
      // the page carries the other 99 jokes only inside that script, and shows one of them in its text
      assert.equal(QUIPS.filter((q) => html.includes(esc(q)) && !text.includes(q)).length, 0);
      assert.equal(QUIPS.filter((q) => html.replace(text, '').includes(esc(q))).length, 1, `${where}: outside the script the page says one joke`);
    }
  }
  // the pages with no hero have no joke and no inline script, and the same policy
  for (const rel of ['about/index.html', 'almanac/index.html', '404.html']) {
    const html = read(rel, edDist);
    assert.deepEqual(inlineScripts(html), [], `${rel}: no inline script`);
    assert.ok(!html.includes('id="quip"') && !html.includes('dtwet-quips'), `${rel}: no joke`);
    assert.equal(policyOf(html), CSP, `${rel}: the same policy`);
  }
});

test('a page with nothing filed still tells a joke, and each day of the run has its own: the joke follows the date, not the build', () => {
  const dates = ['2026-11-15', '2026-11-16'];
  const said = dates.map((d) => deckOf(read(`day/${d}/index.html`, edDist)));
  assert.deepEqual(said, dates.map((d) => quipFor(d)));
  assert.notEqual(said[0], said[1], 'two days in a row, two jokes');
  // a day with nothing filed
  const r = copyRoot(root);
  edit(dayFile(r, '2026-11-15'), (d) => (d.stories = []));
  const out = buildAt(r);
  const page = read('day/2026-11-15/index.html', out.dist);
  assert.equal(deckOf(page), quipFor('2026-11-15'));
  assert.equal(inlineScripts(page).length, 1);
  // the same build twice gives the same joke text, so a rebuild with no news changes no file
  assert.equal(deckOf(read('index.html', buildAt(copyRoot(edRoot)).dist)), deckOf(read('index.html', edDist)));
});

test('quiet mode has no joke: no #quip, no inline script, and the line under ALMOST. is the quiet line, on the homepage and on every day page', () => {
  const r = copyRoot(edRoot);
  edit(latestFile(r), (l) => (l.quiet = { ...l.quiet, quiet: true, note: '' }));
  const out = buildAt(r);
  for (const rel of ['index.html', 'day/2026-11-16/index.html', 'day/2026-11-15/index.html']) {
    const html = read(rel, out.dist);
    assert.ok(!html.includes('id="quip"'), `${rel}: no #quip`);
    assert.deepEqual(inlineScripts(html), [], `${rel}: no inline script`);
    assert.ok(!html.includes('dtwet-quips'), `${rel}: nothing about the joke bag`);
    for (const q of QUIPS) assert.ok(!html.includes(esc(q)), `${rel}: not even a line of the list: ${q}`);
    has(heroOf(html), `<p class="deck">${esc(copy.QUIET_LINE)}</p>`);
    assert.equal(policyOf(html), CSP, `${rel}: the policy does not change with quiet mode`);
  }
  // a page that turns quiet while it is open hides its joke through the html attribute
  const sheet = sheetOf(read('index.html', edDist));
  assert.ok(sheet.includes('html[data-quiet="1"] #quip{display:none}'), 'the rule is in the sheet of a normal page');
  assert.ok(sheetOf(read('index.html', out.dist)).includes('html[data-quiet="1"] #quip{display:none}'), 'and of a quiet one');
  // the one rule that sets the joke's look
  const deck = ruleFor(sheet, '.deck');
  for (const part of ['font:700 22px/1.25 var(--text)', 'min-height:2.5em', 'max-width:330px', 'text-wrap:balance', 'overflow-wrap:anywhere', 'color:var(--ink)']) has(deck, part);
});

test('page script: the Eastern clock time reads exactly as the server writes it, in winter, in summer and across the clock changes', () => {
  const { etClock } = pageScript();
  const at = (iso) => Date.parse(iso);
  const cases = [
    ['2026-11-17T11:12:00Z', '6:12 AM ET'],
    ['2026-11-17T05:00:00Z', '12:00 AM ET'],
    ['2026-11-17T04:59:00Z', '11:59 PM ET'],
    ['2026-11-17T17:00:00Z', '12:00 PM ET'],
    ['2026-11-17T17:05:00Z', '12:05 PM ET'],
    ['2026-11-16T22:30:00Z', '5:30 PM ET'],
    ['2026-07-04T16:05:00Z', '12:05 PM ET'],
    ['2026-07-04T04:00:00Z', '12:00 AM ET'],
    ['2026-03-08T06:59:59Z', '1:59 AM ET'],
    ['2026-03-08T07:00:00Z', '3:00 AM ET'],
    ['2026-11-01T05:59:59Z', '1:59 AM ET'],
    ['2026-11-01T06:00:00Z', '1:00 AM ET'],
  ];
  for (const [iso, want] of cases) {
    assert.equal(copy.etClock(at(iso)), want, `the server: ${iso}`);
    assert.equal(etClock(at(iso)), want, `the page script: ${iso}`);
  }
  // one every 37 minutes through a year and a bit, which crosses both clock changes: the two always agree
  let count = 0;
  for (let ms = at('2026-01-01T00:00:00Z'); ms < at('2027-02-01T00:00:00Z'); ms += 37 * 60000) {
    const server = copy.etClock(ms);
    assert.match(server, /^(?:[1-9]|1[0-2]):[0-5]\d (?:AM|PM) ET$/, server);
    assert.equal(etClock(ms), server, new Date(ms).toISOString());
    count += 1;
  }
  assert.ok(count > 14000, `${count} instants`);
  // a number string reads like the number, and anything that is not a time reads as nothing, on both sides
  assert.equal(etClock(String(at('2026-11-17T11:12:00Z'))), '6:12 AM ET');
  assert.equal(copy.etClock(String(at('2026-11-17T11:12:00Z'))), '6:12 AM ET');
  for (const bad of [Number.NaN, undefined, null, '', true, false, 'soon', {}, Infinity, -Infinity, 8.64e15 + 1]) {
    assert.equal(etClock(bad), '', `script: ${String(bad)}`);
    assert.equal(copy.etClock(bad), '', `server: ${String(bad)}`);
  }
  // the machine's own time zone changes nothing
  const was = process.env.TZ;
  try {
    for (const tz of ['Pacific/Kiritimati', 'Asia/Tokyo', 'America/Los_Angeles', 'UTC']) {
      process.env.TZ = tz;
      assert.equal(copy.etClock(at('2026-11-17T11:12:00Z')), '6:12 AM ET', tz);
      assert.equal(etClock(at('2026-11-17T11:12:00Z')), '6:12 AM ET', tz);
    }
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
  // "Updated 6:12 AM ET" and the stale line use the same time
  assert.equal(copy.updatedText(at('2026-11-17T11:12:00Z')), 'Updated 6:12 AM ET');
  assert.equal(copy.updatedText('soon'), '');
  assert.equal(copy.staleLine(at('2026-11-17T11:12:00Z')), "Last checked 6:12 AM ET. That's on us, not the world.");
  assert.equal(copy.STALE_TEMPLATE.replace('{time}', etClock(at('2026-11-17T11:12:00Z'))), copy.staleLine(at('2026-11-17T11:12:00Z')), 'the page script fills the same sentence the server writes');
});

test('the RSS dates are Eastern with their real offset, the sitemap dates are Eastern days', () => {
  const at = (iso) => Date.parse(iso);
  assert.equal(copy.rfc822ET(at('2026-11-17T10:55:10Z')), 'Tue, 17 Nov 2026 05:55:10 -0500');
  assert.equal(copy.rfc822ET(at('2026-07-04T16:00:00Z')), 'Sat, 04 Jul 2026 12:00:00 -0400', 'summer is -0400');
  assert.equal(copy.rfc822ET(at('2026-03-08T06:59:59Z')), 'Sun, 08 Mar 2026 01:59:59 -0500');
  assert.equal(copy.rfc822ET(at('2026-03-08T07:00:00Z')), 'Sun, 08 Mar 2026 03:00:00 -0400', 'the clocks go forward');
  assert.equal(copy.rfc822ET(at('2026-11-01T05:59:59Z')), 'Sun, 01 Nov 2026 01:59:59 -0400');
  assert.equal(copy.rfc822ET(at('2026-11-01T06:00:00Z')), 'Sun, 01 Nov 2026 01:00:00 -0500', 'and back');
  assert.equal(copy.rfc822ET(at('2026-12-31T23:59:59Z')), 'Thu, 31 Dec 2026 18:59:59 -0500', 'the weekday and the date are the Eastern ones');
  assert.equal(copy.rfc822ET(at('2027-01-01T04:59:59Z')), 'Thu, 31 Dec 2026 23:59:59 -0500', 'five hours behind UTC, so still the old year');
  for (const bad of [Number.NaN, undefined, null, '', 'soon', true]) assert.equal(copy.rfc822ET(bad), '', String(bad));
  // every date reads back as the same instant, to the second
  for (let ms = at('2026-01-01T00:00:00Z'); ms < at('2027-01-01T00:00:00Z'); ms += 3 * 3600e3 + 1234) assert.equal(Date.parse(copy.rfc822ET(ms)), Math.floor(ms / 1000) * 1000, new Date(ms).toISOString());
  // in the feed
  for (const [label, base] of [['editions', edDist], ['plain headlines', dist]]) {
    const xml = read('feed.xml', base);
    assert.match(xml, /<lastBuildDate>Mon, 16 Nov 2026 17:30:00 -0500<\/lastBuildDate>/, label);
    const dates = [...xml.matchAll(/<pubDate>([^<]+)<\/pubDate>/g)].map((m) => m[1]);
    assert.equal(dates.length, 2, label);
    for (const d of dates) assert.match(d, /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} -0[45]00$/, `${label}: ${d}`);
    assert.ok(!/ GMT<\/(?:pubDate|lastBuildDate)>/.test(xml), `${label}: no UTC dates`);
  }
  // the sitemap's dates are the Eastern day of the build: 9 pm Eastern on the 16th is the 17th in UTC
  const r = copyRoot(edRoot);
  edit(latestFile(r), (l) => (l.buildTime = '2026-11-17T02:00:00.000Z'));
  const out = buildAt(r);
  const sitemap = read('sitemap.xml', out.dist);
  assert.match(sitemap, /<loc>https:\/\/didtheworldendtoday\.com\/<\/loc><lastmod>2026-11-16<\/lastmod>/, 'the 16th, not the 17th');
});

test('page script: the streak counts consecutive Eastern days', () => {
  const { streakNext, etDay, addDay, newer } = pageScript();
  const fields = (s) => [s.last, s.n];
  assert.deepEqual(fields(streakNext(null, '2026-11-16')), ['2026-11-16', 1]);
  assert.deepEqual(fields(streakNext({ last: '2026-11-16', n: 4 }, '2026-11-16')), ['2026-11-16', 4], 'the same day does not count twice');
  assert.deepEqual(fields(streakNext({ last: '2026-11-15', n: 4 }, '2026-11-16')), ['2026-11-16', 5]);
  assert.deepEqual(fields(streakNext({ last: '2026-11-13', n: 4 }, '2026-11-16')), ['2026-11-16', 1], 'a gap starts over');
  assert.deepEqual(fields(streakNext({ last: '2026-11-20', n: 4 }, '2026-11-16')), ['2026-11-16', 1], 'a clock set back starts over');
  for (const junk of [{}, { last: 3, n: 'x' }, { last: '2026-11-15', n: 0 }, 'text', 7, []]) assert.deepEqual(fields(streakNext(junk, '2026-11-16')), ['2026-11-16', 1]);
  assert.equal(addDay('2026-03-01', -1), '2026-02-28');
  assert.equal(addDay('2026-12-31', 1), '2027-01-01');
  assert.equal(etDay(Date.parse('2026-11-17T04:59:00Z')), '2026-11-16');
  assert.equal(etDay(Date.parse('2026-11-17T05:01:00Z')), '2026-11-17');
  assert.equal(etDay(Date.parse('2026-03-08T06:59:00Z')), '2026-03-08', 'just before spring forward');
  assert.equal(etDay(Date.parse('2026-03-09T03:59:00Z')), '2026-03-08', 'late on the day the clocks changed');
  assert.equal(etDay(Date.parse('2026-03-09T04:00:00Z')), '2026-03-09');
  assert.equal(newer('2026-11-16T22:45:00Z', '2026-11-16T22:30:00Z'), true);
  assert.equal(newer('2026-11-16T22:30:00Z', '2026-11-16T22:30:00Z'), false);
  assert.equal(newer('junk', '2026-11-16T22:30:00Z'), false);
  assert.equal(newer(undefined, null), false);
});

test('page script: a share gains "Checked N days running." above the address, and only for a real streak', () => {
  const { withStreak } = pageScript();
  const body = ['Did the world end today? ALMOST.', 'Louder than usual. Still here.', '✈️🏦☄️', 'Nov 17 · Doom 74/99', 'didtheworldendtoday.com/day/2026-11-17/'];
  const text = body.join('\n');
  for (const n of [1, 0, NaN, undefined]) assert.equal(withStreak(text, n), text, `a streak of ${n} adds nothing`);
  assert.deepEqual(withStreak(text, 2).split('\n'), [...body.slice(0, -1), 'Checked 2 days running.', body[body.length - 1]], 'above the address');
  assert.equal(withStreak(body.slice(0, -1).join('\n'), 5).split('\n').pop(), 'Checked 5 days running.', 'with no address the line goes last');
  assert.equal(withStreak('', 3), 'Checked 3 days running.');
  const code = fs.readFileSync(path.join(REPO, 'assets', 'app.js'), 'utf8');
  assert.ok(!code.includes('Your first check') && !code.includes('data-first'), 'no streak line on the page itself');
});

test('page script: a failed share falls back to copying, unless the person closed the share sheet', () => {
  const { shouldCopyAfterShareError } = pageScript();
  assert.equal(shouldCopyAfterShareError({ name: 'AbortError' }), false);
  for (const err of [{ name: 'NotAllowedError' }, { name: 'TypeError' }, new Error('no'), null, undefined, 'text']) assert.equal(shouldCopyAfterShareError(err), true, String(err));
  const code = fs.readFileSync(path.join(REPO, 'assets', 'app.js'), 'utf8');
  assert.ok(code.includes('if (shouldCopyAfterShareError(err)) copy();'), 'the share call uses it');
});

test('page script: a request gives up after 8 seconds, so tapping ALMOST. never hangs', async () => {
  const timers = [];
  let cleared = 0;
  const globals = {
    AbortController,
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    clearTimeout: () => {
      cleared += 1;
    },
  };
  const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
  // The connection never answers: the eight seconds run out and the request is cancelled.
  const hang = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(abortError())));
  const stalled = pageScript({ ...globals, fetch: hang }).timedFetch('api/today.json', 8000, (res) => res);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 8000);
  timers[0].fn();
  await assert.rejects(stalled, { name: 'AbortError' });
  assert.equal(cleared, 1, 'the timer is cleared either way');
  // The headers arrive and the body never does: the same timeout covers it.
  timers.length = 0;
  const slowBody = async (url, init) => ({ ok: true, text: () => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(abortError()))) });
  const halfway = pageScript({ ...globals, fetch: slowBody }).timedFetch('page', 8000, (res) => res.text());
  await Promise.resolve();
  timers[0].fn();
  await assert.rejects(halfway, { name: 'AbortError' });
  // A normal answer comes back untouched, and the timer does not fire later.
  timers.length = 0;
  cleared = 0;
  const quick = async () => ({ ok: true, json: async () => ({ score: 40 }) });
  assert.deepEqual(await pageScript({ ...globals, fetch: quick }).timedFetch('api/today.json', 8000, (res) => res.json()), { score: 40 });
  assert.equal(cleared, 1);
  const code = fs.readFileSync(path.join(REPO, 'assets', 'app.js'), 'utf8');
  assert.ok(code.includes('var TIMEOUT_MS = 8000;'));
  assert.ok(code.includes("timedFetch(ROOT + 'api/today.json?t=' + minute(), TIMEOUT_MS") && code.includes("timedFetch(window.location.pathname + '?t=' + minute(), TIMEOUT_MS"), 'both fetches go through it');
  assert.equal((code.match(/\bfetch\(/g) || []).length, 1, 'and nothing else fetches');
});

// A small fake browser: enough of the document for the script to start, to poll, and to show its banner.
function fakeBrowser({ quiet = '0', build = '2026-11-17T15:00:00.000Z', fetched }) {
  const attrs = { 'data-root': './', 'data-live': '1', 'data-build': build, 'data-success': build, 'data-quiet': quiet, 'data-date': '2026-11-17' };
  const listeners = {};
  const intervals = [];
  const appended = [];
  const element = () => {
    const node = { className: '', innerHTML: '', textContent: '', type: '', _on: {}, classList: { add() {}, remove() {} }, setAttribute() {}, remove() {}, addEventListener(type, fn) { node._on[type] = fn; } };
    return node;
  };
  const document = {
    hidden: false,
    documentElement: { getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); } },
    body: { appendChild: (node) => appended.push(node) },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: element,
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  const fetch = async () => ({ ok: true, json: async () => fetched });
  const globals = {
    document,
    window: { matchMedia: () => ({ matches: false }), localStorage: { getItem: () => null, setItem() {} }, location: { pathname: '/', reload() {} } },
    navigator: {},
    fetch,
    setInterval: (fn, ms) => intervals.push({ fn, ms }),
    setTimeout: () => 0,
    clearTimeout() {},
  };
  return { globals, attrs, listeners, intervals, appended };
}

test('page script: the refresh banner has no joke, and the page takes quiet from the fetched data', async () => {
  const later = '2026-11-17T16:00:00.000Z';
  // A page loaded on a normal day, and the site goes quiet while it is open.
  const goingQuiet = fakeBrowser({ quiet: '0', fetched: { buildTime: later, quiet: { quiet: true, note: '' } } });
  pageScript(goingQuiet.globals);
  assert.equal(goingQuiet.attrs['data-quiet'], '0', 'it starts as the page says');
  goingQuiet.listeners.visibilitychange();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(goingQuiet.attrs['data-quiet'], '1', 'the fetched data says quiet, so the page does too');
  const bar = goingQuiet.appended.find((node) => node.className === 'fresh');
  assert.ok(bar, 'newer data shows the banner');
  assert.equal(bar.textContent, 'Updated. Tap to refresh.', 'plain words');
  assert.equal(bar.innerHTML, '', 'and no markup, so no pulsing dot');
  // And the other way round: the quiet is lifted.
  const lifted = fakeBrowser({ quiet: '1', fetched: { buildTime: later, quiet: { quiet: false, note: '' } } });
  pageScript(lifted.globals);
  lifted.listeners.visibilitychange();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lifted.attrs['data-quiet'], '0');
  // Data that says nothing about quiet changes nothing, and data that is not newer shows no banner.
  for (const fetched of [{ buildTime: '2026-11-17T14:00:00.000Z' }, { buildTime: later, quiet: true }, { buildTime: later, quiet: { quiet: 'yes' } }, null]) {
    const same = fakeBrowser({ quiet: '1', fetched });
    pageScript(same.globals);
    same.listeners.visibilitychange();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(same.attrs['data-quiet'], '1', JSON.stringify(fetched));
    assert.equal(same.appended.some((node) => node.className === 'fresh'), Boolean(fetched && fetched.buildTime === later), JSON.stringify(fetched));
  }
  assert.ok(goingQuiet.intervals.some((i) => i.ms === 5 * 60000), 'it polls every five minutes');
});

test('page script: quietIn reads quiet from the fetched data and from nothing else', () => {
  const { quietIn } = pageScript();
  assert.equal(quietIn({ quiet: { quiet: true } }), true);
  assert.equal(quietIn({ quiet: { quiet: false, note: 'x' } }), false);
  for (const odd of [null, undefined, {}, [], 'quiet', { quiet: true }, { quiet: null }, { quiet: {} }, { quiet: { quiet: 'true' } }, { quiet: { quiet: 1 } }]) assert.equal(quietIn(odd), null, JSON.stringify(odd));
});

test('page script: it reads the page it needs and nothing else', () => {
  const code = fs.readFileSync(path.join(REPO, 'assets', 'app.js'), 'utf8');
  assert.ok(Buffer.byteLength(code) < 15 * 1000);
  assert.ok(code.includes("'api/today.json?t='"), 'asks for fresh data by the minute');
  assert.ok(code.includes('navigator.share') && code.includes('clipboard') && code.includes('localStorage') && code.includes('prefers-reduced-motion'));
  assert.ok(code.includes('Updated. Tap to refresh.') && !code.includes('New near misses'), 'the refresh banner has no joke');
  assert.ok(code.includes('5 * MIN'), 'polls every five minutes');
  assert.ok(!/https?:\/\//.test(code.replace(/\/\/ .*$/gm, '')), 'no address is called but our own');
  for (const token of ['eval(', 'new Function', 'document.write']) assert.ok(!code.includes(token), token);
});

// ---- the local server -------------------------------------------------------------------------------------------------------------------

test('serve: paths map to files, folders redirect, misses are 404, and nothing escapes dist', () => {
  const at = (p, o) => resolveStatic(dist, p, o);
  assert.equal(at('/').status, 200);
  assert.equal(at('/').file, path.join(dist, 'index.html'));
  assert.equal(at(`${SUBFOLDER}/`).file, path.join(dist, 'index.html'));
  assert.equal(at(`${SUBFOLDER}/about/`).file, path.join(dist, 'about', 'index.html'));
  assert.equal(at(`${SUBFOLDER}/assets/app.js`).status, 200);
  assert.deepEqual([at(SUBFOLDER).status, at(SUBFOLDER).redirect], [301, `${SUBFOLDER}/`]);
  assert.deepEqual([at('/about').status, at('/about').redirect], [301, '/about/']);
  assert.deepEqual([at(`${SUBFOLDER}/about`).status, at(`${SUBFOLDER}/about`).redirect], [301, `${SUBFOLDER}/about/`]);
  assert.deepEqual([at('/nope').status, at('/nope').file], [404, path.join(dist, '404.html')]);
  assert.equal(at('/day/2026-01-01/').status, 404);
  assert.equal(at('/day/2026-11-15/').status, 200);
  assert.equal(at('/?x=1').status, 200);
  assert.equal(at('/index.html#top').status, 200);
  for (const evil of ['/../package.json', '/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/assets/../../package.json', `${SUBFOLDER}/../package.json`]) {
    const hit = at(evil);
    assert.equal(hit.status, 404, evil);
    assert.equal(hit.file, path.join(dist, '404.html'), evil);
  }
  for (const bad of ['/%00', '/%E0%A4%A', '/a\\b']) assert.equal(at(bad).status, 400, bad);
  assert.equal(at('/about/', { prefix: '' }).status, 200);
});

test('serve: a real server answers on a loopback port, at the root and in the subfolder', async () => {
  const server = createServer(dist);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const ask = (p, method = 'GET') =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: p, method, agent: false }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      req.end();
    });
  try {
    const home = await ask('/');
    assert.equal(home.status, 200);
    assert.match(home.headers['content-type'], /^text\/html/);
    assert.ok(home.body.includes('ALMOST.'));
    const sub = await ask(`${SUBFOLDER}/`);
    assert.equal(sub.status, 200);
    assert.equal(sub.body, home.body, 'the same page in the subfolder');
    assert.match((await ask(`${SUBFOLDER}/assets/app.js`)).headers['content-type'], /javascript/);
    for (const font of WEB_FONTS) assert.equal((await ask(`/assets/${font}`)).headers['content-type'], 'font/woff2', font);
    assert.equal((await ask('/assets/anton.woff2')).status, 404, 'the old display font is gone');
    const missing = await ask('/nope');
    assert.equal(missing.status, 404);
    assert.ok(missing.body.includes("This page ended. The world didn&#39;t."));
    assert.equal((await ask(SUBFOLDER)).status, 301);
    const head = await ask('/', 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
    assert.equal((await ask('/', 'POST')).status, 405);
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
  }
});

test('the package has the scripts the README names', () => {
  const pkg = readJson(path.join(REPO, 'package.json'));
  assert.equal(pkg.scripts.serve, 'node scripts/serve.mjs');
  assert.equal(pkg.scripts.edit, 'node scripts/editor.mjs');
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  for (const needle of ['npm run update', 'npm run edit', 'npm run build', 'npm run serve', 'npm test', 'quiet.json', 'X_BEARER_TOKEN', 'X_DAILY_BUDGET_USD', 'ANTHROPIC_API_KEY', '@thelpdrive', 'didtheworldendtoday.com', 'Settings']) assert.ok(readme.includes(needle), needle);
  assert.ok(!/github\.com/i.test(readme), 'no repository link');
  assert.ok(!/levi|druin/i.test(readme), 'no real names');
});

test('the README says what to set up before the first push: Pages from GitHub Actions, then the four A records and the www CNAME', () => {
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  const before = readme.indexOf('Before the first push');
  assert.ok(before > 0);
  assert.ok(readme.indexOf('**GitHub Actions**', before) > before, 'Pages source is set to GitHub Actions');
  assert.ok(readme.indexOf('Before the first push') < readme.indexOf('npm run update'), 'and it comes first');
  for (const address of ['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153']) assert.ok(readme.includes(address), address);
  assert.match(readme, /One CNAME record for `www`, pointing at your GitHub Pages host, which is your GitHub username followed by `\.github\.io`/);
  assert.ok(!/ALIAS|ANAME/.test(readme));
});

// ---- phase 6: one big link per card, the day page from a shared link, the quiet pages, and the words under a headline ----------------

// How links sit in each other on a page: 1 when none holds another, and 0 at the end when every one is closed.
function anchorDepth(html) {
  let depth = 0;
  let deepest = 0;
  for (const m of html.matchAll(/<a\b[^>]*>|<\/a>/g)) {
    depth += m[0] === '</a>' ? -1 : 1;
    deepest = Math.max(deepest, depth);
  }
  return { deepest, end: depth };
}

test('phase 6 links: a row is one link across the whole card, the donate link stands beside it, and no link holds another', () => {
  const quakeFirst = { ...ED16, items: [ED16.items[5], ...ED16.items.slice(0, 5)] };
  const { dist: quakeDist } = withEditions({ ...EDITIONS, '2026-11-16': quakeFirst });
  const pages = [
    ['home', read('index.html', edDist), true],
    ['plain home', read('index.html'), false],
    ['live day', read('day/2026-11-16/index.html', edDist), true],
    ['past day', read('day/2026-11-15/index.html', edDist), true],
    ['plain day', read('day/2026-11-16/index.html'), false],
    ['quiet story first', read('index.html', quakeDist), true],
  ];
  for (const [label, html, ranked] of pages) {
    assert.deepEqual(anchorDepth(html), { deepest: 1, end: 0 }, `${label}: no link holds another, and every link closes`);
    assert.ok(!/<a\b[^>]*>\s*<(?:li|ol|ul|div|p|section|h[1-6])\b/.test(html), `${label}: a link holds words, never a block`);
    // there is no tag over the first row any more: the closest call is the red 1
    assert.ok(!html.includes('class="tag"') && !html.includes('CLOSEST CALL') && !html.includes('TOP STORY'), `${label}: no tag on a row`);
    // a homepage has a block of rows for today and one for yesterday, each with its own first row
    const groups = html.includes('<section class="day"') && !html.includes('id="rows"') ? blocksOf(html).map(rowsOf) : [rowsOf(html)];
    assert.ok(groups.every((g) => g.length >= 2), `${label}: ${groups.map((g) => g.length)} rows`);
    for (const group of groups) {
      for (const [index, row] of group.entries()) {
        const f = rowFacts(row);
        const rank = String(index + 1);
        assert.equal(f.plain, !ranked, `${label} row ${rank}: only a day with an edition is ranked`);
        if (row.includes('<div class="card">')) {
          // a story with no safe link still reads, and has nothing to open
          assert.ok(!row.includes('<a '), `${label} row ${rank}: no link`);
          continue;
        }
        assert.equal((row.match(/<a class="card"/g) || []).length, 1, `${label} row ${rank}: one card link`);
        const card = row.match(/<a class="card" href="[^"]*" target="_blank" rel="noopener">([\s\S]*?)<\/a>/);
        assert.ok(card, `${label} row ${rank}: the card is a link that opens in a new tab`);
        // inside the card: the number a screen reader says (a ranked row only), the label, the line, the caption of a quiet row, the news site
        const said = ranked ? `<span class="sr">${rank}\\. </span> ` : '';
        assert.match(card[1], new RegExp(`^${said}<span class="lb">[^<]+</span>(?: <span class="ln">[^<]+</span>)?(?: <span class="cap">[^<]+</span>)?(?: <span class="src">[^<]+</span>)?$`), `${label} row ${rank}`);
        assert.equal(card[1].includes('class="cap"'), f.quiet, `${label} row ${rank}: a quiet row has its caption in the card, and no other row has one`);
        assert.ok(!row.includes('<p class="cap">'), `${label} row ${rank}: the caption is never a paragraph under the card`);
        // outside it: the rank number (for the eye only), the emoji and the donate link
        for (const outside of ['class="rn"', 'class="em"', 'class="help"']) assert.ok(!card[1].includes(outside), `${label} row ${rank}: ${outside} stands outside the card`);
        if (ranked) assert.ok(row.includes(`<span class="rn" aria-hidden="true">${rank}</span>`), `${label} row ${rank}: the number is not read out, the card reads it`);
        else assert.ok(!row.includes('class="rn"') && !row.includes('class="sr"'), `${label} row ${rank}: a plain headline has no number at all`);
        assert.equal(f.best, ranked && index === 0, `${label} row ${rank}: only the first ranked row is the closest call`);
        if (f.help) assert.ok(row.indexOf('</a>') < row.indexOf('class="help"'), `${label} row ${rank}: the card closes before the donate link opens`);
      }
    }
    // the list of every headline: the link is the headline and its words, and a donate link stands beside it
    for (const head of headsOf(html)) {
      const link = head.match(/<a class="hla" href="[^"]*" target="_blank" rel="noopener">([\s\S]*?)<\/a>/);
      if (!link) continue;
      assert.match(link[1], /^<span class="ht">[\s\S]*<\/span>(?:<span class="hs">[\s\S]*<\/span>)?$/, `${label}: a headline link holds the headline and its source`);
      assert.ok(!link[1].includes('class="cap"') && !link[1].includes('class="help"'), `${label}: the caption and the donate link stand outside the headline link`);
    }
  }
  // the day's rows and its list of headlines are lists a screen reader can count
  for (const [label, html] of pages) for (const m of html.matchAll(/<ol class="(?:rows|heads)"([^>]*)>/g)) assert.match(m[1], /role="list"/, label);
});

test('phase 6 day pages: someone who lands from a shared link can find today, every day, the scale, the share button and where to follow', () => {
  const live = read('day/2026-11-16/index.html', edDist);
  const past = read('day/2026-11-15/index.html', edDist);
  const nav = { live: '<nav class="dnav" aria-label="Other days">\n<a href="../2026-11-15/">Earlier: Nov 15</a>\n<span></span>\n</nav>', past: '<nav class="dnav" aria-label="Other days">\n<span></span>\n<a href="../2026-11-16/">Later: Nov 16</a>\n</nav>' };
  for (const [label, html, question] of [['live day', live, 'Did the world end today?'], ['past day', past, 'Did the world end on Nov 15?']]) {
    // the band says which day this is
    has(html, `<div class="band"><h1 class="q">${question}</h1></div>`);
    // no bar of links above the hero: the way out is under the rows and in the footer
    assert.ok(!html.includes('class="top"') && !/[←→]/.test(html), `${label}: no top bar and no arrow`);
    // the hero: the board with the scale in its small print, and no share button in it
    const hero = heroOf(html);
    has(hero, '<span class="bt">out of 99. 0 is a quiet day. 99 is the end.</span>');
    assert.ok(!hero.includes('data-act="share"') && !hero.includes('class="scale"') && !hero.includes('class="mast"'), `${label}: the hero has no share button and no old scale line`);
    // the rows say what they are, and the foot of the rows shares and follows
    has(html, '<h2 class="sec">NEAR MISSES</h2>\n<ol class="rows" role="list">');
    has(html, '<div class="df">\n<button class="btn" type="button" data-act="share">Share this day</button>\n<a class="follow" href="https://x.com/thelpdrive" target="_blank" rel="noopener">Follow @thelpdrive for tomorrow&#39;s ALMOST.</a>\n</div>');
    assert.equal((html.match(/data-act="share"/g) || []).length, 1, `${label}: the one share button`);
    // the two ends of the list of days sit under the headlines, and the footer has the way to today and to every day
    has(html, label === 'live day' ? nav.live : nav.past);
    assert.ok(html.indexOf('class="dnav"') > html.indexOf('id="all"') || !html.includes('id="all"'), `${label}: the ends come after the headlines`);
    has(html, '<a href="../../">Today</a>');
    has(html, '<a href="../../almanac/">Almanac</a>');
    assert.ok(html.indexOf('<footer>') > html.indexOf('class="dnav"'), `${label}: the footer is last`);
  }
  // the live day's list is the last 24 hours and says when it was read; a finished day's list is that day's
  has(live, '<h2 class="sec">Headlines from the last 24 hours, as of 5:30 PM ET</h2>');
  has(past, '<h2 class="sec">Every headline we read that day</h2>');
  assert.ok(!past.includes('Headlines from the last 24 hours') && !live.includes('Every headline we read that day'));
  // ten headlines show; the rest wait behind a button and none is lost
  const n = stored16.stories.length;
  assert.ok(n > copy.HEADLINES_SHOWN && stored15.stories.length <= copy.HEADLINES_SHOWN, 'a long day and a short day to compare');
  const all = live.slice(live.indexOf('<section id="all">'));
  const [shown, rest] = all.split('<details class="more">');
  assert.equal((shown.match(/<li class="hd/g) || []).length, copy.HEADLINES_SHOWN, 'ten show');
  assert.equal(rest.match(/<summary>([^<]*)<\/summary>/)[1], `Show ${n - copy.HEADLINES_SHOWN} more headlines`);
  assert.equal((rest.match(/<li class="hd/g) || []).length, n - copy.HEADLINES_SHOWN, 'the rest are behind the button');
  assert.ok(!/<details class="more" open/.test(live), 'closed until it is tapped');
  assert.equal((live.match(/<li class="hd/g) || []).length, n, 'every headline of the day is on the page');
  assert.ok(!past.includes('<details'), 'a short day has nothing to hide');
  // the same cut at the edges, and the word for one
  const one = (title) => ({ id: title, cat: 'internet', title, url: 'https://example.com/a', source: 'S', outlets: 1 });
  const ctx = { byId: new Map(), quietMode: false, quietCaption: 'No jokes on this one.', quietLink: cfg.quiet.quietLink, quietLinkIntl: cfg.quiet.quietLinkIntl };
  const ten = Array.from({ length: 10 }, (_, i) => one(`Story ${i}`));
  assert.ok(!headlineRows(ten, ctx).includes('<details'), 'ten is not hidden');
  assert.ok(headlineRows([...ten, one('Story 10')], ctx).includes('<summary>Show 1 more headline</summary>'), 'one more is "headline"');
  assert.ok(headlineRows([...ten, one('A'), one('B')], ctx).includes('<summary>Show 2 more headlines</summary>'));
});

test('phase 6 quiet pages: no claim that the rows are ranked, "Top stories" over them, plain rows with no rank, and a follow line with no joke', () => {
  const r = copyRoot(edRoot);
  edit(latestFile(r), (l) => (l.quiet = { ...l.quiet, quiet: true, note: '' }));
  const out = buildAt(r);
  const home = read('index.html', out.dist);
  assert.ok(!home.includes('NEAR MISSES') && !home.includes('WORST FIRST'), 'the quiet homepage does not say its rows are ranked');
  has(home, '<h2 class="sec">TODAY’S TOP STORIES</h2>');
  for (const rel of ['day/2026-11-16/index.html', 'day/2026-11-15/index.html']) {
    const page = read(rel, out.dist);
    has(page, '<h2 class="sec">TOP STORIES</h2>\n<ol class="rows" role="list">');
    assert.ok(!page.includes('NEAR MISSES') && !page.includes('WORST FIRST'), `${rel}: no ranking claim`);
    has(page, '<a class="follow" href="https://x.com/thelpdrive" target="_blank" rel="noopener">Follow @thelpdrive</a>');
    assert.ok(!page.includes('ALMOST.</a>') && !page.includes('tomorrow'), `${rel}: no joke in the follow line`);
    // every row is plain: the news site's own headline, no number, no closest call, no emoji
    const facts = factsIn(page);
    assert.ok(facts.length >= 2 && facts.every((f) => f.plain && !f.best && f.rank === null && f.emoji === null), `${rel}: plain rows`);
    assert.ok(!page.includes('class="rn"') && !page.includes('class="tag"') && !page.includes('class="top"'), `${rel}: no number, no tag, no top bar`);
  }
  // an ordinary build is the other way round, so these checks can fail
  const normal = read('day/2026-11-16/index.html', edDist);
  assert.ok(normal.includes('<h2 class="sec">NEAR MISSES</h2>') && normal.includes('tomorrow&#39;s ALMOST.') && !normal.includes('>TOP STORIES<'));
  assert.ok(read('index.html', edDist).includes('<h2 class="sec">TODAY’S NEAR MISSES</h2>'));
});

// ---- phase 6 fix round -------------------------------------------------------------------------------------------------------

test('phase 6 fix round: only an edition says its rows are ranked, and a day of plain headlines is "Top stories" with no claim', () => {
  const RANKED = '<h2 class="sec">NEAR MISSES</h2>\n<ol class="rows" role="list">';
  const TOP = '<h2 class="sec">TOP STORIES</h2>\n<ol class="rows" role="list">';
  const RANKED_TODAY = '<h2 class="sec">TODAY’S NEAR MISSES</h2>';
  const TOP_TODAY = '<h2 class="sec">TODAY’S TOP STORIES</h2>';
  // an edition on every day: the line on the homepage and on both day pages
  has(read('index.html', edDist), RANKED_TODAY);
  for (const rel of ['day/2026-11-16/index.html', 'day/2026-11-15/index.html']) has(read(rel, edDist), RANKED);
  // no edition on any day: nothing says the rows are ranked, and the pages say "Top stories"
  const home = read('index.html');
  assert.ok(!home.includes('NEAR MISSES') && !home.includes('WORST FIRST'), 'the plain homepage makes no claim about order');
  has(home, TOP_TODAY);
  for (const rel of ['day/2026-11-16/index.html', 'day/2026-11-15/index.html']) {
    const page = read(rel);
    has(page, TOP);
    assert.ok(!page.includes('NEAR MISSES') && !page.includes('WORST FIRST'), `${rel}: no ranking claim`);
  }
  // one day of each: every page says what its own day is
  const todayOnly = withEditions({ '2026-11-16': ED16 }).dist;
  has(read('index.html', todayOnly), RANKED_TODAY);
  has(read('day/2026-11-16/index.html', todayOnly), RANKED);
  has(read('day/2026-11-15/index.html', todayOnly), TOP);
  const yesterdayOnly = withEditions({ '2026-11-15': ED15 }).dist;
  has(read('index.html', yesterdayOnly), TOP_TODAY);
  assert.ok(!read('index.html', yesterdayOnly).includes('NEAR MISSES'), "today is plain headlines, so today's block does not say it is ranked");
  has(read('day/2026-11-16/index.html', yesterdayOnly), TOP);
  has(read('day/2026-11-15/index.html', yesterdayOnly), RANKED);
  // the words themselves, not only what the constants say
  assert.deepEqual([copy.SECTION_TODAY, copy.SECTION_TODAY_PLAIN, copy.SECTION_DAY, copy.SECTION_DAY_PLAIN], ['TODAY’S NEAR MISSES', 'TODAY’S TOP STORIES', 'NEAR MISSES', 'TOP STORIES']);
  // the old line said how the rows were ordered; the red 1 says it now
  for (const gone of ['WORST FIRST', 'MOST WORLD-ENDING']) for (const base of [edDist, dist]) assert.ok(!read('index.html', base).includes(gone), `no "${gone}" on a page`);
});

test('phase 6 fix round: a place is a US place only when it is only a US place, and a headline that says nobody was hurt gets no link', () => {
  const link = (title) => headlineLink(title);
  // the four the reviewer sent
  assert.equal(link('Floods destroy homes in northeast India'), 'ifrc', 'a direction in front of a country abroad is not the US');
  assert.equal(link('Hurricane destroys homes in Baja California'), 'ifrc', 'Baja California is Mexico, not California');
  assert.equal(link('Storm destroys homes in Jamaica, US aid on the way'), 'ifrc', 'a named place abroad beats a bare "US"');
  assert.equal(link("Nor'easter damages homes across New England"), 'redcross', 'New England is a US place, and "damages" is harm');
  // a region word that is also a region of other countries names no place by itself
  for (const title of ['Tornado destroys homes across the Midwest', 'Hurricane damages homes along the Gulf Coast', 'Storm destroys homes in the Northeast', 'Wildfire destroys homes on the East Coast', 'Flood damages homes on the West Coast']) assert.equal(link(title), null, title);
  assert.equal(link('Cyclone damages homes on Australia’s east coast'), 'ifrc', 'the east coast of a country abroad');
  assert.equal(link('Hurricane damages homes along the Gulf Coast of Mexico'), 'ifrc');
  for (const title of ['Flood destroys homes in Baja California and southern California', 'Hurricane destroys homes in New Mexico', 'Storm damaged homes in the Pacific Northwest']) assert.equal(link(title), 'redcross', title);
  assert.equal(link('Flood kills 12 in Baja California Sur'), 'ifrc');
  // a named US place still wins over a named place abroad, and a bare "US" or "U.S." still counts when nothing else is named
  assert.equal(link('Typhoon damaged homes in Guam and Japan'), 'redcross');
  for (const title of ['Wildfire destroys homes, U.S. officials say', 'Flood damaged homes in Georgia, US', 'Storm destroys homes across the United States']) assert.equal(link(title), 'redcross', title);
  // the harm words: damage, damages, displaces, displacing, evacuation, evacuations
  for (const title of ['Heavy damage reported in Moore, OK after tornado', 'Storm damages homes in Moore, OK', 'Flood displaces thousands in Bangladesh', 'Floods displacing families in Louisiana', 'Evacuations ordered near Moore, OK', 'Evacuation ordered as wildfire nears Santa Barbara, CA']) assert.ok(link(title), title);
  assert.equal(link('Flood displaces thousands in Bangladesh'), 'ifrc');
  assert.equal(link('Floods displacing families in Louisiana'), 'redcross');
  assert.equal(link('Damaging winds forecast for Texas'), null, '"damaging" is a forecast, not harm');
  // an evacuation that is over, and harm that did not happen, is not harm
  for (const title of [
    'Wildfire evacuation order lifted in California',
    'Wildfire evacuation orders lifted in California',
    'Officials lift evacuation order after California wildfire',
    'Cal Fire lifts the remaining evacuation orders in Texas',
    'Strong quake shakes Tokyo, no damage reported',
    'Quake near Santa Barbara, CA: no injuries reported',
    'No one hurt as flood hits Texas town',
    'Nobody was injured when the tornado crossed Oklahoma',
  ]) assert.equal(link(title), null, title);
  // but harm named next to it still counts
  for (const title of ['No injuries, but homes destroyed in Moore, OK', 'No deaths reported, but dozens of homes damaged in Texas', 'Wildfire evacuation order lifted, but 40 homes destroyed in California']) assert.equal(link(title), 'redcross', title);
  // a story is read the same way on the page
  const news = (title) => ({ id: 'n', cat: 'weather', kind: 'news', title, url: 'https://example.com/n', source: 'Example', quiet: true });
  assert.equal(quietCard(news('Floods destroy homes in northeast India')).link, 'ifrc');
  assert.equal(quietCard(news('Hurricane destroys homes in Baja California')).link, 'ifrc');
  assert.equal(quietCard(news('Wildfire evacuation order lifted in California')).link, null);
});

test('phase 6 fix round: the feed says the date and the Doom Score the way the page does', () => {
  const items = [].concat(new XMLParser().parse(read('feed.xml', edDist)).rss.channel.item);
  assert.ok(items[0].description.startsWith(`<p>Mon, Nov 16 · Doom Score ${latest.score} of 99</p>`), items[0].description);
  assert.ok(items[1].description.startsWith('<p>Sun, Nov 15 · Doom Score 11 of 99</p>'), items[1].description);
  // the cap is the page's cap, and a score that is not a number reads as 0
  const day = { date: '2026-11-16', score: 'x', headline: 'H. Still here.', rows: [], updatedAt: '2026-11-16T22:30:00Z' };
  const xml = (extra) => feedXml({ siteUrl: SITE, days: [day], buildTime: '2026-11-16T22:30:00Z', ...extra });
  assert.ok(xml({ doomCap: 50 }).includes('Mon, Nov 16 · Doom Score 0 of 50'));
  assert.ok(xml({}).includes('Mon, Nov 16 · Doom Score 0 of 99'));
});

test('phase 6 fix round: a row names its news site and nothing else; the list of every headline keeps the count and "Read it", each after a dot', () => {
  const ctx = { byId: new Map(), quietMode: false, quietCaption: 'q', quietLink: '', quietLinkIntl: '' };
  const make = (over) => dayRow({ emoji: 'e', label: 'Card skimmers', line: 'A line.', ids: ['a'], url: 'https://x.example/a', source: 'TradingView', outlets: 4, ...over }, 0, ctx);
  const src = (over) => rowFacts(make(over)).src;
  assert.equal(src({}), 'TradingView', 'the name, with no count and no "Read it"');
  assert.equal(src({ outlets: 1 }), 'TradingView');
  assert.equal(src({ source: 'NASA/JPL', outlets: 1 }), 'NASA/JPL');
  assert.equal(src({ source: 'WSB-TV', outlets: 2 }), 'WSB-TV');
  assert.equal(src({ source: '', outlets: 5 }), null, 'no name, no line, whatever the count');
  assert.ok(!make({ source: '', outlets: 1 }).includes('class="src"'), 'no source: no line');
  assert.equal(src({ url: 'javascript:alert(1)' }), 'TradingView', 'no safe link: the name still shows');
  assert.ok(make({ url: 'javascript:alert(1)' }).includes('<div class="card">') && !make({ url: 'javascript:alert(1)' }).includes('<a '));
  for (const html of [make({}), make({ outlets: 1 }), make({ source: 'WSB-TV', outlets: 2 })]) assert.ok(!/news sites|Read it/.test(html), 'a row says neither how many told it nor what the link does');
  // a web address reads as its host
  assert.equal(src({ source: 'https://www.essexcountynews.co.uk/' }), 'essexcountynews.co.uk');
  // the parts, and the one-line form the list of every headline keeps
  assert.deepEqual(copy.sourceParts(4, 'TradingView'), { name: 'TradingView', count: '4 news sites' });
  assert.deepEqual(copy.sourceParts(1, 'TradingView'), { name: 'TradingView', count: '' });
  assert.deepEqual(copy.sourceParts('x', ''), { name: '', count: '' });
  const head = headlineRow({ id: 'h', cat: 'internet', title: 'A headline', url: 'https://x.example/a', source: 'TradingView', outlets: 4 }, ctx);
  assert.ok(head.includes('<span class="hs">TradingView · 4 news sites · Read it</span>'), 'the list keeps one line too');
  assert.equal(copy.rowSource('https://www.essexcountynews.co.uk/'), 'essexcountynews.co.uk');
});

test('phase 6 fix round: a quiet row has its caption inside the card, between the line and the source line, and the donate link after the card', () => {
  const lead = { id: 'q1', cat: 'weather', kind: 'news', title: 'Tornado destroys homes in Oklahoma town', url: 'https://example.com/q1', source: 'Example', quiet: true };
  const ctx = { byId: new Map([['q1', lead]]), quietMode: false, quietCaption: 'No jokes on this one.', quietLink: cfg.quiet.quietLink, quietLinkIntl: cfg.quiet.quietLinkIntl };
  const item = { emoji: '🌪️', label: 'Oklahoma tornado', line: 'A tornado hit Oklahoma.', ids: ['q1'], quiet: true, url: 'https://example.com/q1', source: 'Example', outlets: 3 };
  const html = dayRow(item, 1, ctx);
  const card = html.match(/<a class="card" href="[^"]*" target="_blank" rel="noopener">([\s\S]*?)<\/a>/)[1];
  assert.equal(card, '<span class="sr">2. </span> <span class="lb">Oklahoma tornado</span> <span class="ln">A tornado hit Oklahoma.</span> <span class="cap">No jokes on this one.</span> <span class="src">Example</span>');
  assert.ok(html.includes('</a>\n<a class="help" href="https://www.redcross.org/donate" target="_blank" rel="noopener">Donate to the Red Cross</a>\n</div>'), 'the donate link is its own link, after the card');
  assert.equal(html.match(/class="cap"/g).length, 1, 'one caption');
  assert.ok(!html.includes('<p class="cap">'), 'not a paragraph under the card');
  assert.ok(!/[→←↑↓]/.test(html), 'no arrow in the donate link');
  assert.ok(/^<li class="row quiet">/.test(html), 'a quiet row has the class the red rule steps around');
  assert.deepEqual(anchorDepth(html), { deepest: 1, end: 0 });
  // a quiet page draws no emoji at all
  const hushed = dayRow(item, 1, { ...ctx, quietMode: true });
  assert.ok(!hushed.includes(item.emoji) && !hushed.includes('class="em"'), 'and no emoji is drawn in quiet mode');
  // a quiet row with nothing to link to still has its caption, in the card, and no donate link
  const plain = dayRow({ ...item, ids: ['gone'] }, 1, ctx);
  assert.ok(plain.includes('<span class="cap">No jokes on this one.</span> <span class="src">') && !plain.includes('class="help"'));
  // a row with no safe link has the caption in the same place
  const noLink = dayRow({ ...item, url: 'javascript:alert(1)' }, 1, ctx);
  assert.ok(noLink.includes('<div class="card"><span class="sr">2. </span> <span class="lb">Oklahoma tornado</span> <span class="ln">A tornado hit Oklahoma.</span> <span class="cap">No jokes on this one.</span> <span class="src">'));
  // a row that is not quiet has no caption at all
  assert.ok(!dayRow({ ...item, quiet: false }, 1, ctx).includes('class="cap"'));
  // the list of every headline keeps its caption as a line under the link, and the donate link after it
  const head = headlineRow(lead, ctx);
  assert.ok(head.includes('</a>\n<p class="cap">No jokes on this one.</p>\n<a class="help" href="https://www.redcross.org/donate"'), head);
});

test('phase 6 one id, one story: when two stories carry one id, every page lists the story once, and so does the data file', () => {
  const r = copyRoot(root);
  const [a, b] = stored16.stories;
  assert.notEqual(a.title, b.title);
  const share = (stories) => {
    stories.find((s) => s.title === b.title).id = stories.find((s) => s.title === a.title).id;
  };
  edit(dayFile(r, '2026-11-16'), (d) => share(d.stories));
  edit(latestFile(r), (l) => share(l.stories));
  const out = buildAt(r);
  auditSite(out.dist, { label: 'one id twice' });
  const day = read('day/2026-11-16/index.html', out.dist);
  const titles = headsOf(day).map((h) => headFacts(h).title);
  assert.equal(titles.length, stored16.stories.length - 1, 'one story fewer: the second one with that id is left out');
  assert.equal(new Set(titles).size, titles.length, 'and no headline twice');
  assert.equal(titles.includes(a.title) + titles.includes(b.title), 1, 'exactly one of the two is listed');
  const home = read('index.html', out.dist);
  const lines = rowsOf(home).map((x) => rowFacts(x).label);
  assert.ok(lines.length >= 4 && lines.every(Boolean), 'the homepage has its rows');
  assert.equal(new Set(lines).size, lines.length, 'the rows on the homepage are all different stories');
  const ids = readJson(path.join(out.dist, 'api', 'today.json')).stories.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'the data file has each id once');
  assert.equal(ids.length, stored16.stories.length - 1);
});

test('phase 6 source text: the news site, how many told it, and a web address read as its host', () => {
  assert.equal(copy.sourceText(1, 'CBS News'), 'CBS News');
  assert.equal(copy.sourceText(2, 'CBS News'), 'CBS News · 2 news sites');
  assert.equal(copy.sourceText(32, 'CBS News'), 'CBS News · 32 news sites');
  assert.equal(copy.sourceText('3', 'CBS News'), 'CBS News · 3 news sites');
  assert.equal(copy.sourceText(3.9, 'CBS News'), 'CBS News · 3 news sites');
  assert.equal(copy.sourceText(5, ''), '5 news sites', 'no name, a count');
  for (const [outlets, source] of [[1, ''], [undefined, undefined], [null, null], ['x', ''], [0, '']]) assert.equal(copy.sourceText(outlets, source), '', `${outlets} ${source}`);
  assert.equal(copy.sourceText('x', 'S'), 'S', 'a count that is not a number is not shown');
  assert.ok(!/\bsources?\b|outlets?/i.test(copy.sourceText(4, 'S')), 'a person reads "news sites"');
  // a web address is its host, without www and without the slash
  for (const [given, shown] of [
    ['https://www.essexcountynews.co.uk/', 'essexcountynews.co.uk'],
    ['http://example.com/a/b?c=1', 'example.com'],
    ['https://WWW.Example.COM', 'example.com'],
    ['www.example.com', 'example.com'],
    ['example.com/news', 'example.com'],
    ['CBS News', 'CBS News'],
    ['U.S. News', 'U.S. News'],
    ["O'Reilly & Sons", "O'Reilly & Sons"],
    ['', ''],
    [null, ''],
    [undefined, ''],
  ]) assert.equal(copy.sourceName(given), shown, String(given));
  assert.equal(copy.sourceText(3, 'https://www.essexcountynews.co.uk/'), 'essexcountynews.co.uk · 3 news sites');
  // under a headline in the list: the same words, then what the link does (a row shows the name alone)
  assert.equal(copy.headlineMeta(1, 'Pub A', true), 'Pub A · Read it');
  assert.equal(copy.headlineMeta(2, 'Pub A', true), 'Pub A · 2 news sites · Read it');
  assert.equal(copy.headlineMeta(1, 'Pub A', false), 'Pub A', 'no link, nothing to read');
  assert.equal(copy.headlineMeta(1, '', true), 'Read it');
  assert.equal(copy.headlineMeta(1, '', false), '');
  assert.equal(copy.headlineMeta(7, 'https://www.example.com/x', true), 'example.com · 7 news sites · Read it');
  assert.equal(copy.READ_IT, 'Read it');
  // a source that is an address never reaches a page as an address
  const ctx = { byId: new Map(), quietMode: false, quietCaption: 'q', quietLink: '', quietLinkIntl: '' };
  const row = dayRow({ emoji: 'e', label: 'A label', line: 'A line.', ids: ['a'], url: 'https://x.example/a', source: 'https://www.essexcountynews.co.uk/', outlets: 1 }, 0, ctx);
  assert.equal(rowFacts(row).src, 'essexcountynews.co.uk', 'a row shows the name alone');
  const head = headlineRow({ id: 'h', cat: 'internet', title: 'A headline', url: 'https://x.example/a', source: 'https://www.essexcountynews.co.uk/', outlets: 2 }, ctx);
  assert.ok(head.includes('<span class="hs">essexcountynews.co.uk · 2 news sites · Read it</span>'));
  assert.ok(!head.includes('https://www.essex'), 'the address itself is not shown');
});

test('phase 6 tap targets: every control is at least 48px tall, a card and a headline link spread over their whole row, and the small print is big enough', () => {
  const sheet = sheetOf(read('index.html', edDist));
  const px = (body, prop) => {
    const m = body.match(new RegExp(`(?:^|;)${prop}:([\\d.]+)px`));
    return m ? Number(m[1]) : 0;
  };
  // the share button is 52px tall; every other control is at least 48px
  assert.equal(px(ruleFor(sheet, '.btn'), 'height'), 52, '.btn is 52px tall');
  for (const selector of ['.row', '.help', '.follow', '.end a', '.hla', '.al', '.dd summary,.more summary', '.dnav a', 'footer .all a', 'footer .fl a']) {
    assert.ok(px(ruleFor(sheet, selector), 'min-height') >= 48, `${selector} is at least 48px tall`);
  }
  assert.ok(ruleFor(sheet, '.vbox').includes('width:100%'), 'ALMOST. is a button as wide as the column, taller than any finger');
  // the row is the frame and the link's own box is stretched over it, so a tap anywhere in the row opens the story
  assert.match(ruleFor(sheet, '.row'), /position:relative/);
  assert.match(ruleFor(sheet, '.card::after'), /content:"";position:absolute;inset:0/);
  assert.match(ruleFor(sheet, '.hd'), /position:relative/);
  assert.match(ruleFor(sheet, '.hla::after'), /content:"";position:absolute;inset:0/);
  // the donate link sits above the stretched link, so it can be tapped on its own
  assert.match(ruleFor(sheet, '.help'), /position:relative;z-index:1/);
  // the source line is an underlined line of the card, and the caption is a block of its own
  assert.match(ruleFor(sheet, '.src'), /display:block/);
  assert.match(ruleFor(sheet, '.src'), /overflow-wrap:anywhere/, 'a long name wraps instead of running off the card');
  assert.match(ruleFor(sheet, '.cap'), /display:block/);
  // the focus ring of a stretched link is drawn on the row
  assert.match(ruleFor(sheet, '.card:focus-visible::after'), /outline:3px solid var\(--ink\)/);
  assert.match(ruleFor(sheet, '.hla:focus-visible::after'), /outline:3px solid var\(--ink\)/);
  // nothing is set smaller than 12px; only the kicker over a day, the board's label and its small print are under 14px
  const sized = rulesOf(sheet).flatMap((r) => [...r.body.matchAll(/(?:font:\d+ |font-size:)(\d+)px/g)].map((m) => ({ selector: r.selector, px: Number(m[1]) })));
  assert.ok(sized.length > 20 && Math.min(...sized.map((x) => x.px)) === 12, `smallest type ${Math.min(...sized.map((x) => x.px))}px`);
  assert.deepEqual(sized.filter((x) => x.px < 14).map((x) => x.selector).sort(), ['.bl', '.bt', '.dk'], 'only the kicker, the board label and its small print are below 14px');
  assert.match(ruleFor(sheet, 'footer'), /font:400 14px\/1\.6 var\(--text\)/);
  // the details button is a real button for the eye and the finger
  assert.match(ruleFor(sheet, '.dd summary,.more summary'), /cursor:pointer/);
});

test('phase 6 words: no page says the old names for things, and the about page explains the rank, the time and the doom score', () => {
  const about = read('about/index.html', edDist);
  has(about, esc(copy.ET_NOTE));
  has(about, esc(copy.HOW_WE_RANK));
  has(about, esc(copy.QUIET_CARDS_ABOUT));
  assert.match(about, /id="doom-score"/, 'the Doom Score has a place a link can point to');
  // a person reads "news sites", never "outlets", and the pages that list stories never say "sources"
  const words = (html) => html.replace(/<style>[\s\S]*?<\/style>/, ' ').replace(/<[^>]+>/g, ' ');
  for (const [label, html, plainSources] of [['home', read('index.html', edDist), true], ['day', read('day/2026-11-16/index.html', edDist), true], ['almanac', read('almanac/index.html', edDist), true], ['about', about, false]]) {
    assert.ok(!/\boutlets?\b/i.test(words(html)), `${label}: "news sites", not "outlets"`);
    if (plainSources) assert.ok(!/\bsources?\b/i.test(words(html)), `${label}: "news sites", not "sources"`);
  }
});

// ---- phase 8 ---------------------------------------------------------------------------------------------------------------------

test('the Doom Score board is one meter for a screen reader, and its number and its ten squares read the score: 0, 5, 92 and 99', () => {
  for (const [score, filled] of [[0, 0], [5, 1], [92, 9], [99, 10]]) {
    const r = copyRoot(edRoot);
    edit(latestFile(r), (l) => {
      l.score = score;
    });
    edit(dayFile(r, '2026-11-16'), (d) => {
      d.score = score;
    });
    const home = read('index.html', buildAt(r).dist);
    const board = heroOf(home).match(/<div class="board"[\s\S]*?<\/div>/)[0];
    has(board, `<div class="board" role="meter" aria-label="Doom Score" aria-valuenow="${score}" aria-valuemin="0" aria-valuemax="99" aria-valuetext="${score} out of 99">`);
    has(board, '<span class="bl">Doom Score</span>');
    has(board, `<span class="bn">${score}</span>`);
    has(board, '<span class="bt">out of 99. 0 is a quiet day. 99 is the end.</span>');
    // the squares are the picture of the number: hidden from a screen reader, which hears the meter
    const squares = board.match(/<span class="sq" aria-hidden="true">([\s\S]*?)<\/span><span class="bt">/)[1];
    assert.equal(squares, `${'<span class="f"></span>'.repeat(filled)}${'<span></span>'.repeat(10 - filled)}`, `score ${score}: ${filled} solid squares, then outlines, ten in all`);
    // the share text draws the same ten squares: black for what is filled, yellow for what is left
    assert.equal(attr(home, 'data-share-full').split('\n')[2], `Doom Score ${score} ${'⬛'.repeat(filled)}${'🟨'.repeat(10 - filled)}`, `score ${score}: the share text agrees`);
  }
  // an earlier day shows its score the same way, smaller, under its headline
  const home = read('index.html', edDist);
  const yesterday = blocksOf(home)[1];
  has(yesterday, `<p class="ds">Doom Score 11 <span class="sq" aria-hidden="true">${'<span class="f"></span>'.repeat(1)}${'<span></span>'.repeat(9)}</span></p>`);
});

test('the footer: when it was checked, the door to every headline, the pages, who made it, then the lines; Today is a link on every page but the homepage', () => {
  const footerOf = (html) => html.slice(html.indexOf('<footer>'), html.indexOf('</footer>') + '</footer>'.length);
  const linksOf = (foot) => [...foot.matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[1], unesc(m[2])]);
  const every = copy.everyHeadline(stored16.stories.length);
  const credit = ['https://x.com/thelpdrive', '@thelpdrive'];
  const cases = [
    ['homepage', read('index.html', edDist), [[`./day/2026-11-16/#all`, every], ['./almanac/', 'Almanac'], ['./about/', 'About'], ['./feed.xml', 'RSS'], credit]],
    ['day page', read('day/2026-11-15/index.html', edDist), [['../../day/2026-11-16/#all', every], ['../../', 'Today'], ['../../almanac/', 'Almanac'], ['../../about/', 'About'], ['../../feed.xml', 'RSS'], credit]],
    ['almanac', read('almanac/index.html', edDist), [['../day/2026-11-16/#all', every], ['../', 'Today'], ['../almanac/', 'Almanac'], ['../about/', 'About'], ['../feed.xml', 'RSS'], credit]],
    ['about', read('about/index.html', edDist), [['../day/2026-11-16/#all', every], ['../', 'Today'], ['../almanac/', 'Almanac'], ['../about/', 'About'], ['../feed.xml', 'RSS'], credit]],
  ];
  for (const [label, html, links] of cases) {
    const foot = footerOf(html);
    assert.equal((html.match(/<footer>/g) || []).length, 1, `${label}: one footer`);
    assert.deepEqual(linksOf(foot), links, `${label}: the links, in order`);
    // top to bottom: Updated, every headline, the links, the tagline, the three lines
    const at = ['class="up"', 'class="all"', 'class="fl"', 'class="tagline"', ...copy.FOOTER_LINES.map((l) => `<p>${esc(l)}</p>`)].map((m) => foot.indexOf(m));
    assert.ok(at.every((n) => n > 0) && at.every((n, i) => i === 0 || n > at[i - 1]), `${label}: in order ${at}`);
    has(foot, '<p class="up">Updated 5:30 PM ET</p>');
    assert.ok(foot.includes('<a href="https://x.com/thelpdrive" target="_blank" rel="noopener">@thelpdrive</a>'), `${label}: the credit opens in a new tab`);
    assert.ok(!/github|levidruin|drlevidruin/i.test(foot), `${label}: no link to the repository and no name`);
    assert.ok(!/[←→↑↓]/.test(foot), `${label}: no arrow`);
  }
  // quiet: the same links, no tagline, the short lines
  const r = copyRoot(edRoot);
  edit(latestFile(r), (l) => (l.quiet = { ...l.quiet, quiet: true, note: '' }));
  const quiet = footerOf(read('index.html', buildAt(r).dist));
  assert.ok(!quiet.includes('class="tagline"'), 'a quiet footer has no joke');
  for (const line of copy.FOOTER_LINES_QUIET) has(quiet, `<p>${esc(line)}</p>`);
  assert.deepEqual(linksOf(quiet).map((l) => l[1]), [every, 'Almanac', 'About', 'RSS', '@thelpdrive']);
  // a day with no headlines has no door to them
  const empty = withEditions({}, (root2) => {
    edit(latestFile(root2), (l) => {
      l.stories = [];
    });
    edit(dayFile(root2, '2026-11-16'), (d) => {
      d.stories = [];
    });
  });
  const emptyFoot = footerOf(read('index.html', empty.dist));
  assert.ok(!emptyFoot.includes('class="all"'), 'no stories, no "Every headline" link');
  assert.deepEqual(linksOf(emptyFoot).map((l) => l[1]), ['Almanac', 'About', 'RSS', '@thelpdrive']);
});

test('no page scrolls sideways at 320px, with the fonts loaded or not: every wide thing can shrink or wrap, and the page itself clips what a fallback font makes too wide', () => {
  const sheet = sheetOf(read('index.html', edDist));
  // the big word is sized from the screen, wraps rather than runs off, and has a stand-in cut to the width of League Gothic
  has(ruleFor(sheet, '.verdict'), 'font:400 min(31vw,120px)/.8 var(--disp)');
  has(ruleFor(sheet, '.verdict'), 'overflow-wrap:anywhere');
  has(ruleFor(sheet, '.verdict'), 'white-space:normal');
  has(sheet, '--disp:"League Gothic","League Gothic Fit",sans-serif');
  const fit = sheet.match(/@font-face\{font-family:"League Gothic Fit";[^}]*\}/)[0];
  for (const face of ['Arial Bold', 'Arial-BoldMT', 'Helvetica Neue Bold', 'HelveticaNeue-Bold', 'Roboto Bold', 'Liberation Sans Bold']) has(fit, `local("${face}")`);
  has(fit, 'size-adjust:52%');
  assert.ok(!/url\(/.test(fit), 'the stand-in downloads nothing: it is a font the phone already has');
  // a phone narrower than 340px gets a smaller number and tighter squares, so the board never pushes out
  assert.ok(/@media \(max-width:339px\)\{[^@]*\.sq\{gap:3px\}[^@]*\.bn\{font-size:64px\}/.test(sheet), 'the board is smaller on the smallest phones');
  has(ruleFor(sheet, '.board'), 'grid-template-columns:auto minmax(0,1fr)');
  has(ruleFor(sheet, '.bm'), 'min-width:0');
  has(ruleFor(sheet, '.rb'), 'min-width:0');
  has(ruleFor(sheet, '.wrap'), 'width:100%');
  // every kind of long text wraps: the label, the line, the headline, the source, the caption, the headline of a day
  for (const selector of ['.lb', '.ln', '.ht']) has(ruleFor(sheet, selector), 'overflow-wrap:break-word');
  for (const selector of ['.src', '.hs', '.deck', '.dh', '.cap', '.verdict']) has(ruleFor(sheet, selector), 'overflow-wrap:anywhere');
  // and the last guard: the page and its body cut off anything that still sticks out
  has(ruleFor(sheet, 'html'), 'overflow-x:hidden');
  has(ruleFor(sheet, 'body'), 'overflow-x:hidden');
  // nothing is given a width wider than a 320px phone's 280px of room
  const widths = rulesOf(sheet).flatMap((r) => [...r.body.matchAll(/(?:^|;)(?:min-)?width:(\d+)px/g)].map((m) => ({ selector: r.selector, px: Number(m[1]) })));
  assert.deepEqual(widths.filter((w) => w.px > 280), [], 'no fixed width beyond the room a small phone has');
  // the same on the 404, which has its own sheet: the big word wraps there too
  const css = css404(SITE);
  assert.ok(css.includes('overflow-wrap:anywhere') && /html\{[^}]*overflow-x:hidden|body\{[^}]*overflow-x:hidden/.test(css), 'the 404 cannot scroll sideways either');
});

test('our own copy has no arrows: neither font has one, so no page, script or template draws one', () => {
  const ARROW = /[←-⇿⟰-⟿⤀-⥿]/;
  for (const base of [dist, edDist]) {
    for (const rel of ['index.html', 'day/2026-11-16/index.html', 'day/2026-11-15/index.html', 'almanac/index.html', 'about/index.html', '404.html']) assert.ok(!ARROW.test(read(rel, base)), `${rel} has no arrow`);
  }
  // in the code, the one place is the quiet share text, whose change mark a share sheet draws in its own font
  const withArrow = [...authored('scripts', /\.mjs$/), ...authored('assets', /\.js$/)].filter((f) => ARROW.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(REPO, f));
  assert.deepEqual(withArrow, ['scripts/templates/copy.mjs']);
  const copyText = fs.readFileSync(path.join(REPO, 'scripts', 'templates', 'copy.mjs'), 'utf8');
  assert.deepEqual(copyText.split('\n').filter((l) => ARROW.test(l)).map((l) => l.trim()), ['if (n > 0) return `↑${n}`;', 'if (n < 0) return `↓${Math.abs(n)}`;'], 'only the two lines of the change mark');
});
