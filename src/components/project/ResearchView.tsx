"use client";

import { useEffect, useState } from "react";
import type { Research } from "@/lib/schemas";
import { api, Panel } from "../ui";

export function ResearchView({ projectId }: { projectId: string }) {
  const [r, setR] = useState<Research | null>(null);
  useEffect(() => {
    api<{ research: Research | null }>(`/api/projects/${projectId}/script`).then((d) => setR(d.research), () => {}); // a missing project is reported by the page itself
  }, [projectId]);
  if (!r) return <p className="text-sm text-sub">Research appears here when it’s finished.</p>;
  return (
    <div className="flex flex-col gap-6">
      <Panel className="p-5">
        <p className="font-serif text-lg leading-relaxed max-w-[72ch]">{r.summary}</p>
        <p className="text-sm text-sub mt-3 max-w-[72ch]">
          <span className="font-medium text-ink">Current status ({r.currentStatus.asOf}):</span> {r.currentStatus.text}
        </p>
      </Panel>

      <Panel>
        <h3 className="px-4 py-3 border-b border-line font-semibold text-sm">Verified claims and sources ({r.claims.length})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-sub">
              <tr>
                <th className="px-4 py-2 font-medium w-12">ID</th>
                <th className="px-4 py-2 font-medium">Claim</th>
                <th className="px-4 py-2 font-medium w-[38%]">Sources</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {r.claims.map((c) => (
                <tr key={c.id} className="align-top">
                  <td className="px-4 py-2.5 text-sub tabular">{c.id}</td>
                  <td className="px-4 py-2.5">
                    {c.text}
                    {c.sources.length < 2 && <span className="ml-2 text-xs text-warn">single source</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <ul className="flex flex-col gap-1">
                      {c.sources.map((s) => (
                        <li key={s.url}>
                          <a href={s.url} target="_blank" rel="noreferrer" className="text-cobalt hover:underline underline-offset-2">
                            {s.title || s.url}
                          </a>
                          <span className="text-xs text-sub"> — {s.publisher}</span>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-6 md:grid-cols-2">
        <Panel className="p-4">
          <h3 className="font-semibold text-sm mb-3">Timeline</h3>
          <ol className="flex flex-col gap-2 text-sm">
            {r.timeline.map((t, i) => (
              <li key={i} className="grid grid-cols-[110px_1fr] gap-3">
                <span className="text-sub tabular">{t.date}</span>
                <span>{t.event}</span>
              </li>
            ))}
          </ol>
        </Panel>
        <Panel className="p-4">
          <h3 className="font-semibold text-sm mb-3">Key players</h3>
          <ul className="flex flex-col gap-2 text-sm">
            {r.players.map((p) => (
              <li key={p.name}>
                <span className="font-medium">{p.name}</span> <span className="text-sub">— {p.role}</span>
              </li>
            ))}
          </ul>
          {r.numbers.length > 0 && (
            <>
              <h3 className="font-semibold text-sm mt-5 mb-3">Key numbers</h3>
              <ul className="flex flex-col gap-1.5 text-sm">
                {r.numbers.map((n, i) => (
                  <li key={i}>
                    <span className="font-medium tabular">{n.value}</span> <span className="text-sub">{n.label}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>

      {!!r.scriptIssues?.length && (
        <Panel className="p-4 border-warn/40">
          <h3 className="font-semibold text-sm mb-2">Lines in your script to check ({r.scriptIssues.length})</h3>
          <p className="text-xs text-sub mb-3">The research contradicts these lines or couldn’t confirm them. Your words are kept as written; edit them on the Script tab if you want.</p>
          <ul className="text-sm flex flex-col gap-2">
            {r.scriptIssues.map((d, i) => (
              <li key={i}>
                <span className="italic">“{d.quote}”</span> <span className="text-sub">— {d.problem}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {!!r.droppedClaims?.length && (
        <Panel className="p-4">
          <h3 className="font-semibold text-sm mb-2">Dropped claims ({r.droppedClaims.length})</h3>
          <p className="text-xs text-sub mb-3">Not used in the script because they couldn’t be verified by two independent sources.</p>
          <ul className="text-sm flex flex-col gap-1.5">
            {r.droppedClaims.map((d) => (
              <li key={d.id}>
                <span className="text-sub">{d.reason}:</span> {d.text}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
