import { getLogs, snapshot } from "@/lib/projects";

export const dynamic = "force-dynamic";

/** Server-sent events: pushes a project snapshot whenever it changes, plus new log lines. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream({
    start(controller) {
      let last = "";
      let lastLog = 0;
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const tick = () => {
        try {
          const snap = snapshot(id);
          if (!snap) return;
          const s = JSON.stringify(snap);
          if (s !== last) {
            last = s;
            send("snapshot", snap);
          }
          const logs = getLogs(id, lastLog);
          if (logs.length) {
            lastLog = logs[logs.length - 1].id;
            send("logs", logs);
          }
        } catch {
          /* DB busy; next tick */
        }
      };
      tick();
      timer = setInterval(tick, 1000);
      req.signal.addEventListener("abort", () => {
        if (timer) clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
