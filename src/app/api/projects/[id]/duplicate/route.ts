import { json, route, type Params } from "@/lib/api";
import { estimateProject } from "@/lib/cost";
import { createProject, enqueue, getProject } from "@/lib/projects";
import { ProjectOptionsSchema } from "@/lib/schemas";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Same settings (length, voice, theme, …) with a new topic. */
export const POST = route(async (req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  const p = getProject(id);
  if (!p) return json({ error: "Project not found" }, 404);
  const { topic, angle } = (await req.json()) as { topic: string; angle?: string };
  const options = ProjectOptionsSchema.parse({ ...p.options, topic, angle: angle ?? "", sourceUrls: [], ownScript: "" });
  const est = estimateProject(options, getSettings());
  const newId = createProject(options, est.usd);
  enqueue(newId);
  return json({ id: newId });
});
