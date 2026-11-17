// The site: what `npm run build` writes into dist/ from data, checked against
// SPEC sections 8, 9 and 10. Everything runs offline on data made in a temp
// folder. The committed data is only read, never written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { config } from '../scripts/config.mjs';
import { build } from '../scripts/build.mjs';
import { runUpdate } from '../scripts/update.mjs';
import { createServer, resolveStatic, SUBFOLDER } from '../scripts/serve.mjs';
import * as copy from '../scripts/templates/copy.mjs';
import { card } from '../scripts/templates/parts.mjs';
import { CSP } from '../scripts/templates/layout.mjs';
import { esc, num, url } from '../scripts/templates/esc.mjs';
import { capFirst, joinNames } from '../scripts/lib/text.mjs';
import { isUsPlace, quietCard } from '../scripts/lib/quietcards.mjs';
import { fontFileIn, ogSvg, renderPng } from '../scripts/templates/graphics.mjs';
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

const TOKENS = ['undefined', 'NaN', '[object'];
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
  const shapes = new Set();
  for (const text of found) for (const shape of [text, esc(text), xmlEsc(text), JSON.stringify(text).slice(1, -1), url(text)]) if (shape.length >= 3) shapes.add(shape);
  return [...shapes].sort((a, b) => b.length - a.length);
}

const without = (text, strings) => strings.reduce((rest, one) => (rest.includes(one) ? rest.split(one).join(' ') : rest), text);

