"use client";

import { STEP_LABELS, type StepRow } from "./types";

const DOT: Record<StepRow["status"], string> = {
  pending: "bg-white/20",
  running: "bg-[#8fa6ff] animate-pulse",
  done: "bg-[#7fd39f]",
  skipped: "bg-white/35",
  waiting: "bg-[#f1c26b]",
  failed: "bg-[#ff8a80]",
};
const WORD: Record<StepRow["status"], string> = {
  pending: "",
  running: "Working",
  done: "Done",
  skipped: "Skipped",
  waiting: "Your turn",
  failed: "Failed",
};

/** The pipeline as a strip of film frames; each frame is a step. */
export function Tracker({ steps, onSelect, selected }: { steps: StepRow[]; onSelect: (s: StepRow) => void; selected?: string | null }) {
  return (
    <div className="rounded-md bg-film text-white overflow-x-auto">
      <div className="sprockets mx-2 mt-1.5" />
      <ol className="flex min-w-max gap-[3px] px-2 py-1">
        {steps.map((s) => (
          <li key={s.step}>
            <button
              onClick={() => onSelect(s)}
              className={`relative w-[104px] h-[64px] rounded-[3px] px-2.5 py-2 text-left flex flex-col justify-between transition-colors ${
                selected === s.step ? "bg-white/20" : s.status === "pending" ? "bg-white/[0.04] hover:bg-white/10" : "bg-white/10 hover:bg-white/15"
              }`}
              aria-label={`${STEP_LABELS[s.step]}: ${WORD[s.status] || "not started"}`}
            >
              <span className={`text-[13px] font-medium leading-tight ${s.status === "pending" ? "text-white/45" : ""}`}>{STEP_LABELS[s.step]}</span>
              <span className="flex items-center gap-1.5 text-[11px] text-white/70">
                <span className={`size-2 rounded-full ${DOT[s.status]}`} />
                {s.status === "running" && s.progress > 0 ? `${Math.round(s.progress * 100)}%` : WORD[s.status]}
              </span>
              {s.status === "running" && <span className="absolute left-0 bottom-0 h-[2px] bg-[#8fa6ff]" style={{ width: `${Math.max(4, s.progress * 100)}%` }} />}
            </button>
          </li>
        ))}
      </ol>
      <div className="sprockets mx-2 mb-1.5" />
    </div>
  );
}
