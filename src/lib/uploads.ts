import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { anyImageToJpeg } from "./images";

/** Formats kept as they are; any other image is converted to JPG. */
export const MEDIA_EXT = /\.(jpe?g|png|webp|mp4|mov|webm)$/i;

/** A free name in `dir`: "photo.jpg", then "photo (2).jpg", … */
export function freeName(dir: string, name: string) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; ; i++) {
    const n = i === 1 ? name : `${stem} (${i})${ext}`;
    if (!fs.existsSync(path.join(dir, n))) return n;
  }
}

export const cleanUploadName = (name: string) => path.basename(name).replace(/[^\w.\- ]+/g, "_");

/**
 * Save one uploaded image/clip into `dir`. Images in other formats (HEIC, GIF, AVIF, TIFF, BMP…) are
 * converted to JPG. Returns the saved name, or null when the file can't be used.
 */
export async function saveMediaFile(dir: string, entry: File): Promise<{ saved: string; convertedFrom?: string } | null> {
  const name = cleanUploadName(entry.name);
  const buf = Buffer.from(await entry.arrayBuffer());
  if (MEDIA_EXT.test(name)) {
    fs.writeFileSync(path.join(dir, name), buf);
    return { saved: name };
  }
  if (entry.type.startsWith("video/") || entry.type.startsWith("audio/")) return null;
  const tmp = path.join(os.tmpdir(), `narrative-${Date.now()}-${name}`);
  fs.writeFileSync(tmp, buf);
  try {
    const jpg = await anyImageToJpeg(tmp);
    if (!jpg) return null;
    const out = freeName(dir, `${name.replace(/\.[^.]*$/, "")}.jpg`);
    fs.writeFileSync(path.join(dir, out), jpg);
    return { saved: out, convertedFrom: name };
  } finally {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* a temp file that can't be removed yet must not fail the upload */
    }
  }
}
