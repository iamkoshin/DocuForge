import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { json, route } from "@/lib/api";
import { addToLibrary, deleteFromLibrary, listMusic, MUSIC_EXT } from "@/lib/music";

export const dynamic = "force-dynamic";

export const GET = route(async () => json({ tracks: listMusic() }));

/** multipart: add your own tracks to the music library. */
export const POST = route(async (req: Request) => {
  const form = await req.formData();
  const added: string[] = [];
  for (const f of form.getAll("files")) {
    if (!(f instanceof File) || !MUSIC_EXT.test(f.name)) continue;
    const tmp = path.join(os.tmpdir(), `narrative-${Date.now()}-${path.basename(f.name)}`);
    fs.writeFileSync(tmp, Buffer.from(await f.arrayBuffer()));
    try {
      added.push(addToLibrary(tmp, f.name));
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  if (!added.length) return json({ error: "No supported files. Allowed: mp3, wav, m4a, aac, ogg, flac" }, 400);
  return json({ added });
});

export const DELETE = route(async (req: Request) => {
  const name = new URL(req.url).searchParams.get("name");
  if (!name) return json({ error: "name is required" }, 400);
  deleteFromLibrary(name);
  return json({ ok: true });
});
