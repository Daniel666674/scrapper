import * as cheerio from "cheerio";

/** Quita parámetros/sufijos de tamaño para pedir la versión más grande de la imagen. */
export function upgradeResolution(url: string): string {
  try {
    const u = new URL(url);
    // Shopify: foto_200x.jpg / foto_200x200.jpg / foto_grande.jpg -> foto.jpg
    u.pathname = u.pathname.replace(
      /_(pico|icon|thumb|small|compact|medium|large|grande|original|\d*x\d*)(@\dx)?(?=\.\w+$)/i,
      "",
    );
    // WooCommerce / WordPress: foto-300x300.jpg -> foto.jpg
    u.pathname = u.pathname.replace(/-\d{2,4}x\d{2,4}(?=\.\w+$)/, "");
    // Parámetros típicos de redimensionado
    for (const p of ["w", "h", "width", "height", "resize", "fit", "crop", "q", "quality"]) {
      u.searchParams.delete(p);
    }
    return u.toString();
  } catch {
    return url;
  }
}

const JUNK = /(logo|icon|sprite|favicon|avatar|banner|badge|payment|visa|mastercard|paypal|flag|placeholder|loading|spinner|pixel|tracking|facebook|instagram|twitter|whatsapp)/i;
const IMG_EXT = /\.(jpe?g|png|webp|avif|gif)(\?|$)/i;

function abs(base: string, raw: string | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v || v.startsWith("data:")) return null;
  try {
    return new URL(v, base).toString();
  } catch {
    return null;
  }
}

/** Elige la URL más grande de un atributo srcset. */
function bestFromSrcset(srcset: string): string | undefined {
  const items = srcset
    .split(",")
    .map((s) => s.trim().split(/\s+/))
    .filter((p) => p[0])
    .map(([url, d]) => ({ url, size: parseFloat(d ?? "1") || 1 }));
  items.sort((a, b) => b.size - a.size);
  return items[0]?.url;
}

function collectJsonLdImages(node: unknown, out: string[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n) => collectJsonLdImages(n, out));
  const obj = node as Record<string, unknown>;
  const img = obj.image;
  if (typeof img === "string") out.push(img);
  else if (Array.isArray(img)) {
    for (const i of img) {
      if (typeof i === "string") out.push(i);
      else if (i && typeof (i as any).url === "string") out.push((i as any).url);
    }
  } else if (img && typeof (img as any).url === "string") out.push((img as any).url);
  for (const v of Object.values(obj)) if (typeof v === "object") collectJsonLdImages(v, out);
}

export interface Extracted {
  title: string;
  /** Imágenes de alta prioridad (JSON-LD, og:image): casi seguro son del producto */
  main: string[];
  /** Resto de imágenes de la página */
  other: string[];
}

export function extractImages(html: string, pageUrl: string): Extracted {
  const $ = cheerio.load(html);
  const title = ($("meta[property='og:title']").attr("content") || $("title").text() || "pagina").trim();

  const main = new Set<string>();
  const other = new Set<string>();

  // 1) Datos estructurados del producto (la fuente más fiable)
  const ld: string[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    try {
      collectJsonLdImages(JSON.parse($(el).text()), ld);
    } catch { /* JSON inválido: se ignora */ }
  });
  ld.forEach((u) => { const a = abs(pageUrl, u); if (a) main.add(a); });

  // 2) Open Graph
  $("meta[property='og:image'], meta[property='og:image:secure_url'], meta[name='twitter:image']").each((_, el) => {
    const a = abs(pageUrl, $(el).attr("content"));
    if (a) main.add(a);
  });

  // 3) Todas las <img>, <source> y enlaces a imágenes grandes (galerías/zoom)
  $("img, source").each((_, el) => {
    const $el = $(el);
    const candidates = [
      $el.attr("data-zoom-image"), $el.attr("data-large-image"), $el.attr("data-full"),
      $el.attr("data-original"), $el.attr("data-src"), $el.attr("data-lazy-src"), $el.attr("src"),
      bestFromSrcset($el.attr("srcset") || $el.attr("data-srcset") || ""),
    ];
    for (const c of candidates) {
      const a = abs(pageUrl, c);
      if (a && IMG_EXT.test(a)) other.add(a);
    }
  });
  $("a[href]").each((_, el) => {
    const a = abs(pageUrl, $(el).attr("href"));
    if (a && IMG_EXT.test(a)) other.add(a);
  });

  const clean = (set: Set<string>) =>
    [...set].map(upgradeResolution).filter((u) => !JUNK.test(new URL(u).pathname));
  const mainList = [...new Set(clean(main))];
  const otherList = [...new Set(clean(other))].filter((u) => !mainList.includes(u));
  return { title, main: mainList, other: otherList };
}

/** Shopify expone /products/<handle>.json con todas las fotos en tamaño original. */
export function shopifyJsonUrl(pageUrl: string): string | null {
  const m = new URL(pageUrl).pathname.match(/^(.*\/products\/[^/]+?)(\.json)?\/?$/);
  return m ? new URL(m[1] + ".json", pageUrl).toString() : null;
}

export function imagesFromShopifyJson(json: unknown): string[] {
  const images = (json as any)?.product?.images;
  return Array.isArray(images) ? images.map((i: any) => i.src).filter(Boolean) : [];
}
