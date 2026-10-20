// Offline end-to-end test (no paid API keys): fixture research + script, Windows SAPI voice,
// then the REAL visuals (Wikimedia + article scraping), QA stills, Remotion render, loudness and outputs.
// Requires the worker's asset server (npm run dev or npm run worker) on ASSET_PORT.
// Usage: npx tsx scripts/offline-e2e.ts [16:9|9:16] [theme]
import fs from "node:fs";
import { hashOf } from "../src/lib/cache";
import { probeDuration, run } from "../src/lib/ffmpeg";
import { ensureDir } from "../src/lib/paths";
import { createProject, setStep, updateProject } from "../src/lib/projects";
import type { ProjectOptions, Research, Script, VoiceResult, VoiceScene } from "../src/lib/schemas";
import { makeCtx } from "../src/worker/context";
import { runPipeline, STEP_DEFS } from "../src/worker/runner";

const format = (process.argv[2] ?? "16:9") as ProjectOptions["format"];
const theme = (process.argv[3] ?? "investigative") as ProjectOptions["theme"];
const mix = process.argv.includes("--mix"); // music bed + punchy SFX (run scripts/fake-audio.ts first)

const src = (url: string, title: string, publisher: string) => ({ url, title, publisher });
const WIKI = src("https://en.wikipedia.org/wiki/Bankruptcy_of_FTX", "Bankruptcy of FTX", "Wikipedia");
const WIKI2 = src("https://en.wikipedia.org/wiki/Sam_Bankman-Fried", "Sam Bankman-Fried", "Wikipedia");
const DOJ = src("https://www.justice.gov/usao-sdny/pr/samuel-bankman-fried-sentenced-25-years-his-orchestration-multiple-fraudulent-schemes", "Samuel Bankman-Fried Sentenced To 25 Years", "U.S. Department of Justice");

const research: Research = {
  topic: "The collapse of FTX",
  summary: "FTX, once valued at $32 billion, collapsed in November 2022 after revelations that customer deposits had been funneled to its sister trading firm Alameda Research.",
  timeline: [
    { date: "Nov 2, 2022", event: "CoinDesk reports on Alameda's balance sheet", claimIds: ["c2"] },
    { date: "Nov 8, 2022", event: "FTX halts withdrawals", claimIds: ["c3"] },
    { date: "Nov 11, 2022", event: "FTX files for bankruptcy", claimIds: ["c4"] },
    { date: "Mar 28, 2024", event: "Bankman-Fried sentenced to 25 years", claimIds: ["c5"] },
  ],
  players: [{ name: "Sam Bankman-Fried", role: "Founder and CEO of FTX", imageSearchName: "Sam Bankman-Fried" }],
  places: [{ name: "The Bahamas", description: "FTX headquarters" }],
  organizations: [{ name: "Alameda Research", description: "Trading firm founded by Bankman-Fried" }],
  events: [{ name: "FTX bankruptcy", date: "2022-11-11", description: "Chapter 11 filing in Delaware" }],
  numbers: [{ label: "Peak valuation", value: "$32 billion", context: "January 2022 funding round", claimIds: ["c1"] }],
  claims: [
    { id: "c1", text: "FTX was valued at $32 billion in January 2022.", sources: [WIKI, WIKI2] },
    { id: "c2", text: "A November 2022 report revealed Alameda's balance sheet was largely FTT tokens.", sources: [WIKI, WIKI2] },
    { id: "c3", text: "FTX halted customer withdrawals on November 8, 2022.", sources: [WIKI, DOJ] },
    { id: "c4", text: "FTX filed for Chapter 11 bankruptcy on November 11, 2022.", sources: [WIKI, DOJ] },
    { id: "c5", text: "Bankman-Fried was sentenced to 25 years in prison in March 2024.", sources: [DOJ, WIKI2] },
  ],
  currentStatus: { text: "Bankman-Fried is serving a 25-year sentence; the FTX estate has been repaying creditors.", asOf: "2025", sources: [DOJ] },
  allSources: [WIKI, WIKI2, DOJ],
};

