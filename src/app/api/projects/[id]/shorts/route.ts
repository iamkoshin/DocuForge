import fs from "node:fs";
import { json, route, type Params } from "@/lib/api";
import { projectDir, readJson, writeJson } from "@/lib/paths";
import { enqueue, getProject, isProjectBusy } from "@/lib/projects";
import type { ShortsResult } from "@/worker/steps/shorts";

export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  if (!getProject(id)) return json({ error: "Project not found" }, 404);
  return json({ shorts: readJson<ShortsResult>(projectDir(id, "shorts.json"))?.shorts ?? [] });
});

/** Make (or remake) 3 highlight shorts from the finished video. */
export const POST = route(async (_req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  if (!getProject(id)) return json({ error: "Project not found" }, 404);
  if (!fs.existsSync(projectDir(id, "video.mp4"))) return json({ error: "Render the video first, then make shorts." }, 400);
  if (isProjectBusy(id)) return json({ error: "This project is still working. Try again when it’s finished." }, 409);
  writeJson(projectDir(id, "shorts-request.json"), { at: Date.now() });
  enqueue(id, "shorts");
  return json({ ok: true });
});
