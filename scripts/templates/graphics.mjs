// The pictures: the favicon, the app icon and the 1200x630 share image. The share image is the sign
// itself, an SVG drawn here and turned into a PNG by resvg with the three TTFs in assets/fonts, so it
// looks the same on any machine: League Gothic for the question and the numbers, Libre Franklin for the
// sentence and the small words. A black band across the top asks the question in yellow. Under it,
// ALMOST. in huge black type on the yellow page, with the Doom Score board on its right: DOOM SCORE in
// yellow, the number in red, ten squares. Under that, the first sentence of the day's headline (two
// lines at most, shrunk until it fits) and the site's address. In quiet mode the page is white and
// there is no red anywhere. No emoji glyphs: neither font has any.
import fs from 'node:fs';
import path from 'node:path';
import resvg from '@resvg/resvg-js';
import { filledSquares, shortDate } from './copy.mjs';
import { esc, num } from './esc.mjs';
import { INK, RED, WHITE, YELLOW } from './palette.mjs';
import { firstSentence } from '../lib/text.mjs';

const { Resvg } = resvg;

// The family names resvg sees inside the TTFs (the name tables of the font files). The semibold and the
// bold of Libre Franklin are two files with one family name; the weight picks between them.
export const DISPLAY = 'League Gothic';
export const BODY = 'Libre Franklin';
const SENTENCE_WEIGHT = 600;
const LABEL_WEIGHT = 700;

export const fontFilesIn = (assetsDir) => [
  path.join(assetsDir, 'fonts', 'LeagueGothic-Regular.ttf'),
  path.join(assetsDir, 'fonts', 'LibreFranklin-SemiBold.ttf'),
  path.join(assetsDir, 'fonts', 'LibreFranklin-Bold.ttf'),
];

// ---- the icons ---------------------------------------------------------------------------
// The "A" is the outline of League Gothic Regular (2000 units to the em, y up), so the icons need no
// font: a black A on a yellow square. Square corners, like everything else here.
const GLYPH_A = 'M35 0 257 1470H521L743 0H533L493 300H285L245 0ZM315 528H463L401 1022L395 1100H383L377 1022Z';
const A_BOX = { left: 35, width: 708, height: 1470 };

