import fs from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { hashOf } from "@/lib/cache";
import { DATA_DIR, ensureDir, ROOT } from "@/lib/paths";
import type { RenderProps, RenderScene, Script, SfxEvent, VisualsResult, VoiceResult } from "@/lib/schemas";
import { buildTimeline } from "@/lib/timeline";
import { FPS, GAP } from "@/lib/timing";
import type { MusicResult } from "./steps/music";
import type { StepCtx } from "./context";

export const ASSET_PORT = Number(process.env.ASSET_PORT || 3939);
export const assetBase = () => `http://127.0.0.1:${ASSET_PORT}/`;
const assetUrl = (relToData: string) => assetBase() + relToData.split(path.sep).join("/").split("/").map(encodeURIComponent).join("/");

// ------------------------------------------------------------------ bundle (cached by source hash)

function sourceHash() {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.(tsx?|css)$/.test(f.name)) files.push(p);
    }
  };
  walk(path.join(ROOT, "remotion"));
  files.push(path.join(ROOT, "src", "lib", "schemas.ts"), path.join(ROOT, "src", "lib", "timing.ts"));
  return hashOf(files.sort().map((f) => f + fs.readFileSync(f, "utf8")).join("\n"));
}

let bundlePromise: { hash: string; p: Promise<string> } | null = null;
export function getBundle(onProgress?: (p: number) => void): Promise<string> {
  const hash = sourceHash();
  if (bundlePromise?.hash === hash) return bundlePromise.p;
  const outDir = path.join(DATA_DIR, ".bundle", hash);
  const p = (async () => {
    if (fs.existsSync(path.join(outDir, "index.html"))) return outDir;
    console.log("[render] bundling Remotion project…");
    const loc = await bundle({
      entryPoint: path.join(ROOT, "remotion", "index.ts"),
      outDir,
      onProgress: (x) => onProgress?.(x / 100),
      webpackOverride: (c) => c,
    });
    return loc;
  })();
  bundlePromise = { hash, p };
  p.catch(() => (bundlePromise = null));
  return p;
}

export const remotionSourceHash = sourceHash;

// ------------------------------------------------------------------ props

export function buildRenderProps(ctx: StepCtx): RenderProps {
  const script = ctx.read<Script>("script.json");
  const voice = ctx.read<VoiceResult>("voice.json");
  const visuals = ctx.read<VisualsResult>("visuals.json");
  const sfx = ctx.read<SfxEvent[]>("sfx.json") ?? [];
  const music = ctx.read<MusicResult>("music.json");
  if (!script || !voice || !visuals) throw new Error("script/voice/visuals missing — run earlier steps first");
  const tl = buildTimeline(script, voice);
  const vmap = new Map(voice.scenes.map((v) => [v.sceneId, v]));
  const vis = new Map(visuals.scenes.map((v) => [v.sceneId, v]));
  const proj = (rel: string) => assetUrl(path.relative(DATA_DIR, ctx.file(rel)));
  const f = (sec: number) => Math.round(sec * FPS);

  const scenes: RenderScene[] = script.scenes.map((s, i) => {
    const t = tl[i];
    const v = vmap.get(s.id)!;
    const sv = vis.get(s.id);
    const offset = t.voiceStart - t.start;
    const startFrame = f(t.start);
    return {
      id: s.id,
      chapterId: s.chapterId,
      index: i,
      type: sv?.fallbackType ?? s.sceneType,
      narration: s.narration,
      emphasisWords: s.emphasisWords,
      startFrame,
      durationFrames: f(t.end) - startFrame,
      audioUrl: proj(v.file),
      audioOffsetFrames: f(offset),
      words: v.words.map((w) => ({ word: w.word, start: w.start + offset, end: w.end + offset })),
      assets: (sv?.chosen ?? [])
        .map((id) => visuals.candidates[id])
        .filter(Boolean)
        .map((c) => ({ id: c.id, url: proj(c.file), type: c.type, width: c.width, height: c.height, durationSec: c.durationSec, focus: c.focus, caption: c.caption })),
      data: s.data,
      climax: s.climax,
    };
  });
  const durationInFrames = scenes.length ? scenes[scenes.length - 1].startFrame + scenes[scenes.length - 1].durationFrames : 1;

  // Speech regions (merging gaps shorter than 0.6 s) so music only lifts in real pauses.
  const speech: [number, number][] = [];
  script.scenes.forEach((s, i) => {
    for (const w of vmap.get(s.id)?.words ?? []) {
      const a = f(tl[i].voiceStart + w.start);
      const b = f(tl[i].voiceStart + w.end);
      const last = speech[speech.length - 1];
      if (last && a - last[1] < f(0.6)) last[1] = Math.max(last[1], b);
      else speech.push([a, b]);
    }
  });
  // Silence as a tool: music drops out just before the biggest reveal.
  const dropouts: [number, number][] = [];
  script.scenes.forEach((s, i) => {
    if (s.climax) dropouts.push([f(tl[i].voiceStart - (GAP.beforeClimax - 0.1)), f(tl[i].voiceStart)]);
  });

  const vertical = ctx.options.format === "9:16";
  return {
    title: script.title,
    fps: FPS,
    width: vertical ? 1080 : 1920,
    height: vertical ? 1920 : 1080,
    format: ctx.options.format,
    theme: ctx.options.theme,
    durationInFrames,
    scenes,
    sfx: sfx.map((e) => ({ url: assetUrl(e.file), startFrame: e.startFrame, durationFrames: e.durationFrames, volume: e.volume, duck: e.duck })),
    music: music?.file ? { url: proj(music.file), durationFrames: durationInFrames } : undefined,
    speech,
    dropouts,
    musicBaseDb: -20,
    pauseBoostDb: 5,
  };
}

