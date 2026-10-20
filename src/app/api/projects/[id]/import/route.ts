import { json, route, type Params } from "@/lib/api";
import { enqueue, getProject, log } from "@/lib/projects";
import { makeCtx } from "@/worker/context";
import { buildAppPrompt, parseAppReply, type AppImport } from "@/worker/steps/appImport";

export const dynamic = "force-dynamic";

/** Claude-app mode: the prompt to copy into the Claude app, and whether a reply was already imported. */
export const GET = route(async (_req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  const p = getProject(id);
  if (!p) return json({ error: "Project not found" }, 404);
  const imp = makeCtx(id, "research").read<AppImport>("import.json");
  return json({ prompt: buildAppPrompt(p.options), importedAt: imp?.importedAt ?? null });
});

/** Paste the Claude app's reply. Validated here; on success the pipeline continues from Research. */
export const POST = route(async (req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  const p = getProject(id);
  if (!p) return json({ error: "Project not found" }, 404);
  const { text } = (await req.json()) as { text: string };
  if (!text?.trim()) return json({ ok: false, errors: ["Paste Claude's reply first."] }, 400);
  const result = parseAppReply(text, p.options);
  if (!result.ok) return json(result, 422);
  makeCtx(id, "research").write("import.json", result.data);
  log(id, "info", `Imported reply from the Claude app: ${result.summary}`, "research");
  enqueue(id);
  return json({ ok: true, summary: result.summary });
});
