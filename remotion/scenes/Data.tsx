import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { T } from "../../src/lib/timing";
import { SafeArea, TextScrim, useLayout, useTheme } from "../components/layout";
import { isLight } from "../themes";
import { gradeFilter, MediaLayer } from "../components/Media";
import type { SceneProps } from "./Typography";

function formatLike(template: string, value: number) {
  const decimals = (template.split(".")[1] ?? "").replace(/\D/g, "").length;
  const s = value.toFixed(decimals);
  return template.includes(",") || Math.abs(value) >= 10000 ? Number(s).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : s;
}

export const BigNumber: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();
  const { u, width, safe } = useLayout();
  const d = scene.data;
  const raw = d.number ?? "0";
  const target = parseFloat(raw.replace(/,/g, "")) || 0;
  const snap = Math.round(T.bigNumberSnap * fps);
  // Snaps in on the impact, then counts up the last stretch so the figure feels alive.
  const pop = spring({ frame: frame - snap, fps, config: { damping: 12, stiffness: 200, mass: 0.7 } });
  const count = interpolate(frame, [snap, snap + 18], [0.62, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const shown = Number.isInteger(target) && target < 10 ? raw : formatLike(raw, target * count);
    const maxW = width - safe.left - safe.right;
  // Prefix/suffix render smaller, so weight them accordingly when fitting the line.
  const effLen = shown.length + (d.numberPrefix ?? "").length * 0.55 + (d.numberSuffix ?? "").trim().length * 0.34;
  const numSize = Math.min(320, (maxW / u) / Math.max(2, effLen * 0.6)) * u;
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <MediaLayer assets={scene.assets} durationInFrames={scene.durationFrames} dim={theme.style === "editorial" ? 0.25 : 0.45} seed={scene.index} />
      {scene.assets.length > 0 && <TextScrim from="center" strength={theme.style === "editorial" ? 0.35 : 0.6} />}
      <SafeArea>
        <div style={{ opacity: frame >= snap ? 1 : 0, transform: `scale(${1.35 - 0.35 * pop})`, textAlign: "center" }}>
          <div style={{ fontFamily: theme.display, fontWeight: theme.headlineWeight, color: theme.fg, fontSize: numSize, lineHeight: 0.9, letterSpacing: "-0.04em", fontVariantNumeric: "tabular-nums", textShadow: isLight(theme.bg) ? "none" : "0 8px 50px rgba(0,0,0,0.6)" }}>
            {d.numberPrefix && <span style={{ fontSize: numSize * 0.55, verticalAlign: "0.55em" }}>{d.numberPrefix}</span>}
            {shown}
            {d.numberSuffix && <span style={{ fontSize: numSize * 0.34, marginLeft: numSize * 0.08, letterSpacing: "-0.01em", fontWeight: 800 }}>{d.numberSuffix.trim()}</span>}
          </div>
        </div>
        {d.label && (
          <div
            style={{
              marginTop: 24 * u,
              fontFamily: theme.serif,
              fontStyle: "italic",
              color: theme.fg,
              fontSize: 56 * u,
              textAlign: "center",
              opacity: interpolate(frame, [snap + 10, snap + 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            }}
          >
            {d.label}
          </div>
        )}
      </SafeArea>
    </AbsoluteFill>
  );
};

export const Timeline: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();
  const { u, width, height, vertical } = useLayout();
  const events = scene.data.timelineEvents ?? [];
  const dur = scene.durationFrames / fps;
  const times = T.stepTimes(events.length, dur);
  const t = frame / fps;
  const spacing = (vertical ? 360 : 520) * u;
  // Slide so the latest revealed event sits at the centre.
  let active = 0;
  times.forEach((x, i) => (t >= x ? (active = i) : null));
  const prev = times[Math.max(0, active)] ?? 0;
  const slide = interpolate(t, [prev, prev + 0.5], [Math.max(0, active - 1), active], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const centre = vertical ? height / 2 : width / 2;
  const offset = centre - slide * spacing;
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <MediaLayer assets={scene.assets} durationInFrames={scene.durationFrames} dim={0.8} seed={scene.index} />
      <div style={vertical ? { position: "absolute", left: width * 0.22, top: 0, bottom: 0, width: 3 * u, backgroundColor: theme.line } : { position: "absolute", top: height * 0.55, left: 0, right: 0, height: 3 * u, backgroundColor: theme.line }} />
      {events.map((e, i) => {
        const appear = spring({ frame: frame - Math.round(times[i] * fps), fps, config: { damping: 16 } });
        const pos = offset + i * spacing;
        const isActive = i === active && t >= times[i];
        const edge = Math.abs(pos - centre) / (vertical ? height / 2 : width / 2);
        const edgeFade = interpolate(edge, [0.55, 0.8], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const dot = (
          <div style={{ width: 22 * u, height: 22 * u, borderRadius: "50%", backgroundColor: isActive ? theme.accent : theme.fg, opacity: edgeFade, transform: `scale(${appear})`, boxShadow: isActive ? `0 0 0 ${8 * u}px ${theme.accent}33` : "none" }} />
        );
        const label = (
          <div style={{ opacity: appear * edgeFade, transform: `translateY(${(1 - appear) * 20}px)` }}>
            <div style={{ fontFamily: theme.mono, color: isActive ? theme.accent : theme.muted, fontSize: 34 * u, fontWeight: 700, letterSpacing: "0.05em" }}>{e.date}</div>
            <div style={{ fontFamily: theme.sans, color: theme.fg, fontSize: 40 * u, fontWeight: 600, lineHeight: 1.15, maxWidth: (vertical ? 640 : 440) * u, marginTop: 8 * u }}>{e.label}</div>
          </div>
        );
        return vertical ? (
          <div key={i} style={{ position: "absolute", top: pos - 11 * u, left: width * 0.22 - 10 * u, display: "flex", gap: 36 * u, alignItems: "flex-start" }}>
            {dot}
            {label}
          </div>
        ) : (
          <div key={i} style={{ position: "absolute", left: pos - 11 * u, top: height * 0.55 - 10 * u, display: "flex", flexDirection: "column", gap: 28 * u }}>
            {dot}
            {label}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

export const FlowDiagram: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();
  const { u, width, height, vertical, safe } = useLayout();
  const nodes = scene.data.nodes ?? [];
  const n = nodes.length;
  const dur = scene.durationFrames / fps;
  const times = T.stepTimes(Math.max(1, n - 1), dur);
  const box = (vertical ? 400 : theme.style === "editorial" ? 340 : 260) * u; // Editorial: bigger prints, like the reference
  // Vertical: boxes zigzag left/right down the frame, so they can be big without overlapping.
  const pos = nodes.map((_, i) => {
    const f = n === 1 ? 0.5 : i / (n - 1);
    return vertical
      ? { x: n === 1 ? width / 2 : width * (i % 2 ? 0.68 : 0.32), y: safe.top + box / 2 + f * (height - safe.top - safe.bottom - box) }
      : { x: safe.left + box / 2 + f * (width - safe.left - safe.right - box), y: height / 2 + 30 * u };
  });
  const trim = vertical ? box * 0.32 : box / 2; // arrows start and stop at the box edge
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <AbsoluteFill style={{ backgroundImage: `linear-gradient(${theme.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.line} 1px, transparent 1px)`, backgroundSize: `${80 * u}px ${80 * u}px`, opacity: 0.15 }} />
      {scene.data.flowLabel && (
        <div style={{ position: "absolute", top: safe.top * (vertical ? 0.6 : 1.2), left: safe.left, right: safe.right, textAlign: "center", fontFamily: theme.mono, color: theme.accent, fontSize: 30 * u, letterSpacing: "0.2em", textTransform: "uppercase" }}>
          {scene.data.flowLabel}
        </div>
      )}
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {pos.slice(1).map((p, i) => {
          const a = pos[i];
          const start = Math.round(times[i] * fps);
          const prog = interpolate(frame, [start, start + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
          const d = Math.hypot(p.x - a.x, p.y - a.y) || 1;
          const [ux, uy] = [(p.x - a.x) / d, (p.y - a.y) / d];
          const [x1, y1, x2, y2] = [a.x + ux * trim, a.y + uy * trim, p.x - ux * trim, p.y - uy * trim];
          const len = Math.hypot(x2 - x1, y2 - y1);
          // Moving pulse = the money/data flowing.
          const pulse = ((frame - start) % 30) / 30;
          return (
            <g key={i}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={theme.accent} strokeWidth={5 * u} strokeDasharray={len} strokeDashoffset={len * (1 - prog)} />
              {prog >= 1 && <circle cx={x1 + (x2 - x1) * pulse} cy={y1 + (y2 - y1) * pulse} r={9 * u} fill={theme.fg} />}
            </g>
          );
        })}
      </svg>
      {nodes.map((label, i) => {
        const appear = spring({ frame: frame - (i === 0 ? 2 : Math.round(times[i - 1] * fps) + 10), fps, config: { damping: 15 } });
        // Each box has its own photo (older projects: the scene's images in rotation).
        const asset = scene.nodeAssets ? scene.nodeAssets[i] : scene.assets.length ? scene.assets[i % scene.assets.length] : null;
        const editorial = theme.style === "editorial";
        if (editorial && !asset) {
          // No photo for this box: a clean paper card with the label, not an empty dark square.
          return (
            <div key={i} style={{ position: "absolute", left: pos[i].x - box / 2, top: pos[i].y - box / 2, width: box, height: box, transform: `scale(${appear})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: box * 0.86, minHeight: box * 0.5, padding: 16 * u, backgroundColor: "#FAF8F4", border: `${2 * u}px solid ${theme.fg}`, boxShadow: `0 ${14 * u}px ${30 * u}px rgba(0,0,0,0.18)`, transform: `rotate(${i % 2 ? 1.5 : -1.5}deg)`, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontFamily: theme.display, fontWeight: 800, color: theme.fg, fontSize: Math.max(26, Math.min(44, 520 / Math.max(1, label.length))) * u, lineHeight: 1.05, letterSpacing: "-0.02em" }}>
                {label}
              </div>
            </div>
          );
        }
        const f = asset?.focus;
        return (
          <div key={i} style={{ position: "absolute", left: pos[i].x - box / 2, top: pos[i].y - box / 2, width: box, height: box, transform: `scale(${appear})`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 * u }}>
            <div
              style={
                theme.style === "editorial"
                  ? { width: box * 0.78, height: box * 0.56, overflow: "hidden", border: `${8 * u}px solid #FAF8F4`, boxShadow: `0 ${14 * u}px ${30 * u}px rgba(0,0,0,0.25)`, transform: `rotate(${i % 2 ? 2 : -2}deg)`, backgroundColor: "#222", display: "flex", alignItems: "center", justifyContent: "center" }
                  : { width: box * 0.62, height: box * 0.62, borderRadius: "50%", overflow: "hidden", border: `${4 * u}px solid ${theme.fg}`, backgroundColor: "#222", display: "flex", alignItems: "center", justifyContent: "center" }
              }
            >
              {asset && asset.type === "image" ? (
                <Img src={asset.url} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: f ? `${(f.x + f.w / 2) * 100}% ${(f.y + f.h / 2) * 100}%` : "50% 40%", filter: gradeFilter(theme.grade) }} />
              ) : (
                <div style={{ fontFamily: theme.sans, fontWeight: 900, color: theme.style === "editorial" ? "#FAF8F4" : theme.fg, fontSize: 70 * u }}>{label.slice(0, 1).toUpperCase()}</div>
              )}
            </div>
            <div style={{ fontFamily: theme.sans, fontWeight: 700, color: theme.fg, fontSize: 32 * u, textAlign: "center", lineHeight: 1.1 }}>{label}</div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
