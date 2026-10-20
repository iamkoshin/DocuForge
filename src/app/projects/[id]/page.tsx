"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ContactSheet } from "@/components/project/ContactSheet";
import { ImportPanel } from "@/components/project/ImportPanel";
import { Overview, StepDetail } from "@/components/project/Overview";
import { ResearchView } from "@/components/project/ResearchView";
import { Review } from "@/components/project/Review";
import { Tracker } from "@/components/project/Tracker";
import type { LogRow, Snapshot, StepRow } from "@/components/project/types";
import { VideoPanel } from "@/components/project/VideoPanel";
import { VisualsPicker } from "@/components/project/VisualsPicker";
import { api, Button, fmtDuration, fmtUsd, Panel, StatusChip } from "@/components/ui";

type Tab = "overview" | "research" | "script" | "visuals" | "contact" | "video";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Progress" },
  { id: "research", label: "Research" },
  { id: "script", label: "Script" },
  { id: "visuals", label: "Images" },
  { id: "contact", label: "QA stills" },
  { id: "video", label: "Video & downloads" },
];

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [outputs, setOutputs] = useState<string[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [tab, setTab] = useState<Tab | null>(null);
  const [selected, setSelected] = useState<StepRow | null>(null);
  const [focusScene, setFocusScene] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const lastStatus = useRef<string>("");

  // Live updates over server-sent events; falls back to polling if the stream can't be used.
  useEffect(() => {
    let poll: ReturnType<typeof setInterval> | null = null;
    let lastLog = 0;
    const es = new EventSource(`/api/projects/${id}/events`);
    es.addEventListener("snapshot", (e) => setSnap(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("logs", (e) => {
      const rows: LogRow[] = JSON.parse((e as MessageEvent).data);
      lastLog = rows[rows.length - 1]?.id ?? lastLog;
      setLogs((l) => [...l, ...rows].slice(-1500));
    });
    es.onerror = () => {
      if (es.readyState !== EventSource.CLOSED || poll) return;
      poll = setInterval(async () => {
        const d = await api<Snapshot>(`/api/projects/${id}`).catch(() => null);
        if (d) setSnap(d);
        const rows = await api<LogRow[]>(`/api/projects/${id}/logs?after=${lastLog}`).catch(() => []);
        if (rows.length) {
          lastLog = rows[rows.length - 1].id;
          setLogs((l) => [...l, ...rows].slice(-1500));
        }
      }, 2000);
    };
    return () => {
      es.close();
      if (poll) clearInterval(poll);
    };
  }, [id]);

  // First paint from a plain request (doesn't wait for the stream); output list refreshes whenever a step finishes.
  const stepsKey = snap?.steps.map((s) => s.status).join(",") ?? "";
  useEffect(() => {
    api<Snapshot & { outputs: string[] }>(`/api/projects/${id}`).then(
      (d) => {
        setOutputs(d.outputs);
        setSnap((cur) => cur ?? d);
      },
      (e) => e.status === 404 && setNotFound(true),
    );
  }, [id, stepsKey]);

  // Pick a sensible tab when the pipeline needs the user or finishes.
  useEffect(() => {
    if (!snap) return;
    const key = `${snap.project.status}:${snap.project.current_step}`;
    if (key === lastStatus.current) return;
    const first = !lastStatus.current;
    lastStatus.current = key;
    const st = snap.project.status;
    const cur = snap.project.current_step;
    if (st === "waiting" && cur === "review") setTab("script");
    else if (st === "waiting" && cur === "preview") setTab("contact");
    else if (st === "done") setTab((t) => (first || t === "overview" ? "video" : t));
    else if (first) setTab("overview");
  }, [snap]);

  const version = useMemo(() => snap?.steps.filter((s) => s.status === "done").length ?? 0, [snap]);
  if (notFound) return <p className="text-sub">This project doesn’t exist. It may have been deleted.</p>;
  if (!snap) return <p className="text-sub text-sm">Loading project…</p>;

  const p = snap.project;
  const failed = snap.steps.find((s) => s.status === "failed");
  const step = (name: string) => snap.steps.find((s) => s.step === name);
  const waitingReview = p.status === "waiting" && p.current_step === "review";
  const waitingPreview = p.status === "waiting" && p.current_step === "preview";
  const appMode = p.options.scriptSource === "app";
  const researchStatus = step("research")?.status;
  const needsPaste = appMode && (researchStatus === "waiting" || researchStatus === "failed");
  const del = async () => {
    if (!confirm("Delete this project and all its files?")) return;
    await api(`/api/projects/${id}`, { method: "DELETE" }).then(() => router.push("/"), (e) => alert(e.message));
  };

  return (
    <div className="max-w-6xl flex flex-col gap-5">
      <header className="flex flex-wrap items-start gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-3xl font-semibold tracking-tight leading-tight">{p.title}</h1>
          <p className="text-sm text-sub mt-1 tabular">
            {p.title !== p.topic && <>{p.topic} · </>}
            {p.duration_sec ? fmtDuration(p.duration_sec) : `${p.options.minutes} min target`} · {p.options.format} · {p.options.voiceName || "voice"} · {fmtUsd(snap.costUsd)} spent
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusChip status={p.status} />
          <Button size="sm" variant="ghost" onClick={del} disabled={snap.busy}>
            Delete
          </Button>
        </div>
      </header>

      <Tracker steps={snap.steps} selected={selected?.step} onSelect={(s) => setSelected((cur) => (cur?.step === s.step ? null : s))} />

      {failed && !selected && <StepDetail step={failed} projectId={id} busy={snap.busy} />}
      {selected && <StepDetail step={snap.steps.find((s) => s.step === selected.step) ?? selected} projectId={id} busy={snap.busy} />}

      {needsPaste && <ImportPanel projectId={id} />}

      {waitingReview && (
        <Panel className="p-4 border-warn/40 bg-warn-soft/40">
          <p className="text-sm">
            <span className="font-medium">The script is ready for review.</span> Edit anything, then click “Approve &amp; continue” to start the voiceover.
          </p>
        </Panel>
      )}
      {waitingPreview && (
        <Panel className="p-4 border-warn/40 bg-warn-soft/40">
          <p className="text-sm">
            <span className="font-medium">QA stills are ready.</span> Check each frame, swap any image, then click “Render video”.
          </p>
        </Panel>
      )}
      {p.status === "running" && step(p.current_step ?? "")?.message && <p className="text-sm text-cobalt">{step(p.current_step ?? "")?.message}</p>}

      <nav className="flex gap-1 border-b border-line overflow-x-auto" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${tab === t.id ? "border-ink text-ink font-medium" : "border-transparent text-sub hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div>
        {tab === "overview" && (
          <div className="flex flex-col gap-6">
            <Overview snap={snap} logs={logs} />
            <Uploads projectId={id} />
          </div>
        )}
        {tab === "research" && (
          <div className="flex flex-col gap-6">
            <ResearchView projectId={id} />
            {appMode && !needsPaste && (
              <details className="group">
                <summary className="cursor-pointer text-sm text-cobalt">Paste a new reply from the Claude app</summary>
                <div className="mt-3">
                  <p className="text-sm text-sub mb-3">Importing a new reply replaces the research and script, and redoes the steps after them. Script edits you made here are lost.</p>
                  <ImportPanel projectId={id} replacing />
                </div>
              </details>
            )}
          </div>
        )}
        {tab === "script" && <Review key={version} projectId={id} canApprove={waitingReview} targetMinutes={p.options.minutes} aiEdits={!appMode} />}
        {tab === "visuals" && <VisualsPicker projectId={id} focusScene={focusScene} busy={snap.busy} />}
        {tab === "contact" && (
          <ContactSheet
            projectId={id}
            canApprove={waitingPreview}
            version={version}
            onSwap={(sceneId) => {
              setFocusScene(sceneId);
              setTab("visuals");
            }}
          />
        )}
        {tab === "video" && <VideoPanel projectId={id} outputs={outputs} vertical={p.options.format === "9:16"} busy={snap.busy} version={version} />}
      </div>
    </div>
  );
}

function Uploads({ projectId }: { projectId: string }) {
  const [list, setList] = useState<{ media: string[]; music: string[] }>({ media: [], music: [] });
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => api<typeof list>(`/api/projects/${projectId}/upload`).then(setList);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  const send = async (kind: "media" | "music", files: FileList | null) => {
    if (!files?.length) return;
    const fd = new FormData();
    fd.set("kind", kind);
    [...files].forEach((f) => fd.append("files", f));
    const r = await fetch(`/api/projects/${projectId}/upload`, { method: "POST", body: fd });
    const d = await r.json();
    setMsg(r.ok ? `Uploaded ${d.saved.length} file(s). Retry ${kind === "media" ? "Visuals" : "Music"} to use ${d.saved.length > 1 ? "them" : "it"}.` : d.error);
    load();
  };
  return (
    <Panel className="p-4 grid gap-4 sm:grid-cols-2">
      <div>
        <h3 className="font-semibold text-sm mb-1">Your images and clips</h3>
        <p className="text-xs text-sub mb-2">{list.media.length ? list.media.join(", ") : "None yet. Claude matches uploads to the scenes they fit."}</p>
        <input type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" onChange={(e) => send("media", e.target.files)} className="text-sm text-sub file:mr-3 file:rounded-md file:border file:border-line file:bg-panel file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:border-ink/40" />
      </div>
      <div>
        <h3 className="font-semibold text-sm mb-1">Your music track</h3>
        <p className="text-xs text-sub mb-2">{list.music.length ? list.music.join(", ") : "None. Generated music is used (if your ElevenLabs plan includes it)."}</p>
        <input type="file" accept="audio/*" onChange={(e) => send("music", e.target.files)} className="text-sm text-sub file:mr-3 file:rounded-md file:border file:border-line file:bg-panel file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:border-ink/40" />
      </div>
      {msg && <p className="sm:col-span-2 text-sm text-sub">{msg}</p>}
    </Panel>
  );
}