export function faviconSvg() {
  const s = 50 / A_BOX.height; // the letter is 50 of the 64 units tall
  const left = (64 - A_BOX.width * s) / 2 - A_BOX.left * s;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
<rect width="64" height="64" fill="${YELLOW}"/>
<path transform="translate(${left.toFixed(2)} 57) scale(${s.toFixed(5)} ${(-s).toFixed(5)})" d="${GLYPH_A}" fill="${INK}"/>
</svg>
`;
}

// ---- what a font can draw ---------------------------------------------------------------------
// The card only prints characters its font really has: an emoji or a stray symbol is left out, and a
// degree sign or an accented letter stays. What a font has is read from its cmap table.

// The set of code points a font file (an sfnt, as a Buffer) has glyphs for; null when it has no cmap table.
export function readCmap(buf) {
  const tables = buf.readUInt16BE(4);
  let cmap = -1;
  for (let i = 0; i < tables; i += 1) {
    const rec = 12 + i * 16;
    if (buf.toString('latin1', rec, rec + 4) === 'cmap') cmap = buf.readUInt32BE(rec + 8);
  }
  if (cmap < 0) return null;
  const set = new Set();
  const count = buf.readUInt16BE(cmap + 2);
  for (let i = 0; i < count; i += 1) {
    const sub = cmap + buf.readUInt32BE(cmap + 4 + i * 8 + 4);
    const format = buf.readUInt16BE(sub);
    if (format === 4) {
      const segX2 = buf.readUInt16BE(sub + 6);
      const ends = sub + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const ranges = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s += 1) {
        const end = buf.readUInt16BE(ends + s * 2);
        const start = buf.readUInt16BE(starts + s * 2);
        const delta = buf.readInt16BE(deltas + s * 2);
        const offset = buf.readUInt16BE(ranges + s * 2);
        for (let c = start; c <= end && c < 0xffff; c += 1) {
          let glyph;
          if (offset === 0) glyph = (c + delta) & 0xffff;
          else {
            glyph = buf.readUInt16BE(ranges + s * 2 + offset + (c - start) * 2);
            if (glyph) glyph = (glyph + delta) & 0xffff;
          }
          if (glyph) set.add(c);
        }
      }
    } else if (format === 12) {
      const groups = buf.readUInt32BE(sub + 12);
      for (let g = 0; g < groups; g += 1) {
        const start = buf.readUInt32BE(sub + 16 + g * 12);
        const end = Math.min(buf.readUInt32BE(sub + 20 + g * 12), 0x10ffff);
        for (let c = start; c <= end; c += 1) set.add(c);
      }
    }
  }
  return set;
}

const cmaps = new Map();
function cmapOf(file) {
  if (cmaps.has(file)) return cmaps.get(file);
  let set = null;
  try {
    set = readCmap(fs.readFileSync(file));
  } catch {
    set = null;
  }
  cmaps.set(file, set);
  return set;
}

// The files that draw the sentence: the Libre Franklin ones.
const bodyFiles = (fontFiles) => (fontFiles || []).filter((f) => /librefranklin/i.test(path.basename(f)));

// Whether the characters can be drawn: a test over the fonts' own cmaps, or null when there is no font to ask.
function glyphTest(files) {
  const sets = (files || []).map(cmapOf).filter(Boolean);
  return sets.length ? (cp) => sets.some((set) => set.has(cp)) : null;
}

// Every character the fonts can draw stays (the degree sign in 118°F, the accents in Dončić); emoji, joiners and
// anything else the fonts have no glyph for are left out, and spaces are tidied. With no font to ask it keeps
// letters, numbers, punctuation, currency, math signs, the degree sign and spaces.
export function drawable(text, fontFiles = []) {
  const has = glyphTest(fontFiles);
  let out = '';
  for (const ch of String(text ?? '').replace(/\s+/g, ' ')) {
    if (ch === ' ') out += ch;
    else if (/[\p{Cc}\p{Cf}︀-️]/u.test(ch)) continue;
    else if (has ? has(ch.codePointAt(0)) : /[\p{L}\p{N}\p{P}\p{Sc}\p{Sm}\p{Zs}°]/u.test(ch)) out += ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

// ---- measuring text -------------------------------------------------------------------
// resvg can tell how wide a string is in the font it is drawn in. A string is measured once at
// 100px in its own family and weight; every other size is that width scaled, so a line can be fitted
// without drawing it again and again. Each text is measured with the font it is drawn in.

const widths = new Map();

function widthAt100(text, family, weight, fontFiles) {
  const key = `${family}\n${weight}\n${(fontFiles || []).join('|')}\n${text}`;
  if (widths.has(key)) return widths.get(key);
  let w = text.length * (family === DISPLAY ? 34 : 56); // a guess for when there are no fonts to ask
  if (fontFiles && fontFiles.length) {
    try {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="8000" height="300" viewBox="0 0 8000 300"><text x="0" y="200" font-family="${family}" font-weight="${weight}" font-size="100">${esc(text)}</text></svg>`;
      const box = new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: family } }).getBBox();
      if (box && Number.isFinite(box.width) && box.width > 0) w = box.width;
    } catch {
      /* keep the guess */
    }
  }
  widths.set(key, w);
  return w;
}

// spacing: letter spacing as a share of the font size
function widthOf(text, size, { family, weight = 400, fontFiles, spacing = 0 }) {
  return (widthAt100(text, family, weight, fontFiles) * size) / 100 + text.length * size * spacing;
}

// ---- the sentence ---------------------------------------------------------------------
// Two lines at most. It starts at 56px and shrinks two pixels at a time until it fits on one line or on two
// balanced ones. A sentence too long for two lines even at the smallest size is cut with an ellipsis.
const SENTENCE = { max: 56, min: 30, lead: 1.22 };

export function fitSentence(text, { width = 1072, fontFiles = [] } = {}) {
  const line = drawable(text, bodyFiles(fontFiles));
  const font = { family: BODY, weight: SENTENCE_WEIGHT, fontFiles };
  if (!line) return { size: SENTENCE.max, lines: [] };
  const words = line.split(' ');
  for (let size = SENTENCE.max; size >= SENTENCE.min; size -= 2) {
    if (widthOf(line, size, font) <= width) return { size, lines: [line] };
    let best = null;
    for (let k = 1; k < words.length; k += 1) {
      const a = words.slice(0, k).join(' ');
      const b = words.slice(k).join(' ');
      const wide = Math.max(widthOf(a, size, font), widthOf(b, size, font));
      if (!best || wide < best.wide) best = { wide, lines: [a, b] };
    }
    if (best && best.wide <= width) return { size, lines: best.lines };
  }
  // Two lines at the smallest size, filled from the top. What would not fit on the second line is left out.
  const size = SENTENCE.min;
  const lines = [];
  let current = '';
  let cut = false;
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (!current || widthOf(next, size, font) <= width) {
      current = next;
    } else if (lines.length < 1) {
      lines.push(current);
      current = word;
    } else {
      cut = true;
      break;
    }
  }
  lines.push(cut ? `${current}…` : current);
  return { size, lines };
}

// ---- the band -----------------------------------------------------------------------------
// The question in yellow on the black band, centered. A past day names its date, which makes it longer, so it
// shrinks one step at a time until it fits.
const BAND = { height: 110, max: 76, min: 44, spacing: 0.02 };

