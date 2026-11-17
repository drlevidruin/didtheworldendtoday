// The site: what `npm run build` writes into dist/ from data and editions, checked
// against SPEC sections 8, 9 and 10 and the day-by-day design. Everything runs
// offline on data made in a temp folder. The committed data is only read, never written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { config } from '../scripts/config.mjs';
import { build, publicCopy } from '../scripts/build.mjs';
import { runUpdate } from '../scripts/update.mjs';
import { createServer, resolveStatic, SUBFOLDER } from '../scripts/serve.mjs';
import * as copy from '../scripts/templates/copy.mjs';
import { almanacRows, headline as headlineRow, headlines as headlineRows, row as dayRow, rows as dayRows } from '../scripts/templates/parts.mjs';
import { CSP } from '../scripts/templates/layout.mjs';
import { esc, num, url } from '../scripts/templates/esc.mjs';
import { capFirst, joinNames } from '../scripts/lib/text.mjs';
import { isUsPlace, quietCard } from '../scripts/lib/quietcards.mjs';
import { validateEdition } from '../scripts/lib/editions.mjs';
import { createGatekeeper } from '../scripts/lib/pipeline.mjs';
import { fitHeadline, fontFileIn, ogSvg, renderPng } from '../scripts/templates/graphics.mjs';
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
// Words and hooks of features that were cut. They are ours, so no page may say them.
const CUT_WORDS = ['Doom Bingo', 'Vital signs', 'The receipts', 'Check again', 'Closest call today', 'Your first check'];
const CUT_HOOKS = ['id="bingo"', 'id="vitals"', 'id="receipts"', 'id="lead"', 'id="almanac"', 'id="streak"', 'class="card', 'class="cell', 'class="btns"', 'class="chips"', 'class="chip'];
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
    for (const word of CUT_WORDS) assert.ok(!html.includes(word), `${where} still says "${word}"`);
    for (const hook of CUT_HOOKS) assert.ok(!raw.includes(hook), `${where} still has ${hook}`);
    // "chip" is a word a publisher's headline can use, so only a build of text we wrote is held to it
    if (!live) assert.ok(!/\bchips?\b/i.test(raw), `${where} mentions a chip`);
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
    headline: 'Check again tomorrow. Still here.',
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
  assert.ok(home.includes('Check again tomorrow. Still here.'), 'and its headline');
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
  assert.ok(home.includes(`Plus ${200 - cfg.edition.fallbackRows} more headlines`), 'and says how many it left to the day page');
  const day = read('day/2026-11-16/index.html', out.dist);
  assert.ok(Buffer.byteLength(day) < 100 * 1000, `the day page is ${Buffer.byteLength(day)} bytes`);
  const shown = (day.match(/<li class="hd/g) || []).length;
  assert.ok(shown >= 30 && shown < 200, `${shown} headlines shown`);
  assert.ok(day.includes('Story number 0 '), 'the top story stays');
  assert.equal(readJson(path.join(out.dist, 'api', 'today.json')).stories.length, 200, 'the data file keeps every story');
  const small = build(busy, { siteUrl: SITE, config: EARLY, pageBudget: 50 * 1000 });
  assert.ok(fs.statSync(path.join(small.dist, 'day', '2026-11-16', 'index.html')).size <= 50 * 1000, 'a smaller budget trims the day page further');
  assert.ok(fs.statSync(path.join(small.dist, 'index.html')).size <= 50 * 1000, 'and the homepage stays inside it');
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
const itemOf = (s, emoji, line, over = {}) => ({ emoji, line, ids: [s.id], quiet: false, cat: s.cat, title: s.title, url: s.url, source: s.source, outlets: s.outlets, ...over });

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
  headline: 'Planes stopped, apps blinked, a rock waved. Still here.',
  items: [
    itemOf(AIRLINES, '✈️', 'Airlines are digging out after a nationwide ground stop. Your bag is probably fine.'),
    itemOf(AWS, '🖥️', 'A big AWS outage knocked a bunch of your favorite apps offline for a while.'),
    itemOf(BREACH, '🔓', 'A retailer lost millions of customer records. Good day to change a password.'),
    itemOf(NASDAQ, '📉', 'Trading got halted as the Nasdaq slid. It usually comes back.'),
    itemOf(ROCK, '☄️', "An asteroid the size of a bus passed us at a third of the moon's distance. It kept going."),
    itemOf(QUAKE, '🌋', 'A magnitude 6.6 quake hit near Tual, Indonesia.'),
  ],
};
const ED15 = {
  date: '2026-11-15',
  by: 'hand',
  writtenAt: '2026-11-16T04:00:00.000Z',
  headline: 'The grid blinked three times. Still here.',
  items: [
    itemOf(SUBSTATION, '⚡', 'A substation failed and a whole city lost power for a while.'),
    itemOf(FIFTY, '🔌', 'Fifty thousand customers sat in the dark. The lights came back.'),
    itemOf(ROLLING, '🌡️', 'Demand spiked and the regional grid rolled some blackouts. Nobody panicked.'),
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
    tag: get(/<p class="tag">([^<]*)<\/p>/),
    emoji: get(/<span class="em" aria-hidden="true">([^<]*)<\/span>/),
    text: get(/<p class="txt">([^<]*)<\/p>/),
    cap: get(/<p class="cap">([\s\S]*?)<\/p>/),
    href: get(/<p class="read"><a href="([^"]*)"/),
    read: get(/<p class="read">(?:<a [^>]*>)?([^<]*)(?:<\/a>)?<\/p>/),
  };
}
const factsIn = (html) => rowsOf(html).map(rowFacts);
const headlineOf = (html) => unesc((heroOf(html).match(/<p class="hl [^"]*">([^<]*)<\/p>/) || [])[1] || '');
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
  assert.equal(ED16.items.length, cfg.edition.maxItems, 'the closest call and five more');
  // The two builds really differ: one reads the editions, one reads the plain headlines.
  assert.equal(headlineOf(read('index.html', edDist)), ED16.headline);
  assert.equal(headlineOf(read('index.html')), copy.subline(latest.score));
});

// ---- the homepage ------------------------------------------------------------------------------------

