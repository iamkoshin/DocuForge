import path from "node:path";
import fs from "node:fs";

export const ROOT = process.cwd();
export const DATA_DIR = path.join(ROOT, "data");
export const PROJECTS_DIR = path.join(DATA_DIR, "projects");
export const SFX_DIR = path.join(DATA_DIR, "sfx");
export const MUSIC_DIR = path.join(DATA_DIR, "music");
export const CACHE_DIR = path.join(DATA_DIR, "cache");
export const DB_PATH = path.join(DATA_DIR, "narrative.db");

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function projectDir(id: string, ...rest: string[]) {
  if (!/^[a-z0-9-]+$/i.test(id)) throw new Error(`Invalid project id: ${id}`);
  return path.join(PROJECTS_DIR, id, ...rest);
}

/** Resolve a user-supplied relative path under DATA_DIR, refusing traversal. */
export function safeDataPath(rel: string) {
  const p = path.resolve(DATA_DIR, rel);
  if (!p.startsWith(DATA_DIR + path.sep)) throw new Error("Path outside data dir");
  return p;
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function writeJson(file: string, data: unknown) {
  ensureDir(path.dirname(file));
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

/** URL path (served by the web app at /api/files/... and by the worker asset server) for a file under DATA_DIR. */
export function dataRel(abs: string) {
  return path.relative(DATA_DIR, abs).split(path.sep).join("/");
}
