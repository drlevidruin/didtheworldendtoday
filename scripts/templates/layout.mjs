// The page shell: the comment, the head (security policy, titles, share
// cards), the inlined style, and the one external script.
import { css, css404 } from './css.mjs';
import { ALMANAC_NAV, COMMENT, CREDIT_HANDLE, CREDIT_URL, DESCRIPTION, FOOTER_LINES, FOOTER_LINES_QUIET, SITE_NAME, TAGLINE, TODAY_LINK, everyHeadline, updatedText } from './copy.mjs';
import { esc } from './esc.mjs';
import { WHITE, YELLOW } from './palette.mjs';
import { QUIP_CSP } from './quips.mjs';

// Section 8: nothing loads from anywhere but this site, and no script runs inline except one: the quip
// script under ALMOST., which the policy allows by the hash of its exact text (scripts/templates/quips.mjs).
export const CSP = `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' ${QUIP_CSP}; connect-src 'self'; font-src 'self'`;

// The font files the first screen draws, loaded before the stylesheet asks for them: League Gothic for the
// question, ALMOST. and the numbers, and Libre Franklin in the three weights of the headline (600), the
// labels and the board (700) and the lines (400).
export const PRELOADED_FONTS = ['leaguegothic.woff2', 'librefranklin-600.woff2', 'librefranklin-700.woff2', 'librefranklin-400.woff2'];

const IMAGE_ALT = "ALMOST. Did the world end today? The day's headline and the Doom Score.";

// opts: root, title, description, canonical, image (absolute), body,
//       data (extra attributes for <html>, already safe), script (bool)
export function page(opts) {
  const { root, title, description = DESCRIPTION, canonical, image, body, data = {}, script = true } = opts;
  const attrs = Object.entries({ root, ...data })
    .map(([k, v]) => ` data-${k}="${esc(v)}"`)
    .join('');
  return `<!doctype html>
<!-- ${COMMENT} -->
<html lang="en"${attrs}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${esc(CSP)}">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="theme-color" content="${data.quiet === '1' ? WHITE : YELLOW}">
<meta name="color-scheme" content="light">
<link rel="icon" href="${esc(root)}favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${esc(root)}apple-touch-icon.png">
<link rel="manifest" href="${esc(root)}site.webmanifest">
<link rel="alternate" type="application/rss+xml" title="${esc(SITE_NAME)}" href="${esc(root)}feed.xml">
${PRELOADED_FONTS.map((f) => `<link rel="preload" href="${esc(root)}assets/${f}" as="font" type="font/woff2" crossorigin>`).join('\n')}
${social({ title, description, canonical, image })}
<style>${css(root, { quiet: data.quiet === '1' })}</style>
${script ? `<script src="${esc(root)}assets/app.js" defer></script>\n` : ''}</head>
<body>
${body}
</body>
</html>
`;
}

export function social({ title, description, canonical, image }) {
  return [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(SITE_NAME)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(canonical)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(IMAGE_ALT)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:site" content="${esc(CREDIT_HANDLE)}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(image)}">`,
    `<meta name="twitter:image:alt" content="${esc(IMAGE_ALT)}">`,
  ].join('\n');
}

// What the footer says, small, at the bottom of every page: when the site last checked, the door to every
// headline of today, the pages (Today on any page but the homepage), who made it, and the footer lines.
// Quiet mode drops the tagline, which is a joke, and one of the lines.
//   home: this is the homepage, which needs no link to itself
//   updatedMs: when the data was last read well (epoch milliseconds); no time, no line
//   today, headlineCount: today's date and how many headlines it has; none, no link
export function footer({ root, quiet = false, home = true, updatedMs = NaN, today = '', headlineCount = 0 }) {
  const lines = (quiet ? FOOTER_LINES_QUIET : FOOTER_LINES).map((l) => `<p>${esc(l)}</p>`).join('\n');
  const tag = quiet ? '' : `<p class="tagline">${esc(TAGLINE)}</p>\n`;
  const updated = updatedText(updatedMs);
  const up = updated ? `<p class="up">${esc(updated)}</p>\n` : '';
  const count = Math.floor(Number(headlineCount));
  const all = today && count > 0 ? `<p class="all"><a href="${esc(root)}day/${esc(today)}/#all">${esc(everyHeadline(count))}</a></p>\n` : '';
  const links = [
    home ? '' : `<a href="${esc(root)}">${esc(TODAY_LINK)}</a>`,
    `<a href="${esc(root)}almanac/">${esc(ALMANAC_NAV)}</a>`,
    `<a href="${esc(root)}about/">About</a>`,
    `<a href="${esc(root)}feed.xml">RSS</a>`,
    `<a href="${esc(CREDIT_URL)}" target="_blank" rel="noopener">${esc(CREDIT_HANDLE)}</a>`,
  ].filter(Boolean);
  return `<footer>
${up}${all}<p class="fl">${links.join('\n')}</p>
${tag}${lines}
</footer>`;
}

// The 404 page is served at any depth: own style, the fonts and home by the absolute
// site address, no relative links.
export function notFoundPage({ siteUrl, line, linkText }) {
  const home = `${siteUrl}/`;
  const title = line;
  return `<!doctype html>
<!-- ${COMMENT} -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${esc(CSP)}">
<title>${esc(title)}</title>
<meta name="description" content="${esc(DESCRIPTION)}">
<meta name="robots" content="noindex">
<meta name="theme-color" content="${YELLOW}">
${social({ title, description: DESCRIPTION, canonical: home, image: `${siteUrl}/og/latest.png` })}
<style>${css404(siteUrl)}</style>
</head>
<body>
<main>
<h1>${esc(line)}</h1>
<p><a href="${esc(home)}">${esc(linkText)}</a></p>
</main>
</body>
</html>
`;
}
