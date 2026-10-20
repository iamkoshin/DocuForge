import sharp from "sharp";

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