function isInternal(ref) {
  return ref !== '' && !/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(ref);
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
  for (const need of ['index.html', 'about/index.html', 'almanac/index.html', '404.html', 'feed.xml', 'api/today.json', 'og/latest.png', 'robots.txt', 'sitemap.xml', 'favicon.svg', 'apple-touch-icon.png', 'site.webmanifest', 'assets/app.js', 'assets/anton.woff2']) {
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
      assert.ok(!/github\.com/i.test(text), `${label}: ${rel} links the repository`);
      assert.ok(!/drlevidruin|levidruin/i.test(text), `${label}: ${rel} names a person`);
    }
    if (rel.endsWith('.json') || rel.endsWith('.webmanifest')) JSON.parse(text);
    if (rel.endsWith('.xml')) assert.equal(XMLValidator.validate(text), true, `${label}: ${rel} is valid XML`);
  }

  const sized = (rel) => fs.statSync(files.get(rel)).size;
  assert.ok(sized('index.html') < 100 * 1000, `${label}: index.html is ${sized('index.html')} bytes`);
  assert.ok(sized('assets/app.js') < 15 * 1000, `${label}: app.js is ${sized('assets/app.js')} bytes`);
  assert.ok(sized('assets/anton.woff2') < 50 * 1000, `${label}: the font is ${sized('assets/anton.woff2')} bytes`);

  for (const rel of pages) {
    const raw = fs.readFileSync(files.get(rel), 'utf8');
    const html = ours(raw);
    const where = `${label}: ${rel}`;
    assert.ok(raw.startsWith(`<!doctype html>\n<!-- ${copy.COMMENT} -->\n<html lang="en"`) || rel === '404.html', `${where} opens with the comment`);
    if (rel === '404.html') assert.ok(raw.includes(`<!-- ${copy.COMMENT} -->`), `${where} has the comment`);
    assert.ok(raw.includes(`<meta http-equiv="Content-Security-Policy" content="${esc(CSP)}">`), `${where} has the policy`);
    assert.ok(/<title>[^<]+<\/title>/.test(raw), `${where} has a title`);
    for (const tag of ['og:title', 'og:description', 'og:image', 'og:url']) assert.ok(raw.includes(`property="${tag}"`), `${where} has ${tag}`);
    assert.ok(raw.includes('name="twitter:card" content="summary_large_image"') && raw.includes('name="twitter:image"'), `${where} has the twitter card`);
    const image = raw.match(/property="og:image" content="([^"]+)"/)[1];
    assert.ok(image.startsWith(`${SITE}/og/`) && image.endsWith('.png'), `${where} points the share image at this site`);
    assert.ok(files.has(image.slice(SITE.length + 1)), `${where}: ${image} exists`);

    // nothing runs inline, nothing loads from elsewhere
    const scripts = [...raw.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1]);
    for (const one of scripts) assert.ok(/\ssrc="[^"]*assets\/app\.js"/.test(one) && !/https?:/.test(one), `${where}: only the one local script`);
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

    // every relative reference lands on a file, from the root and from a subfolder
    const pagePath = `/${rel.replace(/index\.html$/, '')}`;
    for (const ref of refsIn(raw).filter(isInternal)) {
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

test('a very busy day stays under 100 KB by leaving the lowest receipts off the page', () => {
  const busy = tmpRoot('dtwet-busy-');
  fs.mkdirSync(path.join(busy, 'data', 'days'), { recursive: true });
  const cats = cfg.categories.map((c) => c.id);
  const stories = Array.from({ length: 100 }, (_, i) => ({
    id: `s${i}`,
    kind: 'news',
    cat: cats[i % cats.length],
    title: `Story number ${i} with a long headline that goes on and on to take up room on the page and then some more`,
    url: `https://news${i}.example.com/${'section/'.repeat(30)}story-${i}?utm_source=${'x'.repeat(60)}`,
    source: `Publisher ${i}`,
    publishedAt: '2026-11-16T20:00:00.000Z',
    firstSeenAt: '2026-11-16T20:00:00.000Z',
    outlets: 3,
    outletNames: ['a', 'b', 'c'],
    score: 100 - i,
  }));
  const latestJson = { ...latest, stories, vital: latest.vital };
  fs.writeFileSync(path.join(busy, 'data', 'latest.json'), JSON.stringify(latestJson));
  fs.writeFileSync(path.join(busy, 'data', 'days', '2026-11-16.json'), JSON.stringify({ date: '2026-11-16', score: latest.score, fired: latest.fired, bumps: [], stories, updatedAt: BUILD_AT }));
  const out = build(busy, { siteUrl: SITE });
  const home = read('index.html', out.dist);
  assert.ok(Buffer.byteLength(home) < 100 * 1000, `index.html is ${Buffer.byteLength(home)} bytes`);
  const shown = (home.match(/<li class="card/g) || []).length;
  assert.ok(shown >= 30 && shown < 100, `${shown} cards shown`);
  assert.ok(home.includes('Story number 0 '), 'the top story stays');
  assert.equal(readJson(path.join(out.dist, 'api', 'today.json')).stories.length, 100, 'the data file keeps every story');
  const small = build(busy, { siteUrl: SITE, pageBudget: 50 * 1000 });
  assert.ok(fs.statSync(path.join(small.dist, 'index.html')).size <= 50 * 1000, 'a smaller budget trims further');
});

// ---- SPEC section 9: the words -------------------------------------------------------------

test('the home page says what section 9 says', () => {
  const home = read('index.html');
  has(home, '<title>Did the world end today? ALMOST.</title>');
  has(home, `<meta name="description" content="${esc(copy.DESCRIPTION)}">`);
  assert.equal(copy.DESCRIPTION, "Live coverage of the end of the world, which keeps not happening. Today's near misses, a 0-99 Doom Score, and the Almanac of Almost. Checked every 15 minutes.");
  assert.match(home, /<span class="q">Did the world end today\?<\/span>/);
  assert.match(home, /<span class="verdict" id="verdict">ALMOST\.<\/span>/);
  assert.match(home, /<p class="line" id="line">Louder than usual\. Still here\.<\/p>/, `score ${latest.score}`);
  assert.equal(copy.subline(latest.score), 'Louder than usual. Still here.');
  has(home, '<p class="tag">Live coverage of the end of the world, which keeps not happening.</p>');
  assert.match(home, /<p class="doom">.*<b class="n">\d+<\/b>/);
  has(home, 'data-act="check">Check again</button>');
  has(home, 'data-act="share">Share</button>');
  has(home, 'Closest call today');
  for (const heading of ['The receipts', 'Doom Bingo', 'Vital signs of civilization', 'The Almanac of Almost']) has(home, heading);
  const order = ['id="hero"', 'id="lead"', 'id="receipts"', 'id="bingo"', 'id="vitals"', 'id="almanac"', '<footer>'].map((m) => home.indexOf(m));
  assert.ok(order.every((n) => n > 0), 'every section is there');
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'in the order the spec gives');
  for (const line of copy.FOOTER_LINES) assert.ok(home.includes(line), line);
  has(home, '<a href="https://x.com/thelpdrive" target="_blank" rel="noopener">@thelpdrive</a>');
  for (const link of ['href="./almanac/">Almanac</a>', 'href="./about/">About</a>', 'href="./feed.xml">RSS</a>']) has(home, link);
  has(home, '<p class="streak" id="streak" data-first="Your first check. Still here." data-template="You&#39;ve checked {n} days running. Still here." hidden></p>');
  assert.ok(!home.includes('Worst day so far'), 'two editions are too few for a record line');
});

test('the subline ladder breaks exactly where the spec says', () => {
  const ladder = [
    [0, 'Suspiciously quiet.'], [19, 'Suspiciously quiet.'],
    [20, 'Routine background apocalypse.'], [39, 'Routine background apocalypse.'],
    [40, 'A normal amount of ending.'], [59, 'A normal amount of ending.'],
    [60, 'Louder than usual. Still here.'], [79, 'Louder than usual. Still here.'],
    [80, 'Not for lack of trying.'], [94, 'Not for lack of trying.'],
    [95, 'Honestly, impressive. Still no.'], [99, 'Honestly, impressive. Still no.'],
  ];
  for (const [score, line] of ladder) assert.equal(copy.subline(score), line, String(score));
  assert.equal(copy.subline('nope'), 'Suspiciously quiet.');
});

test('the share text: the verdict, the ladder line, the date and score, the fired emoji, the day address', () => {
  const fired = ['flights', 'hacks', 'space', 'earth', 'markets', 'grid', 'weather'];
  const want = [
    'Did the world end today? ALMOST.',
    'Louder than usual. Still here.',
    'Nov 16 · Doom 71/99 ↑9',
    '✈️🏦⬛☄️',
    '⬛🌋📉⬛',
    '⚡⬛🌀⬛',
    'didtheworldendtoday.com/day/2026-11-16/',
  ].join('\n');
  assert.equal(copy.shareText({ live: true, date: '2026-11-16', score: 71, change: 9, fired, categories: cfg.categories, host: 'didtheworldendtoday.com' }), want);
  const past = copy.shareText({ live: false, date: '2026-11-15', score: 30, change: -4, fired: [], categories: cfg.categories, host: 'didtheworldendtoday.com' }).split('\n');
  assert.equal(past[0], 'Did the world end on Nov 15? ALMOST.');
  assert.equal(past[1], 'Routine background apocalypse.', 'the ladder line for a score of 30');
  assert.equal(past[2], 'Nov 15 · Doom 30/99 ↓4');
  assert.equal(past[past.length - 1], 'didtheworldendtoday.com/day/2026-11-15/', 'the address ends in a slash');
  assert.equal(copy.shareText({ live: true, date: '2026-11-16', score: 30, change: null, fired: [], categories: cfg.categories, host: 'h', withUrl: false }).split('\n')[2], 'Nov 16 · Doom 30/99');
  const quiet = copy.shareText({ live: true, date: '2026-11-16', score: 71, change: 9, fired, categories: cfg.categories, host: 'h', quiet: true }).split('\n');
  assert.equal(quiet[1], 'Not a day for jokes. Back soon.', 'quiet mode shares the quiet line, not a joke');
  const main = read('index.html');
  const full = attr(main, 'data-share-full').split('\n');
  assert.equal(full.length, 7, 'verdict, ladder line, date and score, three emoji rows, address');
  assert.equal(full[1], copy.subline(latest.score));
  assert.equal(full[2], `Nov 16 · Doom ${latest.score}/99 ↑${latest.change}`);
  assert.equal(full[6], 'didtheworldendtoday.com/day/2026-11-16/');
  assert.equal(attr(main, 'data-share-text').split('\n').length, 6, 'the native share sheet gets the same text without the address');
  assert.equal(attr(main, 'data-share-url'), `${SITE}/day/2026-11-16/`);
});

test('no change, no arrow: a change of zero or no yesterday shows no arrow and no number, on the page and in the share text', () => {
  for (const bad of [0, null, undefined, '', NaN, 'up']) assert.equal(copy.changeText(bad), '', String(bad));
  assert.equal(copy.changeText(9), '↑9');
  assert.equal(copy.changeText(-4), '↓4');
  assert.ok(!copy.shareText({ live: true, date: '2026-11-16', score: 40, change: 0, fired: [], categories: cfg.categories, host: 'h' }).includes('→'));
  assert.equal(copy.shareText({ live: true, date: '2026-11-16', score: 40, change: 0, fired: [], categories: cfg.categories, host: 'h' }).split('\n')[2], 'Nov 16 · Doom 40/99');
  for (const change of [0, null]) {
    const r = copyRoot(root);
    edit(latestFile(r), (l) => (l.change = change));
    const home = read('index.html', build(r, { siteUrl: SITE, config: EARLY }).dist);
    const doom = home.match(/<p class="doom">[\s\S]*?<\/p>/)[0];
    assert.ok(!doom.includes('chg') && !/[↑↓→]/.test(doom), `change ${change}: no arrow in the Doom line`);
    assert.ok(!home.includes('→'), `change ${change}: no arrow anywhere`);
    assert.equal(attr(home, 'data-share-full').split('\n')[2], `Nov 16 · Doom ${latest.score}/99`);
  }
  assert.match(read('index.html').match(/<p class="doom">[\s\S]*?<\/p>/)[0], /<span class="chg">↑\d+<\/span>/, 'a real change still shows');
  const past = read('day/2026-11-15/index.html').match(/<p class="doom">[\s\S]*?<\/p>/)[0];
  assert.ok(!/[↑↓→]/.test(past), 'the first day had no yesterday, so no arrow');
});

test('the Check again lines are the six from the spec, with the real headline count', () => {
  const home = read('index.html');
  const lines = JSON.parse(attr(home, 'data-lines'));
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
});

test('the stale line appears when the newest good read is more than two hours old, and not before', () => {
  const stale = (minutes) => {
    const r = copyRoot(root);
    edit(latestFile(r), (l) => (l.lastSuccessAt = new Date(Date.parse(l.buildTime) - minutes * 60000).toISOString()));
    return read('index.html', build(r, { siteUrl: SITE, config: EARLY }).dist);
  };
  assert.match(stale(210), /<p class="stale" id="stale" data-template="[^"]*">Feeds went quiet 3 hours ago\. Probably us\.<\/p>/);
  assert.match(stale(121), /Feeds went quiet 2 hours ago\. Probably us\./);
  assert.match(stale(120), /<p class="stale" id="stale" data-template="[^"]*" hidden><\/p>/);
  assert.match(read('index.html'), /<p class="stale" id="stale" data-template="[^"]*" hidden><\/p>/);
  assert.equal(copy.staleLine(5), 'Feeds went quiet 5 hours ago. Probably us.');
});

test('quiet mode drops the jokes, the checking theater and the long footer', () => {
  const r = copyRoot(root);
  edit(latestFile(r), (l) => (l.quiet = { ...l.quiet, quiet: true, note: 'Thinking of everyone affected.' }));
  const out = build(r, { siteUrl: SITE, config: EARLY });
  auditSite(out.dist, { label: 'quiet mode' });
  const home = read('index.html', out.dist);
  assert.ok(home.includes('<p class="line" id="line">Not a day for jokes. Back soon.</p>'));
  assert.ok(home.includes('<p class="note">Thinking of everyone affected.</p>'));
  assert.ok(!home.includes(copy.TAGLINE), 'no tagline');
  assert.match(home, /<html lang="en"[^>]*data-quiet="1"/);
  assert.ok(home.includes('Top story today'), 'the lead card is plain "Top story"');
  for (const c of cfg.categories) for (const caption of c.captions) assert.ok(!home.includes(esc(caption)), `no caption: ${caption}`);
  assert.ok(home.includes('No jokes on this one.'), 'quiet cards keep their plain line');
  assert.ok(home.includes(`<meta name="description" content="${esc(copy.QUIET_DESCRIPTION)}">`));
  for (const line of copy.FOOTER_LINES_QUIET) assert.ok(home.includes(line));
  assert.ok(!home.includes('robot with low standards'));
  assert.match(read('index.html'), /data-quiet="0"/);
});

test('quiet cards: a quake that is only big keeps the plain line and gets no donate link', () => {
  const home = read('index.html');
  const quiet = home.split('<li class="card').slice(1).filter((c) => c.includes('No jokes on this one.'));
  assert.ok(quiet.length >= 1, 'the quake is a quiet card');
  for (const c of quiet) {
    for (const k of cfg.categories) for (const caption of k.captions) assert.ok(!c.includes(esc(caption)), 'no category joke on a quiet card');
  }
  const tual = quiet.find((c) => /M 6\.6/.test(c));
  assert.ok(tual, 'the M6.6 quake');
  assert.ok(tual.includes('<p class="cap">No jokes on this one.</p>'), 'the line stands alone');
  assert.ok(!/<a /.test(tual.split('</h3>')[1]), 'no link below the headline');
  assert.ok(!home.includes('redcross.org') && !home.includes('ifrc.org'), 'no donate link anywhere on the page');
});

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

test('quiet cards: the donate link shows for PAGER yellow, orange or red, a tsunami flag, or a disaster word', () => {
  assert.deepEqual(quietCard(quakeStory()), { reason: 'quake M6.5 or more', link: null }, 'green and no tsunami: nothing says anyone was hurt');
  assert.equal(quietCard(quakeStory({}, { pager: undefined })).link, null, 'no PAGER reading reads as green');
  assert.equal(quietCard(quakeStory({}, { pager: null })).link, null);
  for (const pager of ['yellow', 'orange', 'red', 'Orange']) assert.equal(quietCard(quakeStory({}, { pager })).link, 'ifrc', pager);
  assert.equal(quietCard(quakeStory({}, { tsunami: true })).link, 'ifrc', 'a tsunami flag, PAGER green');
  const headline = (title) => ({ id: 'n', cat: 'weather', kind: 'news', title, url: 'https://example.com/n', source: 'Example', quiet: true });
  assert.equal(quietCard(headline('Magnitude 7.1 earthquake strikes off the coast')).link, null, 'a headline magnitude alone is the same as a USGS magnitude alone');
  assert.equal(quietCard(headline('Magnitude 7.1 earthquake prompts tsunami warning')).link, 'redcross');
  for (const title of ['Flash flood warning for the valley', 'Wildfire forces evacuations near town', 'Hurricane makes landfall on the coast', 'Tornado crosses the county']) assert.equal(quietCard(headline(title)).link, 'redcross', title);
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
  assert.equal(quietCard(news('Deadly flood hits a town in Indonesia')).link, 'redcross', 'a news story is not a USGS quake, so it goes to the US Red Cross');
  assert.equal(cfg.quiet.quietLink, 'https://www.redcross.org/donate');
  assert.equal(cfg.quiet.quietLinkIntl, 'https://www.ifrc.org/');
});

test('quiet cards: the page shows the right link, opening safely, for each case', () => {
  const quakeCase = (signal, title) => {
    const r = copyRoot(root);
    const patch = (list) => list.forEach((st) => st.id.startsWith('sig:quake') && Object.assign(st, { title: title || st.title, signal: { ...st.signal, ...signal } }));
    edit(latestFile(r), (l) => patch(l.stories));
    edit(dayFile(r, '2026-11-16'), (d) => patch(d.stories));
    const html = read('index.html', build(r, { siteUrl: SITE, config: EARLY }).dist);
    const card = html.split('<li class="card').slice(1).find((c) => c.includes('data-cat="earth"') && c.includes('No jokes on this one.'));
    assert.ok(card, 'the quake card is there');
    return card;
  };
  const abroad = quakeCase({ pager: 'orange' });
  assert.ok(abroad.includes('<p class="cap">No jokes on this one. <a href="https://www.ifrc.org/" target="_blank" rel="noopener">Support the Red Cross and Red Crescent</a></p>'), 'Tual, Indonesia, PAGER orange');
  const home = quakeCase({ pager: 'yellow', place: '10 km W of Anchorage, Alaska' }, 'M 6.6 - 10 km W of Anchorage, Alaska');
  assert.ok(home.includes('<p class="cap">No jokes on this one. <a href="https://www.redcross.org/donate" target="_blank" rel="noopener">Donate to the Red Cross</a></p>'), 'Anchorage, Alaska, PAGER yellow');
  const wave = quakeCase({ tsunami: true });
  assert.ok(wave.includes('href="https://www.ifrc.org/"'), 'a tsunami flag outside the US');
  assert.ok(quakeCase({ pager: 'green', tsunami: false }).includes('<p class="cap">No jokes on this one.</p>'), 'back to green: no link');
});

test('a category joke never repeats on two cards in a row of the same category', () => {
  const home = read('index.html');
  const seen = new Map();
  for (const c of home.split('<li class="card').slice(1)) {
    const cat = c.match(/data-cat="([^"]+)"/)[1];
    const cap = (c.match(/<p class="cap">([^<]*)<\/p>/) || [])[1];
    if (!cap) continue;
    const k = cfg.categories.find((x) => x.id === cat);
    if (k && k.captions.length > 1) assert.notEqual(seen.get(cat), cap, `${cat}: ${cap}`);
    seen.set(cat, cap);
  }
  assert.ok(seen.size >= 3, 'several categories had a joke');
});

test('Doom Bingo shows the fired categories in grid order, and the math adds up', () => {
  const home = read('index.html');
  const cells = [...home.matchAll(/<li class="cell (on|off)">.*?<small>([^<]+)<\/small>/g)];
  assert.equal(cells.length, 12);
  assert.deepEqual(cells.map((m) => m[2]), cfg.categories.map((c) => c.label));
  assert.deepEqual(cells.filter((m) => m[1] === 'on').map((m) => m[2]), cfg.categories.filter((c) => latest.fired.includes(c.id)).map((c) => c.label));
  const extra = latest.bumps.reduce((s, b) => s + b.points, 0);
  const line = `${latest.fired.length} fired at 6 points each, plus ${extra} from instruments.`;
  assert.ok(home.includes(line), line);
  assert.equal(latest.score, Math.min(99, Math.max(11, latest.fired.length * 6 + extra)));
});

test('the 404 says its line and links home by the site address', () => {
  const html = read('404.html');
  assert.ok(html.includes(`<h1>${esc(copy.NOT_FOUND_LINE)}</h1>`));
  assert.equal(copy.NOT_FOUND_LINE, "This page ended. The world didn't.");
  assert.ok(html.includes(`<a href="${SITE}/">Back to today</a>`));
  assert.ok(!/<script/i.test(html));
  assert.ok(html.includes('name="robots" content="noindex"'));
});

test('the About page has what section 9 lists, and Claude is named plainly, in the credit and in the status tile', () => {
  const about = read('about/index.html');
  for (const needle of [
    'We cover the ways the world almost ends that nobody is doing on purpose.',
    'The Doom Score',
    'Where it comes from',
    'Quiet cards and quiet mode',
    'Headlines and links only. Publishers who want a headline removed: DM <a href="https://x.com/thelpdrive" target="_blank" rel="noopener">@thelpdrive</a> on X.',
    'Built by <a href="https://x.com/thelpdrive" target="_blank" rel="noopener">@thelpdrive</a> with Claude.',
    'Bulletin of the Atomic Scientists',
    'Each fired category is worth 6 points',
    'The floor is 11',
    'The cap is 99',
  ]) assert.ok(about.includes(needle), needle);
  assert.ok(/<a [^>]*>Claude<\/a>/.test(about), 'the status pages we watch are listed with Claude among them');
  const tile = read('index.html').match(/<dt>Internet<\/dt><dd>([\s\S]*?)<\/dd>/)[1];
  assert.equal(tile, '<span class="big">2 of 3 wobbling</span><span class="sm">Cloudflare and Claude</span>', 'the status tile names every page that wobbles, with "and", Claude included');
  assert.ok(!/a popular AI chatbot/i.test(read('index.html') + about), 'no stand-in name');
  for (const rel of ['almanac/index.html', '404.html', 'feed.xml', 'day/2026-11-15/index.html']) assert.ok(!/claude/i.test(read(rel)), `${rel} has no status tile, so it does not say Claude`);
});

test('design tokens: the three colors, Anton for the big type, system fonts for the rest', () => {
  const home = read('index.html');
  for (const c of ['#0B0B0F', '#F2EFE8', '#FF6A00']) assert.ok(home.includes(c), c);
  assert.ok(home.includes('font-family:Anton') && home.includes('system-ui') && home.includes('ui-monospace'));
  assert.ok(home.includes('url(./assets/anton.woff2)'), 'the font is relative to the page');
  assert.ok(read('day/2026-11-16/index.html').includes('url(../../assets/anton.woff2)'));
  assert.ok(!/fonts\.(?:googleapis|gstatic)/.test(home));
});

// ---- the fold, the days, the feed -------------------------------------------------------

test('the fold holds the question, ALMOST., the ladder line, the date and Doom line, and two buttons, in that order', () => {
  const home = read('index.html');
  const hero = home.slice(home.indexOf('<section class="hero"'), home.indexOf('</section>', home.indexOf('<section class="hero"')));
  const marks = ['class="ask"', 'class="q"', 'id="verdict"', 'id="line"', 'class="doom"', 'class="when"', 'class="meter"', 'class="btns"', 'data-act="check"', 'data-act="share"'].map((m) => hero.indexOf(m));
  assert.ok(marks.every((n) => n > 0), String(marks));
  assert.deepEqual(marks, [...marks].sort((a, b) => a - b));
  assert.equal((hero.match(/<button\b/g) || []).length, 2);
  assert.match(hero, /<p class="line" id="line">Louder than usual\. Still here\.<\/p>/, 'the ladder line sits right under ALMOST.');
  assert.ok(hero.indexOf('id="verdict"') < hero.indexOf('id="line"') && hero.indexOf('</h1>') < hero.indexOf('id="line"'), 'under the question and ALMOST.');
  const doom = hero.match(/<p class="doom">[\s\S]*?<\/p>/)[0];
  assert.match(doom, /<span class="when">Mon, Nov 16<\/span>/, 'the date is in the Doom line');
  assert.match(doom, /<span>Doom<\/span> <b class="n">\d+<\/b>/);
  assert.match(doom, /<span class="ago" data-since="[^"]+">checked (?:just now|\d+ min ago)<\/span>/, 'the "checked" part has its own span, so it can drop to its own line on a narrow phone');
  assert.ok(!hero.includes('class="date"'), 'no separate date line');
  assert.ok(home.indexOf('<main') < home.indexOf('<section class="hero"'));
  assert.ok(home.indexOf('</section>', home.indexOf('class="hero"')) < home.indexOf('class="tag"'), 'the tagline comes after the fold');
});

test('day pages: the same page for another day, with a way to the next and previous', () => {
  const old = read('day/2026-11-15/index.html');
  assert.ok(old.includes('<title>Did the world end on November 15, 2026? ALMOST.</title>'));
  assert.ok(old.includes('Did the world end on November 15?'));
  assert.ok(old.includes('<span class="ago">final</span>'));
  assert.ok(old.includes('<a class="btn" href="../../">Today</a>'));
  assert.ok(old.includes('href="../2026-11-16/">Nov 16 &rarr;</a>'));
  assert.ok(old.includes(`${SITE}/og/2026-11-15.png`));
  assert.ok(!old.includes('Vital signs'), 'a past day has no live vital signs');
  const today = read('day/2026-11-16/index.html');
  assert.ok(today.includes('<title>Did the world end on November 16, 2026? ALMOST.</title>'));
  assert.ok(today.includes('href="../2026-11-15/">&larr; Nov 15</a>'));
  assert.ok(today.includes('data-live="1"') && old.includes('data-live="0"'));
  assert.ok(/Doom \d+\/99 on November 15, 2026\./.test(old), 'the description says the day and its score');
});

test('the Almanac lists every day, newest first', () => {
  const html = read('almanac/index.html');
  assert.ok(html.indexOf('day/2026-11-16/') < html.indexOf('day/2026-11-15/'));
  assert.ok(html.includes('The Almanac of Almost'));
  assert.ok(!html.includes('Worst day so far'), 'two editions are too few for a record line');
  assert.ok(!/<script/i.test(html));
});

test('the feed is valid RSS: one item per day with its top stories, links absolute, no repository link', () => {
  const xml = read('feed.xml');
  assert.equal(XMLValidator.validate(xml), true);
  const parsed = new XMLParser().parse(xml);
  const items = [].concat(parsed.rss.channel.item);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.link), [`${SITE}/day/2026-11-16/`, `${SITE}/day/2026-11-15/`]);
  assert.ok(items[0].title.includes('ALMOST.'));
  assert.ok(!/<(?:script|img)\b/i.test(xml.replace(/&lt;/g, '<')) || !xml.includes('onerror'), 'hostile text stays inert in the feed');
  assert.ok(!xml.includes('<img src=x') && !xml.includes('<script>alert'));
});

