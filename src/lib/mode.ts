import type { ProjectOptions } from "./schemas";
import { getSettings, hasKey } from "./settings";

/** May this project call the Claude API? Never in "Claude app" mode, even if a key is configured. */
export function usesClaudeApi(o: Pick<ProjectOptions, "scriptSource">) {
  return o.scriptSource !== "app" && hasKey("ANTHROPIC_API_KEY");
}

/** Who looks at images for this project (photo checks, matching uploads). See Settings.photoCheck. */
export function visionProvider(o: Pick<ProjectOptions, "scriptSource">): "claude" | "gemini" | "captions" {
  const pref = getSettings().photoCheck;
  if (pref === "captions") return "captions";
  if (pref === "auto" && usesClaudeApi(o)) return "claude";
  return hasKey("GEMINI_API_KEY") ? "gemini" : usesClaudeApi(o) ? "claude" : "captions";
}
