import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "./http.js";
import { scrapePage } from "./scraper.js";

const HELP = `
Usage:  npm run scrape -- <url> [<url2> ...] [options]

Options:
  -f, --file <file>   Text file with one URL per line
  -o, --out <folder>  Output folder (default: downloads)
  -a, --all           Also include secondary images
  -d, --delay <ms>    Pause between requests (default: 1000)
  -m, --min-kb <kb>   Ignore images smaller than this (default: 15)
      --ignore-robots Do not check robots.txt (only with the supplier's permission)
  -h, --help          Show this help
(Prefer the point-and-click app: npm start)
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    file: { type: "string", short: "f" }, out: { type: "string", short: "o", default: "downloads" },
    all: { type: "boolean", short: "a" }, delay: { type: "string", short: "d", default: "1000" },
    "min-kb": { type: "string", short: "m", default: "15" }, "ignore-robots": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});
const urls = [...positionals];
if (values.file) {
  urls.push(...(await readFile(values.file, "utf8")).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")));
}
if (values.help || urls.length === 0) { console.log(HELP); process.exit(0); }

const client = new Client(Number(values.delay), !values["ignore-robots"]);
let total = 0;
for (const url of urls) {
  console.log(`\n📄 ${url}`);
  try {
    const r = await scrapePage(client, url, { all: !!values.all, minBytes: Number(values["min-kb"]) * 1024 }, console.log);
    if (!r) continue;
    const dir = join(values.out!, r.folder);
    await mkdir(dir, { recursive: true });
    for (const f of r.files) await writeFile(join(dir, f.name), f.data);
    total += r.files.length;
    console.log(`  saved in ${dir}`);
  } catch (e) {
    console.log(`  ❌ ${(e as Error).message}`);
  }
}
console.log(`\nDone: ${total} images downloaded.`);
