"use client";

import { useEffect, useRef, useState } from "react";
import { api, Button, Panel } from "../ui";

/** Claude-app mode: copy the prompt into the Claude app, paste its reply back. */
export function ImportPanel({ projectId, replacing = false }: { projectId: string; replacing?: boolean }) {
  const [prompt, setPrompt] = useState("");
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const promptBox = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api<{ prompt: string }>(`/api/projects/${projectId}/import`).then(
      (d) => setPrompt(d.prompt),
      (e: Error) => setErrors([`The prompt couldn’t be loaded: ${e.message}`]),
    );
  }, [projectId]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      // Clipboard blocked: reveal the prompt selected so Ctrl+C works.
      setShowPrompt(true);
      setTimeout(() => promptBox.current?.select(), 0);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };
  const submit = async () => {
    setBusy(true);
    setErrors([]);
    const res = await fetch(`/api/projects/${projectId}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    const d = (await res.json()) as { ok?: boolean; summary?: string; errors?: string[]; error?: string };
    setBusy(false);
    if (d.ok) {
      setDone(d.summary ?? "Imported");
      setText("");
    } else setErrors(d.errors ?? [d.error ?? "Import failed"]);
  };

  if (done) {
    return (
      <Panel className="p-4 border-ok/40 bg-ok-soft/40">
        <p className="text-sm">
          <span className="font-medium">Reply imported</span> ({done}). Checking the source links now, then the script opens for review.
        </p>
      </Panel>
    );
  }

  return (
    <Panel className={`p-5 flex flex-col gap-5 ${replacing ? "" : "border-warn/40"}`}>
      <div>
        <h2 className="font-semibold">{replacing ? "Replace research and script with a new Claude reply" : "Write the research and script in the Claude app"}</h2>
        <p className="text-sm text-sub mt-1 max-w-[70ch]">This project uses your Claude app plan instead of the API, so it costs nothing extra. It takes three steps.</p>
      </div>

      <ol className="flex flex-col gap-5">
        <li className="grid gap-2 sm:grid-cols-[28px_1fr]">
          <span className="grid size-7 place-items-center rounded-full bg-ink text-white text-sm font-semibold">1</span>
          <div className="flex flex-col gap-2">
            <p className="text-sm">Copy the prompt. It already contains your topic, length, tone and all the writing rules.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={copy} disabled={!prompt}>
                {copied ? "Copied" : "Copy prompt"}
              </Button>
              <Button variant="ghost" onClick={() => setShowPrompt((s) => !s)}>
                {showPrompt ? "Hide prompt" : "Show prompt"}
              </Button>
            </div>
            {showPrompt && <textarea ref={promptBox} readOnly value={prompt} rows={12} className="w-full rounded-md border border-line bg-bg px-3 py-2 text-xs font-[ui-monospace,monospace]" />}
          </div>
        </li>
        <li className="grid gap-2 sm:grid-cols-[28px_1fr]">
          <span className="grid size-7 place-items-center rounded-full bg-ink text-white text-sm font-semibold">2</span>
          <div className="text-sm flex flex-col gap-1.5">
            <p>
              Open a new chat at{" "}
              <a href="https://claude.ai/new" target="_blank" rel="noreferrer" className="text-cobalt underline underline-offset-2">
                claude.ai
              </a>
              , make sure <span className="font-medium">web search</span> is turned on, paste the prompt and send it.
            </p>
            <p className="text-sub">For long videos Claude may stop partway. Type “continue” until it finishes the JSON, then copy every part.</p>
          </div>
        </li>
        <li className="grid gap-2 sm:grid-cols-[28px_1fr]">
          <span className="grid size-7 place-items-center rounded-full bg-ink text-white text-sm font-semibold">3</span>
          <div className="flex flex-col gap-2">
            <label htmlFor={`reply-${projectId}`} className="text-sm">
              Paste Claude’s whole reply here (all parts, one after another).
            </label>
            <textarea id={`reply-${projectId}`} rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'```json\n{ "research": { … }, "script": { … }, "youtube": { … } }\n```'} className="w-full rounded-md border border-line bg-panel px-3 py-2 text-xs font-[ui-monospace,monospace] focus:border-cobalt focus:outline-none" />
            {errors.length > 0 && (
              <div className="rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">
                <p className="font-medium mb-1">The reply couldn’t be imported:</p>
                <ul className="list-disc pl-5 flex flex-col gap-0.5">
                  {errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
                <p className="mt-2 text-ink/80">You can copy these lines back to Claude and ask it to fix the JSON.</p>
              </div>
            )}
            <div>
              <Button variant="primary" onClick={submit} busy={busy} disabled={!text.trim()}>
                Import reply
              </Button>
            </div>
          </div>
        </li>
      </ol>
    </Panel>
  );
}
