import { hashOf } from "@/lib/cache";
import { getStep, log, setStep, updateProject } from "@/lib/projects";
import { STEPS, type StepName } from "@/lib/schemas";
import { makeCtx, type StepDef } from "./context";
import { musicStep } from "./steps/music";
import { outputsStep } from "./steps/outputs";
import { previewStep, renderStep } from "./steps/render";
import { researchStep } from "./steps/research";
import { reviewStep } from "./steps/review";
import { scriptStep } from "./steps/script";
import { sfxStep } from "./steps/sfx";
import { shortsStep } from "./steps/shorts";
import { visualsStep } from "./steps/visuals";
import { voiceStep } from "./steps/voice";

export const STEP_DEFS: Record<StepName, StepDef> = {
  research: researchStep,
  script: scriptStep,
  review: reviewStep,
  voice: voiceStep,
  music: musicStep,
  sfx: sfxStep,
  visuals: visualsStep,
  preview: previewStep,
  render: renderStep,
  outputs: outputsStep,
  shorts: shortsStep,
};

/**
 * Run the pipeline in order. A step is skipped when it already finished with identical inputs
 * (resumable + cached); otherwise it runs. Stops at the first step that waits for approval or fails.
 */
export async function runPipeline(projectId: string) {
  updateProject(projectId, { status: "running" });
  for (const name of STEPS) {
    const def = STEP_DEFS[name];
    const ctx = makeCtx(projectId, name);
    const row = getStep(projectId, name);
    const inputHash = hashOf(def.inputs(ctx));
    if ((row?.status === "done" || row?.status === "skipped") && row.input_hash === inputHash) continue;

    updateProject(projectId, { current_step: name, status: "running" });
    setStep(projectId, name, { status: "running", started_at: Date.now(), finished_at: null, error: null, progress: 0, message: null });
    log(projectId, "info", `▶ ${name}`, name);
    try {
      const result = await def.run(ctx);
      // Re-hash after running: some steps legitimately update their own inputs (voice trims script.json).
      const after = hashOf(def.inputs(makeCtx(projectId, name)));
      if (result === "waiting") {
        setStep(projectId, name, { status: "waiting", input_hash: after, progress: 1 });
        updateProject(projectId, { status: "waiting" });
        return "waiting";
      }
      setStep(projectId, name, { status: result === "skipped" ? "skipped" : "done", input_hash: after, progress: 1, finished_at: Date.now(), message: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStep(projectId, name, { status: "failed", error: msg, finished_at: Date.now() });
      updateProject(projectId, { status: "failed" });
      log(projectId, "error", msg, name);
      if (e instanceof Error && e.stack) console.error(e.stack);
      return "failed";
    }
  }
  updateProject(projectId, { status: "done", current_step: null });
  log(projectId, "info", "✔ All steps complete");
  return "done";
}
