// Smoke test: bundle the Remotion project and render a mid-scene still of every sample scene (no API keys needed).
import fs from "node:fs";
import path from "node:path";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { getBundle } from "../src/worker/render";
import { SAMPLE_PROPS } from "../remotion/sample";
import type { RenderProps } from "../src/lib/schemas";

const outDir = path.resolve(process.argv[2] ?? "data/sample");
const format = (process.argv[3] ?? "16:9") as "16:9" | "9:16";
const theme = (process.argv[4] ?? "investigative") as RenderProps["theme"];
const video = process.argv.includes("--video");
fs.mkdirSync(outDir, { recursive: true });
const props: RenderProps = { ...SAMPLE_PROPS, format, theme, width: format === "9:16" ? 1080 : 1920, height: format === "9:16" ? 1920 : 1080 };
const inputProps = props as unknown as Record<string, unknown>;
const serveUrl = await getBundle();
const comp = await selectComposition({ serveUrl, id: "Documentary", inputProps });
for (const s of props.scenes) {
  const frame = s.startFrame + Math.floor(s.durationFrames * 0.6);
  await renderStill({ serveUrl, composition: comp, inputProps, frame, output: path.join(outDir, `${s.id}-${s.type}.jpg`), imageFormat: "jpeg", scale: 0.5 });
  console.log("still", s.id, s.type);
}
const thumb = await selectComposition({ serveUrl, id: "Thumbnail", inputProps });
await renderStill({ serveUrl, composition: thumb, inputProps, output: path.join(outDir, "thumbnail.png") });
if (video) {
  const t = Date.now();
  await renderMedia({ serveUrl, composition: comp, inputProps, codec: "h264", crf: 18, outputLocation: path.join(outDir, "sample.mp4"), onProgress: ({ progress }) => process.stdout.write(`\r${Math.round(progress * 100)}%`) });
  console.log(`\nvideo in ${((Date.now() - t) / 1000).toFixed(0)}s`);
}
console.log("done →", outDir);
