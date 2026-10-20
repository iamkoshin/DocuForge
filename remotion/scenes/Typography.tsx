import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { RenderScene, WordTiming } from "../../src/lib/schemas";
import { T } from "../../src/lib/timing";
import { clean, SafeArea, TextScrim, useLayout, useTheme } from "../components/layout";
import { MediaLayer } from "../components/Media";

export interface SceneProps {
  scene: RenderScene;
}

interface Chunk {
  words: WordTiming[];
  start: number;
  big?: WordTiming;
}

/** Group spoken words into 1–4 word caption chunks; an emphasis word closes its chunk and is shown huge. */
export function chunkWords(words: WordTiming[], emphasis: string[]): Chunk[] {
  const em = new Set(emphasis.flatMap((e) => e.split(/\s+/)).map(clean));
  const chunks: Chunk[] = [];
  let cur: WordTiming[] = [];
  const flush = (big?: WordTiming) => {
    if (cur.length) chunks.push({ words: cur, start: cur[0].start, big });
    cur = [];
  };
  for (const w of words) {
    cur.push(w);
    const isEm = em.has(clean(w.word));
    if (isEm) flush(w);
    else if (cur.length >= 4 || /[.,!?;:—]$/.test(w.word)) flush();
  }
  flush();
  return chunks;
}

const fitSize = (text: string, maxWidth: number, max: number, ratio = 0.6) => Math.min(max, maxWidth / Math.max(1, text.length * ratio));

export const KineticCaption: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();
  const { u, width, safe } = useLayout();
  const t = frame / fps;
  const chunks = chunkWords(scene.words, scene.emphasisWords);
  let idx = chunks.findIndex((c, i) => t >= c.start - 0.05 && (i === chunks.length - 1 || t < chunks[i + 1].start - 0.05));
  if (idx < 0) idx = 0;
  const chunk = chunks[idx];
  const local = chunk ? Math.max(0, frame - (chunk.start - 0.05) * fps) : frame;
  const pop = spring({ frame: local, fps, config: { damping: 14, stiffness: 180, mass: 0.6 } });
  const maxW = width - safe.left - safe.right;
  const hasMedia = scene.assets.length > 0;
  const tr = (s: string) => (theme.uppercaseHeadlines ? s.toUpperCase() : s);

  const lead = chunk ? (chunk.big ? chunk.words.slice(0, -1) : chunk.words) : [];
  const bigText = chunk?.big ? tr(chunk.big.word.replace(/[.,!?;:]+$/, "")) : "";
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <MediaLayer assets={scene.assets} durationInFrames={scene.durationFrames} dim={0.3} seed={scene.index} />
      {hasMedia && <TextScrim from="center" strength={0.7} />}
      <SafeArea>
        {chunk && (
          <div style={{ textAlign: "center", transform: `scale(${0.88 + 0.12 * pop})`, opacity: Math.min(1, pop * 1.4) }}>
            {lead.length > 0 && (
              <div style={{ fontFamily: theme.sans, fontWeight: 700, fontSize: (chunk.big ? 54 : fitSize(lead.map((w) => w.word).join(" "), maxW, 120, 0.55)) * u, color: theme.fg, lineHeight: 1.05, marginBottom: 12 * u, letterSpacing: "-0.01em", textShadow: "0 4px 30px rgba(0,0,0,0.5)" }}>
                {lead.map((w, i) => (
                  <span key={i} style={{ opacity: t >= w.start - 0.05 ? 1 : 0.18 }}>
                    {(chunk.big ? w.word : tr(w.word)) + " "}
                  </span>
                ))}
              </div>
            )}
            {chunk.big && (
              <div
                style={{
                  fontFamily: theme.sans,
                  fontWeight: theme.headlineWeight,
                  fontSize: fitSize(bigText, maxW, 230, 0.66) * u,
                  color: theme.fg,
                  lineHeight: 0.95,
                  letterSpacing: "-0.03em",
                  textShadow: "0 6px 40px rgba(0,0,0,0.55)",
                }}
              >
                <span style={{ boxShadow: `inset 0 -${0.16 * fitSize(bigText, maxW, 230, 0.66) * u}px 0 ${theme.accent}` }}>{bigText}</span>
              </div>
            )}
          </div>
        )}
      </SafeArea>
    </AbsoluteFill>
  );
};

