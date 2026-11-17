// The pictures: the favicon, the app icon and the 1200x630 share image. The
// share image is an SVG drawn here and turned into a PNG by resvg with the
// Anton TTF, so it looks the same on any machine. It says the question,
// ALMOST., the day's headline (two lines at most, shrunk until it fits), the
// date, the Doom Score and where to find the site. No emoji glyphs in it: Anton
// has none.
import path from 'node:path';
import resvg from '@resvg/resvg-js';
import { CREDIT_HANDLE, longDate, rowDate } from './copy.mjs';
import { esc, num } from './esc.mjs';

const { Resvg } = resvg;

const BG = '#0B0B0F';
const INK = '#F2EFE8';
const HOT = '#FF6A00';
const MUTE = '#8C8C94';

export function faviconSvg({ rounded = true } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
<rect width="64" height="64"${rounded ? ' rx="14"' : ''} fill="${BG}"/>
<circle cx="32" cy="32" r="21" fill="none" stroke="${HOT}" stroke-opacity="0.4" stroke-width="3"/>
<circle cx="32" cy="32" r="11" fill="${HOT}"/>
</svg>
`;
}

// ---- measuring text -------------------------------------------------------------------
// resvg can tell how wide a string is in Anton. A string is measured once at 100px;
// every other size is that width scaled, so the headline can be fitted without
// drawing it again and again.

const widths = new Map();

function widthAt100(text, fontFile) {
  const key = `${fontFile || ''}\n${text}`;
  if (widths.has(key)) return widths.get(key);
  let w = text.length * 44; // a guess for when there is no font to ask
  if (fontFile) {
    try {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="8000" height="300" viewBox="0 0 8000 300"><text x="0" y="200" font-family="Anton" font-size="100">${esc(text)}</text></svg>`;
      const box = new Resvg(svg, { font: { fontFiles: [fontFile], loadSystemFonts: false, defaultFontFamily: 'Anton' } }).getBBox();
      if (box && Number.isFinite(box.width) && box.width > 0) w = box.width;
    } catch {
      /* keep the guess */
    }
  }
  widths.set(key, w);
  return w;
}

const SPACING = 0.025; // letter spacing, as a share of the font size

function widthOf(text, size, fontFile, spacing = SPACING) {
  return (widthAt100(text, fontFile) * size) / 100 + text.length * size * spacing;
}

// Anton has no emoji; anything but letters, numbers, punctuation, currency and math signs and spaces is left out.
function drawable(text) {
  return String(text ?? '')
    .replace(/[^\p{L}\p{N}\p{P}\p{Sc}\p{Sm}\p{Zs}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// The headline in capitals on one line if it fits at the biggest size, else on two
// balanced lines, shrinking one step at a time until both fit the width.
export function fitHeadline(text, { width, fontFile = null, max = 64, min = 28 }) {
  const line = drawable(text).toUpperCase();
  if (!line) return { size: max, lines: [] };
  const words = line.split(' ');
  for (let size = max; size >= min; size -= 2) {
    if (widthOf(line, size, fontFile) <= width) return { size, lines: [line] };
    let best = null;
    for (let k = 1; k < words.length; k += 1) {
      const a = words.slice(0, k).join(' ');
      const b = words.slice(k).join(' ');
      const wide = Math.max(widthOf(a, size, fontFile), widthOf(b, size, fontFile));
      if (!best || wide < best.wide) best = { wide, lines: [a, b] };
    }
    if (best && best.wide <= width) return { size, lines: best.lines };
  }
  // A headline this long cannot be set in two lines at the smallest size: keep what fits.
  const size = min;
  let first = words;
  while (first.length > 1 && widthOf(first.join(' '), size, fontFile) > width * 2 - 40) first = first.slice(0, -1);
  const cut = Math.max(1, Math.ceil(first.length / 2));
  return { size, lines: [first.slice(0, cut).join(' '), first.slice(cut).join(' ')].filter(Boolean) };
}

// The question in the top left. It is the biggest line after ALMOST. and the score, so it
// reads in a feed. A past day names its date, which makes it longer, so it shrinks one step at a
// time until it fits beside DOOM SCORE with room to spare. It never runs into it.
const QUESTION = { max: 52, min: 34, spacing: 0.09, gap: 48 };
const SCORE_LABEL = { text: 'DOOM SCORE', size: 38, spacing: 4.5 };

export function questionText(date, live) {
  const day = String(rowDate(date) || '').toUpperCase();
  return live || !day ? 'DID THE WORLD END TODAY?' : `DID THE WORLD END ON ${day}?`;
}

export function fitQuestion(text, { width = 1072, fontFile = null } = {}) {
  const label = widthOf(SCORE_LABEL.text, SCORE_LABEL.size, fontFile, SCORE_LABEL.spacing / SCORE_LABEL.size);
  const room = width - label - QUESTION.gap;
  for (let size = QUESTION.max; size >= QUESTION.min; size -= 2) if (widthOf(text, size, fontFile, QUESTION.spacing) <= room) return size;
  return QUESTION.min;
}

// date, score: the day's own numbers. headline: the day's headline (or the quiet line).
// live: the day is today, so the card asks about today; a past day asks about its own date.
// fontFile: the Anton TTF, used to measure the headline; without it the fit is a guess.
export function ogSvg({ date, score, host, headline = '', fontFile = null, live = true }) {
  const s = Math.round(num(score));
  const question = questionText(date, live);
  const qSize = fitQuestion(question, { fontFile });
  const fit = fitHeadline(headline, { width: 1072, fontFile });
  const lead = Math.round(fit.size * 1.13);
  const top = 412;
  const lines = fit.lines
    .map((l, i) => `<text x="64" y="${top + i * lead}" font-family="Anton" font-size="${fit.size}" letter-spacing="${(fit.size * SPACING).toFixed(1)}" fill="${INK}">${esc(l)}</text>`)
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="${BG}"/>
<text x="64" y="112" font-family="Anton" font-size="${qSize}" letter-spacing="${(qSize * QUESTION.spacing).toFixed(1)}" fill="${INK}">${esc(question)}</text>
<text x="${1200 - 64}" y="112" text-anchor="end" font-family="Anton" font-size="${SCORE_LABEL.size}" letter-spacing="${SCORE_LABEL.spacing}" fill="${INK}" fill-opacity="0.7">${SCORE_LABEL.text}</text>
<text x="58" y="326" font-family="Anton" font-size="200" fill="${INK}">ALMOST.</text>
<text x="${1200 - 64}" y="326" text-anchor="end" font-family="Anton" font-size="200"><tspan fill="${HOT}">${s}</tspan><tspan fill="${MUTE}" font-size="64" letter-spacing="2">/99</tspan></text>
${lines}
<text x="64" y="590" font-family="Anton" font-size="30" letter-spacing="3" fill="${MUTE}">${esc(longDate(date).toUpperCase())}</text>
<text x="${1200 - 64}" y="590" text-anchor="end" font-family="Anton" font-size="26" letter-spacing="2.5" fill="${MUTE}">${esc(`${String(host || '').toUpperCase()} \u00b7 ${CREDIT_HANDLE.toUpperCase()}`)}</text>
</svg>
`;
}

export function renderPng(svg, { fontFile, width }) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { fontFiles: [fontFile], loadSystemFonts: false, defaultFontFamily: 'Anton' },
  });
  return r.render().asPng();
}

export const fontFileIn = (assetsDir) => path.join(assetsDir, 'fonts', 'Anton-Regular.ttf');
