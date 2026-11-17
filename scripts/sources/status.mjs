// Status pages of big internet services (Statuspage-style /api/v2/status.json).
// A page in "major" or "critical" is a story and trips the "internet"
// category. Pages that do not answer are skipped; the source only fails when
// none answers.
import { statusRank } from '../lib/signals.mjs';
import { etDate } from '../lib/time.mjs';
import { capFirst, clean } from '../lib/text.mjs';

export const id = 'status';
export const GAP_MS = 150;
const KNOWN = new Set(['none', 'minor', 'major', 'critical', 'maintenance']);

export function statusUrl(page) {
  return `https://${page.host}/api/v2/status.json`;
}

export function parseStatus(json, page) {
  const raw = String(json?.status?.indicator ?? '').toLowerCase();
  if (!raw) return null;
  return {
    id: page.id,
    name: page.name,
    host: page.host,
    indicator: KNOWN.has(raw) ? raw : 'unknown',
    description: clean(json?.status?.description),
  };
}

export function statusSignal(page, reading, nowMs) {
  if (reading.indicator !== 'major' && reading.indicator !== 'critical') return null;
  return {
    id: `sig:status:${page.id}:${etDate(nowMs)}`,
    kind: 'signal',
    cat: 'internet',
    title: `${capFirst(page.name)} reports a ${reading.indicator} outage on its status page`,
    url: `https://${page.host}/`,
    source: `${capFirst(page.name)} status`,
    publishedAt: nowMs,
    rank: statusRank(reading.indicator),
    signal: { type: 'status', indicator: reading.indicator, page: page.id, description: reading.description },
  };
}

const ORDER = ['none', 'unknown', 'maintenance', 'minor', 'major', 'critical'];

export async function run(ctx) {
  const pages = ctx.config.statusPages;
  const readings = [];
  const signals = [];
  const failed = [];
  await Promise.all(
    pages.map(async (page) => {
      try {
        const json = await ctx.http.getJson(statusUrl(page), { key: page.host, gapMs: GAP_MS });
        const reading = parseStatus(json, page);
        if (!reading) throw new Error('no status in reply');
        readings.push(reading);
      } catch (err) {
        failed.push(`${page.id}: ${err.message}`);
      }
    }),
  );
  if (!readings.length) return { id, ok: false, count: 0, error: `no status page answered (${failed[0] || 'none tried'})` };
  // Keep the configured order so the saved file does not shuffle between runs.
  readings.sort((a, b) => pages.findIndex((p) => p.id === a.id) - pages.findIndex((p) => p.id === b.id));
  for (const r of readings) {
    const page = pages.find((p) => p.id === r.id);
    const sig = statusSignal(page, r, ctx.now.getTime());
    if (sig) signals.push(sig);
  }
  const worst = readings.reduce((w, r) => (ORDER.indexOf(r.indicator) > ORDER.indexOf(w) ? r.indicator : w), 'none');
  return {
    id,
    ok: true,
    count: signals.length,
    error: failed.length ? `${failed.length} of ${pages.length} pages did not answer` : null,
    vital: {
      status: {
        worst,
        pages: readings.map(({ id: pid, name, indicator, description }) => ({ id: pid, name, indicator, description })),
        unreachable: failed.length,
      },
    },
    signals,
  };
}
