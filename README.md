# DocuForge

Turn a topic into a finished faceless documentary: researched and fact-checked script, voiceover, music, sound design, real archive photos plus stock footage, motion graphics, captions, thumbnail and YouTube metadata. Runs on your own computer.

## Requirements

- **Node.js 20.11 or newer** (developed and tested on Node 24.14).
- **ffmpeg + ffprobe on your PATH** (used for audio measurement, music crossfades and the final loudness pass).
  - Windows: `winget install Gyan.FFmpeg`, then open a new terminal.
  - macOS: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg`
  - Check with `ffmpeg -version`. Settings shows ✓/✗ for ffmpeg too.
- About 2 GB of free disk space (Remotion downloads its own headless Chrome on first render, ~120 MB).

## Setup

```bash
npm install
cp .env.example .env      # Windows PowerShell: Copy-Item .env.example .env
```

Fill in `.env`:

| Key | Where to get it | Used for |
|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys | Research (web search), script, fact-check, image verification (vision), length fitting, YouTube metadata |
| `ELEVENLABS_API_KEY` | elevenlabs.io → Developers → API keys | Voices, text-to-speech with timestamps, music, sound effects |
| `PIXABAY_API_KEY` | pixabay.com/api/docs (free, shown when logged in) | Stock video and photos |

Keys are read only on the server. The browser never receives them; Settings shows only ✓/✗.

`.env` is in `.gitignore`. Never commit it.

## Run

```bash
npm run dev
```

This starts both processes:

- **web**: the site at http://localhost:3000
- **worker**: picks up jobs from the database and runs the pipeline, so long renders never block the website. It also serves `/data` to the renderer on `127.0.0.1:3939` (change with `ASSET_PORT`).

Restart `npm run dev` after editing `.env`. Then open **Settings** and click **Test connection** for each key.

Production-style: `npm run build && npm start`. To run only the worker: `npm run worker`.

## Using it

1. **New video**: topic, optional angle, length (0.5–20 min), format (16:9 or 9:16), voice (▶ to preview), language, tone, theme, music mood, sound-effect intensity, optional uploads and required source URLs. The estimate panel shows cost and time before you click **Generate video**. Above the limit in Settings, you're asked to confirm.
2. **Research** → **Script** run automatically. With *Pause for script approval* on, the project stops at **Approval**: edit narration, scene types, emphasis words, visuals and sound cues; use *Regenerate this scene*, *Make it shorter/longer*; then **Approve & continue**. No voice credits are spent before this.
3. **Voice → Music → Sound effects → Visuals** run next. On the **Images** tab you can swap any image for another candidate.
4. **QA stills**: one frame from every scene. Swap anything that looks off, then **Render video**.
5. **Video & downloads**: video.mp4, captions.srt, thumbnail.png, youtube.md, research.json, script.json, credits.json. You can also **Re-render** or **Duplicate with new topic**.

### Claude app mode (no Claude API cost)

The Claude API is billed separately from a Claude Pro/Max subscription. To use your subscription instead, choose **Claude app (your Pro plan)** under *Who writes the research and script*. The project then pauses at the start and shows three steps:

1. **Copy prompt.** It already contains your topic, length, tone, scene types and all the writing rules.
2. Open a new chat at claude.ai with **web search on**, paste the prompt and send it. For long videos, say “continue” until the JSON is finished.
3. **Paste the whole reply** (all parts, chat text in between is fine) and click **Import reply**.

DocuForge then checks that every source link actually exists. Invented or dead links are removed, and claims without two working independent sources are dropped. Lines that relied on those claims are flagged in red on the Script tab. Everything after the script (voice, music, SFX, visuals, render) runs as normal. The YouTube titles, description and tags come from the same reply.

In this mode no Claude API calls are made at all, so these API-only extras are off:

- the automatic fact-check rewrite
- *Regenerate / shorter / longer* (you edit the text directly)
- automatic length fitting
- photo verification (photos are matched by caption, so check the **Images** tab before rendering)
- upload matching (it goes by filename instead: name files after their subject, e.g. `sam-bankman-fried-2022.jpg`)

To start over with a new reply, use *Paste a new reply from the Claude app* on the Research tab.

### Your own script

Under **Script**, choose **I’ll write my own** and paste your narration. It is spoken exactly as written and is never rewritten, trimmed or translated. The video length comes from your word count. Start a line with `#` to begin a chapter (the heading itself isn't spoken).

DocuForge splits your text into scenes (whole sentences, never across paragraphs). Claude, through the API or the Claude app prompt, then does everything around your words:

- researches and sources the facts in your script (same two-independent-sources rule)
- lists lines the research contradicts or can't confirm under *Lines in your script to check* on the Research tab, and flags those scenes in red on the Script tab
- picks the scene type, photo and footage searches, sound cues and emphasis words for every scene
- writes the title, thumbnail text and YouTube metadata

You decide whether to change a flagged line. The automatic fact-check rewrite and voice length fitting are off in this mode.

If a step fails, its frame in the step strip turns red with the error and a **Retry from this step** button. You can retry from any finished step by clicking its frame.

## How it works

