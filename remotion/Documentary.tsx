import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { Audio } from "@remotion/media";
import type { RenderProps, RenderScene } from "../src/lib/schemas";
import { ThemeContext } from "./components/layout";
import { FilmLook } from "./components/Media";
import { getTheme } from "./themes";
import { BigNumber, FlowDiagram, Timeline } from "./scenes/Data";
import { CodeSnippet, PaperDocument, SocialPost } from "./scenes/Documents";
import { NameReveal, PhotoStack } from "./scenes/Photos";
import { ChapterTitle, EndCard, KineticCaption, Statement } from "./scenes/Typography";

const SCENES: Record<RenderScene["type"], React.FC<{ scene: RenderScene }>> = {
  KineticCaption,
  BigNumber,
  NameReveal,
  PhotoStack,
  PaperDocument,
  CodeSnippet,
  FlowDiagram,
  Timeline,
  ChapterTitle,
  SocialPost,
  Statement,
  EndCard,
};

const db = (x: number) => Math.pow(10, x / 20);

/** Music level per frame: −20 dB under speech, lifted in pauses, ducked under big hits, silent in drop-outs, faded in/out. */
function musicGain(frame: number, p: RenderProps) {
  const ramp = 9; // frames
  // Distance (frames) to the nearest speech region → 0 inside speech.
  let dist = Infinity;
  for (const [a, b] of p.speech) {
    if (frame >= a && frame <= b) {
      dist = 0;
      break;
    }
    dist = Math.min(dist, frame < a ? a - frame : frame - b);
  }
  const pause = Math.min(1, Math.max(0, (dist - 6) / ramp)); // lift only in real pauses
  let level = p.musicBaseDb + p.pauseBoostDb * pause;
  for (const s of p.sfx) {
    if (!s.duck) continue;
    const into = frame - s.startFrame;
    if (into >= -3 && into < 24) level -= 3.5 * (into < 0 ? (into + 3) / 3 : into > 14 ? (24 - into) / 10 : 1);
  }
  let g = db(level);
  for (const [a, b] of p.dropouts) {
    if (frame >= a - ramp && frame <= b + ramp) {
      const k = frame < a ? (a - frame) / ramp : frame > b ? (frame - b) / ramp : 0;
      g *= Math.max(0, Math.min(1, k));
    }
  }
  const fadeIn = Math.min(1, frame / 45);
  const fadeOut = Math.min(1, (p.durationInFrames - frame) / 90);
  return g * Math.max(0, fadeIn) * Math.max(0, fadeOut);
}

const MusicTrack: React.FC<{ p: RenderProps }> = ({ p }) => {
  const frame = useCurrentFrame();
  if (!p.music) return null;
  return <Audio src={p.music.url} volume={musicGain(frame, p)} />;
};

export const Documentary: React.FC<RenderProps> = (p) => {
  const theme = getTheme(p.theme);
  return (
    <ThemeContext.Provider value={theme}>
      <AbsoluteFill style={{ backgroundColor: theme.bg }}>
        {p.scenes.map((s) => {
          const C = SCENES[s.type] ?? KineticCaption;
          return (
            <Sequence key={s.id} from={s.startFrame} durationInFrames={s.durationFrames} name={`${s.id} ${s.type}`}>
              <C scene={s} />
            </Sequence>
          );
        })}
        <FilmLook />
        {/* Layer 1: voice (primary, unity gain) */}
        {p.scenes.map((s) =>
          s.audioUrl ? (
            <Sequence key={`v-${s.id}`} from={s.startFrame + s.audioOffsetFrames} name={`voice ${s.id}`} layout="none">
              <Audio src={s.audioUrl} volume={1} />
            </Sequence>
          ) : null,
        )}
        {/* Layer 2: music */}
        <MusicTrack p={p} />
        {/* Layer 3: sound effects */}
        {p.sfx.map((e, i) => (
          <Sequence key={`sfx-${i}`} from={e.startFrame} durationInFrames={e.durationFrames} name="sfx" layout="none">
            <Audio src={e.url} volume={e.volume} />
          </Sequence>
        ))}
      </AbsoluteFill>
    </ThemeContext.Provider>
  );
};
