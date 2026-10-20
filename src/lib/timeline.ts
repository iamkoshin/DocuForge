import { GAP } from "./timing";
import type { Script, VoiceResult } from "./schemas";

export interface TimedScene {
  sceneId: string;
  start: number; // scene (visual) start, seconds
  end: number;
  voiceStart: number; // absolute seconds when this scene's narration begins
  voiceEnd: number;
}

/** Lay scenes end-to-end with deliberate gaps; cuts happen just before the next scene's first word. */
export function buildTimeline(script: Script, voice: VoiceResult): TimedScene[] {
  const byId = new Map(voice.scenes.map((v) => [v.sceneId, v]));
  const out: TimedScene[] = [];
  let t = GAP.firstLead;
  script.scenes.forEach((s, i) => {
    const v = byId.get(s.id);
    if (!v) throw new Error(`No voiceover for scene ${s.id}`);
    const voiceStart = t;
    const voiceEnd = t + v.duration;
    const next = script.scenes[i + 1];
    let gap = GAP.between;
    if (next && next.chapterId !== s.chapterId) gap = GAP.chapter;
    if (next?.climax) gap = GAP.beforeClimax;
    t = voiceEnd + gap;
    out.push({ sceneId: s.id, start: i === 0 ? 0 : voiceStart - GAP.cutLead, end: 0, voiceStart, voiceEnd });
  });
  out.forEach((ts, i) => {
    ts.end = i < out.length - 1 ? out[i + 1].start : ts.voiceEnd + GAP.endHold;
  });
  return out;
}

export const totalSeconds = (tl: TimedScene[]) => (tl.length ? tl[tl.length - 1].end : 0);
