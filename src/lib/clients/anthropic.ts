import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type * as z from "zod";
import { cachedJson } from "../cache";
import { claudeUsd } from "../cost";
import { addCost, log } from "../projects";
import { getKey, getSettings } from "../settings";
import type { Source } from "../schemas";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type ContentParam = Anthropic.Beta.BetaContentBlockParam;

let _client: Anthropic | null = null;
export function claude() {
  if (!_client) _client = new Anthropic({ apiKey: getKey("ANTHROPIC_API_KEY"), maxRetries: 4 });
  return _client;
}

export interface CallCtx {
  projectId?: string | null;
  step?: string;
  model?: string;
}

// Server-side fallback re-runs a policy-declined request on a substitute model inside the same call.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

function recordUsage(ctx: CallCtx, model: string, msg: Anthropic.Beta.BetaMessage, note: string) {
  const u = msg.usage;
  const searches = u.server_tool_use?.web_search_requests ?? 0;
  const usd = claudeUsd(model, {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    searches,
  });
  addCost({
    projectId: ctx.projectId,
    step: ctx.step,
    provider: "anthropic",
    units: u.input_tokens + u.output_tokens + (u.cache_read_input_tokens ?? 0),
    unitType: "tokens",
    usd,
    note: `${note} (${model}; in ${u.input_tokens}, out ${u.output_tokens}${searches ? `, ${searches} searches` : ""})`,
  });
}

function checkStop(msg: Anthropic.Beta.BetaMessage) {
  if (msg.stop_reason === "refusal") {
    throw new Error(`Claude declined this request (${msg.stop_details?.category ?? "policy"}). Try rephrasing the topic or angle.`);
  }
  if (msg.stop_reason === "max_tokens") throw new Error("Claude's response was cut off (max_tokens). Try a shorter video or retry.");
}

function textOf(msg: Anthropic.Beta.BetaMessage) {
  return msg.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * One structured-output call: Claude must answer with JSON matching `schema`.
 * Streams (long outputs never hit HTTP timeouts), validates with zod, caches by input hash,
 * and records cost. A validation failure is retried once with the error shown to Claude.
 */
export async function claudeJson<S extends z.ZodType>(opts: {
  ctx: CallCtx;
  label: string;
  schema: S;
  system: string;
  content: string | ContentParam[];
  effort?: Effort;
  maxTokens?: number;
  nonce?: string; // change to force a fresh (uncached) call, e.g. "regenerate this scene"
}): Promise<z.infer<S>> {
  const model = opts.ctx.model || getSettings().model;
  const format = zodOutputFormat(opts.schema);
  const content: ContentParam[] = typeof opts.content === "string" ? [{ type: "text", text: opts.content }] : opts.content;
  const key = { model, system: opts.system, content, schema: format.schema, effort: opts.effort, nonce: opts.nonce, v: 1 };

  const { value, hit } = await cachedJson(`claude-${opts.label}`, key, async () => {
    let lastErr: unknown;
    let messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content }];
    for (let attempt = 0; attempt < 2; attempt++) {
      const stream = claude().beta.messages.stream({
        model,
        max_tokens: opts.maxTokens ?? 64000,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: opts.effort ?? "high", format: { type: "json_schema", schema: format.schema } },
        system: opts.system,
        messages,
      });
      const msg = await stream.finalMessage();
      recordUsage(opts.ctx, model, msg, opts.label);
      checkStop(msg);
      const text = textOf(msg);
      try {
        return format.parse(text) as z.infer<S>;
      } catch (e) {
        lastErr = e;
        if (opts.ctx.projectId) log(opts.ctx.projectId, "warn", `${opts.label}: response failed validation, asking Claude to fix it`, opts.ctx.step);
        messages = [
          ...messages,
          { role: "assistant", content: [{ type: "text", text }] },
          { role: "user", content: `That JSON failed validation:\n${(e as Error).message}\nReturn the corrected, complete JSON.` },
        ];
      }
    }
    throw lastErr;
  });
  if (hit && opts.ctx.projectId) log(opts.ctx.projectId, "info", `${opts.label}: reused cached Claude response (inputs unchanged)`, opts.ctx.step);
  return value;
}

/**
 * Research call with the web search + web fetch server tools. Returns Claude's notes and every
 * URL the tools actually returned, so later steps can reject sources Claude did not really see.
 */
export async function claudeResearch(opts: {
  ctx: CallCtx;
  system: string;
  prompt: string;
  maxSearches: number;
  nonce?: string;
}): Promise<{ notes: string; seen: Source[] }> {
  const model = opts.ctx.model || getSettings().model;
  const key = { model, system: opts.system, prompt: opts.prompt, maxSearches: opts.maxSearches, nonce: opts.nonce, v: 1 };
  const { value, hit } = await cachedJson("claude-research", key, async () => {
    const tools: Anthropic.Beta.BetaToolUnion[] = [
      { type: "web_search_20260209", name: "web_search", max_uses: opts.maxSearches },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: Math.ceil(opts.maxSearches / 2) },
    ];
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.prompt }];
    const seen = new Map<string, Source>();
    let notes = "";
    for (let turn = 0; turn < 6; turn++) {
      const stream = claude().beta.messages.stream({
        model,
        max_tokens: 64000,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        system: opts.system,
        tools,
        messages,
      });
      const msg = await stream.finalMessage();
      recordUsage(opts.ctx, model, msg, "research (web search)");
      for (const b of msg.content) {
        if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
          for (const r of b.content) {
            if (r.type === "web_search_result") seen.set(normUrl(r.url), { url: r.url, title: r.title, publisher: hostOf(r.url) });
          }
        }
        if (b.type === "web_fetch_tool_result" && b.content.type === "web_fetch_result") {
          seen.set(normUrl(b.content.url), { url: b.content.url, title: b.content.url, publisher: hostOf(b.content.url) });
        }
        if (b.type === "text") {
          notes += b.text;
          for (const c of b.citations ?? []) {
            if (c.type === "web_search_result_location") seen.set(normUrl(c.url), { url: c.url, title: c.title ?? c.url, publisher: hostOf(c.url) });
          }
        }
      }
      if (opts.ctx.projectId) {
        const n = msg.usage.server_tool_use?.web_search_requests ?? 0;
        log(opts.ctx.projectId, "info", `Research turn ${turn + 1}: ${n} searches, ${seen.size} sources seen so far`, opts.ctx.step);
      }
      if (msg.stop_reason === "pause_turn") {
        // Server-side tool loop hit its iteration cap; send the turn back and the server resumes.
        messages.push({ role: "assistant", content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });
        continue;
      }
      checkStop(msg);
      break;
    }
    return { notes, seen: [...seen.values()] };
  });
  if (hit && opts.ctx.projectId) log(opts.ctx.projectId, "info", "Research: reused cached web research (inputs unchanged)", opts.ctx.step);
  return value;
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
export function normUrl(url: string) {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const p of [...u.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/.test(p)) u.searchParams.delete(p);
    return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "") + (u.search || "")).toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/** Cheap connectivity test for the Settings page. */
export async function testAnthropic() {
  const model = getSettings().model;
  const msg = await claude().messages.create({
    model,
    max_tokens: 64,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: "Reply with the single word OK." }],
  });
  const t = msg.content.find((b) => b.type === "text");
  return `${model} replied: ${t && t.type === "text" ? t.text.trim() : "(no text)"}`;
}