// ------------------------------------------------------------------ rendering

export async function renderContactSheet(ctx: StepCtx, props: RenderProps, onProgress: (p: number) => void) {
  const serveUrl = await getBundle();
  const comp = await selectComposition({ serveUrl, id: "Documentary", inputProps: props as unknown as Record<string, unknown> });
  const dir = ensureDir(ctx.file("contact"));
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
  const out: { sceneId: string; file: string; frame: number }[] = [];
  for (const [i, s] of props.scenes.entries()) {
    const frame = s.startFrame + Math.floor(s.durationFrames * 0.62); // late enough to show stamps, last nodes, etc.
    const file = `contact/${s.id}.jpg`;
    await renderStill({ serveUrl, composition: comp, inputProps: props as unknown as Record<string, unknown>, frame, output: ctx.file(file), imageFormat: "jpeg", jpegQuality: 80, scale: 0.4 });
    out.push({ sceneId: s.id, file, frame });
    onProgress((i + 1) / props.scenes.length);
  }
  return out;
}

export async function renderVideo(ctx: StepCtx, props: RenderProps, output: string, onProgress: (p: number, stage: string) => void) {
  const serveUrl = await getBundle((p) => onProgress(p * 0.02, "bundling"));
  const inputProps = props as unknown as Record<string, unknown>;
  const composition = await selectComposition({ serveUrl, id: "Documentary", inputProps });
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: "h264",
    crf: 18,
    pixelFormat: "yuv420p",
    audioCodec: "aac",
    audioBitrate: "320k",
    outputLocation: output,
    concurrency: ctx.settings.renderConcurrency,
    timeoutInMilliseconds: 120000,
    onProgress: ({ progress, stitchStage }) => onProgress(progress, stitchStage === "muxing" ? "muxing" : "rendering"),
  });
}

export async function renderThumbnail(props: RenderProps, output: string) {
  const serveUrl = await getBundle();
  const inputProps = props as unknown as Record<string, unknown>;
  const composition = await selectComposition({ serveUrl, id: "Thumbnail", inputProps });
  await renderStill({ serveUrl, composition, inputProps, output, imageFormat: "png" });
}
