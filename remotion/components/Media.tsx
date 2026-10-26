import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { RenderAsset } from "../../src/lib/schemas";
import { shotPlan } from "../../src/lib/timing";
import { useTheme } from "./layout";

export function gradeFilter(g: { saturate: number; contrast: number; sepia: number; brightness: number }) {
  return `saturate(${g.saturate}) contrast(${g.contrast}) sepia(${g.sepia}) brightness(${g.brightness})`;
}

/** Slow eased zoom aimed at the subject (focus box from Claude vision), object-fit cover with subject-aware crop. */
export const KenBurns: React.FC<{ asset: RenderAsset; durationInFrames: number; variant?: number; zoom?: [number, number] }> = ({ asset, durationInFrames, variant = 0, zoom }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const theme = useTheme();
  const f = asset.focus ?? { x: 0.3, y: 0.25, w: 0.4, h: 0.5 };
  const cx = Math.max(0, Math.min(1, f.x + f.w / 2));
  const cy = Math.max(0, Math.min(1, f.y + f.h / 2));
  const [z0, z1] = zoom ?? (variant % 2 === 0 ? [1.04, 1.16] : [1.16, 1.05]);
  const t = interpolate(frame, [0, durationInFrames], [0, 1], { extrapolateRight: "clamp", easing: Easing.bezier(0.33, 0, 0.67, 1) });
  const scale = z0 + (z1 - z0) * t;
  const drift = (variant % 3) - 1; // -1, 0, 1: subtle lateral drift
  const tx = drift * 1.5 * t;
  const style: React.CSSProperties = {
    position: "absolute",
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: `${cx * 100}% ${cy * 100}%`,
    transform: `scale(${scale}) translateX(${tx}%)`,
    transformOrigin: `${cx * 100}% ${cy * 100}%`,
    filter: gradeFilter(theme.grade),
  };
  if (asset.type === "video") {
    const sceneSec = durationInFrames / fps;
    const rate = asset.durationSec && asset.durationSec < sceneSec ? Math.max(0.5, asset.durationSec / sceneSec) : 1;
    return (
      <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#000" }}>
        <OffthreadVideo src={asset.url} muted playbackRate={rate} style={style} />
      </AbsoluteFill>
    );
  }
  // Small images get a blurred fill behind them instead of being upscaled into mush.
  const tooSmall = asset.width < width * 0.6 && asset.height < height * 0.6;
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#000" }}>
      {tooSmall && <Img src={asset.url} style={{ ...style, filter: `${gradeFilter(theme.grade)} blur(40px)`, transform: "scale(1.2)" }} />}
      <Img src={asset.url} style={tooSmall ? { ...style, objectFit: "contain" } : style} />
    </AbsoluteFill>
  );
};

/** Background media for a scene: alternates between its assets so the picture changes every few seconds. */
export const MediaLayer: React.FC<{ assets: RenderAsset[]; durationInFrames: number; dim?: number; seed?: number }> = ({ assets, durationInFrames, dim = 0, seed = 0 }) => {
  const theme = useTheme();
  if (!assets.length) return null;
  // Same plan the sound planner uses, so each cut gets its sound. Editorial cuts hard every ~1.5 s.
  const fast = theme.style === "editorial";
  const { shots, len } = shotPlan(durationInFrames, assets.length, fast);
  const fade = fast ? 0 : Math.min(8, Math.floor(len / 4));
  return (
    <AbsoluteFill>
      {Array.from({ length: shots }, (_, i) => (
        <Sequence key={i} from={i * len} durationInFrames={i === shots - 1 ? durationInFrames - i * len : len + fade} layout="none">
          <FadeIn frames={i === 0 ? 0 : fade}>
            <KenBurns asset={assets[i % assets.length]} durationInFrames={len + fade} variant={i + seed} />
          </FadeIn>
        </Sequence>
      ))}
      {dim > 0 && <AbsoluteFill style={{ backgroundColor: `rgba(0,0,0,${dim})` }} />}
    </AbsoluteFill>
  );
};

const FadeIn: React.FC<{ frames: number; children: React.ReactNode }> = ({ frames, children }) => {
  const frame = useCurrentFrame();
  const opacity = frames ? interpolate(frame, [0, frames], [0, 1], { extrapolateRight: "clamp" }) : 1;
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

/** Film grain, vignette, optional scratches and tint so mixed sources read as one film. */
export const FilmLook: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const theme = useTheme();
  const seed = frame % 12;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {theme.overlayTint && <AbsoluteFill style={{ backgroundColor: theme.overlayTint, mixBlendMode: "multiply" }} />}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${theme.vignette}) 100%)` }} />
      {theme.grain > 0 && (
        <svg width={width} height={height} style={{ position: "absolute", inset: 0, opacity: theme.grain, mixBlendMode: "overlay" }}>
          <filter id={`grain-${seed}`}>
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={seed} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter={`url(#grain-${seed})`} />
        </svg>
      )}
      {theme.scratches && <Scratches frame={frame} width={width} height={height} />}
    </AbsoluteFill>
  );
};

const Scratches: React.FC<{ frame: number; width: number; height: number }> = ({ frame, width, height }) => {
  const rand = (n: number) => {
    const x = Math.sin(n * 12.9898 + frame * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  const lines = Array.from({ length: 3 }, (_, i) => ({ x: rand(i + 1) * width, o: rand(i + 7) > 0.8 ? 0.22 : 0, w: 0.8 + rand(i + 3) }));
  return (
    <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
      {lines.map((l, i) => (
        <line key={i} x1={l.x} y1={0} x2={l.x + (rand(i + 11) - 0.5) * 20} y2={height} stroke="rgba(255,240,210,1)" strokeOpacity={l.o} strokeWidth={l.w} />
      ))}
      {rand(99) > 0.85 && <circle cx={rand(5) * width} cy={rand(6) * height} r={2 + rand(8) * 4} fill="rgba(255,240,210,0.4)" />}
    </svg>
  );
};
