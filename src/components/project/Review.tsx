"use client";

import { useEffect, useMemo, useState } from "react";
import { SCENE_TYPES, VISUAL_KINDS, type Research, type Scene, type Script, type SfxCue, type VoiceResult } from "@/lib/schemas";
import { api, Button, ErrorNote, fmtDuration, inputCls, Panel } from "../ui";

const WPS = 2.5; // ≈150 words per minute
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

export function Review({ projectId, canApprove, targetMinutes, aiEdits = true }: { projectId: string; canApprove: boolean; targetMinutes: number; aiEdits?: boolean }) {
  const [script, setScript] = useState<Script | null>(null);
  const [research, setResearch] = useState<Research | null>(null);
  const [voice, setVoice] = useState<VoiceResult | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api<{ script: Script | null; research: Research | null; voice: VoiceResult | null }>(`/api/projects/${projectId}/script`).then((d) => {
      setScript(d.script);
      setResearch(d.research);
      setVoice(d.voice);
    });
  }, [projectId]);

  const claims = useMemo(() => new Map(research?.claims.map((c) => [c.id, c]) ?? []), [research]);
  const realDur = useMemo(() => new Map(voice?.scenes.map((v) => [v.sceneId, v.duration]) ?? []), [voice]);

  if (!script) return <p className="text-sm text-sub">The script appears here once it’s written.</p>;

  const estSec = (s: Scene) => words(s.narration) / WPS + 0.35;
  const total = script.scenes.reduce((a, s) => a + estSec(s), 0);
  const target = targetMinutes * 60;
  const off = (total - target) / target;

  const update = (i: number, patch: Partial<Scene>) => {
    if (patch.narration !== undefined) patch = { ...patch, unverified: undefined }; // rewritten by the creator
    setScript({ ...script, scenes: script.scenes.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
    setDirty(true);
  };
  const updateCue = (i: number, k: number, patch: Partial<SfxCue>) => update(i, { sfx: script.scenes[i].sfx.map((c, j) => (j === k ? { ...c, ...patch } : c)) });

  const save = async () => {
    setError(null);
    setBusy("save");
    try {
      const r = await api<{ script: Script; warnings: string[] }>(`/api/projects/${projectId}/script`, { method: "PUT", json: { script } });
      setScript(r.script);
      setDirty(false);
      setNotice(r.warnings.length ? r.warnings.join(" · ") : "Changes saved");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };
  const approve = async () => {
    if (dirty && !(await save())) return;
    setBusy("approve");
    await api(`/api/projects/${projectId}/approve`, { method: "POST", json: { stage: "script" } }).catch((e) => setError(e.message));
    setBusy(null);
    setNotice("Approved — voiceover is starting.");
  };
  const rewrite = async (s: Scene, mode: "regenerate" | "shorter" | "longer") => {
    if (dirty && !(await save())) return;
    setBusy(`${s.id}-${mode}`);
    setError(null);
    try {
      const r = await api<{ script: Script }>(`/api/projects/${projectId}/scenes/${s.id}`, { method: "POST", json: { mode } });
      setScript(r.script);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 -mx-1 px-1 py-3 bg-bg/95 backdrop-blur flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line">
        <div>
          <p className="font-serif text-xl leading-tight">{script.title}</p>
          <p className="text-sm text-sub tabular">
            {script.scenes.length} scenes · {script.scenes.reduce((a, s) => a + words(s.narration), 0)} words · about {fmtDuration(total)} of {fmtDuration(target)}
            <span className={Math.abs(off) > 0.1 ? "text-warn" : "text-ok"}> ({off >= 0 ? "+" : ""}{Math.round(off * 100)}%)</span>
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button onClick={save} disabled={!dirty} busy={busy === "save"}>
            Save changes
          </Button>
          {canApprove && (
            <Button variant="primary" onClick={approve} busy={busy === "approve"}>
              Approve &amp; continue
            </Button>
          )}
        </div>
        {Math.abs(off) > 0.1 && (
          <p className="basis-full text-xs text-warn">
            More than 10% off the target length. {aiEdits ? "The voice step trims or expands a few scenes automatically, or adjust them here." : "Shorten or lengthen some scenes here before approving (automatic fitting needs the Claude API)."}
          </p>
        )}
      </div>
      <ErrorNote error={error} />
      {notice && <p className="text-sm text-sub">{notice}</p>}

      {script.scenes.map((s, i) => {
        const chapter = script.chapters.find((c) => c.id === s.chapterId);
        const newChapter = i === 0 || script.scenes[i - 1].chapterId !== s.chapterId;
        return (
          <div key={s.id}>
            {newChapter && chapter && <h3 className="font-serif text-lg mt-4 mb-2">{chapter.title}</h3>}
            <Panel className="p-4 grid gap-4 lg:grid-cols-[1fr_300px]">
              <div className="flex flex-col gap-3 min-w-0">
                <div className="flex items-center gap-3 text-xs text-sub tabular">
                  <span className="font-semibold text-ink text-sm">{i + 1}</span>
                  <span>{realDur.get(s.id) ? `${realDur.get(s.id)!.toFixed(1)}s voiced` : `~${estSec(s).toFixed(1)}s`}</span>
                  {s.climax && <span className="text-warn">Biggest reveal</span>}
                </div>
                <textarea
                  rows={Math.max(2, Math.ceil(s.narration.length / 90))}
                  className={`${inputCls} font-serif text-[15px] leading-relaxed`}
                  value={s.narration}
                  onChange={(e) => update(i, { narration: e.target.value })}
                  aria-label={`Narration for scene ${i + 1}`}
                />
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="text-xs text-sub flex flex-col gap-1">
                    Scene type
                    <select className={inputCls} value={s.sceneType} onChange={(e) => update(i, { sceneType: e.target.value as Scene["sceneType"] })}>
                      {SCENE_TYPES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-sub flex flex-col gap-1">
                    Emphasis words
                    <input className={inputCls} value={s.emphasisWords.join(", ")} onChange={(e) => update(i, { emphasisWords: e.target.value.split(",").map((w) => w.trim()).filter(Boolean) })} />
                  </label>
                  <label className="text-xs text-sub flex flex-col gap-1">
                    Visual
                    <div className="flex gap-1">
                      <select className={`${inputCls} w-24`} value={s.visual.kind} onChange={(e) => update(i, { visual: { ...s.visual, kind: e.target.value as Scene["visual"]["kind"] } })}>
                        {VISUAL_KINDS.map((k) => (
                          <option key={k}>{k}</option>
                        ))}
                      </select>
                      <input className={inputCls} value={s.visual.subject} onChange={(e) => update(i, { visual: { ...s.visual, subject: e.target.value } })} aria-label="Visual subject" />
                    </div>
                  </label>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-sub">Sound cues</span>
                  {s.sfx.map((c, k) => (
                    <div key={k} className="flex flex-wrap gap-1.5 items-center">
                      <input className={`${inputCls} flex-1 min-w-36`} value={c.cue} onChange={(e) => updateCue(i, k, { cue: e.target.value })} aria-label="Sound" />
                      <select className={`${inputCls} w-24`} value={c.at} onChange={(e) => updateCue(i, k, { at: e.target.value as SfxCue["at"] })} aria-label="When">
                        <option value="start">start</option>
                        <option value="word">on word</option>
                        <option value="end">end</option>
                      </select>
                      {c.at === "word" && <input className={`${inputCls} w-28`} placeholder="word" value={c.anchorWord ?? ""} onChange={(e) => updateCue(i, k, { anchorWord: e.target.value })} aria-label="Anchor word" />}
                      <select className={`${inputCls} w-24`} value={c.intensity} onChange={(e) => updateCue(i, k, { intensity: e.target.value as SfxCue["intensity"] })} aria-label="Intensity">
                        <option>low</option>
                        <option>medium</option>
                        <option>high</option>
                      </select>
                      <Button size="sm" variant="ghost" onClick={() => update(i, { sfx: s.sfx.filter((_, j) => j !== k) })} aria-label="Remove cue">
                        Remove
                      </Button>
                    </div>
                  ))}
                  <div>
                    <Button size="sm" variant="ghost" onClick={() => update(i, { sfx: [...s.sfx, { cue: "whoosh_fast_airy", at: "start", intensity: "medium" }] })}>
                      Add sound cue
                    </Button>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-3 min-w-0">
                <div className="flex flex-wrap gap-1.5">
                  {aiEdits && (
                    <>
                      <Button size="sm" onClick={() => rewrite(s, "regenerate")} busy={busy === `${s.id}-regenerate`} disabled={!!busy}>
                        Regenerate this scene
                      </Button>
                      <Button size="sm" onClick={() => rewrite(s, "shorter")} busy={busy === `${s.id}-shorter`} disabled={!!busy}>
                        Make it shorter
                      </Button>
                      <Button size="sm" onClick={() => rewrite(s, "longer")} busy={busy === `${s.id}-longer`} disabled={!!busy}>
                        Make it longer
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => (setScript({ ...script, scenes: script.scenes.filter((_, j) => j !== i) }), setDirty(true))} disabled={script.scenes.length <= 2}>
                    Delete scene
                  </Button>
                </div>
                <div>
                  <p className="text-xs text-sub mb-1">Sources</p>
                  {s.unverified ? (
                    <p className="text-xs text-bad">Unverified: the sources this line cited didn’t pass the check. Rewrite it or delete the scene.</p>
                  ) : (
                    s.claimIds.length === 0 && <p className="text-xs text-sub">No factual claim — transition or framing line.</p>
                  )}
                  <ul className="flex flex-col gap-1.5">
                    {s.claimIds.map((id) => {
                      const c = claims.get(id);
                      if (!c) return null;
                      return (
                        <li key={id} className="text-xs">
                          <p className="text-ink">{c.text}</p>
                          <p className="flex flex-wrap gap-x-2">
                            {c.sources.map((src) => (
                              <a key={src.url} href={src.url} target="_blank" rel="noreferrer" className="text-cobalt underline-offset-2 hover:underline">
                                {src.publisher}
                              </a>
                            ))}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </Panel>
          </div>
        );
      })}
    </div>
  );
}
