import { json, route, type Params } from "@/lib/api";
import { ensureDir } from "@/lib/paths";
import { getProject } from "@/lib/projects";
import type { VisualsResult } from "@/lib/schemas";
import { saveMediaFile } from "@/lib/uploads";
import { makeCtx } from "@/worker/context";
import { uploadCandidate, writeCredits } from "@/worker/steps/visuals";

export const dynamic = "force-dynamic";

/** Upload your own photo for one flow-diagram box (multipart: sceneId, node = box index from 0, file). It is used right away. */
export const POST = route(async (req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  if (!getProject(id)) return json({ error: "Project not found" }, 404);
  const form = await req.formData();
  const sceneId = String(form.get("sceneId") ?? "");
  const node = Number(form.get("node"));
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "Choose a photo to upload" }, 400);

  const ctx = makeCtx(id, "visuals");
  const v = ctx.read<VisualsResult>("visuals.json");
  const box = v?.scenes.find((s) => s.sceneId === sceneId)?.nodes?.[node];
  if (!v || !box) return json({ error: "That diagram box wasn't found. Run Visuals first." }, 404);

  const saved = await saveMediaFile(ensureDir(ctx.file("uploads", "media")), file);
  if (!saved) return json({ error: `Couldn’t use ${file.name}. Upload an image (any common format) or an mp4, mov or webm clip.` }, 400);
  const c = await uploadCandidate(ctx, saved.saved);
  if (!c) return json({ error: `Couldn’t read ${saved.saved} as an image.` }, 400);

  v.candidates[c.id] = c;
  box.candidates = [c.id, ...box.candidates.filter((x) => x !== c.id)];
  box.chosen = c.id;
  ctx.write("visuals.json", v);
  writeCredits(ctx, v);
  return json({ visuals: v, converted: saved.convertedFrom ? `${saved.convertedFrom} → ${saved.saved}` : null });
});
