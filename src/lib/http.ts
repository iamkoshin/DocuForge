export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: string,
  ) {
    super(message);
  }
}

/** Misconfiguration (e.g. a missing API key): never worth retrying. */
export class ConfigError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry with exponential backoff + jitter on network errors, 408, 429 and 5xx. */
export async function withRetry<T>(fn: () => Promise<T>, opts: { retries?: number; baseMs?: number; label?: string } = {}): Promise<T> {
  const retries = opts.retries ?? 4;
  const base = opts.baseMs ?? 800;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = e instanceof HttpError ? e.status : 0;
      const retryable = e instanceof ConfigError ? false : status === 0 || status === 408 || status === 429 || status >= 500;
      if (!retryable || attempt === retries) break;
      const wait = base * 2 ** attempt + Math.random() * base;
      console.warn(`[retry] ${opts.label ?? "request"} failed (${status || (e as Error).message}); retrying in ${Math.round(wait)}ms`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

/** fetch with timeout that throws HttpError on non-2xx. */
export async function fetchOk(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 30000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new HttpError(res.status, `${res.status} ${res.statusText} from ${new URL(url).host}: ${body.slice(0, 400)}`, body);
    }
    return res;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new HttpError(408, `Timeout fetching ${url}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Per-domain politeness: at most `perSecond` requests per second to any single host. */
export class DomainLimiter {
  private next = new Map<string, number>();
  constructor(private perSecond = 2) {}
  async wait(url: string) {
    const host = new URL(url).host;
    const gap = 1000 / this.perSecond;
    const t = Date.now();
    const slot = Math.max(t, this.next.get(host) ?? 0);
    this.next.set(host, slot + gap);
    if (slot > t) await sleep(slot - t);
  }
}

/** Run async tasks with a concurrency limit, preserving order of results. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}
