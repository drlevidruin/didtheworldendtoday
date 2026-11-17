// The Doom Score: a plain, published rule with no tuning constant.
//
// A category FIRES when 3 or more distinct publishers have kept headlines in
// it, or when its instrument trips (flights: an FAA ground stop; space: an
// asteroid inside 1 lunar distance; sun: Kp 5 or more or an X-class flare;
// earth: a quake of M6 or more; internet: a big status page in major or
// critical outage).
//
// Score = 6 per fired category + fixed instrument bumps, floor 11, cap 99.
//
// It is a pure function of a list of stories, so a day page, the rolling
// 24 hours and a test all get the same answer from the same stories.
import { publisherKey } from './text.mjs';

export function readInstruments(stories) {
  const inst = {
    kp: 0,
    quake: 0,
    asteroidLd: Infinity,
    faaStop: false,
    faaHub: false,
    faaNationwide: false,
    statusMajor: false,
    flareX: false,
  };
  for (const s of stories) {
    if (s.kind !== 'signal' || !s.signal) continue;
    const g = s.signal;
    if (g.type === 'kp') inst.kp = Math.max(inst.kp, Number(g.kp) || 0);
    else if (g.type === 'quake') inst.quake = Math.max(inst.quake, Number(g.mag) || 0);
    else if (g.type === 'asteroid') inst.asteroidLd = Math.min(inst.asteroidLd, Number(g.ld));
    else if (g.type === 'faa-ground-stop') {
      inst.faaStop = true;
      if (g.hub) inst.faaHub = true;
      if (g.nationwide) inst.faaNationwide = true;
    } else if (g.type === 'status') {
      if (g.indicator === 'major' || g.indicator === 'critical') inst.statusMajor = true;
    } else if (g.type === 'flare') inst.flareX = true;
  }
  return inst;
}

export function computeDoom(stories, { categories, doom }) {
  const publishers = new Map(categories.map((c) => [c.id, new Set()]));
  for (const s of stories) {
    if (s.kind === 'signal') continue;
    const set = publishers.get(s.cat);
    if (!set) continue;
    for (const name of s.outletNames && s.outletNames.length ? s.outletNames : [s.source]) {
      const key = publisherKey(name);
      if (key) set.add(key);
    }
  }
  const inst = readInstruments(stories);
  const trips = {
    flights: inst.faaStop,
    space: inst.asteroidLd < doom.asteroid.withinLd,
    sun: inst.kp >= doom.kp.at || inst.flareX,
    earth: inst.quake >= doom.quake.at,
    internet: inst.statusMajor,
  };
  const fired = categories
    .filter((c) => trips[c.id] || publishers.get(c.id).size >= doom.publishersToFire)
    .map((c) => c.id);

  const bumps = [];
  if (inst.kp >= doom.kp.bigAt) bumps.push({ key: 'kp', label: `Kp ${doom.kp.bigAt} or more`, points: doom.kp.bigPoints });
  else if (inst.kp >= doom.kp.at) bumps.push({ key: 'kp', label: `Kp ${doom.kp.at} or more`, points: doom.kp.points });

  if (inst.quake >= doom.quake.bigAt) bumps.push({ key: 'quake', label: `Quake M${doom.quake.bigAt} or more`, points: doom.quake.bigPoints });
  else if (inst.quake >= doom.quake.at) bumps.push({ key: 'quake', label: `Quake M${doom.quake.at} or more`, points: doom.quake.points });

  if (inst.asteroidLd < doom.asteroid.closeLd) bumps.push({ key: 'asteroid', label: `Asteroid inside ${doom.asteroid.closeLd} lunar distance`, points: doom.asteroid.closePoints });
  else if (inst.asteroidLd < doom.asteroid.withinLd) bumps.push({ key: 'asteroid', label: `Asteroid inside ${doom.asteroid.withinLd} lunar distance`, points: doom.asteroid.points });

  if (inst.faaNationwide) bumps.push({ key: 'faa', label: 'Nationwide ground stop', points: doom.faa.nationwidePoints });
  else if (inst.faaHub) bumps.push({ key: 'faa', label: 'Ground stop at a major hub', points: doom.faa.hubPoints });

  if (inst.statusMajor) bumps.push({ key: 'status', label: 'Big status page in major outage', points: doom.status.points });

  const base = fired.length * doom.perCategory;
  const total = base + bumps.reduce((sum, b) => sum + b.points, 0);
  const score = Math.min(doom.cap, Math.max(doom.floor, Math.round(total)));
  const counts = {};
  for (const [id, set] of publishers) counts[id] = set.size;
  return { score, fired, base, bumps, total, publishers: counts, instruments: inst };
}
