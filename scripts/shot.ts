// Dev helper: screenshot app pages after they've had time to load data (uses Remotion's headless Chrome via CDP).
// Usage: npx tsx scripts/shot.ts <outDir> <waitMs> <path> [path…]   e.g. scripts/shot.ts data/shots 4000 / /new "projects/abc?tab=video"
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [outDir, waitMs, ...pages] = process.argv.slice(2);
const find = (d: string): string | null => {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) {
      const r = find(p);
      if (r) return r;
    } else if (f.name === "chrome-headless-shell.exe" || f.name === "chrome-headless-shell") return p;
  }
  return null;
};
const chrome = find("node_modules/.remotion")!;
const port = 9333;
const H = Number(process.env.SHOT_HEIGHT ?? 1400);
const proc = spawn(chrome, ["--headless", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`, "--window-size=1440,1400", "about:blank"], { stdio: "ignore" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let targets: { webSocketDebuggerUrl: string; type: string }[] = [];
for (let i = 0; i < 50 && !targets.length; i++) {
  await sleep(200);
  targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => []);
}
const ws = new WebSocket(targets.find((t) => t.type === "page")!.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let n = 0;
const pending = new Map<number, (v: unknown) => void>();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(String(e.data));
  if (m.id && pending.has(m.id)) pending.get(m.id)!(m.result ?? m.error);
});
const send = (method: string, params: object = {}) =>
  new Promise<Record<string, unknown>>((res) => {
    const id = ++n;
    pending.set(id, res as (v: unknown) => void);
    ws.send(JSON.stringify({ id, method, params }));
  });
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: H, deviceScaleFactor: 1, mobile: false });
fs.mkdirSync(outDir, { recursive: true });
for (const p of pages) {
  await send("Page.navigate", { url: `http://localhost:3000/${p.replace(/^\//, "")}` });
  await sleep(Number(waitMs));
  if (p.includes("#click=")) {
    const label = decodeURIComponent(p.split("#click=")[1]);
    await send("Runtime.evaluate", { expression: `[...document.querySelectorAll('button,[role=tab]')].find(b=>b.textContent.trim()===${JSON.stringify(label)})?.click()` });
    await sleep(Number(waitMs));
  }
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const name = (p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home") + ".png";
  fs.writeFileSync(path.join(outDir, name), Buffer.from(r.data as string, "base64"));
  console.log(name);
}
ws.close();
proc.kill();
process.exit(0);