export function questionText(date, live) {
  const day = String(shortDate(date) || '').toUpperCase();
  return live || !day ? 'DID THE WORLD END TODAY?' : `DID THE WORLD END ON ${day}?`;
}

export function fitQuestion(text, { width = 1072, fontFiles = [] } = {}) {
  for (let size = BAND.max; size >= BAND.min; size -= 2) if (widthOf(text, size, { family: DISPLAY, fontFiles, spacing: BAND.spacing }) <= width) return size;
  return BAND.min;
}

// ---- the sign ---------------------------------------------------------------------------
const CAP_DISPLAY = 0.735; // cap height of League Gothic, as a share of its size
const CAP_BODY = 0.742; // and of Libre Franklin
const VERDICT = { size: 300, x: 59, top: 154 }; // x: so the letter itself starts at 64
const BOARD = { x: 800, w: 336, pad: 24 };

// date, score: the day's own numbers. headline: the day's headline (or the quiet line); the card shows its
// first sentence. live: the day is today, so the card asks about today; a past day asks about its own date.
// quiet: the whole site is in quiet mode, so the page is white and nothing is red.
// fontFiles: the three TTFs; they measure the text, and without them the fit is a guess.
export function ogSvg({ date, score, host, headline = '', fontFiles = [], live = true, quiet = false }) {
  const s = Math.round(num(score));
  const page = quiet ? WHITE : YELLOW;
  const on = quiet ? WHITE : YELLOW; // text on black
  const hot = quiet ? WHITE : RED; // the number on the board
  const question = questionText(date, live);
  const qSize = fitQuestion(question, { fontFiles });
  const qBase = Math.round(BAND.height / 2 + (qSize * CAP_DISPLAY) / 2);

  const base = VERDICT.top + Math.round(VERDICT.size * CAP_DISPLAY); // the baseline of ALMOST.
  const boardH = base - VERDICT.top;
  const inner = BOARD.x + BOARD.pad;
  const labelSize = 24;
  const labelBase = VERDICT.top + BOARD.pad + Math.round(labelSize * CAP_BODY);
  const squareSize = 20;
  const squareGap = 6;
  const squaresTop = base - BOARD.pad + 4 - squareSize;
  const numSize = 150;
  const numBase = squaresTop - 14;
  const filled = filledSquares(s);
  const boxes = Array.from({ length: 10 }, (_, i) => {
    const x = inner + i * (squareSize + squareGap);
    return i < filled
      ? `<rect x="${x}" y="${squaresTop}" width="${squareSize}" height="${squareSize}" fill="${on}"/>`
      : `<rect x="${x + 1}" y="${squaresTop + 1}" width="${squareSize - 2}" height="${squareSize - 2}" fill="none" stroke="${on}" stroke-width="2"/>`;
  }).join('\n');

  const fit = fitSentence(firstSentence(headline), { width: 1072, fontFiles });
  const lead = Math.round(fit.size * SENTENCE.lead);
  const first = base + 38 + Math.round(fit.size * CAP_BODY); // the first baseline of the sentence
  const lines = fit.lines.map((l, i) => `<text x="64" y="${first + i * lead}" font-family="${BODY}" font-weight="${SENTENCE_WEIGHT}" font-size="${fit.size}" fill="${INK}">${esc(l)}</text>`).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="${page}"/>
<rect width="1200" height="${BAND.height}" fill="${INK}"/>
<text x="600" y="${qBase}" text-anchor="middle" font-family="${DISPLAY}" font-size="${qSize}" letter-spacing="${(qSize * BAND.spacing).toFixed(1)}" fill="${on}">${esc(question)}</text>
<text x="${VERDICT.x}" y="${base}" font-family="${DISPLAY}" font-size="${VERDICT.size}" fill="${INK}">ALMOST.</text>
<rect x="${BOARD.x}" y="${VERDICT.top}" width="${BOARD.w}" height="${boardH}" fill="${INK}"/>
<text x="${inner}" y="${labelBase}" font-family="${BODY}" font-weight="${LABEL_WEIGHT}" font-size="${labelSize}" letter-spacing="${(labelSize * 0.08).toFixed(1)}" fill="${on}">DOOM SCORE</text>
<text x="${inner - 2}" y="${numBase}" font-family="${DISPLAY}" font-size="${numSize}" fill="${hot}">${s}</text>
${boxes}
${lines}
<text x="64" y="598" font-family="${BODY}" font-weight="${LABEL_WEIGHT}" font-size="26" fill="${INK}">${esc(String(host || ''))}</text>
</svg>
`;
}

export function renderPng(svg, { fontFiles = [], width }) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: DISPLAY },
  });
  return r.render().asPng();
}
