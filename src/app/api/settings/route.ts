import { json, route } from "@/lib/api";
import { ffmpegAvailable } from "@/lib/ffmpeg";
import { getSettings, hasKey, MODEL_OPTIONS, updateSettings, type Settings } from "@/lib/settings";

export const dynamic = "force-dynamic";

// Key VALUES never leave the server: only presence is reported.
const keyStatus = () => ({
  ANTHROPIC_API_KEY: hasKey("ANTHROPIC_API_KEY"),
  ELEVENLABS_API_KEY: hasKey("ELEVENLABS_API_KEY"),
  PIXABAY_API_KEY: hasKey("PIXABAY_API_KEY"),
});

export const GET = route(async () => json({ settings: getSettings(), keys: keyStatus(), models: MODEL_OPTIONS, ffmpeg: await ffmpegAvailable() }));

export const PUT = route(async (req: Request) => {
  const patch = (await req.json()) as Partial<Settings>;
  return json({ settings: updateSettings(patch), keys: keyStatus() });
});
