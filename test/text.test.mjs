import test from 'node:test';
import assert from 'node:assert/strict';
import { ABBREVIATIONS, clean, decodeEntities, firstSentence, isAbbreviation, safeUrl, tokens, truncate, wordCount, xPost } from '../scripts/lib/text.mjs';

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

test('xPost reads the account from an https post address on x.com or twitter.com, and gives nothing for anything else', () => {
  assert.deepEqual(xPost('https://x.com/AP/status/123'), { href: 'https://x.com/AP/status/123', handle: 'AP' });
  assert.deepEqual(xPost('https://twitter.com/Breaking911/status/1234567890123456789'), { href: 'https://twitter.com/Breaking911/status/1234567890123456789', handle: 'Breaking911' });
  assert.deepEqual(xPost('  https://www.x.com/BNONews/status/9001?s=20#top  '), { href: 'https://www.x.com/BNONews/status/9001?s=20#top', handle: 'BNONews' });
  assert.deepEqual(xPost('https://X.COM/spectatorindex/status/5/photo/1'), { href: 'https://x.com/spectatorindex/status/5/photo/1', handle: 'spectatorindex' });
  assert.equal(xPost('https://x.com/unusual_whales/status/77/').handle, 'unusual_whales');
  for (const bad of [
    'http://x.com/AP/status/123',
    'https://example.com/AP/status/123',
    'https://x.com.evil.example/AP/status/123',
    'https://evilx.com/AP/status/123',
    'https://notx.com/AP/status/123',
    'https://mobile.twitter.com.example/AP/status/123',
    'https://user:pass@x.com/AP/status/123',
    'https://x.com:8443/AP/status/123',
    'https://x.com/',
    'https://x.com/AP',
    'https://x.com/AP/status/',
    'https://x.com/AP/status/abc',
    'https://x.com/AP/status/123abc',
    'https://x.com/AP/likes/123',
    'https://x.com/i/status/123',
    'https://x.com/i/web/status/123',
    'https://x.com/a-b/status/123',
    'https://x.com/sixteencharacter1/status/123',
    'javascript:alert(1)',
    'data:text/html,hi',
    '//x.com/AP/status/123',
    'x.com/AP/status/123',
    '',
    null,
    undefined,
    42,
    {},
    ['https://x.com/AP/status/123'],
  ]) {
    assert.equal(xPost(bad), null, String(bad));
  }
});

test('tokens drop short words and stop words', () => {
  const t = tokens('The Cloudflare outage is over, and it was big');
  assert.ok(t.has('cloudflare') && t.has('outage') && t.has('big'));
  assert.ok(!t.has('the') && !t.has('is') && !t.has('and'));
});

