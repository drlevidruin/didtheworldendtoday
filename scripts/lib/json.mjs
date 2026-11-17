// Small JSON file helpers. Writes are atomic (temp file, then rename) so a
// crashed run can never leave half a file behind.
import fs from 'node:fs';
import path from 'node:path';

export function readJson(file, fallback) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Corrupt JSON in ${file}: ${err.message}`);
  }
}

// For disposable files (state, previous latest): a broken file counts as missing.
export function readJsonLenient(file, fallback) {
  try {
    return readJson(file, fallback);
  } catch {
    return fallback;
  }
}

export function toJson(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, toJson(value));
  fs.renameSync(tmp, file);
}

// Write only when the bytes would change, so untouched files stay untouched.
export function writeJsonIfChanged(file, value) {
  const next = toJson(value);
  let prev = null;
  try {
    prev = fs.readFileSync(file, 'utf8');
  } catch {
    prev = null;
  }
  if (prev === next) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, file);
  return true;
}
