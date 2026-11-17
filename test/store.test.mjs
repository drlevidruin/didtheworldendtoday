import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../scripts/lib/paths.mjs';
import { readJson, readJsonLenient, writeJsonAtomic, writeJsonIfChanged } from '../scripts/lib/json.mjs';
import { buildIndex, dayFile, indexEntry, listDayDates, readDay, readDayLenient, recordDay, saveDay, saveIndex, sameDayContent } from '../scripts/lib/store.mjs';
import { tmpRoot } from './helpers.mjs';

const mk = () => paths(tmpRoot('dtwet-store-'));
const story = (over = {}) => ({ id: 'a1', cat: 'internet', kind: 'news', title: 'Cloudflare outage', url: 'https://example.com/a', source: 'Pub', publishedAt: '2026-11-16T15:00:00.000Z', ...over });
const day = (date, over = {}) => ({ date, score: 11, fired: [], bumps: [], stories: [story()], ...over });

test('paths follow DTWET_ROOT', () => {
  const p = paths('/somewhere');
  assert.equal(p.latest, '/somewhere/data/latest.json');
  assert.equal(p.daysIndex, '/somewhere/data/days.json');
  assert.equal(p.quiet, '/somewhere/quiet.json');
  assert.equal(p.xState, '/somewhere/data/state/x.json');
});

test('day files: listed newest first, odd files ignored, bad dates refused', () => {
  const p = mk();
  fs.mkdirSync(p.days, { recursive: true });
  for (const n of ['2026-11-14.json', '2026-11-16.json', '2026-11-15.json', 'notes.txt', '2026-13-45.json', '2026-11-15.json.tmp']) fs.writeFileSync(path.join(p.days, n), '{}');
  assert.deepEqual(listDayDates(p), ['2026-11-16', '2026-11-15', '2026-11-14']);
  assert.deepEqual(listDayDates(mk()), []);
  assert.throws(() => dayFile(p, '../../etc/passwd'), /Not a date/);
});

test('readDay is strict about a corrupt file and gentle about a missing one', () => {
  const p = mk();
  assert.equal(readDay(p, '2026-11-16'), null);
  fs.mkdirSync(p.days, { recursive: true });
  fs.writeFileSync(dayFile(p, '2026-11-16'), '{ nope');
  assert.throws(() => readDay(p, '2026-11-16'), /Corrupt JSON/);
  assert.equal(readDayLenient(p, '2026-11-16'), null);
});

test('saveDay moves updatedAt only when something else changed', () => {
  const p = mk();
  const first = saveDay(p, day('2026-11-16'), null, '2026-11-16T20:00:00.000Z');
  assert.equal(first.updatedAt, '2026-11-16T20:00:00.000Z');
  const bytes = fs.readFileSync(dayFile(p, '2026-11-16'), 'utf8');
  const same = saveDay(p, day('2026-11-16'), first, '2026-11-16T20:15:00.000Z');
  assert.equal(same.updatedAt, '2026-11-16T20:00:00.000Z');
  assert.equal(fs.readFileSync(dayFile(p, '2026-11-16'), 'utf8'), bytes);
  const changed = saveDay(p, day('2026-11-16', { score: 18 }), same, '2026-11-16T20:30:00.000Z');
  assert.equal(changed.updatedAt, '2026-11-16T20:30:00.000Z');
  assert.equal(sameDayContent(first, same), true);
  assert.equal(sameDayContent(first, changed), false);
  assert.equal(sameDayContent(null, first), false);
});

test('the almanac index lists each day newest first with its top story and category counts', () => {
  const p = mk();
  saveDay(p, day('2026-11-15', { score: 30, fired: ['grid'], stories: [story({ title: 'First', cat: 'grid' }), story({ id: 'a2', title: 'Second', cat: 'grid' }), story({ id: 'a3', cat: 'internet' })] }), null, 'x');
  saveDay(p, day('2026-11-16', { score: 40 }), null, 'x');
  const index = buildIndex(p);
  assert.deepEqual(index.map((e) => e.date), ['2026-11-16', '2026-11-15']);
  assert.deepEqual(index[1].cats, { grid: 2, internet: 1 });
  assert.deepEqual(index[1].top, { title: 'First', url: 'https://example.com/a', source: 'Pub', cat: 'grid' });
  assert.deepEqual(index[1].fired, ['grid']);
  assert.equal(saveIndex(p, index), true);
  assert.equal(saveIndex(p, index), false, 'same bytes, no write');
  assert.deepEqual(readJson(p.daysIndex), index);
});

test('the index skips damaged files and files whose date does not match their name', () => {
  const p = mk();
  saveDay(p, day('2026-11-16'), null, 'x');
  fs.writeFileSync(dayFile(p, '2026-11-15'), '{ nope');
  fs.writeFileSync(dayFile(p, '2026-11-14'), JSON.stringify(day('2026-11-01')));
  fs.writeFileSync(dayFile(p, '2026-11-13'), JSON.stringify({ date: '2026-11-13', score: 11 }));
  assert.deepEqual(buildIndex(p).map((e) => e.date), ['2026-11-16']);
  assert.equal(indexEntry({ date: '2026-11-16', score: 11, stories: [] }).top, null);
});

test('the record day is the highest score, and the earliest day wins a tie', () => {
  assert.equal(recordDay([]), null);
  assert.deepEqual(recordDay([{ date: '2026-11-16', score: 40 }, { date: '2026-11-14', score: 60 }, { date: '2026-11-15', score: 60 }]), { date: '2026-11-14', score: 60 });
  assert.deepEqual(recordDay([{ date: '2026-11-16', score: 11 }]), { date: '2026-11-16', score: 11 });
  assert.equal(recordDay([{ date: '2026-11-16', score: 'x' }]), null);
});

test('json files are written whole or not at all, and untouched when nothing changed', () => {
  const dir = tmpRoot('dtwet-json-');
  const file = path.join(dir, 'a', 'b.json');
  assert.equal(writeJsonIfChanged(file, { a: 1 }), true);
  assert.equal(writeJsonIfChanged(file, { a: 1 }), false);
  assert.equal(writeJsonIfChanged(file, { a: 2 }), true);
  assert.equal(fs.readFileSync(file, 'utf8'), '{\n  "a": 2\n}\n');
  writeJsonAtomic(file, { z: 1 });
  assert.deepEqual(readJson(file), { z: 1 });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['b.json'], 'no temp files left behind');
  assert.equal(readJson(path.join(dir, 'missing.json'), 'fallback'), 'fallback');
  assert.throws(() => readJson(path.join(dir, 'missing.json')), /ENOENT/);
  fs.writeFileSync(path.join(dir, 'bad.json'), '{ x');
  assert.equal(readJsonLenient(path.join(dir, 'bad.json'), 'safe'), 'safe');
});
