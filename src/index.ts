import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "./http.js";
import { discoverProducts } from "./discover.js";
import { cleanUrl, scrapeItem, type Item } from "./scraper.js";

const HELP = `
Usage:  npm run scrape -- <url> [<url2> ...] [options]

Options:
  -c, --catalog       Treat the (single) URL as a store/category page and find ALL its products
      --max <n>       With --catalog: maximum products (default: 500)
  -f, --file <file>   Text file with one URL per line
  -o, --out <folder>  Output folder (default: downloads)
  -a, --all           Also include secondary images
  -d, --delay <ms>    Pause between requests (default: 800)
  -m, --min-kb <kb>   Ignore images smaller than this (default: 15)
      --ignore-robots Do not check robots.txt (only with the supplier's permission)
  -h, --help          Show this help
(Prefer the point-and-click app: npm start)
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    catalog: { type: "boolean", short: "c" }, max: { type: "string", default: "500" },
    file: { type: "string", short: "f" }, out: { type: "string", short: "o", default: "downloads" },
    all: { type: "boolean", short: "a" }, delay: { type: "string", short: "d", default: "800" },
    "min-kb": { type: "string", short: "m", default: "15" }, "ignore-robots": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});
const urls = [...positionals];
if (values.file) {
  urls.push(...(await readFile(values.file, "utf8")).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")));
}
if (values.help || urls.length === 0) { console.log(HELP); process.exit(0); }

const client = new Client(Number(values.delay), !values["ignore-robots"], new URL(urls[0]).host);
let items: Item[] = urls.map((u) => ({ url: cleanUrl(u) }));
if (values.catalog) {
  items = await discoverProducts(client, items[0].url, Number(values.max), console.log);
  if (!items.length) { console.log("No product list found; reading the page directly."); items = [{ url: cleanUrl(urls[0]) }]; }
  else console.log(`✅ ${items.length} products found`);
}

let total = 0, step = 0;
for (const item of items) {
  console.log(`\n[${++step}/${items.length}] ${item.title ?? item.url}`);
  try {
    const r = await scrapeItem(client, item, { all: !!values.all, minBytes: Number(values["min-kb"]) * 1024 }, console.log);
    if (!r) continue;
    for (const f of r.files) {
      const path = join(values.out!, r.folder, f.name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, f.data);
    }
    total += r.files.length;
  } catch (e) {
    console.log(`  ❌ ${(e as Error).message}`);
  }
}
console.log(`\nDone: ${total} images saved in ${values.out}.`);
