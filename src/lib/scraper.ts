import * as cheerio from "cheerio";
import { DomainLimiter, fetchOk, USER_AGENT, withRetry } from "./http";

const limiter = new DomainLimiter(2); // max ~2 requests/second per domain
const wmLimiter = new DomainLimiter(1); // Wikimedia asks bots to go slower
// Wikimedia throttles anonymous browser-like UAs; it wants an identifying one (https://meta.wikimedia.org/wiki/User-Agent_policy).
export const WM_UA = "DocuForge/0.1 (local documentary tool; contact: see README) node-fetch";
const isWikimedia = (u: string) => /(^|\.)(wikimedia|wikipedia)\.org$/.test(new URL(u).hostname);

export interface PageImage {
  url: string;
  pageUrl: string;
  alt?: string;
  caption?: string;
  kind: "og" | "twitter" | "img" | "figure";
  declaredWidth?: number;
}

export async function politeFetch(url: string, opts: { binary?: boolean; referer?: string; timeoutMs?: number } = {}) {
  const wm = isWikimedia(url);
  const lim = wm ? wmLimiter : limiter;
  return withRetry(
    async () => {
      await lim.wait(url);
      return fetchOk(url, {
        timeoutMs: opts.timeoutMs ?? 20000,
        redirect: "follow",
        headers: {
          "User-Agent": wm ? WM_UA : USER_AGENT,
          Accept: opts.binary ? "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8" : "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          ...(opts.referer ? { Referer: opts.referer } : {}),
        },
      });
    },
    { retries: wm ? 4 : 2, baseMs: wm ? 2500 : 1000, label: `fetch ${new URL(url).host}` },
  );
}

const JUNK = /(logo|icon|avatar|sprite|favicon|badge|placeholder|pixel|spacer|blank|ads?[_/-]|banner|author|headshot-small|emoji|\.svg|\.gif)/i;

function abs(u: string | undefined, base: string) {
  if (!u) return null;
  u = u.trim();
  if (!u || u.startsWith("data:")) return null;
  try {
    return new URL(u, base).toString();
  } catch {
    return null;
  }
}

/** Largest candidate from a srcset attribute. */
function fromSrcset(srcset: string | undefined, base: string) {
  if (!srcset) return null;
  let best: { url: string; w: number } | null = null;
  for (const part of srcset.split(",")) {
    const [u, d] = part.trim().split(/\s+/);
    const w = d?.endsWith("w") ? parseInt(d) : d?.endsWith("x") ? parseFloat(d) * 1000 : 0;
    const a = abs(u, base);
    if (a && (!best || w > best.w)) best = { url: a, w };
  }
  return best;
}

export function extractImages(html: string, pageUrl: string): PageImage[] {
  const $ = cheerio.load(html);
  const out: PageImage[] = [];
  const seen = new Set<string>();
  const push = (img: PageImage) => {
    if (seen.has(img.url) || JUNK.test(img.url)) return;
    seen.add(img.url);
    out.push(img);
  };
  const ogAlt = $('meta[property="og:image:alt"]').attr("content");
  const og = abs($('meta[property="og:image"]').attr("content") ?? $('meta[property="og:image:url"]').attr("content"), pageUrl);
  if (og) push({ url: og, pageUrl, kind: "og", alt: ogAlt ?? $("title").text().trim() });
  const tw = abs($('meta[name="twitter:image"]').attr("content") ?? $('meta[name="twitter:image:src"]').attr("content"), pageUrl);
  if (tw) push({ url: tw, pageUrl, kind: "twitter", alt: $('meta[name="twitter:image:alt"]').attr("content") });

  $("figure").each((_, el) => {
    const fig = $(el);
    const img = fig.find("img").first();
    const src = fromSrcset(img.attr("srcset") ?? img.attr("data-srcset") ?? fig.find("source").attr("srcset"), pageUrl)?.url ?? abs(img.attr("src") ?? img.attr("data-src"), pageUrl);
    if (!src) return;
    push({
      url: src,
      pageUrl,
      kind: "figure",
      alt: img.attr("alt"),
      caption: fig.find("figcaption").text().replace(/\s+/g, " ").trim().slice(0, 300) || undefined,
      declaredWidth: parseInt(img.attr("width") ?? "") || undefined,
    });
  });

  $("article img, main img, img").each((_, el) => {
    const img = $(el);
    const ss = fromSrcset(img.attr("srcset") ?? img.attr("data-srcset"), pageUrl);
    const src = ss?.url ?? abs(img.attr("src") ?? img.attr("data-src") ?? img.attr("data-original"), pageUrl);
    if (!src) return;
    const w = parseInt(img.attr("width") ?? "") || (ss?.w && ss.w > 100 ? ss.w : undefined);
    if (w !== undefined && w < 400) return; // clearly an inline thumbnail
    push({ url: src, pageUrl, kind: "img", alt: img.attr("alt"), declaredWidth: w });
  });
  return out.slice(0, 40);
}

export async function scrapePageImages(pageUrl: string): Promise<PageImage[]> {
  const res = await politeFetch(pageUrl);
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("html")) return [];
  const html = await res.text();
  return extractImages(html, res.url || pageUrl);
}
