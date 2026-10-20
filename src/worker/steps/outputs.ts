import fs from "node:fs";
import * as z from "zod";
import { claudeJson } from "@/lib/clients/anthropic";
import { probeDuration } from "@/lib/ffmpeg";
import { dataRel } from "@/lib/paths";
import { updateProject } from "@/lib/projects";
import type { Credit, RenderProps, Research, Script, VisualsResult } from "@/lib/schemas";
import { usesClaudeApi } from "@/lib/mode";
import type { StepDef } from "../context";
import { renderThumbnail } from "../render";

const ts = (sec: number, srt = false) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  if (srt) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};

/** Caption cues: ≤ 7 words / 42 chars / 3.5 s, breaking at sentence ends. */
export function buildSrt(props: RenderProps) {
  const cues: { start: number; end: number; text: string }[] = [];
  for (const s of props.scenes) {
    let cur: { start: number; end: number; words: string[] } | null = null;
    const flush = () => {
      if (cur) cues.push({ start: cur.start, end: cur.end, text: cur.words.join(" ") });
      cur = null;
    };
    for (const w of s.words) {
      const start = s.startFrame / props.fps + w.start;
      const end = s.startFrame / props.fps + w.end;
      if (cur && (cur.words.length >= 7 || (cur.words.join(" ") + " " + w.word).length > 42 || end - cur.start > 3.5)) flush();
      if (!cur) cur = { start, end, words: [] };
      cur.words.push(w.word);
      cur.end = end;
      if (/[.!?]$/.test(w.word)) flush();
    }
    flush();
  }
  return cues.map((c, i) => `${i + 1}\n${ts(c.start, true)} --> ${ts(Math.max(c.end, c.start + 0.8), true)}\n${c.text}\n`).join("\n");
}

const MetaSchema = z.object({
  titles: z.array(z.string()).describe("Exactly 3 title options, ≤ 70 characters each"),
  description: z.string().describe("2–3 short paragraphs, no links, no hashtags"),
  tags: z.array(z.string()).describe("10–20 tags"),
});

export const outputsStep: StepDef = {
  name: "outputs",
  inputs: (ctx) => ({ video: ctx.hash("video.mp4"), props: ctx.hash("project.json"), credits: ctx.hash("credits.json") }),
  async run(ctx) {
    const props = ctx.read<RenderProps>("project.json");
    const script = ctx.read<Script>("script.json");
    const research = ctx.read<Research>("research.json");
    const visuals = ctx.read<VisualsResult>("visuals.json");
    const credits = ctx.read<Credit[]>("credits.json") ?? [];
    if (!props || !script || !research || !visuals) throw new Error("Missing earlier outputs");

    // captions.srt
    fs.writeFileSync(ctx.file("captions.srt"), buildSrt(props));
    ctx.progress(0.2, "Rendering thumbnail…");

    // thumbnail.png: strongest real photo (prefer people), max 4 words.
    const real = Object.values(visuals.candidates)
      .filter((c) => c.type === "image" && visuals.scenes.some((s) => s.chosen.includes(c.id)))
      .sort((a, b) => (b.provider !== "pixabay" ? 1 : 0) - (a.provider !== "pixabay" ? 1 : 0) || (b.score ?? 0) - (a.score ?? 0));
    const best = real[0];
    const bestScene = props.scenes.find((s) => s.assets.some((a) => a.id === best?.id));
    const words = (script.thumbnailText || script.title).split(/\s+/).slice(0, 4).join(" ");
    await renderThumbnail(
      { ...props, thumbnail: { text: words, imageUrl: best ? bestScene?.assets.find((a) => a.id === best.id)?.url : undefined, focus: best?.focus } },
      ctx.file("thumbnail.png"),
    );

    // youtube.md
    ctx.progress(0.5, "Writing YouTube metadata…");
    // Claude-app mode: titles/description/tags came with the pasted reply.
    const imported = ctx.read<{ youtube?: { titles: string[]; description: string; tags: string[] } }>("import.json")?.youtube;
    const meta = imported?.titles.length
      ? imported
      : !usesClaudeApi(ctx.options)
      ? { titles: [script.title], description: script.scenes.slice(0, 3).map((s) => s.narration).join(" "), tags: [] as string[] }
      : await claudeJson({
      ctx: { projectId: ctx.id, step: "outputs", model: ctx.model },
      label: "youtube-meta",
      schema: MetaSchema,
      effort: "low",
      maxTokens: 8000,
      system: "You write accurate, non-clickbait-but-compelling YouTube metadata for factual documentaries.",
      content: `Language: ${ctx.options.language}. Format: ${ctx.options.format === "9:16" ? "Shorts" : "YouTube video"}.\nTitle: ${script.title}\nScript:\n${script.scenes.map((s) => s.narration).join(" ")}`,
    });
    const fps = props.fps;
    const chapterStarts = script.chapters
      .map((c) => ({ title: c.title, start: (props.scenes.find((s) => s.chapterId === c.id)?.startFrame ?? 0) / fps }))
      .filter((c, i, a) => i === 0 || c.start - a[i - 1].start >= 10);
    if (chapterStarts.length) chapterStarts[0].start = 0;
    const sources = new Map<string, string>();
    for (const c of research.claims) for (const s of c.sources) if (!sources.has(s.url)) sources.set(s.url, `${s.title} — ${s.publisher}`);
    const md = [
      `# ${script.title}`,
      "",
      "## Title options",
      ...meta.titles.slice(0, 3).map((t, i) => `${i + 1}. ${t}`),
      "",
      "## Description",
      "",
      meta.description,
      "",
      ...(chapterStarts.length >= 3 ? ["### Chapters", ...chapterStarts.map((c) => `${ts(c.start)} ${c.title}`), ""] : []),
      "### Sources",
      ...[...sources].map(([u, t]) => `- ${t}: ${u}`),
      "",
      "### Image credits",
      ...(credits.length
        ? credits.map((c) => `- ${[c.author, c.license, c.provider].filter(Boolean).join(" · ")} — ${c.sourcePage ?? c.originalUrl ?? c.file}`)
        : ["- All visuals are original motion graphics."]),
      "",
      `Current status (as of ${research.currentStatus.asOf}): ${research.currentStatus.text}`,
      "",
      "## Tags",
      meta.tags.join(", "),
      "",
    ].join("\n");
    fs.writeFileSync(ctx.file("youtube.md"), md);

    const dur = fs.existsSync(ctx.file("video.mp4")) ? await probeDuration(ctx.file("video.mp4")) : props.durationInFrames / fps;
    updateProject(ctx.id, { title: script.title, duration_sec: dur, thumbnail: dataRel(ctx.file("thumbnail.png")) });
    ctx.info("Outputs ready: video.mp4, captions.srt, thumbnail.png, youtube.md, research.json, script.json, credits.json");
    return "done";
  },
};
