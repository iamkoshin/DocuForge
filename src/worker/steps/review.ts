import { readApprovals, type StepDef } from "../context";

/** Gate: pauses the pipeline until the script is approved in the UI (when "Pause for script approval" is on). */
export const reviewStep: StepDef = {
  name: "review",
  inputs: (ctx) => ({ pause: ctx.options.pauseForApproval, approved: Boolean(readApprovals(ctx).script) }),
  async run(ctx) {
    if (!ctx.options.pauseForApproval) return "skipped";
    if (readApprovals(ctx).script) {
      ctx.info("Script approved");
      return "done";
    }
    ctx.info("Waiting for script approval — review and edit the scenes, then click “Approve & continue”.");
    return "waiting";
  },
};
