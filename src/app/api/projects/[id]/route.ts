import fs from "node:fs";
import { json, route, type Params } from "@/lib/api";
import { projectDir } from "@/lib/paths";
import { deleteProject, getProject, isProjectBusy, snapshot, updateProject } from "@/lib/projects";
import { ProjectOptionsSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

const OUTPUTS = ["video.mp4", "captions.srt", "thumbnail.png", "youtube.md", "research.json", "script.json", "credits.json"];

export const GET = route(async (_req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  const snap = snapshot(id);
  if (!snap) return json({ error: "Project not found" }, 404);
  const files = fs.existsSync(projectDir(id)) ? fs.readdirSync(projectDir(id)) : [];
  return json({ ...snap, files, outputs: OUTPUTS.filter((f) => files.includes(f)) });
});

/** Change settings that only affect the final mix (currently the music volume). Retry Render to apply. */
export const PATCH = route(async (req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  const p = getProject(id);
  if (!p) return json({ error: "Project not found" }, 404);
  const { musicVolume } = ProjectOptionsSchema.pick({ musicVolume: true }).parse(await req.json());
  updateProject(id, { options: JSON.stringify({ ...p.options, musicVolume }) });
  return json({ ok: true });
});

export const DELETE = route(async (_req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  if (isProjectBusy(id)) return json({ error: "This project is still running. Wait for it to finish or fail before deleting it." }, 409);
  deleteProject(id);
  return json({ ok: true });
});
