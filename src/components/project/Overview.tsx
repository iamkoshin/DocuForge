"use client";

import { useEffect, useRef, useState } from "react";
import { api, Button, fmtUsd, Panel } from "../ui";
import { STEP_LABELS, type LogRow, type Snapshot, type StepRow } from "./types";

export function StepDetail({ step, projectId, busy }: { step: StepRow; projectId: string; busy: boolean }) {
  const [sending, setSending] = useState(false);
  const retry = async () => {
    setSending(true);
    await api(`/api/projects/${projectId}/retry`, { method: "POST", json: { step: step.step } }).finally(() => setSending(false));
  };
  return (
    <Panel className={`p-4 flex flex-wrap items-start gap-3 ${step.status === "failed" ? "border-bad/40" : ""}`}>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{STEP_LABELS[step.step]}</p>
        {step.status === "failed" ? (
          <p className="text-sm text-bad mt-1 whitespace-pre-wrap break-words">{step.error}</p>
        ) : (
          <p className="text-sm text-sub mt-1">{step.message ?? (step.status === "pending" ? "Not started yet." : step.status === "done" ? "Finished." : step.status === "waiting" ? "Waiting for you." : "")}</p>
        )}
      </div>
      {step.status !== "pending" && step.status !== "running" && (
        <Button size="sm" variant={step.status === "failed" ? "primary" : "secondary"} busy={sending} disabled={busy && step.status !== "failed"} onClick={retry}>
          Retry from this step
        </Button>
      )}
    </Panel>
  );
}

export function Overview({ snap, logs }: { snap: Snapshot; logs: LogRow[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [logs, follow]);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px] items-start">
      <Panel>
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <h3 className="font-semibold text-sm">Activity</h3>
          <label className="text-xs text-sub flex items-center gap-1.5">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-cobalt" /> Follow
          </label>
        </div>
        <div ref={box} className="h-[420px] overflow-y-auto px-4 py-2 text-[13px] leading-relaxed font-[ui-monospace,monospace]">
          {logs.length === 0 && <p className="text-sub py-2">Waiting for the worker. If nothing appears, check that “npm run dev” started both web and worker.</p>}
          {logs.map((l) => (
            <div key={l.id} className={`flex gap-3 ${l.level === "error" ? "text-bad" : l.level === "warn" ? "text-warn" : ""}`}>
              <span className="text-sub shrink-0 tabular">{new Date(l.ts).toLocaleTimeString()}</span>
              <span className="text-sub shrink-0 w-16 truncate">{l.step ?? ""}</span>
              <span className="break-words min-w-0">{l.message}</span>
            </div>
          ))}
        </div>
      </Panel>
      <Panel className="p-4">
        <h3 className="font-semibold text-sm mb-3">Cost so far</h3>
        <p className="font-serif text-3xl tabular">{fmtUsd(snap.costUsd)}</p>
        <p className="text-xs text-sub mb-3">Estimated {fmtUsd(snap.project.estimate_usd)} before starting</p>
        <ul className="text-sm divide-y divide-line">
          {snap.costs.map((c) => (
            <li key={c.provider + c.unit_type} className="flex justify-between py-1.5 gap-3">
              <span>
                {c.provider === "anthropic" ? "Claude" : c.provider === "elevenlabs" ? "ElevenLabs" : c.provider}
                <span className="block text-xs text-sub tabular">
                  {Math.round(c.units).toLocaleString()} {c.unit_type}
                </span>
              </span>
              <span className="tabular">{fmtUsd(c.usd)}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
