"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Credit } from "@/lib/schemas";
import { api, Button, ErrorNote, Field, inputCls, Panel, projectFile } from "../ui";

const LABELS: Record<string, string> = {
  "video.mp4": "Video",
  "captions.srt": "Captions",
  "thumbnail.png": "Thumbnail",
  "youtube.md": "YouTube title, description, chapters & tags",
  "research.json": "Research",
  "script.json": "Script",
  "credits.json": "Image credits",
};

export function VideoPanel({ projectId, outputs, vertical, busy, version }: { projectId: string; outputs: string[]; vertical: boolean; busy: boolean; version: number }) {
  const router = useRouter();
  const [credits, setCredits] = useState<Credit[]>([]);
  const [dup, setDup] = useState(false);
  const [topic, setTopic] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ credits: Credit[] | null }>(`/api/projects/${projectId}/visuals`).then((d) => setCredits(d.credits ?? []), () => {}); // a missing project is reported by the page itself
  }, [projectId, version]);

  const rerender = async () => {
    setSending("rerender");
    await api(`/api/projects/${projectId}/retry`, { method: "POST", json: { step: "preview" } }).catch((e) => setError(e.message));
    setSending(null);
  };
  const duplicate = async () => {
    setSending("dup");
    try {
      const { id } = await api<{ id: string }>(`/api/projects/${projectId}/duplicate`, { method: "POST", json: { topic } });
      router.push(`/projects/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setSending(null);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px] items-start">
      <div className="flex flex-col gap-4">
        {outputs.includes("video.mp4") ? (
          <video key={version} controls className={`w-full rounded-lg bg-black ${vertical ? "max-h-[78vh] aspect-[9/16] mx-auto max-w-sm" : "aspect-video"}`} src={projectFile(projectId, "video.mp4") + `?v=${version}`} poster={outputs.includes("thumbnail.png") ? projectFile(projectId, "thumbnail.png") + `?v=${version}` : undefined} />
        ) : (
          <div className="aspect-video rounded-lg bg-film grid place-items-center text-white/50 text-sm">The finished video appears here after rendering.</div>
        )}
        {credits.length > 0 && (
          <Panel className="p-4">
            <h3 className="font-semibold text-sm mb-2">Image credits</h3>
            <ul className="text-xs flex flex-col gap-1.5">
              {credits.map((c) => (
                <li key={c.file}>
                  <span className="text-sub">{c.sceneIds.join(", ")}:</span> {[c.author, c.license].filter(Boolean).join(" · ") || c.provider}{" "}
                  {c.sourcePage && (
                    <a className="text-cobalt hover:underline break-all" href={c.sourcePage} target="_blank" rel="noreferrer">
                      {c.sourcePage}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
      <div className="flex flex-col gap-4">
        <Panel className="p-4">
          <h3 className="font-semibold text-sm mb-3">Downloads</h3>
          {outputs.length === 0 && <p className="text-sm text-sub">Nothing to download yet.</p>}
          <ul className="flex flex-col gap-1">
            {outputs.map((f) => (
              <li key={f}>
                <a href={projectFile(projectId, f, true)} className="flex justify-between gap-3 rounded px-2 py-1.5 text-sm hover:bg-bg">
                  <span>{LABELS[f] ?? f}</span>
                  <span className="text-sub text-xs">{f}</span>
                </a>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel className="p-4 flex flex-col gap-3">
          <Button onClick={rerender} busy={sending === "rerender"} disabled={busy}>
            Re-render
          </Button>
          <p className="text-xs text-sub -mt-1">Rebuilds the stills and video from the current script, images and sounds. Nothing paid is redone.</p>
          {!dup ? (
            <Button onClick={() => setDup(true)}>Duplicate with new topic</Button>
          ) : (
            <div className="flex flex-col gap-2">
              <Field label="New topic">
                <input className={inputCls} value={topic} onChange={(e) => setTopic(e.target.value)} autoFocus />
              </Field>
              <div className="flex gap-2">
                <Button variant="primary" onClick={duplicate} busy={sending === "dup"} disabled={topic.trim().length < 2}>
                  Create video
                </Button>
                <Button variant="ghost" onClick={() => setDup(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          <ErrorNote error={error} />
        </Panel>
      </div>
    </div>
  );
}
