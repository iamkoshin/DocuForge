import fs from "node:fs";
import path from "node:path";
import { db, now } from "./db";
import { probeDuration, toMp3 } from "./ffmpeg";
import { soundEffect } from "./clients/elevenlabs";
import { addCost, log, newId } from "./projects";
import { getSettings } from "./settings";
import { dataRel, ensureDir, SFX_DIR, DATA_DIR } from "./paths";

export interface SfxRow {
  id: string;
  key: string;
  prompt: string;
  tags: string;
  file: string;
  duration: number;
  category: string;
  source: string;
  uses: number;
  created_at: number;
}

export interface StarterSound {
  key: string;
  prompt: string;
  duration: number;
  category: SfxCategory;
  variations: number;
}
export type SfxCategory = "whoosh" | "impact" | "riser" | "texture" | "tick" | "ui" | "ambience" | "misc";

// Levels relative to voice (0 dB). Impacts loudest; ticks/rustles quietest.
export const CATEGORY_DB: Record<SfxCategory, number> = {
  impact: -14,
  riser: -17,
  whoosh: -18,
  ui: -19,
  misc: -18,
  texture: -22,
  tick: -22,
  ambience: -24,
};

export const STARTER_PACK: StarterSound[] = [
  { key: "whoosh_fast_airy", prompt: "fast airy whoosh transition, clean, cinematic", duration: 0.8, category: "whoosh", variations: 3 },
  { key: "whoosh_slow_deep", prompt: "slow deep whoosh pass-by, cinematic documentary transition", duration: 1.6, category: "whoosh", variations: 2 },
  { key: "swoosh_text_in", prompt: "short soft swoosh for text appearing on screen, subtle UI motion graphics", duration: 0.5, category: "whoosh", variations: 3 },
  { key: "impact_boom", prompt: "deep cinematic impact boom hit with short tail", duration: 2, category: "impact", variations: 3 },
  { key: "hit_low_soft", prompt: "soft low thud hit, subtle documentary accent", duration: 1, category: "impact", variations: 2 },
  { key: "sub_bass_drop", prompt: "sub bass drop, deep rumble, trailer style", duration: 2.5, category: "impact", variations: 2 },
  { key: "riser_2s", prompt: "tension riser building up, 2 seconds, cinematic, ends abruptly", duration: 2, category: "riser", variations: 2 },
  { key: "riser_4s", prompt: "long tension riser building up, 4 seconds, cinematic swell, ends abruptly", duration: 4, category: "riser", variations: 2 },
  { key: "glitch_digital", prompt: "short digital glitch stutter, data corruption sound", duration: 0.7, category: "ui", variations: 2 },
  { key: "camera_shutter", prompt: "single DSLR camera shutter click", duration: 0.5, category: "ui", variations: 2 },
  { key: "paper_slide", prompt: "sheet of paper sliding across a wooden desk", duration: 0.9, category: "texture", variations: 2 },
  { key: "paper_rustle", prompt: "paper documents rustling, short", duration: 1.2, category: "texture", variations: 2 },
  { key: "rubber_stamp_slam", prompt: "rubber stamp slammed hard onto paper on a desk", duration: 0.6, category: "impact", variations: 2 },
  { key: "keyboard_typing", prompt: "fast mechanical keyboard typing, close mic", duration: 3, category: "texture", variations: 2 },
  { key: "clock_tick", prompt: "single clean clock tick", duration: 0.5, category: "tick", variations: 2 },
  { key: "cash_register", prompt: "vintage cash register ka-ching", duration: 1.2, category: "ui", variations: 1 },
  { key: "coin_drop", prompt: "single coin dropping onto a table", duration: 1, category: "ui", variations: 2 },
  { key: "notification_ping", prompt: "smartphone notification ping, clean", duration: 0.6, category: "ui", variations: 2 },
  { key: "heartbeat", prompt: "slow tense heartbeat, low thumps", duration: 3, category: "ambience", variations: 1 },
  { key: "crowd_murmur", prompt: "indoor crowd murmur, courtroom or conference hall ambience", duration: 5, category: "ambience", variations: 1 },
  { key: "gavel", prompt: "judge gavel striking twice in a courtroom", duration: 1.2, category: "impact", variations: 1 },
  { key: "prison_door_clang", prompt: "heavy metal prison cell door slamming shut with echo", duration: 2, category: "impact", variations: 1 },
  { key: "record_scratch", prompt: "vinyl record scratch stop", duration: 0.8, category: "ui", variations: 1 },
  { key: "tension_drone", prompt: "dark low tension drone, ominous, steady", duration: 8, category: "ambience", variations: 1 },
];

