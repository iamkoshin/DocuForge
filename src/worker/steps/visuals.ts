import fs from "node:fs";
import path from "node:path";
import * as z from "zod";
import { cachedFile, cachedJson, hashOf } from "@/lib/cache";
import { claudeResearch } from "@/lib/clients/anthropic";
import { download, pickRendition, searchImages, searchVideos } from "@/lib/clients/pixabay";
import { downloadLocation, photoUrl as unsplashPhotoUrl, searchPhotos as searchUnsplash, unsplashLimited, withUtm } from "@/lib/clients/unsplash";
import { searchCommons } from "@/lib/clients/wikimedia";
import { probeVideo, videoFrame } from "@/lib/ffmpeg";
import { mapLimit } from "@/lib/http";
import { dHash, hamming, normaliseImage, smallJpeg } from "@/lib/images";
import { ensureDir } from "@/lib/paths";
import { MEDIA_EXT } from "@/lib/uploads";
import { usesClaudeApi, visionProvider } from "@/lib/mode";
import { hasKey } from "@/lib/settings";
import { politeFetch, scrapePageImages, type PageImage } from "@/lib/scraper";
import type { Candidate, Credit, NodeVisual, Research, Scene, SceneVisual, Script, VisualsResult } from "@/lib/schemas";
import { visionJson, type VisionPart } from "@/lib/vision";
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

/** No AI photo check available: score by caption words (unverified) so the pipeline still produces a video. */
function captionScore(scene: Scene, cands: Candidate[], why: string) {
  const t = tokens(scene.visual.subject);
  for (const c of cands) {
    const hay = (c.caption ?? "").toLowerCase();
    c.score = t.length && t.every((x) => hay.includes(x)) ? 6 : t.some((x) => hay.includes(x)) ? 5 : 3;
    c.verdict = `unverified — caption match only (${why}) — check this image`;
    c.focus = { x: 0.3, y: 0.12, w: 0.4, h: 0.45 };
  }
}

let quotaWarned = false;
function quotaWarning(ctx: StepCtx) {
  if (quotaWarned) return;
  quotaWarned = true;
  ctx.warn("Gemini's free daily limit is used up. The remaining photos are matched by caption only; retry Visuals tomorrow to check them.");
}

