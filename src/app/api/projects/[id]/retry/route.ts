import { json, route, type Params } from "@/lib/api";
import { enqueue, getProject } from "@/lib/projects";
import { STEPS, type StepName } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Retry from a step (that step and everything after re-run; unchanged paid calls come from cache). No step = resume. */
export const POST = route(async (req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  if (!getProject(id)) return json({ error: "Project not found" }, 404);
  const { step } = (await req.json().catch(() => ({}))) as { step?: StepName };
  if (step && !STEPS.includes(step)) return json({ error: `Unknown step ${step}` }, 400);
  enqueue(id, step);
  return json({ ok: true });
});
