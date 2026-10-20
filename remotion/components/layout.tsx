import React, { createContext, useContext } from "react";
import { useVideoConfig } from "remotion";
import type { Theme } from "../themes";
import { THEMES } from "../themes";

export const ThemeContext = createContext<Theme>(THEMES.investigative);
export const useTheme = () => useContext(ThemeContext);

/** Layout units so every scene works in 16:9 and 9:16. `u` = 1px at 1080 on the short side. */
export function useLayout() {
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  const u = Math.min(width, height) / 1080;
  // Safe margins: keep text clear of YouTube/Shorts UI overlays.
  const safe = vertical
    ? { top: height * 0.12, bottom: height * 0.22, left: width * 0.08, right: width * 0.08 }
    : { top: height * 0.08, bottom: height * 0.1, left: width * 0.07, right: width * 0.07 };
  return { width, height, vertical, u, safe };
}

export const SafeArea: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; align?: "center" | "end" | "start" }> = ({ children, style, align = "center" }) => {
  const { safe } = useLayout();
  return (
    <div
      style={{
        position: "absolute",
        top: safe.top,
        bottom: safe.bottom,
        left: safe.left,
        right: safe.right,
        display: "flex",
        flexDirection: "column",
        justifyContent: align === "center" ? "center" : align === "end" ? "flex-end" : "flex-start",
        alignItems: "center",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Dark gradient behind text so it stays readable on bright images. */
export const TextScrim: React.FC<{ from?: "bottom" | "center" | "top"; strength?: number }> = ({ from = "bottom", strength = 0.75 }) => {
  const bg =
    from === "center"
      ? `radial-gradient(ellipse at center, rgba(0,0,0,${strength}) 0%, rgba(0,0,0,${strength * 0.5}) 45%, rgba(0,0,0,0) 80%)`
      : `linear-gradient(to ${from === "bottom" ? "top" : "bottom"}, rgba(0,0,0,${strength}) 0%, rgba(0,0,0,${strength * 0.55}) 35%, rgba(0,0,0,0) 70%)`;
  return <div style={{ position: "absolute", inset: 0, background: bg }} />;
};

export const clean = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