const STOP = new Set(["a", "an", "the", "of", "for", "and", "with", "sound", "sfx", "effect", "short", "single", "on", "in", "to", "at", "very", "some", "into"]);
const SYN: Record<string, string> = {
  swish: "whoosh",
  swoosh: "swoosh",
  woosh: "whoosh",
  boom: "boom",
  impact: "impact",
  thud: "hit",
  slam: "slam",
  bass: "sub",
  drop: "drop",
  rise: "riser",
  build: "riser",
  buildup: "riser",
  shutter: "shutter",
  camera: "shutter",
  photo: "shutter",
  typing: "keyboard",
  keys: "keyboard",
  typewriter: "keyboard",
  tick: "tick",
  ticking: "tick",
  clock: "tick",
  register: "cash",
  kaching: "cash",
  coins: "coin",
  ping: "ping",
  notification: "ping",
  heart: "heartbeat",
  murmur: "crowd",
  chatter: "crowd",
  hammer: "gavel",
  cell: "prison",
  scratch: "scratch",
  drone: "drone",
  glitch: "glitch",
  stamp: "stamp",
  paper: "paper",
  document: "paper",
  rustle: "rustle",
};

function tokens(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, " ")
    .split(/[\s_-]+/)
    .filter((t) => t && !STOP.has(t))
    .map((t) => SYN[t] ?? t);
}

/** "A fast, airy whoosh!" -> "whoosh_fast_airy" style key (category word first when known). */
export function normalizeKey(text: string) {
  const t = [...new Set(tokens(text))];
  const known = t.filter((x) => Object.values(SYN).includes(x));
  const rest = t.filter((x) => !known.includes(x));
  return [...known, ...rest].slice(0, 4).join("_") || "sound";
}

export function listSfx(): SfxRow[] {
  return db().prepare("SELECT * FROM sfx ORDER BY key, created_at").all() as SfxRow[];
}

export function distinctKeys() {
  return db().prepare("SELECT key, MIN(category) category, MIN(prompt) prompt, COUNT(*) n FROM sfx GROUP BY key ORDER BY key").all() as {
    key: string;
    category: string;
    prompt: string;
    n: number;
  }[];
}

/** Best library key for a cue: exact key, then token overlap (Jaccard ≥ 0.5). Null means "generate it". */
export function matchKey(cue: string, keys = distinctKeys().map((k) => k.key)): string | null {
  const direct = cue.trim().toLowerCase();
  if (keys.includes(direct)) return direct;
  const norm = normalizeKey(cue);
  if (keys.includes(norm)) return norm;
  const ct = new Set(tokens(cue));
  let best: { key: string; score: number } | null = null;
  for (const k of keys) {
    const kt = new Set(tokens(k));
    const inter = [...ct].filter((x) => kt.has(x)).length;
    const score = inter / new Set([...ct, ...kt]).size;
    if (!best || score > best.score) best = { key: k, score };
  }
  return best && best.score >= 0.5 ? best.key : null;
}

/** Deterministically rotate between variations of a key so repeated hits don't sound identical. */
export function pickVariation(key: string, n: number): SfxRow | null {
  const rows = db().prepare("SELECT * FROM sfx WHERE key = ? ORDER BY created_at").all(key) as SfxRow[];
  if (!rows.length) return null;
  return rows[n % rows.length];
}

export function categoryOf(key: string): SfxCategory {
  const starter = STARTER_PACK.find((s) => s.key === key);
  if (starter) return starter.category;
  const t = tokens(key);
  if (t.some((x) => ["whoosh", "swoosh"].includes(x))) return "whoosh";
  if (t.some((x) => ["boom", "impact", "hit", "slam", "drop", "gavel", "stamp", "sub"].includes(x))) return "impact";
  if (t.includes("riser")) return "riser";
  if (t.some((x) => ["tick", "click"].includes(x))) return "tick";
  if (t.some((x) => ["paper", "rustle", "keyboard"].includes(x))) return "texture";
  if (t.some((x) => ["drone", "crowd", "ambience", "heartbeat", "rain", "wind"].includes(x))) return "ambience";
  return "misc";
}

