import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as z from "zod";
import { cachedJson, hashOf } from "@/lib/cache";
import { claudeJson } from "@/lib/clients/anthropic";
import { ttsWithTimestamps, type Alignment } from "@/lib/clients/elevenlabs";
import { shiftTime, tightenSpeech } from "@/lib/ffmpeg";
import { mapLimit } from "@/lib/http";
import { ensureDir } from "@/lib/paths";
import { usesClaudeApi } from "@/lib/mode";
import { addCost } from "@/lib/projects";
import type { Research, Script, VoiceResult, VoiceScene, WordTiming } from "@/lib/schemas";
import { buildTimeline, totalSeconds } from "@/lib/timeline";
import type { StepCtx, StepDef } from "../context";

const LANG_CODES: Record<string, string> = {
  english: "en", spanish: "es", french: "fr", german: "de", italian: "it", portuguese: "pt", dutch: "nl", polish: "pl",
  arabic: "ar", hindi: "hi", japanese: "ja", chinese: "zh", korean: "ko", turkish: "tr", russian: "ru", swedish: "sv",
};

/** ElevenLabs character alignment → word timings (seconds). */
export function alignmentToWords(a: Alignment): WordTiming[] {
  const words: WordTiming[] = [];
  let cur: WordTiming | null = null;
  for (let i = 0; i < a.characters.length; i++) {
    const ch = a.characters[i];
    if (/\s/.test(ch)) {
      if (cur) words.push(cur);
      cur = null;
      continue;
    }
    const s = a.character_start_times_seconds[i];
    const e = a.character_end_times_seconds[i];
    if (!cur) cur = { word: ch, start: s, end: e };
    else {
      cur.word += ch;
      cur.end = e;
    }
  }
  if (cur) words.push(cur);
  return words;
}

async function synthScene(ctx: StepCtx, script: Script, i: number): Promise<VoiceScene> {
  const s = script.scenes[i];
  const voiceId = ctx.options.voiceId;
  const model = ctx.settings.ttsModel;
  const languageCode = LANG_CODES[ctx.options.language.toLowerCase()];
  const speed = ctx.settings.voiceSpeed;
  // Cache key deliberately excludes neighbouring text: changing one scene re-voices only that scene.
  // (speed is only part of the key when changed, so existing voiceovers stay cached.)
  const key = { voiceId, model, text: s.narration, languageCode, ...(speed !== 1 ? { speed } : {}) };
  const { value, hit } = await cachedJson("tts", key, async () => {
    const r = await ttsWithTimestamps({
      voiceId,
      modelId: model,
      text: s.narration,
      previousText: script.scenes[i - 1]?.narration,
      nextText: script.scenes[i + 1]?.narration,
      languageCode,
      speed,
    });
    addCost({
      projectId: ctx.id,
      step: "voice",
      provider: "elevenlabs",
      units: s.narration.length,
      unitType: "characters",
      usd: (s.narration.length / 1000) * ctx.settings.elevenUsdPer1kChars,
      note: `TTS ${s.id}`,
    });
    return { audio: r.audio.toString("base64"), alignment: r.alignment };
  });
  const textHash = hashOf(key);
  const rel = `voice/${s.id}-${textHash}.mp3`;
  // ElevenLabs leaves silence before/after each clip and long pauses between sentences; cut it so the
  // narration flows without dead air, and shift the word timings to match.
  const raw = path.join(os.tmpdir(), `narrative-${ctx.id}-${s.id}-${textHash}.mp3`);
  fs.writeFileSync(raw, Buffer.from(value.audio, "base64"));
  let duration: number;
  let words = alignmentToWords(value.alignment);
  try {
    const t = await tightenSpeech(raw, ctx.file(rel));
    duration = t.duration;
    words = words.map((w) => ({ ...w, start: shiftTime(w.start, t.removed), end: Math.min(t.duration, shiftTime(w.end, t.removed)) }));
    if (!hit) ctx.info(`Voiced ${s.id} (${duration.toFixed(1)}s, ${t.removed.reduce((a, [x, y]) => a + y - x, 0).toFixed(1)}s of silence removed)`);
  } finally {
    fs.rmSync(raw, { force: true });
  }
  return { sceneId: s.id, file: rel, duration, words, textHash };
}

const AdjustSchema = z.object({
  rewrites: z.array(z.object({ sceneId: z.string(), narration: z.string() })),
});

