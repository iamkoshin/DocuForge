// Run a project's pipeline in-process (skips finished steps whose inputs are unchanged): npx tsx scripts/resume.ts <projectId>
import { runPipeline } from "../src/worker/runner";
const r = await runPipeline(process.argv[2]);
console.log("pipeline →", r);
process.exit(r === "failed" ? 1 : 0);
