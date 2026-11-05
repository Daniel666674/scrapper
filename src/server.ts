import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { exec } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Zip, ZipPassThrough } from "fflate";
import { Client } from "./http.js";
import { discoverProducts } from "./discover.js";
import { cleanUrl, scrapeItem, type Item } from "./scraper.js";

const PORT = Number(process.env.PORT ?? 3000);
const OUT = resolve("downloads");

interface Job { log: string[]; done: boolean; cancelled: boolean; count: number; products: number; total: number; step: number; saved: string; zipPath?: string }
interface Params { urls: string[]; mode: "links" | "catalog"; all: boolean; respectRobots: boolean; max: number }
const jobs = new Map<string, Job>();

async function runJob(job: Job, p: Params) {
  const log = (m: string) => job.log.push(m);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const saved = join(OUT, stamp);
  job.saved = saved;
  await mkdir(saved, { recursive: true });

  // ZIP is streamed to disk, so even thousands of photos never sit in memory
  const zipPath = join(saved, "photos.zip");
  const zipOut = createWriteStream(zipPath);
  const zipDone = new Promise<void>((ok) => zipOut.on("close", ok));
  const zip = new Zip((err, chunk, final) => { if (err) throw err; zipOut.write(chunk); if (final) zipOut.end(); });

  try {
    const client = new Client(800, p.respectRobots, new URL(p.urls[0]).host);
    let items: Item[];
    if (p.mode === "catalog") {
      items = await discoverProducts(client, p.urls[0], p.max, log);
      if (!items.length) {
        log("ℹ️  No product list found, so I'll read this page directly.");
        items = [{ url: p.urls[0] }];
      } else log(`✅ ${items.length} products found. Downloading their photos…`);
    } else items = p.urls.map((url) => ({ url }));

    job.total = items.length;
    for (const item of items) {
      if (job.cancelled) { log("⏹️  Stopped. Keeping what was already downloaded."); break; }
      job.step++;
      log(`\n[${job.step}/${items.length}] ${item.title ?? item.url}`);
      try {
        const r = await scrapeItem(client, item, { all: p.all, minBytes: 15 * 1024 }, log);
        if (!r || !r.files.length) continue;
        job.products++;
        for (const f of r.files) {
          const rel = `${r.folder}/${f.name}`;
          const disk = join(saved, rel);
          await mkdir(dirname(disk), { recursive: true });
          await writeFile(disk, f.data);
          const entry = new ZipPassThrough(rel);
          zip.add(entry);
          entry.push(new Uint8Array(f.data), true);
          job.count++;
        }
      } catch (e) {
        log(`  ❌ ${(e as Error).message}`);
      }
    }
  } catch (e) {
    log(`❌ ${(e as Error).message}`);
  }
  zip.end();
  await zipDone;
  if (job.count) job.zipPath = zipPath;
  log(job.count ? `\n🎉 Done: ${job.count} photos from ${job.products} pages.` : "\nNo images found.");
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
      const b = JSON.parse(await body(req));
      const urls: string[] = [];
      for (const u of String(b.urls ?? "").split(/\s+/)) {
        if (!/^https?:\/\//i.test(u)) continue;
        try { urls.push(cleanUrl(u)); } catch { /* skip invalid */ }
      }
      if (!urls.length) return send(res, 400, JSON.stringify({ error: "Paste at least one link starting with http" }));
      const id = randomUUID();
      const job: Job = { log: [], done: false, cancelled: false, count: 0, products: 0, total: 0, step: 0, saved: "" };
      jobs.set(id, job);
      void runJob(job, {
        urls: b.mode === "catalog" ? [urls[0]] : [...new Set(urls)], mode: b.mode === "catalog" ? "catalog" : "links",
        all: !!b.all, respectRobots: b.respectRobots !== false, max: Math.min(Math.max(Number(b.max) || 500, 1), 5000),
      });
      return send(res, 200, JSON.stringify({ id }));
    }
    const m = url.pathname.match(/^\/api\/job\/([\w-]+)(\/zip|\/cancel)?$/);
    if (m) {
      const job = jobs.get(m[1]);
      if (!job) return send(res, 404, "{}");
      if (req.method === "POST" && m[2] === "/cancel") { job.cancelled = true; return send(res, 200, "{}"); }
      if (req.method === "GET" && m[2] === "/zip") {
        if (!job.zipPath) return send(res, 404, "{}");
        const { size } = await stat(job.zipPath);
        res.writeHead(200, { "Content-Type": "application/zip", "Content-Length": size, "Content-Disposition": 'attachment; filename="photos.zip"' });
        return void createReadStream(job.zipPath).pipe(res);
      }
      if (req.method === "GET" && !m[2]) {
        return send(res, 200, JSON.stringify({ log: job.log, done: job.done, count: job.count, step: job.step, total: job.total, saved: job.saved, zip: !!job.zipPath }));
      }
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
