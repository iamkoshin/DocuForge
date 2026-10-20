// Remove the synthesized placeholder sounds created by scripts/fake-audio.ts.
import { db } from "../src/lib/db";
import { deleteSfx } from "../src/lib/sfx";
const rows = db().prepare("SELECT id FROM sfx WHERE tags LIKE '%placeholder%'").all() as { id: string }[];
for (const r of rows) deleteSfx(r.id);
console.log(`removed ${rows.length} placeholder sounds`);
