import { json, route } from "@/lib/api";
import { estimateProject } from "@/lib/cost";
import { getSettings } from "@/lib/settings";
import { STARTER_PACK } from "@/lib/sfx";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const o = await req.json();
  const settings = getSettings();
  // First video also seeds the starter SFX pack.
  const haveStarter = (db().prepare("SELECT COUNT(DISTINCT key) n FROM sfx WHERE source = 'starter'").get() as { n: number }).n;
  const newSfx = (STARTER_PACK.length - haveStarter) + 4;
  const est = estimateProject({ minutes: Number(o.minutes) || 1, sfxLevel: o.sfxLevel ?? "normal", musicMood: o.musicMood ?? "", model: o.model, scriptSource: o.scriptSource }, settings, o.sfxLevel === "off" ? 0 : newSfx);
  return json({ ...est, threshold: settings.costThresholdUsd });
});
