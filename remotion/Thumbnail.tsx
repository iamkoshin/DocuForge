import React from "react";
import { AbsoluteFill, Img } from "remotion";
import type { RenderProps } from "../src/lib/schemas";
import { ThemeContext, useLayout } from "./components/layout";
import { gradeFilter } from "./components/Media";
import { getTheme } from "./themes";

const Inner: React.FC<RenderProps> = (p) => {
  const theme = getTheme(p.theme);
  const { u, width, vertical } = useLayout();
  const t = p.thumbnail ?? { text: p.title };
  const words = t.text.split(/\s+/).slice(0, 4);
  const f = t.focus ?? { x: 0.5, y: 0.3, w: 0.3, h: 0.3 };
  const cx = f.x + f.w / 2;
  // Put the subject on one side and the words on the other (16:9), or text at the bottom (9:16).
  const textLeft = cx > 0.5;
  const size = Math.min(vertical ? 190 : 170, ((vertical ? width * 0.9 : width * 0.5) / Math.max(...words.map((w) => w.length), 3)) * 1.55) * u;
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      {t.imageUrl && (
        <Img
          src={t.imageUrl}
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: `${cx * 100}% ${(f.y + f.h / 2) * 100}%`,
            filter: `${gradeFilter(theme.grade)} contrast(1.12) saturate(1.1)`,
            transform: "scale(1.08)",
          }}
        />
      )}
      <AbsoluteFill
        style={{
          background: vertical
            ? "linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 40%, rgba(0,0,0,0) 65%)"
            : `linear-gradient(to ${textLeft ? "right" : "left"}, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.6) 40%, rgba(0,0,0,0) 70%)`,
        }}
      />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 50%, rgba(0,0,0,0.6) 100%)" }} />
      <div
        style={{
          position: "absolute",
          ...(vertical ? { left: 60 * u, right: 60 * u, bottom: 260 * u } : { top: 0, bottom: 0, [textLeft ? "left" : "right"]: 70 * u, width: width * 0.5 }),
          display: "flex",
          flexDirection: "column",
          justifyContent: vertical ? "flex-end" : "center",
          alignItems: vertical ? "center" : textLeft ? "flex-start" : "flex-end",
        }}
      >
        {words.map((w, i) => (
          <div
            key={i}
            style={{
              fontFamily: theme.sans,
              fontWeight: 900,
              fontSize: size,
              lineHeight: 0.95,
              textTransform: "uppercase",
              letterSpacing: "-0.03em",
              color: i === words.length - 1 ? theme.accentInk : "#FFFFFF",
              backgroundColor: i === words.length - 1 ? theme.accent : "transparent",
              padding: i === words.length - 1 ? `${4 * u}px ${18 * u}px` : 0,
              marginTop: i === words.length - 1 ? 10 * u : 0,
              textShadow: i === words.length - 1 ? "none" : "0 6px 30px rgba(0,0,0,0.7)",
            }}
          >
            {w}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const Thumbnail: React.FC<RenderProps> = (p) => (
  <ThemeContext.Provider value={getTheme(p.theme)}>
    <Inner {...p} />
  </ThemeContext.Provider>
);
