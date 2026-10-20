import { claudeJson, claudeResearch, hostOf, normUrl } from "@/lib/clients/anthropic";
import * as z from "zod";
import { DomainLimiter, mapLimit, USER_AGENT } from "@/lib/http";
import { ResearchSchema, type Research, type Source } from "@/lib/schemas";
import type { StepCtx, StepDef } from "../context";
import type { AppImport } from "./appImport";

const SYSTEM = `You are a meticulous investigative researcher preparing source material for a factual documentary video.
Standards:
- Verify every claim against at least two independent sources (different publishers). Prefer primary sources (court filings, regulator releases, company statements, official statistics) and major outlets with editorial standards.
- Never rely on content farms, AI-generated sites, or unsourced social posts.
- If a claim can only be found in one place, say so explicitly; if sources conflict, report the disagreement.
- Record exact figures with units and dates. Record full names and roles.
- Always establish the CURRENT status of the story (latest developments, with dates).
- Today's date is ${new Date().toISOString().slice(0, 10)}.`;

/** Own-script mode: the creator already wrote the narration; research backs it up instead of replacing it. */
function ownScriptResearchPrompt(o: { topic: string; angle: string; sourceUrls: string[]; ownScript: string }) {
  return `A creator has written their own narration for a documentary video about "${o.topic}". Do NOT write or rewrite the script. Your job is to research it.
${o.angle ? `Notes from the creator: ${o.angle}\n` : ""}${
    o.sourceUrls.length ? `The creator requires these sources to be read and used (fetch each one):\n${o.sourceUrls.map((u) => `- ${u}`).join("\n")}\n` : ""
  }
THE CREATOR'S SCRIPT:
"""
${o.ownScript.trim()}
"""

Search the web thoroughly, then write detailed research notes containing:
1. CLAIMS — numbered list of every factual statement the script makes (names, dates, numbers, events, quotes), each phrased as one checkable fact. For EACH claim list at least two independent sources as URL + title + publisher. Mark claims you could only verify once as SINGLE-SOURCE.
2. SCRIPT PROBLEMS — every line of the script that is wrong, outdated, exaggerated or that you could not verify: quote the line exactly and say what the sources actually show.
3. KEY PLAYERS mentioned or implied — full names and roles (and how their name appears in photo captions), so photos can be found.
4. KEY PLACES, ORGANIZATIONS and EVENTS mentioned, with dates.
5. KEY NUMBERS — exact figures with units, dates and what they measure.
6. TIMELINE — dated events in order.
7. CURRENT STATUS — where the story stands today, with date and sources.
Cite exact URLs you actually visited or saw in search results. Do not invent URLs.`;
}

function researchPrompt(o: { topic: string; angle: string; minutes: number; language: string; sourceUrls: string[] }) {
  const depth = o.minutes <= 1.5 ? "focused (the essential facts only)" : o.minutes <= 6 ? "solid (context, key turns, key numbers)" : "deep (full chronology, chapters' worth of material, secondary players)";
  return `Research this documentary topic: "${o.topic}".
${o.angle ? `Angle / key points the creator wants covered: ${o.angle}\n` : ""}${
    o.sourceUrls.length ? `The creator requires these sources to be read and used (fetch each one):\n${o.sourceUrls.map((u) => `- ${u}`).join("\n")}\n` : ""
  }Target video length: ${o.minutes} minutes, so research depth should be ${depth}.
Narration language will be ${o.language}, but research in whatever language gives the best sources.

Search the web thoroughly, then write detailed research notes containing:
1. TIMELINE — dated events in order.
2. KEY PLAYERS — full names and roles (and how their name appears in photo captions).
3. KEY PLACES, ORGANIZATIONS and EVENTS.
4. KEY NUMBERS — exact figures with units, dates and what they measure.
5. CLAIMS — numbered list of factual claims the documentary could make. For EACH claim list at least two independent sources as URL + title + publisher. Mark claims you could only verify once as SINGLE-SOURCE.
6. CURRENT STATUS — where the story stands today, with date and sources.
Cite exact URLs you actually visited or saw in search results. Do not invent URLs.`;
}

/** Keep only sources Claude actually saw (or the creator supplied); dedupe by publisher. */
function verifySources(sources: Source[], seen: Map<string, Source>, userUrls: Set<string>) {
  const out: Source[] = [];
  const hosts = new Set<string>();
  for (const s of sources) {
    const n = normUrl(s.url);
    const real = seen.get(n) ?? (userUrls.has(n) ? s : undefined);
    if (!real) continue;
    const host = hostOf(s.url);
    if (hosts.has(host)) continue;
    hosts.add(host);
    out.push({ url: s.url, title: s.title || real.title, publisher: s.publisher || host });
  }
  return out;
}