test('the homepage reads top to bottom: the question, ALMOST., the headline, the score, one button, today, yesterday, the end, the footer', () => {
  for (const [label, base, head] of [
    ['editions', edDist, ED16.headline],
    ['plain headlines', dist, copy.subline(latest.score)],
  ]) {
    const home = read('index.html', base);
    const marks = ['<main', 'class="hero"', 'class="q"', 'id="verdict"', 'class="hl ', 'class="doom"', 'class="meter"', 'class="go"', 'class="sh"', 'id="today"', '<span class="hot">TODAY</span>', '<span>YESTERDAY</span>', 'class="end"', '<footer>'].map((m) => home.indexOf(m));
    assert.ok(marks.every((n) => n > 0), `${label}: ${marks}`);
    assert.deepEqual(marks, [...marks].sort((a, b) => a - b), `${label}: in this order`);
    const hero = heroOf(home);
    assert.match(hero, /<span class="q">Did the world end today\?<\/span>/);
    assert.match(hero, /<span class="verdict" id="verdict">ALMOST\.<\/span>/);
    has(hero, `<p class="hl ${copy.headlineClass(head)}">${esc(head)}</p>`);
    assert.ok(hero.indexOf('id="verdict"') < hero.indexOf('class="hl '), `${label}: under ALMOST.`);
    const doom = hero.match(/<p class="doom">[\s\S]*?<\/p>/)[0];
    assert.match(doom, /<span class="when">Mon, Nov 16<\/span>/, `${label}: the date`);
    assert.match(doom, new RegExp(`Doom Score <b class="n">${latest.score}</b> of 99`), `${label}: the score`);
    assert.match(doom, /<span class="ago" data-since="[^"]+">checked (?:just now|\d+ min ago)<\/span>/, `${label}: when it was checked`);
    assert.ok(!/[↑↓→]/.test(doom), `${label}: no arrow in the Doom line`);
    assert.ok(hero.includes(`<progress class="meter" max="99" value="${latest.score}"`), `${label}: the meter`);
    assert.ok(!hero.includes(copy.TAGLINE), `${label}: the tagline is for the footer`);
    // one obvious button: a link to today, and "Share today" is plain text under it
    assert.equal((home.match(/class="go"/g) || []).length, 1, `${label}: one big button`);
    assert.match(hero, /<a class="go" href="#today">See what almost got us ↓<\/a>/);
    assert.equal((home.match(/id="today"/g) || []).length, 1, `${label}: and its target exists once`);
    assert.match(hero, /<button class="sh" type="button" data-act="share">Share today<\/button>/);
    assert.equal((hero.match(/<button\b/g) || []).length, 2, `${label}: ALMOST. replays the check, Share today shares`);
    assert.ok(!hero.includes('class="btns"'), `${label}: no row of buttons`);
    // the footer closes it
    assert.ok(home.indexOf('<p class="tagline">') > home.indexOf('<footer>'), `${label}: the tagline is in the footer`);
    for (const line of copy.FOOTER_LINES) assert.ok(home.includes(line), `${label}: ${line}`);
    // the words themselves, not only whatever the constant says
    for (const line of ['Checked every 15 minutes by a robot with low standards.', 'Headlines belong to their publishers. The dread is ours.', 'Satire. Not financial, medical, or end-of-the-world advice.']) has(home, `<p>${line}</p>`);
    has(home, '<a href="https://x.com/thelpdrive" target="_blank" rel="noopener">@thelpdrive</a>');
    for (const link of ['href="./about/">About</a>', 'href="./feed.xml">RSS</a>']) has(home, link);
  }
  // the one filled orange control is the big button
  const css = read('index.html', edDist).match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /\.go\{[^}]*background:var\(--hot\)/, 'the big button is orange');
  for (const small of ['.btn', '.sh']) assert.ok(!new RegExp(`\\${small}\\{[^}]*background:var\\(--hot\\)`).test(css), `${small} is not orange`);
});

test('today and yesterday are day blocks: a label, the rows, a way to the day, and a share button', () => {
  for (const [label, base] of [['editions', edDist], ['plain headlines', dist]]) {
    const [today, yesterday, ...more] = blocksOf(read('index.html', base));
    assert.equal(more.length, 0, `${label}: two days, two blocks`);
    // today
    assert.match(today, /^<section class="day" id="today" data-share-text=/);
    has(today, '<h2 class="dl"><span class="hot">TODAY</span><span> &middot; MONDAY, NOV 16</span></h2>');
    assert.ok(!today.includes('class="dh"') && !today.includes('class="ds"'), `${label}: today's headline and score are already in the hero`);
    // yesterday
    assert.match(yesterday, /^<section class="day" data-share-text=/);
    has(yesterday, '<h2 class="dl"><span>YESTERDAY</span><span> &middot; SUNDAY, NOV 15</span></h2>');
    assert.ok(!yesterday.includes('id="today"'));
    has(yesterday, '<p class="ds">Doom Score 11 of 99</p>');
    // each ends with the same share button
    for (const block of [today, yesterday]) {
      has(block, '<button class="btn" type="button" data-act="share">Share this day</button>');
      assert.ok(block.indexOf('class="rows"') < block.indexOf('class="df"'), `${label}: the rows come before the footer of the block`);
    }
    // the first row of a block is the closest call, and only the first
    for (const block of [today, yesterday]) {
      const facts = rowsOf(block).map(rowFacts);
      assert.ok(facts.length >= 2, `${label}: ${facts.length} rows`);
      assert.deepEqual(facts.map((f) => f.best), facts.map((_, i) => i === 0), `${label}: only the first row is best`);
      assert.deepEqual(facts.map((f) => f.tag).filter(Boolean), ['CLOSEST CALL'], `${label}: one tag`);
      assert.equal(facts[0].tag, 'CLOSEST CALL');
    }
  }
});

test('an edition is what its day says: the headline, the lines in order, the emoji, and one link to the story behind each', () => {
  const home = read('index.html', edDist);
  const [today, yesterday] = blocksOf(home);
  assert.ok(!yesterday.includes(`<p class="dh">${esc(ED16.headline)}</p>`), "today's headline is the hero's, not repeated");
  has(yesterday, `<p class="dh">${esc(ED15.headline)}</p>`);
  for (const [block, ed] of [[today, ED16], [yesterday, ED15]]) {
    const facts = rowsOf(block).map(rowFacts);
    assert.deepEqual(facts.map((f) => f.text), ed.items.map((i) => i.line), `${ed.date}: every line, in the order the edition gave`);
    assert.deepEqual(facts.map((f) => f.emoji), ed.items.map((i) => i.emoji));
    facts.forEach((f, i) => {
      assert.equal(f.href, ed.items[i].url, `${ed.date} row ${i}: its own story`);
      assert.equal(f.read, copy.readText(ed.items[i].outlets, ed.items[i].source), `${ed.date} row ${i}: what the link says`);
    });
    for (const m of block.matchAll(/<p class="read"><a ([^>]*)>/g)) assert.match(m[1], /target="_blank" rel="noopener"/);
  }
  // the lines are ours: no joke is added, no headline is swapped in
  assert.ok(!today.includes(esc(AIRLINES.title)), "the edition's line stands in for the publisher's headline");
  // "Plus N more": the day's stories minus the rows shown, and nothing at all when that is zero
  const more = stored16.stories.length - ED16.items.length;
  assert.ok(more > 0);
  has(today, `<a class="plus" href="./day/2026-11-16/">Plus ${more} more ${wordOf(more)} we read so you don&#39;t have to →</a>`);
  assert.equal(stored15.stories.length, ED15.items.length, 'yesterday: three stories, three lines');
  assert.ok(!yesterday.includes('class="plus"'), 'nothing left to read, so no link');
});

test('a day with no edition shows its plain headlines: up to five, two a category at most, each as its publisher wrote it', () => {
  const home = read('index.html');
  const [today, yesterday] = blocksOf(home);
  const facts = rowsOf(today).map(rowFacts);
  assert.equal(facts.length, cfg.edition.fallbackRows, 'five rows');
  const catOf = new Map(stored16.stories.map((s) => [s.title, s.cat]));
  const per = new Map();
  for (const f of facts) {
    assert.ok(catOf.has(f.text), `"${f.text}" is one of the day's own headlines`);
    per.set(catOf.get(f.text), (per.get(catOf.get(f.text)) || 0) + 1);
  }
  assert.ok([...per.values()].every((n) => n <= cfg.edition.fallbackPerCategory), `no category twice over: ${[...per]}`);
  assert.ok(facts.every((f) => /^[^\s]/.test(f.emoji || '')), 'each row has an emoji');
  assert.equal(facts[0].tag, 'CLOSEST CALL');
  assert.deepEqual(factsIn(yesterday).map((f) => f.text), ['Blackout hits city after substation failure', 'Power outage leaves 50,000 customers in the dark'], 'two grid stories at most, in the usual order');
  has(yesterday, '<a class="plus" href="./day/2026-11-15/">Plus 1 more headline we read so you don&#39;t have to →</a>');
  assert.ok(home.includes(`<p class="dh">${copy.subline(11)}</p>`), "yesterday's headline is the ladder line for its score");
  // no joke anywhere: the only caption on the page is the plain line of a quiet story
  const captions = [...home.matchAll(/<p class="cap">([^<]*)/g)].map((m) => m[1]);
  assert.ok(captions.length >= 1 && captions.every((c) => c.startsWith('No jokes on this one.')), `captions: ${captions}`);
});

