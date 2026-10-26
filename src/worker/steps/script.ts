import * as z from "zod";
import { claudeJson, normUrl } from "@/lib/clients/anthropic";
import { targetWords } from "@/lib/cost";
import { ChapterSchema, SceneSchema, ScriptSchema, type ProjectOptions, type Research, type Scene, type Script } from "@/lib/schemas";
import { AnnotationSchema, mergeAnnotations, OWN_SCRIPT_RULES, ownScriptBrief, splitOwnScript, type Annotation } from "@/lib/ownScript";
import { STARTER_PACK } from "@/lib/sfx";
import { readApprovals, type StepCtx, type StepDef } from "../context";

export const SCENE_SECONDS = 8; // average; scenes run 6–10 s

export const SCENE_TYPE_GUIDE = `Scene types (pick what fits the line; vary them; visual change every 2–4 s comes from these):
- KineticCaption: 1–4 words at a time over footage/photo; use for hooks, emotional or punchy lines. Needs emphasisWords.
- BigNumber: one striking figure; data.number (digits only, e.g. "8"), data.numberPrefix ("$"), data.numberSuffix (" billion"), data.label.
- NameReveal: introduce a real person with their photo; data.name, data.role. visual.kind = "person".
- PhotoStack: 2–4 real photos dropping like prints; data.captions (with dates). visual.kind = "event" or "person".
- PaperDocument: cream paper card; data.docType ("statement" = balance draining below zero, "balance-sheet" = rows highlighting red, "filing" = court/regulatory filing with stamp), data.docTitle, data.docRows [{label, value, negative}], data.stampText.
- CodeSnippet: short illustrative code (≤ 8 lines) with data.highlightLine; shown labelled ILLUSTRATION. Only when explaining software/mechanisms.
- FlowDiagram: how money/data/control moved; data.nodes (2–5 short labels in order), data.flowLabel. Each box gets its own photo, so make every label something a photo can show: a named person, company, place or institution, or a concrete thing ("Customers", "FTX", "Alameda Research", "State banks"), never an abstract idea.
- Timeline: data.timelineEvents [{date, label}] (2–5 dated events).
- ChapterTitle: data.chapterNumber, data.chapterTitle (only for videos ≥ 6 minutes, first scene of each chapter).
- SocialPost: ONLY a verbatim real post that appears in the research with its source URL: data.post {author, handle, platform, text, date, sourceUrl}. Never invent posts or engagement numbers.
- Statement: one sentence of white text on black; data.statement. Good for gravity and the line before a reveal.
- EndCard: final scene; data.statement (closing line), data.footnote (current status/corrections, with date).`;

export const VISUAL_GUIDE = `visual.kind:
- "person": a real, named person (subject = full name; context = when/where, e.g. "in 2022", "testifying in court").
- "event": a real event (subject = event name and date).
- "place": a real place or building.
- "stock": generic footage (city at night, trading screens, money counting). searchQueries = 2–3 short stock-footage queries (2–4 words, concrete nouns, English).
- "graphic": pure motion graphics with no photo (CodeSnippet, FlowDiagram, Statement, ChapterTitle, PaperDocument often).
For person/event/place, searchQueries = 2–3 queries a photo archive would match (full names, event names, years).
BigNumber and KineticCaption scenes should usually have "stock" or "person" visuals behind them.`;

export function sfxGuide(level: ProjectOptions["sfxLevel"]) {
  if (level === "off") return "Sound effects are OFF: return an empty sfx array for every scene.";
  const density = { subtle: "only at the 3–6 most important moments of the whole video", normal: "about one cue every 2–3 scenes, at meaningful moments", punchy: "trailer-style: most scenes get a cue, big moments get layered cues" }[level];
  return `Plan sound effects ${density}. Use these library keys when they fit (preferred, free): ${STARTER_PACK.map((s) => s.key).join(", ")}.
If nothing fits, describe a new short sound in a few words (e.g. "cell phone vibrating on table").
at = "word" requires anchorWord, an exact word from that scene's narration where the hit lands. Use "start" for transitions, "end" for stingers.
Mark the single biggest reveal of the video with climax=true on that scene (the mix uses a riser, then a sub drop there).
Scene-type sounds (camera shutter on NameReveal, stamp on filings, ticks on Timeline, etc.) are added automatically — don't duplicate them.`;
}

