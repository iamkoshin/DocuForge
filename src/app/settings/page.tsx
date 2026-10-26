"use client";

import { useEffect, useState } from "react";
import { api, Button, ErrorNote, Field, inputCls, Panel } from "@/components/ui";
import type { Settings } from "@/lib/settings";

interface Resp {
  settings: Settings;
  keys: Record<string, boolean>;
  models: { id: string; label: string }[];
  ffmpeg: string | null;
}
interface Voice {
  voice_id: string;
  name: string;
}

const PROVIDERS = [
  { key: "ANTHROPIC_API_KEY", provider: "anthropic", label: "Anthropic (Claude)", use: "Research, script, fact-check, image checks" },
  { key: "ELEVENLABS_API_KEY", provider: "elevenlabs", label: "ElevenLabs", use: "Voiceover, music, sound effects" },
  { key: "PIXABAY_API_KEY", provider: "pixabay", label: "Pixabay", use: "Stock footage and photos" },
  { key: "UNSPLASH_ACCESS_KEY", provider: "unsplash", label: "Unsplash", use: "Optional. High-quality photos for mood and scenery shots" },
  { key: "GEMINI_API_KEY", provider: "gemini", label: "Google Gemini (free)", use: "Optional. Photo checks and matching your uploads without the Claude API" },
] as const;

