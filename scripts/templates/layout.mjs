// The page shell: the comment, the head (security policy, titles, share
// cards), the inlined style, and the one external script.
import { CSS_404, css } from './css.mjs';
import { COMMENT, CREDIT_HANDLE, CREDIT_URL, DESCRIPTION, FOOTER_LINES, FOOTER_LINES_QUIET, SITE_NAME } from './copy.mjs';
import { esc } from './esc.mjs';

// Section 8: nothing loads from anywhere but this site, no inline script.
export const CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'";

const IMAGE_ALT = 'ALMOST. Did the world end today? The Doom Score and the grid of what fired.';

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
<meta name="theme-color" content="#0B0B0F">
<meta name="color-scheme" content="dark">
<link rel="icon" href="${esc(root)}favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${esc(root)}apple-touch-icon.png">
<link rel="manifest" href="${esc(root)}site.webmanifest">
<link rel="alternate" type="application/rss+xml" title="${esc(SITE_NAME)}" href="${esc(root)}feed.xml">
<link rel="preload" href="${esc(root)}assets/anton.woff2" as="font" type="font/woff2" crossorigin>
${social({ title, description, canonical, image })}
<style>${css(root)}</style>
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
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(image)}">`,
    `<meta name="twitter:image:alt" content="${esc(IMAGE_ALT)}">`,
  ].join('\n');
}

export function footer({ root, quiet = false }) {
  const lines = (quiet ? FOOTER_LINES_QUIET : FOOTER_LINES).map((l) => `<p>${esc(l)}</p>`).join('\n');
  return `<footer>
${lines}
<p class="by">by <a href="${esc(CREDIT_URL)}" target="_blank" rel="noopener">${esc(CREDIT_HANDLE)}</a></p>
<nav aria-label="More">
<a href="${esc(root)}almanac/">Almanac</a>
<a href="${esc(root)}about/">About</a>
<a href="${esc(root)}feed.xml">RSS</a>
</nav>
</footer>`;
}

// The 404 page is served at any depth: own style, system fonts, no relative
// links, home by the absolute site address.
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
<meta name="theme-color" content="#0B0B0F">
${social({ title, description: DESCRIPTION, canonical: home, image: `${siteUrl}/og/latest.png` })}
<style>${CSS_404}</style>
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