async function verify(ctx: StepCtx, scene: Scene, cands: Candidate[]) {
  if (!cands.length) return;
  const provider = visionProvider(ctx.options);
  if (provider === "captions") return captionScore(scene, cands, "AI photo check is off");
  const parts: VisionPart[] = [
    {
      text: `Subject: ${scene.visual.subject}. Context: ${scene.visual.context}. Kind: ${scene.visual.kind}. Story: "${scene.narration}"\nFor each numbered image decide if it really shows this subject in this context (for a person: is it actually them; for an event/place: is it that event/place). Also check: sharp, not a collage or meme, no heavy watermark, not mostly text. Return the subject's bounding box (for a person, the face/head) as normalized x,y,w,h.`,
    },
  ];
  for (const [i, c] of cands.entries()) {
    parts.push({ text: `Image ${i}${c.caption ? ` (caption: ${c.caption.slice(0, 160)})` : ""}:` });
    parts.push({ jpeg: await smallJpeg(ctx.file(c.type === "video" ? (c.thumb ?? c.file) : c.file), 640) }); // videos: their still frame
  }
  const res = await visionJson({ provider, ctx: { projectId: ctx.id, step: "visuals", model: ctx.model }, label: "vision-verify", schema: VisionSchema, maxTokens: 16000, system: "You are a careful photo editor verifying archive images for a factual documentary.", parts });
  if (!res) {
    quotaWarning(ctx);
    return captionScore(scene, cands, "Gemini's free daily limit was used up");
  }
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

// ---------------------------------------------------------------- stock (Pixabay, Unsplash)

let unsplashWarned = false;

/** Up to 2 Unsplash photos for a mood/generic scene. One search per scene keeps within the hourly request limit. */
async function gatherUnsplash(ctx: StepCtx, pool: Pool, scene: Scene, want: Set<string>, vertical: boolean): Promise<Candidate[]> {
  const q = scene.visual.searchQueries[0] ?? scene.visual.subject;
  const hits = unsplashLimited() ? [] : await searchUnsplash(q, vertical ? "portrait" : "landscape").catch(() => []);
  if (unsplashLimited() && !unsplashWarned) {
    unsplashWarned = true;
    ctx.warn("Unsplash's hourly request limit is reached; the remaining scenes use Pixabay. Retry Visuals in an hour to add Unsplash photos.");
  }
  const out: Candidate[] = [];
  for (const p of hits.slice(0, 4)) {
    const words = new Set(tokens(`${p.alt_description ?? ""} ${p.description ?? ""}`));
    const c = await pool.addImage(unsplashPhotoUrl(p, vertical ? 1440 : 2400), {
      provider: "unsplash",
      sourcePage: withUtm(p.links.html),
      originalUrl: p.urls.full,
      author: p.user.name,
      authorUrl: withUtm(p.user.links.html),
      previewUrl: p.urls.small,
      downloadLocation: downloadLocation(p),
      license: "Unsplash License",
      caption: p.alt_description ?? p.description ?? q,
      score: Math.min(10, 4 + [...want].filter((w) => words.has(w)).length * 2),
      verdict: `matched “${q}”`,
    });
    if (c) out.push(c);
    if (out.length >= 2) break;
  }
  return out;
}

async function gatherStock(ctx: StepCtx, pool: Pool, scene: Scene, durSec: number): Promise<Candidate[]> {
  const pixabay = hasKey("PIXABAY_API_KEY");
  const unsplash = hasKey("UNSPLASH_ACCESS_KEY");
  if (!pixabay && !unsplash) return [];
  const vertical = ctx.options.format === "9:16";
  const want = new Set([...scene.visual.searchQueries.flatMap(tokens), ...tokens(scene.visual.subject)]);
  const scored: { score: number; v: Awaited<ReturnType<typeof searchVideos>>[number]; q: string }[] = [];
  for (const q of pixabay ? scene.visual.searchQueries.slice(0, 3) : []) {
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
  // Unsplash photos go next to the footage: for mood shots they look better than Pixabay's photos.
  if (unsplash) out.push(...(await gatherUnsplash(ctx, pool, scene, want, vertical)));
  if (out.length || !pixabay) return out;
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

/** Turn a file in uploads/media into a candidate (normalised image or video with a still frame). Null if unreadable. */
export async function uploadCandidate(ctx: StepCtx, f: string): Promise<Candidate | null> {
  const full = ctx.file("uploads", "media", f);
  const id = "up-" + hashOf(f + fs.statSync(full).size).slice(0, 10);
  ensureDir(ctx.file("media", "thumbs"));
  if (/\.(mp4|mov|webm)$/i.test(f)) {
    const info = await probeVideo(full);
    const thumb = `media/thumbs/${id}.jpg`;
    await videoFrame(full, ctx.file(thumb), Math.min(1, info.duration / 2));
    return { id, type: "video", file: `uploads/media/${f}`, thumb, width: info.width, height: info.height, durationSec: info.duration, provider: "upload", caption: f, score: 9 };
  }
  const norm = await normaliseImage(fs.readFileSync(full), 1);
  if (!norm) return null;
  fs.writeFileSync(ctx.file(`media/${id}.jpg`), norm.buffer);
  fs.writeFileSync(ctx.file(`media/thumbs/${id}.jpg`), await smallJpeg(norm.buffer, 480));
  return { id, type: "image", file: `media/${id}.jpg`, thumb: `media/thumbs/${id}.jpg`, width: norm.width, height: norm.height, provider: "upload", caption: f, score: 9, focus: { x: 0.35, y: 0.2, w: 0.3, h: 0.35 } };
}

/** Flow-diagram boxes are matched like scenes, under ids such as "s7#2" (scene s7, box 2). */
const boxTargets = (script: Script) => script.scenes.flatMap((s) => (s.sceneType === "FlowDiagram" ? (s.data.nodes ?? []).map((label, k) => ({ id: `${s.id}#${k + 1}`, label })) : []));

async function matchUploads(ctx: StepCtx, pool: Pool, script: Script): Promise<{ byScene: Map<string, string[]>; uploads: string[] }> {
  const dir = ctx.file("uploads", "media");
  const byScene = new Map<string, string[]>();
  if (!fs.existsSync(dir)) return { byScene, uploads: [] };
  const files = fs.readdirSync(dir).filter((f) => MEDIA_EXT.test(f));
  const cands: Candidate[] = [];
  for (const f of files.slice(0, 30)) {
    const c = await uploadCandidate(ctx, f);
    if (!c) continue;
    pool.all[c.id] = c;
    cands.push(c);
  }
  const uploads = cands.map((c) => c.id);
  if (!cands.length) return { byScene, uploads };
  const boxes = boxTargets(script);
  const provider = visionProvider(ctx.options);
  const res =
    provider === "captions"
      ? null
      : await visionJson({
          provider,
          ctx: { projectId: ctx.id, step: "visuals", model: ctx.model },
          label: "match-uploads",
          schema: MatchSchema,
          maxTokens: 8000,
          system: "You are a documentary editor.",
          parts: [
            {
              text: `Match the creator's uploaded media to the scenes they best illustrate. An upload can serve several scenes; skip uploads that fit nothing.\nSCENES:\n${JSON.stringify(script.scenes.map((s) => ({ id: s.id, narration: s.narration, visual: `${s.visual.kind}: ${s.visual.subject}` })))}${
                boxes.length ? `\nDIAGRAM BOXES (ids like "s7#2" can go in sceneIds too; match an upload to a box when it shows what the box label names):\n${JSON.stringify(boxes)}` : ""
              }`,
            },
            ...(await Promise.all(cands.map(async (c, i): Promise<VisionPart[]> => [{ text: `Upload ${i} (${c.caption}):` }, { jpeg: await smallJpeg(ctx.file(c.thumb!), 480) }]))).flat(),
          ],
        });
  if (!res) {
    if (provider !== "captions") quotaWarning(ctx);
    // No AI: match by filename: an upload goes to scenes whose subject words all appear in its name.
    const unmatched: string[] = [];
    for (const c of cands) {
      const name = (c.caption ?? "").toLowerCase();
      const hits = script.scenes.filter((s) => {
        const t = tokens(s.visual.subject);
        return t.length > 0 && t.every((w) => name.includes(w));
      });
      for (const s of hits) byScene.set(s.id, [...(byScene.get(s.id) ?? []), c.id]);
      // Boxes: a file named after any part of the label ("park-chung-hee.jpg" → "Government (Park Chung-hee)").
      const boxHits = boxes.filter((b) => labelParts(b.label).some((part) => {
        const t = tokens(part);
        return t.length > 0 && t.every((w) => name.includes(w));
      }));
      for (const b of boxHits) byScene.set(b.id, [...(byScene.get(b.id) ?? []), c.id]);
      if (!hits.length && !boxHits.length) unmatched.push(c.caption ?? c.id);
    }
    if (unmatched.length) ctx.warn(`Uploads not matched to any scene (name files after their subject, e.g. "sam-bankman-fried-2022.jpg"). You can still pick them on the Images tab: ${unmatched.join(", ")}`);
    return { byScene, uploads };
  }
  for (const m of res.matches) {
    const c = cands[m.upload];
    if (!c) continue;
    for (const sid of m.sceneIds) byScene.set(sid, [...(byScene.get(sid) ?? []), c.id]);
  }
  ctx.info(`Matched ${res.matches.length} of ${cands.length} uploads to scenes and diagram boxes`);
  return { byScene, uploads };
}

// ---------------------------------------------------------------- flow diagram boxes

const nodeKey = (label: string) => label.toLowerCase().replace(/\s+/g, " ").trim();

/** "Government (Park Chung-hee)" → ["Government", "Park Chung-hee"]; "Steel, ships, chips" → ["Steel", "ships", "chips"]. */
const labelParts = (label: string) => label.split(/[(),;/&]|\band\b/).map((p) => p.trim()).filter((p) => p.length > 1).slice(0, 3);

/** The part of a box label that is a real, named thing from the research (so archive photos make sense). */
function namedPart(label: string, research: Research) {
  const names = [...research.players.map((p) => p.name), ...research.organizations.map((o) => o.name), ...research.places.map((p) => p.name)].map(nodeKey).filter(Boolean);
  return labelParts(label).find((part) => names.some((n) => n.includes(nodeKey(part)) || nodeKey(part).includes(n))) ?? null;
}

/** Photo candidates for one flow-diagram box: archive photos (checked) for named things, stock photos otherwise. */
async function gatherNode(ctx: StepCtx, pool: Pool, research: Research, scene: Scene, label: string): Promise<string[]> {
  const named = namedPart(label, research);
  const parts = labelParts(label);
  let ids: string[] = [];
  if (named) {
    const probe: Scene = { ...scene, visual: { kind: "event", subject: named, context: scene.visual.context || ctx.options.topic, searchQueries: [named, `${named} ${ctx.options.topic}`.slice(0, 60)] } };
    const cands = await gatherReal(ctx, pool, research, probe);
    await verify(ctx, probe, cands);
    ids = cands.filter((c) => (c.score ?? 0) >= 5).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((c) => c.id);
  }
  // Stock: search each part of the label on its own (a whole label like "Steel, ships, chips" finds nothing relevant).
  const stock: Candidate[] = [];
  for (const part of parts) {
    if (ids.length + stock.length >= 6) break;
    const probe: Scene = { ...scene, visual: { kind: "stock", subject: part, context: "", searchQueries: [part] } };
    stock.push(...(await gatherStock(ctx, pool, probe, 4).catch(() => [])).slice(0, 2));
  }
  // Stock search matches words, not meaning ("family-controlled" finds a family of baboons): check against the whole label.
  if (stock.length && visionProvider(ctx.options) !== "captions") {
    const probe: Scene = { ...scene, visual: { kind: "stock", subject: label, context: `a box in a diagram about ${ctx.options.topic}; any photo that clearly represents "${label}" fits`, searchQueries: [] } };
    await verify(ctx, probe, stock);
    ids = [...ids, ...stock.filter((c) => (c.score ?? 0) >= 5).map((c) => c.id)];
  } else ids = [...ids, ...stock.map((c) => c.id)];
  return [...new Set(ids)].slice(0, 6);
}

// ---------------------------------------------------------------- step

export const visualsStep: StepDef = {
  name: "visuals",
  inputs: (ctx) => {
    const up = ctx.file("uploads", "media");
    return { script: ctx.hash("script.json"), format: ctx.options.format, uploads: fs.existsSync(up) ? fs.readdirSync(up).sort() : [], vision: visionProvider(ctx.options), editorial: ctx.options.theme === "editorial", v: 3 };
  },
  async run(ctx) {
    articleImagesMemo = null;
    quotaWarned = false;
    unsplashWarned = false;
    const canCheck = visionProvider(ctx.options) !== "captions";
    const script = ctx.read<Script>("script.json");
    const research = ctx.read<Research>("research.json");
    if (!script || !research) throw new Error("script.json / research.json missing");
    ensureDir(ctx.file("media", "thumbs"));
    const previous = ctx.read<VisualsResult>("visuals.json");
    const all: Record<string, Candidate> = { ...(previous?.candidates ?? {}) };
    const pool = new Pool(ctx, all);

    ctx.progress(0.03, "Matching your uploads…");
    const { byScene: uploadMatches, uploads } = await matchUploads(ctx, pool, script).catch((e) => {
      ctx.warn(`Upload matching failed: ${(e as Error).message}`);
      return { byScene: new Map<string, string[]>(), uploads: [] as string[] };
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
        const prev = prevBySubject.get(key);
        const unchecked = canCheck && kind !== "stock" && prev?.some((id) => all[id]?.verdict?.startsWith("unverified"));
        if (prev && !unchecked && prev.every((id) => all[id])) {
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

    // Flow diagrams: one photo per box, gathered once per label (the same label in two diagrams shares photos).
    const prevNodes = new Map(previous?.scenes.flatMap((v) => v.nodes ?? []).map((n) => [nodeKey(n.label), n]) ?? []);
    const flows = script.scenes.filter((s) => s.sceneType === "FlowDiagram" && s.data.nodes?.length);
    const labels = [...new Set(flows.flatMap((s) => s.data.nodes!.map(nodeKey)))];
    const nodeCands = new Map<string, string[]>();
    await mapLimit(labels, 3, async (key) => {
      const scene = flows.find((s) => s.data.nodes!.some((n) => nodeKey(n) === key))!;
      const label = scene.data.nodes!.find((n) => nodeKey(n) === key)!;
      const prev = prevNodes.get(key);
      try {
        const found = prev?.candidates.filter((id) => !id.startsWith("up-")) ?? []; // uploads are added per run below
        nodeCands.set(key, found.length && found.every((id) => all[id]) ? found : await gatherNode(ctx, pool, research, scene, label));
        ctx.info(`Flow diagram box "${label}": ${nodeCands.get(key)!.length} photo(s)`);
      } catch (e) {
        ctx.warn(`Photos for flow diagram box "${label}" failed: ${(e as Error).message}`);
        nodeCands.set(key, []);
      }
    });
    const prevFlow = new Map(previous?.scenes.map((v) => [v.sceneId, v.nodes]) ?? []);
    const flowNodes = (s: Scene): NodeVisual[] =>
      (s.data.nodes ?? []).map((label, i) => {
        // Uploads matched to this box come first; every other upload is offered too, so you can always pick your own.
        const matched = uploadMatches.get(`${s.id}#${i + 1}`) ?? [];
        const found = nodeCands.get(nodeKey(label)) ?? [];
        const candidates = [...new Set([...matched, ...found, ...uploads])].filter((id) => all[id]);
        const old = prevFlow.get(s.id)?.[i];
        // Keep the creator's pick for this box; otherwise a matched upload, then the best photo found (never an unmatched upload).
        const keep = old && nodeKey(old.label) === nodeKey(label) && old.chosen && candidates.includes(old.chosen) ? old.chosen : null;
        const chosen = keep ?? matched.find((id) => all[id]) ?? found.find((id) => all[id]) ?? null;
        return { label, candidates, chosen };
      });

    // Choose per scene: user uploads first, then rotate through verified candidates so repeats differ.
    const useCount = new Map<string, number>();
    const prevChosen = new Map(previous?.scenes.map((v) => [v.sceneId, v]) ?? []);
    const scenes: SceneVisual[] = script.scenes.map((s) => {
      const key = subjectKey(s);
      const cands = [...(uploadMatches.get(s.id) ?? []), ...(subjectCands.get(key) ?? [])].filter((id, i, a) => all[id] && a.indexOf(id) === i);
      // Editorial cuts every ~1.5 s, so footage scenes get an extra image to cycle through.
      const footage = ctx.options.theme === "editorial" && ["KineticCaption", "BigNumber"].includes(s.sceneType) ? 3 : 2;
      const want = s.sceneType === "PhotoStack" ? 4 : s.visual.kind === "graphic" && !["KineticCaption", "BigNumber"].includes(s.sceneType) ? 0 : footage;
      const old = prevChosen.get(s.id);
      let chosen: string[];
      if (old && old.subjectKey === key && old.chosen.length && old.chosen.every((id) => cands.includes(id))) {
        chosen = old.chosen; // keep the creator's manual picks
      } else {
        chosen = [...cands].sort((a, b) => (useCount.get(a) ?? 0) - (useCount.get(b) ?? 0) || (all[b].score ?? 0) - (all[a].score ?? 0)).slice(0, want);
      }
      for (const id of chosen) useCount.set(id, (useCount.get(id) ?? 0) + 1);
      const v: SceneVisual = { sceneId: s.id, subjectKey: key, candidates: cands, chosen };
      if (s.sceneType === "FlowDiagram" && s.data.nodes?.length) v.nodes = flowNodes(s);
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
    for (const id of [...s.chosen, ...(s.nodes ?? []).map((n) => n.chosen).filter((x): x is string => Boolean(x))]) {
      const c = v.candidates[id];
      if (!c) continue;
      const cr = byFile.get(c.file) ?? { file: c.file, sceneIds: [], provider: c.provider, sourcePage: c.sourcePage, originalUrl: c.originalUrl, author: c.author, authorUrl: c.authorUrl, license: c.license };
      cr.sceneIds.push(s.sceneId);
      byFile.set(c.file, cr);
    }
  }
  ctx.write("credits.json", [...byFile.values()]);
}
