import * as z from "zod";

// ---------- Enums ----------
export const FORMATS = ["16:9", "9:16"] as const;
export const TONES = ["Investigative", "Dramatic", "Calm explainer", "Upbeat"] as const;
export const THEMES = ["investigative", "clean-light", "retro-archive"] as const;
export const SFX_LEVELS = ["off", "subtle", "normal", "punchy"] as const;
export const SCENE_TYPES = [
  "KineticCaption",
  "BigNumber",
  "NameReveal",
  "PhotoStack",
  "PaperDocument",
  "CodeSnippet",
  "FlowDiagram",
  "Timeline",
  "ChapterTitle",
  "SocialPost",
  "Statement",
  "EndCard",
] as const;
export const VISUAL_KINDS = ["person", "event", "place", "stock", "graphic"] as const;
export const STEPS = ["research", "script", "review", "voice", "music", "sfx", "visuals", "preview", "render", "outputs"] as const;
export type StepName = (typeof STEPS)[number];
export type SceneType = (typeof SCENE_TYPES)[number];

// ---------- Project options (the form) ----------
export const ProjectOptionsSchema = z.object({
  topic: z.string().min(2),
  angle: z.string().default(""),
  minutes: z.number().min(0.5).max(20),
  format: z.enum(FORMATS).default("16:9"),
  voiceId: z.string().min(1),
  voiceName: z.string().default(""),
  language: z.string().default("English"),
  tone: z.enum(TONES).default("Investigative"),
  theme: z.enum(THEMES).default("investigative"),
  musicMood: z.string().default("tense"),
  sfxLevel: z.enum(SFX_LEVELS).default("normal"),
  sourceUrls: z.array(z.string().url()).default([]),
  pauseForApproval: z.boolean().default(true),
  model: z.string().optional(),
  // "api": DocuForge calls the Claude API. "app": you run the research+script prompt in the Claude app
  // (e.g. on a Pro plan) and paste the reply back; no Claude API calls are made for this project.
  scriptSource: z.enum(["api", "app"]).default("api"),
  // The creator's own narration. When set, Claude never writes or rewrites the script: it researches the
  // facts in it and plans scenes, visuals and sound around the creator's exact words.
  ownScript: z.string().default(""),
});
export type ProjectOptions = z.infer<typeof ProjectOptionsSchema>;

// ---------- Research ----------
// Schemas sent to Claude as structured output stay simple (no min/max); stricter checks happen in code.
export const SourceSchema = z.object({
  url: z.string(),
  title: z.string(),
  publisher: z.string(),
});
export type Source = z.infer<typeof SourceSchema>;

export const ClaimSchema = z.object({
  id: z.string().describe("Stable id like c1, c2, ..."),
  text: z.string(),
  sources: z.array(SourceSchema),
});

export const ResearchSchema = z.object({
  topic: z.string(),
  summary: z.string(),
  timeline: z.array(z.object({ date: z.string(), event: z.string(), claimIds: z.array(z.string()) })),
  players: z.array(
    z.object({
      name: z.string().describe("Full name"),
      role: z.string(),
      imageSearchName: z.string().describe("Name as it would appear in a photo caption, e.g. 'Sam Bankman-Fried'"),
    }),
  ),
  places: z.array(z.object({ name: z.string(), description: z.string() })),
  organizations: z.array(z.object({ name: z.string(), description: z.string() })),
  events: z.array(z.object({ name: z.string(), date: z.string(), description: z.string() })),
  numbers: z.array(z.object({ label: z.string(), value: z.string(), context: z.string(), claimIds: z.array(z.string()) })),
  claims: z.array(ClaimSchema),
  currentStatus: z.object({ text: z.string(), asOf: z.string(), sources: z.array(SourceSchema) }),
});
export type Research = z.infer<typeof ResearchSchema> & {
  droppedClaims?: { id: string; text: string; reason: string }[];
  /** Own-script mode: lines of the creator's script the research contradicts or couldn't confirm. */
  scriptIssues?: { quote: string; problem: string }[];
  allSources?: Source[];
};

// ---------- Script ----------
export const SfxCueSchema = z.object({
  cue: z.string().describe("A library key from the provided list, or a short new sound description"),
  anchorWord: z.string().optional().describe("Exact word from the narration the hit should land on (when at = word)"),
  at: z.enum(["start", "end", "word"]),
  intensity: z.enum(["low", "medium", "high"]),
});
export type SfxCue = z.infer<typeof SfxCueSchema>;

export const SceneDataSchema = z.object({
  number: z.string().optional().describe("BigNumber: numeric part to animate, e.g. '8' or '32'"),
  numberPrefix: z.string().optional().describe("BigNumber: e.g. '$'"),
  numberSuffix: z.string().optional().describe("BigNumber: e.g. ' billion' or '%'"),
  label: z.string().optional().describe("Short caption under a number, name, or chart"),
  name: z.string().optional().describe("NameReveal: full name"),
  role: z.string().optional().describe("NameReveal: role/title"),
  captions: z.array(z.string()).optional().describe("PhotoStack: caption per photo"),
  docType: z.enum(["statement", "balance-sheet", "filing"]).optional(),
  docTitle: z.string().optional(),
  docRows: z.array(z.object({ label: z.string(), value: z.string(), negative: z.boolean().optional() })).optional(),
  stampText: z.string().optional().describe("PaperDocument filing stamp, e.g. 'CHAPTER 11'"),
  code: z.string().optional().describe("CodeSnippet: short illustrative code"),
  highlightLine: z.number().optional(),
  nodes: z.array(z.string()).optional().describe("FlowDiagram: 2-5 node labels in flow order"),
  flowLabel: z.string().optional().describe("FlowDiagram: what flows, e.g. 'customer deposits'"),
  timelineEvents: z.array(z.object({ date: z.string(), label: z.string() })).optional(),
  chapterNumber: z.number().optional(),
  chapterTitle: z.string().optional(),
  post: z
    .object({ author: z.string(), handle: z.string(), platform: z.string(), text: z.string(), date: z.string(), sourceUrl: z.string() })
    .optional()
    .describe("SocialPost: verbatim real post with its source URL"),
  statement: z.string().optional(),
  footnote: z.string().optional(),
});
export type SceneData = z.infer<typeof SceneDataSchema>;

