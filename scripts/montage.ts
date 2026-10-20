// Dev helper: tile all .jpg/.png in a folder into one image for quick visual review.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
const dir = path.resolve(process.argv[2]);
const out = process.argv[3];
const cols = Number(process.argv[4] ?? 3);
const files = fs.readdirSync(dir).filter((f) => /\.(jpg|png)$/.test(f) && !f.startsWith("_")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const W = 640;
const tiles = await Promise.all(files.map(async (f) => sharp(path.join(dir, f)).resize({ width: W }).toBuffer({ resolveWithObject: true })));
const H = Math.max(...tiles.map((t) => t.info.height));
const rows = Math.ceil(tiles.length / cols);
await sharp({ create: { width: W * cols, height: H * rows, channels: 3, background: "#444" } })
  .composite(tiles.map((t, i) => ({ input: t.data, left: (i % cols) * W, top: Math.floor(i / cols) * H })))
  .jpeg({ quality: 80 })
  .toFile(out);
console.log(out, files.length);
