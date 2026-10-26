import React from "react";
import { AbsoluteFill, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Audio } from "@remotion/media";
import type { RenderProps, RenderScene } from "../src/lib/schemas";
import { RunningCaption } from "./components/EditorialCaption";
import { ThemeContext, useLayout, useTheme } from "./components/layout";
import { FilmLook } from "./components/Media";
import { getTheme, onPaper, type Theme } from "./themes";
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

// Editorial theme: explainers without footage sit on warm paper, and these scenes get a running caption line.
const PAPER_WHEN_NO_MEDIA = new Set<RenderScene["type"]>(["BigNumber", "Timeline", "PaperDocument"]);
const RUNNING_CAPTION = new Set<RenderScene["type"]>(["BigNumber", "Timeline", "FlowDiagram", "PhotoStack", "PaperDocument", "CodeSnippet", "SocialPost"]);
// PhotoStack and FlowDiagram carry their photos as prints, so they always sit on paper.
const usesPaper = (theme: Theme, s: RenderScene) => theme.style === "editorial" && (s.type === "PhotoStack" || s.type === "FlowDiagram" || (PAPER_WHEN_NO_MEDIA.has(s.type) && !s.assets.length));

/** Music level per frame: −20 dB under speech, lifted in pauses, ducked under big hits, faded in/out. */
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
  const g = db(level);
  const fadeIn = Math.min(1, frame / 45);
  const fadeOut = Math.min(1, (p.durationInFrames - frame) / 90);
  return g * Math.max(0, fadeIn) * Math.max(0, fadeOut);
}

const MusicTrack: React.FC<{ p: RenderProps }> = ({ p }) => {
  const frame = useCurrentFrame();
  if (!p.music) return null;
  return <Audio src={p.music.url} volume={musicGain(frame, p)} />;
};

/** Shorts: the hook line at the top for the first seconds, so a stranger knows why to keep watching. */
const HookBanner: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();
  const { u, width, safe } = useLayout();
  const hold = 3.4 * fps;
  const enter = spring({ frame, fps, config: { damping: 16, stiffness: 160 } });
  const out = interpolate(frame, [hold, hold + 8], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (frame > hold + 8) return null;
  const size = Math.max(54, Math.min(92, (width - safe.left - safe.right) / Math.max(8, text.length * 0.5) / u)) * u;
  return (
    <div style={{ position: "absolute", top: safe.top * 0.55, left: safe.left, right: safe.right, display: "flex", justifyContent: "center", opacity: out }}>
      <div
        style={{
          backgroundColor: theme.accent,
          color: theme.accentInk,
          fontFamily: theme.display,
          fontWeight: 800,
          fontSize: size,
          lineHeight: 1.05,
          textTransform: "uppercase",
          textAlign: "center",
          padding: `${18 * u}px ${30 * u}px`,
          boxShadow: `0 ${14 * u}px ${40 * u}px rgba(0,0,0,0.45)`,
          transform: `translateY(${(1 - enter) * -60 * u}px) scale(${0.9 + 0.1 * enter})`,
        }}
      >
        {text}
      </div>
    </div>
  );
};

export const Documentary: React.FC<RenderProps> = (p) => {
  const theme = getTheme(p.theme);
  return (
    <ThemeContext.Provider value={theme}>
      <AbsoluteFill style={{ backgroundColor: theme.bg }}>
        {p.scenes.map((s) => {
          const C = SCENES[s.type] ?? KineticCaption;
          const paper = usesPaper(theme, s);
          return (
            <Sequence key={s.id} from={s.startFrame} durationInFrames={s.durationFrames} name={`${s.id} ${s.type}`}>
              <ThemeContext.Provider value={paper ? onPaper(theme) : theme}>
                <C scene={s} />
                {theme.style === "editorial" && RUNNING_CAPTION.has(s.type) && <RunningCaption scene={s} onPaper={paper} />}
              </ThemeContext.Provider>
            </Sequence>
          );
        })}
        <FilmLook />
        {p.banner && <HookBanner text={p.banner} />}
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
