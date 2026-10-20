import fs from "node:fs";
import path from "node:path";
import { json, route, type Params } from "@/lib/api";
import { ensureDir, projectDir } from "@/lib/paths";
import { getProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

const ALLOWED = {
  media: /\.(jpe?g|png|webp|mp4|mov|webm)$/i,
  music: /\.(mp3|wav|m4a|aac|ogg|flac)$/i,
};

/** Upload the creator's own images/clips (kind=media) or a music track (kind=music). */
export const POST = route(async (req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  if (!getProject(id)) return json({ error: "Project not found" }, 404);
  const form = await req.formData();
  const kind = (form.get("kind") as "media" | "music") ?? "media";
  if (!(kind in ALLOWED)) return json({ error: "kind must be media or music" }, 400);
  const dir = ensureDir(projectDir(id, "uploads", kind));
  if (kind === "music") for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f)); // one track only
  const saved: string[] = [];
  for (const entry of form.getAll("files")) {
    if (!(entry instanceof File)) continue;
    const name = path.basename(entry.name).replace(/[^\w.\- ]+/g, "_");
    if (!ALLOWED[kind].test(name)) continue;
    fs.writeFileSync(path.join(dir, name), Buffer.from(await entry.arrayBuffer()));
    saved.push(name);
  }
  if (!saved.length) return json({ error: `No supported files. Allowed: ${kind === "media" ? "jpg, png, webp, mp4, mov, webm" : "mp3, wav, m4a, aac, ogg, flac"}` }, 400);
  return json({ saved });
});

export const GET = route(async (_req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  const list = (k: string) => {
    const d = projectDir(id, "uploads", k);
    return fs.existsSync(d) ? fs.readdirSync(d) : [];
  };
  return json({ media: list("media"), music: list("music") });
});
