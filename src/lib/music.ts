// Music library: every track uploaded or generated is kept here so later videos can reuse it
// without going back to ElevenLabs.
import fs from "node:fs";
import path from "node:path";
import { dataRel, ensureDir, MUSIC_DIR, PROJECTS_DIR, readJson } from "./paths";
import { getProject } from "./projects";

export const MUSIC_EXT = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;

export interface MusicTrack {
  name: string;
  file: string; // relative to DATA_DIR, for fileUrl()
  size: number;
  addedAt: number;
}

const clean = (name: string) => path.basename(name).replace(/[^\w.\-() ]+/g, "_");

/** Absolute path of a library track, or null if the name is not in the library. */
export function libraryTrack(name: string) {
  const f = path.join(MUSIC_DIR, clean(name));
  return MUSIC_EXT.test(f) && fs.existsSync(f) ? f : null;
}

/** Copy a track into the library. An identical file already there is reused; a different one with the same name gets a suffix. */
export function addToLibrary(src: string, name: string) {
  ensureDir(MUSIC_DIR);
  const base = clean(name);
  const ext = path.extname(base);
  const stem = base.slice(0, -ext.length || undefined);
  const size = fs.statSync(src).size;
  for (let i = 1; ; i++) {
    const n = i === 1 ? base : `${stem} (${i})${ext}`;
    const dest = path.join(MUSIC_DIR, n);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
      return n;
    }
    if (fs.statSync(dest).size === size && fs.readFileSync(dest).equals(fs.readFileSync(src))) return n;
  }
}

/** First run: bring in the music earlier projects already used. */
function backfill() {
  const marker = path.join(ensureDir(MUSIC_DIR), ".imported");
  if (fs.existsSync(marker)) return;
  if (fs.existsSync(PROJECTS_DIR)) for (const id of fs.readdirSync(PROJECTS_DIR)) {
    const up = path.join(PROJECTS_DIR, id, "uploads", "music");
    if (fs.existsSync(up)) for (const f of fs.readdirSync(up)) if (MUSIC_EXT.test(f)) addToLibrary(path.join(up, f), f);
    const gen = path.join(PROJECTS_DIR, id, "music.mp3");
    const meta = readJson<{ source?: string }>(path.join(PROJECTS_DIR, id, "music.json"));
    const opts = getProject(id)?.options;
    if (meta?.source === "generated" && fs.existsSync(gen)) addToLibrary(gen, generatedName(opts?.topic ?? id, opts?.musicMood ?? ""));
  }
  fs.writeFileSync(marker, "");
}

export const generatedName = (topic: string, mood: string) => `${topic.slice(0, 60)}${mood ? ` - ${mood.slice(0, 30)}` : ""}.mp3`;

export function listMusic(): MusicTrack[] {
  backfill();
  return fs
    .readdirSync(MUSIC_DIR)
    .filter((n) => MUSIC_EXT.test(n))
    .map((name) => {
      const st = fs.statSync(path.join(MUSIC_DIR, name));
      return { name, file: dataRel(path.join(MUSIC_DIR, name)), size: st.size, addedAt: st.mtimeMs };
    })
    .sort((a, b) => b.addedAt - a.addedAt);
}

export function deleteFromLibrary(name: string) {
  const f = libraryTrack(name);
  if (f) fs.rmSync(f);
}