function insertRow(r: Omit<SfxRow, "uses" | "created_at">) {
  db()
    .prepare("INSERT INTO sfx (id, key, prompt, tags, file, duration, category, source, uses, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)")
    .run(r.id, r.key, r.prompt, r.tags, r.file, r.duration, r.category, r.source, now());
}

export async function generateSfx(p: { key?: string; prompt: string; duration?: number; source?: "starter" | "generated"; tags?: string[]; projectId?: string | null }) {
  const key = p.key ?? normalizeKey(p.prompt);
  const id = newId();
  const dir = ensureDir(path.join(SFX_DIR, key));
  const file = path.join(dir, `${id}.mp3`);
  const audio = await soundEffect({ text: p.prompt, durationSeconds: p.duration });
  fs.writeFileSync(file, audio);
  addCost({ projectId: p.projectId, step: "sfx", provider: "elevenlabs", units: 1, unitType: "sfx", usd: getSettings().elevenUsdPerSfx, note: `SFX "${key}"` });
  const duration = await probeDuration(file).catch(() => p.duration ?? 1);
  const row = {
    id,
    key,
    prompt: p.prompt,
    tags: JSON.stringify(p.tags ?? tokens(key)),
    file: dataRel(file),
    duration,
    category: categoryOf(key),
    source: p.source ?? "generated",
  };
  insertRow(row);
  return row;
}

export async function addUploadedSfx(p: { srcFile: string; originalName: string; tags: string[]; key?: string }) {
  const raw = (p.key?.trim() || p.originalName.replace(/\.[a-z0-9]+$/i, "")).toLowerCase();
  // Keep exact library/starter keys as-is (e.g. "camera_shutter"); normalise anything else.
  const known = new Set([...STARTER_PACK.map((s) => s.key), ...distinctKeys().map((k) => k.key)]);
  const key = known.has(raw) ? raw : normalizeKey(raw);
  const id = newId();
  const dir = ensureDir(path.join(SFX_DIR, key));
  const file = path.join(dir, `${id}.mp3`);
  await toMp3(p.srcFile, file);
  const duration = await probeDuration(file);
  const row = { id, key, prompt: `uploaded: ${p.originalName}`, tags: JSON.stringify(p.tags), file: dataRel(file), duration, category: categoryOf(key), source: "upload" };
  insertRow(row);
  return row;
}

export function deleteSfx(id: string) {
  const row = db().prepare("SELECT * FROM sfx WHERE id = ?").get(id) as SfxRow | undefined;
  if (!row) return;
  fs.rmSync(path.join(DATA_DIR, row.file), { force: true });
  db().prepare("DELETE FROM sfx WHERE id = ?").run(id);
}

export function updateSfxTags(id: string, tags: string[]) {
  db().prepare("UPDATE sfx SET tags = ? WHERE id = ?").run(JSON.stringify(tags), id);
}

/** Generate any starter sounds not yet in the library (first variation of each, or all variations when `full`). */
export async function seedStarterPack(opts: { projectId?: string | null; full?: boolean } = {}) {
  let made = 0;
  for (const s of STARTER_PACK) {
    const have = (db().prepare("SELECT COUNT(*) n FROM sfx WHERE key = ?").get(s.key) as { n: number }).n;
    const want = opts.full ? s.variations : 1;
    for (let i = have; i < want; i++) {
      await generateSfx({ key: s.key, prompt: s.prompt, duration: s.duration, source: "starter", projectId: opts.projectId });
      made++;
    }
  }
  if (opts.projectId && made) log(opts.projectId, "info", `Seeded ${made} starter sounds into the SFX library`, "sfx");
  return made;
}

/** Make sure a heavily-used starter key has its extra variations (generated lazily, once). */
export async function ensureVariations(key: string, projectId?: string | null) {
  const s = STARTER_PACK.find((x) => x.key === key);
  if (!s) return;
  const have = (db().prepare("SELECT COUNT(*) n FROM sfx WHERE key = ?").get(key) as { n: number }).n;
  for (let i = have; i < s.variations; i++) {
    await generateSfx({ key, prompt: s.prompt, duration: s.duration, source: "starter", projectId });
  }
}

export function bumpUses(id: string) {
  db().prepare("UPDATE sfx SET uses = uses + 1 WHERE id = ?").run(id);
}
