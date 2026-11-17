// USGS: the biggest quake in the last day is a vital sign; a quake of
// magnitude 6 or more is also a story (a signal).
import { quakeRank } from '../lib/signals.mjs';
import { clean } from '../lib/text.mjs';

export const id = 'usgs';
export const URL_4_5_DAY = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson';

export function parseUsgs(json, { minMag }) {
  const features = Array.isArray(json?.features) ? json.features : [];
  const quakes = [];
  for (const f of features) {
    const p = f?.properties || {};
    const mag = Number(p.mag);
    if (!Number.isFinite(mag) || !Number.isFinite(Number(p.time))) continue;
    quakes.push({
      id: String(f.id || p.code || `${p.time}`),
      mag,
      place: clean(p.place),
      title: clean(p.title) || `M ${mag.toFixed(1)} - ${clean(p.place)}`,
      time: Number(p.time),
      url: p.url || `https://earthquake.usgs.gov/earthquakes/eventpage/${f.id}`,
      pager: p.alert || null,
      tsunami: Boolean(p.tsunami),
    });
  }
  quakes.sort((a, b) => b.mag - a.mag || b.time - a.time);
  const biggest = quakes[0] || null;
  const signals = quakes
    .filter((q) => q.mag >= minMag)
    .map((q) => ({
      id: `sig:quake:${q.id}`,
      kind: 'signal',
      cat: 'earth',
      title: q.title,
      url: q.url,
      source: 'USGS',
      publishedAt: q.time,
      rank: quakeRank(q.mag),
      signal: { type: 'quake', mag: q.mag, place: q.place, pager: q.pager, tsunami: q.tsunami },
    }));
  return {
    vital: biggest
      ? { mag: biggest.mag, place: biggest.place, time: new Date(biggest.time).toISOString(), url: biggest.url, pager: biggest.pager, tsunami: biggest.tsunami }
      : null,
    signals,
  };
}

export async function run(ctx) {
  try {
    const json = await ctx.http.getJson(URL_4_5_DAY, { key: 'earthquake.usgs.gov' });
    const out = parseUsgs(json, ctx.config.signals.quake);
    return { id, ok: true, count: out.signals.length, error: null, vital: { quake: out.vital }, signals: out.signals };
  } catch (err) {
    return { id, ok: false, count: 0, error: err.message };
  }
}
