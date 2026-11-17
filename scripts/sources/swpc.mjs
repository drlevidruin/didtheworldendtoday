// NOAA SWPC: Kp now (vital sign), a geomagnetic storm story when Kp reaches 5,
// and X-class flare alerts. Geomagnetic stories come from the Kp feed only,
// so the same storm is never counted twice through the alerts feed.
import { kpRank, kpScale, flareRank, rScaleForFlare } from '../lib/signals.mjs';
import { etDate } from '../lib/time.mjs';

export const id = 'swpc';
export const KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
export const ALERTS_URL = 'https://services.swpc.noaa.gov/products/alerts.json';
export const KP_PAGE = 'https://www.swpc.noaa.gov/products/planetary-k-index';
export const ALERTS_PAGE = 'https://www.swpc.noaa.gov/products/alerts-watches-and-warnings';

// The Kp feed has been both an array of objects and an array of arrays with a
// header row. Accept either.
export function parseKpRows(json) {
  if (!Array.isArray(json) || !json.length) return [];
  const rows = [];
  if (Array.isArray(json[0])) {
    const header = json[0].map((h) => String(h).toLowerCase());
    const ti = header.indexOf('time_tag');
    const ki = header.indexOf('kp');
    for (const r of json.slice(1)) {
      const t = Date.parse(`${String(r[ti])}Z`);
      const kp = Number(r[ki]);
      if (Number.isFinite(t) && Number.isFinite(kp)) rows.push({ t, kp });
    }
  } else {
    for (const r of json) {
      const t = Date.parse(`${String(r.time_tag)}Z`);
      const kp = Number(r.Kp ?? r.kp);
      if (Number.isFinite(t) && Number.isFinite(kp)) rows.push({ t, kp });
    }
  }
  return rows.sort((a, b) => a.t - b.t);
}

export function kpSignals(rows, nowMs, lookbackHours = 36) {
  const recent = rows.filter((r) => r.t >= nowMs - lookbackHours * 3600 * 1000 && r.t <= nowMs);
  const byDay = new Map();
  for (const r of recent) {
    const day = etDate(r.t);
    const cur = byDay.get(day);
    if (!cur || r.kp > cur.kp) byDay.set(day, r);
  }
  const out = [];
  for (const [day, r] of byDay) {
    const scale = kpScale(r.kp);
    if (!scale) continue;
    out.push({
      id: `sig:kp:${day}`,
      kind: 'signal',
      cat: 'sun',
      title: `Geomagnetic storm reaches Kp ${r.kp.toFixed(1)} (${scale.g}, ${scale.label})`,
      url: KP_PAGE,
      source: 'NOAA SWPC',
      publishedAt: r.t,
      rank: kpRank(r.kp),
      signal: { type: 'kp', kp: r.kp, scale: scale.g },
    });
  }
  return out;
}

function field(message, name) {
  const m = new RegExp(`^${name}:\\s*(.+)$`, 'mi').exec(message);
  return m ? m[1].trim() : '';
}

function parseSwpcTime(s) {
  // "2026 Nov 16 1530 UTC"
  const m = /^(\d{4}) ([A-Za-z]{3}) (\d{2}) (\d{2})(\d{2}) UTC$/.exec(String(s || '').trim());
  if (!m) return null;
  const idx = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(m[2]);
  return idx < 0 ? null : Date.UTC(+m[1], idx, +m[3], +m[4], +m[5]);
}

// X-class flare summaries: "SUMMARY: X-ray Event exceeded X1 ... X-ray Class: X1.4".
export function flareSignals(alerts, nowMs, lookbackHours = 36) {
  const out = [];
  for (const a of Array.isArray(alerts) ? alerts : []) {
    const message = String(a?.message || '');
    const cls = /X-ray Class:\s*(X\d+(?:\.\d+)?)/i.exec(message)?.[1] || /exceeded\s+(X\d+(?:\.\d+)?)/i.exec(message)?.[1];
    if (!cls) continue;
    const when =
      parseSwpcTime(field(message, 'Maximum Time')) ??
      parseSwpcTime(field(message, 'Threshold Reached')) ??
      parseSwpcTime(field(message, 'Begin Time')) ??
      parseSwpcTime(field(message, 'Issue Time')) ??
      Date.parse(`${String(a.issue_datetime || '').replace(' ', 'T')}Z`);
    if (!Number.isFinite(when) || when < nowMs - lookbackHours * 3600 * 1000 || when > nowMs + 3600 * 1000) continue;
    const r = rScaleForFlare(cls);
    out.push({
      // One story per hour: the alert and the summary of one flare land in the same hour.
      id: `sig:flare:${new Date(when).toISOString().slice(0, 13)}`,
      kind: 'signal',
      cat: 'sun',
      title: `X-class solar flare ${cls.toUpperCase()}${r ? ` (${r} radio blackout)` : ''}`,
      url: ALERTS_PAGE,
      source: 'NOAA SWPC',
      publishedAt: when,
      rank: flareRank(cls),
      signal: { type: 'flare', cls: cls.toUpperCase(), scale: r },
    });
  }
  return out;
}

export async function run(ctx) {
  const nowMs = ctx.now.getTime();
  let kpJson = null;
  let alertsJson = null;
  const errors = [];
  try {
    kpJson = await ctx.http.getJson(KP_URL, { key: 'services.swpc.noaa.gov', gapMs: 300 });
  } catch (err) {
    errors.push(`kp: ${err.message}`);
  }
  try {
    alertsJson = await ctx.http.getJson(ALERTS_URL, { key: 'services.swpc.noaa.gov', gapMs: 300 });
  } catch (err) {
    errors.push(`alerts: ${err.message}`);
  }
  if (kpJson === null && alertsJson === null) {
    return { id, ok: false, count: 0, error: errors.join('; ') };
  }
  const rows = kpJson ? parseKpRows(kpJson) : [];
  const last = rows.filter((r) => r.t <= nowMs + 3 * 3600 * 1000).slice(-1)[0] || null;
  const signals = [...kpSignals(rows, nowMs), ...(alertsJson ? flareSignals(alertsJson, nowMs) : [])];
  const vital = kpJson
    ? { kp: last ? { value: last.kp, time: new Date(last.t).toISOString(), max24: Math.max(0, ...rows.filter((r) => r.t >= nowMs - 24 * 3600 * 1000 && r.t <= nowMs).map((r) => r.kp)) } : null }
    : {};
  return {
    id,
    ok: true,
    count: signals.length,
    error: errors.length ? `partial: ${errors.join('; ')}` : null,
    partial: errors.length > 0,
    vital,
    signals,
  };
}
