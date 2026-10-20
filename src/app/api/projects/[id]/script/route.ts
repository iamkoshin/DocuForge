import { json, route, type Params } from "@/lib/api";
import { getProject } from "@/lib/projects";
import { ScriptSchema, type Research } from "@/lib/schemas";
import { makeCtx } from "@/worker/context";
import { sanitizeScript } from "@/worker/steps/script";

export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  const ctx = makeCtx(id, "review");
  return json({ script: ctx.read("script.json"), research: ctx.read("research.json"), voice: ctx.read("voice.json") });
});

/** Save edits from the review table (validated; scene data checked the same way as generated scripts). */
export const PUT = route(async (req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return json({ error: "Project not found" }, 404);
  const ctx = makeCtx(id, "review");
  const research = ctx.read<Research>("research.json");
  if (!research) return json({ error: "Research is missing" }, 400);
  const body = await req.json();
  const warnings: string[] = [];
  const script = sanitizeScript(ScriptSchema.parse(body.script), research, project.options, (m) => warnings.push(m));
  ctx.write("script.json", script);
  return json({ script, warnings });
});
