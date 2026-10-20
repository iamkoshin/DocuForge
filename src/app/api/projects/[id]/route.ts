import fs from "node:fs";
import { json, route, type Params } from "@/lib/api";
import { projectDir } from "@/lib/paths";
import { deleteProject, isProjectBusy, snapshot } from "@/lib/projects";

export const dynamic = "force-dynamic";

const OUTPUTS = ["video.mp4", "captions.srt", "thumbnail.png", "youtube.md", "research.json", "script.json", "credits.json"];

export const GET = route(async (_req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  const snap = snapshot(id);
  if (!snap) return json({ error: "Project not found" }, 404);
  const files = fs.existsSync(projectDir(id)) ? fs.readdirSync(projectDir(id)) : [];
  return json({ ...snap, files, outputs: OUTPUTS.filter((f) => files.includes(f)) });
});

export const DELETE = route(async (_req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  if (isProjectBusy(id)) return json({ error: "This project is still running. Wait for it to finish or fail before deleting it." }, 409);
  deleteProject(id);
  return json({ ok: true });
});