test('an edition that breaks a rule is not used: its day shows plain headlines and the other days are untouched', () => {
  const homeOf = (editions) => withEditions(editions).dist;
  const bad = (change) => ({ ...ED16, ...change });
  const plainRows = factsIn(blocksOf(read('index.html'))[0]).map((f) => f.text);
  const cases = {
    'no "Still here." at the end': bad({ headline: 'Planes stopped, apps blinked, a rock waved.' }),
    'a headline with a dash in it': bad({ headline: `Planes stopped ${EM} apps blinked. Still here.` }),
    'a headline with an exclamation mark': bad({ headline: 'Planes stopped, apps blinked! Still here.' }),
    'a headline that is too long': bad({ headline: `${'Everything is fine and nothing is wrong at all today '.repeat(2)}Still here.` }),
    'only two usable lines': bad({ items: ED16.items.slice(0, 2) }),
    'the wrong date': bad({ date: '2026-11-17' }),
    'no items': bad({ items: 'six' }),
    'every link bad': bad({ items: ED16.items.map((i) => ({ ...i, url: 'javascript:alert(1)' })) }),
    'lines with a semicolon': bad({ items: ED16.items.map((i) => ({ ...i, line: `${i.line.replace('.', ';')}` })) }),
  };
  for (const [name, raw] of Object.entries(cases)) {
    const dist16 = homeOf({ ...EDITIONS, '2026-11-16': raw });
    const home = read('index.html', dist16);
    assert.equal(headlineOf(home), copy.subline(latest.score), `${name}: the ladder line stands in`);
    assert.deepEqual(factsIn(blocksOf(home)[0]).map((f) => f.text), plainRows, `${name}: the plain headlines stand in`);
    has(blocksOf(home)[1], `<p class="dh">${esc(ED15.headline)}</p>`);
    assert.ok(!home.includes(ED16.items[0].line), `${name}: none of the lines`);
  }
  // a file that is not JSON at all counts as no edition
  const junk = withEditions({ ...EDITIONS, '2026-11-16': '{"headline": "Oops. Still here.", ' });
  assert.equal(headlineOf(read('index.html', junk.dist)), copy.subline(latest.score));
  auditSite(junk.dist, { label: 'broken edition file' });
});

test('one bad line is dropped and the rest stay: the closest call is then the first line that is left', () => {
  const bad = { ...ED16, items: ED16.items.map((i, n) => (n === 0 ? { ...i, line: 'Airlines are back! Mostly.' } : i)) };
  const { dist: out } = withEditions({ ...EDITIONS, '2026-11-16': bad });
  const home = read('index.html', out);
  assert.equal(headlineOf(home), ED16.headline, 'the edition still stands');
  const facts = factsIn(blocksOf(home)[0]);
  assert.deepEqual(facts.map((f) => f.text), ED16.items.slice(1).map((i) => i.line));
  assert.equal(facts[0].tag, 'CLOSEST CALL');
  assert.deepEqual(facts.map((f) => f.best), [true, false, false, false, false]);
  has(blocksOf(home)[0], `Plus ${stored16.stories.length - 5} more headlines`);
});

// ---- a story is told once -----------------------------------------------------------------------------
//
// A story can sit in two days' files, because the pipeline keeps the last three days in view.
// Once an earlier day's edition has told it, no later edition and no later plain headline tells it again.

const SHARED = { id: 'shared:1', kind: 'news', cat: 'internet', title: 'Slack outage drags on past midnight for thousands of users', url: 'https://pub0.example/shared/1', source: 'Pub A', publishedAt: '2026-11-15T23:30:00.000Z', firstSeenAt: '2026-11-15T23:30:00.000Z', outlets: 3, outletNames: PUBS, score: 50 };
const SHARED_15 = 'Slack went down late Sunday and was still wobbling at midnight.';
const SHARED_16 = 'Slack was still down on Monday morning.';
const ED15_SHARED = { ...ED15, items: [...ED15.items, itemOf(SHARED, '💬', SHARED_15)] };
const ED16_SHARED = { ...ED16, items: [ED16.items[0], itemOf(SHARED, '💬', SHARED_16), ...ED16.items.slice(1)] };

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
  assert.deepEqual(factsIn(yesterday).map((f) => f.text), [...ED15.items.map((i) => i.line), SHARED_15], 'the 15th tells it');
  assert.deepEqual(factsIn(today).map((f) => f.text), ED16.items.map((i) => i.line), 'the 16th does not');
  assert.equal(headlineOf(home), ED16.headline, 'and its edition still stands');
  assert.ok(!home.includes(SHARED_16));
  const day16 = read('day/2026-11-16/index.html', both);
  assert.ok(!rowsOf(day16).some((r) => r.includes(SHARED_16)), 'not in the day page rows either');
  assert.ok(headsOf(day16).some((h) => h.includes(esc(SHARED.title))), 'but "every headline we read that day" still lists it');

  // The 15th tells it and the 16th has no edition: the plain headlines skip it, though it is the day's biggest story.
  const plain16 = sharedSite({ '2026-11-15': ED15_SHARED });
  const plain = factsIn(blocksOf(read('index.html', plain16))[0]).map((f) => f.text);
  assert.ok(plain.length === cfg.edition.fallbackRows && !plain.includes(SHARED.title), `plain headlines: ${plain}`);
  assert.ok(headsOf(read('day/2026-11-16/index.html', plain16)).some((h) => h.includes(esc(SHARED.title))), 'still on the day page list');

  // An earlier day with no usable edition told nothing, so the story is still free the next day.
  const free = sharedSite({ '2026-11-15': { ...ED15_SHARED, headline: 'The grid blinked three times.' } });
  const first = factsIn(blocksOf(read('index.html', free))[0])[0];
  assert.equal(first.text, SHARED.title, 'its own score makes it the first plain headline');
});

test('a day shows a story once: a second line about an id an earlier line took is dropped', () => {
  const twice = { ...ED16, items: [ED16.items[0], itemOf(AIRLINES, '🧳', 'Same story, second line.'), ...ED16.items.slice(1)] };
  const { dist: out } = withEditions({ ...EDITIONS, '2026-11-16': twice });
  const facts = factsIn(blocksOf(read('index.html', out))[0]);
  assert.deepEqual(facts.map((f) => f.text), ED16.items.map((i) => i.line));
});

// ---- the words that went with the cut features -----------------------------------------------------------

test('no page says chip, Doom Bingo, Vital signs, The receipts or Check again, and none has the markup that went with them', () => {
  const pages = (base) => [...listDist(base).keys()].filter((r) => r.endsWith('.html'));
  for (const [label, base] of [['plain headlines', dist], ['editions', edDist]]) {
    assert.ok(pages(base).length >= 6, label);
    for (const rel of pages(base)) {
      const raw = read(rel, base);
      for (const word of ['Doom Bingo', 'Vital signs', 'The receipts', 'Check again', 'Closest call today']) assert.ok(!raw.includes(word), `${label} ${rel}: ${word}`);
      assert.ok(!/\bchips?\b/i.test(raw), `${label} ${rel}: chip`);
      for (const hook of ['id="bingo"', 'id="vitals"', 'id="receipts"', 'id="lead"', 'class="cell', 'class="card', 'class="chip', 'class="btns"']) assert.ok(!raw.includes(hook), `${label} ${rel}: ${hook}`);
    }
  }
  const code = read('assets/app.js');
  for (const word of ['Check again', 'bingo', 'vitals', 'receipts', 'streak-line']) assert.ok(!code.includes(word), `app.js: ${word}`);
});

