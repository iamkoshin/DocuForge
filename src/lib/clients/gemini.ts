// Google Gemini (free tier) for the image jobs: checking found photos and matching uploads to scenes.
import * as z from "zod";
import { cachedJson } from "../cache";
import { fetchOk, HttpError } from "../http";
import { addCost, log } from "../projects";
import { getKey, getSettings } from "../settings";
import type { CallCtx } from "./anthropic";

const API = "https://generativelanguage.googleapis.com/v1beta";

export type GeminiPart = { text: string } | { jpeg: Buffer };

/** Every Gemini model in the list is out of free quota. Callers fall back to caption matching instead of failing the video. */
export class GeminiQuotaError extends Error {}

// Free-tier limits are per model, so when one model is rate-limited or used up for the day, the next one in
// Settings → Gemini models takes over. A blocked model is skipped until its limit resets.
const blockedUntil = new Map<string, number>();
const blockedForLimit = new Set<string>(); // blocked because of a free limit (vs. unavailable or rejecting requests)
const nextSlot = new Map<string, number>();
// Each model allows only a few requests per minute: space calls to the same model out instead of hitting 429s.
const MIN_GAP_MS = 4500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const geminiModels = () => getSettings().geminiModels.filter(Boolean);
export const geminiExhausted = () => geminiModels().every((m) => (blockedUntil.get(m) ?? 0) > Date.now());

function nextPacificMidnight() {
  const now = new Date();
  const pacific = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const offset = now.getTime() - pacific.getTime();
  pacific.setHours(24, 0, 0, 0);
  return pacific.getTime() + offset;
}

interface GenerateResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

async function callModel(model: string, body: unknown) {
  const t = Date.now();
  const slot = Math.max(t, nextSlot.get(model) ?? 0);
  nextSlot.set(model, slot + MIN_GAP_MS);
  if (slot > t) await sleep(slot - t);
  const res = await fetchOk(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": getKey("GEMINI_API_KEY") },
    body: JSON.stringify(body),
    timeoutMs: 120000,
  });
  return (await res.json()) as GenerateResponse;
}

/** Try the models in order, skipping blocked ones. Waits briefly if every model is only minute-limited. */
async function generate(body: unknown, onSwitch?: (from: string, why: string) => void): Promise<{ res: GenerateResponse; model: string }> {
  const models = geminiModels();
  if (!models.length) throw new Error("No Gemini models set. Add some in Settings → Gemini models.");
  let rejected: string | null = null; // a model refused the request itself (not a limit)
  for (let round = 0; round < 4; round++) {
    for (const model of models) {
      if ((blockedUntil.get(model) ?? 0) > Date.now()) continue;
      try {
        return { res: await callModel(model, body), model };
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        const msg = e.body ?? e.message;
        let why: string;
        if (e.status === 429) blockedForLimit.add(model);
        else blockedForLimit.delete(model);
        if (e.status === 429 && /PerDay|per day|daily|limit: 0/i.test(msg)) {
          blockedUntil.set(model, nextPacificMidnight());
          why = "free daily limit used up";
        } else if (e.status === 429) {
          const retry = Number(msg.match(/"retryDelay":\s*"(\d+)/)?.[1] ?? 30);
          blockedUntil.set(model, Date.now() + (retry + 1) * 1000);
          why = "per-minute limit hit";
        } else if (e.status === 404 || e.status === 403) {
          blockedUntil.set(model, Date.now() + 30 * 24 * 3600 * 1000);
          why = "not available to this key";
        } else if (e.status >= 500 || e.status === 408) {
          blockedUntil.set(model, Date.now() + 60 * 1000);
          why = e.status === 408 ? "timed out" : "busy";
        } else {
          blockedUntil.set(model, Date.now() + 3600 * 1000);
          rejected = `Gemini (${model}): ${e.message}`;
          why = "rejected the request";
        }
        onSwitch?.(model, why);
      }
    }
    // Everything is blocked. If a model frees up within ~90 s (a per-minute limit), wait for it; otherwise give up.
    const soonest = Math.min(...models.map((m) => blockedUntil.get(m) ?? 0));
    if (soonest - Date.now() > 90000) break;
    await sleep(Math.max(1000, soonest - Date.now()));
  }
  // A real error only when no model is merely out of quota; otherwise caption matching takes over.
  if (rejected && !models.some((m) => blockedForLimit.has(m))) throw new Error(rejected);
  throw new GeminiQuotaError("Every Gemini model's free limit is used up");
}

const textOf = (r: GenerateResponse) => r.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

/**
 * One JSON-returning vision call. The answer is validated with zod (one retry with the error shown),
 * cached by input hash, and logged as a $0 cost line so usage shows on the project page.
 */
export async function geminiJson<S extends z.ZodType>(opts: { ctx: CallCtx; label: string; schema: S; system: string; parts: GeminiPart[]; maxTokens?: number }): Promise<z.infer<S>> {
  const jsonSchema = z.toJSONSchema(opts.schema);
  const parts = opts.parts.map((p) => ("text" in p ? { text: p.text } : { inline_data: { mime_type: "image/jpeg", data: p.jpeg.toString("base64") } }));
  const key = { system: opts.system, parts, schema: jsonSchema, v: 2 }; // any model's answer is reusable

  const { value, hit } = await cachedJson(`gemini-${opts.label}`, key, async () => {
    const contents: { role: string; parts: unknown[] }[] = [{ role: "user", parts }];
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { res, model } = await generate({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents,
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: jsonSchema, maxOutputTokens: opts.maxTokens ?? 16384, temperature: 0.2 },
      }, (from, why) => opts.ctx.projectId && log(opts.ctx.projectId, "info", `Gemini ${from}: ${why}, trying the next model`, opts.ctx.step));
      const u = res.usageMetadata ?? {};
      addCost({ projectId: opts.ctx.projectId, step: opts.ctx.step, provider: "google", units: (u.promptTokenCount ?? 0) + (u.candidatesTokenCount ?? 0), unitType: "tokens", usd: 0, note: `${opts.label} (${model}, free tier)` });
      if (res.promptFeedback?.blockReason) throw new Error(`Gemini declined this request (${res.promptFeedback.blockReason})`);
      const text = textOf(res);
      if (res.candidates?.[0]?.finishReason === "MAX_TOKENS") throw new Error("Gemini's answer was cut off (too long). Retry the step.");
      try {
        return opts.schema.parse(JSON.parse(text)) as z.infer<S>;
      } catch (e) {
        lastErr = e;
        if (opts.ctx.projectId) log(opts.ctx.projectId, "warn", `${opts.label}: Gemini's answer failed validation, asking it to fix it`, opts.ctx.step);
        contents.push({ role: "model", parts: [{ text }] }, { role: "user", parts: [{ text: `That JSON failed validation:\n${(e as Error).message}\nReturn the corrected, complete JSON.` }] });
      }
    }
    throw lastErr;
  });
  if (hit && opts.ctx.projectId) log(opts.ctx.projectId, "info", `${opts.label}: reused cached Gemini response (inputs unchanged)`, opts.ctx.step);
  return value;
}

