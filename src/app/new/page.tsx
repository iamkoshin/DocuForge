"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, Button, ErrorNote, Field, fmtUsd, inputCls, Panel } from "@/components/ui";
import type { Estimate } from "@/lib/cost";
import { ownScriptMinutes, ownScriptWords } from "@/lib/ownScript";

interface Voice {
  voice_id: string;
  name: string;
  preview_url?: string;
  labels?: Record<string, string>;
}
interface SettingsResp {
  settings: { defaultVoiceId: string; defaultTheme: string; defaultSfxLevel: string; model: string };
  keys: Record<string, boolean>;
  models: { id: string; label: string }[];
}

const THEMES = [
  { id: "investigative", name: "Investigative", colors: ["#0B0B0B", "#F2F2EE", "#ECE6DA", "#E0241B"] },
  { id: "clean-light", name: "Clean Light", colors: ["#F5F6F8", "#14171C", "#FFFFFF", "#2563EB"] },
  { id: "retro-archive", name: "Retro Archive", colors: ["#1E1710", "#F1E4C8", "#E9DABA", "#C2502E"] },
];
const TONES = ["Investigative", "Dramatic", "Calm explainer", "Upbeat"] as const;
const MOODS = ["tense", "inspiring", "mysterious", "none"];
const SFX = [
  { id: "off", label: "Off" },
  { id: "subtle", label: "Subtle" },
  { id: "normal", label: "Normal" },
  { id: "punchy", label: "Punchy" },
];

