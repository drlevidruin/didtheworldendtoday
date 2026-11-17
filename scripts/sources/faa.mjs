// FAA National Airspace System status (XML). Ground stops are stories and
// trip the "flights" category; ground delay programs and closures are only
// vital-sign counts.
//
// The feed lists each program type as a <Delay_type> with a <Name> and a list
// of rows, each row carrying an <ARPT> airport code. The exact names of the
// list and row elements have changed over the years, so rows are found by the
// presence of <ARPT> and the program type by the text of <Name>.
import { XMLParser } from 'fast-xml-parser';
import { clean } from '../lib/text.mjs';
import { etDate } from '../lib/time.mjs';

export const id = 'faa';
export const API_URL = 'https://nasstatus.faa.gov/api/airport-status-information';
export const PAGE_URL = 'https://nasstatus.faa.gov/';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => name === 'Delay_type',
});

function text(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return clean(v['#text'] ?? '');
  return clean(v);
}

function rowsIn(node, out = []) {
  if (Array.isArray(node)) {
    for (const n of node) rowsIn(n, out);
  } else if (node && typeof node === 'object') {
    if (Object.hasOwn(node, 'ARPT')) out.push(node);
    else for (const v of Object.values(node)) rowsIn(v, out);
  }
  return out;
}

function parseUpdateTime(s) {
  // "Tue Nov 17 03:18:39 2026 GMT"
  const ms = Date.parse(String(s || '').replace(/\bGMT\b/, 'UTC'));
  return Number.isFinite(ms) ? ms : null;
}

// Airport closures that are really notices (night curfews, general aviation
// restrictions) are not counted as closures.
const NOT_A_CLOSURE = /\b(?:DLY|NON ?SKED|TRANSIENT|PPR|GA ACFT)\b/i;

export function parseFaa(xml, cfg) {
  let doc;
  try {
    doc = parser.parse(String(xml ?? ''));
  } catch (err) {
    throw new Error(`FAA feed is not XML: ${err.message}`);
  }
  const root = doc?.AIRPORT_STATUS_INFORMATION;
  if (!root) throw new Error('FAA feed has no AIRPORT_STATUS_INFORMATION');
  const stops = [];
  const delays = [];
  const closures = [];
  for (const dt of Array.isArray(root.Delay_type) ? root.Delay_type : []) {
    const name = text(dt.Name).toLowerCase();
    const rows = rowsIn({ ...dt, Name: undefined });
    for (const r of rows) {
      const arpt = text(r.ARPT).toUpperCase();
      if (!/^[A-Z0-9]{3,4}$/.test(arpt)) continue;
      if (/ground stop/.test(name)) {
        stops.push({ arpt, reason: text(r.Reason), endTime: text(r.End_Time) });
      } else if (/ground delay/.test(name)) {
        delays.push({ arpt, reason: text(r.Reason), avg: text(r.Avg), max: text(r.Max) });
      } else if (/closure/.test(name)) {
        const reason = text(r.Reason);
        if (!NOT_A_CLOSURE.test(reason)) closures.push({ arpt, reopen: text(r.Reopen) });
      }
    }
  }
  const hubs = new Set(cfg.hubs);
  const uniqueStops = [...new Map(stops.map((s) => [s.arpt, s])).values()];
  const nationwide =
    uniqueStops.length >= cfg.nationwideAirports || uniqueStops.some((s) => cfg.nationwideReason.test(s.reason));
  return {
    updatedAt: parseUpdateTime(text(root.Update_Time)),
    stops: uniqueStops.map((s) => ({ ...s, hub: hubs.has(s.arpt) })),
    nationwide,
    delays: [...new Map(delays.map((d) => [d.arpt, d])).values()],
    closures,
  };
}

const MAX_STORIES = 5;

export function faaSignals(parsed, nowMs) {
  const day = etDate(nowMs);
  const ordered = [...parsed.stops].sort((a, b) => Number(b.hub) - Number(a.hub) || (a.arpt < b.arpt ? -1 : 1));
  return ordered.slice(0, MAX_STORIES).map((s) => ({
    id: `sig:faa-stop:${s.arpt}:${day}`,
    kind: 'signal',
    cat: 'flights',
    title: `FAA ground stop at ${s.arpt}${s.reason ? ` (${s.reason})` : ''}`,
    url: PAGE_URL,
    source: 'FAA',
    publishedAt: nowMs,
    rank: parsed.nationwide ? 8 : s.hub ? 4.5 : 3.5,
    signal: { type: 'faa-ground-stop', airport: s.arpt, hub: s.hub, nationwide: parsed.nationwide, reason: s.reason },
  }));
}

export function faaVital(parsed) {
  return {
    groundStops: parsed.stops.map((s) => ({ airport: s.arpt, hub: s.hub, reason: s.reason })),
    nationwide: parsed.nationwide,
    groundDelays: parsed.delays.length,
    closures: parsed.closures.length,
    url: PAGE_URL,
  };
}

export async function run(ctx) {
  try {
    const xml = await ctx.http.getText(API_URL, { key: 'nasstatus.faa.gov', accept: 'application/xml, text/xml' });
    const parsed = parseFaa(xml, ctx.config.faa);
    const signals = faaSignals(parsed, ctx.now.getTime());
    return { id, ok: true, count: signals.length, error: null, vital: { faa: faaVital(parsed) }, signals };
  } catch (err) {
    return { id, ok: false, count: 0, error: err.message };
  }
}
