import fs from "node:fs";
import path from "node:path";
import { fileHash } from "@/lib/cache";
import { projectDir, readJson, writeJson } from "@/lib/paths";
import { getProject, log, setStep, type Project } from "@/lib/projects";
import { getSettings, type Settings } from "@/lib/settings";
import type { ProjectOptions, StepName } from "@/lib/schemas";

export interface StepCtx {
  id: string;
  step: StepName;
  project: Project;
  options: ProjectOptions;
  settings: Settings;
  model: string;
  dir: string;
  file: (...p: string[]) => string;
  read: <T>(name: string) => T | null;
  write: (name: string, data: unknown) => void;
  hash: (name: string) => string;
  info: (msg: string) => void;
  warn: (msg: string) => void;
  progress: (fraction: number, message?: string) => void;
}

export function makeCtx(id: string, step: StepName): StepCtx {
  const project = getProject(id);
  if (!project) throw new Error(`Project ${id} not found`);
  const settings = getSettings();
  const dir = projectDir(id);
  let lastProgress = 0;
  return {
    id,
    step,
    project,
    options: project.options,
    settings,
    model: project.options.model || settings.model,
    dir,
    file: (...p) => path.join(dir, ...p),
    read: <T>(name: string) => readJson<T>(path.join(dir, name)),
    write: (name, data) => writeJson(path.join(dir, name), data),
    hash: (name) => {
      const f = path.join(dir, name);
      if (!fs.existsSync(f)) return "missing";
      // Large media: size+mtime is enough to detect changes without reading the whole file.
      const st = fs.statSync(f);
      return st.size > 20_000_000 ? `${st.size}-${st.mtimeMs}` : fileHash(f);
    },
    info: (msg) => log(id, "info", msg, step),
    warn: (msg) => log(id, "warn", msg, step),
    progress: (fraction, message) => {
      const t = Date.now();
      if (t - lastProgress < 400 && fraction < 1) return; // throttle DB writes
      lastProgress = t;
      try {
        setStep(id, step, { progress: Math.max(0, Math.min(1, fraction)), ...(message ? { message } : {}) });
      } catch (e) {
        // A busy database must never fail a long render over a progress message; the next update catches up.
        console.warn(`[progress] ${id}/${step}: ${(e as Error).message}`);
      }
    },
  };
}

export type StepResult = "done" | "waiting" | "skipped";
export interface StepDef {
  name: StepName;
  /** Everything that, if changed, should make this step run again. */
  inputs: (ctx: StepCtx) => unknown;
  run: (ctx: StepCtx) => Promise<StepResult>;
}

export interface Approvals {
  script?: string; // script.json hash that was approved
  preview?: string; // preview input hash that was approved
}
export function readApprovals(ctx: StepCtx) {
  return ctx.read<Approvals>("approvals.json") ?? {};
}