const sc = (id: string, sceneType: Script["scenes"][number]["sceneType"], narration: string, kind: Script["scenes"][number]["visual"]["kind"], subject: string, data: Script["scenes"][number]["data"] = {}, extra: Partial<Script["scenes"][number]> = {}) => ({
  id, chapterId: "ch1", narration, emphasisWords: [], sceneType, visual: { kind, subject, context: "2022", searchQueries: [subject] }, sfx: [], claimIds: [], data, ...extra,
});
const script: Script = {
  title: "Nine Days to Zero: The Collapse of FTX",
  thumbnailText: "Nine Days To Zero",
  chapters: [{ id: "ch1", title: "The collapse", hook: "" }],
  scenes: [
    sc("s1", "KineticCaption", "In nine days, a thirty-two billion dollar empire vanished.", "person", "Sam Bankman-Fried", {}, { emphasisWords: ["vanished"], claimIds: ["c1"], sfx: [{ cue: "sub_bass_drop", at: "word", anchorWord: "vanished", intensity: "high" }] }),
    sc("s2", "NameReveal", "Its founder, Sam Bankman-Fried, was the face of crypto.", "person", "Sam Bankman-Fried", { name: "Sam Bankman-Fried", role: "Founder & CEO, FTX" }),
    sc("s3", "BigNumber", "In January twenty twenty-two, investors valued FTX at thirty-two billion dollars.", "person", "Sam Bankman-Fried", { number: "32", numberPrefix: "$", numberSuffix: " billion", label: "Valuation, January 2022" }, { claimIds: ["c1"] }),
    sc("s4", "FlowDiagram", "But customer money was quietly flowing to his trading firm, Alameda Research.", "graphic", "flow", { nodes: ["Customers", "FTX", "Alameda"], flowLabel: "customer deposits" }),
    sc("s5", "Timeline", "Then, in November, everything moved fast.", "graphic", "timeline", { timelineEvents: [{ date: "Nov 2", label: "Balance sheet leaks" }, { date: "Nov 8", label: "Withdrawals halted" }, { date: "Nov 11", label: "Bankruptcy" }] }, { claimIds: ["c3"] }),
    sc("s6", "PaperDocument", "On November eleventh, FTX filed for bankruptcy.", "graphic", "filing", { docType: "filing", docTitle: "Voluntary Petition — Chapter 11", docRows: [{ label: "Debtor", value: "FTX Trading Ltd." }, { label: "Court", value: "D. Delaware" }], stampText: "Chapter 11" }, { claimIds: ["c4"], climax: true }),
    sc("s7", "Statement", "In twenty twenty-four, he was sentenced to twenty-five years in prison.", "graphic", "", { statement: "Sentenced to 25 years." }, { claimIds: ["c5"], sfx: [{ cue: "prison_door_clang", at: "word", anchorWord: "prison", intensity: "high" }] }),
    sc("s8", "EndCard", "Trust, once spent, is the hardest asset to recover.", "graphic", "", { statement: "Trust, once spent, is the hardest asset to recover.", footnote: "As of 2025: Bankman-Fried is serving a 25-year sentence; the FTX estate has been repaying creditors." }),
  ],
};

async function sapi(text: string, wav: string) {
  const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = 1; $s.SetOutputToWaveFile('${wav.replace(/'/g, "''")}'); $s.Speak('${text.replace(/'/g, "''")}'); $s.Dispose()`;
  await run("powershell", ["-NoProfile", "-Command", ps]);
}

const id = createProject(
  { topic: research.topic, angle: "", minutes: 0.5, format, voiceId: "offline-sapi", voiceName: "Windows SAPI (offline test)", language: "English", tone: "Investigative", theme, musicMood: mix ? "tense" : "none", sfxLevel: mix ? "punchy" : "off", sourceUrls: [], pauseForApproval: false, scriptSource: "api", ownScript: "" },
  0,
);
updateProject(id, { title: script.title });
console.log("project", id);
const ctx0 = makeCtx(id, "research");
ctx0.write("research.json", research);
ctx0.write("script.json", script);
ensureDir(ctx0.file("voice"));
if (mix) {
  ensureDir(ctx0.file("uploads", "music"));
  fs.copyFileSync("data/test-music.mp3", ctx0.file("uploads", "music", "bed.mp3"));
}

const scenes: VoiceScene[] = [];
for (const s of script.scenes) {
  const wav = ctx0.file("voice", `${s.id}.wav`);
  const rel = `voice/${s.id}-offline.mp3`;
  await sapi(s.narration, wav);
  await run("ffmpeg", ["-y", "-i", wav, "-af", "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse", "-c:a", "libmp3lame", "-b:a", "128k", ctx0.file(rel)]);
  fs.rmSync(wav);
  const duration = await probeDuration(ctx0.file(rel));
  // Approximate word timings proportional to word length (real runs use ElevenLabs alignment).
  const words = s.narration.split(/\s+/);
  const total = words.reduce((a, w) => a + w.length + 1, 0);
  let t = 0;
  const timings = words.map((w) => {
    const d = ((w.length + 1) / total) * duration;
    const r = { word: w, start: t, end: t + d * 0.9 };
    t += d;
    return r;
  });
  scenes.push({ sceneId: s.id, file: rel, duration, words: timings, textHash: "offline" });
  console.log("voiced", s.id, duration.toFixed(2));
}
const voice: VoiceResult = { scenes, totalSeconds: 0, targetSeconds: 30, adjustments: [] };
ctx0.write("voice.json", voice);

// Mark the paid steps as done with their current input hashes so the runner continues from Music.
for (const step of ["research", "script", "review", "voice"] as const) {
  const c = makeCtx(id, step);
  setStep(id, step, { status: step === "review" ? "skipped" : "done", input_hash: hashOf(STEP_DEFS[step].inputs(c)), progress: 1 });
}
const t0 = Date.now();
const result = await runPipeline(id);
console.log(`pipeline → ${result} in ${((Date.now() - t0) / 1000).toFixed(0)}s; files in data/projects/${id}`);
process.exit(result === "done" ? 0 : 1);
