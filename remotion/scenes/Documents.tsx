import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { T } from "../../src/lib/timing";
import { SafeArea, useLayout, useTheme } from "../components/layout";
import { MediaLayer } from "../components/Media";
import type { SceneProps } from "./Typography";

const parseMoney = (v: string) => {
  const n = parseFloat(v.replace(/[^0-9.\-]/g, ""));
  const neg = /^\s*[-(−]/.test(v) || v.includes("(");
  return Number.isFinite(n) ? (neg ? -Math.abs(n) : n) : 0;
};

export const PaperDocument: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();
  const { u, width, height, vertical } = useLayout();
  const d = scene.data;
  const dur = scene.durationFrames / fps;
  const rows = (d.docRows ?? []).slice(0, 7);
  const enter = spring({ frame: frame - Math.round(T.paperIn * fps), fps, config: { damping: 20, stiffness: 120 } });
  const stampAt = Math.round(T.stamp(dur) * fps);
  const stamp = spring({ frame: frame - stampAt, fps, config: { damping: 11, stiffness: 260, mass: 0.6 } });
  const cardW = Math.min(width * (vertical ? 0.86 : 0.5), 1000 * u);
  const rowTimes = rows.map((_, i) => 0.6 + i * Math.min(0.45, (dur * 0.5) / Math.max(1, rows.length)));
  const t = frame / fps;

  // "statement": balance drains toward (and below) zero.
  let balance: React.ReactNode = null;
  if (d.docType === "statement") {
    const start = rows.length ? parseMoney(rows[0].value) : 1000;
    const end = rows.length > 1 ? parseMoney(rows[rows.length - 1].value) : -Math.abs(start) * 0.2;
    const p = interpolate(t, [0.6, dur * 0.75], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
    const v = start + (end - start) * p;
    balance = (
      <div style={{ marginTop: 26 * u, display: "flex", justifyContent: "space-between", alignItems: "baseline", borderTop: `2px solid ${theme.paperInk}`, paddingTop: 18 * u }}>
        <span style={{ fontFamily: theme.mono, fontSize: 26 * u, color: theme.paperInk }}>BALANCE</span>
        <span style={{ fontFamily: theme.mono, fontWeight: 700, fontSize: 58 * u, color: v < 0 ? "#C1121F" : theme.paperInk, fontVariantNumeric: "tabular-nums" }}>
          {v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}
        </span>
      </div>
    );
  }
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <MediaLayer assets={scene.assets} durationInFrames={scene.durationFrames} dim={0.75} seed={scene.index} />
      <SafeArea>
        <div
          style={{
            width: cardW,
            maxHeight: height * 0.8,
            backgroundColor: theme.paper,
            color: theme.paperInk,
            padding: `${46 * u}px ${52 * u}px ${(d.docType === "filing" || d.stampText ? 150 : 46) * u}px`,
            boxShadow: `0 ${40 * u}px ${80 * u}px rgba(0,0,0,0.6)`,
            transform: `translateY(${(1 - enter) * 80 * u}px) rotate(${(1 - enter) * -3 - 0.8}deg)`,
            opacity: enter,
            position: "relative",
            backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.025) 0px, rgba(0,0,0,0.025) 1px, transparent 1px, transparent 4px)",
          }}
        >
          <div style={{ fontFamily: theme.mono, fontSize: 22 * u, letterSpacing: "0.2em", opacity: 0.6, textTransform: "uppercase" }}>
            {d.docType === "filing" ? "Filed document" : d.docType === "balance-sheet" ? "Balance sheet" : "Account statement"}
          </div>
          <div style={{ fontFamily: theme.serif, fontSize: 52 * u, lineHeight: 1.05, margin: `${14 * u}px 0 ${26 * u}px` }}>{d.docTitle || d.label || scene.emphasisWords.join(" ")}</div>
          {rows.map((r, i) => {
            const shown = t >= rowTimes[i];
            const neg = r.negative ?? parseMoney(r.value) < 0;
            const hl = d.docType === "balance-sheet" && neg ? interpolate(t, [rowTimes[i] + 0.2, rowTimes[i] + 0.5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 20 * u,
                  fontFamily: theme.mono,
                  fontSize: 28 * u,
                  padding: `${10 * u}px ${8 * u}px`,
                  borderBottom: `1px dashed rgba(0,0,0,0.25)`,
                  opacity: shown ? 1 : 0,
                  backgroundColor: `rgba(224,36,27,${0.22 * hl})`,
                  color: neg && d.docType !== "statement" ? `rgb(${26 + 167 * hl},${24 - 6 * hl},${20 + 11 * hl})` : theme.paperInk,
                }}
              >
                <span>{r.label}</span>
                <span style={{ fontWeight: 700 }}>{r.value}</span>
              </div>
            );
          })}
          {balance}
          {(d.docType === "filing" || d.stampText) && (
            <div
              style={{
                position: "absolute",
                right: 40 * u,
                bottom: 34 * u,
                border: `${7 * u}px solid ${theme.accent}`,
                color: theme.accent,
                fontFamily: theme.sans,
                fontWeight: 900,
                fontSize: 64 * u,
                padding: `${6 * u}px ${22 * u}px`,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                opacity: frame >= stampAt ? 0.88 : 0,
                transform: `rotate(-12deg) scale(${2.2 - 1.2 * stamp})`,
                mixBlendMode: "multiply",
              }}
            >
              {d.stampText || "FILED"}
            </div>
          )}
        </div>
      </SafeArea>
    </AbsoluteFill>
  );
};

