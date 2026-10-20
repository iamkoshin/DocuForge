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

// Scene/voice spacing (seconds).
export const GAP = {
  firstLead: 0.4, // hold before the very first word
  cutLead: 0.12, // cut this long before the next scene's first word (cuts land on word boundaries)
  between: 0.3,
  chapter: 0.9,
  beforeClimax: 1.1, // the moment of silence before the biggest reveal
  endHold: 2.8,
};

export const toFrames = (sec: number) => Math.round(sec * FPS);
