// "Claude app" mode: the research + script are produced in the Claude app (e.g. on a Pro plan) from a
// prompt Narrative generates, then pasted back. Nothing here calls the Claude API.
import * as z from "zod";
import { targetWords } from "@/lib/cost";
import { SCENE_TYPES, SceneDataSchema, SfxCueSchema, VISUAL_KINDS, type ProjectOptions, type Research, type Script } from "@/lib/schemas";
import { mergeAnnotations, OWN_SCRIPT_RULES, ownScriptBrief, splitOwnScript } from "@/lib/ownScript";
import { SCENE_SECONDS, SCENE_TYPE_GUIDE, sfxGuide, structureGuide, styleGuide, VISUAL_GUIDE, WRITING_RULES } from "./script";

export interface AppImport {
  research: Research;
  script: Script;
  youtube?: { titles: string[]; description: string; tags: string[] };
  importedAt: number;
}

// ------------------------------------------------------------------ prompt

const TEMPLATE = `{
  "research": {
    "topic": "…",
    "summary": "2–4 sentence overview",
    "timeline": [{ "date": "Nov 2, 2022", "event": "…", "claimIds": ["c1"] }],
    "players": [{ "name": "Full Name", "role": "…", "imageSearchName": "Name as in photo captions" }],
    "places": [{ "name": "…", "description": "…" }],
    "organizations": [{ "name": "…", "description": "…" }],
    "events": [{ "name": "…", "date": "…", "description": "…" }],
    "numbers": [{ "label": "…", "value": "$32 billion", "context": "…", "claimIds": ["c2"] }],
    "claims": [
      { "id": "c1", "text": "One checkable fact.", "sources": [
        { "url": "https://…", "title": "Page title", "publisher": "Outlet" },
        { "url": "https://…", "title": "Page title", "publisher": "Another outlet" } ] }
    ],
    "currentStatus": { "text": "Where the story stands today", "asOf": "Month YYYY", "sources": [{ "url": "https://…", "title": "…", "publisher": "…" }] }
  },
  "script": {
    "title": "Video title",
    "thumbnailText": "Max four words",
    "chapters": [{ "id": "ch1", "title": "…", "hook": "…" }],
    "scenes": [
      {
        "id": "s1",
        "chapterId": "ch1",
        "narration": "Spoken text for this scene, 1–3 short sentences.",
        "emphasisWords": ["word"],
        "sceneType": "KineticCaption",
        "visual": { "kind": "person", "subject": "Full Name", "context": "in 2022", "searchQueries": ["Full Name 2022", "Full Name conference"] },
        "sfx": [{ "cue": "impact_boom", "at": "word", "anchorWord": "word", "intensity": "high" }],
        "claimIds": ["c1"],
        "data": {},
        "climax": false
      }
    ]
  },
  "youtube": { "titles": ["…", "…", "…"], "description": "2–3 short paragraphs, no links", "tags": ["…"] }
}`;

const OWN_TEMPLATE = `{
  "research": { …same shape as below…, "scriptIssues": [{ "quote": "exact line from my script", "problem": "what the sources actually show" }] },
  "script": {
    "title": "Video title",
    "thumbnailText": "Max four words",
    "scenes": [
      {
        "id": "s1",
        "emphasisWords": ["word"],
        "sceneType": "KineticCaption",
        "visual": { "kind": "person", "subject": "Full Name", "context": "in 2022", "searchQueries": ["Full Name 2022", "Full Name conference"] },
        "sfx": [{ "cue": "impact_boom", "at": "word", "anchorWord": "word", "intensity": "high" }],
        "claimIds": ["c1"],
        "data": {},
        "climax": false,
        "unsupported": false
      }
    ]
  },
  "youtube": { "titles": ["…", "…", "…"], "description": "2–3 short paragraphs, no links", "tags": ["…"] }
}`;