/** Extra direction for themes whose look depends on the plan (Editorial captions are driven by emphasisWords). */
export function styleGuide(theme: ProjectOptions["theme"]) {
  if (theme !== "editorial") return "";
  return `Visual style: EDITORIAL (modern explainer documentary). Words appear on screen one at a time as they are spoken, and the emphasisWords switch typeface, so choose them carefully:
- Per scene pick 2–4 emphasisWords, spread through the narration (about one per sentence), each an exact word or short phrase from it:
  1. Every important figure, with its unit, exactly as written in the narration (e.g. "eight billion dollars", "thirty-two percent", "twenty twenty-two"). Shown huge in bold.
  2. The name of a person, company or place when it is first mentioned (e.g. "Bankman-Fried", "Alameda"). Shown large in serif.
  3. At most one charged word per scene for a turn of events (e.g. "crashed", "guilty", "never", "stolen", "panicked"). Shown in red with a glitch, so use it sparingly.
  4. One evocative word or short phrase that carries the feeling of the line (e.g. "give it all away", "trusted", "basically a bank"). Shown in italic serif.
- Never pick filler words (the, and, was, very).
- Use KineticCaption over real footage or photos for most of the narration (about half of all scenes), with visual "stock" or "person" so the words sit on a picture.
- Explain mechanisms with clean graphics: FlowDiagram (who moved money to whom), PaperDocument with docType "statement" (a balance draining below zero) or "balance-sheet", Timeline, and BigNumber for one striking figure. These sit on warm paper.
- Put the punchline before the big reveal on a Statement scene (white words on black), and end with an EndCard.`;
}

export function structureGuide(minutes: number) {
  if (minutes <= 1.5)
    return "Structure: hook (first 3 seconds) → setup → mechanism → collapse/turn → ending. One chapter only (id 'ch1').";
  if (minutes <= 6)
    return "Structure: hook (first 3 seconds) → context → setup → mechanism (use 1–2 concrete analogies) → midpoint twist → collapse/turn → consequences → ending. 2–4 chapters (no ChapterTitle scenes).";
  return "Structure: cold-open hook (first 3 seconds) → chapters, each opening with a ChapterTitle scene and its own mini hook → midpoint twist → recap before the ending → ending with current status. 4–8 chapters.";
}

export const WRITING_RULES = `Writing rules:
- The very first sentence is the hook and must land within 3 seconds (≤ 9 words).
- Short spoken sentences (mostly 6–16 words). Write for the ear, not the page.
- Write numbers for speech: "eight billion dollars", "twenty twenty-two", "thirty-two percent".
- Every factual sentence must reference the claim ids (claimIds) from the research that support it. Don't state facts that aren't in the research.
- No invented quotes, tweets, messages or documents. Recreated posts must be verbatim with a source.
- Each scene's narration is 1–3 sentences (~15–25 words ≈ 6–10 seconds).
- emphasisWords: 1–3 words from that scene's narration that deserve visual emphasis.`;

function researchBrief(r: Research) {
  return JSON.stringify({
    summary: r.summary,
    timeline: r.timeline,
    players: r.players,
    places: r.places,
    organizations: r.organizations,
    events: r.events,
    numbers: r.numbers,
    claims: r.claims.map((c) => ({ id: c.id, text: c.text, sources: c.sources.map((s) => s.url) })),
    currentStatus: r.currentStatus,
  });
}

function system(o: ProjectOptions) {
  return `You are an award-winning documentary scriptwriter for faceless YouTube documentaries. Tone: ${o.tone}. Narration language: ${o.language}. Video format: ${o.format} (${o.format === "9:16" ? "vertical Shorts — faster pacing, bigger single ideas per scene" : "horizontal YouTube"}).
You write tight, gripping, strictly factual scripts grounded only in the provided research.`;
}

const OutlineSchema = z.object({
  title: z.string(),
  thumbnailText: z.string(),
  chapters: z.array(ChapterSchema.extend({ beats: z.array(z.string()), targetWords: z.number(), claimIds: z.array(z.string()) })),
});
const ScenesOnlySchema = z.object({ scenes: z.array(SceneSchema) });
const FactCheckSchema = z.object({
  fixes: z.array(
    z.object({
      sceneId: z.string(),
      problem: z.string(),
      fixedNarration: z.string().describe("Rewritten narration supported by the research (same language, similar length)"),
      claimIds: z.array(z.string()),
    }),
  ),
});

