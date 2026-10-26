import fs from "node:fs";
import { normalizeLoudness, probeDuration } from "@/lib/ffmpeg";
import type { RenderProps } from "@/lib/schemas";
import { readApprovals, type StepDef } from "../context";
import { buildRenderProps, remotionSourceHash, renderContactSheet, renderVideo } from "../render";

export const previewStep: StepDef = {
  name: "preview",
  inputs: (ctx) => ({
    files: ["script.json", "voice.json", "visuals.json", "sfx.json", "music.json"].map((f) => ctx.hash(f)),
    theme: ctx.options.theme,
    format: ctx.options.format,
    remotion: remotionSourceHash(),
    pause: ctx.options.pauseForApproval,
  }),
  async run(ctx) {
    const props = buildRenderProps(ctx);
    ctx.write("project.json", props);
    const approved = readApprovals(ctx).preview === ctx.hash("project.json");
    if (approved && fs.existsSync(ctx.file("contact.json"))) {
      ctx.info("Contact sheet approved");
      return "done";
    }
    ctx.progress(0.02, "Bundling video templates…");
    const sheet = await renderContactSheet(ctx, props, (p) => ctx.progress(0.05 + 0.95 * p, `Rendering QA stills ${Math.round(p * props.scenes.length)}/${props.scenes.length}`));
    ctx.write("contact.json", sheet);
    ctx.info(`Contact sheet ready: ${sheet.length} stills (${(props.durationInFrames / props.fps).toFixed(1)}s video)`);
    if (!ctx.options.pauseForApproval) return "done";
    ctx.info("Waiting for QA — check the contact sheet, swap any images, then click “Render video”.");
    return "waiting";
  },
};

export const renderStep: StepDef = {
  name: "render",
  inputs: (ctx) => ({ props: ctx.hash("project.json"), concurrency: ctx.settings.renderConcurrency, musicVolume: ctx.options.musicVolume ?? 0 }),
  async run(ctx) {
    const saved = ctx.read<RenderProps>("project.json");
    if (!saved) throw new Error("project.json missing — run Preview first");
    const props = { ...saved, musicBaseDb: saved.musicBaseDb + (ctx.options.musicVolume ?? 0) };
    const raw = ctx.file("render-raw.mp4");
    const started = Date.now();
    await renderVideo(ctx, props, raw, (p, stage) => ctx.progress(p * 0.92, `${stage === "muxing" ? "Muxing" : "Rendering"} ${Math.round(p * 100)}%`));
    ctx.info(`Rendered ${(props.durationInFrames / props.fps).toFixed(1)}s of video in ${((Date.now() - started) / 1000).toFixed(0)}s`);

    // Loudness: target −14 LUFS integrated, true peak ≤ −1 dBTP.
    ctx.progress(0.94, "Measuring and correcting loudness…");
    const out = ctx.file("video.mp4");
    const { before, after } = await normalizeLoudness(raw, out);
    fs.rmSync(raw, { force: true });
    ctx.info(`Loudness: ${before.input_i.toFixed(1)} → ${after.input_i.toFixed(1)} LUFS, true peak ${before.input_tp.toFixed(1)} → ${after.input_tp.toFixed(1)} dBTP (target −14 LUFS, ≤ −1 dBTP)`);
    if (Math.abs(after.input_i + 14) > 1 || after.input_tp > -0.9) ctx.warn("Loudness is outside target after correction — check the mix.");
    const dur = await probeDuration(out);
    ctx.info(`video.mp4 ready (${dur.toFixed(1)}s)`);
    return "done";
  },
};
