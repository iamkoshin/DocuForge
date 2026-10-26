import { fetchOk, HttpError, withRetry } from "../http";
import { getKey } from "../settings";

const BASE = "https://api.elevenlabs.io";

// Max characters per TTS request by model (from ElevenLabs model docs).
export const TTS_CHAR_LIMITS: Record<string, number> = {
  eleven_multilingual_v2: 10000,
  eleven_flash_v2_5: 40000,
  eleven_turbo_v2_5: 40000,
  eleven_v3: 5000,
};
export const MUSIC_MAX_MS = 600_000;
export const MUSIC_MIN_MS = 3_000;

function headers(json = true): Record<string, string> {
  const h: Record<string, string> = { "xi-api-key": getKey("ELEVENLABS_API_KEY") };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

export interface Voice {
  voice_id: string;
  name: string;
  preview_url?: string;
  category?: string;
  labels?: Record<string, string>;
}

export async function listVoices(): Promise<Voice[]> {
  const voices: Voice[] = [];
  let token: string | undefined;
  for (let page = 0; page < 10; page++) {
    const u = new URL(`${BASE}/v2/voices`);
    u.searchParams.set("page_size", "100");
    if (token) u.searchParams.set("next_page_token", token);
    const res = await withRetry(() => fetchOk(u.toString(), { headers: headers(false) }), { label: "elevenlabs voices" });
    const j = (await res.json()) as { voices: Voice[]; has_more?: boolean; next_page_token?: string };
    voices.push(...j.voices);
    if (!j.has_more || !j.next_page_token) break;
    token = j.next_page_token;
  }
  return voices.map((v) => ({ voice_id: v.voice_id, name: v.name, preview_url: v.preview_url, category: v.category, labels: v.labels }));
}

export async function getSubscription() {
  const res = await withRetry(() => fetchOk(`${BASE}/v1/user/subscription`, { headers: headers(false) }), { label: "elevenlabs subscription" });
  return (await res.json()) as { tier: string; character_count: number; character_limit: number };
}

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export async function ttsWithTimestamps(p: {
  voiceId: string;
  text: string;
  modelId: string;
  previousText?: string;
  nextText?: string;
  languageCode?: string;
  speed?: number; // 0.7–1.2
}): Promise<{ audio: Buffer; alignment: Alignment }> {
  const limit = TTS_CHAR_LIMITS[p.modelId] ?? 5000;
  if (p.text.length > limit) throw new Error(`Scene text is ${p.text.length} chars; ${p.modelId} allows ${limit} per request`);
  const body: Record<string, unknown> = {
    text: p.text,
    model_id: p.modelId,
    previous_text: p.previousText || undefined,
    next_text: p.nextText || undefined,
    voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true, speed: Math.min(1.2, Math.max(0.7, p.speed ?? 1)) },
  };
  // language_code is not supported by multilingual_v2 (it auto-detects).
  if (p.languageCode && p.modelId !== "eleven_multilingual_v2") body.language_code = p.languageCode;
  const res = await withRetry(
    () =>
      fetchOk(`${BASE}/v1/text-to-speech/${encodeURIComponent(p.voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
        timeoutMs: 120000,
      }),
    { label: "elevenlabs tts" },
  );
  const j = (await res.json()) as { audio_base64: string; alignment: Alignment | null; normalized_alignment: Alignment | null };
  const alignment = j.alignment ?? j.normalized_alignment;
  if (!alignment) throw new Error("ElevenLabs returned no alignment for TTS request");
  return { audio: Buffer.from(j.audio_base64, "base64"), alignment };
}

export class FeatureUnavailableError extends Error {}

export async function composeMusic(p: { prompt: string; lengthMs: number; modelId: string }): Promise<Buffer> {
  const lengthMs = Math.max(MUSIC_MIN_MS, Math.min(MUSIC_MAX_MS, Math.round(p.lengthMs)));
  try {
    const res = await withRetry(
      () =>
        fetchOk(`${BASE}/v1/music?output_format=mp3_44100_128`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ prompt: p.prompt, music_length_ms: lengthMs, model_id: p.modelId, force_instrumental: true }),
          timeoutMs: 600000,
        }),
      { label: "elevenlabs music", retries: 2 },
    );
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    if (e instanceof HttpError && [401, 402, 403].includes(e.status)) {
      throw new FeatureUnavailableError(`Music API not available on this ElevenLabs plan/key (${e.status}): ${e.body?.slice(0, 200) ?? ""}`);
    }
    throw e;
  }
}

export async function soundEffect(p: { text: string; durationSeconds?: number; promptInfluence?: number }): Promise<Buffer> {
  const body: Record<string, unknown> = { text: p.text, model_id: "eleven_text_to_sound_v2", prompt_influence: p.promptInfluence ?? 0.45 };
  if (p.durationSeconds) body.duration_seconds = Math.max(0.5, Math.min(30, p.durationSeconds));
  const res = await withRetry(
    () =>
      fetchOk(`${BASE}/v1/sound-generation?output_format=mp3_44100_128`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
        timeoutMs: 120000,
      }),
    { label: "elevenlabs sfx" },
  );
  return Buffer.from(await res.arrayBuffer());
}

const PERMISSION_NAMES: Record<string, string> = {
  voices_read: "Voices: Read",
  user_read: "User: Read",
  text_to_speech: "Text to Speech",
  sound_generation: "Sound Effects",
  music_generation: "Music",
};

/** Turn ElevenLabs' "missing the permission X" 401 into a plain-language message (or null if it's something else). */
export function missingPermission(e: unknown): string | null {
  if (!(e instanceof HttpError) || e.status !== 401) return null;
  const code = e.body?.match(/missing the permission (\w+)/)?.[1];
  if (!code) return null;
  return `Your ElevenLabs API key is missing the “${PERMISSION_NAMES[code] ?? code}” permission (${code}). Enable it at elevenlabs.io → Developers → API keys, then restart npm run dev.`;
}