export default function NewVideo() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [angle, setAngle] = useState("");
  const [minutes, setMinutes] = useState(1);
  const [format, setFormat] = useState<"16:9" | "9:16">("16:9");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceId, setVoiceId] = useState("");
  const [language, setLanguage] = useState("English");
  const [tone, setTone] = useState<(typeof TONES)[number]>("Investigative");
  const [theme, setTheme] = useState("investigative");
  const [mood, setMood] = useState("tense");
  const [sfxLevel, setSfxLevel] = useState("normal");
  const [sources, setSources] = useState("");
  const [pause, setPause] = useState(true);
  const [model, setModel] = useState("");
  const [scriptSource, setScriptSource] = useState<"api" | "app">("api");
  const [writeOwn, setWriteOwn] = useState(false);
  const [ownScript, setOwnScript] = useState("");
  const ownWords = writeOwn ? ownScriptWords(ownScript) : 0;
  const length = writeOwn ? ownScriptMinutes(ownScript, language) : minutes;
  const [models, setModels] = useState<SettingsResp["models"]>([]);
  const [media, setMedia] = useState<File[]>([]);
  const [music, setMusic] = useState<File | null>(null);
  const [sfxFiles, setSfxFiles] = useState<File[]>([]);
  const [est, setEst] = useState<(Estimate & { threshold: number }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Estimate | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    api<SettingsResp>("/api/settings").then((d) => {
      setTheme(d.settings.defaultTheme || "investigative");
      setSfxLevel(d.settings.defaultSfxLevel || "normal");
      setModel(d.settings.model);
      setModels(d.models);
      if (d.settings.defaultVoiceId) setVoiceId(d.settings.defaultVoiceId);
      // Last choice wins; otherwise use the Claude app when there is no API key.
      let saved: string | null = null;
      try {
        saved = localStorage.getItem("docuforge.scriptSource");
      } catch {
        /* storage unavailable */
      }
      setScriptSource(saved === "api" || saved === "app" ? saved : d.keys.ANTHROPIC_API_KEY ? "api" : "app");
    });
    api<Voice[]>("/api/voices").then(
      (v) => {
        setVoices(v);
        setVoiceId((cur) => cur || v[0]?.voice_id || "");
      },
      (e) => setVoiceError(e.message),
    );
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api<Estimate & { threshold: number }>("/api/estimate", { method: "POST", json: { minutes: length, sfxLevel, musicMood: mood, model, scriptSource } }).then(setEst, () => {});
    }, 250);
    return () => clearTimeout(t);
  }, [length, sfxLevel, mood, model, scriptSource]);

  const voice = voices.find((v) => v.voice_id === voiceId);
  const preview = () => {
    if (!voice?.preview_url) return;
    if (playing) {
      audio.current?.pause();
      setPlaying(false);
      return;
    }
    audio.current?.pause();
    audio.current = new Audio(voice.preview_url);
    audio.current.onended = () => setPlaying(false);
    audio.current.play().then(() => setPlaying(true), () => setPlaying(false));
  };

  const submit = async (confirmed = false) => {
    setError(null);
    const urls = sources
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const bad = urls.filter((u) => !/^https?:\/\/\S+\.\S+/.test(u));
    if (bad.length) return setError(`These source links aren't valid URLs: ${bad.join(", ")}`);
    if (!voiceId) return setError("Choose a voice. Voices load from ElevenLabs once ELEVENLABS_API_KEY is set.");
    if (writeOwn && !ownWords) return setError("Paste your script, or choose “Claude writes it”.");
    setBusy(true);
    try {
      const options = { topic, angle, minutes: length, ownScript: writeOwn ? ownScript : "", format, voiceId, voiceName: voice?.name ?? "", language, tone, theme, musicMood: mood, sfxLevel, sourceUrls: urls, pauseForApproval: pause, model, scriptSource };
      const { id } = await api<{ id: string }>("/api/projects", { method: "POST", json: { options, confirm: confirmed } });
      const upload = async (kind: string, files: File[]) => {
        if (!files.length) return;
        const fd = new FormData();
        fd.set("kind", kind);
        files.forEach((f) => fd.append("files", f));
        await fetch(`/api/projects/${id}/upload`, { method: "POST", body: fd });
      };
      await upload("media", media);
      if (music) await upload("music", [music]);
      if (sfxFiles.length) {
        const fd = new FormData();
        sfxFiles.forEach((f) => fd.append("files", f));
        fd.set("tags", "uploaded");
        await fetch("/api/sfx", { method: "POST", body: fd });
      }
      router.push(`/projects/${id}`);
    } catch (e) {
      const err = e as Error & { status?: number; data?: { estimate?: Estimate } };
      if (err.status === 409 && err.data?.estimate) setConfirm(err.data.estimate);
      else setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="max-w-6xl">
      <h1 className="font-serif text-3xl font-semibold tracking-tight mb-7">New video</h1>
      <div className="grid gap-8 lg:grid-cols-[1fr_320px] items-start">
        <form
          className="flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Panel className="p-5 flex flex-col gap-5">
            <Field label="Topic" htmlFor="topic">
              <input id="topic" required minLength={2} className={`${inputCls} text-base`} placeholder="The collapse of FTX" value={topic} onChange={(e) => setTopic(e.target.value)} />
            </Field>
            <Field label="Script">
              <div className="inline-flex rounded-md border border-line overflow-hidden w-fit">
                {(
                  [
                    [false, "Claude writes it"],
                    [true, "I’ll write my own"],
                  ] as const
                ).map(([own, label]) => (
                  <button type="button" key={label} onClick={() => setWriteOwn(own)} aria-pressed={writeOwn === own} className={`px-3 py-1.5 text-sm border-r last:border-r-0 border-line ${writeOwn === own ? "bg-ink text-white" : "bg-panel"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </Field>
            {writeOwn && (
              <Field
                label="Your script"
                htmlFor="ownScript"
                hint={
                  <>
                    Exactly what the narrator says; your words are never rewritten. Start a line with <code>#</code> to begin a chapter (the heading isn’t spoken). Claude researches and sources the facts in it, flags lines it can’t verify, and plans visuals, sound and YouTube metadata around it.
                    {ownWords > 0 && (
                      <span className="block mt-1 tabular">
                        {ownWords} words ≈ {length} min
                      </span>
                    )}
                  </>
                }
              >
                <textarea id="ownScript" rows={12} className={inputCls} placeholder={"In November 2022, eight billion dollars vanished in a week.\n\n# The rise\nSam Bankman-Fried…"} value={ownScript} onChange={(e) => setOwnScript(e.target.value)} />
              </Field>
            )}
            <Field label={writeOwn ? "Notes for the research" : "Angle or key points to include"} hint={writeOwn ? "Optional. Anything the research should look into or double-check." : "Optional. What should the video focus on or make sure to cover?"} htmlFor="angle">
              <textarea id="angle" rows={3} className={inputCls} placeholder={writeOwn ? "Double-check the deposit figures and find photos of the Bahamas office." : "Focus on how customer deposits were moved to Alameda, and where the case stands today."} value={angle} onChange={(e) => setAngle(e.target.value)} />
            </Field>
            {!writeOwn && (
            <Field label="Length" hint="Script length, voiceover and pacing are sized to this.">
              <div className="flex items-center gap-4">
                <input type="range" min={0.5} max={20} step={0.5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="flex-1 accent-cobalt" aria-label="Length in minutes" />
                <div className="flex items-center gap-2">
                  <input type="number" min={0.5} max={20} step={0.5} value={minutes} onChange={(e) => setMinutes(Math.min(20, Math.max(0.5, Number(e.target.value) || 0.5)))} className={`${inputCls} w-20 tabular`} aria-label="Minutes" />
                  <span className="text-sm text-sub">min</span>
                </div>
              </div>
            </Field>
            )}
            <Field label="Format">
              <div className="flex gap-3">
                {(["16:9", "9:16"] as const).map((f) => (
                  <button
                    type="button"
                    key={f}
                    onClick={() => setFormat(f)}
                    aria-pressed={format === f}
                    className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${format === f ? "border-cobalt bg-cobalt-soft" : "border-line bg-panel"}`}
                  >
                    <span className={`block border-2 border-current rounded-sm ${f === "16:9" ? "w-8 h-[18px]" : "w-[18px] h-8"}`} />
                    {f === "16:9" ? "16:9 YouTube" : "9:16 Shorts, TikTok, Reels"}
                  </button>
                ))}
              </div>
            </Field>
            <div>
              <Field label={writeOwn ? "Who does the research and scene planning" : "Who writes the research and script"}>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      { id: "app", title: "Claude app (your Pro plan)", body: "Free. You copy a prompt into claude.ai and paste the reply back. Photos are matched by caption, so check them before rendering." },
                      { id: "api", title: "Claude API", body: writeOwn ? "Fully automatic, with photo verification. Needs API credit." : "Fully automatic, with fact-check, photo verification and length fitting. Needs API credit." },
                    ] as const
                  ).map((o) => (
                    <label key={o.id} className={`flex gap-3 rounded-md border px-3 py-2.5 cursor-pointer text-sm ${scriptSource === o.id ? "border-cobalt bg-cobalt-soft" : "border-line bg-panel"}`}>
                      <input
                        type="radio"
                        name="scriptSource"
                        className="mt-1 accent-cobalt"
                        checked={scriptSource === o.id}
                        onChange={() => {
                          setScriptSource(o.id);
                          try {
                            localStorage.setItem("docuforge.scriptSource", o.id);
                          } catch {
                            /* storage unavailable */
                          }
                        }}
                      />
                      <span>
                        <span className="font-medium">{o.title}</span>
                        <span className="block text-sub">{o.body}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </Field>
            </div>
            {scriptSource === "api" && (
              <Field label="Claude model">
                <select className={`${inputCls} sm:max-w-sm`} value={model} onChange={(e) => setModel(e.target.value)}>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </Panel>

          <Panel className="p-5 grid gap-5 sm:grid-cols-2">
            {voiceError ? (
              // Voices can't be listed (e.g. the key lacks "Voices: Read"); speech still works with a known voice ID.
              <Field label="Voice ID" hint={<>{voiceError} Paste a voice ID from elevenlabs.io → Voices (⋯ → Copy voice ID), or enable “Voices: Read” on your key to get the list.</>} htmlFor="voiceId">
                <input id="voiceId" className={inputCls} placeholder="e.g. JBFqnCBsd6RMkjVDRZzb" value={voiceId} onChange={(e) => setVoiceId(e.target.value.trim())} />
              </Field>
            ) : (
              <Field label="Voice" hint={voice?.labels ? Object.values(voice.labels).join(", ") : undefined}>
                <div className="flex gap-2">
                  <select className={inputCls} value={voiceId} onChange={(e) => setVoiceId(e.target.value)} disabled={!voices.length}>
                    {!voices.length && <option value="">Loading voices…</option>}
                    {voices.map((v) => (
                      <option key={v.voice_id} value={v.voice_id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                  <Button type="button" onClick={preview} disabled={!voice?.preview_url} aria-label={playing ? "Stop preview" : "Play voice preview"}>
                    {playing ? "■" : "▶"}
                  </Button>
                </div>
              </Field>
            )}
            <Field label="Narration language">
              <input className={inputCls} value={language} onChange={(e) => setLanguage(e.target.value)} list="langs" />
              <datalist id="langs">
                {["English", "Spanish", "French", "German", "Italian", "Portuguese", "Dutch", "Polish", "Arabic", "Hindi", "Japanese", "Korean", "Chinese"].map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </Field>
            <Field label="Tone">
              <div className="flex flex-wrap gap-2">
                {TONES.map((t) => (
                  <button type="button" key={t} onClick={() => setTone(t)} aria-pressed={tone === t} className={`rounded-full border px-3 py-1 text-sm ${tone === t ? "border-ink bg-ink text-white" : "border-line bg-panel"}`}>
                    {t}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Sound effects">
              <div className="inline-flex rounded-md border border-line overflow-hidden w-fit">
                {SFX.map((s) => (
                  <button type="button" key={s.id} onClick={() => setSfxLevel(s.id)} aria-pressed={sfxLevel === s.id} className={`px-3 py-1.5 text-sm border-r last:border-r-0 border-line ${sfxLevel === s.id ? "bg-ink text-white" : "bg-panel"}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Visual theme">
              <div className="flex flex-col gap-2">
                {THEMES.map((t) => (
                  <label key={t.id} className={`flex items-center gap-3 rounded-md border px-3 py-2 cursor-pointer text-sm ${theme === t.id ? "border-cobalt bg-cobalt-soft" : "border-line bg-panel"}`}>
                    <input type="radio" name="theme" className="sr-only" checked={theme === t.id} onChange={() => setTheme(t.id)} />
                    <span className="flex overflow-hidden rounded-sm border border-black/10" aria-hidden>
                      {t.colors.map((c) => (
                        <span key={c} className="block w-5 h-5" style={{ background: c }} />
                      ))}
                    </span>
                    {t.name}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Music mood" hint="Describe it freely, or pick one. “none” means no music.">
              <input className={inputCls} value={mood} onChange={(e) => setMood(e.target.value)} />
              <div className="flex flex-wrap gap-1.5 mt-1">
                {MOODS.map((m) => (
                  <button type="button" key={m} onClick={() => setMood(m)} className={`rounded-full border px-2.5 py-0.5 text-xs ${mood === m ? "border-ink bg-ink text-white" : "border-line bg-panel text-sub"}`}>
                    {m}
                  </button>
                ))}
              </div>
            </Field>
          </Panel>

          <Panel className="p-5 grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Sources research must use" hint="Optional. One link per line." htmlFor="sources">
                <textarea id="sources" rows={3} className={inputCls} placeholder="https://www.sec.gov/…" value={sources} onChange={(e) => setSources(e.target.value)} />
              </Field>
            </div>
            <Field label="Your images and clips" hint={media.length ? `${media.length} file(s) — matched to scenes automatically` : "jpg, png, webp, mp4, mov"}>
              <input type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" onChange={(e) => setMedia([...(e.target.files ?? [])])} className="text-sm text-sub file:mr-3 file:rounded-md file:border file:border-line file:bg-panel file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:border-ink/40" />
            </Field>
            <Field label="Your music track" hint={music ? "Used instead of generated music" : "Optional mp3, wav or m4a"}>
              <input type="file" accept="audio/*" onChange={(e) => setMusic(e.target.files?.[0] ?? null)} className="text-sm text-sub file:mr-3 file:rounded-md file:border file:border-line file:bg-panel file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:border-ink/40" />
            </Field>
            <Field label="Your sound effects" hint="Added to the sound library for every video">
              <input type="file" multiple accept="audio/*" onChange={(e) => setSfxFiles([...(e.target.files ?? [])])} className="text-sm text-sub file:mr-3 file:rounded-md file:border file:border-line file:bg-panel file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:border-ink/40" />
            </Field>
            <label className="sm:col-span-2 flex items-start gap-3 text-sm cursor-pointer">
              <input type="checkbox" checked={pause} onChange={(e) => setPause(e.target.checked)} className="mt-0.5 size-4 accent-cobalt" />
              <span>
                <span className="font-medium">Pause for script approval</span>
                <span className="block text-sub">Review and edit the script before any voice credits are spent, and check the stills before the final render.</span>
              </span>
            </label>
          </Panel>
          <ErrorNote error={error} />
        </form>

        <aside className="lg:sticky lg:top-8">
          <Panel className="p-5">
            <h2 className="font-semibold mb-1">Estimate</h2>
            {est ? (
              <>
                <p className="font-serif text-4xl tabular mb-1">{fmtUsd(est.usd)}</p>
                <p className="text-sm text-sub mb-4">About {est.minutesToBuild} minutes to build</p>
                <ul className="text-sm divide-y divide-line border-y border-line mb-4">
                  {est.lines.map((l) => (
                    <li key={l.label} className="flex justify-between gap-3 py-1.5">
                      <span>
                        {l.label}
                        {l.detail && <span className="block text-xs text-sub">{l.detail}</span>}
                      </span>
                      <span className="tabular shrink-0">{fmtUsd(l.usd)}</span>
                    </li>
                  ))}
                </ul>
                {est.usd > est.threshold && <p className="text-xs text-warn mb-3">Above your {fmtUsd(est.threshold)} limit — you’ll be asked to confirm.</p>}
              </>
            ) : (
              <p className="text-sm text-sub mb-4">Calculating…</p>
            )}
            <Button variant="primary" className="w-full justify-center" busy={busy} disabled={topic.trim().length < 2} onClick={() => submit()}>
              Generate video
            </Button>
            <p className="text-xs text-sub mt-3">Actual costs are tracked per API call on the project page.</p>
          </Panel>
        </aside>
      </div>

      {confirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal>
          <Panel className="max-w-sm p-6">
            <h2 className="font-semibold mb-2">Spend about {fmtUsd(confirm.usd)}?</h2>
            <p className="text-sm text-sub mb-5">This video is estimated above your cost limit in Settings.</p>
            <div className="flex gap-2 justify-end">
              <Button onClick={() => setConfirm(null)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => {
                  setConfirm(null);
                  submit(true);
                }}
              >
                Generate anyway
              </Button>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
