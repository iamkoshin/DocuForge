import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { run } from "./ffmpeg";

export const MIN_LONG_SIDE = 800;

/** Normalise any downloaded image: auto-rotate, cap to 2400px, JPEG. Returns null if too small/unreadable. */
export async function normaliseImage(buf: Buffer, minLongSide = MIN_LONG_SIDE) {
  try {
    const img = sharp(buf, { failOn: "none" }).rotate();
    const meta = await img.metadata();
    const w = meta.autoOrient?.width ?? meta.width ?? 0;
    const h = meta.autoOrient?.height ?? meta.height ?? 0;
    if (Math.max(w, h) < minLongSide) return null;
    const out = await img
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#000" })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { buffer: out.data, width: out.info.width, height: out.info.height };
  } catch {
    return null;
  }
}

/** 64-bit difference hash (dHash) as hex; near-duplicates differ by only a few bits. */
export async function dHash(buf: Buffer) {
  const px = await sharp(buf).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] < px[y * 9 + x + 1] ? "1" : "0";
  return BigInt("0b" + bits).toString(16).padStart(16, "0");
}

export function hamming(a: string, b: string) {
  let x = BigInt("0x" + a) ^ BigInt("0x" + b);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** Small JPEG for Claude vision (keeps tokens low) or UI thumbnails. */
export async function smallJpeg(input: Buffer | string, longSide = 640) {
  return sharp(input).resize({ width: longSide, height: longSide, fit: "inside" }).jpeg({ quality: 78 }).toBuffer();
}

/**
 * Convert an uploaded image in any format (HEIC, GIF, AVIF, TIFF, BMP, SVG…) to JPEG at full size.
 * sharp handles most formats; ffmpeg covers the ones it can't (e.g. iPhone HEIC, BMP). Null if neither can read it.
 */
export async function anyImageToJpeg(file: string): Promise<Buffer | null> {
  try {
    // From memory, not the path: on Windows sharp keeps a file it opened locked, so it could not be deleted.
    return await sharp(fs.readFileSync(file), { failOn: "none", pages: 1 }).rotate().flatten({ background: "#fff" }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  } catch {
    /* try ffmpeg */
  }
  const out = path.join(os.tmpdir(), `narrative-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  try {
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-frames:v", "1", "-q:v", "2", out], { timeoutMs: 60000 });
    return fs.existsSync(out) && fs.statSync(out).size > 0 ? fs.readFileSync(out) : null;
  } catch {
    return null;
  } finally {
    fs.rmSync(out, { force: true });
  }
}
