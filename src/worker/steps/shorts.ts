import fs from "node:fs";
import path from "node:path";
import * as z from "zod";
import { claudeJson } from "@/lib/clients/anthropic";
import { geminiJson } from "@/lib/clients/gemini";
import { emphasisStyle, numberish } from "@/lib/editorial";
import { normalizeLoudness, probeDuration } from "@/lib/ffmpeg";
import { ensureDir } from "@/lib/paths";
import { usesClaudeApi } from "@/lib/mode";
import type { RenderProps, RenderScene, Script } from "@/lib/schemas";
import { hasKey } from "@/lib/settings";
import type { StepCtx, StepDef } from "../context";
import { renderVideo } from "../render";

// Highlight shorts: up to 3 runs of consecutive scenes from the finished video, re-rendered natively in 9:16
// with a hook line on top. Nothing paid is redone: same voice, images, music and sound effects.

export interface Short {
  file: string;
  title: string;
  hook: string;
  description: string;
  sceneIds: string[];
  /** Where the clip sits in the full video, in seconds. */
  from: number;
  to: number;
  durationSec: number;
}
export interface ShortsResult {
  key: string;
  shorts: Short[];
}

const COUNT = 3;
const MIN_SEC = 15;
const MAX_SEC = 58; // under a minute, so it's a Short everywhere
const TAIL_FRAMES = 20; // a beat after the last word

// Scenes that only make sense inside the long video.
const skipInShort = (s: RenderScene) => s.type === "ChapterTitle" || s.type === "EndCard";

const PickSchema = z.object({
  shorts: z
    .array(
      z.object({
        firstScene: z.number().int().describe("Number of the first scene (from the list)"),
        lastScene: z.number().int().describe("Number of the last scene, inclusive"),
        title: z.string().describe("YouTube Shorts title, ≤ 60 characters, curiosity-driven but accurate"),
        hook: z.string().describe("2–6 words shown big at the top for the first seconds; makes a stranger stop scrolling"),
        description: z.string().describe("1–2 sentences plus 3 relevant hashtags"),
      }),
    )
    .describe(`Exactly ${COUNT} non-overlapping highlights`),
});
type Pick = { a: number; b: number; title: string; hook: string; description: string };

const secs = (props: RenderProps, a: number, b: number) =>
  props.scenes.slice(a, b + 1).reduce((t, s) => t + (skipInShort(s) ? 0 : s.durationFrames), 0) / props.fps;

/** Longest a short may be: under a minute, and short enough that 3 fit in a short video. */
const maxLen = (props: RenderProps) => Math.min(MAX_SEC, Math.max(MIN_SEC + 5, secs(props, 0, props.scenes.length - 1) / COUNT));

/** Score a scene for "would this stop a scroll": climaxes, figures, alarming words. */
function sceneScore(s: RenderScene) {
  const words = s.narration.split(/\s+/);
  let n = s.climax ? 3 : 0;
  if (words.some(numberish)) n += 1;
  if (words.some((w) => emphasisStyle(w, false) === "danger")) n += 1;
  if (s.type === "Statement" || s.type === "BigNumber") n += 0.5;
  return n;
}

/** Keep picks in range and inside the length limits; drop overlaps. */
function clean(props: RenderProps, picks: Pick[]) {
  const last = props.scenes.length - 1;
  const out: Pick[] = [];
  for (const p0 of picks) {
    const p = { ...p0, a: Math.max(0, Math.min(last, p0.a)), b: Math.max(0, Math.min(last, p0.b)) };
    if (p.b < p.a) continue;
    while (p.b > p.a && secs(props, p.a, p.b) > MAX_SEC) p.b--;
    while (p.a < p.b && skipInShort(props.scenes[p.a])) p.a++;
    while (p.b > p.a && skipInShort(props.scenes[p.b])) p.b--;
    if (secs(props, p.a, p.b) < MIN_SEC) continue;
    if (out.some((o) => p.a <= o.b && p.b >= o.a)) continue;
    out.push(p);
  }
  return out;
}

