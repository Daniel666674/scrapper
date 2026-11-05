import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { exec } from "node:child_process";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { zipSync } from "fflate";
import { Client } from "./http.js";
import { scrapePage } from "./scraper.js";

const PORT = Number(process.env.PORT ?? 3000);
const OUT = resolve("downloads");

interface Job { log: string[]; done: boolean; zip?: Buffer; count: number; saved: string }
const jobs = new Map<string, Job>();

async function runJob(job: Job, urls: string[], all: boolean, respectRobots: boolean) {
  const client = new Client(800, respectRobots);
  const zipFiles: Record<string, Uint8Array> = {};
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const log = (m: string) => job.log.push(m);
  for (const url of urls) {
    log(`📄 ${url}`);
    try {
      const r = await scrapePage(client, url, { all, minBytes: 15 * 1024 }, log);
      if (!r) continue;
      const dir = join(OUT, stamp, r.folder);
      await mkdir(dir, { recursive: true });
      for (const f of r.files) {
        await writeFile(join(dir, f.name), f.data);
        zipFiles[`${r.folder}/${f.name}`] = new Uint8Array(f.data);
        job.count++;
      }
    } catch (e) {
      log(`  ❌ ${(e as Error).message}`);
    }
  }
  job.saved = join(OUT, stamp);
  if (job.count) job.zip = Buffer.from(zipSync(zipFiles, { level: 0 }));
  log(job.count ? `🎉 Done: ${job.count} images.` : "No images found.");
  job.done = true;
}

const body = (req: IncomingMessage) =>
  new Promise<string>((ok, no) => {
    let s = ""; req.on("data", (c) => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on("end", () => ok(s)); req.on("error", no);
  });
const send = (res: ServerResponse, code: number, data: string | Buffer, type = "application/json", extra: Record<string, string> = {}) => {
  res.writeHead(code, { "Content-Type": type, ...extra }); res.end(data);
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    if (req.method === "GET" && url.pathname === "/") {
      return send(res, 200, await readFile(new URL("./ui.html", import.meta.url)), "text/html; charset=utf-8");
    }
    if (req.method === "POST" && url.pathname === "/api/start") {
      const { urls, all, respectRobots } = JSON.parse(await body(req));
      const clean: string[] = (urls as string[]).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u));
      if (!clean.length) return send(res, 400, JSON.stringify({ error: "Paste at least one link starting with http" }));
      const id = randomUUID();
      const job: Job = { log: [], done: false, count: 0, saved: "" };
      jobs.set(id, job);
      void runJob(job, clean, !!all, respectRobots !== false);
      return send(res, 200, JSON.stringify({ id }));
    }
    const m = url.pathname.match(/^\/api\/job\/([\w-]+)(\/zip)?$/);
    if (req.method === "GET" && m) {
      const job = jobs.get(m[1]);
      if (!job) return send(res, 404, "{}");
      if (m[2]) {
        return job.zip
          ? send(res, 200, job.zip, "application/zip", { "Content-Disposition": 'attachment; filename="photos.zip"' })
          : send(res, 404, "{}");
      }
      return send(res, 200, JSON.stringify({ log: job.log, done: job.done, count: job.count, saved: job.saved, zip: !!job.zip }));
    }
    send(res, 404, "Not found", "text/plain");
  } catch (e) {
    send(res, 500, JSON.stringify({ error: (e as Error).message }));
  }
});

// 127.0.0.1 = only this computer can reach the app
server.listen(PORT, "127.0.0.1", () => {
  const addr = `http://localhost:${PORT}`;
  console.log(`\n✅ Photo Grabber is running at ${addr}\n   (leave this window open; close it to stop the app)\n`);
  if (!process.env.NO_OPEN) {
    const cmd = process.platform === "win32" ? `start "" ${addr}` : process.platform === "darwin" ? `open ${addr}` : `xdg-open ${addr}`;
    exec(cmd, () => {});
  }
});
server.on("error", (e: NodeJS.ErrnoException) => {
  console.error(e.code === "EADDRINUSE" ? `Port ${PORT} is busy. The app may already be open at http://localhost:${PORT}` : e.message);
  process.exit(1);
});