export default function SettingsPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [tests, setTests] = useState<Record<string, { ok: boolean; message: string } | "busy">>({});
  const [saved, setSaved] = useState(false);
  const [finding, setFinding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Resp>("/api/settings").then((d) => {
      setData(d);
      setS(d.settings);
    }, (e) => setError(e.message));
    api<Voice[]>("/api/voices").then(setVoices, () => {});
  }, []);

  const test = async (provider: string) => {
    setTests((t) => ({ ...t, [provider]: "busy" }));
    const r = await api<{ ok: boolean; message: string }>("/api/settings/test", { method: "POST", json: { provider } }).catch((e) => ({ ok: false, message: e.message }));
    setTests((t) => ({ ...t, [provider]: r }));
  };
  const save = async () => {
    if (!s) return;
    setError(null);
    try {
      await api("/api/settings", { method: "PUT", json: s });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const findModels = async () => {
    setFinding("Testing each Gemini model with one small request…");
    try {
      const { models } = await api<{ models: string[] }>("/api/settings/gemini-models", { method: "POST" });
      if (models.length) set("geminiModels", models);
      setFinding(models.length ? `${models.length} models work on your free tier. Click “Save settings” to keep this list.` : "No model answered. Your daily limits may be used up; try again tomorrow.");
    } catch (e) {
      setFinding((e as Error).message);
    }
  };
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => (p ? { ...p, [k]: v } : p));

  if (!data || !s) return <p className="text-sub text-sm">{error ?? "Loading settings…"}</p>;
  return (
    <div className="max-w-3xl flex flex-col gap-8">
      <h1 className="font-serif text-3xl font-semibold tracking-tight">Settings</h1>

      <Panel className="p-5">
        <h2 className="font-semibold mb-1">API keys</h2>
        <p className="text-sm text-sub mb-4">
          Keys live in the <code className="text-ink">.env</code> file in the project folder and never reach the browser. After editing <code className="text-ink">.env</code>, restart <code className="text-ink">npm run dev</code>.
        </p>
        <ul className="divide-y divide-line">
          {PROVIDERS.map((p) => {
            const present = data.keys[p.key];
            const t = tests[p.provider];
            return (
              <li key={p.key} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className={`grid size-6 place-items-center rounded-full text-xs font-bold ${present ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`} aria-label={present ? "present" : "missing"}>
                  {present ? "✓" : "✗"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{p.label}</div>
                  <div className="text-xs text-sub">
                    {p.key} · {p.use}
                  </div>
                </div>
                <Button size="sm" onClick={() => test(p.provider)} busy={t === "busy"} disabled={!present}>
                  Test connection
                </Button>
                {t && t !== "busy" && <p className={`basis-full text-xs ${t.ok ? "text-ok" : "text-bad"}`}>{t.message}</p>}
              </li>
            );
          })}
          <li className="py-3 flex items-center gap-4">
            <span className={`grid size-6 place-items-center rounded-full text-xs font-bold ${data.ffmpeg ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>{data.ffmpeg ? "✓" : "✗"}</span>
            <div className="text-sm">
              <div className="font-medium">ffmpeg</div>
              <div className="text-xs text-sub">{data.ffmpeg ?? "Not found on PATH — needed for audio and the final render. See the README."}</div>
            </div>
          </li>
        </ul>
      </Panel>

      <Panel className="p-5 grid gap-5 sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">Defaults</h2>
        <Field label="Claude model" hint="Opus writes stronger scripts and costs about twice as much.">
          <select className={inputCls} value={s.model} onChange={(e) => set("model", e.target.value)}>
            {data.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Default voice">
          <select
            className={inputCls}
            value={s.defaultVoiceId}
            onChange={(e) => {
              const v = voices.find((x) => x.voice_id === e.target.value);
              setS((p) => (p ? { ...p, defaultVoiceId: e.target.value, defaultVoiceName: v?.name ?? "" } : p));
            }}
          >
            <option value="">{voices.length ? "Choose a voice" : "Add an ElevenLabs key to load voices"}</option>
            {voices.map((v) => (
              <option key={v.voice_id} value={v.voice_id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Default visual theme">
          <select className={inputCls} value={s.defaultTheme} onChange={(e) => set("defaultTheme", e.target.value)}>
            <option value="investigative">Investigative</option>
            <option value="editorial">Editorial</option>
            <option value="retro-archive">Retro Archive</option>
          </select>
        </Field>
        <Field label="Default sound effects">
          <select className={inputCls} value={s.defaultSfxLevel} onChange={(e) => set("defaultSfxLevel", e.target.value)}>
            <option value="off">Off</option>
            <option value="subtle">Subtle</option>
            <option value="normal">Normal</option>
            <option value="punchy">Punchy</option>
          </select>
        </Field>
        <Field label="Voice model" hint="Multilingual v2 gives the most natural narration.">
          <select className={inputCls} value={s.ttsModel} onChange={(e) => set("ttsModel", e.target.value)}>
            <option value="eleven_multilingual_v2">Eleven Multilingual v2</option>
            <option value="eleven_flash_v2_5">Eleven Flash v2.5 (cheaper)</option>
            <option value="eleven_v3">Eleven v3</option>
          </select>
        </Field>
        <Field label="Voice speed" hint="1 is natural. Up to 1.2 for faster, high-retention narration. Changing it re-voices the next video.">
          <input type="number" min={0.7} max={1.2} step={0.05} className={inputCls} value={s.voiceSpeed} onChange={(e) => set("voiceSpeed", Math.min(1.2, Math.max(0.7, Number(e.target.value) || 1)))} />
        </Field>
        <Field label="Music model">
          <select className={inputCls} value={s.musicModel} onChange={(e) => set("musicModel", e.target.value)}>
            <option value="music_v1">Music v1</option>
            <option value="music_v2">Music v2</option>
            <option value="music_v2_5">Music v2.5</option>
          </select>
        </Field>
        <Field label="Who checks photos" hint="Checks that found photos really show the subject, and matches your uploads to scenes.">
          <select className={inputCls} value={s.photoCheck} onChange={(e) => set("photoCheck", e.target.value as Settings["photoCheck"])}>
            <option value="auto">Claude API when the video uses it, otherwise Gemini</option>
            <option value="gemini">Always Gemini (free)</option>
            <option value="captions">No AI check (match by caption and file name)</option>
          </select>
        </Field>
        <Field label="Gemini models" hint="One per line, best first. Each model has its own free limit; when one runs out, the next takes over.">
          <textarea rows={5} className={`${inputCls} font-mono text-xs`} value={s.geminiModels.join("\n")} onChange={(e) => set("geminiModels", e.target.value.split("\n").map((x) => x.trim()))} onBlur={() => set("geminiModels", s.geminiModels.filter(Boolean))} />
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <Button size="sm" busy={finding?.startsWith("Testing")} disabled={!data.keys.GEMINI_API_KEY} onClick={findModels}>
              Find free models
            </Button>
            {finding && !finding.startsWith("Testing") && <span className="text-xs text-sub">{finding}</span>}
          </div>
        </Field>
        <Field label="Unsplash credits in the YouTube description" hint="Optional under the Unsplash License. The image picker always shows the photographer.">
          <select className={inputCls} value={s.creditUnsplash ? "yes" : "no"} onChange={(e) => set("creditUnsplash", e.target.value === "yes")}>
            <option value="yes">Credit photographers</option>
            <option value="no">Don’t credit</option>
          </select>
        </Field>
        <Field label="Render concurrency" hint="Parallel browser tabs while rendering. Lower it if your computer struggles.">
          <input type="number" min={1} max={16} className={inputCls} value={s.renderConcurrency} onChange={(e) => set("renderConcurrency", Number(e.target.value))} />
        </Field>
        <Field label="Ask before spending more than ($)" hint="Videos estimated above this need a confirmation.">
          <input type="number" min={0} step={1} className={inputCls} value={s.costThresholdUsd} onChange={(e) => set("costThresholdUsd", Number(e.target.value))} />
        </Field>
      </Panel>

      <Panel className="p-5 grid gap-5 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <h2 className="font-semibold">ElevenLabs cost rates</h2>
          <p className="text-sm text-sub">ElevenLabs bills in plan credits. Set what they cost you so estimates are realistic.</p>
        </div>
        <Field label="$ per 1,000 characters">
          <input type="number" step={0.01} className={inputCls} value={s.elevenUsdPer1kChars} onChange={(e) => set("elevenUsdPer1kChars", Number(e.target.value))} />
        </Field>
        <Field label="$ per music minute">
          <input type="number" step={0.05} className={inputCls} value={s.elevenUsdPerMusicMinute} onChange={(e) => set("elevenUsdPerMusicMinute", Number(e.target.value))} />
        </Field>
        <Field label="$ per sound effect">
          <input type="number" step={0.01} className={inputCls} value={s.elevenUsdPerSfx} onChange={(e) => set("elevenUsdPerSfx", Number(e.target.value))} />
        </Field>
      </Panel>

      <ErrorNote error={error} />
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={save}>
          Save settings
        </Button>
        {saved && <span className="text-sm text-ok">Settings saved</span>}
      </div>
    </div>
  );
}