test('firstSentence: the text up to the first period that ends a sentence', () => {
  const cases = [
    ['An asteroid the size of a bus missed Earth at 2:59 AM ET. Grounded flights sent one Vegas wedding to Atlanta. Still here.', 'An asteroid the size of a bus missed Earth at 2:59 AM ET.'],
    ['Banks went dark. Planes were late.', 'Banks went dark.'],
    ['Banks went dark.', 'Banks went dark.'],
    ['U.S. banks went dark for an hour. Still here.', 'U.S. banks went dark for an hour.'],
    ['Not a day for jokes. Back soon.', 'Not a day for jokes.'],
    ['Banks went dark for an hour', 'Banks went dark for an hour'],
    ['  Padded sentence here.   Another one.  ', 'Padded sentence here.'],
    ['', ''],
    [null, ''],
    [undefined, ''],
    // a period inside a word, a number or an address is not the end
    ['The rate rose to 3.5 percent today. Markets shrugged.', 'The rate rose to 3.5 percent today.'],
    ['NASA posted the file at nasa.gov. Nobody read it.', 'NASA posted the file at nasa.gov.'],
    ['Version 2.0.1 shipped late. Users noticed.', 'Version 2.0.1 shipped late.'],
    // letters with periods between them are an abbreviation, so the period after them is not the end either
    ['U.S. banks went dark for an hour. Planes were late.', 'U.S. banks went dark for an hour.'],
    ['Planes in the U.K. and the U.S. were late. Banks were fine.', 'Planes in the U.K. and the U.S. were late.'],
    ['Washington, D.C. lost power for an hour. Then it came back.', 'Washington, D.C. lost power for an hour.'],
    // titles and company words
    ['Gov. Healey closed the roads. Snow kept falling.', 'Gov. Healey closed the roads.'],
    ['Acme Inc. said servers were down. Nobody noticed.', 'Acme Inc. said servers were down.'],
    ['Dr. Smith and Mr. Jones met in St. Louis. Then they left.', 'Dr. Smith and Mr. Jones met in St. Louis.'],
    ['No. 1 seed Gonzaga lost. Fans were calm.', 'No. 1 seed Gonzaga lost.'],
    // the same words in lower case are the end of a sentence
    ['She said no. Then she left.', 'She said no.'],
    ['Everyone was there, even a co. Then it ended.', 'Everyone was there, even a co.'],
    // a quote or a bracket before the word does not hide an abbreviation
    ['"Gov. Healey" closed the roads. Snow kept falling.', '"Gov. Healey" closed the roads.'],
    // an ellipsis, then a space: the sentence ends there
    ['Wait... what happened. Next.', 'Wait...'],
    // a closing quote or bracket after the period still ends the sentence, and goes with it
    ['She said "It missed." Then left.', 'She said "It missed."'],
    ['She said “It missed.” Then left.', 'She said “It missed.”'],
    ['He called it ‘done.’ Then he left.', 'He called it ‘done.’'],
    ['Planes were late (all of them.) Then it ended.', 'Planes were late (all of them.)'],
    ['The sign read [closed.] Nobody came.', 'The sign read [closed.]'],
    ['He said "Banks went dark."', 'He said "Banks went dark."'],
    ['He said “Banks went dark.”', 'He said “Banks went dark.”'],
    ['The rate was "3.5." Next.', 'The rate was "3.5."'],
    // a closer with no space after it is not the end of a sentence
    ['She said "stop."Then left. Next.', 'She said "stop."Then left.'],
  ];
  for (const [text, first] of cases) assert.equal(firstSentence(text), first, JSON.stringify(text));
  // the headline the card shows: sentence one, never "Still here."
  assert.equal(firstSentence('Banks went dark for an hour. Planes were late in three cities. Still here.'), 'Banks went dark for an hour.');
  assert.equal(firstSentence('Still here.'), 'Still here.');
});

test('the abbreviations that do not end a sentence are the listed ones, and letters with periods between them', () => {
  assert.deepEqual(ABBREVIATIONS, ['Mr', 'Mrs', 'Ms', 'Dr', 'St', 'Jr', 'Sr', 'Inc', 'Co', 'Corp', 'Ltd', 'vs', 'No', 'Gov', 'Sen', 'Rep', 'Gen', 'Lt', 'Mt', 'Ft']);
  for (const word of ABBREVIATIONS) {
    assert.equal(isAbbreviation(word), true, word);
    assert.equal(firstSentence(`${word}. Smith spoke up. Then left.`), `${word}. Smith spoke up.`, `${word}. does not end a sentence`);
  }
  for (const word of ['U.S', 'U.K', 'D.C', 'U.N', 'a.m', 'p.m']) assert.equal(isAbbreviation(word), true, word);
  for (const word of ['Banks', 'went', 'hours', 'NASA', 'nasa.gov', 'U', 'ET', '']) assert.equal(isAbbreviation(word), false, word);
});

test('wordCount counts runs of characters that are not spaces', () => {
  assert.equal(wordCount('Banks went dark.'), 3);
  assert.equal(wordCount('  Banks   went\tdark.\n'), 3);
  assert.equal(wordCount('2:59 AM ET'), 3);
  assert.equal(wordCount(''), 0);
  assert.equal(wordCount(null), 0);
  assert.equal(wordCount(undefined), 0);
});
