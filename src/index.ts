import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "./http.js";
import { extractImages, imagesFromShopifyJson, shopifyJsonUrl } from "./extract.js";

const HELP = `
Uso:  npm run scrape -- <url> [<url2> ...] [opciones]

Opciones:
  -f, --file <archivo>   Archivo de texto con una URL por línea
  -o, --out <carpeta>    Carpeta de salida (por defecto: descargas)
  -a, --all              Incluir también imágenes secundarias (por defecto solo las del producto)
  -d, --delay <ms>       Pausa entre peticiones (por defecto: 1000)
  -m, --min-kb <kb>      Ignorar imágenes menores a este tamaño (por defecto: 15)
      --ignore-robots    No consultar robots.txt (úsalo solo con permiso de tu proveedor)
  -h, --help             Muestra esta ayuda
`;

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "pagina";

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/avif": ".avif", "image/gif": ".gif",
};

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      file: { type: "string", short: "f" }, out: { type: "string", short: "o", default: "descargas" },
      all: { type: "boolean", short: "a" }, delay: { type: "string", short: "d", default: "1000" },
      "min-kb": { type: "string", short: "m", default: "15" }, "ignore-robots": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const urls = [...positionals];
  if (values.file) {
    urls.push(...(await readFile(values.file, "utf8")).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")));
  }
  if (values.help || urls.length === 0) return console.log(HELP);

  const client = new Client(Number(values.delay), !values["ignore-robots"]);
  const minBytes = Number(values["min-kb"]) * 1024;
  let total = 0;

  for (const pageUrl of urls) {
    console.log(`\n📄 ${pageUrl}`);
    try {
      if (!(await client.allowed(pageUrl))) { console.log("  ⛔ robots.txt no permite esta página (usa --ignore-robots si tienes permiso)"); continue; }
      const res = await client.get(pageUrl);
      if (!res.ok) { console.log(`  ❌ HTTP ${res.status}`); continue; }
      const found = extractImages(await res.text(), pageUrl);

      // Shopify: fotos originales completas
      const sj = shopifyJsonUrl(pageUrl);
      if (sj) {
        try {
          const r = await client.get(sj, 1);
          if (r.ok) found.main.unshift(...imagesFromShopifyJson(await r.json()));
        } catch { /* no es Shopify */ }
      }

      const list = [...new Set(values.all ? [...found.main, ...found.other] : found.main.length ? found.main : found.other)];
      const dir = join(values.out!, new URL(pageUrl).hostname.replace(/^www\./, ""), slug(found.title));
      await mkdir(dir, { recursive: true });
      console.log(`  ${found.title} — ${list.length} imágenes candidatas`);

      const seen = new Set<string>();
      let n = 0;
      for (const img of list) {
        try {
          const r = await client.get(img);
          const type = (r.headers.get("content-type") ?? "").split(";")[0];
          if (!r.ok || !type.startsWith("image/")) continue;
          const buf = Buffer.from(await r.arrayBuffer());
          const hash = createHash("sha1").update(buf).digest("hex");
          if (buf.length < minBytes || seen.has(hash)) continue;
          seen.add(hash);
          const ext = EXT_BY_TYPE[type] ?? (extname(new URL(img).pathname) || ".jpg");
          const file = `${String(++n).padStart(2, "0")}${ext}`;
          await writeFile(join(dir, file), buf);
          console.log(`  ✅ ${file}  (${Math.round(buf.length / 1024)} KB)  ${img}`);
        } catch (e) {
          console.log(`  ⚠️  ${img} — ${(e as Error).message}`);
        }
      }
      total += n;
      console.log(`  → ${n} guardadas en ${dir}`);
    } catch (e) {
      console.log(`  ❌ ${(e as Error).message}`);
    }
  }
  console.log(`\nListo: ${total} imágenes descargadas.`);
}

main();
