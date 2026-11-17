// Story rank, used only to order cards (the Doom Score does not use it).
// rank = (1 + log2(outlets)) x boost x recency
// Recency is measured when we first saw the story, not at render time, so a
// stored rank never drifts and the data files stay quiet between real changes.
import { HOUR_MS } from './time.mjs';

export const MAX_OUTLETS = 32;
export const BOOST_RE = /\b(?:global|worldwide|nationwide|massive|major|record|biggest|all flights|millions)\b/i;

export function boostFor(title) {
  return BOOST_RE.test(String(title ?? '')) ? 1.4 : 1;
}

// 1.0 for a story we saw as it broke, fading to 0.4 for one that was already
// 36 hours old when we found it.
export function recencyFor(ageHours) {
  const h = Math.max(0, Number.isFinite(ageHours) ? ageHours : 0);
  return Math.min(1, Math.max(0.4, 1 - (0.6 * h) / 36));
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}

export function newsRank({ outlets, title, publishedAt, firstSeenAt }) {
  const n = Math.min(MAX_OUTLETS, Math.max(1, Math.floor(outlets || 1)));
  const ageHours = publishedAt && firstSeenAt ? (firstSeenAt - publishedAt) / HOUR_MS : 0;
  return round2((1 + Math.log2(n)) * boostFor(title) * recencyFor(ageHours));
}
