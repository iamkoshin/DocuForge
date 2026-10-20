"use client";

import { useEffect, useState } from "react";
import type { Candidate, Script, VisualsResult } from "@/lib/schemas";
import { api, Button, ErrorNote, Panel, projectFile } from "../ui";

export function VisualsPicker({ projectId, focusScene, busy }: { projectId: string; focusScene?: string | null; busy: boolean }) {
  const [v, setV] = useState<VisualsResult | null>(null);
  const [script, setScript] = useState<Script | null>(null);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api<{ visuals: VisualsResult | null; script: Script | null }>(`/api/projects/${projectId}/visuals`).then((d) => {
      setV(d.visuals);
      setScript(d.script);
    });
  }, [projectId]);
  useEffect(() => {
    if (focusScene) document.getElementById(`vis-${focusScene}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusScene, v]);

  if (!v || !script) return <p className="text-sm text-sub">Images and footage appear here after the visuals step.</p>;

  const toggle = async (sceneId: string, id: string, max: number) => {
    const sv = v.scenes.find((s) => s.sceneId === sceneId)!;
    let chosen = sv.chosen.includes(id) ? sv.chosen.filter((c) => c !== id) : [...sv.chosen, id];
    if (chosen.length > max) chosen = chosen.slice(chosen.length - max);
    setError(null);
    try {
      const r = await api<{ visuals: VisualsResult }>(`/api/projects/${projectId}/visuals`, { method: "PUT", json: { sceneId, chosen } });
      setV(r.visuals);
      setChanged(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const refresh = async () => {
    setSending(true);
    await api(`/api/projects/${projectId}/retry`, { method: "POST", json: { step: "preview" } }).catch((e) => setError(e.message));
    setSending(false);
    setChanged(false);
  };
  const missing = v.scenes.filter((s) => s.missing);

  return (
    <div className="flex flex-col gap-4">
      {missing.length > 0 && (
        <Panel className="p-4 border-warn/40">
          <h3 className="font-semibold text-sm">Missing media ({missing.length})</h3>
          <p className="text-sm text-sub mt-1">
            No suitable image was found for these scenes, so they use a typography scene instead:{" "}
            {missing.map((m) => (
              <a key={m.sceneId} href={`#vis-${m.sceneId}`} className="text-cobalt mr-2">
                {m.sceneId}
              </a>
            ))}
            Upload your own images on the Overview tab and retry Visuals, or pick another candidate below.
          </p>
        </Panel>
      )}
      {changed && (
        <div className="sticky top-0 z-10 py-3 bg-bg/95 backdrop-blur flex items-center gap-3 border-b border-line">
          <p className="text-sm">Your picks are saved. Re-render the QA stills to see them in the video.</p>
          <Button variant="primary" size="sm" onClick={refresh} busy={sending} disabled={busy}>
            Update QA stills
          </Button>
        </div>
      )}
      <ErrorNote error={error} />
      {script.scenes.map((s, i) => {
        const sv = v.scenes.find((x) => x.sceneId === s.id);
        if (!sv || (sv.candidates.length === 0 && !sv.missing)) return null;
        const max = s.sceneType === "PhotoStack" ? 4 : 2;
        return (
          <Panel key={s.id} className={`p-4 scroll-mt-20 ${focusScene === s.id ? "ring-2 ring-cobalt" : ""}`}>
            <div id={`vis-${s.id}`} className="flex flex-wrap items-baseline gap-x-3 mb-3">
              <span className="font-semibold text-sm">{i + 1}</span>
              <span className="text-sm">{s.visual.subject}</span>
              <span className="text-xs text-sub">
                {s.sceneType}
                {sv.fallbackType && sv.fallbackType !== s.sceneType ? ` → shown as ${sv.fallbackType}` : ""} · choose up to {max}
              </span>
              <p className="basis-full text-sm text-sub mt-1 line-clamp-2 font-serif">{s.narration}</p>
            </div>
            {sv.candidates.length === 0 && <p className="text-sm text-sub">No candidates found.</p>}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {sv.candidates.map((id) => {
                const c: Candidate | undefined = v.candidates[id];
                if (!c) return null;
                const on = sv.chosen.includes(id);
                return (
                  <button key={id} onClick={() => toggle(s.id, id, max)} aria-pressed={on} className={`text-left rounded-md overflow-hidden border-2 ${on ? "border-cobalt" : "border-transparent hover:border-line"}`}>
                    <div className="relative aspect-video bg-film">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={projectFile(projectId, c.thumb ?? c.file)} alt={c.caption ?? ""} className="h-full w-full object-cover" loading="lazy" />
                      {c.type === "video" && <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 text-[11px] text-white">Video</span>}
                      {on && <span className="absolute right-1.5 top-1.5 rounded bg-cobalt px-1.5 text-[11px] text-white">In use</span>}
                    </div>
                    <div className="p-2 text-[11px] leading-snug">
                      <p className="flex justify-between gap-2">
                        <span className="font-medium">{c.provider}</span>
                        {c.score != null && <span className="tabular text-sub">{c.score.toFixed(0)}/10</span>}
                      </p>
                      {c.verdict && <p className="text-sub line-clamp-2">{c.verdict}</p>}
                      {(c.author || c.license) && <p className="text-sub truncate">{[c.author, c.license].filter(Boolean).join(" · ")}</p>}
                    </div>
                  </button>
                );
              })}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
