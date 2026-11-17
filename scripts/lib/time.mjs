// Edition days are America/New_York calendar dates. Everything that buckets
// a time into a day goes through here, so midnight and the two clock changes
// are handled in one place.
const ET = 'America/New_York';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: ET,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function etParts(input) {
  const d = input instanceof Date ? input : new Date(input);
  const p = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
    date: `${p.year}-${p.month}-${p.day}`,
  };
}

// 'YYYY-MM-DD' of the ET calendar day containing this instant.
export function etDate(input) {
  return etParts(input).date;
}

export function isDateStr(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
}

// Pure calendar arithmetic on a date string (no clock involved).
export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// [start, end) of an ET day as UTC Dates. Midnight always exists in ET (the
// clock changes happen at 2 AM), so exactly one of the two candidates fits.
export function etDayBounds(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  let start = null;
  for (const hourUtc of [4, 5]) {
    const cand = new Date(Date.UTC(y, m - 1, d, hourUtc, 0, 0));
    const p = etParts(cand);
    if (p.date === dateStr && p.hour === 0 && p.minute === 0) {
      start = cand;
      break;
    }
  }
  if (!start) throw new Error(`Cannot find ET midnight for ${dateStr}`);
  const nextStr = addDays(dateStr, 1);
  const [ny, nm, nd] = nextStr.split('-').map(Number);
  let end = null;
  for (const hourUtc of [4, 5]) {
    const cand = new Date(Date.UTC(ny, nm - 1, nd, hourUtc, 0, 0));
    const p = etParts(cand);
    if (p.date === nextStr && p.hour === 0 && p.minute === 0) {
      end = cand;
      break;
    }
  }
  if (!end) throw new Error(`Cannot find ET midnight for ${nextStr}`);
  return { start, end };
}

// '2026-11-16 22:15 ET', used in commit messages and the run summary.
export function etStamp(input) {
  const p = etParts(input);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.date} ${pad(p.hour)}:${pad(p.minute)} ET`;
}

export const HOUR_MS = 3600 * 1000;
export const DAY_MS = 24 * HOUR_MS;
