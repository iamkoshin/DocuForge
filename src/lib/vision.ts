// Image jobs (photo checks, matching uploads) go to Claude or Gemini depending on Settings.photoCheck.
import type * as z from "zod";
import { claudeJson, type CallCtx, type ContentParam } from "./clients/anthropic";
import { geminiJson, GeminiQuotaError, type GeminiPart } from "./clients/gemini";

export type VisionPart = GeminiPart;

/** Returns null when Gemini's free quota is used up, so the caller can fall back to caption matching. */
export async function visionJson<S extends z.ZodType>(opts: {
  provider: "claude" | "gemini";
  ctx: CallCtx;
  label: string;
  schema: S;
  system: string;
  parts: VisionPart[];
  maxTokens: number;
}): Promise<z.infer<S> | null> {
  if (opts.provider === "gemini") {
    try {
      return await geminiJson({ ctx: opts.ctx, label: opts.label, schema: opts.schema, system: opts.system, parts: opts.parts, maxTokens: opts.maxTokens });
    } catch (e) {
      if (e instanceof GeminiQuotaError) return null;
      throw e;
    }
  }
  const content: ContentParam[] = opts.parts.map((p) => ("text" in p ? { type: "text", text: p.text } : { type: "image", source: { type: "base64", media_type: "image/jpeg", data: p.jpeg.toString("base64") } }));
  return claudeJson({ ctx: opts.ctx, label: opts.label, schema: opts.schema, effort: "low", maxTokens: opts.maxTokens, system: opts.system, content });
}