/** Own-script mode: research the creator's script and plan its scenes, without touching the words. */
function buildOwnScriptPrompt(o: ProjectOptions) {
  const split = splitOwnScript(o.ownScript);
  return `You are helping me make a factual, faceless documentary video. I have written the narration myself: do NOT write, rewrite, shorten or translate it. Do the research with web search first, then plan the visuals and sound for each of my scenes. Your reply is read by a program, so follow the output format exactly.

TOPIC: ${o.topic}${o.angle ? `\nMY NOTES: ${o.angle}` : ""}${o.sourceUrls.length ? `\nREQUIRED SOURCES (read and use these):\n${o.sourceUrls.map((u) => `- ${u}`).join("\n")}` : ""}
NARRATION LANGUAGE: ${o.language}. TONE: ${o.tone}. FORMAT: ${o.format === "9:16" ? "vertical Shorts" : "horizontal YouTube"}.
Today's date: ${new Date().toISOString().slice(0, 10)}.

MY SCRIPT, already split into scenes (id [chapter]: narration):
${ownScriptBrief(split)}

PART 1 — RESEARCH (search the web thoroughly before writing anything)
- List every factual statement in my script as claims with ids c1, c2, … Each claim needs at least TWO independent sources (different publishers), with the exact URLs of pages you actually opened. Prefer primary sources and major outlets. Never invent or guess a URL.
- In "scriptIssues", quote every line of my script that is wrong, outdated, exaggerated or unverifiable, and say what the sources show.
- Full names and roles for the people in it (so photos can be found); exact figures with units and dates; the CURRENT status of the story with a date.

PART 2 — SCENE PLAN (one entry per scene id above, same ids, no narration field)
${OWN_SCRIPT_RULES}

${SCENE_TYPE_GUIDE}

${VISUAL_GUIDE}

${sfxGuide(o.sfxLevel)}

${styleGuide(o.theme)}

Scene-specific fields go in "data" (leave it {} when the scene type needs none). Allowed sceneType values: ${SCENE_TYPES.join(", ")}. Allowed visual.kind values: ${VISUAL_KINDS.join(", ")}. The final scene is an EndCard whose data has "statement" (closing line) and "footnote" (current status with date).

PART 3 — YOUTUBE
Three title options (≤ 70 characters, compelling but not clickbait), a 2–3 paragraph description without links, and 10–20 tags.

OUTPUT FORMAT — IMPORTANT
Reply with ONE JSON object and nothing else, inside a single \`\`\`json code block, with this shape ("research" is shown in full under "Research shape"):
${OWN_TEMPLATE}

Research shape:
${TEMPLATE.slice(TEMPLATE.indexOf('"research"'), TEMPLATE.indexOf('"script"')).trim().replace(/,$/, "")}

If your reply is going to be cut off, stop at a clean point. When I say "continue", carry on with the JSON exactly where you stopped, with no repetition and no new explanation.`;
}

export function buildAppPrompt(o: ProjectOptions) {
  if (o.ownScript.trim()) return buildOwnScriptPrompt(o);
  const words = targetWords(o.minutes, o.language);
  const scenes = Math.max(4, Math.round((o.minutes * 60) / SCENE_SECONDS));
  return `You are helping me make a factual, faceless documentary video. Do the research with web search first, then write the script. Your reply is read by a program, so follow the output format exactly.

TOPIC: ${o.topic}${o.angle ? `\nANGLE / MUST-INCLUDE POINTS: ${o.angle}` : ""}${o.sourceUrls.length ? `\nREQUIRED SOURCES (read and use these):\n${o.sourceUrls.map((u) => `- ${u}`).join("\n")}` : ""}
LENGTH: ${o.minutes} minutes ≈ ${words} spoken words in about ${scenes} scenes (${Math.round(scenes * 0.8)}–${Math.round(scenes * 1.25)}); each scene 6–10 seconds.
NARRATION LANGUAGE: ${o.language}. TONE: ${o.tone}. FORMAT: ${o.format === "9:16" ? "vertical Shorts (fast pacing, one big idea per scene)" : "horizontal YouTube"}.
Today's date: ${new Date().toISOString().slice(0, 10)}.

PART 1 — RESEARCH (search the web thoroughly before writing anything)
- List factual claims with ids c1, c2, … Each claim needs at least TWO independent sources (different publishers), with the exact URLs of pages you actually opened. Prefer primary sources (court filings, regulators, official statements) and major outlets. Never invent or guess a URL.
- Leave out anything you can't verify. Include the CURRENT status of the story with a date.
- Full names and roles for key people; exact figures with units and dates.

PART 2 — SCRIPT (use only facts from Part 1)
${structureGuide(o.minutes)}

${WRITING_RULES}

${SCENE_TYPE_GUIDE}

${VISUAL_GUIDE}

${sfxGuide(o.sfxLevel)}

${styleGuide(o.theme)}

Scene-specific fields go in "data" (leave it {} when the scene type needs none). Allowed sceneType values: ${SCENE_TYPES.join(", ")}. Allowed visual.kind values: ${VISUAL_KINDS.join(", ")}. The final scene is an EndCard whose data has "statement" (closing line) and "footnote" (current status with date).

PART 3 — YOUTUBE
Three title options (≤ 70 characters, compelling but not clickbait), a 2–3 paragraph description without links, and 10–20 tags.

OUTPUT FORMAT — IMPORTANT
Reply with ONE JSON object and nothing else, inside a single \`\`\`json code block, with exactly this shape:
${TEMPLATE}

If your reply is going to be cut off, stop at a clean point. When I say "continue", carry on with the JSON exactly where you stopped, with no repetition and no new explanation.`;
}

