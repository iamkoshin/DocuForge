import { json, route, type Params } from "@/lib/api";
import { deleteSfx, updateSfxTags } from "@/lib/sfx";

export const dynamic = "force-dynamic";

export const PATCH = route(async (req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  const { tags } = (await req.json()) as { tags: string[] };
  updateSfxTags(id, tags);
  return json({ ok: true });
});

export const DELETE = route(async (_req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  deleteSfx(id);
  return json({ ok: true });
});
