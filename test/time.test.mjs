import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, etDate, etDayBounds, etParts, etStamp, isDateStr } from '../scripts/lib/time.mjs';

const d = (iso) => etDate(Date.parse(iso));

test('an ET day ends at midnight Eastern (EST, UTC-5)', () => {
  assert.equal(d('2026-11-17T04:59:59Z'), '2026-11-16');
  assert.equal(d('2026-11-17T05:00:00Z'), '2026-11-17');
  assert.equal(d('2026-11-16T23:30:00Z'), '2026-11-16');
});

test('an ET day ends at midnight Eastern in summer too (EDT, UTC-4)', () => {
  assert.equal(d('2026-07-04T03:59:59Z'), '2026-07-03');
  assert.equal(d('2026-07-04T04:00:00Z'), '2026-07-04');
});

test('spring forward: 2026-03-08 has 23 hours and buckets correctly', () => {
  assert.equal(d('2026-03-08T04:59:59Z'), '2026-03-07');
  assert.equal(d('2026-03-08T05:00:00Z'), '2026-03-08');
  assert.equal(d('2026-03-09T03:59:59Z'), '2026-03-08');
  assert.equal(d('2026-03-09T04:00:00Z'), '2026-03-09');
  const { start, end } = etDayBounds('2026-03-08');
  assert.equal((end - start) / 3600e3, 23);
});

test('fall back: 2026-11-01 has 25 hours and buckets correctly', () => {
  assert.equal(d('2026-11-01T03:59:59Z'), '2026-10-31');
  assert.equal(d('2026-11-01T04:00:00Z'), '2026-11-01');
  assert.equal(d('2026-11-02T04:59:59Z'), '2026-11-01');
  assert.equal(d('2026-11-02T05:00:00Z'), '2026-11-02');
  const { start, end } = etDayBounds('2026-11-01');
  assert.equal((end - start) / 3600e3, 25);
});

test('an ordinary day is 24 hours and bounds line up with bucketing', () => {
  const { start, end } = etDayBounds('2026-11-16');
  assert.equal((end - start) / 3600e3, 24);
  assert.equal(etDate(start), '2026-11-16');
  assert.equal(etDate(end), '2026-11-17');
  assert.equal(etDate(end.getTime() - 1), '2026-11-16');
});

test('hours are 0 to 23, never 24, at ET midnight', () => {
  assert.equal(etParts(Date.parse('2026-11-17T05:00:00Z')).hour, 0);
});

test('calendar arithmetic and date checks', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(isDateStr('2026-11-16'), true);
  assert.equal(isDateStr('2026-13-40'), false);
  assert.equal(isDateStr('nope'), false);
  assert.equal(etStamp(Date.parse('2026-11-17T03:15:00Z')), '2026-11-16 22:15 ET');
});
