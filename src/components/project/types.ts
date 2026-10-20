import type { ProjectOptions, StepName } from "@/lib/schemas";

export interface StepRow {
  step: StepName;
  status: "pending" | "running" | "done" | "failed" | "waiting" | "skipped";
  progress: number;
  message: string | null;
  error: string | null;
  started_at: number | null;
  finished_at: number | null;
}
export interface Snapshot {
  project: {
    id: string;
    title: string;
    topic: string;
    status: string;
    current_step: string | null;
    duration_sec: number | null;
    estimate_usd: number | null;
    created_at: number;
    options: ProjectOptions;
  };
  steps: StepRow[];
  costUsd: number;
  costs: { provider: string; unit_type: string; units: number; usd: number }[];
  busy: boolean;
}
export interface LogRow {
  id: number;
  ts: number;
  level: string;
  step: string | null;
  message: string;
}

export const STEP_LABELS: Record<StepName, string> = {
  research: "Research",
  script: "Script",
  review: "Approval",
  voice: "Voice",
  music: "Music",
  sfx: "Sound effects",
  visuals: "Visuals",
  preview: "QA stills",
  render: "Render",
  outputs: "Outputs",
};
