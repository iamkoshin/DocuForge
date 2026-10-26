import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { json, route } from "@/lib/api";
import { addUploadedSfx, generateSfx, listSfx, STARTER_PACK } from "@/lib/sfx";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = route(async () => json({ sounds: listSfx(), starter: STARTER_PACK.map((s) => s.key) }));

/** multipart: upload your own sounds (files + tags + optional key). JSON: generate a new sound from a prompt. */
export const POST = route(async (req: Request) => {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const tags = String(form.get("tags") ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const key = String(form.get("key") ?? "");
    const rows = [];
    for (const f of form.getAll("files")) {
      if (!(f instanceof File)) continue;
      const tmp = path.join(os.tmpdir(), `narrative-${Date.now()}-${path.basename(f.name)}`);
      fs.writeFileSync(tmp, Buffer.from(await f.arrayBuffer()));
      try {
        rows.push(await addUploadedSfx({ srcFile: tmp, originalName: f.name, tags, key }));
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    }
    return json({ added: rows });
  }
  const { prompt, duration, key } = (await req.json()) as { prompt: string; duration?: number; key?: string };
  if (!prompt?.trim()) return json({ error: "Describe the sound you want" }, 400);
  const row = await generateSfx({ prompt: prompt.trim(), duration, key: key?.trim() || undefined });
  return json({ added: [row] });
});