// ------------------------------------------------------------------ parsing

const Src = z.object({ url: z.string(), title: z.string().default(""), publisher: z.string().default("") });
const LenientResearch = z.object({
  topic: z.string().default(""),
  summary: z.string().default(""),
  timeline: z.array(z.object({ date: z.string(), event: z.string(), claimIds: z.array(z.string()).default([]) })).default([]),
  players: z.array(z.object({ name: z.string(), role: z.string().default(""), imageSearchName: z.string().optional() })).default([]),
  places: z.array(z.object({ name: z.string(), description: z.string().default("") })).default([]),
  organizations: z.array(z.object({ name: z.string(), description: z.string().default("") })).default([]),
  events: z.array(z.object({ name: z.string(), date: z.string().default(""), description: z.string().default("") })).default([]),
  numbers: z.array(z.object({ label: z.string(), value: z.string(), context: z.string().default(""), claimIds: z.array(z.string()).default([]) })).default([]),
  claims: z.array(z.object({ id: z.string(), text: z.string(), sources: z.array(Src).default([]) })).min(1, "needs at least one claim"),
  currentStatus: z.object({ text: z.string(), asOf: z.string().default(""), sources: z.array(Src).default([]) }).default({ text: "", asOf: "", sources: [] }),
  scriptIssues: z.array(z.object({ quote: z.string(), problem: z.string() })).optional(),
});
const LenientScene = z.object({
  id: z.string().optional(),
  chapterId: z.string().default("ch1"),
  narration: z.string().min(1, "narration is empty"),
  emphasisWords: z.array(z.string()).default([]),
  sceneType: z.enum(SCENE_TYPES).catch("KineticCaption"),
  visual: z
    .object({
      kind: z.enum(VISUAL_KINDS).catch("stock"),
      subject: z.string().default(""),
      context: z.string().default(""),
      searchQueries: z.array(z.string()).default([]),
    })
    .default({ kind: "graphic", subject: "", context: "", searchQueries: [] }),
  sfx: z.array(SfxCueSchema).catch([]),
  claimIds: z.array(z.string()).default([]),
  data: SceneDataSchema.catch({}),
  climax: z.boolean().optional(),
});
const LenientReply = z.object({
  research: LenientResearch,
  script: z.object({
    title: z.string().min(1),
    thumbnailText: z.string().default(""),
    chapters: z.array(z.object({ id: z.string(), title: z.string().default(""), hook: z.string().default("") })).default([]),
    scenes: z.array(LenientScene).min(2, "needs at least two scenes"),
  }),
  youtube: z.object({ titles: z.array(z.string()).default([]), description: z.string().default(""), tags: z.array(z.string()).default([]) }).optional(),
});
const LenientOwnReply = LenientReply.extend({
  script: z.object({
    title: z.string().default(""),
    thumbnailText: z.string().default(""),
    scenes: z.array(LenientScene.omit({ narration: true, chapterId: true }).extend({ id: z.string(), unsupported: z.boolean().optional() })).min(1, "needs the scene plan"),
  }),
});