/** Fallback without an AI: the best-scoring windows of consecutive scenes, preferring ones that open a chapter. */
function heuristicPicks(props: RenderProps, script: Script, taken: Pick[]) {
  const windows: (Pick & { score: number })[] = [];
  const limit = maxLen(props);
  for (let a = 0; a < props.scenes.length; a++) {
    if (skipInShort(props.scenes[a])) continue;
    let score = 0;
    for (let b = a; b < props.scenes.length; b++) {
      const d = secs(props, a, b);
      if (d > limit) break;
      score += sceneScore(props.scenes[b]);
      if (d < MIN_SEC || skipInShort(props.scenes[b])) continue;
      const opensChapter = a === 0 || props.scenes[a - 1].chapterId !== props.scenes[a].chapterId || props.scenes[a - 1].type === "ChapterTitle";
      // A chapter name like "Part 1" says nothing to a stranger; use the video's hook text instead.
      const chapter = script.chapters.find((c) => c.id === props.scenes[a].chapterId)?.title ?? "";
      const hook = chapter && !/^(part|chapter|act|section|episode)\b/i.test(chapter) ? chapter : script.thumbnailText || script.title;
      windows.push({ a, b, score: score + (opensChapter ? 1 : 0) + d / limit, title: (hook === script.title ? hook : `${hook} | ${script.title}`).slice(0, 90), hook, description: props.scenes[a].narration });
    }
  }
  windows.sort((x, y) => y.score - x.score);
  const out: Pick[] = [];
  for (const w of windows) {
    if (taken.length + out.length >= COUNT) break;
    if ([...taken, ...out].some((o) => w.a <= o.b && w.b >= o.a)) continue;
    out.push(w);
  }
  return out;
}

export async function pickShorts(ctx: StepCtx, props: RenderProps, script: Script): Promise<Pick[]> {
  const list = props.scenes
    .map((s, i) => `${i + 1}. [${(s.durationFrames / props.fps).toFixed(1)}s${skipInShort(s) ? `, ${s.type}: not used in shorts` : ""}${s.climax ? ", climax" : ""}] ${s.narration}`)
    .join("\n");
  const system =
    "You cut highlight YouTube Shorts from a finished documentary. Each short is a run of consecutive scenes that works for a viewer who never saw the video: " +
    "the first sentence must hook on its own (no 'he', 'this', 'then' without a subject), and the last scene must land a payoff (a reveal, a number, a twist), not trail off. " +
    `Each short is ${MIN_SEC}–${Math.round(maxLen(props))} seconds (add up the scene lengths). Pick the ${COUNT} most surprising, emotional or shareable moments, spread across the video, never overlapping. ` +
    "Titles and hooks must be accurate to the narration — no claims it doesn't make.";
  const content = `Video title: ${script.title}\nLanguage: ${ctx.options.language}\n\nScenes:\n${list}`;
  const call = { projectId: ctx.id, step: ctx.step, model: ctx.model };
  let raw: z.infer<typeof PickSchema> | null = null;
  try {
    if (hasKey("GEMINI_API_KEY")) raw = await geminiJson({ ctx: call, label: "shorts", schema: PickSchema, system, parts: [{ text: content }] });
    else if (usesClaudeApi(ctx.options)) raw = await claudeJson({ ctx: call, label: "shorts", schema: PickSchema, effort: "low", maxTokens: 8000, system, content });
  } catch (e) {
    ctx.warn(`Couldn’t ask the AI to pick highlights (${(e as Error).message}); picking them from the script instead.`);
  }
  const picked = clean(props, (raw?.shorts ?? []).map((s) => ({ a: s.firstScene - 1, b: s.lastScene - 1, title: s.title, hook: s.hook, description: s.description })));
  if (raw) ctx.info(`AI picked ${picked.length} usable highlight${picked.length === 1 ? "" : "s"}`);
  const more = picked.length < COUNT ? clean(props, heuristicPicks(props, script, picked)) : [];
  return [...picked, ...more.filter((m) => !picked.some((o) => m.a <= o.b && m.b >= o.a))].slice(0, COUNT).sort((x, y) => x.a - y.a);
}

