"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, Button, ErrorNote, Field, fileUrl, inputCls, Panel } from "@/components/ui";

interface Sound {
  id: string;
  key: string;
  prompt: string;
  tags: string;
  file: string;
  duration: number;
  category: string;
  source: string;
  uses: number;
}

export default function SfxLibrary() {
  const [sounds, setSounds] = useState<Sound[]>([]);
  const [starter, setStarter] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const load = () => api<{ sounds: Sound[]; starter: string[] }>("/api/sfx").then((d) => (setSounds(d.sounds), setStarter(d.starter)));
  useEffect(() => {
    load();
  }, []);

  const groups = useMemo(() => {
    const f = q.trim().toLowerCase();
    const m = new Map<string, Sound[]>();
    for (const s of sounds) {
      if (f && !`${s.key} ${s.tags} ${s.prompt}`.toLowerCase().includes(f)) continue;
      m.set(s.key, [...(m.get(s.key) ?? []), s]);
    }
    return [...m.entries()];
  }, [sounds, q]);
  const missingStarter = starter.filter((k) => !sounds.some((s) => s.key === k));

  const play = (s: Sound) => {
    audio.current?.pause();
    if (playing === s.id) return setPlaying(null);
    audio.current = new Audio(fileUrl(s.file));
    audio.current.onended = () => setPlaying(null);
    audio.current.play();
    setPlaying(s.id);
  };
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const upload = (files: FileList | null) =>
    files?.length &&
    run("upload", async () => {
      const fd = new FormData();
      [...files].forEach((f) => fd.append("files", f));
      fd.set("tags", "uploaded");
      const r = await fetch("/api/sfx", { method: "POST", body: fd });
      if (!r.ok) throw new Error((await r.json()).error);
    });

  return (
    <div className="max-w-5xl flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">Sound library</h1>
        <p className="text-sm text-sub mt-1">Every video reuses these sounds before generating anything new. Sounds with several takes rotate so hits don’t repeat exactly.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel className="p-4 flex flex-col gap-3">
          <h2 className="font-semibold text-sm">Generate a sound</h2>
          <Field label="Describe it">
            <input className={inputCls} placeholder="Heavy vault door closing with a metallic echo" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </Field>
          <div className="flex items-end gap-3">
            <Field label="Length in seconds" hint="Optional, 0.5–30">
              <input className={`${inputCls} w-28`} type="number" min={0.5} max={30} step={0.5} value={duration} onChange={(e) => setDuration(e.target.value)} />
            </Field>
            <Button variant="primary" busy={busy === "gen"} disabled={!prompt.trim()} onClick={() => run("gen", () => api("/api/sfx", { method: "POST", json: { prompt, duration: duration ? Number(duration) : undefined } }).then(() => setPrompt("")))}>
              Generate sound
            </Button>
          </div>
        </Panel>
        <Panel className="p-4 flex flex-col gap-3">
          <h2 className="font-semibold text-sm">Add your own</h2>
          <p className="text-sm text-sub">Name files by what they are (“gavel_double.wav”); the name becomes the sound’s key.</p>
          <input type="file" multiple accept="audio/*" onChange={(e) => upload(e.target.files)} className="text-sm text-sub file:mr-3 file:rounded-md file:border file:border-line file:bg-panel file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:border-ink/40" disabled={busy === "upload"} />
          {missingStarter.length > 0 && (
            <div className="border-t border-line pt-3 mt-auto">
              <p className="text-sm text-sub mb-2">{missingStarter.length} starter sounds haven’t been generated yet. They’re created automatically on your first video, or now.</p>
              <Button busy={busy === "seed"} onClick={() => run("seed", () => api("/api/sfx/seed", { method: "POST" }))}>
                Generate starter pack
              </Button>
            </div>
          )}
        </Panel>
      </div>
      <ErrorNote error={error} />

      <input className={`${inputCls} max-w-sm`} placeholder="Search sounds" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search sounds" />
      {groups.length === 0 && <p className="text-sm text-sub">No sounds yet.</p>}
      <Panel>
        <ul className="divide-y divide-line">
          {groups.map(([key, takes]) => (
            <li key={key} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{key}</p>
                <p className="text-xs text-sub truncate">
                  {takes[0].category} · {takes[0].source} · used {takes.reduce((a, t) => a + t.uses, 0)}× · {takes[0].prompt}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {takes.map((t, i) => (
                  <span key={t.id} className="inline-flex items-center rounded-md border border-line">
                    <button onClick={() => play(t)} className="px-2 py-1 text-xs tabular" aria-label={`Play take ${i + 1}`}>
                      {playing === t.id ? "■" : "▶"} {i + 1} · {t.duration.toFixed(1)}s
                    </button>
                    <button
                      onClick={() => {
                        const tags = window.prompt("Tags (comma separated)", JSON.parse(t.tags).join(", "));
                        if (tags !== null) run(`tag-${t.id}`, () => api(`/api/sfx/${t.id}`, { method: "PATCH", json: { tags: tags.split(",").map((x) => x.trim()).filter(Boolean) } }));
                      }}
                      className="px-1.5 py-1 text-xs text-sub border-l border-line hover:text-ink"
                    >
                      Tag
                    </button>
                    <button onClick={() => confirm(`Delete take ${i + 1} of ${key}?`) && run(`del-${t.id}`, () => api(`/api/sfx/${t.id}`, { method: "DELETE" }))} className="px-1.5 py-1 text-xs text-sub border-l border-line hover:text-bad">
                      Delete
                    </button>
                  </span>
                ))}
              </div>
              <p className="basis-full text-xs text-sub">{(JSON.parse(takes[0].tags) as string[]).join(", ")}</p>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