export type ParseResult = { ok: true; data: AppImport; summary: string } | { ok: false; errors: string[] };

const issuesOf = (error: z.ZodError) => error.issues.slice(0, 10).map((i) => `${i.path.join(".") || "(top level)"}: ${i.message}`);

/** Own-script mode: the reply carries research plus a plan per scene; the narration comes from the creator's script. */
function parseOwnReply(raw: unknown, o: ProjectOptions): ParseResult {
  const parsed = LenientOwnReply.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: issuesOf(parsed.error) };
  const r = parsed.data;
  const research: Research = {
    ...r.research,
    topic: r.research.topic || o.topic,
    players: r.research.players.map((p) => ({ ...p, imageSearchName: p.imageSearchName || p.name })),
  };
  const split = splitOwnScript(o.ownScript);
  const script = mergeAnnotations(split, r.script.scenes, o, r.script);
  const planned = new Set(r.script.scenes.map((s) => s.id));
  const missing = split.scenes.filter((s) => !planned.has(s.id)).length;
  return {
    ok: true,
    data: { research, script, youtube: r.youtube, importedAt: Date.now() },
    summary: `${research.claims.length} claims, ${script.scenes.length} scenes planned${missing ? ` (${missing} without a plan, set to defaults)` : ""}, ${r.research.scriptIssues?.length ?? 0} script issue(s) flagged`,
  };
}

/** Accepts the reply as pasted: with or without ```json fences, possibly in several "continue" parts. */
export function parseAppReply(text: string, o: ProjectOptions): ParseResult {
  // Replies split by "continue" arrive as several code blocks with chat text in between:
  // keep only what's inside the code blocks (the last one may be unterminated) and join them.
  const blocks = [...text.matchAll(/```(?:json)?[^\S\n]*\n?([\s\S]*?)(?:```|$)/gi)].map((m) => m[1].replace(/\n$/, ""));
  const stripped = blocks.some((b) => b.trim()) ? blocks.join("") : text;
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0) return { ok: false, errors: ["No JSON found. Paste Claude's whole reply, including the part inside the ```json code block."] };
  if (end <= start) return { ok: false, errors: ["The JSON is cut off. In the Claude app say “continue” until it finishes, then paste ALL parts here, one after another."] };
  let raw: unknown;
  try {
    raw = JSON.parse(stripped.slice(start, end + 1));
  } catch (e) {
    const msg = (e as Error).message;
    const cutOff = /end of (json )?(data|input)|unterminated|expected/i.test(msg);
    return {
      ok: false,
      errors: [
        `The JSON couldn't be read: ${msg}`,
        cutOff
          ? "It looks cut off or garbled. If Claude stopped mid-reply, say “continue” in the Claude app and paste ALL parts here, one after another."
          : "Ask Claude: “Your JSON has a syntax error, please resend the complete corrected JSON.”",
      ],
    };
  }
  if (o.ownScript.trim()) return parseOwnReply(raw, o);
  const parsed = LenientReply.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".") || "(top level)"}: ${i.message}`),
    };
  }
  const r = parsed.data;
  const research: Research = {
    ...r.research,
    topic: r.research.topic || o.topic,
    players: r.research.players.map((p) => ({ ...p, imageSearchName: p.imageSearchName || p.name })),
  };
  const chapterIds = [...new Set(r.script.scenes.map((s) => s.chapterId))];
  const chapters = chapterIds.map((id, i) => r.script.chapters.find((c) => c.id === id) ?? { id, title: `Part ${i + 1}`, hook: "" });
  const script: Script = {
    title: r.script.title,
    thumbnailText: r.script.thumbnailText || r.script.title.split(/\s+/).slice(0, 4).join(" "),
    chapters,
    scenes: r.script.scenes.map((s, i) => ({ ...s, id: `s${i + 1}` })),
  };
  const words = script.scenes.reduce((a, s) => a + s.narration.split(/\s+/).length, 0);
  return {
    ok: true,
    data: { research, script, youtube: r.youtube, importedAt: Date.now() },
    summary: `${research.claims.length} claims, ${script.scenes.length} scenes, ${words} words (target ${targetWords(o.minutes, o.language)})`,
  };
}
