import { json, route } from "@/lib/api";
import { listVoices, missingPermission } from "@/lib/clients/elevenlabs";
import { hasKey } from "@/lib/settings";

export const dynamic = "force-dynamic";

let cache: { at: number; voices: Awaited<ReturnType<typeof listVoices>> } | null = null;

export const GET = route(async () => {
  if (!hasKey("ELEVENLABS_API_KEY")) return json({ error: "ELEVENLABS_API_KEY is not set — add it to .env to load voices." }, 400);
  try {
    if (!cache || Date.now() - cache.at > 5 * 60_000) cache = { at: Date.now(), voices: await listVoices() };
  } catch (e) {
    const perm = missingPermission(e);
    if (perm) return json({ error: perm }, 403);
    throw e;
  }
  return json(cache.voices);
});
