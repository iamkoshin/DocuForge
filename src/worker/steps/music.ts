import fs from "node:fs";
import path from "node:path";
import { cachedFile } from "@/lib/cache";
import { composeMusic, FeatureUnavailableError, MUSIC_MAX_MS } from "@/lib/clients/elevenlabs";
import { crossfadeConcat, fitAudio, normalizeMusic, probeDuration } from "@/lib/ffmpeg";
import { addToLibrary, generatedName } from "@/lib/music";
import { addCost } from "@/lib/projects";
import type { Script, VoiceResult } from "@/lib/schemas";
import { buildTimeline } from "@/lib/timeline";
import type { StepCtx, StepDef } from "../context";

export interface MusicResult {
  file: string | null;
  source: "generated" | "upload" | "none";
  warning?: string;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

function uploadedTrack(ctx: StepCtx) {
  const dir = ctx.file("uploads", "music");
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).find((n) => /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(n));
  return f ? path.join(dir, f) : null;
}

async function generate(ctx: StepCtx, prompt: string, seconds: number) {
  const ms = Math.round(seconds * 1000);
  const { file, hit } = await cachedFile("music", { prompt, ms, model: ctx.settings.musicModel }, "mp3", async () => {
    const buf = await composeMusic({ prompt, lengthMs: ms, modelId: ctx.settings.musicModel });
    addCost({
      projectId: ctx.id,
      step: "music",
      provider: "elevenlabs",
      units: seconds,
      unitType: "music-seconds",
      usd: (seconds / 60) * ctx.settings.elevenUsdPerMusicMinute,
      note: `music ${fmt(seconds)}`,
    });
    return buf;
  });
  if (hit) ctx.info(`Reused cached music (${fmt(seconds)})`);
  return file;
}

export const musicStep: StepDef = {
  name: "music",
  inputs: (ctx) => {
    const up = uploadedTrack(ctx);
    return { voice: ctx.hash("voice.json"), mood: ctx.options.musicMood, tone: ctx.options.tone, theme: ctx.options.theme, model: ctx.settings.musicModel, v: 2, upload: up ? fs.statSync(up).mtimeMs : null };
  },
  async run(ctx) {
    const script = ctx.read<Script>("script.json");
    const voice = ctx.read<VoiceResult>("voice.json");
    if (!script || !voice) throw new Error("script.json / voice.json missing");
    const tl = buildTimeline(script, voice);
    const total = tl[tl.length - 1].end;
    const out = ctx.file("music.mp3");

    const upload = uploadedTrack(ctx);
    if (upload) {
      ctx.info(`Using uploaded music track ${path.basename(upload)}`);
      await fitAudio(upload, out + ".tmp.mp3", total);
      await normalizeMusic(out + ".tmp.mp3", out);
      fs.rmSync(out + ".tmp.mp3", { force: true });
      ctx.write("music.json", { file: "music.mp3", source: "upload" } satisfies MusicResult);
      return "done";
    }
    const mood = ctx.options.musicMood.trim();
    if (!mood || mood.toLowerCase() === "none") {
      ctx.write("music.json", { file: null, source: "none" } satisfies MusicResult);
      return "skipped";
    }

    const climaxIdx = Math.max(0, script.scenes.findIndex((s) => s.climax));
    const climaxAt = tl[climaxIdx]?.voiceStart ?? total * 0.7;
    const editorial = ctx.options.theme === "editorial";
    const base = editorial
      ? // Modern explainer bed. It must be audible on phone speakers, so the pulse lives in the mid-range, not only the sub-bass.
        `Modern documentary score for a fast-paced YouTube explainer, ${mood} mood, about 100 BPM. A steady, driving pulse in the mid-range: muted synth plucks or staccato piano repeating a simple motif, a warm sustained synth pad, and a soft punchy kick with a sub-bass hit on each beat. Clear, present and full-range (clearly audible on phone speakers), but no lead melody and nothing busy. No vocals, no lyrics.`
      : `Instrumental documentary underscore, ${mood} mood, ${ctx.options.tone.toLowerCase()} tone. No vocals, no lyrics. Sits under narration: sparse mid-range, no busy melodies.`;
    const arc = editorial
      ? `The pulse starts right away (no slow intro), keeps momentum the whole time, adds layers to build intensity toward ${fmt(climaxAt)}, then resolves into a final chord.`
      : `Starts quiet and sparse, builds tension gradually, reaches its most intense point around ${fmt(climaxAt)}, then resolves softly for the ending.`;

    try {
      if (total * 1000 + 2000 <= MUSIC_MAX_MS) {
        ctx.progress(0.2, `Composing ${fmt(total)} of music…`);
        const prompt = `${base} ${arc} Total length ${fmt(total)}.`;
        const f = await generate(ctx, prompt, total + 2);
        await normalizeMusic(f, out);
      } else {
        // Longer than one track allows: one cue per chapter, joined with crossfades.
        const fade = 3;
        const parts: string[] = [];
        for (const [i, ch] of script.chapters.entries()) {
          const scenes = tl.filter((t) => script.scenes.find((s) => s.id === t.sceneId)?.chapterId === ch.id);
          if (!scenes.length) continue;
          const len = scenes[scenes.length - 1].end - scenes[0].start + (i > 0 ? fade : 0);
          const peak = scenes.some((t) => t.voiceStart <= climaxAt && t.end > climaxAt);
          ctx.progress(0.1 + (0.8 * i) / script.chapters.length, `Composing music for chapter ${i + 1}/${script.chapters.length}…`);
          const prompt = `${base} Chapter "${ch.title}". ${peak ? "This is the climax: build to peak intensity, then a sudden drop." : i === script.chapters.length - 1 ? "Final chapter: reflective, resolving, gentle ending." : "Steady, building tension with movement."} Length ${fmt(len)}.`;
          parts.push(await generate(ctx, prompt, Math.min(len, MUSIC_MAX_MS / 1000)));
        }
        await crossfadeConcat(parts, out + ".tmp.mp3", fade);
        await normalizeMusic(out + ".tmp.mp3", out);
        fs.rmSync(out + ".tmp.mp3", { force: true });
      }
      const d = await probeDuration(out);
      const saved = addToLibrary(out, generatedName(ctx.options.topic, mood));
      ctx.info(`Music ready (${fmt(d)}), saved to the music library as “${saved}”`);
      ctx.write("music.json", { file: "music.mp3", source: "generated" } satisfies MusicResult);
      return "done";
    } catch (e) {
      if (e instanceof FeatureUnavailableError) {
        ctx.warn(`${e.message}. Continuing without music — you can upload a track on the project page and re-render.`);
        ctx.write("music.json", { file: null, source: "none", warning: e.message } satisfies MusicResult);
        return "skipped";
      }
      throw e;
    }
  },
};
