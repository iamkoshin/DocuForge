// Normalise a video's audio to −14 LUFS / −1 dBTP: npx tsx scripts/loudness.ts in.mp4 out.mp4
import { normalizeLoudness } from "../src/lib/ffmpeg";
const { before, after } = await normalizeLoudness(process.argv[2], process.argv[3]);
console.log(`before ${before.input_i} LUFS / ${before.input_tp} dBTP → after ${after.input_i} LUFS / ${after.input_tp} dBTP`);