export const SceneSchema = z.object({
  id: z.string(),
  chapterId: z.string(),
  narration: z.string(),
  emphasisWords: z.array(z.string()),
  sceneType: z.enum(SCENE_TYPES),
  visual: z.object({
    kind: z.enum(VISUAL_KINDS),
    subject: z.string().describe("Who/what must be shown, e.g. 'Sam Bankman-Fried'"),
    context: z.string().describe("Visual context, e.g. 'at a 2022 conference'"),
    searchQueries: z.array(z.string()).describe("2-3 search queries"),
  }),
  sfx: z.array(SfxCueSchema),
  claimIds: z.array(z.string()),
  data: SceneDataSchema,
  climax: z.boolean().optional(),
  unverified: z.boolean().optional().describe("Set by DocuForge, not by Claude: the scene cited claims that failed verification"),
});
export type Scene = z.infer<typeof SceneSchema>;

export const ChapterSchema = z.object({ id: z.string(), title: z.string(), hook: z.string() });
export const ScriptSchema = z.object({
  title: z.string(),
  thumbnailText: z.string().describe("Max 4 words for the thumbnail"),
  chapters: z.array(ChapterSchema),
  scenes: z.array(SceneSchema),
});
export type Script = z.infer<typeof ScriptSchema>;

// ---------- Voice ----------
export const WordTimingSchema = z.object({ word: z.string(), start: z.number(), end: z.number() });
export type WordTiming = z.infer<typeof WordTimingSchema>;
export interface VoiceScene {
  sceneId: string;
  file: string; // relative to project dir
  duration: number; // seconds, measured
  words: WordTiming[]; // scene-local seconds
  textHash: string;
}
export interface VoiceResult {
  scenes: VoiceScene[];
  totalSeconds: number;
  targetSeconds: number;
  adjustments: { round: number; sceneIds: string[]; reason: string }[];
}

// ---------- Visuals ----------
export interface Candidate {
  id: string;
  type: "image" | "video";
  file: string; // relative to project dir
  thumb?: string;
  width: number;
  height: number;
  durationSec?: number;
  provider: "upload" | "wikimedia" | "article" | "web" | "pixabay";
  sourcePage?: string;
  originalUrl?: string;
  author?: string;
  license?: string;
  caption?: string;
  score?: number; // 0-10 from vision check (or tag match for stock)
  verdict?: string;
  focus?: { x: number; y: number; w: number; h: number }; // normalized bbox of subject
  phash?: string;
}
export interface SceneVisual {
  sceneId: string;
  subjectKey: string;
  candidates: string[]; // candidate ids
  chosen: string[]; // 0-2 candidate ids
  missing?: boolean;
  fallbackType?: SceneType;
}
export interface VisualsResult {
  candidates: Record<string, Candidate>;
  scenes: SceneVisual[];
}

export interface Credit {
  file: string;
  sceneIds: string[];
  provider: string;
  sourcePage?: string;
  originalUrl?: string;
  author?: string;
  license?: string;
}

// ---------- SFX timeline ----------
export interface SfxEvent {
  key: string;
  file: string; // relative to data dir (sfx library) or project dir
  startFrame: number;
  durationFrames: number;
  volume: number; // linear gain relative to voice (1.0)
  duck: boolean; // briefly duck music under this hit
  sceneId: string;
  reason: string;
}

// ---------- Render props (input to the Remotion composition) ----------
export interface RenderAsset {
  id: string;
  url: string;
  type: "image" | "video";
  width: number;
  height: number;
  durationSec?: number;
  focus?: { x: number; y: number; w: number; h: number };
  caption?: string;
}
export interface RenderScene {
  id: string;
  chapterId: string;
  index: number;
  type: SceneType;
  narration: string;
  emphasisWords: string[];
  startFrame: number;
  durationFrames: number;
  audioUrl?: string;
  audioOffsetFrames: number; // when voice begins within the scene
  words: WordTiming[]; // seconds relative to the scene start (already offset)
  assets: RenderAsset[];
  data: SceneData;
  climax?: boolean;
}
export interface RenderSfx {
  url: string;
  startFrame: number;
  durationFrames: number;
  volume: number;
  duck: boolean;
}
export type RenderProps = {
  title: string;
  fps: number;
  width: number;
  height: number;
  format: "16:9" | "9:16";
  theme: (typeof THEMES)[number];
  durationInFrames: number;
  scenes: RenderScene[];
  sfx: RenderSfx[];
  music?: { url: string; durationFrames: number };
  speech: [number, number][]; // frames where voice is active
  dropouts: [number, number][]; // frames where music drops out (silence before big reveal)
  musicBaseDb: number;
  pauseBoostDb: number;
  // Thumbnail-only fields
  thumbnail?: { text: string; imageUrl?: string; focus?: { x: number; y: number; w: number; h: number } };
};
