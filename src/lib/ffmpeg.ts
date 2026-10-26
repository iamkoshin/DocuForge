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

/** Silent stretches (seconds) quieter than `db` that last at least `min` seconds. */
export async function detectSilences(file: string, db = -40, min = 0.15): Promise<[number, number][]> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-i", file, "-af", `silencedetect=n=${db}dB:d=${min}`, "-f", "null", "-"]);
  const out: [number, number][] = [];
  let start: number | null = null;
  for (const m of stderr.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    if (m[1] === "start") start = Math.max(0, Number(m[2]));
    else if (start !== null) {
      out.push([start, Number(m[2])]);
      start = null;
    }
  }
  return out;
}

/**
 * Remove dead air from a voice clip: silence before the first word and after the last, and long pauses
 * between sentences shortened to `maxPause`. Returns the removed stretches (original seconds) so word
 * timings can be shifted to match.
 */
export async function tightenSpeech(input: string, output: string, o = { lead: 0.02, tail: 0.08, maxPause: 0.22 }) {
  const dur = await probeDuration(input);
  const removed: [number, number][] = [];
  for (const [a, b0] of await detectSilences(input)) {
    const b = Math.min(b0, dur);
    if (a <= 0.01) b - o.lead > 0.01 && removed.push([0, b - o.lead]);
    else if (b >= dur - 0.02) dur - (a + o.tail) > 0.01 && removed.push([a + o.tail, dur]);
    else if (b - a > o.maxPause) removed.push([a + o.maxPause / 2, b - o.maxPause / 2]);
  }
  if (!removed.length) {
    fs.copyFileSync(input, output);
    return { removed, duration: dur };
  }
  const keep: [number, number][] = [];
  let t = 0;
  for (const [a, b] of removed) {
    if (a > t) keep.push([t, a]);
    t = b;
  }
  if (t < dur) keep.push([t, dur]);
  const parts = keep.map(([a, b], i) => `[0:a]atrim=start=${a.toFixed(4)}:end=${b.toFixed(4)},asetpts=PTS-STARTPTS[s${i}]`);
  const filter = `${parts.join(";")};${keep.map((_, i) => `[s${i}]`).join("")}concat=n=${keep.length}:v=0:a=1[out]`;
  await run("ffmpeg", ["-y", "-i", input, "-filter_complex", filter, "-map", "[out]", "-c:a", "libmp3lame", "-b:a", "128k", output]);
  return { removed, duration: await probeDuration(output) };
}

/** Where an original time lands after `removed` stretches were cut out. */
export function shiftTime(t: number, removed: [number, number][]) {
  let shift = 0;
  for (const [a, b] of removed) {
    if (t >= b) shift += b - a;
    else if (t > a) shift += t - a;
  }
  return Math.max(0, t - shift);
}

/** Bring a music track to a fixed loudness so the mix level means the same for every track. */
export async function normalizeMusic(input: string, output: string, lufs = -14) {
  await run("ffmpeg", ["-y", "-i", input, "-af", `loudnorm=I=${lufs}:TP=-2:LRA=11`, "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "192k", output]);
}
