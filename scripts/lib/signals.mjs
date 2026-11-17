// Small pure helpers for the instrument signals: severity ranks (signals rank
// by severity, on the same scale as news ranks), the Kp storm scale, and the
// asteroid size model.

export function quakeRank(mag) {
  if (mag >= 8) return 9;
  if (mag >= 7) return 6.5;
  if (mag >= 6.5) return 4.5;
  return 3.5;
}

export function kpRank(kp) {
  if (kp >= 9) return 10;
  if (kp >= 8) return 8;
  if (kp >= 7) return 6;
  if (kp >= 6) return 4.5;
  return 3.5;
}

// NOAA geomagnetic storm scale from Kp.
export function kpScale(kp) {
  if (kp >= 9) return { g: 'G5', label: 'extreme' };
  if (kp >= 8) return { g: 'G4', label: 'severe' };
  if (kp >= 7) return { g: 'G3', label: 'strong' };
  if (kp >= 6) return { g: 'G2', label: 'moderate' };
  if (kp >= 5) return { g: 'G1', label: 'minor' };
  return null;
}

export function asteroidRank(ld) {
  if (ld < 0.1) return 7;
  if (ld < 0.5) return 4.5;
  return 3.5;
}

export function statusRank(indicator) {
  return indicator === 'critical' ? 5 : 3.5;
}

// X1 and up. Bigger flares rank higher.
export function flareRank(flareClass) {
  const m = /^X(\d+(?:\.\d+)?)/i.exec(flareClass || '');
  const n = m ? Number(m[1]) : 1;
  if (n >= 10) return 8.5;
  if (n >= 5) return 6.5;
  return 4.5;
}

export function rScaleForFlare(flareClass) {
  const m = /^X(\d+(?:\.\d+)?)/i.exec(flareClass || '');
  if (!m) return null;
  const n = Number(m[1]);
  if (n >= 20) return 'R5';
  if (n >= 10) return 'R4';
  return 'R3';
}

// Diameter in metres from absolute magnitude H: D = 1329 km / sqrt(albedo) x 10^(-H/5).
export function sizeMeters(h, albedo = 0.14) {
  const hh = Number(h);
  if (!Number.isFinite(hh)) return null;
  return (1329000 / Math.sqrt(albedo)) * 10 ** (-hh / 5);
}

export function sizeLabel(meters, buckets) {
  if (!Number.isFinite(meters)) return null;
  for (const b of buckets) if (meters <= b.maxM) return b.label;
  return buckets[buckets.length - 1].label;
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

// JPL "cd" looks like "2026-Nov-17 07:59" (treated as UTC; the offset from TDB is about a minute).
export function parseJplDate(cd) {
  const m = /^(\d{4})-([A-Za-z]{3})-(\d{2}) (\d{2}):(\d{2})/.exec(String(cd || ''));
  if (!m || MONTHS[m[2]] === undefined) return null;
  return Date.UTC(Number(m[1]), MONTHS[m[2]], Number(m[3]), Number(m[4]), Number(m[5]));
}