/** Does this URL exist? Only definite failures (404/410, DNS/connection errors) count as dead;
 * 401/403/429/5xx usually mean a site blocking bots, so the page is assumed to exist. */
async function urlExists(url: string): Promise<boolean> {
  try {
    if (!/^https?:\/\//i.test(url)) return false;
    await limiter.wait(url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, { redirect: "follow", signal: ctrl.signal, headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*;q=0.8" } });
      res.body?.cancel().catch(() => {});
      return res.status !== 404 && res.status !== 410;
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return (e as Error).name === "AbortError"; // slow site: give it the benefit of the doubt
  }
}
const limiter = new DomainLimiter(2);

/** Claude-app mode: research comes from the pasted reply. Check every source URL exists, then apply the same 2-source rule. */
async function checkImportedResearch(ctx: StepCtx, imported: Research): Promise<Research> {
  const urls = [...new Set([...imported.claims.flatMap((c) => c.sources.map((s) => s.url)), ...imported.currentStatus.sources.map((s) => s.url)])];
  ctx.progress(0.1, `Checking ${urls.length} source links exist…`);
  let done = 0;
  const alive = new Map<string, boolean>();
  await mapLimit(urls, 6, async (u) => {
    alive.set(u, await urlExists(u));
    ctx.progress(0.1 + (0.85 * ++done) / urls.length, `Checking source links ${done}/${urls.length}`);
  });
  const dead = urls.filter((u) => !alive.get(u));
  if (dead.length) ctx.warn(`${dead.length} source link(s) don't exist and were removed (Claude may have guessed them): ${dead.slice(0, 5).join(", ")}${dead.length > 5 ? "…" : ""}`);
  const keepLive = (sources: Source[]) => {
    const hosts = new Set<string>();
    return sources.filter((s) => {
      const h = hostOf(s.url);
      if (!alive.get(s.url) || hosts.has(h)) return false;
      hosts.add(h);
      return true;
    }).map((s) => ({ ...s, publisher: s.publisher || hostOf(s.url), title: s.title || s.url }));
  };
  const checked = imported.claims.map((c) => ({ ...c, sources: keepLive(c.sources) }));
  let kept = checked.filter((c) => c.sources.length >= 2);
  if (kept.length < 5) {
    ctx.warn(`Only ${kept.length} claims have 2+ independent working sources; also keeping single-source claims (flagged on the Research tab).`);
    kept = checked.filter((c) => c.sources.length >= 1);
  }
  if (!kept.length) throw new Error("None of the pasted claims has a working source link. Ask Claude in the app to redo the research with real URLs, then paste again.");
  const keptIds = new Set(kept.map((c) => c.id));
  const dropped = checked.filter((c) => !keptIds.has(c.id)).map((c) => ({ id: c.id, text: c.text, reason: c.sources.length ? "only one independent source" : "no working source link" }));
  return {
    ...imported,
    claims: kept,
    timeline: imported.timeline.map((t) => ({ ...t, claimIds: t.claimIds.filter((id) => keptIds.has(id)) })),
    numbers: imported.numbers.map((n) => ({ ...n, claimIds: n.claimIds.filter((id) => keptIds.has(id)) })).filter((n) => n.claimIds.length),
    currentStatus: { ...imported.currentStatus, sources: keepLive(imported.currentStatus.sources) },
    droppedClaims: dropped,
    allSources: kept.flatMap((c) => c.sources),
  };
}

export const researchStep: StepDef = {
  name: "research",
  inputs: (ctx) =>
    ctx.options.scriptSource === "app"
      ? { mode: "app", imported: ctx.hash("import.json") }
      : {
          topic: ctx.options.topic,
          angle: ctx.options.angle,
          minutes: ctx.options.minutes,
          language: ctx.options.language,
          sources: ctx.options.sourceUrls,
          model: ctx.model,
          ...(ctx.options.ownScript.trim() ? { ownScript: ctx.options.ownScript } : {}), // only when set, so older projects keep their cache
        },
  async run(ctx) {
    const o = ctx.options;
    if (o.scriptSource === "app") {
      const imp = ctx.read<AppImport>("import.json");
      if (!imp) {
        ctx.info("Waiting for the research and script from the Claude app: copy the prompt on this page into Claude, then paste its reply back.");
        return "waiting";
      }
      const research = await checkImportedResearch(ctx, imp.research);
      for (const i of research.scriptIssues ?? []) ctx.warn(`Your script: "${i.quote.slice(0, 120)}" — ${i.problem}`);
      ctx.write("research.json", research);
      ctx.info(`Research imported from the Claude app: ${research.claims.length} verified claims, ${research.droppedClaims?.length ?? 0} dropped`);
      return "done";
    }
    const maxSearches = Math.min(20, 6 + Math.ceil(o.minutes));
    ctx.progress(0.05, `Searching the web (up to ${maxSearches} searches)…`);
    const { notes, seen } = await claudeResearch({
      ctx: { projectId: ctx.id, step: "research", model: ctx.model },
      system: SYSTEM,
      prompt: o.ownScript.trim() ? ownScriptResearchPrompt(o) : researchPrompt(o),
      maxSearches,
    });
    ctx.write("research-notes.md", notes);
    ctx.info(`Web research finished: ${seen.length} distinct sources seen`);
    ctx.progress(0.6, "Structuring research…");

    const seenMap = new Map(seen.map((s) => [normUrl(s.url), s]));
    const userUrls = new Set(o.sourceUrls.map(normUrl));
    const sourceList = [...seen, ...o.sourceUrls.map((u) => ({ url: u, title: u, publisher: hostOf(u) }))]
      .map((s) => `- ${s.url} | ${s.title}`)
      .join("\n");

    const own = !!o.ownScript.trim();
    const raw: Research = await claudeJson({
      ctx: { projectId: ctx.id, step: "research", model: ctx.model },
      label: "research-structure",
      schema: own ? ResearchSchema.extend({ scriptIssues: z.array(z.object({ quote: z.string().describe("The script line, quoted exactly"), problem: z.string() })) }) : ResearchSchema,
      effort: "medium",
      system: "You convert research notes into strict JSON. Use only facts present in the notes. Use only URLs from the provided list of sources actually seen.",
      content: `Topic: ${o.topic}\n\nRESEARCH NOTES:\n${notes}\n\nSOURCES ACTUALLY SEEN (only these URLs may appear in the JSON):\n${sourceList}\n\nProduce the research JSON. Claim ids must be c1, c2, … For each claim include every supporting source from the list. Timeline entries and numbers must reference claim ids.${own ? " scriptIssues lists the SCRIPT PROBLEMS from the notes (empty if none)." : ""}`,
    });
    for (const i of raw.scriptIssues ?? []) ctx.warn(`Your script: "${i.quote.slice(0, 120)}" — ${i.problem}`);

    // Enforce ≥2 independent, real sources per claim. Fall back to single-source only if verification leaves too little.
    const dropped: NonNullable<Research["droppedClaims"]> = [];
    const checked = raw.claims.map((c) => ({ ...c, sources: verifySources(c.sources, seenMap, userUrls) }));
    let kept = checked.filter((c) => c.sources.length >= 2);
    if (kept.length < 5) {
      ctx.warn(`Only ${kept.length} claims have 2+ independent sources; also keeping single-source claims (flagged in the sources table).`);
      kept = checked.filter((c) => c.sources.length >= 1);
    }
    for (const c of checked) if (!kept.includes(c)) dropped.push({ id: c.id, text: c.text, reason: c.sources.length ? "only one independent source" : "no verifiable source" });
    if (!kept.length) throw new Error("Research found no verifiable claims. Try a more specific topic or paste source URLs.");

    const keptIds = new Set(kept.map((c) => c.id));
    const research: Research = {
      ...raw,
      claims: kept,
      timeline: raw.timeline.map((t) => ({ ...t, claimIds: t.claimIds.filter((id) => keptIds.has(id)) })).filter((t) => t.claimIds.length),
      numbers: raw.numbers.map((n) => ({ ...n, claimIds: n.claimIds.filter((id) => keptIds.has(id)) })).filter((n) => n.claimIds.length),
      currentStatus: { ...raw.currentStatus, sources: verifySources(raw.currentStatus.sources, seenMap, userUrls) },
      droppedClaims: dropped,
      allSources: seen,
    };
    ResearchSchema.parse(research);
    ctx.write("research.json", research);
    ctx.info(`Research saved: ${kept.length} verified claims, ${dropped.length} dropped, ${research.players.length} players, ${research.timeline.length} timeline events`);
    return "done";
  },
};