/** Make the script safe to render: valid claim ids, scene data present for the chosen type, no unverifiable posts. */
export function sanitizeScript(script: Script, research: Research, o: ProjectOptions, warn: (m: string) => void): Script {
  const claimIds = new Set(research.claims.map((c) => c.id));
  const sourceUrls = new Set([...research.claims.flatMap((c) => c.sources.map((s) => normUrl(s.url))), ...(research.allSources ?? []).map((s) => normUrl(s.url))]);
  const long = o.minutes >= 6;
  const scenes = script.scenes.map((s, i) => {
    const sc: Scene = { ...s, id: `s${i + 1}`, data: { ...s.data }, visual: { ...s.visual }, sfx: o.sfxLevel === "off" ? [] : s.sfx };
    const cited = sc.claimIds.length;
    sc.claimIds = sc.claimIds.filter((id) => claimIds.has(id));
    // It cited facts but none survived verification: keep the line, flag it for the review screen.
    sc.unverified = sc.claimIds.length === 0 && (cited > 0 || s.unverified) ? true : undefined;
    const d = sc.data;
    const downgrade = (why: string, to: Scene["sceneType"] = "KineticCaption") => {
      warn(`Scene ${sc.id}: ${sc.sceneType} → ${to} (${why})`);
      sc.sceneType = to;
    };
    switch (sc.sceneType) {
      case "BigNumber":
        if (!d.number || !/\d/.test(d.number)) downgrade("no number");
        break;
      case "NameReveal":
        if (!d.name) d.name = sc.visual.subject;
        if (sc.visual.kind !== "person") sc.visual.kind = "person";
        break;
      case "SocialPost":
        if (!d.post?.sourceUrl || !sourceUrls.has(normUrl(d.post.sourceUrl))) {
          downgrade("post not verifiable in research", "Statement");
          d.statement = d.statement || sc.narration;
          delete d.post;
        }
        break;
      case "ChapterTitle":
        if (!long) downgrade("chapter titles only for videos ≥ 6 min");
        else d.chapterTitle = d.chapterTitle || script.chapters.find((c) => c.id === sc.chapterId)?.title || "";
        break;
      case "Timeline":
        if (!d.timelineEvents?.length) downgrade("no timeline events");
        break;
      case "FlowDiagram":
        if (!d.nodes || d.nodes.length < 2) downgrade("fewer than 2 nodes");
        break;
      case "CodeSnippet":
        if (!d.code) downgrade("no code");
        break;
      case "PaperDocument":
        d.docType = d.docType ?? "filing";
        break;
      case "Statement":
        d.statement = d.statement || sc.narration;
        break;
    }
    if (!sc.emphasisWords.length) {
      const words = sc.narration
        .split(/\s+/)
        .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
        .filter((w) => w.length > 4);
      sc.emphasisWords = words.slice(-1);
    }
    return sc;
  });
  // Always finish on an EndCard with the current status footnote.
  const last = scenes[scenes.length - 1];
  if (last && last.sceneType !== "EndCard") {
    last.sceneType = "EndCard";
    last.visual.kind = "graphic";
  }
  if (last) {
    last.data.statement = last.data.statement || last.narration.split(/(?<=[.!?])\s/)[0];
    last.data.footnote = last.data.footnote || `As of ${research.currentStatus.asOf}: ${research.currentStatus.text}`.slice(0, 220);
  }
  if (!scenes.some((s) => s.climax) && scenes.length > 4) scenes[Math.floor(scenes.length * 0.7)].climax = true;
  return { ...script, scenes };
}

