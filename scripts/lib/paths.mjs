// Where everything lives. DTWET_ROOT lets tests and dry runs point the whole
// pipeline at a scratch folder without touching the real data.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..');

export function paths(root = process.env.DTWET_ROOT || REPO_ROOT) {
  const data = path.join(root, 'data');
  return {
    root,
    data,
    days: path.join(data, 'days'),
    daysIndex: path.join(data, 'days.json'),
    latest: path.join(data, 'latest.json'),
    state: path.join(data, 'state'),
    sourcesState: path.join(data, 'state', 'sources.json'),
    xState: path.join(data, 'state', 'x.json'),
    quietState: path.join(data, 'state', 'quiet.json'),
    quiet: path.join(root, 'quiet.json'),
    dist: path.join(root, 'dist'),
  };
}
