import fs from "node:fs";
import path from "node:path";
import * as z from "zod";
import { cachedFile, cachedJson, hashOf } from "@/lib/cache";
import { claudeJson, claudeResearch, type ContentParam } from "@/lib/clients/anthropic";
import { download, pickRendition, searchImages, searchVideos } from "@/lib/clients/pixabay";
import { searchCommons } from "@/lib/clients/wikimedia";
import { probeVideo, videoFrame } from "@/lib/ffmpeg";
import { mapLimit } from "@/lib/http";
import { dHash, hamming, normaliseImage, smallJpeg } from "@/lib/images";
import { ensureDir } from "@/lib/paths";
import { usesClaudeApi } from "@/lib/mode";
import { hasKey } from "@/lib/settings";
import { politeFetch, scrapePageImages, type PageImage } from "@/lib/scraper";
import type { Candidate, Credit, Research, Scene, SceneVisual, Script, VisualsResult } from "@/lib/schemas";
import type { StepCtx, StepDef } from "../context";

const MAX_CANDIDATES = 8;
const NEEDS_PHOTO = new Set(["NameReveal", "PhotoStack"]);
const tokens = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter((t) => t.length > 2);

function subjectKey(s: Scene) {
  const kind = s.visual.kind === "graphic" && ["KineticCaption", "BigNumber"].includes(s.sceneType) ? "stock" : s.visual.kind;
  if (kind === "stock") return `stock:${s.id}`; // stock is chosen per scene (different queries each time)
  if (kind === "graphic") return `graphic:${s.id}`;
  return `${kind}:${s.visual.subject.toLowerCase().trim()}`;
}

// ---------------------------------------------------------------- downloads

