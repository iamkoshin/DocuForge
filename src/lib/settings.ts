import { db } from "./db";
import { ConfigError } from "./http";

export const MODEL_OPTIONS = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (default, faster/cheaper)" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (higher quality)" },
] as const;

export interface Settings {
  model: string;
  defaultVoiceId: string;
  defaultVoiceName: string;
  defaultTheme: string;
  defaultSfxLevel: string;
  ttsModel: string;
  voiceSpeed: number; // ElevenLabs speed, 0.7–1.2 (1 = natural)
  musicModel: string;
  renderConcurrency: number;
  // Who checks found photos and matches uploads: "auto" = Claude when the project uses the Claude API,
  // otherwise Gemini if GEMINI_API_KEY is set; "gemini" = always Gemini; "captions" = no AI, match by caption/file name.
  photoCheck: "auto" | "gemini" | "captions";
  geminiModels: string[]; // tried in order; when one hits its free limit the next takes over
  creditUnsplash: boolean; // list Unsplash photographers under "Image credits" in youtube.md (optional under the Unsplash License)
  costThresholdUsd: number;
  // Rough $ conversion rates used for estimates (ElevenLabs bills in credits; adjust to your plan).
  elevenUsdPer1kChars: number;
  elevenUsdPerMusicMinute: number;
  elevenUsdPerSfx: number;
}

export const DEFAULT_SETTINGS: Settings = {
  model: "claude-sonnet-5-5",
  defaultVoiceId: "",
  defaultVoiceName: "",
  defaultTheme: "investigative",
  defaultSfxLevel: "normal",
  ttsModel: "eleven_multilingual_v2",
  voiceSpeed: 1,
  musicModel: "music_v1",
  renderConcurrency: 4,
  photoCheck: "auto",
  geminiModels: ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3-flash-preview", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-latest", "gemini-flash-lite-latest"],
  creditUnsplash: true,
  costThresholdUsd: 10,
  elevenUsdPer1kChars: 0.22,
  elevenUsdPerMusicMinute: 0.5,
  elevenUsdPerSfx: 0.02,
};

export function getSettings(): Settings {
  const rows = db().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    try {
      s[r.key] = JSON.parse(r.value);
    } catch {
      /* ignore corrupt value */
    }
  }
  return s as unknown as Settings;
}

export function updateSettings(patch: Partial<Settings>) {
  const stmt = db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const tx = db().transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (k in DEFAULT_SETTINGS && v !== undefined) stmt.run(k, JSON.stringify(v));
    }
  });
  tx();
  return getSettings();
}

export type KeyName = "ANTHROPIC_API_KEY" | "ELEVENLABS_API_KEY" | "PIXABAY_API_KEY" | "UNSPLASH_ACCESS_KEY" | "GEMINI_API_KEY";
export function getKey(name: KeyName): string {
  const v = process.env[name];
  if (!v) throw new ConfigError(`${name} is not set. Add it to .env and restart (npm run dev).`);
  return v;
}
export function hasKey(name: KeyName) {
  return Boolean(process.env[name]);
}
