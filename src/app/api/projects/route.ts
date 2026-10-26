import { json, route } from "@/lib/api";
import { estimateProject, minutesForWords } from "@/lib/cost";
import { visionProvider } from "@/lib/mode";
import { ownScriptMinutes, ownScriptWords, splitOwnScript } from "@/lib/ownScript";
import { createProject, enqueue, listProjects } from "@/lib/projects";
import { ProjectOptionsSchema } from "@/lib/schemas";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const GET = route(async () => json(listProjects()));

export const POST = route(async (req: Request) => {
  const body = (await req.json()) as { options: unknown; confirm?: boolean };
  const options = ProjectOptionsSchema.parse(body.options);
  if (options.ownScript.trim()) {
    if (!splitOwnScript(options.ownScript).scenes.length) return json({ error: "Your script is empty." }, 400);
    if (minutesForWords(ownScriptWords(options.ownScript), options.language) > 20) return json({ error: "Your script is longer than 20 minutes of narration. Split it into several videos." }, 400);
    options.minutes = ownScriptMinutes(options.ownScript, options.language); // the length is whatever the script is
  }
  const settings = getSettings();
  const est = estimateProject({ ...options, vision: visionProvider(options) }, settings);
  if (est.usd > settings.costThresholdUsd && !body.confirm) {
    return json({ needsConfirm: true, estimate: est, threshold: settings.costThresholdUsd }, 409);
  }
  const id = createProject(options, est.usd);
  enqueue(id);
  return json({ id });
});
