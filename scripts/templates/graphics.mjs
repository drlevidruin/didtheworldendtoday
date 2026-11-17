// The pictures: the favicon, the app icon and the 1200x630 share image. The
// share image is an SVG drawn here and turned into a PNG by resvg with the
// Anton TTF, so it looks the same on any machine. No emoji glyphs in it: the
// fired categories are orange squares, the rest dark ones.
import path from 'node:path';
import resvg from '@resvg/resvg-js';
import { longDate } from './copy.mjs';
import { esc, num } from './esc.mjs';

const { Resvg } = resvg;

const BG = '#0B0B0F';
const INK = '#F2EFE8';
const HOT = '#FF6A00';
const MUTE = '#8C8C94';
const OFF = '#1C1C23';

export function faviconSvg({ rounded = true } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
<rect width="64" height="64"${rounded ? ' rx="14"' : ''} fill="${BG}"/>
<circle cx="32" cy="32" r="21" fill="none" stroke="${HOT}" stroke-opacity="0.4" stroke-width="3"/>
<circle cx="32" cy="32" r="11" fill="${HOT}"/>
</svg>
`;
}

// categories: the 12 in grid order; fired: ids that fired; line: the sentence
// under ALMOST. (the ladder line for the score, or the quiet line in quiet mode)
export function ogSvg({ date, score, fired, categories, host, line = '' }) {
  const on = new Set(fired || []);
  const cell = 88;
  const gap = 12;
  const gridW = 4 * cell + 3 * gap;
  const gx = 1200 - 64 - gridW;
  const gy = 168;
  const cells = categories
    .map((c, i) => {
      const x = gx + (i % 4) * (cell + gap);
      const y = gy + Math.floor(i / 4) * (cell + gap);
      return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="14" fill="${on.has(c.id) ? HOT : OFF}"/>`;
    })
    .join('\n');
  const s = Math.round(num(score));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="${BG}"/>
<text x="64" y="118" font-family="Anton" font-size="40" letter-spacing="4.5" fill="${INK}" fill-opacity="0.7">DID THE WORLD END TODAY?</text>
<text x="58" y="340" font-family="Anton" font-size="190" fill="${INK}">ALMOST.</text>
${line ? `<text x="64" y="410" font-family="Anton" font-size="44" letter-spacing="2.5" fill="${INK}">${esc(String(line).toUpperCase())}</text>\n` : ''}<text x="64" y="476" font-family="Anton" font-size="34" letter-spacing="3" fill="${MUTE}">${esc(longDate(date).toUpperCase())}</text>
<text x="64" y="570" font-family="Anton" font-size="100"><tspan fill="${INK}" font-size="52" letter-spacing="3">DOOM </tspan><tspan fill="${HOT}">${s}</tspan><tspan fill="${MUTE}" font-size="52">/99</tspan></text>
${cells}
<text x="${1200 - 64}" y="596" text-anchor="end" font-family="Anton" font-size="26" letter-spacing="2.5" fill="${MUTE}">${esc(String(host || '').toUpperCase())}</text>
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
