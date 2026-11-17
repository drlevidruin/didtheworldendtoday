// Development only: DTWET_CACHE_DIR=/some/folder makes repeated runs reuse
// responses younger than DTWET_CACHE_MINUTES (default 30), so tuning the word
// lists does not hit the feeds again and again. Never set in CI.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function withDevCache(fetchImpl, dir, minutes = 30, now = () => Date.now()) {
  fs.mkdirSync(dir, { recursive: true });
  return async (url, init = {}) => {
    const hash = createHash('sha1').update(`${url}|${init.headers?.authorization ? 'auth' : ''}`).digest('hex');
    const file = path.join(dir, `${hash}.json`);
    try {
      const st = fs.statSync(file);
      if (now() - st.mtimeMs < minutes * 60000) {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        return new Response(saved.body, { status: saved.status, headers: saved.headers });
      }
    } catch {
      // no usable cache entry
    }
    const res = await fetchImpl(url, init);
    const body = await res.text();
    if (res.ok) {
      fs.writeFileSync(file, JSON.stringify({ status: res.status, headers: { 'content-type': res.headers.get('content-type') || 'text/plain' }, body }));
    }
    return new Response(body, { status: res.status, headers: res.headers });
  };
}
