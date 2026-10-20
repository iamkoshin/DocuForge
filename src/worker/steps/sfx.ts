import type { Scene, Script, SfxEvent, VoiceResult, WordTiming } from "@/lib/schemas";
import { bumpUses, CATEGORY_DB, categoryOf, distinctKeys, ensureVariations, generateSfx, matchKey, pickVariation, seedStarterPack, STARTER_PACK, type SfxCategory } from "@/lib/sfx";
import { buildTimeline, type TimedScene } from "@/lib/timeline";
import { FPS, T } from "@/lib/timing";
import type { StepCtx, StepDef } from "../context";

interface PlannedCue {
  cue: string; // key or free-text prompt
  time: number; // absolute seconds where the sound should be heard (its onset, or its end for risers)
  alignEnd?: boolean; // risers: the END lands on `time`
  intensity: "low" | "medium" | "high";
  sceneId: string;
  reason: string;
  maxDur?: number;
  duck?: boolean;
}

const LEVEL = {
  subtle: { claude: ["high"], cutEvery: 0, auto: false, perScene: 1, db: -3 },
  normal: { claude: ["medium", "high"], cutEvery: 3, auto: true, perScene: 2, db: 0 },
  punchy: { claude: ["low", "medium", "high"], cutEvery: 2, auto: true, perScene: 4, db: 1.5 },
} as const;
const INTENSITY_DB = { low: -3, medium: 0, high: 2 };
const dbToGain = (db: number) => Math.pow(10, db / 20);
const clean = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

function findWord(words: WordTiming[], anchor?: string) {
  if (!anchor) return null;
  const a = clean(anchor.split(/\s+/)[0]);
  return words.find((w) => clean(w.word) === a) ?? words.find((w) => clean(w.word).startsWith(a.slice(0, 5)) && a.length >= 4) ?? null;
}

