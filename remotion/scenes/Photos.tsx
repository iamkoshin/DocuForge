import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { T } from "../../src/lib/timing";
import { useLayout, useTheme } from "../components/layout";
import { gradeFilter, KenBurns } from "../components/Media";
import type { SceneProps } from "./Typography";

export const NameReveal: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();
  const { u, width, height, vertical, safe } = useLayout();
  const snap = Math.round(T.nameRevealSnap * fps);
  const s = spring({ frame: frame - snap, fps, config: { damping: 18, stiffness: 160 } });
  const flash = interpolate(frame, [snap, snap + 4], [0.55, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const name = scene.data.name || scene.emphasisWords.join(" ");
  const photoBox: React.CSSProperties = vertical
    ? { position: "absolute", left: 0, right: 0, top: 0, height: height * 0.62 }
    : { position: "absolute", top: 0, bottom: 0, right: 0, width: width * 0.56 };
  const asset = scene.assets[0];
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <div style={{ ...photoBox, overflow: "hidden" }}>
        {asset && <KenBurns asset={asset} durationInFrames={scene.durationFrames} zoom={[1.08, 1.18]} />}
        {/* Halftone + grid overlay */}
        <AbsoluteFill style={{ backgroundImage: `radial-gradient(rgba(0,0,0,0.55) ${1.4 * u}px, transparent ${1.6 * u}px)`, backgroundSize: `${7 * u}px ${7 * u}px`, mixBlendMode: "multiply", opacity: 0.55 }} />
        <AbsoluteFill style={{ backgroundImage: `linear-gradient(${theme.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.line} 1px, transparent 1px)`, backgroundSize: `${90 * u}px ${90 * u}px`, opacity: 0.25 }} />
        <AbsoluteFill style={{ background: vertical ? `linear-gradient(to top, ${theme.bg} 0%, transparent 35%)` : `linear-gradient(to right, ${theme.bg} 0%, transparent 30%)` }} />
        <AbsoluteFill style={{ backgroundColor: "#fff", opacity: flash }} />
      </div>
      <div
        style={{
          position: "absolute",
          ...(vertical ? { left: safe.left, right: safe.right, top: height * 0.6 } : { left: safe.left, width: width * 0.42, top: 0, bottom: 0 }),
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          opacity: frame >= snap ? 1 : 0,
          transform: `translateX(${(1 - s) * -40 * u}px)`,
        }}
      >
        <div style={{ width: 90 * u * s, height: 6 * u, backgroundColor: theme.accent, marginBottom: 26 * u }} />
        <div style={{ fontFamily: theme.serif, fontStyle: "italic", color: theme.fg, fontSize: Math.min(130, ((vertical ? width : width * 0.42) / Math.max(4, name.length)) * 1.7) * u, lineHeight: 0.98 }}>{name}</div>
        {scene.data.role && (
          <div style={{ fontFamily: theme.mono, color: theme.muted, fontSize: 30 * u, marginTop: 22 * u, letterSpacing: "0.08em", textTransform: "uppercase", opacity: interpolate(frame, [snap + 8, snap + 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
            {scene.data.role}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

export const PhotoStack: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();
  const { u, width, height, vertical } = useLayout();
  const photos = scene.assets.slice(0, 4);
  const dur = scene.durationFrames / fps;
  const times = T.stepTimes(photos.length, dur).map((x) => x - 0.25);
  const captions = scene.data.captions ?? [];
  const printW = (vertical ? 760 : 640) * u;
  // Deterministic scatter like prints thrown on a table.
  const spots = vertical
    ? [{ x: 0.5, y: 0.3, r: -4 }, { x: 0.46, y: 0.58, r: 5 }, { x: 0.55, y: 0.42, r: -2 }, { x: 0.5, y: 0.7, r: 3 }]
    : [{ x: 0.3, y: 0.46, r: -6 }, { x: 0.68, y: 0.44, r: 5 }, { x: 0.5, y: 0.55, r: -2 }, { x: 0.42, y: 0.4, r: 8 }];
  const drift = interpolate(frame, [0, scene.durationFrames], [1, 1.06], { easing: Easing.inOut(Easing.quad) });
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 40%, ${theme.id === "clean-light" ? "#E7E9EE" : "#2a2622"} 0%, ${theme.bg} 75%)` }} />
      <AbsoluteFill style={{ transform: `scale(${drift})` }}>
        {photos.map((p, i) => {
          const start = Math.round(times[i] * fps);
          const drop = spring({ frame: frame - start, fps, config: { damping: 14, stiffness: 120, mass: 0.9 } });
          const spot = spots[i % spots.length];
          const aspect = p.height / p.width;
          const w = printW * (aspect > 1.2 ? 0.7 : 1);
          const h = Math.min(w * aspect, height * 0.55);
          const f = p.focus ?? { x: 0.3, y: 0.25, w: 0.4, h: 0.5 };
          return (
            <div
              key={p.id + i}
              style={{
                position: "absolute",
                left: spot.x * width - w / 2,
                top: spot.y * height - h / 2,
                width: w,
                padding: 14 * u,
                paddingBottom: captions[i] ? 64 * u : 14 * u,
                backgroundColor: "#F4F1EA",
                boxShadow: `0 ${30 * u}px ${60 * u}px rgba(0,0,0,0.55)`,
                transform: `translateY(${(1 - drop) * -height * 0.6}px) rotate(${spot.r + (1 - drop) * 12}deg) scale(${1 + (1 - drop) * 0.2})`,
                opacity: frame >= start ? 1 : 0,
              }}
            >
              <div style={{ width: "100%", height: h, overflow: "hidden", backgroundColor: "#111" }}>
                {p.type === "image" ? (
                  <Img src={p.url} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: `${(f.x + f.w / 2) * 100}% ${(f.y + f.h / 2) * 100}%`, filter: gradeFilter(theme.grade) }} />
                ) : (
                  <KenBurns asset={p} durationInFrames={scene.durationFrames} />
                )}
              </div>
              {captions[i] && <div style={{ position: "absolute", left: 18 * u, right: 18 * u, bottom: 16 * u, fontFamily: theme.mono, color: "#2b2620", fontSize: 24 * u, lineHeight: 1.2 }}>{captions[i]}</div>}
            </div>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
