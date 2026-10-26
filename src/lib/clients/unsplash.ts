import { cachedJson } from "../cache";
import { fetchOk, HttpError, withRetry } from "../http";
import { getKey } from "../settings";

export interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  description: string | null;
  alt_description: string | null;
  urls: { raw: string; full: string; regular: string; small: string; thumb: string };
  links: { html: string; download_location?: string };
  user: { name: string; username: string; links: { html: string } };
}

const API = "https://api.unsplash.com";
// Unsplash's API guidelines: every link back to Unsplash carries these UTM parameters.
const UTM = "utm_source=narrative&utm_medium=referral";
export const withUtm = (url: string) => `${url}${url.includes("?") ? "&" : "?"}${UTM}`;

// Test-mode keys get 50 requests an hour. Once Unsplash says the limit is reached, stop calling it
// for an hour instead of failing every remaining scene (image downloads don't count towards it).
let limitedUntil = 0;
export const unsplashLimited = () => Date.now() < limitedUntil;

async function call(url: string) {
  if (unsplashLimited()) throw new Error("Unsplash hourly request limit reached");
  try {
    const res = await withRetry(() => fetchOk(url, { headers: { Authorization: `Client-ID ${getKey("UNSPLASH_ACCESS_KEY")}`, "Accept-Version": "v1" } }), { label: "unsplash" });
    if (res.headers.get("x-ratelimit-remaining") === "0") limitedUntil = Date.now() + 3600_000;
    return res;
  } catch (e) {
    if (e instanceof HttpError && (e.status === 403 || e.status === 429) && /rate limit/i.test(e.body ?? "")) limitedUntil = Date.now() + 3600_000;
    throw e;
  }
}

const day = () => new Date().toISOString().slice(0, 10);

export async function searchPhotos(q: string, orientation: "landscape" | "portrait") {
  const { value } = await cachedJson("unsplash", { q, orientation, d: day() }, async () => {
    const u = new URL(`${API}/search/photos`);
    u.searchParams.set("query", q.slice(0, 100));
    u.searchParams.set("orientation", orientation);
    u.searchParams.set("content_filter", "high");
    u.searchParams.set("per_page", "10");
    const res = await call(u.toString());
    return ((await res.json()) as { results: UnsplashPhoto[] }).results;
  });
  return value;
}

/** Sized JPEG from the raw URL (keeps Unsplash's ixid tracking parameter, as the guidelines require). */
export const photoUrl = (p: UnsplashPhoto, width: number) => `${p.urls.raw}&w=${width}&fm=jpg&q=80&fit=max`;

export const downloadLocation = (p: UnsplashPhoto) => p.links.download_location ?? `${API}/photos/${p.id}/download`;

/** Tell Unsplash a photo was used (their download count; it doesn't return the file). */
export async function trackDownload(location: string) {
  await call(location);
}

export async function testUnsplash() {
  const u = new URL(`${API}/search/photos`);
  u.searchParams.set("query", "city skyline");
  u.searchParams.set("per_page", "1");
  const res = await call(u.toString());
  const { total } = (await res.json()) as { total: number };
  const left = res.headers.get("x-ratelimit-remaining");
  const limit = res.headers.get("x-ratelimit-limit");
  return `Unsplash OK — ${total.toLocaleString()} results for a test query${left && limit ? `; ${left} of ${limit} requests left this hour` : ""}`;
}