function planCues(script: Script, voice: VoiceResult, tl: TimedScene[], level: keyof typeof LEVEL): PlannedCue[] {
  const L = LEVEL[level];
  const cues: PlannedCue[] = [];
  const vmap = new Map(voice.scenes.map((v) => [v.sceneId, v]));
  // Deterministic "random" so re-runs give the same mix.
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);

  script.scenes.forEach((s: Scene, i) => {
    const t = tl[i];
    const words = vmap.get(s.id)?.words ?? [];
    const dur = t.end - t.start;
    const abs = (sec: number) => t.start + sec;
    const add = (c: Omit<PlannedCue, "sceneId">) => cues.push({ ...c, sceneId: s.id });

    // 1) Claude's planned cues.
    for (const c of s.sfx) {
      if (!(L.claude as readonly string[]).includes(c.intensity)) continue;
      let time = t.voiceStart;
      if (c.at === "end") time = t.voiceEnd;
      if (c.at === "word") {
        const w = findWord(words, c.anchorWord);
        time = w ? t.voiceStart + w.start : t.voiceStart;
      }
      const isRiser = categoryOf(matchKey(c.cue) ?? c.cue) === "riser";
      add({ cue: c.cue, time, alignEnd: isRiser, intensity: c.intensity, reason: `script cue (${c.at}${c.anchorWord ? ` "${c.anchorWord}"` : ""})`, duck: c.intensity === "high" });
    }

    // 2) Automatic cues by scene type.
    if (L.auto || ["ChapterTitle"].includes(s.sceneType)) {
      switch (s.sceneType) {
        case "KineticCaption": {
          const ems = level === "punchy" ? s.emphasisWords : s.emphasisWords.slice(0, 1);
          for (const e of ems) {
            const w = findWord(words, e);
            if (w) add({ cue: "swoosh_text_in", time: t.voiceStart + w.start - 0.08, intensity: "low", reason: `emphasis "${e}"` });
          }
          break;
        }
        case "BigNumber":
          add({ cue: "impact_boom", time: abs(T.bigNumberSnap), intensity: "high", reason: "number snaps in", duck: true });
          break;
        case "NameReveal":
          add({ cue: "camera_shutter", time: abs(T.nameRevealSnap), intensity: "medium", reason: "name reveal" });
          add({ cue: "hit_low_soft", time: abs(T.nameRevealSnap), intensity: "medium", reason: "name reveal" });
          break;
        case "PaperDocument":
          add({ cue: "paper_slide", time: abs(T.paperIn), intensity: "low", reason: "paper slides in" });
          if (s.data.docType === "filing" || s.data.stampText) add({ cue: "rubber_stamp_slam", time: abs(T.stamp(dur)), intensity: "high", reason: "stamp", duck: true });
          break;
        case "CodeSnippet": {
          const typing = T.codeTyping(s.data.code?.length ?? 120, dur);
          add({ cue: "keyboard_typing", time: abs(T.codeStart), intensity: "low", reason: "code typing", maxDur: typing });
          break;
        }
        case "FlowDiagram": {
          const n = Math.max(1, (s.data.nodes?.length ?? 2) - 1);
          T.stepTimes(n, dur).forEach((x, k) => add({ cue: "whoosh_fast_airy", time: abs(x), intensity: "low", reason: `flow line ${k + 1}` }));
          break;
        }
        case "Timeline":
          T.stepTimes(s.data.timelineEvents?.length ?? 3, dur).forEach((x, k) => add({ cue: "clock_tick", time: abs(x), intensity: "low", reason: `date ${k + 1}` }));
          break;
        case "ChapterTitle":
          add({ cue: "riser_2s", time: abs(T.chapterSlam), alignEnd: true, intensity: "medium", reason: "chapter title riser" });
          add({ cue: "impact_boom", time: abs(T.chapterSlam), intensity: "high", reason: "chapter title", duck: true });
          break;
        case "PhotoStack":
          if (level === "punchy") T.stepTimes(Math.min(4, s.data.captions?.length ?? 2), dur).forEach((x) => add({ cue: "paper_slide", time: abs(x), intensity: "low", reason: "photo drop" }));
          break;
      }
    }

    // 3) Whooshes on some cuts (varied, never every cut).
    if (i > 0 && L.cutEvery && s.sceneType !== "ChapterTitle" && rnd() < 1 / L.cutEvery) {
      add({ cue: rnd() < 0.6 ? "whoosh_fast_airy" : "whoosh_slow_deep", time: t.start, intensity: "low", reason: "scene cut" });
    }

    // 4) Climax: riser → silence → sub drop on the first word.
    if (s.climax) {
      add({ cue: "riser_4s", time: t.voiceStart - 1.0, alignEnd: true, intensity: "high", reason: "climax riser" });
      add({ cue: "sub_bass_drop", time: t.voiceStart, intensity: "high", reason: "climax drop", duck: true });
    }
  });
  return cues;
}

/** Overlaps a spoken word? (absolute seconds) */
function overlapsSpeech(start: number, end: number, script: Script, voice: VoiceResult, tl: TimedScene[]) {
  const vmap = new Map(voice.scenes.map((v) => [v.sceneId, v]));
  for (let i = 0; i < tl.length; i++) {
    if (tl[i].voiceEnd < start || tl[i].voiceStart > end) continue;
    for (const w of vmap.get(script.scenes[i].id)?.words ?? []) {
      const ws = tl[i].voiceStart + w.start;
      const we = tl[i].voiceStart + w.end;
      if (ws < end && we > start) return true;
    }
  }
  return false;
}

