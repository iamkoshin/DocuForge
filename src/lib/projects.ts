import fs from "node:fs";
import crypto from "node:crypto";
import { db, now } from "./db";
import { ensureDir, projectDir } from "./paths";
import { STEPS, type ProjectOptions, type StepName } from "./schemas";

export interface ProjectRow {
  id: string;
  title: string;
  topic: string;
  options: string;
  status: string;
  current_step: string | null;
  duration_sec: number | null;
  thumbnail: string | null;
  estimate_usd: number | null;
  created_at: number;
  updated_at: number;
}
export interface StepRow {
  project_id: string;
  step: StepName;
  status: "pending" | "running" | "done" | "failed" | "waiting" | "skipped";
  input_hash: string | null;
  progress: number;
  message: string | null;
  error: string | null;
  started_at: number | null;
  finished_at: number | null;
}

export function newId() {
  return crypto.randomBytes(5).toString("hex");
}

export function createProject(options: ProjectOptions, estimateUsd: number) {
  const id = newId();
  const t = now();
  ensureDir(projectDir(id));
  db()
    .prepare(
      "INSERT INTO projects (id, title, topic, options, status, created_at, updated_at, estimate_usd) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)",
    )
    .run(id, options.topic, options.topic, JSON.stringify(options), t, t, estimateUsd);
  const ins = db().prepare("INSERT INTO steps (project_id, step, status) VALUES (?, ?, 'pending')");
  for (const s of STEPS) ins.run(id, s);
  return id;
}

export function getProject(id: string) {
  const row = db().prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  if (!row) return null;
  return { ...row, options: { ownScript: "", musicVolume: 0, ...JSON.parse(row.options) } as ProjectOptions }; // older projects predate ownScript and musicVolume
}
export type Project = NonNullable<ReturnType<typeof getProject>>;

export function listProjects() {
  const rows = db().prepare("SELECT * FROM projects ORDER BY created_at DESC").all() as ProjectRow[];
  return rows.map((r) => ({ ...r, options: { ownScript: "", musicVolume: 0, ...JSON.parse(r.options) } as ProjectOptions, costUsd: projectCost(r.id) }));
}

export function updateProject(id: string, patch: Partial<Omit<ProjectRow, "id">>) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const sql = `UPDATE projects SET ${keys.map((k) => `${k} = @${k}`).join(", ")}, updated_at = @updated_at WHERE id = @id`;
  db().prepare(sql).run({ ...patch, id, updated_at: now() });
}

export function deleteProject(id: string) {
  const d = db();
  d.transaction(() => {
    for (const t of ["steps", "jobs", "logs", "costs"]) d.prepare(`DELETE FROM ${t} WHERE project_id = ?`).run(id);
    d.prepare("DELETE FROM projects WHERE id = ?").run(id);
  })();
  fs.rmSync(projectDir(id), { recursive: true, force: true });
}

export function getSteps(id: string) {
  const rows = db().prepare("SELECT * FROM steps WHERE project_id = ?").all(id) as StepRow[];
  return STEPS.map((s) => rows.find((r) => r.step === s)!).filter(Boolean);
}
export function getStep(id: string, step: StepName) {
  return db().prepare("SELECT * FROM steps WHERE project_id = ? AND step = ?").get(id, step) as StepRow | undefined;
}
export function setStep(id: string, step: StepName, patch: Partial<Omit<StepRow, "project_id" | "step">>) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  db()
    .prepare(`UPDATE steps SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE project_id = @pid AND step = @step`)
    .run({ ...patch, pid: id, step });
  db().prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now(), id);
}

/** Mark `from` and every later step as pending so the next job re-runs them (paid calls stay cached by input hash). */
export function resetFrom(id: string, from: StepName) {
  const idx = STEPS.indexOf(from);
  for (const s of STEPS.slice(idx)) {
    setStep(id, s, { status: "pending", progress: 0, error: null, message: null, input_hash: null });
  }
}

export function enqueue(id: string, fromStep?: StepName) {
  // Drop any queued (not yet started) jobs for this project; the new one supersedes them.
  db().prepare("UPDATE jobs SET status = 'cancelled' WHERE project_id = ? AND status = 'queued'").run(id);
  if (fromStep) resetFrom(id, fromStep);
  db().prepare("INSERT INTO jobs (project_id, from_step, status, created_at) VALUES (?, ?, 'queued', ?)").run(id, fromStep ?? null, now());
  updateProject(id, { status: "queued" });
}

export function isProjectBusy(id: string) {
  const r = db().prepare("SELECT COUNT(*) n FROM jobs WHERE project_id = ? AND status IN ('queued','running')").get(id) as { n: number };
  return r.n > 0;
}

export function log(projectId: string, level: "info" | "warn" | "error", message: string, step?: string) {
  db().prepare("INSERT INTO logs (project_id, ts, level, step, message) VALUES (?, ?, ?, ?, ?)").run(projectId, now(), level, step ?? null, message);
  const prefix = `[${projectId}${step ? "/" + step : ""}]`;
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(prefix, message);
}

export function getLogs(projectId: string, afterId = 0, limit = 300) {
  return db()
    .prepare("SELECT * FROM (SELECT * FROM logs WHERE project_id = ? AND id > ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC")
    .all(projectId, afterId, limit) as { id: number; ts: number; level: string; step: string | null; message: string }[];
}

export function addCost(c: { projectId?: string | null; step?: string | null; provider: string; units: number; unitType: string; usd: number; note?: string }) {
  db()
    .prepare("INSERT INTO costs (project_id, step, provider, units, unit_type, usd, note, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(c.projectId ?? null, c.step ?? null, c.provider, c.units, c.unitType, c.usd, c.note ?? null, now());
}

export function projectCost(projectId: string) {
  const r = db().prepare("SELECT COALESCE(SUM(usd),0) usd FROM costs WHERE project_id = ?").get(projectId) as { usd: number };
  return r.usd;
}

export function costBreakdown(projectId: string) {
  return db()
    .prepare("SELECT provider, unit_type, SUM(units) units, SUM(usd) usd FROM costs WHERE project_id = ? GROUP BY provider, unit_type ORDER BY usd DESC")
    .all(projectId) as { provider: string; unit_type: string; units: number; usd: number }[];
}

/** Everything the project page needs for live updates. */
export function snapshot(id: string) {
  const project = getProject(id);
  if (!project) return null;
  return {
    project,
    steps: getSteps(id),
    costUsd: projectCost(id),
    costs: costBreakdown(id),
    busy: isProjectBusy(id),
  };
}
