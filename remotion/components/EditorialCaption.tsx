import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { displayNumber, editorialPhrases, type CaptionItem, type CaptionPhrase } from "../../src/lib/editorial";
import type { RenderScene } from "../../src/lib/schemas";
import { isLight } from "../themes";
import { useLayout, useTheme } from "./layout";

const LEAD = 0.04; // seconds a word appears before it is spoken

function currentPhrase(phrases: CaptionPhrase[], t: number) {
  let idx = -1;
  phrases.forEach((p, i) => (t >= p.start - LEAD ? (idx = i) : null));
  return idx >= 0 ? phrases[idx] : null;
}

/** One word or display item, revealed when it is spoken. */
const Item: React.FC<{ item: CaptionItem; base: number; maxW: number; dark: boolean }> = ({ item, base, maxW, dark }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();
  const { u } = useLayout();
  const local = frame - Math.round((item.start - LEAD) * fps);
  if (local < 0) return null;
  const o = interpolate(local, [0, 3], [0, 1], { extrapolateRight: "clamp" });
  const ink = dark ? theme.paperInk : theme.fg;
  // Tight shadow for edges plus a soft glow, so words stay readable on bright footage without a scrim.
  const shadow = dark ? "none" : "0 1px 3px rgba(0,0,0,0.55), 0 0 22px rgba(0,0,0,0.5)";
  const raw = item.text.replace(/^["“]|["”]$/g, "");
  const text = item.style === "number" ? displayNumber(raw) : raw;

  if (!item.style) {
    const y = interpolate(local, [0, 4], [8 * u, 0], { extrapolateRight: "clamp" });
    return <span style={{ display: "inline-block", opacity: o, transform: `translateY(${y}px)`, fontFamily: theme.sans, fontWeight: 500, fontSize: base, color: ink, textShadow: shadow, marginRight: base * 0.26, letterSpacing: "-0.005em" }}>{text}</span>;
  }
  if (item.style === "feeling") {
    return <span style={{ display: "inline-block", opacity: o, fontFamily: theme.serif, fontStyle: "italic", fontSize: base * 1.45, color: ink, textShadow: shadow, marginRight: base * 0.26, lineHeight: 1 }}>{text}</span>;
  }
  // Display words get their own line, sized to fit.
  const s = interpolate(local, [0, 5], [1.08, 1], { extrapolateRight: "clamp" });
  const fit = (max: number, ratio: number) => Math.min(max * u, maxW / Math.max(3, text.length * ratio));
  const glitch = item.style === "danger" && local < 5 ? (local % 2 ? 1 : -1) * 4 * u : 0;
  const common: React.CSSProperties = { display: "block", opacity: o, transform: `scale(${s}) translateX(${glitch}px)`, transformOrigin: "left center", lineHeight: 1.0, margin: `${base * 0.12}px 0`, whiteSpace: "nowrap" };
  if (item.style === "name") {
    return <span style={{ ...common, fontFamily: theme.serif, fontStyle: theme.serifStyle, fontSize: fit(170, 0.42), color: ink, textShadow: shadow, letterSpacing: "-0.01em" }}>{text}</span>;
  }
  const danger = item.style === "danger";
  return (
    <span
      style={{
        ...common,
        fontFamily: theme.display,
        fontWeight: theme.headlineWeight,
        fontSize: fit(danger ? 160 : 150, 0.56),
        color: danger ? theme.accent : ink,
        letterSpacing: "-0.035em",
        textShadow: glitch ? `${3 * u}px 0 rgba(0,229,255,0.75), ${-3 * u}px 0 rgba(255,0,60,0.75)` : shadow,
      }}
    >
      {text.replace(/[.,;:]+$/, "")}
    </span>
  );
};

/** Lines of a phrase: plain/feeling words flow inline; number/name/danger items sit on their own line. */
function lines(items: CaptionItem[]) {
  const out: CaptionItem[][] = [];
  let run: CaptionItem[] = [];
  for (const it of items) {
    if (it.style && it.style !== "feeling") {
      if (run.length) out.push(run);
      out.push([it]);
      run = [];
    } else run.push(it);
  }
  if (run.length) out.push(run);
  return out;
}

/**
 * Editorial captions for footage scenes: words appear one at a time in the empty part of the frame
 * (opposite the subject), and each phrase replaces the last with a hard cut.
 */
export const EditorialCaption: React.FC<{ scene: RenderScene; onPaper?: boolean; scale?: number }> = ({ scene, onPaper, scale = 1 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();
  const { u, width, height, vertical, safe } = useLayout();
  const phrase = currentPhrase(editorialPhrases(scene.words, scene.emphasisWords), frame / fps);
  if (!phrase) return null;
  const dark = onPaper ?? isLight(theme.bg);

  // Put the words opposite the subject: subject on the right → text on the left, and vice versa.
  const f = scene.assets[0]?.focus;
  const cx = f ? f.x + f.w / 2 : 0.5;
  const side = vertical || !scene.assets.length ? "center" : cx > 0.56 ? "left" : cx < 0.44 ? "right" : "center";
  const boxW = side === "center" ? width - safe.left - safe.right : width * 0.46;
  const base = (vertical ? 52 : 46) * u * scale;
  const align = side === "center" ? "center" : "left";
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: side === "right" ? width * 0.5 : side === "left" ? safe.left : safe.left,
        width: boxW,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: align === "center" ? "center" : "flex-start",
        textAlign: align,
        paddingTop: vertical ? height * 0.1 : 0,
      }}
    >
      {lines(phrase.items).map((ln, i) => (
        <div key={i} style={{ lineHeight: 1.25 }}>
          {ln.map((it, k) => (
            <Item key={k} item={it} base={base} maxW={boxW} dark={dark} />
          ))}
        </div>
      ))}
    </div>
  );
};

/** A single running caption line near the bottom, for explainer scenes (paper, documents, posts). */
export const RunningCaption: React.FC<{ scene: RenderScene; onPaper: boolean }> = ({ scene, onPaper }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();
  const { u, width, height, vertical, safe } = useLayout();
  // Display words stay inline here (the scene itself carries the big graphics).
  const phrase = currentPhrase(editorialPhrases(scene.words, scene.emphasisWords, 6), frame / fps);
  if (!phrase) return null;
  const base = (vertical ? 50 : 44) * u;
  const inline = phrase.items.map((it) => (it.style ? { ...it, text: it.style === "number" ? displayNumber(it.text) : it.text, style: "feeling" as const } : it));
  return (
    <div style={{ position: "absolute", left: safe.left, right: safe.right, bottom: vertical ? height * 0.2 : height * 0.075, textAlign: "center", maxWidth: width - safe.left - safe.right }}>
      {inline.map((it, k) => (
        <Item key={k} item={it} base={base} maxW={width} dark={onPaper} />
      ))}
    </div>
  );
};