class Pool {
  hashes: string[] = [];
  constructor(public ctx: StepCtx, public all: Record<string, Candidate>) {
    for (const c of Object.values(all)) if (c.phash) this.hashes.push(c.phash);
  }
  /** Download + normalise + dedupe an image. Returns the candidate, or null if too small/duplicate/unreachable. */
  async addImage(url: string, meta: Omit<Candidate, "id" | "type" | "file" | "width" | "height">, referer?: string): Promise<Candidate | null> {
    const id = "img-" + hashOf(url).slice(0, 12);
    if (this.all[id]) return this.all[id];
    try {
      const { file: raw } = await cachedFile("media", url, "bin", async () => {
        const res = await politeFetch(url, { binary: true, referer, timeoutMs: 30000 });
        if (!(res.headers.get("content-type") ?? "image/").startsWith("image/")) throw new Error("not an image");
        return Buffer.from(await res.arrayBuffer());
      });
      const norm = await normaliseImage(fs.readFileSync(raw));
      if (!norm) return null; // < 800 px on the long side, or unreadable
      const ph = await dHash(norm.buffer);
      if (this.hashes.some((h) => hamming(h, ph) <= 6)) return null; // near-duplicate
      this.hashes.push(ph);
      const rel = `media/${id}.jpg`;
      fs.writeFileSync(this.ctx.file(rel), norm.buffer);
      const thumb = `media/thumbs/${id}.jpg`;
      fs.writeFileSync(this.ctx.file(thumb), await smallJpeg(norm.buffer, 480));
      const c: Candidate = { id, type: "image", file: rel, thumb, width: norm.width, height: norm.height, phash: ph, ...meta };
      this.all[id] = c;
      return c;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------- real images

let articleImagesMemo: Promise<PageImage[]> | null = null;
async function articleImages(ctx: StepCtx, research: Research): Promise<PageImage[]> {
  if (articleImagesMemo) return articleImagesMemo;
  articleImagesMemo = (async () => {
    const urls = [...new Set([...research.claims.flatMap((c) => c.sources.map((s) => s.url)), ...ctx.options.sourceUrls])].slice(0, 30);
    const { value } = await cachedJson("scrape-articles", { urls }, async () => {
      const lists = await mapLimit(urls, 4, (u) => scrapePageImages(u).catch(() => [] as PageImage[]));
      return lists.flat();
    });
    ctx.info(`Scraped ${urls.length} source articles → ${value.length} candidate images`);
    return value;
  })();
  return articleImagesMemo;
}

function matchesSubject(img: PageImage, subject: string, kind: string) {
  const hay = `${img.alt ?? ""} ${img.caption ?? ""} ${decodeURIComponent(img.url.split("/").pop() ?? "")}`.toLowerCase();
  const t = tokens(subject);
  if (!t.length) return false;
  if (kind === "person") {
    const surname = t[t.length - 1];
    return hay.includes(surname);
  }
  return t.filter((x) => hay.includes(x)).length >= Math.min(2, t.length);
}

async function webPhotoPages(ctx: StepCtx, subject: string, context: string): Promise<string[]> {
  const { seen } = await claudeResearch({
    ctx: { projectId: ctx.id, step: "visuals", model: ctx.model },
    system: "You find web pages that contain good editorial photographs of a given subject (news articles, official sites, Wikipedia). Search, then list the best page URLs.",
    prompt: `Find 3–5 web pages with clear, high-resolution photos of: ${subject} (${context}). Prefer major news outlets, official pages and Wikipedia. List the page URLs.`,
    maxSearches: 2,
  });
  return seen.map((s) => s.url).slice(0, 6);
}

async function gatherReal(ctx: StepCtx, pool: Pool, research: Research, scene: Scene): Promise<Candidate[]> {
  const { subject, context, kind } = scene.visual;
  const found: Candidate[] = [];
  const push = (c: Candidate | null) => c && !found.some((f) => f.id === c.id) && found.push(c);

  // Wikimedia Commons: full name / event, then the scene's own queries.
  const queries = [...new Set([subject, ...scene.visual.searchQueries])].slice(0, 3);
  for (const q of queries) {
    if (found.length >= MAX_CANDIDATES) break;
    const hits = await searchCommons(q, 10).catch(() => []);
    for (const h of hits) {
      if (found.length >= MAX_CANDIDATES) break;
      if (Math.max(h.width, h.height) < 800) continue;
      push(await pool.addImage(h.thumbUrl, { provider: "wikimedia", sourcePage: h.pageUrl, originalUrl: h.url, author: h.author, license: h.license, caption: h.description ?? h.title }));
    }
  }
  // Images from the research source articles.
  if (found.length < MAX_CANDIDATES) {
    const imgs = (await articleImages(ctx, research)).filter((i) => matchesSubject(i, subject, kind));
    for (const i of imgs.slice(0, 8)) {
      if (found.length >= MAX_CANDIDATES) break;
      push(await pool.addImage(i.url, { provider: "article", sourcePage: i.pageUrl, originalUrl: i.url, caption: i.caption ?? i.alt }, i.pageUrl));
    }
  }
  // Wider web search for pages with photos of the subject.
  if (found.length < 3) {
    const pages = usesClaudeApi(ctx.options) ? await webPhotoPages(ctx, subject, context).catch(() => []) : [];
    for (const p of pages) {
      if (found.length >= MAX_CANDIDATES) break;
      const imgs = await scrapePageImages(p).catch(() => []);
      const ranked = [...imgs.filter((i) => matchesSubject(i, subject, kind)), ...imgs.filter((i) => i.kind === "og")];
      for (const i of ranked.slice(0, 3)) push(await pool.addImage(i.url, { provider: "web", sourcePage: p, originalUrl: i.url, caption: i.caption ?? i.alt }, p));
    }
  }
  return found;
}

const VisionSchema = z.object({
  results: z.array(
    z.object({
      index: z.number(),
      showsSubject: z.boolean(),
      score: z.number().describe("0-10 overall suitability as a documentary shot of the subject"),
      sharp: z.boolean(),
      collageOrMeme: z.boolean(),
      heavyWatermark: z.boolean(),
      mostlyText: z.boolean(),
      box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).describe("Subject (face for a person) bounding box, normalized 0-1"),
      note: z.string(),
    }),
  ),
});

async function verify(ctx: StepCtx, scene: Scene, cands: Candidate[]) {
  if (!cands.length) return;
  if (!usesClaudeApi(ctx.options)) {
    // No Claude API (no key, or Claude-app mode): fall back to caption matching (unverified) so the pipeline still produces a video.
    const t = tokens(scene.visual.subject);
    for (const c of cands) {
      const hay = (c.caption ?? "").toLowerCase();
      c.score = t.length && t.every((x) => hay.includes(x)) ? 6 : t.some((x) => hay.includes(x)) ? 5 : 3;
      c.verdict = "unverified — caption match only (Claude photo check is off) — check this image";
      c.focus = { x: 0.3, y: 0.12, w: 0.4, h: 0.45 };
    }
    return;
  }
  const content: ContentParam[] = [
    {
      type: "text",
      text: `Subject: ${scene.visual.subject}. Context: ${scene.visual.context}. Kind: ${scene.visual.kind}. Story: "${scene.narration}"\nFor each numbered image decide if it really shows this subject in this context (for a person: is it actually them; for an event/place: is it that event/place). Also check: sharp, not a collage or meme, no heavy watermark, not mostly text. Return the subject's bounding box (for a person, the face/head) as normalized x,y,w,h.`,
    },
  ];
  for (const [i, c] of cands.entries()) {
    const jpg = await smallJpeg(ctx.file(c.file), 640);
    content.push({ type: "text", text: `Image ${i}${c.caption ? ` (caption: ${c.caption.slice(0, 160)})` : ""}:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpg.toString("base64") } });
  }
  const res = await claudeJson({ ctx: { projectId: ctx.id, step: "visuals", model: ctx.model }, label: "vision-verify", schema: VisionSchema, effort: "low", maxTokens: 16000, system: "You are a careful photo editor verifying archive images for a factual documentary.", content });
  for (const r of res.results) {
    const c = cands[r.index];
    if (!c) continue;
    let score = r.showsSubject ? r.score : 0;
    if (!r.sharp) score -= 2;
    if (r.collageOrMeme || r.mostlyText) score -= 5;
    if (r.heavyWatermark) score -= 4;
    c.score = Math.max(0, Math.min(10, score));
    c.verdict = `${r.showsSubject ? "✓ subject" : "✗ not subject"} — ${r.note}`;
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    c.focus = { x: clamp(r.box.x), y: clamp(r.box.y), w: clamp(r.box.w) || 0.3, h: clamp(r.box.h) || 0.3 };
  }
}

// ---------------------------------------------------------------- stock (Pixabay)

async function gatherStock(ctx: StepCtx, pool: Pool, scene: Scene, durSec: number): Promise<Candidate[]> {
  if (!hasKey("PIXABAY_API_KEY")) return [];
  const vertical = ctx.options.format === "9:16";
  const want = new Set([...scene.visual.searchQueries.flatMap(tokens), ...tokens(scene.visual.subject)]);
  const scored: { score: number; v: Awaited<ReturnType<typeof searchVideos>>[number]; q: string }[] = [];
  for (const q of scene.visual.searchQueries.slice(0, 3)) {
    for (const v of await searchVideos(q).catch(() => [])) {
      if (!pickRendition(v, vertical)) continue;
      const tags = new Set(tokens(v.tags));
      const overlap = [...want].filter((w) => tags.has(w)).length;
      scored.push({ score: overlap * 2 + (v.duration >= durSec ? 1 : 0), v, q });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const out: Candidate[] = [];
  const seen = new Set<number>();
  for (const s of scored) {
    if (out.length >= 3) break;
    if (seen.has(s.v.id)) continue;
    seen.add(s.v.id);
    const id = `vid-${s.v.id}`;
    if (pool.all[id]) {
      out.push(pool.all[id]);
      continue;
    }
    const r = pickRendition(s.v, vertical)!;
    const rel = `media/${id}.mp4`;
    try {
      const { file } = await cachedFile("media", r.url, "mp4", async () => {
        const tmp = path.join(ensureDir(ctx.file("media", "tmp")), `${id}.mp4`);
        await download(r.url, tmp);
        const buf = fs.readFileSync(tmp);
        fs.rmSync(tmp, { force: true });
        return buf;
      });
      fs.copyFileSync(file, ctx.file(rel));
      const info = await probeVideo(ctx.file(rel));
      const thumb = `media/thumbs/${id}.jpg`;
      await videoFrame(ctx.file(rel), ctx.file(thumb), Math.min(1, info.duration / 2));
      const c: Candidate = {
        id,
        type: "video",
        file: rel,
        thumb,
        width: info.width,
        height: info.height,
        durationSec: info.duration,
        provider: "pixabay",
        sourcePage: s.v.pageURL,
        originalUrl: r.url,
        author: s.v.user,
        license: "Pixabay Content License",
        caption: s.v.tags,
        score: Math.min(10, 4 + s.score),
        verdict: `matched “${s.q}” (tags: ${s.v.tags})`,
      };
      pool.all[id] = c;
      out.push(c);
    } catch (e) {
      ctx.warn(`Pixabay video download failed: ${(e as Error).message}`);
    }
  }
  if (out.length) return out;
  // Fallback: Pixabay images.
  for (const q of scene.visual.searchQueries.slice(0, 2)) {
    const hits = await searchImages(q, vertical ? "vertical" : "horizontal").catch(() => []);
    for (const h of hits.slice(0, 4)) {
      const tags = new Set(tokens(h.tags));
      const c = await pool.addImage(h.largeImageURL, {
        provider: "pixabay",
        sourcePage: h.pageURL,
        originalUrl: h.largeImageURL,
        author: h.user,
        license: "Pixabay Content License",
        caption: h.tags,
        score: Math.min(10, 4 + [...want].filter((w) => tags.has(w)).length * 2),
        verdict: `matched “${q}”`,
      });
      if (c) out.push(c);
      if (out.length >= 3) return out;
    }
  }
  return out;
}

// ---------------------------------------------------------------- uploads

const MatchSchema = z.object({ matches: z.array(z.object({ upload: z.number(), sceneIds: z.array(z.string()) })) });

async function matchUploads(ctx: StepCtx, pool: Pool, script: Script): Promise<Map<string, string[]>> {
  const dir = ctx.file("uploads", "media");
  const byScene = new Map<string, string[]>();
  if (!fs.existsSync(dir)) return byScene;
  const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp|mp4|mov|webm)$/i.test(f));
  if (!files.length) return byScene;
  const cands: Candidate[] = [];
  for (const f of files.slice(0, 30)) {
    const full = path.join(dir, f);
    const id = "up-" + hashOf(f + fs.statSync(full).size).slice(0, 10);
    if (/\.(mp4|mov|webm)$/i.test(f)) {
      const info = await probeVideo(full);
      const thumb = `media/thumbs/${id}.jpg`;
      await videoFrame(full, ctx.file(thumb), Math.min(1, info.duration / 2));
      const c: Candidate = { id, type: "video", file: `uploads/media/${f}`, thumb, width: info.width, height: info.height, durationSec: info.duration, provider: "upload", caption: f, score: 9 };
      pool.all[id] = c;
      cands.push(c);
    } else {
      const norm = await normaliseImage(fs.readFileSync(full), 1);
      if (!norm) continue;
      fs.writeFileSync(ctx.file(`media/${id}.jpg`), norm.buffer);
      fs.writeFileSync(ctx.file(`media/thumbs/${id}.jpg`), await smallJpeg(norm.buffer, 480));
      const c: Candidate = { id, type: "image", file: `media/${id}.jpg`, thumb: `media/thumbs/${id}.jpg`, width: norm.width, height: norm.height, provider: "upload", caption: f, score: 9, focus: { x: 0.35, y: 0.2, w: 0.3, h: 0.35 } };
      pool.all[id] = c;
      cands.push(c);
    }
  }
  if (!usesClaudeApi(ctx.options)) {
    // Without Claude, match by filename: an upload goes to scenes whose subject words all appear in its name.
    const unmatched: string[] = [];
    for (const c of cands) {
      const name = (c.caption ?? "").toLowerCase();
      const hits = script.scenes.filter((s) => {
        const t = tokens(s.visual.subject);
        return t.length > 0 && t.every((w) => name.includes(w));
      });
      for (const s of hits) byScene.set(s.id, [...(byScene.get(s.id) ?? []), c.id]);
      if (!hits.length) unmatched.push(c.caption ?? c.id);
    }
    if (unmatched.length) ctx.warn(`Uploads not matched to any scene (name files after their subject, e.g. "sam-bankman-fried-2022.jpg"): ${unmatched.join(", ")}`);
    return byScene;
  }
  const content: ContentParam[] = [{ type: "text", text: `Match the creator's uploaded media to the scenes they best illustrate. An upload can serve several scenes; skip uploads that fit nothing.\nSCENES:\n${JSON.stringify(script.scenes.map((s) => ({ id: s.id, narration: s.narration, visual: `${s.visual.kind}: ${s.visual.subject}` })))}` }];
  for (const [i, c] of cands.entries()) {
    content.push({ type: "text", text: `Upload ${i} (${c.caption}):` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: (await smallJpeg(ctx.file(c.thumb!), 480)).toString("base64") } });
  }
  const res = await claudeJson({ ctx: { projectId: ctx.id, step: "visuals", model: ctx.model }, label: "match-uploads", schema: MatchSchema, effort: "low", maxTokens: 8000, system: "You are a documentary editor.", content });
  for (const m of res.matches) {
    const c = cands[m.upload];
    if (!c) continue;
    for (const sid of m.sceneIds) byScene.set(sid, [...(byScene.get(sid) ?? []), c.id]);
  }
  ctx.info(`Matched ${res.matches.length} of ${cands.length} uploads to scenes`);
  return byScene;
}

// ---------------------------------------------------------------- step

export const visualsStep: StepDef = {
  name: "visuals",
  inputs: (ctx) => {
    const up = ctx.file("uploads", "media");
    return { script: ctx.hash("script.json"), format: ctx.options.format, uploads: fs.existsSync(up) ? fs.readdirSync(up).sort() : [], v: 2 };
  },
  async run(ctx) {
    articleImagesMemo = null;
    const script = ctx.read<Script>("script.json");
    const research = ctx.read<Research>("research.json");
    if (!script || !research) throw new Error("script.json / research.json missing");
    ensureDir(ctx.file("media", "thumbs"));
    const previous = ctx.read<VisualsResult>("visuals.json");
    const all: Record<string, Candidate> = { ...(previous?.candidates ?? {}) };
    const pool = new Pool(ctx, all);

    ctx.progress(0.03, "Matching your uploads…");
    const uploadMatches = await matchUploads(ctx, pool, script).catch((e) => {
      ctx.warn(`Upload matching failed: ${(e as Error).message}`);
      return new Map<string, string[]>();
    });

    // Gather once per subject (a person who appears in five scenes is searched and verified once).
    const groups = new Map<string, Scene[]>();
    for (const s of script.scenes) groups.set(subjectKey(s), [...(groups.get(subjectKey(s)) ?? []), s]);
    const subjectCands = new Map<string, string[]>();
    const prevBySubject = new Map(previous?.scenes.map((v) => [v.subjectKey, v.candidates]) ?? []);
    let done = 0;
    const keys = [...groups.keys()];
    await mapLimit(keys, 3, async (key) => {
      const scenes = groups.get(key)!;
      const first = scenes[0];
      const kind = key.split(":")[0];
      let ids: string[] = [];
      try {
        if (prevBySubject.has(key) && prevBySubject.get(key)!.every((id) => all[id])) {
          ids = prevBySubject.get(key)!; // already gathered & verified on an earlier run
        } else if (kind === "stock") {
          ids = (await gatherStock(ctx, pool, first, 8)).map((c) => c.id);
        } else if (kind !== "graphic") {
          const cands = await gatherReal(ctx, pool, research, first);
          await verify(ctx, first, cands);
          ids = cands.filter((c) => (c.score ?? 0) >= 5).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((c) => c.id);
          const rejected = cands.length - ids.length;
          ctx.info(`${first.visual.subject}: ${cands.length} candidates, ${ids.length} verified${rejected ? `, ${rejected} rejected` : ""}`);
          // A real subject with no verified photo can still get relevant stock behind typography.
          if (!ids.length && first.visual.searchQueries.length) ids = (await gatherStock(ctx, pool, first, 8)).map((c) => c.id);
        }
      } catch (e) {
        ctx.warn(`Visuals for ${key} failed: ${(e as Error).message}`);
      }
      subjectCands.set(key, ids);
      ctx.progress(0.08 + (0.85 * ++done) / keys.length, `Finding visuals ${done}/${keys.length}`);
    });

    // Choose per scene: user uploads first, then rotate through verified candidates so repeats differ.
    const useCount = new Map<string, number>();
    const prevChosen = new Map(previous?.scenes.map((v) => [v.sceneId, v]) ?? []);
    const scenes: SceneVisual[] = script.scenes.map((s) => {
      const key = subjectKey(s);
      const cands = [...(uploadMatches.get(s.id) ?? []), ...(subjectCands.get(key) ?? [])].filter((id, i, a) => all[id] && a.indexOf(id) === i);
      const want = s.sceneType === "PhotoStack" ? 4 : s.visual.kind === "graphic" && !["KineticCaption", "BigNumber"].includes(s.sceneType) ? 0 : 2;
      const old = prevChosen.get(s.id);
      let chosen: string[];
      if (old && old.subjectKey === key && old.chosen.length && old.chosen.every((id) => cands.includes(id))) {
        chosen = old.chosen; // keep the creator's manual picks
      } else {
        chosen = [...cands].sort((a, b) => (useCount.get(a) ?? 0) - (useCount.get(b) ?? 0) || (all[b].score ?? 0) - (all[a].score ?? 0)).slice(0, want);
      }
      for (const id of chosen) useCount.set(id, (useCount.get(id) ?? 0) + 1);
      const v: SceneVisual = { sceneId: s.id, subjectKey: key, candidates: cands, chosen };
      if (want > 0 && !chosen.length) {
        v.missing = true;
        v.fallbackType = NEEDS_PHOTO.has(s.sceneType) || s.sceneType === "KineticCaption" ? "KineticCaption" : s.sceneType;
      }
      return v;
    });
    const result: VisualsResult = { candidates: all, scenes };
    ctx.write("visuals.json", result);
    writeCredits(ctx, result);
    const missing = scenes.filter((s) => s.missing);
    ctx.info(`Visuals: ${scenes.filter((s) => s.chosen.length).length} scenes illustrated, ${missing.length} missing media${missing.length ? ` (${missing.map((m) => m.sceneId).join(", ")})` : ""}`);
    return "done";
  },
};

export function writeCredits(ctx: StepCtx, v: VisualsResult) {
  const byFile = new Map<string, Credit>();
  for (const s of v.scenes) {
    for (const id of s.chosen) {
      const c = v.candidates[id];
      if (!c) continue;
      const cr = byFile.get(c.file) ?? { file: c.file, sceneIds: [], provider: c.provider, sourcePage: c.sourcePage, originalUrl: c.originalUrl, author: c.author, license: c.license };
      cr.sceneIds.push(s.sceneId);
      byFile.set(c.file, cr);
    }
  }
  ctx.write("credits.json", [...byFile.values()]);
}