// ---- the share text -----------------------------------------------------------------------------------------

test('the share text is the verdict, the day\'s headline, its emoji, the date and score, and the day address', () => {
  const home = read('index.html', edDist);
  const full = attr(home, 'data-share-full').split('\n');
  assert.deepEqual(full, [
    'Did the world end today? ALMOST.',
    ED16.headline,
    ED16.items.map((i) => i.emoji).join(''),
    `Nov 16 · Doom ${latest.score}/99`,
    'didtheworldendtoday.com/day/2026-11-16/',
  ]);
  assert.deepEqual(attr(home, 'data-share-text').split('\n'), full.slice(0, -1), 'the share sheet gets the same text and takes the link on its own');
  assert.equal(attr(home, 'data-share-url'), `${SITE}/day/2026-11-16/`);
  const [today, yesterday] = blocksOf(home);
  assert.equal(attr(today, 'data-share-full'), attr(home, 'data-share-full'), 'today\'s block shares what the hero shares');
  assert.deepEqual(attr(yesterday, 'data-share-full').split('\n'), ['Did the world end on Nov 15? ALMOST.', ED15.headline, ED15.items.map((i) => i.emoji).join(''), 'Nov 15 · Doom 11/99', 'didtheworldendtoday.com/day/2026-11-15/']);
  assert.equal(attr(yesterday, 'data-share-url'), `${SITE}/day/2026-11-15/`);
  // a day page shares its own day
  assert.equal(attr(read('day/2026-11-15/index.html', edDist), 'data-share-full'), attr(yesterday, 'data-share-full'));
  // plain headlines share the ladder line and the category emoji
  const plain = attr(read('index.html'), 'data-share-full').split('\n');
  assert.equal(plain.length, 5);
  assert.equal(plain[1], copy.subline(latest.score));
  assert.equal(plain[2], factsIn(blocksOf(read('index.html'))[0]).map((f) => f.emoji).join(''));
  assert.equal(plain[3], `Nov 16 · Doom ${latest.score}/99`);
  // nothing the page prints for a person differs from what a share carries
  assert.ok(!full.some((line) => /[↑↓→]/.test(line)), 'no arrow in a share of a normal day');
});

test('shareText: today, a past day, no headline, no emoji, and the quiet text with its grid', () => {
  const fired = ['flights', 'hacks', 'space', 'earth', 'markets', 'grid', 'weather'];
  const base = { score: 71, change: 9, fired, categories: cfg.categories, host: 'didtheworldendtoday.com', headline: 'Planes stopped. Apps blinked. Still here.', emojis: ['✈️', '🖥️', '🌋'] };
  assert.equal(
    copy.shareText({ ...base, live: true, date: '2026-11-16' }),
    ['Did the world end today? ALMOST.', 'Planes stopped. Apps blinked. Still here.', '✈️🖥️🌋', 'Nov 16 · Doom 71/99', 'didtheworldendtoday.com/day/2026-11-16/'].join('\n'),
  );
  const past = copy.shareText({ ...base, live: false, date: '2026-11-15', score: 30, change: -4 }).split('\n');
  assert.deepEqual(past, ['Did the world end on Nov 15? ALMOST.', 'Planes stopped. Apps blinked. Still here.', '✈️🖥️🌋', 'Nov 15 · Doom 30/99', 'didtheworldendtoday.com/day/2026-11-15/']);
  assert.equal(copy.shareText({ ...base, live: true, date: '2026-11-16', withUrl: false }).split('\n').length, 4, 'no address, one line fewer');
  const bare = copy.shareText({ ...base, live: true, date: '2026-11-16', headline: '', emojis: [] }).split('\n');
  assert.deepEqual(bare, ['Did the world end today? ALMOST.', copy.subline(71), 'Nov 16 · Doom 71/99', 'didtheworldendtoday.com/day/2026-11-16/'], 'the ladder line stands in for a headline, and no emoji means no emoji line');
  for (const change of [0, null, undefined, NaN, 9, -9]) assert.ok(!copy.shareText({ ...base, live: true, date: '2026-11-16', change }).includes('Doom 71/99 '), `a normal day never shows an arrow (${change})`);
  const quiet = copy.shareText({ ...base, live: true, date: '2026-11-16', quiet: true }).split('\n');
  assert.deepEqual(quiet, ['Did the world end today? ALMOST.', 'Not a day for jokes. Back soon.', 'Nov 16 · Doom 71/99 ↑9', '✈️🏦⬛☄️', '⬛🌋📉⬛', '⚡⬛🌀⬛', 'didtheworldendtoday.com/day/2026-11-16/'], 'quiet mode shares the quiet line and the grid, not the headline or the emoji');
  assert.equal(copy.shareText({ ...base, change: 0, live: true, date: '2026-11-16', quiet: true }).split('\n')[2], 'Nov 16 · Doom 71/99', 'no change, no arrow');
  for (const bad of [0, null, undefined, '', NaN, 'up']) assert.equal(copy.changeText(bad), '', String(bad));
  assert.equal(copy.changeText(9), '↑9');
  assert.equal(copy.changeText(-4), '↓4');
  assert.equal(copy.shareText({ live: true, date: '2026-11-16', score: 'nope', categories: [], host: 'h' }).split('\n').at(-2), 'Nov 16 · Doom 0/99', 'a score that is not a number reads as 0');
});

test('the quiet page shares the quiet text, with a grid of twelve squares', () => {
  const r = copyRoot(edRoot);
  edit(latestFile(r), (l) => (l.quiet = { ...l.quiet, quiet: true, note: '' }));
  const full = attr(read('index.html', buildAt(r).dist), 'data-share-full').split('\n');
  assert.equal(full.length, 7, 'verdict, quiet line, date and score, three grid rows, address');
  assert.equal(full[1], copy.QUIET_LINE);
  assert.equal(full[2], `Nov 16 · Doom ${latest.score}/99 ↑${latest.change}`);
  const cells = full.slice(3, 6).map((row) => [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(row)].length);
  assert.deepEqual(cells, [4, 4, 4]);
  assert.equal(full[6], 'didtheworldendtoday.com/day/2026-11-16/');
});

// ---- the share image --------------------------------------------------------------------------------------------

