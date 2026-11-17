// The two guards every template goes through.
//
// esc(): all third-party text (headlines, publisher names, place names) is
//        escaped here before it touches a page, an attribute or the feed.
// url(): only http and https links get through, and the result is already
//        escaped for an attribute. An unsafe link gives '' and the template
//        then shows the text with no link at all.
import { safeUrl } from '../lib/text.mjs';

const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"'`]/g, (c) => MAP[c]);
}

export function url(value) {
  const href = safeUrl(value);
  return href ? esc(href) : '';
}

// A number that is always safe to print: never NaN, never infinite.
export function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
