import { db, now } from "@/lib/db";
import { ffmpegAvailable } from "@/lib/ffmpeg";
import { log, updateProject } from "@/lib/projects";
import { startAssetServer } from "./assetServer";
import { ASSET_PORT, getBundle } from "./render";
import { runPipeline } from "./runner";

interface JobRow {
  id: number;
  project_id: string;
  from_step: string | null;
}

async function main() {
  const ff = await ffmpegAvailable();
  if (!ff) console.error("[worker] ffmpeg not found on PATH — audio measurement, music and rendering will fail. See README.");
  else console.log(`[worker] ${ff}`);

  startAssetServer(ASSET_PORT);
  console.log(`[worker] asset server on http://127.0.0.1:${ASSET_PORT}`);

  // Jobs/steps left "running" by a crashed or stopped worker go back to the queue.
  const stale = db().prepare("SELECT * FROM jobs WHERE status = 'running'").all() as JobRow[];
  for (const j of stale) {
    db().prepare("UPDATE jobs SET status = 'queued' WHERE id = ?").run(j.id);
    db().prepare("UPDATE steps SET status = 'pending' WHERE project_id = ? AND status = 'running'").run(j.project_id);
    log(j.project_id, "warn", "Worker restarted — resuming from the last unfinished step");
  }

  // Warm the Remotion bundle in the background so the first preview starts quickly.
  getBundle().then(
    () => console.log("[worker] Remotion bundle ready"),
    (e) => console.error("[worker] Remotion bundle failed:", e),
  );

  console.log("[worker] waiting for jobs…");
  for (;;) {
    const job = db().prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY id LIMIT 1").get() as JobRow | undefined;
    if (!job) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    db().prepare("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?").run(now(), job.id);
    console.log(`[worker] job ${job.id} → project ${job.project_id}${job.from_step ? ` (from ${job.from_step})` : ""}`);
    let status = "failed";
    try {
      status = await runPipeline(job.project_id);
    } catch (e) {
      console.error(`[worker] job ${job.id} crashed`, e);
      updateProject(job.project_id, { status: "failed" });
      log(job.project_id, "error", `Worker error: ${(e as Error).message}`);
    }
    // A job superseded while running (e.g. user clicked retry) was marked cancelled; leave it so.
    db().prepare("UPDATE jobs SET status = ?, finished_at = ? WHERE id = ? AND status = 'running'").run(status === "failed" ? "failed" : "done", now(), job.id);
  }
}

process.on("unhandledRejection", (e) => console.error("[worker] unhandled rejection", e));
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

