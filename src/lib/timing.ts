// Shared by the Remotion scene components and the SFX planner, so that every animated
// beat (a number snapping in, a stamp landing, a line drawing) has its sound on the same frame.
// All times are seconds from the start of the scene.

export const FPS = 30;

export const T = {
  bigNumberSnap: 0.35,
  nameRevealSnap: 0.3,
  chapterSlam: 0.55,
  stamp: (dur: number) => Math.min(2.4, dur * 0.55),
  paperIn: 0.1,
  codeStart: 0.35,
  codeCharsPerSec: 38,
  codeTyping: (chars: number, dur: number) => Math.min(dur * 0.65, chars / 38),
  stepTimes: (count: number, dur: number) => {
    // Evenly spaced beats (flow-diagram edges, timeline dates, photo drops) inside the scene.
    const start = 0.45;
    const step = Math.min(1.3, Math.max(0.35, (dur - 1.2) / Math.max(1, count)));
    return Array.from({ length: count }, (_, i) => start + i * step);
  },
};

// Scene/voice spacing (seconds). Voice clips are trimmed of their own silence, so these are the only
// pauses between scenes. Kept short: dead air is where viewers leave.
export const GAP = {
  firstLead: 0.15, // hold before the very first word
  cutLead: 0.12, // cut this long before the next scene's first word (cuts land on word boundaries)
  between: 0.1,
  chapter: 0.45,
  beforeClimax: 0.6, // a short beat before the biggest reveal
  endHold: 2.8,
};

/**
 * How a scene's background footage is cut into shots. Shared by the renderer (MediaLayer) and the
 * sound planner, so every cut can get its sound. Fast pacing (Editorial) cuts about every 1.5 s and
 * cycles the scene's images with different moves; classic pacing changes about every 3 s.
 */
export function shotPlan(durationFrames: number, assetCount: number, fast: boolean) {
  if (!assetCount) return { shots: 0, len: durationFrames };
  const shots = fast
    ? Math.max(1, Math.round(durationFrames / (FPS * 1.5)))
    : assetCount > 1
      ? Math.max(1, Math.min(assetCount * 2, Math.round(durationFrames / (FPS * 3))))
      : 1;
  return { shots, len: Math.ceil(durationFrames / shots) };
}

export const toFrames = (sec: number) => Math.round(sec * FPS);