export const sfxStep: StepDef = {
  name: "sfx",
  inputs: (ctx) => ({ script: ctx.hash("script.json"), voice: ctx.hash("voice.json"), level: ctx.options.sfxLevel, v: 2 }),
  async run(ctx) {
    const level = ctx.options.sfxLevel;
    if (level === "off") {
      ctx.write("sfx.json", []);
      return "skipped";
    }
    const script = ctx.read<Script>("script.json");
    const voice = ctx.read<VoiceResult>("voice.json");
    if (!script || !voice) throw new Error("script.json / voice.json missing");
    const tl = buildTimeline(script, voice);

    ctx.progress(0.05, "Checking SFX library…");
    await seedStarterPack({ projectId: ctx.id });

    const planned = planCues(script, voice, tl, level);
    const L = LEVEL[level];

    // Resolve every cue to a library key, generating genuinely new sounds once.
    const keys = distinctKeys().map((k) => k.key);
    const resolved = new Map<string, string>();
    const newOnes = [...new Set(planned.map((p) => p.cue))].filter((c) => !matchKey(c, keys));
    for (const [i, cue] of newOnes.entries()) {
      ctx.progress(0.1 + (0.5 * i) / Math.max(1, newOnes.length), `Generating new sound: ${cue}`);
      const row = await generateSfx({ prompt: cue, projectId: ctx.id });
      keys.push(row.key);
      resolved.set(cue, row.key);
      ctx.info(`New SFX added to library: ${row.key}`);
    }
    for (const p of planned) if (!resolved.has(p.cue)) resolved.set(p.cue, matchKey(p.cue, keys)!);

    // Frequently used starter sounds get their extra variations (generated once, then reused forever).
    const counts = new Map<string, number>();
    for (const p of planned) counts.set(resolved.get(p.cue)!, (counts.get(resolved.get(p.cue)!) ?? 0) + 1);
    for (const [k, n] of counts) {
      if (n < 3 || !STARTER_PACK.some((s) => s.key === k)) continue;
      await ensureVariations(k, ctx.id).catch((e) => ctx.warn(`Couldn’t add variations of ${k} (${(e as Error).message}); reusing the existing take.`));
    }

    // Place events: thin clutter, rotate variations, set levels.
    const perScene = new Map<string, number>();
    const lastByCat = new Map<SfxCategory, number>();
    const used = new Map<string, number>();
    const events: SfxEvent[] = [];
    // Most important cues claim their slot first, so thinning only ever drops minor ones.
    const prio = { high: 0, medium: 1, low: 2 };
    const sorted = [...planned].sort((a, b) => prio[a.intensity] - prio[b.intensity] || a.time - b.time);
    for (const p of sorted) {
      const key = resolved.get(p.cue)!;
      const cat = categoryOf(key);
      const n = perScene.get(p.sceneId) ?? 0;
      if (n >= L.perScene && p.intensity !== "high") continue;
      const last = lastByCat.get(cat);
      if (last !== undefined && Math.abs(last - p.time) < 0.3) continue;
      const row = pickVariation(key, used.get(key) ?? 0);
      if (!row) continue;
      used.set(key, (used.get(key) ?? 0) + 1);
      const len = Math.min(row.duration, p.maxDur ?? row.duration);
      const start = Math.max(0, p.alignEnd ? p.time - len : p.time);
      let db = CATEGORY_DB[cat] + INTENSITY_DB[p.intensity] + L.db;
      if (cat !== "impact" && overlapsSpeech(start, start + Math.min(len, 1.5), script, voice, tl)) db -= 4; // never mask a spoken word
      if (cat === "impact" && overlapsSpeech(start + 0.15, start + Math.min(len, 1.5), script, voice, tl)) db -= 2;
      events.push({
        key,
        file: row.file,
        startFrame: Math.round(start * FPS),
        durationFrames: Math.max(1, Math.round(len * FPS)),
        volume: Math.round(dbToGain(db) * 1000) / 1000,
        duck: Boolean(p.duck || cat === "impact"),
        sceneId: p.sceneId,
        reason: p.reason,
      });
      bumpUses(row.id);
      perScene.set(p.sceneId, n + 1);
      lastByCat.set(cat, p.time);
    }
    events.sort((a, b) => a.startFrame - b.startFrame);
    ctx.write("sfx.json", events);
    ctx.info(`SFX timeline: ${events.length} cues (${newOnes.length} new sounds generated, the rest reused from the library)`);
    return "done";
  },
};
