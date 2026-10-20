// Offline test helper: fills every starter SFX key with a synthesized placeholder sound (ffmpeg),
// so the SFX planner and 4-layer mix can be tested without ElevenLabs. Also makes a music bed.
// Usage: npx tsx scripts/fake-audio.ts [musicOut.mp3 seconds]
// Remove the placeholders later from the Sound library page (they are tagged "placeholder").
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "../src/lib/db";
import { run } from "../src/lib/ffmpeg";
import { addUploadedSfx, STARTER_PACK, type SfxCategory } from "../src/lib/sfx";

const RECIPES: Record<SfxCategory, (d: number) => string> = {
  whoosh: (d) => `anoisesrc=d=${d}:c=pink:a=0.8,bandpass=f=1800:w=1500,afade=t=in:d=${d * 0.5},afade=t=out:st=${d * 0.5}:d=${d * 0.5}`,
  impact: (d) => `sine=f=48:d=${d},volume=4,afade=t=out:st=0.05:d=${d - 0.05}`,
  riser: (d) => `aevalsrc='0.5*sin(2*PI*(200+600*t/${d})*t)':d=${d},afade=t=in:d=${d}`,
  texture: (d) => `anoisesrc=d=${d}:c=white:a=0.3,highpass=f=3000,afade=t=out:st=${d * 0.6}:d=${d * 0.4}`,
  tick: () => `sine=f=2400:d=0.05,afade=t=out:d=0.05`,
  ui: (d) => `sine=f=1200:d=${Math.min(d, 0.4)},afade=t=out:d=${Math.min(d, 0.4)}`,
  ambience: (d) => `anoisesrc=d=${d}:c=brown:a=0.4,lowpass=f=300`,
  misc: (d) => `sine=f=600:d=${d}`,
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "docuforge-fake-"));
for (const s of STARTER_PACK) {
  const have = (db().prepare("SELECT COUNT(*) n FROM sfx WHERE key = ?").get(s.key) as { n: number }).n;
  if (have) continue;
  const wav = path.join(tmp, `${s.key}.wav`);
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", RECIPES[s.category](s.duration), "-ar", "44100", "-ac", "2", wav]);
  await addUploadedSfx({ srcFile: wav, originalName: `${s.key}.wav`, tags: ["placeholder"], key: s.key });
  console.log("placeholder", s.key);
}
db().prepare("UPDATE sfx SET source = 'starter' WHERE tags LIKE '%placeholder%'").run();

const [musicOut, secs] = process.argv.slice(2);
if (musicOut) {
  const d = Number(secs ?? 60);
  // A slow minor-chord pad with gentle pulse: enough to hear ducking and the climax drop-out.
  const expr = `0.12*sin(2*PI*110*t)+0.09*sin(2*PI*130.8*t)+0.08*sin(2*PI*164.8*t)+0.05*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*0.5*t))`;
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", `aevalsrc='${expr}':d=${d}:s=44100`, "-af", "lowpass=f=900", "-c:a", "libmp3lame", "-b:a", "160k", musicOut]);
  console.log("music bed", musicOut);
}
fs.rmSync(tmp, { recursive: true, force: true });