test('the share image carries the day\'s headline, in capitals, as big as fits in two lines, and leaves out what Anton cannot draw', () => {
  const fontFile = fontFileIn(path.join(REPO, 'assets'));
  const base = { date: '2026-11-16', score: 62, host: 'didtheworldendtoday.com', fontFile };
  const fit = fitHeadline(ED16.headline, { width: 1072, fontFile });
  assert.equal(fit.lines.join(' '), ED16.headline.toUpperCase());
  assert.ok(fit.lines.length <= 2 && fit.size >= 28 && fit.size <= 64, `${fit.size} px on ${fit.lines.length} lines`);
  const svg = ogSvg({ ...base, headline: ED16.headline });
  for (const line of fit.lines) assert.ok(svg.includes(`font-size="${fit.size}" letter-spacing=`) && svg.includes(`>${line}</text>`), `the card draws "${line}"`);
  assert.ok(svg.indexOf('>ALMOST.<') < svg.indexOf(`>${fit.lines[0]}</text>`) && svg.indexOf(`>${fit.lines[0]}</text>`) < svg.indexOf('NOVEMBER 16, 2026'), 'under ALMOST., above the date');
  assert.equal((svg.match(/<text /g) || []).length, 6 + fit.lines.length, 'the six fixed texts and the headline lines');
  // a short line is set bigger than a long one, and the longest allowed still fits
  const short = fitHeadline('Quiet day. Still here.', { width: 1072, fontFile });
  const longest = fitHeadline(`${'Everything is fine and nothing is wrong at all, '.repeat(2).slice(0, 68)} Still here.`, { width: 1072, fontFile });
  assert.equal(short.size, 64);
  assert.ok(short.lines.length === 1 && longest.size < short.size && longest.lines.length <= 2 && longest.size >= 28, `${longest.size}`);
  // emoji, escaping, and no headline at all
  assert.deepEqual(fitHeadline('Planes ✈️ stopped. Still here.', { width: 1072, fontFile }).lines, ['PLANES STOPPED. STILL HERE.']);
  assert.ok(ogSvg({ ...base, headline: '<b>&"' }).includes('&lt;B&gt;&amp;&quot;'), 'the headline is escaped');
  assert.equal((ogSvg(base).match(/<text /g) || []).length, 6, 'no headline, no headline text');
  assert.deepEqual(fitHeadline('', { width: 1072, fontFile }).lines, []);
  // the pictures the build writes are these cards
  const card = (headline, d = {}) => renderPng(ogSvg({ date: '2026-11-16', score: latest.score, host: 'didtheworldendtoday.com', headline, fontFile, ...d }), { fontFile, width: 1200 });
  assert.ok(fs.readFileSync(path.join(edDist, 'og', 'latest.png')).equals(card(ED16.headline)), "today's headline on the latest card");
  assert.ok(fs.readFileSync(path.join(edDist, 'og', '2026-11-16.png')).equals(card(ED16.headline)), "and on today's own card");
  assert.ok(fs.readFileSync(path.join(edDist, 'og', '2026-11-15.png')).equals(card(ED15.headline, { date: '2026-11-15', score: 11 })), "yesterday's headline on yesterday's card");
  assert.ok(fs.readFileSync(path.join(dist, 'og', '2026-11-16.png')).equals(card(copy.subline(latest.score))), 'the ladder line when a day has no edition');
  assert.ok(!card(ED16.headline).equals(card(copy.subline(latest.score))), 'the picture changes with the headline');
  const r = copyRoot(edRoot);
  edit(latestFile(r), (l) => (l.quiet = { ...l.quiet, quiet: true, note: '' }));
  assert.ok(fs.readFileSync(path.join(buildAt(r).dist, 'og', 'latest.png')).equals(card(copy.QUIET_LINE)), 'the quiet line in quiet mode');
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

test('api/today.json is the public copy: the numbers, the stories, the headline and the lines, and none of the machinery', () => {
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
  assert.deepEqual(json.items.map((i) => i.line), ED16.items.map((i) => i.line));
  assert.deepEqual(json.items.map((i) => i.emoji), ED16.items.map((i) => i.emoji));
  assert.deepEqual(json.items.map((i) => i.url), ED16.items.map((i) => new URL(i.url).href));
  assert.deepEqual(Object.keys(json.items[0]).sort(), ['emoji', 'line', 'url'], 'a line has an emoji, words and a link, nothing else');
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
  const day = { headline: 'Quiet one. Still here.', rows: [{ emoji: '✈️', line: 'First.', url: 'javascript:alert(1)', ids: ['a'] }, { emoji: '🌋', line: 'Second.', url: 'https://a.example/x' }] };
  assert.deepEqual(publicCopy(sample, day).items, [{ emoji: '✈️', line: 'First.', url: '' }, { emoji: '🌋', line: 'Second.', url: 'https://a.example/x' }]);
  assert.equal(publicCopy(sample, day).headline, 'Quiet one. Still here.');
  assert.deepEqual(publicCopy(sample, { headline: 'H. Still here.' }).items, []);
});

// ---- quiet mode ------------------------------------------------------------------------------------------------------

test('quiet mode: every day goes plain, the editions rest, nothing jokes, and the long footer is gone', () => {
  const r = copyRoot(edRoot);
  edit(latestFile(r), (l) => (l.quiet = { ...l.quiet, quiet: true, note: 'Thinking of everyone affected.' }));
  const out = buildAt(r);
  auditSite(out.dist, { label: 'quiet mode' });
  const home = read('index.html', out.dist);
  const hero = heroOf(home);
  assert.equal(headlineOf(home), copy.QUIET_LINE);
  has(hero, '<p class="note">Thinking of everyone affected.</p>');
  has(hero, `<a class="go" href="#today">${esc("See today's stories ↓")}</a>`);
  assert.ok(!hero.includes('See what almost got us'), 'no joke on the button');
  assert.match(home, /<html lang="en"[^>]*data-quiet="1"/);
  assert.ok(!home.includes(copy.TAGLINE), 'no tagline');
  assert.ok(!home.includes('robot with low standards'));
  for (const line of copy.FOOTER_LINES_QUIET) assert.ok(home.includes(line), line);
  for (const line of ['Checked every 15 minutes.', 'Headlines belong to their publishers.']) has(home, `<p>${line}</p>`);
  has(home, `<meta name="description" content="${esc(copy.QUIET_DESCRIPTION)}">`);
  // each day lists its plain headlines, the first one as the top story, with the quiet caption where it belongs
  for (const block of blocksOf(home)) {
    const facts = factsIn(block);
    assert.ok(facts.length >= 2);
    assert.equal(facts[0].tag, 'TOP STORY');
    assert.deepEqual(facts.map((f) => f.tag).filter(Boolean), ['TOP STORY']);
  }
  const [today, yesterday] = blocksOf(home);
  assert.deepEqual(factsIn(today).map((f) => f.text), factsIn(blocksOf(read('index.html'))[0]).map((f) => f.text), 'the same plain headlines as a day with no edition');
  for (const item of [...ED16.items, ...ED15.items]) assert.ok(!home.includes(esc(item.line)), `the edition's line stays off: ${item.line}`);
  for (const text of [ED16.headline, ED15.headline]) assert.ok(!home.includes(esc(text)) && !read('almanac/index.html', out.dist).includes(esc(text)) && !read('feed.xml', out.dist).includes(esc(text)), text);
  has(yesterday, `<p class="dh">${copy.QUIET_LINE}</p>`);
  const captions = [...home.matchAll(/<p class="cap">([^<]*)/g)].map((m) => m[1]);
  assert.ok(captions.length >= 1 && captions.every((c) => c.startsWith('No jokes on this one.')), `${captions}`);
  assert.match(read('index.html'), /data-quiet="0"/);
  // the day pages say the same
  for (const rel of ['day/2026-11-16/index.html', 'day/2026-11-15/index.html']) assert.equal(headlineOf(read(rel, out.dist)), copy.QUIET_LINE, rel);
});

test('a quiet build has no joke left anywhere: the plus link, the end of the feed and the page script are plain', () => {
  const JOKES = ["so you don't have to", 'so you don&#39;t have to', 'fine before that too', 'New near misses'];
  const r = copyRoot(edRoot);
  edit(latestFile(r), (l) => (l.quiet = { ...l.quiet, quiet: true, note: '' }));
  const quiet = buildAt(r).dist;
  const home = read('index.html', quiet);
  // the two places that joke on a normal page are there, in their plain form
  const plus = [...home.matchAll(/<a class="plus"[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);
  assert.ok(plus.length >= 1, 'a day has more headlines than rows');
  for (const text of plus) assert.match(text, /^Plus \d+ more headlines? \u2192$/, text);
  assert.equal(copy.plusText(95, true), 'Plus 95 more headlines \u2192');
  assert.equal(copy.plusText(1, true), 'Plus 1 more headline \u2192');
  has(home, `<div class="end">\n<p>${esc("That's every day we've checked.")}</p>`);
  // and not one file of the build says any of the jokes, the page script included
  let looked = 0;
  for (const [rel, full] of listDist(quiet)) {
    if (!TEXT.test(rel)) continue;
    looked += 1;
    const text = fs.readFileSync(full, 'utf8');
    for (const joke of JOKES) assert.ok(!text.includes(joke), `${rel} says "${joke}"`);
  }
  assert.ok(looked >= 10, `${looked} text files looked at`);
  // a normal build still says the first two, so the check above can fail
  const normal = read('index.html', edDist);
  assert.ok(normal.includes('so you don&#39;t have to') && normal.includes(esc(copy.FEED_END)), 'a normal build still jokes in both places, so this check can fail');
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
  const abroad = quakeRow({ pager: 'orange' });
  assert.ok(abroad.includes('<p class="cap">No jokes on this one. <a href="https://www.ifrc.org/" target="_blank" rel="noopener">Support the Red Cross and Red Crescent</a></p>'), 'Tual, Indonesia, PAGER orange');
  const home = quakeRow({ pager: 'yellow', place: '10 km W of Anchorage, Alaska' });
  assert.ok(home.includes('<p class="cap">No jokes on this one. <a href="https://www.redcross.org/donate" target="_blank" rel="noopener">Donate to the Red Cross</a></p>'), 'Anchorage, Alaska, PAGER yellow');
  assert.ok(quakeRow({ tsunami: true }).includes('href="https://www.ifrc.org/"'), 'a tsunami flag outside the US');
  assert.ok(quakeRow({ pager: 'green', tsunami: false }).includes('<p class="cap">No jokes on this one.</p>'), 'back to green: no link');
});

test('a quiet line whose story has left the day keeps its caption and has no link to guess at', () => {
  const gone = { ...ED16, items: ED16.items.map((i, n) => (n === 5 ? { ...i, ids: ['gone:quake'], quiet: true } : i)) };
  const { dist: out } = withEditions({ ...EDITIONS, '2026-11-16': gone });
  const row = rowsOf(read('index.html', out)).find((x) => /^<li class="row[^"]*\bquiet\b/.test(x));
  assert.ok(row && row.includes('<p class="cap">No jokes on this one.</p>'));
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
    assert.ok(first.includes('Read it · 2 outlets →'), `${rel}: but it still says where it came from`);
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

test('a line the editor wrote that is HTML is just as inert: the headline, the lines, the source, the link, the share text, the feed and the card', () => {
  const hostile = {
    ...ED16,
    headline: '<i>All fine</i> & "ok" <script>alert(5)</script>. Still here.',
    items: [
      itemOf(AIRLINES, '<b>\u{1F4A5}', '<img src=x onerror=alert(1)> and "quotes" & <b>bold</b>', { source: '<script>alert(2)</script>', title: '" onmouseover="alert(3)" x="', url: 'https://example.com/?q="><script>alert(4)</script>', outlets: 1 }),
      itemOf(AWS, '🖥️', 'Second line with <a href="https://evil.example">a link</a> in it', { source: "O'Reilly & <Sons>", outlets: 1 }),
      itemOf(BREACH, '🔓', 'Third line is plain.', { outlets: 'many' }),
    ],
  };
  const out = withEditions({ ...EDITIONS, '2026-11-16': hostile });
  assert.equal(validateEdition(hostile, { date: '2026-11-16', excluder: gk.excluder }).ok, true, 'it passes the check, so the page must be the one to keep it safe');
  auditSite(out.dist, { label: 'hostile edition' });
  const home = read('index.html', out.dist);
  has(home, '&lt;i&gt;All fine&lt;/i&gt; &amp; &quot;ok&quot; &lt;script&gt;alert(5)&lt;/script&gt;. Still here.');
  const facts = factsIn(blocksOf(home)[0]);
  assert.deepEqual(facts.map((f) => f.text), ['<img src=x onerror=alert(1)> and "quotes" & <b>bold</b>', 'Second line with <a href="https://evil.example">a link</a> in it', 'Third line is plain.']);
  assert.equal(facts[0].emoji, '<b>\u{1F4A5}');
  assert.equal(facts[0].href, 'https://example.com/?q=%22%3E%3Cscript%3Ealert(4)%3C/script%3E');
  assert.equal(facts[0].read, 'Read it · <script>alert(2)</script> →');
  assert.equal(facts[2].read, `Read it · ${BREACH.source} →`, 'a count that is not a number reads as one outlet');
  for (const rel of ['index.html', 'day/2026-11-16/index.html', 'almanac/index.html', 'feed.xml']) {
    const text = read(rel, out.dist);
    for (const tag of ['<img src=x', '<script>alert', '<i>All', '<b>bold', '<b>\u{1F4A5}', '<a href="https://evil.example"']) assert.ok(!text.includes(tag), `${rel}: ${tag}`);
  }
  // the feed is still valid XML, and what a reader's app decodes from it is still text
  const xml = read('feed.xml', out.dist);
  assert.equal(XMLValidator.validate(xml), true);
  const item = [].concat(new XMLParser().parse(xml).rss.channel.item)[0];
  assert.equal(item.title, '<i>All fine</i> & "ok" <script>alert(5)</script>. Still here.', 'a title is plain text in RSS');
  const leftover = item.description.replace(/<\/?(?:p|ol|li)>/g, '').replace(/<a href="[^"]*">Read it<\/a>/g, '');
  assert.ok(!leftover.includes('<'), `the description is escaped HTML, so no tag of theirs is in it: ${leftover.slice(0, 120)}`);
  // the share text is an attribute: the quotes cannot end it
  assert.ok(attr(home, 'data-share-text').includes('"ok"'), 'the text a person copies is the words, unescaped');
  assert.ok(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(home));
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
  const ctx = { byId: new Map(), quietMode: false, quietCaption: 'q', quietLink: 'https://www.redcross.org/donate', quietLinkIntl: 'https://www.ifrc.org/' };
  const bad = dayRow({ emoji: '🌐', line: '<b>hi</b>', ids: ['a'], quiet: false, url: 'javascript:alert(1)', source: 'S', outlets: 1 }, 1, ctx);
  assert.ok(bad.includes('<p class="txt">&lt;b&gt;hi&lt;/b&gt;</p>'));
  assert.ok(!bad.includes('<a '), 'no anchor');
  assert.ok(bad.includes('<p class="read">Read it · S →</p>'), 'the words stay');
  for (const odd of [{}, { line: 'Only a line' }, { emoji: null, line: undefined, url: 42, outlets: 'x', source: undefined }, null]) {
    const html = dayRow(odd || {}, 0, ctx);
    for (const token of ['undefined', 'NaN', '[object']) assert.ok(!html.includes(token), `${token} in ${JSON.stringify(odd)}`);
  }
  const heads = headlineRow({ id: 'z', cat: 'zzz', title: 't', url: 'https://example.com', source: 's', outlets: 'x' }, ctx);
  for (const token of ['undefined', 'NaN', '[object']) assert.ok(!heads.includes(token), token);
  assert.ok(!headlineRow({}, ctx).includes('undefined'));
  assert.ok(dayRows([{ emoji: 'e', line: 'l', url: 'https://example.com/', source: 's', outlets: 1 }], ctx).startsWith('<ol class="rows">') && headlineRows([{ title: 't' }], ctx).startsWith('<ol class="heads">'));
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
    title: get(/<p class="ht">(?:<a [^>]*>)?([^<]*)(?:<\/a>)?<\/p>/),
    href: get(/<p class="ht"><a href="([^"]*)"/),
    source: get(/<p class="hs">([^<]*)<\/p>/),
  };
};

test('day pages: the same hero for another day, that day\'s lines, every headline we read that day, and a way to the next and previous', () => {
  const past = read('day/2026-11-15/index.html', edDist);
  has(past, '<title>Did the world end on November 15, 2026? ALMOST.</title>');
  has(past, '<span class="q">Did the world end on Sunday, Nov 15?</span>');
  assert.equal(headlineOf(past), ED15.headline);
  has(past, '<span class="when">Sun, Nov 15</span>');
  has(past, 'Doom Score <b class="n">11</b> of 99');
  assert.ok(!past.includes('class="ago"') && !past.includes('class="dot"'), 'a finished day is not "checked just now"');
  has(past, '<a class="go" href="#rows">See what almost got us ↓</a>');
  assert.ok(!past.includes('data-act="share">Share today'), 'Share today is for the homepage');
  assert.equal((past.match(/data-act="share"/g) || []).length, 1, 'one share button, at the bottom');
  has(past, '<section class="day" id="rows">');
  assert.deepEqual(factsIn(past).map((f) => f.text), ED15.items.map((i) => i.line));
  has(past, `${SITE}/og/2026-11-15.png`);
  has(past, 'data-live="0"');
  assert.ok(past.includes('<meta name="description" content="The grid blinked three times. Still here. Doom Score 11 of 99 on November 15, 2026. Every story links to its source.">'), 'the description says the headline, the score, the day, and that every story links to its source');
  has(past, 'href="../2026-11-16/">Nov 16 &rarr;</a>');
  assert.ok(!past.includes('&larr;'), 'no day before it');
  has(past, '<h2 class="sec">Every headline we read that day</h2>');
  assert.deepEqual(headsOf(past).map((h) => headFacts(h).title).sort(), stored15.stories.map((s) => s.title).sort(), 'every story of the day, once');

  const today = read('day/2026-11-16/index.html', edDist);
  has(today, '<title>Did the world end on November 16, 2026? ALMOST.</title>');
  has(today, '<span class="q">Did the world end today?</span>');
  assert.equal(headlineOf(today), ED16.headline);
  has(today, 'data-live="1"');
  has(today, '<span class="ago" data-since=');
  has(today, 'href="../2026-11-15/">&larr; Nov 15</a>');
  assert.ok(!today.includes('&rarr;'), 'nothing after today');
  assert.deepEqual(factsIn(today).map((f) => f.text), ED16.items.map((i) => i.line));
  const heads = headsOf(today).map(headFacts);
  assert.deepEqual(heads.map((h) => h.title).sort(), stored16.stories.map((s) => s.title).sort(), 'all of them, the ones in the lines too');
  // each headline is the link, with its source and outlet count under it
  const cloud = heads.find((h) => h.title === 'Cloudflare outage knocks thousands of sites offline');
  assert.equal(cloud.href, 'https://pub0.example/internet/0');
  assert.equal(cloud.source, 'Pub A');
  assert.equal(heads.find((h) => h.title === '<img src=x onerror=alert(1)>').source, '<script>alert(2)</script> · 2 outlets');
  assert.equal(heads.filter((h) => h.quiet).length, 1);
  for (const m of today.matchAll(/<p class="ht"><a ([^>]*)>/g)) assert.match(m[1], /target="_blank" rel="noopener"/);
  // a plain-headline day reads the same way
  assert.equal(headlineOf(read('day/2026-11-16/index.html')), copy.subline(latest.score));
  assert.equal(lineCount(read('day/2026-11-16/index.html')), cfg.edition.fallbackRows);
});

test('a day page for a day with no stories and no edition says so plainly', () => {
  const r = copyRoot(root);
  edit(dayFile(r, '2026-11-15'), (d) => (d.stories = []));
  const out = buildAt(r);
  const page = read('day/2026-11-15/index.html', out.dist);
  has(page, '<p class="empty">Nothing on file for this day.</p>');
  assert.ok(!page.includes('Every headline we read that day'), 'no empty list');
  assert.equal(headlineOf(page), copy.subline(11), 'the ladder line');
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
    assert.ok(!html.includes('Worst day so far'), `${label}: two editions are too few for a record line`);
    assert.ok(!/<script/i.test(html));
    has(html, 'href="../">&larr; Today</a>');
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

test('the homepage shows today and up to six earlier days, then a way to the older ones', () => {
  const seven = build(rootWithDays(7), { siteUrl: SITE, config: LONG_RUN });
  const home7 = read('index.html', seven.dist);
  assert.equal(blocksOf(home7).length, 7);
  has(home7, '<div class="end">');
  has(home7, `<p>${esc(copy.FEED_END)}</p>`);
  has(home7, '<a href="./almanac/">The Almanac of Almost →</a>');
  assert.ok(!home7.includes('Older days'));

  const nine = build(rootWithDays(9), { siteUrl: SITE, config: LONG_RUN });
  const home9 = read('index.html', nine.dist);
  const blocks = blocksOf(home9);
  assert.equal(blocks.length, 7, 'seven blocks, not nine');
  has(blocks[2], '<h2 class="dl"><span>SATURDAY</span><span> &middot; NOV 14</span></h2>');
  has(blocks[2], '<p class="ds">Doom Score 20 of 99</p>');
  has(home9, '<p class="end"><a href="./almanac/">Older days are in the Almanac of Almost →</a></p>');
  assert.ok(!home9.includes(esc(copy.FEED_END)), 'and not "that is every day"');
  assert.ok(!home9.includes('NOV 8') && !home9.includes('NOV 9'), 'the two oldest days are not on the homepage');
  assert.equal((read('almanac/index.html', nine.dist).match(/class="al"/g) || []).length, 9, 'the Almanac has all nine');
  assert.ok(fs.existsSync(path.join(nine.dist, 'day', '2026-11-08', 'index.html')), 'and each has its own page');
  auditSite(nine.dist, { label: 'nine days' });
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
  has(today, '<h2 class="dl"><span class="hot">TODAY</span><span> &middot; TUESDAY, NOV 17</span></h2>');
  has(today, '<p class="empty">Nothing new yet today.</p>');
  assert.ok(!today.includes('class="plus"'));
  has(yesterday, '<h2 class="dl"><span>YESTERDAY</span><span> &middot; MONDAY, NOV 16</span></h2>');
  assert.deepEqual(factsIn(yesterday).map((f) => f.text), ED16.items.map((i) => i.line), 'yesterday keeps its edition');
  assert.equal(headlineOf(home), copy.subline(11), 'the ladder line over the empty day');
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
  assert.ok(first.description.includes(`Nov 16 · Doom ${latest.score}/99`));
  assert.ok(first.description.includes(`<a href="${new URL(ED16.items[0].url).href}">Read it</a>`), 'each line links its story');
});

// ---- the first words and the check -------------------------------------------------------------------------------------------

test('the subline ladder breaks exactly where the spec says', () => {
  const ladder = [
    [0, 'Suspiciously quiet.'], [19, 'Suspiciously quiet.'],
    [20, 'Routine background apocalypse.'], [39, 'Routine background apocalypse.'],
    [40, 'The usual amount of almost.'], [59, 'The usual amount of almost.'],
    [60, 'Louder than usual. Still here.'], [79, 'Louder than usual. Still here.'],
    [80, 'Not for lack of trying.'], [94, 'Not for lack of trying.'],
    [95, 'Honestly, impressive. Still no.'], [99, 'Honestly, impressive. Still no.'],
  ];
  for (const [score, line] of ladder) assert.equal(copy.subline(score), line, String(score));
  assert.equal(copy.subline('nope'), 'Suspiciously quiet.');
});

test('the home page says what section 9 says', () => {
  const home = read('index.html');
  has(home, '<title>Did the world end today? ALMOST.</title>');
  has(home, `<meta name="description" content="${esc(copy.DESCRIPTION)}">`);
  assert.equal(copy.DESCRIPTION, "Live coverage of the end of the world, which keeps not happening. Today's near misses, a 0-99 Doom Score, and the Almanac of Almost. Checked every 15 minutes.");
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

test('the stale line appears when the newest good read is more than two hours old, and not before', () => {
  const stale = (minutes) => {
    const r = copyRoot(root);
    edit(latestFile(r), (l) => (l.lastSuccessAt = new Date(Date.parse(l.buildTime) - minutes * 60000).toISOString()));
    return read('index.html', buildAt(r).dist);
  };
  const said = (n) => esc(`We haven't checked in ${n} hours. That's on us, not the world.`);
  const late = stale(210);
  assert.match(late, /<p class="stale" id="stale" data-template="[^"]*">/);
  assert.ok(late.includes(`">${said(3)}</p>`), 'three hours late says three hours');
  assert.ok(stale(121).includes(`">${said(2)}</p>`), 'two hours and a bit says two');
  assert.match(stale(120), /<p class="stale" id="stale" data-template="[^"]*" hidden><\/p>/);
  assert.match(read('index.html'), /<p class="stale" id="stale" data-template="[^"]*" hidden><\/p>/);
  assert.equal(copy.staleLine(5), "We haven't checked in 5 hours. That's on us, not the world.");
  assert.ok(!/Probably us|went quiet/.test(late), 'the old joke is gone');
  // a past day was finished long ago, so it never says we have not checked
  const r = copyRoot(root);
  edit(latestFile(r), (l) => (l.lastSuccessAt = new Date(Date.parse(l.buildTime) - 600 * 60000).toISOString()));
  assert.ok(!/We haven(?:'|&#39;)t checked in \d/.test(read('day/2026-11-15/index.html', buildAt(r).dist)));
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
    'The Doom Score',
    'Where it comes from',
    'Quiet cards and quiet mode',
    'We read the news and watch the sky and the internet: asteroids, solar storms, earthquakes, and the big status pages.',
    'It comes on when a deadly disaster takes over the news, or when someone switches it on by hand.',
    'We show headlines and links only. Publishers who want a headline removed can DM <a href="https://x.com/thelpdrive" target="_blank" rel="noopener">@thelpdrive</a> on X.',
    'Built by <a href="https://x.com/thelpdrive" target="_blank" rel="noopener">@thelpdrive</a> with Claude, an AI. Claude writes each day\'s headline and the short line on each story, from that day\'s headlines. It can get things wrong, so every line links to its source.',
    'Each fired category is worth 6 points',
    'The floor is 11',
    'The cap is 99',
  ]) assert.ok(about.includes(needle), needle);
  assert.ok(/<a [^>]*>Claude<\/a>/.test(about), 'the status pages we watch are listed with Claude among them');
  for (const word of ['vital', 'Vital', 'bingo', 'Bingo', 'mass-casualty', 'nobody is doing on purpose']) assert.ok(!about.includes(word), word);
  assert.ok(!/a popular AI chatbot/i.test(about + read('index.html')), 'no stand-in name');
  for (const rel of ['almanac/index.html', '404.html', 'feed.xml', 'day/2026-11-15/index.html']) assert.ok(!/claude/i.test(read(rel)), `${rel} does not say Claude`);
});

test('design tokens: the three colors, Anton for the big type, system fonts for the rest, and a size class for every length of headline', () => {
  const home = read('index.html');
  for (const c of ['#0B0B0F', '#F2EFE8', '#FF6A00']) assert.ok(home.includes(c), c);
  assert.ok(home.includes('font-family:Anton') && home.includes('system-ui') && home.includes('ui-monospace'));
  assert.ok(home.includes('url(./assets/anton.woff2)'), 'the font is relative to the page');
  assert.ok(read('day/2026-11-16/index.html').includes('url(../../assets/anton.woff2)'));
  assert.ok(!/fonts\.(?:googleapis|gstatic)/.test(home));
  const { from, to, step } = copy.HEADLINE_BUCKETS;
  for (let n = from; n <= to; n += step) assert.ok(home.includes(`.n${n}{--n:${n}}`), `.n${n}`);
  const seen = new Set();
  for (let length = 0; length <= 120; length += 1) {
    const klass = copy.headlineClass('x'.repeat(length));
    seen.add(klass);
    assert.ok(home.includes(`.${klass}{--n:`), `${length} characters: ${klass} is in the style sheet`);
  }
  assert.equal(copy.headlineClass('x'.repeat(10)), `n${from}`, 'a short line takes the biggest type');
  assert.equal(copy.headlineClass('x'.repeat(200)), `n${to}`, 'a long one the smallest');
  assert.ok(seen.size > 10);
});

test('robots, sitemap and manifest', () => {
  assert.equal(read('robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
  const locs = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, [`${SITE}/`, `${SITE}/almanac/`, `${SITE}/about/`, `${SITE}/day/2026-11-16/`, `${SITE}/day/2026-11-15/`]);
  const manifest = readJson(path.join(dist, 'site.webmanifest'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.background_color, '#0B0B0F');
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
  const home = read('index.html', buildAt(r).dist);
  assert.match(home, /<span class="when">Mon, Nov 16<\/span>/);
  has(home, 'TODAY</span><span> &middot; MONDAY, NOV 16</span>');
  assert.equal(attr(home, 'data-share-full').split('\n')[3].slice(0, 6), 'Nov 16');
  assert.ok(!home.includes('Nov 17'), 'no UTC date on the page');
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
    const blocks = blocksOf(home);
    assert.equal(blocks.length, 2);
    for (const block of blocks) {
      assert.ok(block.includes('data-share-full="') && block.includes('data-share-text="') && block.includes('data-share-url="'), `${label}: a block carries its own share text`);
      assert.equal((block.match(/data-act="share"/g) || []).length, 1, `${label}: and its own button`);
    }
    assert.equal((home.match(/data-act="share"/g) || []).length, 3, `${label}: Share today and one button per day`);
    assert.equal((home.match(/data-act="check"/g) || []).length, 1, `${label}: ALMOST. is the one check button`);
  }
  for (const token of ["'[data-share-full]'", "'data-share-text'", "'data-share-full'", "'data-share-url'", "'#main'", "'#hero'", "'#verdict'", "'#check'", "'#said'", "'#stale'", "'data-lines'", "'data-since'"]) assert.ok(code.includes(token), `app.js reads ${token}`);
  const day = read('day/2026-11-16/index.html', edDist);
  for (const hook of ['id="hero"', 'id="main"', 'data-live="1"', 'data-page="day"']) assert.ok(day.includes(hook), `a day page: ${hook}`);
  assert.ok(day.includes('<script src="../../assets/app.js" defer></script>'), 'a day page loads the script from two folders up');
  assert.ok(read('index.html', edDist).includes('<script src="./assets/app.js" defer></script>'));
  for (const rel of ['about/index.html', 'almanac/index.html']) assert.ok(!/<script/i.test(read(rel, edDist)), `${rel} needs no script`);
});

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
    const node = { className: '', innerHTML: '', type: '', _on: {}, classList: { add() {}, remove() {} }, setAttribute() {}, remove() {}, addEventListener(type, fn) { node._on[type] = fn; } };
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
  assert.ok(bar.innerHTML.includes('Updated. Tap to refresh.') && !bar.innerHTML.includes('near misses'), bar.innerHTML);
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
