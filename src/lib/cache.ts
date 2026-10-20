import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR, ensureDir } from "./paths";

/** Stable JSON (sorted keys) so the same inputs always hash the same. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

export function hashOf(v: unknown) {
  return crypto.createHash("sha256").update(typeof v === "string" ? v : stableStringify(v)).digest("hex").slice(0, 24);
}

export function fileHash(file: string) {
  if (!fs.existsSync(file)) return "missing";
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 24);
}

/**
 * Cache a paid JSON-returning call by the hash of its inputs. A failed call is never cached,
 * so a retry with unchanged inputs re-attempts the call; a successful one is never paid for twice.
 */
export async function cachedJson<T>(kind: string, key: unknown, fn: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
  const file = path.join(ensureDir(path.join(CACHE_DIR, kind)), `${hashOf(key)}.json`);
  if (fs.existsSync(file)) {
    try {
      return { value: JSON.parse(fs.readFileSync(file, "utf8")) as T, hit: true };
    } catch {
      /* fall through and recompute */
    }
  }
  const value = await fn();
  fs.writeFileSync(file, JSON.stringify(value));
  return { value, hit: false };
}

/** Same as cachedJson but for binary outputs (audio). Returns the cache file path. */
export async function cachedFile(kind: string, key: unknown, ext: string, fn: () => Promise<Buffer>): Promise<{ file: string; hit: boolean }> {
  const file = path.join(ensureDir(path.join(CACHE_DIR, kind)), `${hashOf(key)}.${ext}`);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return { file, hit: true };
  const buf = await fn();
  fs.writeFileSync(file, buf);
  return { file, hit: false };
}