test('robots, sitemap and manifest', () => {
  assert.equal(read('robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
  const locs = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, [`${SITE}/`, `${SITE}/almanac/`, `${SITE}/about/`, `${SITE}/day/2026-11-16/`, `${SITE}/day/2026-11-15/`]);
  const manifest = readJson(path.join(dist, 'site.webmanifest'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.background_color, '#0B0B0F');
});

// ---- hostile text ------------------------------------------------------------------------

test('a headline that is HTML, with a javascript: link, renders as inert text', () => {
  for (const rel of ['index.html', 'day/2026-11-16/index.html']) {
    const html = read(rel);
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), `${rel}: shown as text`);
    assert.ok(!html.includes('<img src=x'), `${rel}: never as a tag`);
    assert.ok(!html.includes('<script>alert'), `${rel}: no script from a publisher name`);
    assert.ok(!/<[a-z][^>]*\sonerror\s*=/i.test(html) && !/<[a-z][^>]*\sonmouseover\s*=/i.test(html), `${rel}: no handler attribute`);
    assert.ok(!/href="javascript:/i.test(html), `${rel}: no javascript: link`);
    const hostile = html.split('<li class="card').find((c) => c.includes('&lt;img src=x'));
    assert.ok(hostile && !hostile.includes('<a '), `${rel}: the card has no link at all`);
    assert.ok(html.includes('&quot; onmouseover=&quot;alert(3)&quot; x=&quot;'), `${rel}: quotes are escaped`);
    const second = html.split('<li class="card').find((c) => c.includes('onmouseover'));
    assert.ok(!/href="[^"]*"[^>]*"[^>]*>/.test(second.split('</h3>')[0].replace(/href="[^"]*"/, '')), `${rel}: the link cannot break out of its attribute`);
    assert.ok(!second.includes('"><script>'), `${rel}: no break out in the link`);
    assert.ok(second.includes("O&#39;Reilly &amp; &lt;Sons&gt;"), `${rel}: the publisher is escaped`);
  }
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
});

test('a card with a bad link shows its text and no anchor, and a card with missing fields still prints', () => {
  const ctx = { cats: new Map(cfg.categories.map((c) => [c.id, c])), nowMs: Date.parse(BUILD_AT), live: true, quietMode: false, quietCaption: 'q', quietLink: 'https://www.redcross.org/donate', quietLinkIntl: 'https://www.ifrc.org/', used: new Map() };
  const bad = card({ id: 'a', cat: 'internet', title: '<b>hi</b>', url: 'javascript:alert(1)', source: 'S', publishedAt: BUILD_AT }, ctx);
  assert.ok(bad.includes('<h3>&lt;b&gt;hi&lt;/b&gt;</h3>'));
  const bare = card({}, ctx);
  for (const token of ['undefined', 'NaN', '[object']) assert.ok(!bare.includes(token), token);
  const odd = card({ id: 'z', cat: 'zzz', title: 't', url: 'https://example.com', source: 's', publishedAt: 'garbage', outlets: 'x' }, ctx);
  for (const token of ['undefined', 'NaN', '[object']) assert.ok(!odd.includes(token), token);
});

// ---- the record line, one date, and the copy details -------------------------------------

const LONG_RUN = { ...cfg, firstEdition: '2026-11-01' };

// The seeded site has two editions; this one has `count`, the extra days being older ones.
function rootWithEditions(count) {
  const r = copyRoot(root);
  for (let i = 0; i < count - 2; i += 1) {
    const date = `2026-11-${String(14 - i).padStart(2, '0')}`;
    const story = { id: `old${i}`, kind: 'news', cat: 'internet', title: `Cloudflare outage knocks thousands of sites offline, take ${i}`, url: `https://pub0.example/old/${i}`, source: 'Pub A', publishedAt: `${date}T15:00:00.000Z`, firstSeenAt: `${date}T15:00:00.000Z`, outlets: 3, outletNames: PUBS, score: 10 };
    fs.writeFileSync(dayFile(r, date), JSON.stringify({ date, score: 20 + i, fired: ['internet'], bumps: [], change: null, updatedAt: `${date}T23:59:00.000Z`, stories: [story] }));
  }
  return r;
}

test('the record line, "Worst day so far", waits until there are 7 editions', () => {
  for (const [count, shown] of [[2, false], [6, false], [7, true], [9, true]]) {
    const out = build(rootWithEditions(count), { siteUrl: SITE, config: LONG_RUN });
    assert.equal(out.days.length, count);
    for (const rel of ['index.html', 'almanac/index.html']) assert.equal(read(rel, out.dist).includes('Worst day so far'), shown, `${count} editions, ${rel}`);
  }
  const home = read('index.html', build(rootWithEditions(7), { siteUrl: SITE, config: LONG_RUN }).dist);
  assert.ok(home.includes(`Worst day so far: Nov 16, Doom ${latest.score}`));
  const order = ['id="bingo"', 'class="record"', 'id="vitals"'].map((m) => home.indexOf(m));
  assert.ok(order.every((n) => n > 0) && order[0] < order[1] && order[1] < order[2], 'between Doom Bingo and the vital signs');
  assert.equal(copy.recordLine({ date: '2026-11-16', score: 71 }, 6), '');
  assert.equal(copy.recordLine({ date: '2026-11-16', score: 71 }, 7), 'Worst day so far: Nov 16, Doom 71');
  assert.equal(copy.recordLine({ date: '2026-11-16', score: 71 }), '', 'no edition count reads as none');
  assert.equal(copy.RECORD_MIN_EDITIONS, 7);
});

test('one date everywhere: the edition\'s Eastern date, whatever the machine clock or time zone says', () => {
  const was = process.env.TZ;
  try {
    for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Tokyo', 'America/Los_Angeles']) {
      process.env.TZ = tz;
      assert.equal(copy.rowDate('2026-11-16'), 'Mon, Nov 16', tz);
      assert.equal(copy.shortDate('2026-11-16'), 'Nov 16', tz);
      assert.equal(copy.longDate('2026-11-16'), 'November 16, 2026', tz);
    }
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
  // 10:40 pm Eastern on the 16th is already the 17th in UTC; the page still says the 16th.
  const r = copyRoot(root);
  edit(latestFile(r), (l) => {
    l.buildTime = '2026-11-17T03:40:00.000Z';
    l.etDate = '2026-11-16';
  });
  const home = read('index.html', build(r, { siteUrl: SITE, config: EARLY }).dist);
  assert.match(home, /<span class="when">Mon, Nov 16<\/span>/);
  assert.equal(attr(home, 'data-share-full').split('\n')[2].slice(0, 6), 'Nov 16');
  assert.ok(!home.includes('Nov 17'), 'no UTC date on the page');
  // Nothing on the page or in the script reads the visitor's own calendar date.
  assert.ok(!home.includes('data-local'));
  const code = fs.readFileSync(path.join(REPO, 'assets', 'app.js'), 'utf8');
  for (const token of ['localDate', 'toLocaleDateString', 'getDate(', 'getFullYear', 'getMonth', 'data-local']) assert.ok(!code.includes(token), token);
  assert.ok(code.includes("'America/New_York'"), 'the only calendar the script uses is Eastern');
});

test('names are joined with "and", every status page is named plainly, and a note starts its next sentence with a capital', () => {
  assert.equal(joinNames([]), '');
  assert.equal(joinNames(['Cloudflare']), 'Cloudflare');
  assert.equal(joinNames(['Cloudflare', 'Claude']), 'Cloudflare and Claude');
  assert.equal(joinNames(['GitHub', 'Cloudflare', 'Claude']), 'GitHub, Cloudflare, and Claude');
  assert.equal(joinNames([' Zoom ', '', null, 'Reddit']), 'Zoom and Reddit');
  assert.equal(joinNames(undefined), '');
  const every = cfg.statusPages.map((one) => ({ id: one.id, name: one.name, indicator: 'minor', description: 'Minor Service Outage' }));
  assert.ok(every.some((one) => one.name === 'Claude'), 'Claude is one of the pages we watch');
  const r = copyRoot(root);
  edit(latestFile(r), (l) => (l.vital.status = { worst: 'minor', pages: every, unreachable: 0 }));
  const tile = read('index.html', build(r, { siteUrl: SITE, config: EARLY }).dist).match(/<dt>Internet<\/dt><dd>([\s\S]*?)<\/dd>/)[1];
  assert.equal(tile, `<span class="big">${every.length} of ${every.length} wobbling</span><span class="sm">${joinNames(every.map((one) => one.name))}</span>`);
  assert.ok(tile.includes('and Coinbase') && tile.includes('Claude'));
  // The notes under the vital signs: no sentence starts in lower case after a period.
  const home = read('index.html');
  const notes = [...home.slice(home.indexOf('id="vitals"')).matchAll(/<span class="sm">([\s\S]*?)<\/span>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
  assert.ok(notes.length >= 5, `${notes.length} notes`);
  for (const note of notes) assert.ok(!/[.!?]\s+[a-z]/.test(note), `"${note}" starts a sentence in lower case`);
  assert.match(home, /about the size of a bus\. Passes in \d+ hours/);
  assert.match(home, /Tual, Indonesia<\/a>\. \d+ hours? ago/);
});

test('api/today.json is the public copy: the page\'s numbers and stories, and none of the machinery', () => {
  const r = copyRoot(root);
  edit(latestFile(r), (l) => {
    l.quiet = {
      quiet: true,
      why: 'auto',
      note: 'A hard day',
      manual: { quiet: false, note: '', problem: null },
      auto: { checked: true, tripped: true, matches: ['Mass shooting at a mall leaves dozens dead'], headlines: 30 },
      holdUntil: '2026-11-17T04:00:00.000Z',
      reason: 'automatic check',
    };
    l.x = { enabled: true, spentUsd: 0.41, skipped: null };
    l.somethingElse = { internal: 'state' };
  });
  const out = build(r, { siteUrl: SITE, config: EARLY });
  const json = readJson(path.join(out.dist, 'api', 'today.json'));
  assert.deepEqual(json.quiet, { quiet: true, note: 'A hard day' });
  for (const key of ['sources', 'x', 'somethingElse']) assert.ok(!(key in json), `${key} stays private`);
  assert.ok(!JSON.stringify(json).includes('Mass shooting'), 'the headlines that tripped the check are not published');
  assert.equal(json.score, latest.score);
  assert.equal(json.stories.length, readJson(latestFile(r)).stories.length, 'every story is there');
  assert.ok(json.buildTime && json.etDate && Array.isArray(json.fired) && json.vital && json.cats, 'what the page needs is there');
  // the one in the main build, where nothing was planted, has the same shape
  const plain = readJson(path.join(dist, 'api', 'today.json'));
  assert.deepEqual(plain.quiet, { quiet: false, note: '' });
  assert.ok(!('sources' in plain) && !('x' in plain));
});

test('the homepage share image is today\'s own card, and the latest card is still written', () => {
  const home = read('index.html');
  assert.equal(home.match(/property="og:image" content="([^"]+)"/)[1], `${SITE}/og/2026-11-16.png`);
  assert.equal(home.match(/name="twitter:image" content="([^"]+)"/)[1], `${SITE}/og/2026-11-16.png`);
  assert.deepEqual(pngSize(path.join(dist, 'og', '2026-11-16.png')), [1200, 630]);
  assert.deepEqual(pngSize(path.join(dist, 'og', 'latest.png')), [1200, 630]);
  assert.ok(read('day/2026-11-15/index.html').includes(`${SITE}/og/2026-11-15.png`), 'a past day keeps its own card');
  // The first hours after midnight Eastern: no day file yet, and the homepage still has a card of its own.
  const r = copyRoot(root);
  fs.rmSync(dayFile(r, '2026-11-16'));
  const out = build(r, { siteUrl: SITE, config: EARLY });
  assert.ok(read('index.html', out.dist).includes(`${SITE}/og/2026-11-16.png`));
  assert.deepEqual(pngSize(path.join(out.dist, 'og', '2026-11-16.png')), [1200, 630]);
  assert.ok(fs.existsSync(path.join(out.dist, 'og', 'latest.png')));
});

test('the share image carries the line under ALMOST., big enough to read as a phone preview', () => {
  const base = { date: '2026-11-16', score: 62, fired: ['grid'], categories: cfg.categories, host: 'didtheworldendtoday.com' };
  const svg = ogSvg({ ...base, line: copy.subline(62) });
  const at = svg.indexOf('LOUDER THAN USUAL. STILL HERE.');
  assert.ok(at > svg.indexOf('>ALMOST.<') && at < svg.indexOf('NOVEMBER 16, 2026'), 'under ALMOST., above the date');
  assert.match(svg, /<text x="64" y="410" font-family="Anton" font-size="44"[^>]*fill="#F2EFE8">LOUDER THAN USUAL\. STILL HERE\.<\/text>/, 'Anton about 44 px, bone white');
  assert.match(svg, /y="476"[^>]*>NOVEMBER 16, 2026</, 'the date moved down to make room');
  assert.ok(ogSvg({ ...base, line: '<b>&"' }).includes('&lt;B&gt;&amp;&quot;'), 'the line is escaped');
  assert.ok(!ogSvg({ ...base }).includes('font-size="44"'), 'no line, no line text');
  const fontFile = fontFileIn(path.join(REPO, 'assets'));
  const png = (line) => renderPng(ogSvg({ ...base, line }), { fontFile, width: 1200 });
  assert.ok(!png(copy.subline(62)).equals(png('')), 'the picture changes with the line');
  // The build hands the card the same line the page shows: the ladder line, or the quiet line in quiet mode.
  const card = (line) => renderPng(ogSvg({ date: latest.etDate, score: latest.score, fired: latest.fired, categories: cfg.categories, host: 'didtheworldendtoday.com', line }), { fontFile, width: 1200 });
  assert.ok(fs.readFileSync(path.join(dist, 'og', 'latest.png')).equals(card(copy.subline(latest.score))), 'the ladder line');
  assert.ok(fs.readFileSync(path.join(dist, 'og', `${latest.etDate}.png`)).equals(card(copy.subline(latest.score))), "today's own card says the same");
  const r = copyRoot(root);
  edit(latestFile(r), (l) => (l.quiet = { ...l.quiet, quiet: true, note: '' }));
  const quiet = build(r, { siteUrl: SITE, config: EARLY });
  assert.ok(fs.readFileSync(path.join(quiet.dist, 'og', 'latest.png')).equals(card(copy.QUIET_LINE)), 'the quiet line');
});

// ---- the page script ---------------------------------------------------------------------

// The page script loaded outside a browser. `globals` stands in for what a browser would give it.
function pageScript(globals = {}) {
  const sandbox = { module: { exports: {} }, ...globals };
  vm.runInNewContext(fs.readFileSync(path.join(REPO, 'assets', 'app.js'), 'utf8'), sandbox);
  return sandbox.module.exports;
}

test('page script: relative times read exactly as the server writes them', () => {
  const { ago } = pageScript();
  for (const ms of [0, 1, 999, 59000, 60000, 61000, 119000, 3599000, 3600000, 7199000, 7200000, 86399000, 86400000, 172800000, 5 * 86400000, -5, NaN, undefined]) assert.equal(ago(ms), copy.ago(ms), String(ms));
  assert.equal(ago(14 * 60000), '14 min ago');
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

test('page script: the streak line says "first check" once and "N days running" after, and the share text gains "Checked N days running."', () => {
  const { streakLine, withStreak } = pageScript();
  assert.equal(streakLine(1, copy.STREAK_FIRST, copy.STREAK_TEMPLATE), 'Your first check. Still here.');
  assert.equal(streakLine(0, copy.STREAK_FIRST, copy.STREAK_TEMPLATE), 'Your first check. Still here.');
  assert.equal(streakLine(2, copy.STREAK_FIRST, copy.STREAK_TEMPLATE), "You've checked 2 days running. Still here.");
  assert.equal(streakLine(31, copy.STREAK_FIRST, copy.STREAK_TEMPLATE), "You've checked 31 days running. Still here.");
  const body = ['Did the world end today? ALMOST.', 'Louder than usual. Still here.', 'Nov 17 · Doom 74/99', '✈️🏦⬛☄️', '⬛🌋📉⬛', '⚡⬛🌀⬛', 'didtheworldendtoday.com/day/2026-11-17/'];
  const text = body.join('\n');
  for (const n of [1, 0, NaN, undefined]) assert.equal(withStreak(text, n), text, `a streak of ${n} adds nothing`);
  assert.deepEqual(withStreak(text, 2).split('\n'), [...body.slice(0, -1), 'Checked 2 days running.', body[body.length - 1]], 'above the address');
  assert.equal(withStreak(body.slice(0, -1).join('\n'), 5).split('\n').pop(), 'Checked 5 days running.', 'with no address the line goes last');
  assert.equal(withStreak('', 3), 'Checked 3 days running.');
});

test('page script: a failed share falls back to copying, unless the person closed the share sheet', () => {
  const { shouldCopyAfterShareError } = pageScript();
  assert.equal(shouldCopyAfterShareError({ name: 'AbortError' }), false);
  for (const err of [{ name: 'NotAllowedError' }, { name: 'TypeError' }, new Error('no'), null, undefined, 'text']) assert.equal(shouldCopyAfterShareError(err), true, String(err));
  const code = fs.readFileSync(path.join(REPO, 'assets', 'app.js'), 'utf8');
  assert.ok(code.includes('if (shouldCopyAfterShareError(err)) copy();'), 'the share call uses it');
});

test('page script: a request gives up after 8 seconds, so Check again never stays disabled', async () => {
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

test('page script: it reads the page it needs and nothing else', () => {
  const code = fs.readFileSync(path.join(REPO, 'assets', 'app.js'), 'utf8');
  assert.ok(Buffer.byteLength(code) < 15 * 1000);
  assert.ok(code.includes("'api/today.json?t='"), 'asks for fresh data by the minute');
  assert.ok(code.includes('navigator.share') && code.includes('clipboard') && code.includes('localStorage') && code.includes('prefers-reduced-motion'));
  assert.ok(code.includes('New near misses. Tap to refresh.'));
  assert.ok(code.includes('5 * MIN'), 'polls every five minutes');
  assert.ok(!/https?:\/\//.test(code.replace(/\/\/ .*$/gm, '')), 'no address is called but our own');
  for (const token of ['eval(', 'new Function', 'document.write', 'innerHTML = ']) assert.ok(!code.includes(token) || token === 'innerHTML = ', token);
});

// ---- the local server -----------------------------------------------------------------------

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
    assert.equal((await ask('/assets/anton.woff2')).headers['content-type'], 'font/woff2');
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

test('the package has the four scripts the README names', () => {
  const pkg = readJson(path.join(REPO, 'package.json'));
  assert.equal(pkg.scripts.serve, 'node scripts/serve.mjs');
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  for (const needle of ['npm run update', 'npm run build', 'npm run serve', 'npm test', 'quiet.json', 'X_BEARER_TOKEN', 'X_DAILY_BUDGET_USD', '@thelpdrive', 'didtheworldendtoday.com', 'Settings']) assert.ok(readme.includes(needle), needle);
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
