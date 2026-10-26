"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Credit } from "@/lib/schemas";
import type { Short } from "@/worker/steps/shorts";
import { api, Button, ErrorNote, Panel, projectFile } from "../ui";

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
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shorts, setShorts] = useState<Short[]>([]);
  useEffect(() => {
    api<{ credits: Credit[] | null }>(`/api/projects/${projectId}/visuals`).then((d) => setCredits(d.credits ?? []), () => {}); // a missing project is reported by the page itself
    api<{ shorts: Short[] }>(`/api/projects/${projectId}/shorts`).then((d) => setShorts(d.shorts), () => {});
  }, [projectId, version]);

  const makeShorts = async () => {
    setSending("shorts");
    setError(null);
    await api(`/api/projects/${projectId}/shorts`, { method: "POST" }).catch((e) => setError(e.message));
    setSending(null);
  };
  const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

  const rerender = async () => {
    setSending("rerender");
    await api(`/api/projects/${projectId}/retry`, { method: "POST", json: { step: "preview" } }).catch((e) => setError(e.message));
    setSending(null);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px] items-start">
      <div className="flex flex-col gap-4">
        {outputs.includes("video.mp4") ? (
          <video key={version} controls className={`w-full rounded-lg bg-black ${vertical ? "max-h-[78vh] aspect-[9/16] mx-auto max-w-sm" : "aspect-video"}`} src={projectFile(projectId, "video.mp4") + `?v=${version}`} poster={outputs.includes("thumbnail.png") ? projectFile(projectId, "thumbnail.png") + `?v=${version}` : undefined} />
        ) : (
          <div className="aspect-video rounded-lg bg-film grid place-items-center text-white/50 text-sm">The finished video appears here after rendering.</div>
        )}
        {outputs.includes("video.mp4") && (
          <Panel className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-sm">Highlight shorts</h3>
                <p className="text-xs text-sub mt-0.5">3 standalone moments under a minute each, rebuilt in 9:16 with a hook line on top. Uses the same voice, images and sounds, so nothing paid is redone.</p>
              </div>
              <Button onClick={makeShorts} busy={sending === "shorts"} disabled={busy}>
                {shorts.length ? "Make new shorts" : "Make 3 shorts"}
              </Button>
            </div>
            {shorts.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-3 mt-4">
                {shorts.map((s) => (
                  <div key={s.file} className="flex flex-col gap-1.5">
                    <video controls preload="metadata" className="w-full aspect-[9/16] rounded-md bg-black" src={projectFile(projectId, s.file) + `?v=${version}`} />
                    <p className="text-sm font-medium leading-snug">{s.title}</p>
                    <p className="text-xs text-sub">
                      {s.durationSec.toFixed(0)}s · from {clock(s.from)}–{clock(s.to)}
                    </p>
                    <p className="text-xs text-sub line-clamp-3">{s.description}</p>
                    <a href={projectFile(projectId, s.file, true)} className="text-xs text-cobalt hover:underline">
                      Download
                    </a>
                  </div>
                ))}
              </div>
            )}
            {shorts.length > 0 && (
              <a href={projectFile(projectId, "shorts/shorts.md", true)} className="inline-block mt-3 text-xs text-cobalt hover:underline">
                Titles and descriptions (shorts.md)
              </a>
            )}
          </Panel>
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
          <Button onClick={() => router.push(`/new?from=${projectId}`)}>New video with these settings</Button>
          <p className="text-xs text-sub -mt-1">Opens New video with the same voice, theme, music, sound and format. Add a topic and paste your script.</p>
          <ErrorNote error={error} />
        </Panel>
      </div>
    </div>
  );
}
