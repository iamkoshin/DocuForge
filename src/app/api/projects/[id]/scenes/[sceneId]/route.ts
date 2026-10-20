import { json, route, type Params } from "@/lib/api";
import { getProject } from "@/lib/projects";
import { makeCtx } from "@/worker/context";
import { rewriteScene } from "@/worker/steps/script";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** "Regenerate this scene" / "Make it shorter" / "Make it longer" from the review screen. */
export const POST = route(async (req: Request, { params }: Params<{ id: string; sceneId: string }>) => {
  const { id, sceneId } = await params;
  if (!getProject(id)) return json({ error: "Project not found" }, 404);
  const { mode, note } = (await req.json()) as { mode: "regenerate" | "shorter" | "longer"; note?: string };
  const ctx = makeCtx(id, "review");
  const script = await rewriteScene(ctx, sceneId, mode, note);
  ctx.write("script.json", script);
  return json({ script });
});
