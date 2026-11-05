import { createHash } from "node:crypto";
import { extname } from "node:path";
import { Client } from "./http.js";
import { extractEmbedded, type EmbeddedImage } from "./embedded.js";
import { extractImages, imagesFromShopifyJson, shopifyJsonUrl, upgradeResolution } from "./extract.js";

export interface ScrapeOptions {
  /** Include secondary images, not only the product ones */
  all: boolean;
  /** Ignore images smaller than this many bytes */
  minBytes: number;
}

/** `name` may include a sub-folder, e.g. "212-vip-men/01.webp" */
export interface ScrapedFile { name: string; data: Buffer; sourceUrl: string }
export interface ScrapeResult { folder: string; files: ScrapedFile[] }

export const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "page";

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/avif": ".avif", "image/gif": ".gif", "image/svg+xml": ".svg",
};

const TRACKING = /^(utm_.*|fbclid|gclid|igshid|mc_eid|_ga)$/i;
/** Removes tracking junk (fbclid, utm_*) and the #fragment from a pasted link. */
export function cleanUrl(raw: string): string {
  const u = new URL(raw.trim());
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.hash = "";
  return u.toString();
}

export interface Item { url: string; title?: string; images?: string[] }

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

/** Downloads the product images of one product/page. Never writes to disk. */
export async function scrapeItem(
  client: Client, item: Item, opts: ScrapeOptions, log: (msg: string) => void,
): Promise<ScrapeResult | null> {
  const pageUrl = item.url;
  let title = item.title ?? "";
  let list: string[];
  let embedded: EmbeddedImage[] = [];

  if (item.images?.length) {
    // Already known from the store's catalog: no need to open the page
    list = item.images.map(upgradeResolution);
    title ||= decodeURIComponent(new URL(pageUrl).pathname.split("/").pop() ?? "");
  } else {
    if (!(await client.allowed(pageUrl))) { log("  ⛔ robots.txt does not allow this page"); return null; }
    const res = await client.get(pageUrl);
    if (!res.ok) { log(`  ❌ HTTP ${res.status}`); return null; }
    const html = await res.text();
    const found = extractImages(html, pageUrl);
    embedded = extractEmbedded(html);
    title ||= found.title;
    const sj = shopifyJsonUrl(pageUrl);
    if (sj) {
      try {
        const r = await client.get(sj, 1);
        if (r.ok) found.main.unshift(...imagesFromShopifyJson(await r.json()));
      } catch { /* not Shopify */ }
    }
    list = opts.all ? [...found.main, ...found.other] : found.main.length ? found.main : found.other;
  }
  list = [...new Set(list)];
  const folder = `${new URL(pageUrl).hostname.replace(/^www\./, "")}/${slug(title)}`;
  log(`  ${title} — ${list.length} candidate images`);

  const downloaded = await mapLimit(list, 4, async (img) => {
    try {
      const r = await client.get(img);
      const type = (r.headers.get("content-type") ?? "").split(";")[0];
      if (!r.ok || !type.startsWith("image/")) return null;
      return { img, type, data: Buffer.from(await r.arrayBuffer()) };
    } catch (e) {
      log(`  ⚠️ skipped one image — ${(e as Error).message}`);
      return null;
    }
  });

  const files: ScrapedFile[] = [];
  const seen = new Set<string>();
  const counters = new Map<string, number>();
  const add = (group: string, data: Buffer, ext: string, source: string) => {
    const hash = createHash("sha1").update(data).digest("hex");
    if (seen.has(`${group}|${hash}`)) return;
    seen.add(`${group}|${hash}`);
    const n = (counters.get(group) ?? 0) + 1;
    counters.set(group, n);
    files.push({ name: `${group ? group + "/" : ""}${String(n).padStart(2, "0")}${ext}`, data, sourceUrl: source });
  };
  for (const d of downloaded) {
    if (!d || d.data.length < opts.minBytes) continue;
    add("", d.data, EXT_BY_TYPE[d.type] ?? (extname(new URL(d.img).pathname) || ".jpg"), d.img);
  }

  if (embedded.length) {
    const products = new Set(embedded.filter((e) => e.group).map((e) => e.group));
    log(`  🧩 ${embedded.length} photos are embedded in the page` + (products.size ? ` (${products.size} products recognised)` : ""));
    for (const e of embedded) {
      if (!e.group && e.data.length < opts.minBytes) continue; // skip tiny unnamed icons
      add(e.group ? slug(e.group) : "embedded", e.data, EXT_BY_TYPE[e.mime] ?? ".png", "embedded");
    }
  }
  log(`  → ${files.length} images kept`);
  return { folder, files };
}
