// Own-script mode: the creator writes the narration. It is split into scenes here, in code, so the words
// are never changed; Claude only annotates each scene (scene type, visuals, sound, sources).
import * as z from "zod";
import { minutesForWords } from "./cost";
import { SceneSchema, type ProjectOptions, type Scene, type Script } from "./schemas";

export interface OwnSplit {
  chapters: { id: string; title: string; hook: string }[];
  scenes: { id: string; chapterId: string; narration: string }[];
}

const HEADING = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/;
const MIN_WORDS = 12;
const MAX_WORDS = 28;

const countWords = (t: string) => t.split(/\s+/).filter(Boolean).length;

export function ownScriptWords(text: string) {
  return countWords(text.split("\n").filter((l) => !HEADING.test(l)).join(" "));
}

/** Length of the video the script makes, rounded to the 0.5-minute steps the form uses. */
export function ownScriptMinutes(text: string, language: string) {
  return Math.min(20, Math.max(0.5, Math.round(minutesForWords(ownScriptWords(text), language) * 2) / 2));
}

/**
 * Lines starting with # start a chapter (the heading itself is not spoken). Blank lines separate paragraphs;
 * a scene never crosses a paragraph. Within a paragraph, whole sentences are grouped into ~12–28 word scenes.
 */
export function splitOwnScript(text: string): OwnSplit {
  const chapters: OwnSplit["chapters"] = [];
  const paragraphs: { chapterId: string; text: string }[] = [];
  let chapterId = "ch1";
  let n = 0;
  let buf: string[] = [];
  const flush = () => {
    const t = buf.join(" ").replace(/\s+/g, " ").trim();
    if (t) paragraphs.push({ chapterId, text: t });
    buf = [];
  };
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const h = line.match(HEADING);
    if (h) {
      flush();
      if (n === 0 && paragraphs.length) n = 1; // text before the first heading is a cold open in ch1
      chapterId = `ch${++n}`;
      chapters.push({ id: chapterId, title: h[1], hook: "" });
    } else if (!line.trim()) flush();
    else buf.push(line.trim());
  }
  flush();
  if (!chapters.some((c) => c.id === "ch1")) chapters.unshift({ id: "ch1", title: chapters.length ? "Cold open" : "Part 1", hook: "" });

  const scenes: OwnSplit["scenes"] = [];
  for (const p of paragraphs) {
    const sentences = p.text.split(/(?<=[.!?…。！？]["”’)\]]?)\s+/).filter(Boolean);
    let cur: string[] = [];
    let n = 0;
    for (const s of sentences) {
      const w = countWords(s);
      if (cur.length && (n >= MIN_WORDS || n + w > MAX_WORDS)) {
        scenes.push({ id: `s${scenes.length + 1}`, chapterId: p.chapterId, narration: cur.join(" ") });
        cur = [];
        n = 0;
      }
      cur.push(s);
      n += w;
    }
    if (cur.length) scenes.push({ id: `s${scenes.length + 1}`, chapterId: p.chapterId, narration: cur.join(" ") });
  }
  const used = new Set(scenes.map((s) => s.chapterId));
  for (const c of chapters) c.hook = scenes.find((s) => s.chapterId === c.id)?.narration ?? "";
  return { chapters: chapters.filter((c) => used.has(c.id)), scenes };
}

/** What Claude returns per scene: everything except the narration, which stays the creator's. */
export const AnnotationSchema = SceneSchema.omit({ narration: true, chapterId: true, unverified: true }).extend({
  unsupported: z.boolean().describe("true when this line states a fact that none of the research claims supports, or that the research contradicts"),
});
export type Annotation = z.infer<typeof AnnotationSchema>;

/** The creator's scenes as Claude sees them: `s4 [ch2, starts chapter "The fall"]: narration`. */
export function ownScriptBrief(split: OwnSplit, scenes = split.scenes) {
  return scenes
    .map((s) => {
      const first = split.scenes.find((x) => x.chapterId === s.chapterId) === s;
      const title = split.chapters.find((c) => c.id === s.chapterId)?.title;
      return `${s.id} [${s.chapterId}${first && split.chapters.length > 1 ? `, starts chapter "${title}"` : ""}]: ${s.narration}`;
    })
    .join("\n");
}

export const OWN_SCRIPT_RULES = `The narration is written by the creator and is FINAL. Never change, shorten, translate or add to it.
For each scene id, plan the visuals and sound around its exact words:
- sceneType, data, visual and sfx as described below; emphasisWords must be words that appear in that scene's narration.
- claimIds: the research claims that support the facts stated in that scene ([] for rhetorical lines).
- unsupported: true only if the scene states a fact that no claim supports or that the research contradicts.
- Use ChapterTitle only on a scene that starts a chapter, with data.chapterTitle set to that chapter's title.`;

/** Put Claude's annotations onto the creator's scenes. Missing annotations get a safe default. */
export function mergeAnnotations(split: OwnSplit, annotations: Partial<Annotation>[], o: Pick<ProjectOptions, "topic">, meta: { title: string; thumbnailText: string }): Script {
  const byId = new Map(annotations.filter((a) => a.id).map((a) => [a.id!, a]));
  const scenes: Scene[] = split.scenes.map((s) => {
    const a = byId.get(s.id);
    return {
      id: s.id,
      chapterId: s.chapterId,
      narration: s.narration,
      emphasisWords: (a?.emphasisWords ?? []).filter((w) => s.narration.toLowerCase().includes(w.toLowerCase())),
      sceneType: a?.sceneType ?? "KineticCaption",
      visual: a?.visual ?? { kind: "stock", subject: o.topic, context: "", searchQueries: [o.topic] },
      sfx: a?.sfx ?? [],
      claimIds: a?.claimIds ?? [],
      data: a?.data ?? {},
      climax: a?.climax,
      unverified: a?.unsupported ? true : undefined,
    };
  });
  return {
    title: meta.title || o.topic,
    thumbnailText: meta.thumbnailText || (meta.title || o.topic).split(/\s+/).slice(0, 4).join(" "),
    chapters: split.chapters,
    scenes,
  };
}
