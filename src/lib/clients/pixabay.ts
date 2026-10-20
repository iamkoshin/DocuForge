import fs from "node:fs";
import path from "node:path";
import { cachedJson } from "../cache";
import { fetchOk, withRetry } from "../http";
import { getKey } from "../settings";

export interface PixabayImage {
  id: number;
  pageURL: string;
  tags: string;
  largeImageURL: string;
  webformatURL: string;
  imageWidth: number;
  imageHeight: number;
  user: string;
}
export interface PixabayVideoFile {
  url: string;
  width: number;
  height: number;
  size: number;
  thumbnail: string;
}
export interface PixabayVideo {
  id: number;
  pageURL: string;
  tags: string;
  duration: number;
  user: string;
  videos: { large?: PixabayVideoFile; medium?: PixabayVideoFile; small?: PixabayVideoFile; tiny?: PixabayVideoFile };
}

// Pixabay asks clients to cache results for 24h. Results are cached on disk by query (day-bucketed).
const day = () => new Date().toISOString().slice(0, 10);

export async function searchImages(q: string, orientation: "horizontal" | "vertical") {
  const { value } = await cachedJson("pixabay-img", { q, orientation, d: day() }, async () => {
    const u = new URL("https://pixabay.com/api/");
    u.searchParams.set("key", getKey("PIXABAY_API_KEY"));
    u.searchParams.set("q", q.slice(0, 100));
    u.searchParams.set("image_type", "photo");
    u.searchParams.set("orientation", orientation);
    u.searchParams.set("safesearch", "true");
    u.searchParams.set("per_page", "20");
    u.searchParams.set("min_width", orientation === "horizontal" ? "1600" : "900");
    const res = await withRetry(() => fetchOk(u.toString()), { label: "pixabay images" });
    return ((await res.json()) as { hits: PixabayImage[] }).hits;
  });
  return value;
}

export async function searchVideos(q: string) {
  const { value } = await cachedJson("pixabay-vid", { q, d: day() }, async () => {
    const u = new URL("https://pixabay.com/api/videos/");
    u.searchParams.set("key", getKey("PIXABAY_API_KEY"));
    u.searchParams.set("q", q.slice(0, 100));
    u.searchParams.set("video_type", "film");
    u.searchParams.set("safesearch", "true");
    u.searchParams.set("per_page", "20");
    const res = await withRetry(() => fetchOk(u.toString()), { label: "pixabay videos" });
    return ((await res.json()) as { hits: PixabayVideo[] }).hits;
  });
  return value;
}

/** Pick the best rendition for the format: large or medium, matching orientation (videos endpoint has no orientation filter). */
export function pickRendition(v: PixabayVideo, vertical: boolean): PixabayVideoFile | null {
  const opts = [v.videos.large, v.videos.medium].filter((f): f is PixabayVideoFile => !!f && !!f.url && f.width > 0);
  const oriented = opts.filter((f) => (vertical ? f.height >= f.width : f.width > f.height));
  // For vertical videos we accept landscape clips too (they get center-cropped), but prefer native vertical.
  const pool = oriented.length ? oriented : vertical ? opts : [];
  // Prefer large only if it isn't huge (keeps renders fast); else medium.
  pool.sort((a, b) => Math.abs(a.width - 1920) - Math.abs(b.width - 1920));
  return pool[0] ?? null;
}

export async function download(url: string, dest: string) {
  const res = await withRetry(() => fetchOk(url, { timeoutMs: 120000 }), { label: "download" });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

export async function testPixabay() {
  const hits = await searchImages("city skyline", "horizontal");
  return `Pixabay OK — ${hits.length} results for a test query`;
}