/** Props for one short: the chosen scenes laid end to end in 9:16, with their own voice, sound effects and pauses. */
export function shortProps(props: RenderProps, pick: Pick, musicVolume: number): RenderProps {
  const scenes: RenderScene[] = [];
  const sfx: RenderProps["sfx"] = [];
  const speech: RenderProps["speech"] = [];
  let t = 0;
  for (const s of props.scenes.slice(pick.a, pick.b + 1)) {
    if (skipInShort(s)) continue;
    const end = s.startFrame + s.durationFrames;
    const shift = t - s.startFrame;
    scenes.push({ ...s, startFrame: t });
    for (const e of props.sfx) if (e.startFrame >= s.startFrame && e.startFrame < end) sfx.push({ ...e, startFrame: e.startFrame + shift });
    for (const [a, b] of props.speech) if (b > s.startFrame && a < end) speech.push([Math.max(a, s.startFrame) + shift, Math.min(b, end) + shift]);
    t += s.durationFrames;
  }
  const lastScene = scenes[scenes.length - 1];
  lastScene.durationFrames += TAIL_FRAMES;
  t += TAIL_FRAMES;
  return {
    ...props,
    width: 1080,
    height: 1920,
    format: "9:16",
    durationInFrames: t,
    scenes,
    sfx,
    speech,
    music: props.music ? { ...props.music, durationFrames: t } : undefined,
    musicBaseDb: props.musicBaseDb + musicVolume,
    banner: pick.hook,
    thumbnail: undefined,
  };
}

const ts = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export const shortsStep: StepDef = {
  name: "shorts",
  // Only runs after "Make 3 shorts" is clicked (that writes shorts-request.json).
  inputs: (ctx) => ({ request: ctx.hash("shorts-request.json") }),
  async run(ctx) {
    if (!fs.existsSync(ctx.file("shorts-request.json"))) return "skipped";
    const props = ctx.read<RenderProps>("project.json");
    const script = ctx.read<Script>("script.json");
    if (!props || !script || !fs.existsSync(ctx.file("video.mp4"))) throw new Error("Render the video first, then make shorts.");

    // A re-render resets this step; only rebuild the shorts when the video actually changed.
    const key = JSON.stringify({ request: ctx.hash("shorts-request.json"), props: ctx.hash("project.json"), music: ctx.options.musicVolume ?? 0 });
    const prev = ctx.read<ShortsResult>("shorts.json");
    if (prev?.key === key && prev.shorts.every((s) => fs.existsSync(ctx.file(s.file)))) {
      ctx.info("Shorts are up to date");
      return "done";
    }

    ctx.progress(0.01, "Picking highlights…");
    const picks = await pickShorts(ctx, props, script);
    if (!picks.length) throw new Error(`The video is too short for a highlight of at least ${MIN_SEC}s.`);
    if (picks.length < COUNT) ctx.warn(`Only ${picks.length} highlight${picks.length === 1 ? "" : "s"} fit without overlapping (each needs ${MIN_SEC}–${MAX_SEC}s).`);

    const dir = ensureDir(ctx.file("shorts"));
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
    const shorts: Short[] = [];
    for (const [i, pick] of picks.entries()) {
      const p = shortProps(props, pick, ctx.options.musicVolume ?? 0);
      const raw = ctx.file("shorts", `short-${i + 1}-raw.mp4`);
      const file = `shorts/short-${i + 1}.mp4`;
      const base = i / picks.length;
      await renderVideo(ctx, p, raw, (x) => ctx.progress(0.03 + 0.95 * (base + (x * 0.9) / picks.length), `Rendering short ${i + 1}/${picks.length} ${Math.round(x * 100)}%`));
      await normalizeLoudness(raw, ctx.file(file));
      fs.rmSync(raw, { force: true });
      const from = props.scenes[pick.a].startFrame / props.fps;
      const to = (props.scenes[pick.b].startFrame + props.scenes[pick.b].durationFrames) / props.fps;
      const durationSec = await probeDuration(ctx.file(file));
      shorts.push({ file, title: pick.title, hook: pick.hook, description: pick.description, sceneIds: p.scenes.map((s) => s.id), from, to, durationSec });
      ctx.info(`Short ${i + 1}: “${pick.hook}” — ${ts(from)}–${ts(to)} of the video, ${durationSec.toFixed(1)}s`);
    }

    fs.writeFileSync(
      ctx.file("shorts", "shorts.md"),
      shorts.map((s, i) => [`## Short ${i + 1} (${s.durationSec.toFixed(0)}s, from ${ts(s.from)}–${ts(s.to)})`, "", `**Title:** ${s.title}`, "", s.description, ""].join("\n")).join("\n"),
    );
    ctx.write("shorts.json", { key, shorts } satisfies ShortsResult);
    return "done";
  },
};
