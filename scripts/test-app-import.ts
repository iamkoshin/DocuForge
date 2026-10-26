// Test "Claude app" mode without any API: project pauses for a paste; a messy pasted reply
// (two "continue" parts, code fences, missing optional fields, a fake and a dead link) is imported;
// the pipeline continues to script review. Usage: npx tsx scripts/test-app-import.ts
import { getLogs, createProject, getSteps } from "../src/lib/projects";
import { makeCtx } from "../src/worker/context";
import { runPipeline } from "../src/worker/runner";
import { buildAppPrompt, parseAppReply } from "../src/worker/steps/appImport";
import type { ProjectOptions, Research, Script } from "../src/lib/schemas";

const options: ProjectOptions = {
  topic: "The collapse of FTX", angle: "", minutes: 0.5, format: "16:9", voiceId: "test", voiceName: "test", language: "English",
  tone: "Investigative", theme: "investigative", musicMood: "none", musicVolume: 0, sfxLevel: "normal", sourceUrls: [], pauseForApproval: true, scriptSource: "app", ownScript: "",
};
const id = createProject(options, 0);
console.log("project", id);
console.log("prompt length:", buildAppPrompt(options).length, "chars");

const r1 = await runPipeline(id);
console.log("1st run →", r1, "| research:", getSteps(id).find((s) => s.step === "research")?.status);

const reply = {
  research: {
    summary: "FTX collapsed in November 2022.",
    players: [{ name: "Sam Bankman-Fried", role: "Founder and CEO of FTX" }], // imageSearchName omitted on purpose
    claims: [
      { id: "c1", text: "FTX filed for bankruptcy on November 11, 2022.", sources: [
        { url: "https://en.wikipedia.org/wiki/Bankruptcy_of_FTX", title: "Bankruptcy of FTX", publisher: "Wikipedia" },
        { url: "https://www.justice.gov/usao-sdny/pr/samuel-bankman-fried-sentenced-25-years-his-orchestration-multiple-fraudulent-schemes", title: "SBF sentenced", publisher: "DOJ" } ] },
      { id: "c2", text: "Bankman-Fried was sentenced to 25 years in March 2024.", sources: [
        { url: "https://www.justice.gov/usao-sdny/pr/samuel-bankman-fried-sentenced-25-years-his-orchestration-multiple-fraudulent-schemes", title: "SBF sentenced", publisher: "DOJ" },
        { url: "https://en.wikipedia.org/wiki/Sam_Bankman-Fried", title: "Sam Bankman-Fried", publisher: "Wikipedia" } ] },
      { id: "c3", text: "An invented claim with invented sources.", sources: [
        { url: "https://www.totally-made-up-news-site-xyz.com/ftx-story", title: "Fake", publisher: "Fake" },
        { url: "https://en.wikipedia.org/wiki/This_page_does_not_exist_ftx_qqq", title: "Dead", publisher: "Wikipedia" } ] },
    ],
    currentStatus: { text: "SBF is serving a 25-year sentence.", asOf: "2025" },
  },
  script: {
    title: "Nine Days to Zero",
    scenes: [
      { chapterId: "ch1", narration: "In nine days, a crypto empire collapsed.", sceneType: "KineticCaption", emphasisWords: ["collapsed"], visual: { kind: "person", subject: "Sam Bankman-Fried", searchQueries: ["Sam Bankman-Fried"] }, claimIds: ["c1"] },
      { chapterId: "ch1", narration: "Something invented happened.", sceneType: "NotARealType", claimIds: ["c3"] },
      { chapterId: "ch1", narration: "He was sentenced to twenty-five years.", sceneType: "Statement", data: { statement: "25 years." }, claimIds: ["c2"] },
      { chapterId: "ch1", narration: "Trust is the hardest asset to recover.", sceneType: "EndCard" },
    ],
  },
  youtube: { titles: ["Nine Days to Zero", "How FTX Collapsed", "The Fall of SBF"], description: "The story of FTX.", tags: ["FTX", "crypto"] },
};
const json = JSON.stringify(reply, null, 2);
const cut = Math.floor(json.length / 2);
const pasted = `Here is the research and script.\n\n\`\`\`json\n${json.slice(0, cut)}\n\`\`\`\n\ncontinue\n\n\`\`\`json\n${json.slice(cut)}\n\`\`\``;

console.log("bad paste →", JSON.stringify(parseAppReply("Sure! Here you go: { \"research\": ", options)));
const parsed = parseAppReply(pasted, options);
if (!parsed.ok) throw new Error("parse failed: " + parsed.errors.join("; "));
console.log("parsed:", parsed.summary);
makeCtx(id, "research").write("import.json", parsed.data);

const r2 = await runPipeline(id);
const ctx = makeCtx(id, "research");
const research = ctx.read<Research>("research.json")!;
const script = ctx.read<Script>("script.json")!;
console.log("2nd run →", r2, "|", getSteps(id).map((s) => `${s.step}:${s.status}`).join(" "));
console.log("claims kept:", research.claims.map((c) => `${c.id}(${c.sources.length})`).join(" "), "| dropped:", research.droppedClaims?.map((d) => `${d.id}: ${d.reason}`).join("; "));
console.log("scene types:", script.scenes.map((s) => `${s.id}:${s.sceneType}`).join(" "));
for (const l of getLogs(id)) if (l.level !== "info" || /Imported|imported/.test(l.message)) console.log(`  [${l.level}] ${l.message}`);
process.exit(0);
