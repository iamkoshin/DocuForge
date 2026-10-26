"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, fileUrl, fmtDate, fmtDuration, fmtUsd, StatusChip } from "@/components/ui";
import type { ProjectOptions } from "@/lib/schemas";

interface Row {
  id: string;
  title: string;
  topic: string;
  status: string;
  current_step: string | null;
  duration_sec: number | null;
  thumbnail: string | null;
  created_at: number;
  costUsd: number;
  options: ProjectOptions;
}

export default function Dashboard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const load = () => api<Row[]>("/api/projects").then(setRows, (e) => setError(e.message));
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="max-w-5xl">
      <div className="flex items-end justify-between gap-4 mb-7">
        <h1 className="font-serif text-3xl font-semibold tracking-tight">Videos</h1>
        <Link href="/new" className="rounded-md bg-cobalt px-4 py-2 text-sm font-medium text-white hover:bg-[#1f3aa8]">
          New video
        </Link>
      </div>
      {error && <p className="text-bad text-sm mb-4">{error}</p>}
      {rows && rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-line bg-panel/50 p-10 text-center">
          <p className="font-serif text-xl mb-2">No videos yet</p>
          <p className="text-sub text-sm mb-5">Give Narrative a topic and a length; it researches, writes, voices and edits the documentary.</p>
          <Link href="/new" className="rounded-md bg-cobalt px-4 py-2 text-sm font-medium text-white">
            Start your first video
          </Link>
        </div>
      )}
      <ul className="flex flex-col gap-3">
        {rows?.map((r) => (
          <li key={r.id}>
            <Link href={`/projects/${r.id}`} className="group flex gap-4 rounded-lg border border-line bg-panel p-3 hover:border-ink/30">
              <div className={`shrink-0 overflow-hidden rounded bg-film ${r.options.format === "9:16" ? "w-[68px] h-[120px]" : "w-[160px] h-[90px]"} sm:block hidden`}>
                {r.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={fileUrl(r.thumbnail) + `?t=${r.duration_sec}`} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full grid place-items-center text-white/30 text-xs">{r.options.format}</div>
                )}
              </div>
              <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-serif text-lg leading-snug truncate group-hover:underline underline-offset-4">{r.title}</h2>
                  <StatusChip status={r.status} />
                </div>
                {r.title !== r.topic && <p className="text-sm text-sub truncate">{r.topic}</p>}
                <p className="text-xs text-sub tabular mt-auto flex flex-wrap gap-x-4 gap-y-1">
                  <span>{r.duration_sec ? fmtDuration(r.duration_sec) : `${r.options.minutes} min target`}</span>
                  <span>{r.options.format}</span>
                  <span>{fmtUsd(r.costUsd)} spent</span>
                  <span>{fmtDate(r.created_at)}</span>
                  {r.status === "running" && r.current_step && <span className="text-cobalt">Working on {r.current_step}</span>}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
