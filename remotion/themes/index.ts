import { loadFont as loadInterTight } from "@remotion/google-fonts/InterTight";
import { loadFont as loadInstrumentSerif } from "@remotion/google-fonts/InstrumentSerif";
import { loadFont as loadJetBrains } from "@remotion/google-fonts/JetBrainsMono";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadSpecialElite } from "@remotion/google-fonts/SpecialElite";
import { loadFont as loadCourierPrime } from "@remotion/google-fonts/CourierPrime";

const interTight = loadInterTight("normal", { weights: ["600", "800", "900"], subsets: ["latin", "latin-ext"] });
const serif = loadInstrumentSerif("italic", { weights: ["400"], subsets: ["latin", "latin-ext"] });
loadInstrumentSerif("normal", { weights: ["400"], subsets: ["latin", "latin-ext"] });
const mono = loadJetBrains("normal", { weights: ["400", "700"], subsets: ["latin", "latin-ext"] });
const inter = loadInter("normal", { weights: ["500", "700", "900"], subsets: ["latin", "latin-ext"] });
const typewriter = loadSpecialElite("normal", { weights: ["400"], subsets: ["latin"] });
const courier = loadCourierPrime("normal", { weights: ["400", "700"], subsets: ["latin", "latin-ext"] });

export interface Theme {
  id: string;
  name: string;
  bg: string;
  fg: string;
  muted: string;
  paper: string;
  paperInk: string;
  accent: string;
  accentInk: string; // text on accent
  line: string;
  sans: string;
  serif: string;
  mono: string;
  headlineWeight: number;
  uppercaseHeadlines: boolean;
  grade: { saturate: number; contrast: number; sepia: number; brightness: number };
  grain: number; // 0..1 opacity
  vignette: number; // 0..1
  scratches: boolean;
  overlayTint?: string;
}

export const THEMES: Record<string, Theme> = {
  investigative: {
    id: "investigative",
    name: "Investigative",
    bg: "#0B0B0B",
    fg: "#F2F2EE",
    muted: "#9A9A94",
    paper: "#ECE6DA",
    paperInk: "#1A1814",
    accent: "#E0241B",
    accentInk: "#F2F2EE",
    line: "rgba(242,242,238,0.35)",
    sans: interTight.fontFamily,
    serif: serif.fontFamily,
    mono: mono.fontFamily,
    headlineWeight: 900,
    uppercaseHeadlines: true,
    grade: { saturate: 0.82, contrast: 1.12, sepia: 0, brightness: 0.96 },
    grain: 0.09,
    vignette: 0.55,
    scratches: false,
  },
  "clean-light": {
    id: "clean-light",
    name: "Clean Light",
    bg: "#F5F6F8",
    fg: "#14171C",
    muted: "#6B7280",
    paper: "#FFFFFF",
    paperInk: "#14171C",
    accent: "#2563EB",
    accentInk: "#FFFFFF",
    line: "rgba(20,23,28,0.25)",
    sans: inter.fontFamily,
    serif: serif.fontFamily,
    mono: mono.fontFamily,
    headlineWeight: 900,
    uppercaseHeadlines: false,
    grade: { saturate: 0.95, contrast: 1.05, sepia: 0, brightness: 1.02 },
    grain: 0.03,
    vignette: 0.2,
    scratches: false,
  },
  "retro-archive": {
    id: "retro-archive",
    name: "Retro Archive",
    bg: "#1E1710",
    fg: "#F1E4C8",
    muted: "#B39C78",
    paper: "#E9DABA",
    paperInk: "#2B2118",
    accent: "#C2502E",
    accentInk: "#F1E4C8",
    line: "rgba(241,228,200,0.35)",
    sans: courier.fontFamily,
    serif: serif.fontFamily,
    mono: typewriter.fontFamily,
    headlineWeight: 700,
    uppercaseHeadlines: true,
    grade: { saturate: 0.55, contrast: 1.08, sepia: 0.45, brightness: 0.95 },
    grain: 0.16,
    vignette: 0.7,
    scratches: true,
    overlayTint: "rgba(120,80,30,0.12)",
  },
};

export const getTheme = (id: string): Theme => THEMES[id] ?? THEMES.investigative;
