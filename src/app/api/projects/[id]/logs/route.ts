import { json, route, type Params } from "@/lib/api";
import { getLogs } from "@/lib/projects";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  const after = Number(new URL(req.url).searchParams.get("after") ?? 0);
  return json(getLogs(id, after, 1000));
});
