// NASA/JPL close approaches. The closest one in the window is a vital sign
// (in lunar distances, with a size guess); an approach inside 1 lunar
// distance, in the next 48 hours or the past 24, is also a story.
import { asteroidRank, sizeMeters, sizeLabel, parseJplDate } from '../lib/signals.mjs';
import { addDays, etDate } from '../lib/time.mjs';
import { clean } from '../lib/text.mjs';

export const id = 'jpl';

export function cadUrl(now) {
  const today = now.toISOString().slice(0, 10);
  const min = addDays(today, -1);
  const max = addDays(today, 2);
  return `https://ssd-api.jpl.nasa.gov/cad.api?dist-max=0.05&date-min=${min}&date-max=${max}&sort=dist`;
}

export function sbdbUrl(des) {
  return `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(des)}`;
}

export function parseCad(json, now, signalsCfg) {
  const fields = Array.isArray(json?.fields) ? json.fields : [];
  const idx = (name) => fields.indexOf(name);
  const iDes = idx('des');
  const iCd = idx('cd');
  const iDist = idx('dist');
  const iH = idx('h');
  const nowMs = now.getTime();
  const win = signalsCfg.asteroidWindow;
  const rows = [];
  for (const r of Array.isArray(json?.data) ? json.data : []) {
    const au = Number(r[iDist]);
    const at = parseJplDate(r[iCd]);
    if (!Number.isFinite(au) || at === null) continue;
    const des = clean(r[iDes]);
    const ld = au * signalsCfg.lunarDistancePerAu;
    const meters = sizeMeters(r[iH], signalsCfg.albedo);
    rows.push({
      des,
      au,
      ld,
      at,
      sizeM: meters === null ? null : Math.round(meters * 10) / 10,
      size: sizeLabel(meters, signalsCfg.sizeBuckets),
      url: sbdbUrl(des),
    });
  }
  const inWindow = rows.filter((r) => r.at >= nowMs - win.pastHours * 3600 * 1000 && r.at <= nowMs + win.nextHours * 3600 * 1000);
  inWindow.sort((a, b) => a.ld - b.ld);
  const closest = inWindow[0] || null;
  const signals = inWindow
    .filter((r) => r.ld < win.storyWithinLd)
    .map((r) => ({
      id: `sig:asteroid:${r.des.replace(/\s+/g, '-')}:${etDate(r.at)}`,
      kind: 'signal',
      cat: 'space',
      title: `Asteroid ${r.des} passes at ${r.ld.toFixed(2)} lunar distances${r.size ? `, about the size of ${r.size}` : ''}`,
      url: r.url,
      source: 'NASA/JPL',
      // An approach still ahead of us is news now; one already past is dated when it happened.
      publishedAt: Math.min(r.at, nowMs),
      rank: asteroidRank(r.ld),
      signal: { type: 'asteroid', des: r.des, ld: Math.round(r.ld * 1000) / 1000, sizeM: r.sizeM, size: r.size, at: new Date(r.at).toISOString() },
    }));
  return {
    vital: closest
      ? { des: closest.des, ld: Math.round(closest.ld * 1000) / 1000, at: new Date(closest.at).toISOString(), sizeM: closest.sizeM, size: closest.size, url: closest.url, upcoming: closest.at > nowMs }
      : null,
    signals,
  };
}

export async function run(ctx) {
  try {
    const json = await ctx.http.getJson(cadUrl(ctx.now), { key: 'ssd-api.jpl.nasa.gov' });
    const out = parseCad(json, ctx.now, ctx.config.signals);
    return { id, ok: true, count: out.signals.length, error: null, vital: { asteroid: out.vital }, signals: out.signals };
  } catch (err) {
    return { id, ok: false, count: 0, error: err.message };
  }
}
