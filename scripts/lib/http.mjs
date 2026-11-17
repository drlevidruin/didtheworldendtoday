// The one fetch helper every source uses: 15 s timeout, one retry, the spec
// User-Agent, polite spacing per key, and an offline switch for tests.
//
// DTWET_OFFLINE=1 points every request at offline.invalid (a name that can
// never resolve), so a run exercises the real failure path with no network.
import { USER_AGENT } from '../config.mjs';

export class HttpError extends Error {
  constructor(message, { status = 0, url = '', retryable = false, body = '' } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.retryable = retryable;
    this.body = body;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function offlineUrl(url) {
  const u = new URL(url);
  u.hostname = 'offline.invalid';
  return u.toString();
}

function toHttpError(err, url) {
  if (err instanceof HttpError) return err;
  if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return new HttpError('timeout', { url, retryable: true });
  }
  const code = err?.cause?.code || err?.code || '';
  const detail = code || err?.cause?.message || err?.message || 'unknown error';
  return new HttpError(`network error: ${detail}`, { url, retryable: true });
}

export function createHttp({
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  offline = false,
  userAgent = USER_AGENT,
  timeoutMs = 15000,
  retries = 1,
  retryDelayMs = 1500,
  maxChars = 8 * 1024 * 1024,
  now = () => Date.now(),
  deadline = null, // epoch ms: after this, every call fails at once (a run never hangs for minutes)
} = {}) {
  // Per-key spacing. The slot is reserved synchronously, so concurrent callers
  // on the same key queue up instead of racing.
  const nextFree = new Map();
  async function pace(key, gapMs) {
    if (offline || !gapMs) return;
    const t = now();
    const slot = Math.max(t, nextFree.get(key) ?? 0);
    nextFree.set(key, slot + gapMs);
    if (slot > t) await sleep(slot - t);
  }

  async function get(url, opts = {}) {
    const {
      headers = {},
      key = safeHost(url),
      gapMs = 0,
      timeoutMs: perCallTimeout = timeoutMs,
      retries: perCallRetries = retries,
      accept = '*/*',
    } = opts;
    const target = offline ? offlineUrl(url) : url;
    let attempt = 0;
    for (;;) {
      await pace(key, gapMs);
      if (deadline && now() > deadline) throw new HttpError('run time budget used up', { url });
      try {
        const res = await fetchImpl(target, {
          headers: { 'user-agent': userAgent, accept, ...headers },
          redirect: 'follow',
          signal: AbortSignal.timeout(perCallTimeout),
        });
        const text = await res.text();
        if (!res.ok) {
          throw new HttpError(`HTTP ${res.status}`, {
            status: res.status,
            url,
            retryable: res.status >= 500 || res.status === 408,
            body: text.slice(0, 300),
          });
        }
        if (text.length > maxChars) throw new HttpError('response too large', { url });
        return { status: res.status, text, headers: res.headers, url: res.url || target };
      } catch (err) {
        const e = toHttpError(err, url);
        if (!e.retryable || attempt >= perCallRetries) throw e;
        attempt += 1;
        if (!offline) await sleep(retryDelayMs);
      }
    }
  }

  async function getText(url, opts) {
    return (await get(url, opts)).text;
  }

  async function getJson(url, opts) {
    const res = await get(url, { accept: 'application/json', ...opts });
    try {
      return JSON.parse(res.text);
    } catch {
      const peek = res.text.replace(/\s+/g, ' ').trim().slice(0, 80);
      throw new HttpError(`not JSON: ${peek}`, { url, status: res.status, body: res.text.slice(0, 300) });
    }
  }

  return { get, getText, getJson, offline };
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}
