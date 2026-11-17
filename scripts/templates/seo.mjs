// robots.txt, sitemap.xml and the web app manifest.
import { SITE_NAME, TAGLINE } from './copy.mjs';
import { esc } from './esc.mjs';
import { etDate } from '../lib/time.mjs';

export function robotsTxt(siteUrl) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`;
}

// dates: every stored ET day; lastmod: ISO time of the newest build, written as its Eastern date
export function sitemapXml({ siteUrl, dates, lastmod }) {
  const built = Date.parse(lastmod);
  const day = Number.isFinite(built) ? etDate(built) : '';
  const urls = [
    { loc: `${siteUrl}/`, mod: day },
    { loc: `${siteUrl}/almanac/`, mod: day },
    { loc: `${siteUrl}/about/`, mod: '' },
    ...dates.map((d) => ({ loc: `${siteUrl}/day/${d}/`, mod: d })),
  ];
  const rows = urls.map((u) => `<url><loc>${esc(u.loc)}</loc>${u.mod ? `<lastmod>${esc(u.mod)}</lastmod>` : ''}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows.join('\n')}
</urlset>
`;
}

// Relative on purpose: the same build is served from a subfolder and from the root.
export function manifestJson() {
  return (
    JSON.stringify(
      {
        name: SITE_NAME,
        short_name: 'ALMOST.',
        description: TAGLINE,
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#0B0B0F',
        theme_color: '#0B0B0F',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
        ],
      },
      null,
      2,
    ) + '\n'
  );
}
