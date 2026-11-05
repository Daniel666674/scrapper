import { createHash } from "node:crypto";
import { extname } from "node:path";
import { Client } from "./http.js";
import { extractImages, imagesFromShopifyJson, shopifyJsonUrl } from "./extract.js";

export interface ScrapeOptions {
  /** Include secondary images, not only the product ones */
  all: boolean;
  /** Ignore images smaller than this many bytes */
  minBytes: number;
}

export interface ScrapedFile { name: string; data: Buffer; sourceUrl: string }
export interface ScrapeResult { folder: string; files: ScrapedFile[] }

export const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "page";

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/avif": ".avif", "image/gif": ".gif",
};

/** Downloads the product images of one page. Never writes to disk. */
export async function scrapePage(
  client: Client, pageUrl: string, opts: ScrapeOptions, log: (msg: string) => void,
): Promise<ScrapeResult | null> {
  if (!(await client.allowed(pageUrl))) {
    log("  ⛔ robots.txt does not allow this page");
    return null;
  }
  const res = await client.get(pageUrl);
  if (!res.ok) { log(`  ❌ HTTP ${res.status}`); return null; }
  const found = extractImages(await res.text(), pageUrl);

  const sj = shopifyJsonUrl(pageUrl);
  if (sj) {
    try {
      const r = await client.get(sj, 1);
      if (r.ok) found.main.unshift(...imagesFromShopifyJson(await r.json()));
    } catch { /* not Shopify */ }
  }

  const list = [...new Set(opts.all ? [...found.main, ...found.other] : found.main.length ? found.main : found.other)];
  const folder = `${new URL(pageUrl).hostname.replace(/^www\./, "")}/${slug(found.title)}`;
  log(`  ${found.title} — ${list.length} candidate images`);

  const files: ScrapedFile[] = [];
  const seen = new Set<string>();
  for (const img of list) {
    try {
      const r = await client.get(img);
      const type = (r.headers.get("content-type") ?? "").split(";")[0];
      if (!r.ok || !type.startsWith("image/")) continue;
      const data = Buffer.from(await r.arrayBuffer());
      const hash = createHash("sha1").update(data).digest("hex");
      if (data.length < opts.minBytes || seen.has(hash)) continue;
      seen.add(hash);
      const ext = EXT_BY_TYPE[type] ?? (extname(new URL(img).pathname) || ".jpg");
      const name = `${String(files.length + 1).padStart(2, "0")}${ext}`;
      files.push({ name, data, sourceUrl: img });
      log(`  ✅ ${name} (${Math.round(data.length / 1024)} KB)`);
    } catch (e) {
      log(`  ⚠️ skipped one image — ${(e as Error).message}`);
    }
  }
  log(`  → ${files.length} images kept`);
  return { folder, files };
}
