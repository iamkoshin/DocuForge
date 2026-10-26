import { json, route, type Params } from "@/lib/api";
import type { VisualsResult } from "@/lib/schemas";
import { makeCtx } from "@/worker/context";
import { writeCredits } from "@/worker/steps/visuals";

export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  const ctx = makeCtx(id, "visuals");
  return json({ visuals: ctx.read("visuals.json"), contact: ctx.read("contact.json"), credits: ctx.read("credits.json"), script: ctx.read("script.json") });
});

/** Swap the image(s) used for a scene (any of its candidates), or with `node` the photo of one flow-diagram box. */
export const PUT = route(async (req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  const { sceneId, chosen, node } = (await req.json()) as { sceneId: string; chosen: string[]; node?: number };
  const ctx = makeCtx(id, "visuals");
  const v = ctx.read<VisualsResult>("visuals.json");
  if (!v) return json({ error: "No visuals yet" }, 400);
  const sv = v.scenes.find((s) => s.sceneId === sceneId);
  if (!sv) return json({ error: `Scene ${sceneId} not found` }, 404);
  if (node !== undefined) {
    const n = sv.nodes?.[node];
    if (!n) return json({ error: `Box ${node + 1} not found in ${sceneId}` }, 404);
    const pick = chosen[0] ?? null;
    if (pick && !n.candidates.includes(pick)) return json({ error: "That photo isn't a candidate for this box" }, 400);
    n.chosen = pick;
    ctx.write("visuals.json", v);
    writeCredits(ctx, v);
    return json({ visuals: v });
  }
  const bad = chosen.filter((c) => !v.candidates[c]);
  if (bad.length) return json({ error: `Unknown candidates: ${bad.join(", ")}` }, 400);
  sv.chosen = chosen;
  sv.missing = chosen.length === 0 && sv.missing;
  if (chosen.length) {
    sv.missing = false;
    if (sv.fallbackType) delete sv.fallbackType;
  }
  ctx.write("visuals.json", v);
  writeCredits(ctx, v);
  return json({ visuals: v });
});