```
research → script → approval → voice → music → sfx → visuals → QA stills → render → outputs
```

- Each step writes its output into `data/projects/<id>/` and records a hash of its inputs. Re-running skips any step whose inputs haven't changed.
- **No paid call is ever repeated for unchanged inputs.** Claude responses, TTS, music and downloads are cached by input hash in `data/cache/`. Editing one scene re-voices only that scene.
- **Research** uses Claude's web search and web fetch tools. A claim needs at least two independent, actually-visited sources. URLs that Claude didn't really see are discarded, and unverifiable claims are dropped (listed on the Research tab).
- **Script**: about 150 words per minute (adjusted per language) and one scene per 6–10 s. Structure scales with length; videos of 6+ minutes get chapters, written chapter by chapter. A second Claude pass fact-checks every line against the research and rewrites unsupported lines. Unverifiable "social posts" are converted to plain statements.
- **Voice**: ElevenLabs text-to-speech *with timestamps*, using previous/next text for natural intonation. Character alignment is converted to word timings. If the total is more than ±10% off target, Claude rewrites only specific scenes and only those are re-voiced (up to two rounds).
- **Music**: one ElevenLabs track that builds toward the climax. Videos over 10 minutes get one cue per chapter, crossfaded. If your plan lacks music it continues without it; you can upload a track instead.
- **Sound effects**: a reusable library in `data/sfx/`, indexed in SQLite by normalised key (`whoosh_fast_airy`, `rubber_stamp_slam`, …). The starter pack is generated once on first use; common sounds get 2–3 variations. Cues come from the script plus automatic cues per scene type, and land on the exact spoken word.
- **Visuals**: your uploads (matched to scenes by Claude) → Wikimedia Commons → images in the research articles (`og:image`, figures) → web search. The scraper is polite (≤2 req/s per domain, retries, timeouts). Images under 800 px are skipped and near-duplicates removed. Claude vision checks each candidate shows the right subject and returns a bounding box used for subject-aware cropping and Ken Burns zooms. Generic scenes use Pixabay video (then photos). Every asset goes into credits.json.
- **Render**: one Remotion composition, `Documentary`, driven entirely by `project.json`. It has 12 scene types, 3 themes, and a film grade (desaturation, contrast, vignette, grain). The 4-layer mix: voice; music at −20 dB, lifted in pauses, ducked under hits and silent before the big reveal; SFX at −14 to −22 dB, lowered further where they overlap speech. The final pass brings audio to −14 LUFS integrated with true peak ≤ −1 dBTP.

## Project layout

```
src/app/            Next.js pages and API routes
src/components/     UI components (project page pieces in components/project/)
src/lib/            shared: db, schemas (zod), API clients, scraper, sfx library, ffmpeg, cost
src/worker/         job loop, step runner, pipeline steps, Remotion rendering
remotion/           Documentary + Thumbnail compositions, scenes, themes
data/               (gitignored) SQLite db, projects, sfx library, caches
scripts/            dev/test helpers (see below)
```

## Test and dev helpers

| Command | What it does |
|---|---|
| `npm run studio` | Remotion Studio with sample props for every scene type |
| `npx tsx scripts/render-sample.ts data/sample 16:9 investigative [--video]` | Render stills (and optionally an MP4) of all 12 scene types; no keys needed |
| `npx tsx scripts/offline-e2e.ts [16:9\|9:16] [theme] [--mix]` | End-to-end run **without paid keys**: fixture research/script, Windows speech voice, then real visuals, QA stills, render, loudness and outputs. Needs the worker's asset server running. `--mix` also needs `scripts/fake-audio.ts` first |
| `npx tsx scripts/fake-audio.ts data/test-music.mp3 90` | Fill the SFX library with synthesized placeholder sounds and make a music bed (for `--mix`) |
| `npx tsx scripts/remove-placeholders.ts` | **Run after testing**, so placeholders aren't used in real videos |
| `npx tsx scripts/resume.ts <projectId>` | Run a project's pipeline in-process |
| `npx tsx scripts/test-app-import.ts` | Test Claude-app mode: pause for paste, messy two-part reply, dead-link removal (delete the test project afterwards with `scripts/delete-project.ts <id>`) |
| `npm run typecheck` | TypeScript check |

## Costs

The estimate before generating covers Claude tokens (including web searches at $10/1,000 and vision), ElevenLabs characters, music minutes and new sound effects. Actual costs are recorded per API call and shown on the project page. ElevenLabs bills in plan credits, so set your real $ rates in Settings for accurate numbers.

## Troubleshooting

- **"X_API_KEY is not set"**: add it to `.env` and restart `npm run dev`.
- **Project stays "Queued"**: the worker isn't running. Use `npm run dev`, which starts both processes, or run `npm run worker`.
- **Render fails to load assets**: another process may be using port 3939. Set `ASSET_PORT=3940` in `.env`.
- **Music skipped**: your ElevenLabs plan may not include the Music API. Upload a track on the project's Progress tab and retry from Music.
- **Wikimedia 429s in the log**: normal under load. The scraper backs off and retries.
- **Render too slow or the computer struggles**: lower *Render concurrency* in Settings.
