import { json, route, type Params } from "@/lib/api";
import { enqueue, getProject } from "@/lib/projects";
import { makeCtx, readApprovals } from "@/worker/context";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  if (!getProject(id)) return json({ error: "Project not found" }, 404);
  const { stage } = (await req.json()) as { stage: "script" | "preview" };
  const ctx = makeCtx(id, stage === "script" ? "review" : "preview");
  const approvals = readApprovals(ctx);
  if (stage === "script") approvals.script = ctx.hash("script.json");
  else approvals.preview = ctx.hash("project.json");
  ctx.write("approvals.json", approvals);
  enqueue(id);
  return json({ ok: true });
});
