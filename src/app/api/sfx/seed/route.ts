import { json, route } from "@/lib/api";
import { seedStarterPack } from "@/lib/sfx";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

/** Generate the starter pack (all variations). Already-present sounds are never regenerated. */
export const POST = route(async () => json({ made: await seedStarterPack({ full: true }) }));
