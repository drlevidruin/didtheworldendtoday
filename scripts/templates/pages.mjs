// The Almanac page and the About page.
import { CREDIT_HANDLE, CREDIT_URL, DESCRIPTION, FIRST_DAY_PENDING, pageTitle, recordLine } from './copy.mjs';
import { esc, url } from './esc.mjs';
import { footer, page } from './layout.mjs';
import { almanacRows } from './parts.mjs';

function top(root) {
  return `<div class="top"><a href="${esc(root)}">&larr; Today</a><a href="${esc(root)}about/">About</a></div>`;
}

// entries: [{ date, score, headline }], newest first. Each row is a link to its day.
export function almanacPage({ root, siteUrl, entries, record, quiet }) {
  const recordText = recordLine(record, entries.length);
  const body = `<main id="main">
<div class="wrap">
${top(root)}
<h1 class="pg">The Almanac of Almost</h1>
${recordText ? `<p class="record">${esc(recordText)}</p>` : ''}
${entries.length ? almanacRows(entries, { root }) : `<p class="empty">${esc(FIRST_DAY_PENDING)}</p>`}
</div>
</main>
${footer({ root, quiet })}`;
  return page({
    root,
    title: pageTitle('The Almanac of Almost'),
    description: DESCRIPTION,
    canonical: `${siteUrl}/almanac/`,
    image: `${siteUrl}/og/latest.png`,
    body,
    data: { page: 'almanac' },
    script: false,
  });
}

// The Doom Score numbers come straight from config, so this page cannot
// drift from the rule the code uses.
function doomBullets(d) {
  return [
    `Kp ${d.kp.at} or more: +${d.kp.points} (Kp ${d.kp.bigAt} or more: +${d.kp.bigPoints} instead)`,
    `A quake of M${d.quake.at} or more: +${d.quake.points} (M${d.quake.bigAt} or more: +${d.quake.bigPoints} instead)`,
    `An asteroid inside ${d.asteroid.withinLd} lunar distance this week: +${d.asteroid.points} (inside ${d.asteroid.closeLd}: +${d.asteroid.closePoints} instead)`,
    `An FAA ground stop at a major hub: +${d.faa.hubPoints} (a nationwide ground stop: +${d.faa.nationwidePoints} instead)`,
    `Any big status page in major outage: +${d.status.points}`,
  ];
}

function sourceList(cfg, xEnabled) {
  const items = [
    ['https://news.google.com/', 'Google News', 'headlines for every category'],
    ['https://www.bing.com/news', 'Bing News', 'a second set of headlines'],
    ['https://www.gdeltproject.org/', 'GDELT', 'a bonus set of headlines, when it answers'],
    ['https://news.ycombinator.com/', 'Hacker News', 'tech outages and breaches'],
    ['https://earthquake.usgs.gov/', 'USGS', 'earthquakes'],
    ['https://www.swpc.noaa.gov/', 'NOAA Space Weather Prediction Center', 'Kp and solar alerts'],
    ['https://cneos.jpl.nasa.gov/ca/', 'NASA/JPL close approaches', 'asteroids'],
    ['https://nasstatus.faa.gov/', 'FAA National Airspace System status', 'ground stops'],
  ];
  const rows = items.map(([href, name, what]) => `<li><a href="${url(href)}" target="_blank" rel="noopener">${esc(name)}</a>: ${esc(what)}</li>`);
  // The status pages are named for the big names; the list ends with "and more".
  const links = (cfg.statusPages || []).map((p) => `<a href="${url(`https://${p.host}/`)}" target="_blank" rel="noopener">${esc(p.name)}</a>`);
  const text = links.length ? `${links.join(', ')} and more` : 'the status pages of big services';
  rows.push(`<li>Status pages: ${text}, for "is the internet down"</li>`);
  if (xEnabled) rows.push(`<li><a href="https://x.com/" target="_blank" rel="noopener">X</a>: live posts from breaking news accounts</li>`);
  return `<ul>\n${rows.join('\n')}\n</ul>`;
}

export function aboutPage({ root, siteUrl, cfg, quiet, xEnabled = false }) {
  const d = cfg.doom;
  const fire =
    `A category fires when ${d.publishersToFire} or more different publishers have a headline in it in the last 24 hours. ` +
    `It also fires when its instrument trips: an FAA ground stop, an asteroid inside ${d.asteroid.withinLd} lunar distance, ` +
    `Kp ${d.kp.at} or more or an X-class flare alert, a quake of M${d.quake.at} or more, or a big status page in major outage.`;
  const body = `<main id="main">
<div class="wrap">
${top(root)}
<h1 class="pg">About</h1>
<div class="prose">
<p class="lede">This site checks the news every 15 minutes for the ways the world almost ends. A system fails. A flight is grounded. A big rock misses us. Every story links to its source, and every day is kept in the Almanac of Almost.</p>
<p class="scope">We leave out headlines about people being killed, hurt or attacked.</p>

<h2>The Doom Score</h2>
<p>The Doom Score runs from 0 to ${d.cap}. It is plain arithmetic.</p>
<p>${esc(fire)}</p>
<p>Each fired category is worth ${d.perCategory} points. The floor is ${d.floor}, because there is always something. The cap is ${d.cap}, because it is never 100. Then come the extras:</p>
<ul>
${doomBullets(d)
  .map((t) => `<li>${esc(t)}</li>`)
  .join('\n')}
</ul>

<h2>Where it comes from</h2>
<p>We read the news and watch the sky and the internet: asteroids, solar storms, earthquakes, and the big status pages.</p>
${sourceList(cfg, xEnabled)}

<h2>Quiet cards and quiet mode</h2>
<p>A quiet card is a story about something that could hurt people, like a big quake, a flood or a fire. It gets no joke. Just the plain facts. When people are likely hurt, it also links to the Red Cross. For a quake abroad, it links to the international Red Cross and Red Crescent.</p>
<p>Quiet mode is the whole site going plain. It comes on when a deadly disaster takes over the news, or when someone switches it on by hand. The jokes stop until it passes.</p>

<h2>Headlines</h2>
<p>We show headlines and links only. Publishers who want a headline removed can DM <a href="${esc(CREDIT_URL)}" target="_blank" rel="noopener">${esc(CREDIT_HANDLE)}</a> on X.</p>

<h2>Credits</h2>
<p>Built by <a href="${esc(CREDIT_URL)}" target="_blank" rel="noopener">${esc(CREDIT_HANDLE)}</a> with Claude, an AI. Claude writes each day's headline and the short line on each story, from that day's headlines. It can get things wrong, so every line links to its source.</p>
</div>
</div>
</main>
${footer({ root, quiet })}`;
  return page({
    root,
    title: pageTitle('About'),
    description: DESCRIPTION,
    canonical: `${siteUrl}/about/`,
    image: `${siteUrl}/og/latest.png`,
    body,
    data: { page: 'about' },
    script: false,
  });
}
