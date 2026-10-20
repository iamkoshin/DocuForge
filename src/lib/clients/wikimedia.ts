import { cachedJson } from "../cache";
import { fetchOk, withRetry } from "../http";
import { WM_UA } from "../scraper";

export interface CommonsImage {
  title: string;
  url: string; // original resolution
  thumbUrl: string; // ~2000px wide rendition (smaller download)
  width: number;
  height: number;
  pageUrl: string;
  author?: string;
  license?: string;
  description?: string;
  date?: string;
}

const API = "https://commons.wikimedia.org/w/api.php";
// Wikimedia asks for an identifying User-Agent with contact info.


const stripHtml = (s?: string) => {
  const t = s?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  // Commons artist fields sometimes repeat the same name twice via nested HTML; collapse exact repeats.
  const m = t.match(/^(.+?)\s*\1$/);
  return m ? m[1] : t;
};

export async function searchCommons(query: string, limit = 12): Promise<CommonsImage[]> {
  const { value } = await cachedJson("wikimedia", { query, limit, v: 2 }, async () => {
    const u = new URL(API);
    const params: Record<string, string> = {
      action: "query",
      format: "json",
      formatversion: "2",
      generator: "search",
      gsrsearch: `${query} filetype:bitmap`,
      gsrnamespace: "6",
      gsrlimit: String(limit),
      prop: "imageinfo",
      iiprop: "url|size|mime|extmetadata",
      iiurlwidth: "2000",
      iiextmetadatafilter: "Artist|LicenseShortName|ImageDescription|DateTimeOriginal|Credit",
      origin: "*",
    };
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const res = await withRetry(() => fetchOk(u.toString(), { headers: { "User-Agent": WM_UA } }), { label: "wikimedia" });
    const j = (await res.json()) as {
      query?: {
        pages: {
          title: string;
          index?: number;
          imageinfo?: {
            url: string;
            thumburl?: string;
            width: number;
            height: number;
            mime: string;
            descriptionurl: string;
            extmetadata?: Record<string, { value: string }>;
          }[];
        }[];
      };
    };
    const pages = (j.query?.pages ?? []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return pages
      .map((p) => {
        const ii = p.imageinfo?.[0];
        if (!ii || !/^image\/(jpeg|png|webp)/.test(ii.mime)) return null;
        const m = ii.extmetadata ?? {};
        return {
          title: p.title,
          url: ii.url,
          thumbUrl: ii.thumburl ?? ii.url,
          width: ii.width,
          height: ii.height,
          pageUrl: ii.descriptionurl,
          author: stripHtml(m.Artist?.value),
          license: stripHtml(m.LicenseShortName?.value),
          description: stripHtml(m.ImageDescription?.value)?.slice(0, 300),
          date: stripHtml(m.DateTimeOriginal?.value),
        } as CommonsImage;
      })
      .filter((x): x is CommonsImage => x !== null);
  });
  return value;
}