async function writeScript(ctx: StepCtx, research: Research): Promise<Script> {
  const o = ctx.options;
  const words = targetWords(o.minutes, o.language);
  const sceneCount = Math.max(4, Math.round((o.minutes * 60) / SCENE_SECONDS));
  const call = { projectId: ctx.id, step: "script", model: ctx.model };
  const common = `${structureGuide(o.minutes)}\n\n${WRITING_RULES}\n\n${SCENE_TYPE_GUIDE}\n\n${VISUAL_GUIDE}\n\n${sfxGuide(o.sfxLevel)}\n\n${styleGuide(o.theme)}`;

  if (o.minutes < 6) {
    ctx.progress(0.15, `Writing ~${words} words in ~${sceneCount} scenes…`);
    return claudeJson({
      ctx: call,
      label: "script",
      schema: ScriptSchema,
      system: system(o),
      content: `Write the full documentary script.
Topic: ${o.topic}${o.angle ? `\nCreator's angle / must-include points: ${o.angle}` : ""}
Target length: ${o.minutes} minutes = about ${words} spoken words total, in about ${sceneCount} scenes (range ${Math.round(sceneCount * 0.8)}–${Math.round(sceneCount * 1.25)}).
thumbnailText: max 4 punchy words.

${common}

RESEARCH (the only facts you may use):
${researchBrief(research)}`,
    });
  }

  // Long videos: outline first, then each chapter's scenes, so every chapter gets full attention.
  ctx.progress(0.1, "Outlining chapters…");
  const outline = await claudeJson({
    ctx: call,
    label: "script-outline",
    schema: OutlineSchema,
    system: system(o),
    content: `Outline a ${o.minutes}-minute documentary (~${words} words) on: ${o.topic}${o.angle ? `\nCreator's angle: ${o.angle}` : ""}
${structureGuide(o.minutes)}
Give each chapter an id (ch1, ch2…), a title, a mini hook line, 3–8 beats, targetWords (all chapters sum to ~${words}), and the claim ids it will use. The last chapter includes the recap and ending with current status.
thumbnailText: max 4 punchy words.

RESEARCH:
${researchBrief(research)}`,
  });
  const scenes: Scene[] = [];
  for (const [i, ch] of outline.chapters.entries()) {
    ctx.progress(0.15 + (0.55 * i) / outline.chapters.length, `Writing chapter ${i + 1}/${outline.chapters.length}: ${ch.title}`);
    const prev = scenes.slice(-2).map((s) => s.narration).join(" ");
    const n = Math.max(3, Math.round(ch.targetWords / 20));
    const part = await claudeJson({
      ctx: call,
      label: "script-chapter",
      schema: ScenesOnlySchema,
      system: system(o),
      content: `Full outline:\n${JSON.stringify(outline.chapters.map((c) => ({ id: c.id, title: c.title, beats: c.beats })))}

Now write ONLY chapter ${ch.id} "${ch.title}" (${i + 1} of ${outline.chapters.length}): ~${ch.targetWords} words in ~${n} scenes, all with chapterId "${ch.id}".
${i === 0 ? "This chapter begins the video: the first scene is the cold-open hook (no ChapterTitle before it); put the ChapterTitle scene right after the cold open." : "Start with a ChapterTitle scene (narration = the chapter's mini hook line)."}
Mini hook: ${ch.hook}. Beats: ${ch.beats.join(" | ")}
${prev ? `The previous chapter ended with: "${prev}" — continue seamlessly.` : ""}
Scene ids: ${ch.id}-1, ${ch.id}-2, …

${common}

RESEARCH:
${researchBrief(research)}`,
    });
    scenes.push(...part.scenes.map((s) => ({ ...s, chapterId: ch.id })));
  }
  return { title: outline.title, thumbnailText: outline.thumbnailText, chapters: outline.chapters.map(({ id, title, hook }) => ({ id, title, hook })), scenes };
}

const OwnBatchSchema = z.object({ title: z.string(), thumbnailText: z.string(), scenes: z.array(AnnotationSchema) });

/** Own-script mode: keep the creator's words; Claude plans each scene's visuals, sound and sources. */
async function directOwnScript(ctx: StepCtx, research: Research): Promise<Script> {
  const o = ctx.options;
  const split = splitOwnScript(o.ownScript);
  if (!split.scenes.length) throw new Error("Your script is empty. Paste it on a new project, or edit the scenes on the Script tab.");
  const call = { projectId: ctx.id, step: "script", model: ctx.model };
  const guide = `${OWN_SCRIPT_RULES}\n\n${SCENE_TYPE_GUIDE}\n\n${VISUAL_GUIDE}\n\n${sfxGuide(o.sfxLevel)}\n\n${styleGuide(o.theme)}`;
  const chapters = split.chapters.length > 1 ? `Chapters: ${split.chapters.map((c) => `${c.id} "${c.title}"`).join(", ")}\n` : "";
  const annotations: Annotation[] = [];
  const meta = { title: "", thumbnailText: "" };
  for (let i = 0; i < split.scenes.length; i += 30) {
    const batch = split.scenes.slice(i, i + 30);
    ctx.progress(0.1 + (0.8 * i) / split.scenes.length, `Planning scenes ${i + 1}–${i + batch.length} of ${split.scenes.length}…`);
    const res = await claudeJson({
      ctx: call,
      label: "own-script-scenes",
      schema: OwnBatchSchema,
      system: system(o),
      content: `Plan the visuals and sound for the creator's own documentary script on: ${o.topic}
Also give the video a title and thumbnailText (max 4 punchy words) that fit the script.
${chapters}${i > 0 ? `Previous scene: ${split.scenes[i - 1].narration}\n` : ""}
SCENES (return one entry per id, same ids):
${ownScriptBrief(split, batch)}

${guide}

RESEARCH:
${researchBrief(research)}`,
    });
    if (i === 0) Object.assign(meta, { title: res.title, thumbnailText: res.thumbnailText });
    annotations.push(...res.scenes);
  }
  const script = mergeAnnotations(split, annotations, o, meta);
  const missing = split.scenes.length - new Set(annotations.map((a) => a.id)).size;
  if (missing > 0) ctx.warn(`${missing} scene(s) got no visual plan from Claude and use a default caption over stock footage; adjust them on the Script tab.`);
  return script;
}

/** Second pass: compare every line with the research and rewrite unsupported ones. */
export async function factCheck(ctx: StepCtx, script: Script, research: Research): Promise<Script> {
  const claims = research.claims.map((c) => ({ id: c.id, text: c.text }));
  const fixes: z.infer<typeof FactCheckSchema>["fixes"] = [];
  for (let i = 0; i < script.scenes.length; i += 40) {
    const batch = script.scenes.slice(i, i + 40);
    ctx.progress(0.75 + (0.2 * i) / script.scenes.length, "Fact-checking the script against the research…");
    const res = await claudeJson({
      ctx: { projectId: ctx.id, step: "script", model: ctx.model },
      label: "fact-check",
      schema: FactCheckSchema,
      effort: "high",
      system:
        "You are a strict documentary fact-checker. Compare each scene's narration with the verified claims. Flag any factual statement not supported by the cited (or any) claim, any invented quote/post/document, any wrong number/date/name, and any overstatement. Rhetorical, transitional or clearly framed analogy lines are fine.",
      content: `VERIFIED CLAIMS:\n${JSON.stringify(claims)}\n\nCURRENT STATUS: ${research.currentStatus.text} (as of ${research.currentStatus.asOf})\n\nSCENES:\n${JSON.stringify(
        batch.map((s) => ({ id: s.id, narration: s.narration, claimIds: s.claimIds, post: s.data.post })),
      )}\n\nReturn fixes only for scenes with problems (empty list if none). fixedNarration must be fully supported by the claims, in ${ctx.options.language}, and about the same length.`,
    });
    fixes.push(...res.fixes);
  }
  const byId = new Map(fixes.map((f) => [f.sceneId, f]));
  for (const f of fixes) ctx.info(`Fact-check fixed ${f.sceneId}: ${f.problem}`);
  if (!fixes.length) ctx.info("Fact-check: every line is supported by the research");
  return {
    ...script,
    scenes: script.scenes.map((s) => {
      const f = byId.get(s.id);
      if (!f) return s;
      const emphasis = s.emphasisWords.filter((w) => f.fixedNarration.toLowerCase().includes(w.toLowerCase()));
      return { ...s, narration: f.fixedNarration, claimIds: f.claimIds.length ? f.claimIds : s.claimIds, emphasisWords: emphasis };
    }),
  };
}

function warnUnverified(ctx: StepCtx, script: Script) {
  const ids = script.scenes.filter((s) => s.unverified).map((s) => s.id);
  if (ids.length) ctx.warn(`Check these scenes in review: their facts aren't backed by verified sources: ${ids.join(", ")}`);
}

export const scriptStep: StepDef = {
  name: "script",
  inputs: (ctx) => ({
    research: ctx.hash("research.json"),
    o: [ctx.options.minutes, ctx.options.tone, ctx.options.language, ctx.options.format, ctx.options.sfxLevel, ctx.options.angle, ctx.model],
    ...(ctx.options.ownScript.trim() ? { ownScript: ctx.options.ownScript } : {}), // only when set, so older projects keep their cache
    ...(ctx.options.scriptSource === "app" ? { imported: ctx.hash("import.json") } : {}),
  }),
  async run(ctx) {
    const research = ctx.read<Research>("research.json");
    if (!research) throw new Error("research.json missing — run Research first");
    // A freshly written script needs a fresh approval.
    const approvals = readApprovals(ctx);
    delete approvals.script;
    ctx.write("approvals.json", approvals);

    if (ctx.options.scriptSource === "app") {
      // Written in the Claude app: same safety checks, no API fact-check pass, so flag lines whose sources failed.
      const imp = ctx.read<{ script: Script }>("import.json");
      if (!imp) throw new Error("No pasted script yet — paste the Claude app reply on the project page");
      const script = sanitizeScript(imp.script, research, ctx.options, ctx.warn);
      ScriptSchema.parse(script);
      ctx.write("script.json", script);
      const words = script.scenes.reduce((a, s) => a + s.narration.split(/\s+/).length, 0);
      ctx.info(`Script imported: "${script.title}" — ${script.scenes.length} scenes, ${words} words (target ${targetWords(ctx.options.minutes, ctx.options.language)})`);
      warnUnverified(ctx, script);
      return "done";
    }

    if (ctx.options.ownScript.trim()) {
      const script = sanitizeScript(await directOwnScript(ctx, research), research, ctx.options, ctx.warn);
      ScriptSchema.parse(script);
      ctx.write("script.json", script);
      ctx.info(`Your script: ${script.scenes.length} scenes planned, words unchanged`);
      warnUnverified(ctx, script);
      return "done";
    }

    let script = await writeScript(ctx, research);
    script = sanitizeScript(script, research, ctx.options, ctx.warn);
    script = await factCheck(ctx, script, research);
    script = sanitizeScript(script, research, ctx.options, ctx.warn);
    ScriptSchema.parse(script);
    const words = script.scenes.reduce((a, s) => a + s.narration.split(/\s+/).length, 0);
    const target = targetWords(ctx.options.minutes, ctx.options.language);
    ctx.write("script.json", script);
    ctx.info(`Script: "${script.title}" — ${script.scenes.length} scenes, ${words} words (target ${target})`);
    if (Math.abs(words - target) / target > 0.15) ctx.warn(`Script length is ${Math.round((100 * words) / target)}% of target; the voice step will trim/expand to fit.`);
    return "done";
  },
};

/** Used by the review screen: regenerate one scene, or make it shorter/longer. */
export async function rewriteScene(ctx: StepCtx, sceneId: string, mode: "regenerate" | "shorter" | "longer", note?: string): Promise<Script> {
  if (ctx.options.scriptSource === "app") throw new Error("This project uses the Claude app instead of the API, so scenes can't be rewritten automatically. Edit the text directly.");
  const script = ctx.read<Script>("script.json");
  const research = ctx.read<Research>("research.json");
  if (!script || !research) throw new Error("Script or research missing");
  const idx = script.scenes.findIndex((s) => s.id === sceneId);
  if (idx < 0) throw new Error(`Scene ${sceneId} not found`);
  const scene = script.scenes[idx];
  const instruction = {
    regenerate: "Write a fresh alternative version of this scene (different wording and, if it helps, a different scene type), same role in the story, similar length.",
    shorter: `Make this scene about 35% shorter (currently ${scene.narration.split(/\s+/).length} words), keeping the key fact.`,
    longer: `Make this scene about 40% longer (currently ${scene.narration.split(/\s+/).length} words), adding supported detail.`,
  }[mode];
  const res = await claudeJson({
    ctx: { projectId: ctx.id, step: "review", model: ctx.model },
    label: "scene-rewrite",
    schema: z.object({ scene: SceneSchema }),
    effort: "medium",
    nonce: mode === "regenerate" ? String(Date.now()) : undefined,
    system: system(ctx.options),
    content: `${instruction}${note ? `\nCreator's note: ${note}` : ""}
Keep id "${scene.id}" and chapterId "${scene.chapterId}".
Previous scene: ${script.scenes[idx - 1]?.narration ?? "(start of video)"}
THIS SCENE: ${JSON.stringify(scene)}
Next scene: ${script.scenes[idx + 1]?.narration ?? "(end of video)"}

${WRITING_RULES}\n\n${SCENE_TYPE_GUIDE}\n\n${VISUAL_GUIDE}\n\n${sfxGuide(ctx.options.sfxLevel)}\n\n${styleGuide(ctx.options.theme)}

RESEARCH:\n${researchBrief(research)}`,
  });
  const scenes = [...script.scenes];
  scenes[idx] = { ...res.scene, id: scene.id, chapterId: scene.chapterId };
  const fixed = sanitizeScript({ ...script, scenes }, research, ctx.options, ctx.warn);
  // sanitizeScript renumbers ids sequentially; they already are, so ids are stable.
  return fixed;
}