export async function testGemini() {
  const skipped: string[] = [];
  const { res, model } = await generate({ contents: [{ role: "user", parts: [{ text: "Reply with the single word OK." }] }], generationConfig: { maxOutputTokens: 1024 } }, (m, why) => skipped.push(`${m} (${why})`));
  return `${model} replied: ${textOf(res).trim().replace(/\.$/, "") || "(no text)"}.${skipped.length ? ` Skipped: ${skipped.join(", ")}.` : ""} ${geminiModels().length} models in the fallback list.`;
}

// Models that can't read photos (speech, image/music generation, agents) are never candidates.
const NOT_VISION = /tts|image|banana|lyria|transcribe|robotics|computer-use|antigravity|deep-research|customtools|embedding|aqa|live|audio/i;

/**
 * Ask each image-capable model one tiny question (uses 1 request of each model's daily allowance) and
 * return the ones that answer, best first: newest Flash, then Flash-Lite, then the rest.
 */
export async function findFreeGeminiModels() {
  const list = await fetchOk(`${API}/models?pageSize=200`, { headers: { "x-goog-api-key": getKey("GEMINI_API_KEY") } });
  const { models } = (await list.json()) as { models: { name: string; supportedGenerationMethods: string[] }[] };
  const names = models
    .filter((m) => m.supportedGenerationMethods.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => n.startsWith("gemini-") && !NOT_VISION.test(n)); // Gemma models don't follow the JSON format reliably
  const ok: string[] = [];
  await Promise.all(
    names.map(async (n) => {
      try {
        await fetchOk(`${API}/models/${encodeURIComponent(n)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": getKey("GEMINI_API_KEY") },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply OK." }] }], generationConfig: { maxOutputTokens: 512 } }),
          timeoutMs: 60000,
        });
        ok.push(n);
        blockedUntil.delete(n);
      } catch {
        /* paid-only, retired or busy */
      }
    }),
  );
  const rank = (n: string) => {
    const version = Number(n.match(/(\d+(?:\.\d+)?)/)?.[1] ?? 0);
    const tier = /latest/.test(n) ? 3 : /pro/.test(n) ? 2 : /lite/.test(n) ? 1 : 0;
    return tier * 100 - version;
  };
  return ok.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
