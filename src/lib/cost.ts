import type { ProjectOptions } from "./schemas";
import type { Settings } from "./settings";

// $ per million tokens (input, output). Web search: $10 per 1,000 searches.
export const CLAUDE_PRICES: Record<string, { in: number; out: number; cacheRead: number }> = {
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.2 },
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2 },
  "claude-fable-5-1": { in: 10, out: 50, cacheRead: 0.25 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheRead: 0.01 },
};
export const WEB_SEARCH_USD = 0.01;

export function claudeUsd(model: string, u: { input: number; output: number; cacheRead?: number; cacheWrite?: number; searches?: number }) {
  const p = CLAUDE_PRICES[model] ?? CLAUDE_PRICES["claude-sonnet-5-5"];
  return (
    (u.input * p.in + (u.cacheWrite ?? 0) * p.in * 1.25 + (u.cacheRead ?? 0) * p.cacheRead + u.output * p.out) / 1e6 +
    (u.searches ?? 0) * WEB_SEARCH_USD
  );
}

export const WORDS_PER_MINUTE: Record<string, number> = {
  english: 150,
  spanish: 160,
  french: 155,
  german: 130,
  italian: 155,
  portuguese: 155,
  dutch: 140,
  polish: 130,
  arabic: 125,
  hindi: 140,
  japanese: 0, // character-based; handled below
  chinese: 0,
  korean: 0,
};
export function targetWords(minutes: number, language: string) {
  const wpm = WORDS_PER_MINUTE[language.trim().toLowerCase()] || 150;
  return Math.round(minutes * wpm);
}
/** Spoken length of a finished script, in minutes. */
export function minutesForWords(words: number, language: string) {
  return words / (WORDS_PER_MINUTE[language.trim().toLowerCase()] || 150);
}

export interface Estimate {
  usd: number;
  minutesToBuild: number;
  lines: { label: string; usd: number; detail: string }[];
}

/** Rough pre-flight estimate. Real costs are recorded per call and shown on the project page. */
export function estimateProject(o: Pick<ProjectOptions, "minutes" | "sfxLevel" | "musicMood" | "model"> & { scriptSource?: ProjectOptions["scriptSource"] }, s: Settings, newSfxGuess = 6): Estimate {
  const api = o.scriptSource !== "app"; // Claude-app mode makes no Claude API calls
  const model = o.model || s.model;
  const words = o.minutes * 150;
  const scenes = Math.max(5, Math.round((o.minutes * 60) / 8));
  const lines: Estimate["lines"] = [];

  // Research: several searches, results feed back in as input tokens.
  if (api) {
    const searches = Math.min(20, 6 + Math.ceil(o.minutes));
    lines.push({
      label: "Research (Claude + web search)",
      usd: claudeUsd(model, { input: 60000 + searches * 6000, output: 12000, searches }),
      detail: `~${searches} searches`,
    });
    // Script + fact-check passes.
    const scriptOut = words * 6 + scenes * 250;
    lines.push({
      label: "Script + fact-check (Claude)",
      usd: claudeUsd(model, { input: 30000 + scriptOut * 2, output: scriptOut * 1.6 + 8000 }),
      detail: `~${Math.round(words)} words, ~${scenes} scenes`,
    });
    // Vision: ~6 candidate images per real-image scene at ~800 tokens each; ~55% of scenes need real images.
    const visionScenes = Math.ceil(scenes * 0.55);
    lines.push({
      label: "Image verification (Claude vision)",
      usd: claudeUsd(model, { input: visionScenes * 6 * 900, output: visionScenes * 500 }),
      detail: `~${visionScenes} subjects`,
    });
  } else {
    lines.push({ label: "Research, script & YouTube text (Claude app)", usd: 0, detail: "done in the Claude app, no API cost" });
  }
  // Voice: characters ≈ words × 6, plus ~15% for regeneration of off-length scenes.
  const chars = words * 6 * 1.15;
  lines.push({ label: "Voiceover (ElevenLabs)", usd: (chars / 1000) * s.elevenUsdPer1kChars, detail: `~${Math.round(chars)} characters` });
  if (o.musicMood && o.musicMood.toLowerCase() !== "none") {
    lines.push({ label: "Music (ElevenLabs)", usd: o.minutes * s.elevenUsdPerMusicMinute, detail: `${o.minutes} min` });
  }
  if (o.sfxLevel !== "off") {
    lines.push({ label: "New sound effects (ElevenLabs)", usd: newSfxGuess * s.elevenUsdPerSfx, detail: `~${newSfxGuess} new sounds (library reused)` });
  }
  if (api) lines.push({ label: "YouTube metadata (Claude)", usd: claudeUsd(model, { input: 8000, output: 2500 }), detail: "" });

  const usd = lines.reduce((a, l) => a + l.usd, 0);
  // Time: research ~2-4 min, script ~1-3 min, TTS ~2s/scene, visuals ~6s/scene, render ~1.5x realtime at 4 workers.
  const minutesToBuild = 4 + o.minutes * 0.6 + (scenes * 8) / 60 + o.minutes * 1.5;
  return { usd: Math.round(usd * 100) / 100, minutesToBuild: Math.round(minutesToBuild), lines };
}
