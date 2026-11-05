import * as cheerio from "cheerio";
import { Client } from "./http.js";
import type { Item } from "./scraper.js";

/** /products/x, /product/x, /producto/x, /item/x ... (not /product-category/) */
const PRODUCT_RE = /\/(products?|productos?|items?|p)\/[^/?#]+/i;
const MAX_LIST_PAGES = 40;

/** Canonical form so the same product is not scraped twice (drops /collections/x prefix, query, hash). */
function canonical(raw: string): string {
  const u = new URL(raw);
  u.hash = ""; u.search = "";
  u.pathname = u.pathname.replace(/^.*?(\/products\/[^/]+)/, "$1").replace(/\/$/, "");
  return u.toString();
}

/** Shopify stores expose every product (with photos) as JSON. */
async function viaShopify(client: Client, start: URL, max: number, log: (m: string) => void): Promise<Item[]> {
  const coll = start.pathname.match(/^\/collections\/([^/]+)/);
  const base = coll && coll[1] !== "all" ? `${start.origin}/collections/${coll[1]}/products.json` : `${start.origin}/products.json`;
  const items: Item[] = [];
  for (let page = 1; items.length < max && page <= 100; page++) {
    let json: any;
    try {
      if (!(await client.allowed(`${base}?limit=250&page=${page}`))) return [];
      const r = await client.get(`${base}?limit=250&page=${page}`, 1);
      if (!r.ok) break;
      json = await r.json();
    } catch { break; }
    const products = json?.products;
    if (!Array.isArray(products) || products.length === 0) break;
    if (page === 1) log("🛍️  Shopify store detected");
    for (const p of products) {
      items.push({
        url: `${start.origin}/products/${p.handle}`,
        title: p.title,
        images: (p.images ?? []).map((i: any) => i.src).filter(Boolean),
      });
    }
  }
  return items.slice(0, max);
}

async function loc(client: Client, url: string): Promise<string[]> {
  try {
    const r = await client.get(url, 1);
    if (!r.ok) return [];
    const text = await r.text();
    return [...text.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
  } catch { return []; }
}

async function viaSitemap(client: Client, start: URL, max: number, log: (m: string) => void): Promise<Item[]> {
  const roots = [...new Set([...(await client.sitemapsOf(start.origin)), start.origin + "/sitemap.xml"])];
  const pages = new Set<string>();
  const visited = new Set<string>();
  const queue = roots.map((u) => ({ u, depth: 0 }));
  while (queue.length && pages.size < max && visited.size < 60) {
    const { u, depth } = queue.shift()!;
    if (visited.has(u)) continue;
    visited.add(u);
    for (const l of await loc(client, u)) {
      if (/\.xml(\.gz)?(\?|$)/i.test(l)) {
        if (depth < 2 && !/\.gz/i.test(l)) {
          // product sitemaps first
          (/product/i.test(l) ? queue.unshift.bind(queue) : queue.push.bind(queue))({ u: l, depth: depth + 1 });
        }
      } else if (PRODUCT_RE.test(new URL(l).pathname) && new URL(l).origin === start.origin) {
        pages.add(canonical(l));
      }
    }
  }
  if (pages.size) log(`🗺️  Found ${pages.size} product links in the sitemap`);
  return [...pages].slice(0, max).map((url) => ({ url }));
}

/** Last resort: walk a category/listing page and its "next page" links. */
async function viaListing(client: Client, start: URL, max: number, log: (m: string) => void): Promise<Item[]> {
  const found = new Set<string>();
  const seenPages = new Set<string>();
  let next: string | null = start.toString();
  for (let n = 0; next && n < MAX_LIST_PAGES && found.size < max; n++) {
    if (seenPages.has(next)) break;
    seenPages.add(next);
    let html: string;
    try {
      if (!(await client.allowed(next))) break;
      const r = await client.get(next);
      if (!r.ok) break;
      html = await r.text();
    } catch { break; }
    const $ = cheerio.load(html);
    let nextHref: string | null = null;
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href")!;
      let u: URL;
      try { u = new URL(href, next!); } catch { return; }
      if (u.origin !== start.origin) return;
      if (PRODUCT_RE.test(u.pathname)) found.add(canonical(u.toString()));
      const isNext =
        $(el).is("[rel~='next']") || /^(next|siguiente|older|›|»|>)$/i.test($(el).text().trim()) ||
        $(el).attr("aria-label")?.match(/next|siguiente/i);
      if (isNext && !seenPages.has(u.toString())) nextHref = u.toString();
    });
    if (!nextHref) {
      const rel = $("link[rel='next']").attr("href");
      if (rel) nextHref = new URL(rel, next).toString();
    }
    next = nextHref;
  }
  if (found.size) log(`📃 Found ${found.size} product links by browsing the category pages`);
  return [...found].slice(0, max).map((url) => ({ url }));
}

/** Finds every product page from a store home page or category page. */
export async function discoverProducts(client: Client, startUrl: string, max: number, log: (m: string) => void): Promise<Item[]> {
  const start = new URL(startUrl);
  log(`🔎 Looking for products on ${start.hostname}…`);
  const isRoot = start.pathname === "/" || start.pathname === "";

  let items = await viaShopify(client, start, max, log);
  if (!items.length) {
    const order = isRoot ? [viaSitemap, viaListing] : [viaListing, viaSitemap];
    for (const fn of order) {
      items = await fn(client, start, max, log);
      if (items.length) break;
    }
  }
  return items;
}
