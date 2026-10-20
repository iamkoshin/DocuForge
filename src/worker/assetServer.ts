import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { DATA_DIR } from "@/lib/paths";

const TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json",
};

/** Serves /data to the Remotion renderer (Chrome) with Range support, on localhost only. */
export function startAssetServer(port: number) {
  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Range");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
    if (req.method === "OPTIONS") return void res.writeHead(204).end();
    try {
      const rel = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, "");
      const file = path.resolve(DATA_DIR, rel);
      if (!file.startsWith(DATA_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return void res.writeHead(404).end("not found");
      const size = fs.statSync(file).size;
      const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
      const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
      if (range) {
        const start = range[1] ? parseInt(range[1]) : size - parseInt(range[2]);
        const end = range[1] && range[2] ? Math.min(parseInt(range[2]), size - 1) : size - 1;
        if (start >= size || start < 0) return void res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
        res.writeHead(206, { "Content-Type": type, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes" });
        if (req.method === "HEAD") return void res.end();
        fs.createReadStream(file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
        if (req.method === "HEAD") return void res.end();
        fs.createReadStream(file).pipe(res);
      }
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
  server.listen(port, "127.0.0.1");
  return server;
}