async function adjustLength(ctx: StepCtx, script: Script, voice: VoiceScene[], actual: number, target: number, round: number) {
  const research = ctx.read<Research>("research.json");
  const durations = new Map(voice.map((v) => [v.sceneId, v.duration]));
  const wps = voice.reduce((a, v) => a + v.words.length, 0) / Math.max(1, voice.reduce((a, v) => a + v.duration, 0));
  const deltaWords = Math.round((target - actual) * wps);
  const res = await claudeJson({
    ctx: { projectId: ctx.id, step: "voice", model: ctx.model },
    label: "length-adjust",
    schema: AdjustSchema,
    effort: "medium",
    system: "You edit documentary narration to hit an exact runtime while keeping every statement supported by the research claims.",
    content: `The voiceover runs ${actual.toFixed(0)}s; the target is ${target.toFixed(0)}s. ${deltaWords > 0 ? `Add about ${deltaWords}` : `Cut about ${-deltaWords}`} words in total (speaker pace ≈ ${wps.toFixed(2)} words/s).
Change as FEW scenes as possible (prefer ${deltaWords > 0 ? "scenes where added supported detail or a breath of context helps" : "wordy middle scenes"}); never change the first (hook) scene or the final scene. Keep each scene's role, claimIds, and its emphasis words.
Language: ${ctx.options.language}. Return only the scenes you change.

SCENES:\n${JSON.stringify(script.scenes.map((s) => ({ id: s.id, sec: durations.get(s.id)?.toFixed(1), narration: s.narration, claimIds: s.claimIds, emphasisWords: s.emphasisWords })))}

CLAIMS:\n${JSON.stringify(research?.claims.map((c) => ({ id: c.id, text: c.text })) ?? [])}`,
  });
  const ids = new Set(script.scenes.map((s) => s.id));
  const valid = res.rewrites.filter((r) => ids.has(r.sceneId) && r.sceneId !== script.scenes[0].id && r.sceneId !== script.scenes[script.scenes.length - 1].id);
  ctx.info(`Length round ${round}: ${actual.toFixed(0)}s vs target ${target.toFixed(0)}s → rewriting ${valid.length} scene(s): ${valid.map((r) => r.sceneId).join(", ")}`);
  const map = new Map(valid.map((r) => [r.sceneId, r.narration]));
  return {
    script: { ...script, scenes: script.scenes.map((s) => (map.has(s.id) ? { ...s, narration: map.get(s.id)! } : s)) },
    changed: valid.map((r) => r.sceneId),
  };
}

export const voiceStep: StepDef = {
  name: "voice",
  inputs: (ctx) => ({ script: ctx.hash("script.json"), voice: ctx.options.voiceId, model: ctx.settings.ttsModel, lang: ctx.options.language, speed: ctx.settings.voiceSpeed, tight: 1 }),
  async run(ctx) {
    let script = ctx.read<Script>("script.json");
    if (!script) throw new Error("script.json missing");
    ensureDir(ctx.file("voice"));
    const target = ctx.options.minutes * 60;
    const adjustments: VoiceResult["adjustments"] = [];
    let voice: VoiceScene[] = [];

    for (let round = 0; round <= 2; round++) {
      let done = 0;
      const sc = script;
      voice = await mapLimit(sc.scenes, 3, async (_, i) => {
        const v = await synthScene(ctx, sc, i);
        ctx.progress(0.05 + (0.85 * ++done) / sc.scenes.length, `Voicing scene ${done}/${sc.scenes.length}`);
        return v;
      });
      const total = totalSeconds(buildTimeline(sc, { scenes: voice, totalSeconds: 0, targetSeconds: target, adjustments: [] }));
      const off = (total - target) / target;
      ctx.info(`Voiceover total ${total.toFixed(1)}s (target ${target}s, ${off >= 0 ? "+" : ""}${(off * 100).toFixed(1)}%)`);
      if (Math.abs(off) <= 0.1 || round === 2) {
        if (Math.abs(off) > 0.1) ctx.warn("Still more than ±10% off target after 2 adjustment rounds; continuing with the closest version.");
        break;
      }
      if (ctx.options.ownScript.trim()) {
        ctx.info(`Voiceover is ${(off * 100).toFixed(0)}% off the estimated length. Your own script is never trimmed automatically; the video runs as long as your narration.`);
        break;
      }
      if (!usesClaudeApi(ctx.options)) {
        ctx.warn(`Voiceover is ${(off * 100).toFixed(0)}% off the target length. Automatic trimming needs the Claude API, so it was skipped — edit scenes on the Script tab and retry from Voice to adjust.`);
        break;
      }
      ctx.progress(0.9, "Adjusting script length…");
      const adj = await adjustLength(ctx, sc, voice, total, target, round + 1);
      if (!adj.changed.length) break;
      adjustments.push({ round: round + 1, sceneIds: adj.changed, reason: `${(off * 100).toFixed(0)}% off target` });
      script = adj.script;
      ctx.write("script.json", script); // only the changed scenes get re-voiced on the next pass (cache)
    }

    const result: VoiceResult = {
      scenes: voice,
      totalSeconds: totalSeconds(buildTimeline(script, { scenes: voice, totalSeconds: 0, targetSeconds: target, adjustments })),
      targetSeconds: target,
      adjustments,
    };
    ctx.write("voice.json", result);
    // Clean up audio files no longer referenced (old versions of rewritten scenes).
    const keep = new Set(voice.map((v) => v.file.split("/").pop()));
    for (const f of fs.readdirSync(ctx.file("voice"))) if (!keep.has(f)) fs.rmSync(ctx.file("voice", f), { force: true });
    return "done";
  },
};
