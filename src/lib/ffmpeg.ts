import fs from "node:fs";
import { spawn } from "node:child_process";

export function run(cmd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    const timer = opts.timeoutMs ? setTimeout(() => p.kill("SIGKILL"), opts.timeoutMs) : null;
    p.on("error", (e) => reject(new Error(`${cmd} could not start (${e.message}). Is ffmpeg installed and on PATH?`)));
    p.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-1500)}`));
    });
  });
}

export async function ffmpegAvailable() {
  try {
    const { stdout } = await run("ffmpeg", ["-version"]);
    return stdout.split("\n")[0];
  } catch {
    return null;
  }
}

export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  const d = parseFloat(stdout.trim());
  if (!Number.isFinite(d)) throw new Error(`Could not read duration of ${file}`);
  return d;
}

export async function probeVideo(file: string) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height:format=duration",
    "-of",
    "json",
    file,
  ]);
  const j = JSON.parse(stdout) as { streams: { width: number; height: number }[]; format: { duration: string } };
  return { width: j.streams[0]?.width ?? 0, height: j.streams[0]?.height ?? 0, duration: parseFloat(j.format.duration) || 0 };
}

export interface Loudness {
  input_i: number;
  input_tp: number;
  input_lra: number;
  input_thresh: number;
  target_offset: number;
}

/** First loudnorm pass: measure integrated loudness (LUFS) and true peak (dBTP). */
export async function measureLoudness(file: string, target = { I: -14, TP: -1, LRA: 11 }): Promise<Loudness> {
  const { stderr } = await run("ffmpeg", [
    "-hide_banner",
    "-nostats",
    "-i",
    file,
    "-af",
    `loudnorm=I=${target.I}:TP=${target.TP}:LRA=${target.LRA}:print_format=json`,
    "-f",
    "null",
    "-",
  ]);
  const m = stderr.match(/\{[\s\S]*?"target_offset"[\s\S]*?\}/);
  if (!m) throw new Error("Could not parse loudnorm output");
  const j = JSON.parse(m[0]) as Record<string, string>;
  return {
    input_i: parseFloat(j.input_i),
    input_tp: parseFloat(j.input_tp),
    input_lra: parseFloat(j.input_lra),
    input_thresh: parseFloat(j.input_thresh),
    target_offset: parseFloat(j.target_offset),
  };
}

/** Second loudnorm pass (linear, using measured values); video stream is copied untouched. */
export async function loudnormVideo(input: string, output: string, m: Loudness, target = { I: -14, TP: -1, LRA: 11 }) {
  const af =
    `loudnorm=I=${target.I}:TP=${target.TP}:LRA=${target.LRA}:measured_I=${m.input_i}:measured_TP=${m.input_tp}` +
    `:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`;
  await run("ffmpeg", ["-y", "-hide_banner", "-i", input, "-c:v", "copy", "-af", af, "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output]);
}

/** Join audio files with equal-power crossfades (used for per-chapter music). */
export async function crossfadeConcat(files: string[], output: string, fadeSec = 3) {
  if (files.length === 1) {
    await run("ffmpeg", ["-y", "-i", files[0], "-c:a", "libmp3lame", "-b:a", "192k", output]);
    return;
  }
  const args = ["-y", "-hide_banner"];
  for (const f of files) args.push("-i", f);
  let chain = "";
  let prev = "[0:a]";
  for (let i = 1; i < files.length; i++) {
    const out = i === files.length - 1 ? "[out]" : `[a${i}]`;
    chain += `${prev}[${i}:a]acrossfade=d=${fadeSec}:c1=qsin:c2=qsin${out};`;
    prev = out;
  }
  args.push("-filter_complex", chain.replace(/;$/, ""), "-map", "[out]", "-c:a", "libmp3lame", "-b:a", "192k", output);
  await run("ffmpeg", args);
}

/** Loop/trim an audio file to an exact length with fade in/out (for user-uploaded music). */
export async function fitAudio(input: string, output: string, seconds: number) {
  await run("ffmpeg", [
    "-y",
    "-stream_loop",
    "-1",
    "-i",
    input,
    "-t",
    seconds.toFixed(2),
    "-af",
    `afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, seconds - 3).toFixed(2)}:d=3`,
    "-c:a",
    "libmp3lame",
    "-b:a",
    "192k",
    output,
  ]);
}

/** Convert any uploaded audio to mp3 so the renderer can always read it. */
export async function toMp3(input: string, output: string) {
  await run("ffmpeg", ["-y", "-i", input, "-vn", "-c:a", "libmp3lame", "-b:a", "192k", output]);
}

export async function videoFrame(input: string, output: string, atSec: number) {
  await run("ffmpeg", ["-y", "-ss", atSec.toFixed(2), "-i", input, "-frames:v", "1", "-q:v", "3", output]);
}

/**
 * Bring a rendered video to −14 LUFS integrated with true peak ≤ −1 dBTP.
 * Linear two-pass loudnorm first (transparent). If peaks cap the gain so the target is missed,
 * first push gain into a peak limiter (creating headroom), then run the linear pass on that.
 * (loudnorm's dynamic mode alone undershoots on peaky voice tracks — measured −15.5 LUFS.)
 */
export async function normalizeLoudness(input: string, output: string, target = { I: -14, TP: -1, LRA: 11 }) {
  const before = await measureLoudness(input, target);
  // Aim 0.5 dB under the true-peak target: AAC re-encoding adds small inter-sample overs.
  const inner = { ...target, TP: target.TP - 0.5 };
  await loudnormVideo(input, output, before, inner);
  let after = await measureLoudness(output, target);
  const ok = (l: Loudness) => Math.abs(l.input_i - target.I) <= 0.5 && l.input_tp <= target.TP;
  if (!ok(after)) {
    const tmp = output.replace(/\.mp4$/, ".limited.mp4");
    const gain = Math.max(0, target.I - before.input_i - 1.5);
    await run("ffmpeg", [
      "-y", "-hide_banner", "-i", input, "-c:v", "copy",
      "-af", `volume=${gain.toFixed(2)}dB,alimiter=limit=0.56:attack=1:release=50:level=false`, // ceiling ≈ −5 dBFS
      "-c:a", "aac", "-b:a", "320k", tmp,
    ]);
    await loudnormVideo(tmp, output, await measureLoudness(tmp, inner), inner);
    fs.rmSync(tmp, { force: true });
    after = await measureLoudness(output, target);
  }
  return { before, after };
}
