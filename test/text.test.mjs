import test from 'node:test';
import assert from 'node:assert/strict';
import { clean, decodeEntities, safeUrl, tokens, truncate } from '../scripts/lib/text.mjs';

test('clean strips control characters, zero-width and bidi tricks, and squeezes spaces', () => {
  assert.equal(clean('  Big\u0000 outage\u0007\u001b[31m   today​  '), 'Big outage [31m today');
  assert.equal(clean('abc‮def'), 'abcdef');
  assert.equal(clean('a\n\tb'), 'a b');
  assert.equal(clean(null), '');
  assert.equal(clean(undefined), '');
});

test('markup in a headline is kept as plain text, not interpreted', () => {
  const raw = '<img src=x onerror=alert(1)> Cloudflare "outage" & more';
  assert.equal(clean(raw), raw);
});

test('entities decode in a single pass', () => {
  assert.equal(decodeEntities('AT&amp;T outage'), 'AT&T outage');
  assert.equal(decodeEntities('&amp;lt;script&amp;gt;'), '&lt;script&gt;');
  assert.equal(decodeEntities('&#8217;s &#x2019;s &nbsp;x'), '’s ’s  x');
  assert.equal(decodeEntities('&unknownthing; stays'), '&unknownthing; stays');
  assert.equal(decodeEntities('&#99999999999; stays'), '&#99999999999; stays');
});

test('truncate cuts by characters and adds an ellipsis only when it cut', () => {
  assert.equal(truncate('short', 10), 'short');
  assert.equal(truncate('abcdefghij', 10), 'abcdefghij');
  assert.equal(truncate('abcdefghijk', 10), 'abcdefghi…');
  assert.equal(Array.from(truncate('x'.repeat(500), 200)).length, 200);
  assert.equal(truncate('\u{1F600}'.repeat(5), 3), '\u{1F600}\u{1F600}…');
});

test('safeUrl accepts http and https only', () => {
  assert.equal(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeUrl('http://example.com'), 'http://example.com/');
  assert.equal(safeUrl('  https://example.com/x  '), 'https://example.com/x');
  for (const bad of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://example.com/x',
    '//example.com/x',
    'example.com/x',
    'https://user:pass@example.com/',
    'https://user@example.com/',
    '',
    null,
    undefined,
  ]) {
    assert.equal(safeUrl(bad), null, String(bad));
  }
});

test('safeUrl rejects absurdly long links', () => {
  assert.equal(safeUrl(`https://example.com/${'a'.repeat(2100)}`), null);
});

test('tokens drop short words and stop words', () => {
  const t = tokens('The Cloudflare outage is over, and it was big');
  assert.ok(t.has('cloudflare') && t.has('outage') && t.has('big'));
  assert.ok(!t.has('the') && !t.has('is') && !t.has('and'));
});
