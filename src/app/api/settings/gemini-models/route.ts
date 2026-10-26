import { json, route } from "@/lib/api";
import { findFreeGeminiModels } from "@/lib/clients/gemini";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Try every Gemini model that can read images and report which ones work on this key's free tier. */
export const POST = route(async () => json({ models: await findFreeGeminiModels() }));