export const Statement: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const theme = useTheme();
  const { u, width, safe } = useLayout();
  const text = scene.data.statement || scene.narration;
  const o = interpolate(frame, [4, 18], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const y = interpolate(frame, [4, 22], [18, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  // One line where possible; wraps gracefully for longer statements.
  const size = Math.max(52, Math.min(110, (width - safe.left - safe.right) / Math.max(10, text.length * 0.52))) * u;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <SafeArea>
        <div style={{ fontFamily: theme.sans, fontWeight: 600, fontSize: size, color: "#F2F2EE", textAlign: "center", lineHeight: 1.2, opacity: o, transform: `translateY(${y}px)`, maxWidth: 1500 * u, letterSpacing: "-0.01em" }}>
          {text}
        </div>
      </SafeArea>
    </AbsoluteFill>
  );
};

export const ChapterTitle: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();
  const { u, width, safe } = useLayout();
  const slam = Math.round(T.chapterSlam * fps);
  const s = spring({ frame: frame - slam, fps, config: { damping: 18, stiffness: 220 } });
  const title = scene.data.chapterTitle || scene.narration;
  const n = String(scene.data.chapterNumber ?? 1).padStart(2, "0");
  const line = interpolate(frame, [slam, slam + 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <MediaLayer assets={scene.assets} durationInFrames={scene.durationFrames} dim={0.72} seed={scene.index} />
      <SafeArea>
        <div style={{ fontFamily: theme.mono, color: theme.accent, fontSize: 30 * u, letterSpacing: "0.3em", opacity: interpolate(frame, [0, 10], [0, 1]) }}>CHAPTER {n}</div>
        <div style={{ height: 3 * u, width: 220 * u * line, backgroundColor: theme.accent, margin: `${22 * u}px 0` }} />
        <div
          style={{
            fontFamily: theme.serif,
            fontStyle: "italic",
            color: theme.fg,
            fontSize: fitSize(title, width - safe.left - safe.right, 150, 0.42) * u,
            textAlign: "center",
            lineHeight: 1.0,
            opacity: frame >= slam ? 1 : 0,
            transform: `scale(${1.25 - 0.25 * s})`,
          }}
        >
          {title}
        </div>
      </SafeArea>
    </AbsoluteFill>
  );
};

export const EndCard: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const theme = useTheme();
  const { u, width, safe } = useLayout();
  const line = scene.data.statement || scene.narration;
  const a = interpolate(frame, [6, 26], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const b = interpolate(frame, [40, 60], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <MediaLayer assets={scene.assets} durationInFrames={scene.durationFrames} dim={0.8} seed={scene.index} />
      <SafeArea>
        <div style={{ fontFamily: theme.serif, fontStyle: "italic", color: theme.fg, fontSize: fitSize(line, (width - safe.left - safe.right) * 1.6, 96, 0.45) * u, textAlign: "center", lineHeight: 1.12, opacity: a, maxWidth: 1400 * u }}>
          {line}
        </div>
        <div style={{ height: 3 * u, width: 120 * u * a, backgroundColor: theme.accent, margin: `${36 * u}px 0` }} />
        {scene.data.footnote && (
          <div style={{ fontFamily: theme.mono, color: theme.muted, fontSize: 24 * u, textAlign: "center", lineHeight: 1.5, opacity: b, maxWidth: 1200 * u }}>
            {scene.data.footnote}
          </div>
        )}
      </SafeArea>
    </AbsoluteFill>
  );
};
