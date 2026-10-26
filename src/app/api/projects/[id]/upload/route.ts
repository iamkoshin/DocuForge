import fs from "node:fs";
import path from "node:path";
import { json, route, type Params } from "@/lib/api";
import { ensureDir, projectDir } from "@/lib/paths";
import { addToLibrary, libraryTrack, MUSIC_EXT } from "@/lib/music";
import { getProject } from "@/lib/projects";
import { cleanUploadName, saveMediaFile } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/**
 * Upload the creator's own images/clips (kind=media) or a music track (kind=music, or `library` = a saved track's name).
 * Images in other formats (HEIC, GIF, AVIF, TIFF, BMP…) are converted to JPG instead of being rejected.
 */
export const POST = route(async (req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  if (!getProject(id)) return json({ error: "Project not found" }, 404);
  const form = await req.formData();
  const kind = (form.get("kind") as "media" | "music") ?? "media";
  if (kind !== "media" && kind !== "music") return json({ error: "kind must be media or music" }, 400);
  const dir = ensureDir(projectDir(id, "uploads", kind));
  const fromLibrary = kind === "music" ? String(form.get("library") ?? "") : "";
  const libFile = fromLibrary ? libraryTrack(fromLibrary) : null;
  if (fromLibrary && !libFile) return json({ error: `“${fromLibrary}” is not in the music library` }, 404);
  if (kind === "music") for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f)); // one track only
  if (libFile) {
    fs.copyFileSync(libFile, path.join(dir, path.basename(libFile)));
    return json({ saved: [path.basename(libFile)] });
  }
  const saved: string[] = [];
  const converted: string[] = [];
  const skipped: string[] = [];
  for (const entry of form.getAll("files")) {
    if (!(entry instanceof File)) continue;
    if (kind === "music") {
      const name = cleanUploadName(entry.name);
      if (!MUSIC_EXT.test(name)) {
        skipped.push(name);
        continue;
      }
      fs.writeFileSync(path.join(dir, name), Buffer.from(await entry.arrayBuffer()));
      addToLibrary(path.join(dir, name), name); // keep it for later videos
      saved.push(name);
      continue;
    }
    const r = await saveMediaFile(dir, entry);
    if (!r) skipped.push(cleanUploadName(entry.name));
    else {
      saved.push(r.saved);
      if (r.convertedFrom) converted.push(`${r.convertedFrom} → ${r.saved}`);
    }
  }
  const allowed = kind === "media" ? "images in any common format (HEIC, GIF, AVIF, TIFF, BMP… are converted to JPG), mp4, mov, webm" : "mp3, wav, m4a, aac, ogg, flac";
  if (!saved.length) return json({ error: `${skipped.length ? `Couldn’t use ${skipped.join(", ")}. ` : ""}Supported: ${allowed}.` }, 400);
  return json({ saved, converted, skipped });
});

export const GET = route(async (_req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  const list = (k: string) => {
    const d = projectDir(id, "uploads", k);
    return fs.existsSync(d) ? fs.readdirSync(d) : [];
  };
  return json({ media: list("media"), music: list("music") });
});
