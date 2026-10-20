"use client";

import { useEffect, useState } from "react";
import type { RenderProps } from "@/lib/schemas";
import { api, Button, fmtDuration, Panel, projectFile } from "../ui";

export function ContactSheet({ projectId, canApprove, onSwap, version }: { projectId: string; canApprove: boolean; onSwap: (sceneId: string) => void; version: number }) {
  const [sheet, setSheet] = useState<{ sceneId: string; file: string; frame: number }[] | null>(null);
  const [props, setProps] = useState<RenderProps | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ contact: typeof sheet }>(`/api/projects/${projectId}/visuals`).then((d) => setSheet(d.contact), () => {}); // a missing project is reported by the page itself
    fetch(projectFile(projectId, "project.json")).then((r) => (r.ok ? r.json() : null)).then(setProps, () => {});
  }, [projectId, version]);

  if (!sheet) return <p className="text-sm text-sub">The QA contact sheet appears here: one still from the middle of every scene.</p>;
  const approve = async () => {
    setBusy(true);
    await api(`/api/projects/${projectId}/approve`, { method: "POST", json: { stage: "preview" } }).finally(() => setBusy(false));
  };
  const vertical = props?.format === "9:16";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-sub">
          {sheet.length} scenes{props ? ` · ${fmtDuration(props.durationInFrames / props.fps)}` : ""}. Check every frame before rendering the full video.
        </p>
        {canApprove && (
          <Button variant="primary" className="ml-auto" onClick={approve} busy={busy}>
            Render video
          </Button>
        )}
      </div>
      <div className={`grid gap-3 ${vertical ? "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6" : "grid-cols-2 lg:grid-cols-3"}`}>
        {sheet.map((s, i) => {
          const scene = props?.scenes.find((x) => x.id === s.sceneId);
          return (
            <Panel key={s.sceneId} className="overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={projectFile(projectId, s.file) + `?v=${version}`} alt={`Scene ${i + 1}`} className={`w-full bg-film ${vertical ? "aspect-[9/16]" : "aspect-video"} object-cover`} />
              <div className="p-2 flex items-start justify-between gap-2">
                <p className="text-xs min-w-0">
                  <span className="font-semibold">{i + 1}</span> <span className="text-sub">{scene?.type}</span>
                  <span className="block text-sub line-clamp-2">{scene?.narration}</span>
                </p>
                {scene && (scene.assets.length > 0 || ["NameReveal", "PhotoStack", "KineticCaption", "BigNumber"].includes(scene.type)) && (
                  <Button size="sm" variant="ghost" onClick={() => onSwap(s.sceneId)}>
                    Swap image
                  </Button>
                )}
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