export const CodeSnippet: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();
  const { u, width, vertical } = useLayout();
  const code = (scene.data.code ?? "").replace(/\t/g, "  ");
  const dur = scene.durationFrames / fps;
  const typing = T.codeTyping(code.length, dur);
  const t = frame / fps - T.codeStart;
  const chars = Math.max(0, Math.floor((t / typing) * code.length));
  const shown = code.slice(0, chars);
  const lines = shown.split("\n");
  const done = chars >= code.length;
  const hl = (scene.data.highlightLine ?? 0) - 1;
  const hlOn = done ? interpolate(frame / fps, [T.codeStart + typing, T.codeStart + typing + 0.3], [0, 1], { extrapolateRight: "clamp" }) : 0;
  const size = (vertical ? 30 : 34) * u;
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <SafeArea>
        <div style={{ width: Math.min(width * (vertical ? 0.9 : 0.66), 1300 * u), backgroundColor: "#111214", borderRadius: 14 * u, border: `1px solid #2a2b2f`, boxShadow: `0 ${30 * u}px ${70 * u}px rgba(0,0,0,0.6)`, overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: `${16 * u}px ${22 * u}px`, borderBottom: "1px solid #2a2b2f" }}>
            <div style={{ display: "flex", gap: 10 * u }}>
              {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
                <div key={c} style={{ width: 16 * u, height: 16 * u, borderRadius: "50%", backgroundColor: c, opacity: 0.8 }} />
              ))}
            </div>
            <div style={{ fontFamily: theme.mono, fontSize: 20 * u, color: theme.accent, letterSpacing: "0.25em", border: `1px solid ${theme.accent}`, padding: `${4 * u}px ${10 * u}px` }}>ILLUSTRATION</div>
          </div>
          <div style={{ padding: `${26 * u}px ${30 * u}px`, fontFamily: theme.mono, fontSize: size, lineHeight: 1.55, color: "#E6E6E6", whiteSpace: "pre-wrap", minHeight: size * 1.55 * Math.min(8, code.split("\n").length) }}>
            {lines.map((l, i) => (
              <div key={i} style={{ backgroundColor: i === hl ? `rgba(224,36,27,${0.3 * hlOn})` : "transparent", margin: `0 -${12 * u}px`, padding: `0 ${12 * u}px` }}>
                <span style={{ color: "#5c5f66", marginRight: 22 * u }}>{String(i + 1).padStart(2, " ")}</span>
                {l || " "}
                {i === lines.length - 1 && !done && <span style={{ backgroundColor: "#E6E6E6", opacity: Math.floor(frame / 8) % 2 ? 1 : 0 }}> </span>}
              </div>
            ))}
          </div>
        </div>
      </SafeArea>
    </AbsoluteFill>
  );
};

/** Verbatim recreation of a real post (source shown); deliberately no likes/retweets/view counts. */
export const SocialPost: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();
  const { u, width, vertical } = useLayout();
  const p = scene.data.post;
  if (!p) return null;
  const enter = spring({ frame, fps, config: { damping: 18 } });
  const host = (() => {
    try {
      return new URL(p.sourceUrl).hostname.replace(/^www\./, "");
    } catch {
      return p.sourceUrl;
    }
  })();
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <MediaLayer assets={scene.assets} durationInFrames={scene.durationFrames} dim={0.8} seed={scene.index} />
      <SafeArea>
        <div style={{ width: Math.min(width * (vertical ? 0.88 : 0.52), 1000 * u), backgroundColor: "#FFFFFF", color: "#0F1419", borderRadius: 22 * u, padding: 40 * u, boxShadow: `0 ${30 * u}px ${70 * u}px rgba(0,0,0,0.55)`, transform: `scale(${0.92 + 0.08 * enter})`, opacity: enter }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 * u }}>
            <div style={{ width: 72 * u, height: 72 * u, borderRadius: "50%", backgroundColor: "#CBD2D9", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: theme.sans, fontWeight: 800, fontSize: 32 * u, color: "#3B4652" }}>
              {p.author.slice(0, 1)}
            </div>
            <div>
              <div style={{ fontFamily: theme.sans, fontWeight: 800, fontSize: 32 * u }}>{p.author}</div>
              <div style={{ fontFamily: theme.sans, fontSize: 26 * u, color: "#536471" }}>
                {p.handle} · {p.platform}
              </div>
            </div>
          </div>
          <div style={{ fontFamily: theme.sans, fontSize: 38 * u, lineHeight: 1.35, margin: `${26 * u}px 0` }}>{p.text}</div>
          <div style={{ fontFamily: theme.sans, fontSize: 24 * u, color: "#536471" }}>{p.date}</div>
        </div>
        <div style={{ marginTop: 20 * u, fontFamily: theme.mono, fontSize: 22 * u, color: theme.muted, opacity: interpolate(frame, [15, 30], [0, 1], { extrapolateRight: "clamp" }) }}>Source: {host}</div>
      </SafeArea>
    </AbsoluteFill>
  );
};
