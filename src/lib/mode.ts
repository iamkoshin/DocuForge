import type { ProjectOptions } from "./schemas";
import { hasKey } from "./settings";

/** May this project call the Claude API? Never in "Claude app" mode, even if a key is configured. */
export function usesClaudeApi(o: Pick<ProjectOptions, "scriptSource">) {
  return o.scriptSource !== "app" && hasKey("ANTHROPIC_API_KEY");
}
