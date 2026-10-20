import { json, route } from "@/lib/api";
import { testAnthropic } from "@/lib/clients/anthropic";
import { getSubscription, listVoices, missingPermission } from "@/lib/clients/elevenlabs";
import { HttpError } from "@/lib/http";
import { testPixabay } from "@/lib/clients/pixabay";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const { provider } = (await req.json()) as { provider: "anthropic" | "elevenlabs" | "pixabay" };
  try {
    let message = "";
    if (provider === "anthropic") message = await testAnthropic();
    else if (provider === "elevenlabs") {
      try {
        const s = await getSubscription();
        message = `ElevenLabs OK — ${s.tier} plan, ${s.character_count.toLocaleString()} / ${s.character_limit.toLocaleString()} credits used this period`;
      } catch (e) {
        // Restricted keys often lack "User: Read" (user_read). That's only needed to show credit usage,
        // so fall back to the voices list, which the app really does need.
        if (!(e instanceof HttpError && e.status === 401 && e.body?.includes("user_read"))) throw e;
        const voices = await listVoices();
        message = `ElevenLabs OK — ${voices.length} voices available. (This key can't read your plan/credit usage; add the “User: Read” permission if you want that shown here.)`;
      }
    } else if (provider === "pixabay") message = await testPixabay();
    else return json({ ok: false, message: "Unknown provider" }, 400);
    return json({ ok: true, message });
  } catch (e) {
    return json({ ok: false, message: missingPermission(e) ?? (e as Error).message });
  }
});
