/**
 * Some sites (often single-file demo sites) embed their photos inside the page as base64 "data:" URIs
 * and build the product cards with JavaScript. This finds those photos and, when the page has a product
 * table pointing into the image arrays, names each photo after its product.
 * Nothing from the page is ever executed; it is only read as text.
 */

export interface EmbeddedImage { mime: string; data: Buffer; group?: string }

const DATA_G = /data:image\/([a-z0-9+.-]+);base64,([A-Za-z0-9+/=]+)/gi;
const ARRAY_START = /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*\[\s*"data:image\//g;
const ITEM = /\s*"data:image\/([a-z0-9+.-]+);base64,([A-Za-z0-9+/=]+)"\s*(,|\])/y;
const ROWS_START = /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(\[\s*\[\s*")/g;

const toImage = (sub: string, b64: string): EmbeddedImage => ({
  mime: "image/" + (sub === "jpg" ? "jpeg" : sub.replace("svg+xml", "svg+xml")),
  data: Buffer.from(b64, "base64"),
});

/** Returns the text of the JS array literal starting at src[start] === "[" (string-aware). */
function balanced(src: string, start: number, limit = 3_000_000): string | null {
  let depth = 0, inStr = false;
  const end = Math.min(src.length, start + limit);
  for (let i = start; i < end; i++) {
    const c = src[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
}

export function extractEmbedded(html: string): EmbeddedImage[] {
  if (!html.includes("data:image/")) return [];

  // 1) Arrays of photos:  var IM=["data:image/...", ...]
  const arrays: { name: string; items: EmbeddedImage[]; start: number; end: number }[] = [];
  for (const m of html.matchAll(ARRAY_START)) {
    const open = m.index! + m[0].indexOf("[");
    const items: EmbeddedImage[] = [];
    ITEM.lastIndex = open + 1;
    let end = open + 1;
    for (let r = ITEM.exec(html); r; r = ITEM.exec(html)) {
      items.push(toImage(r[1], r[2]));
      end = ITEM.lastIndex;
      if (r[3] === "]") break;
    }
    if (items.length) arrays.push({ name: m[1], items, start: open, end });
  }

  // 2) Everything else that is a data URI (inline <img>, CSS backgrounds...)
  const loose: EmbeddedImage[] = [];
  const looseSeen = new Set<string>();
  for (const m of html.matchAll(DATA_G)) {
    if (arrays.some((a) => m.index! >= a.start && m.index! < a.end)) continue;
    if (looseSeen.has(m[2])) continue;
    looseSeen.add(m[2]);
    loose.push(toImage(m[1], m[2]));
  }

  // 3) Product table + which column points into which image array (read from the page's own render code)
  const code = html.replace(DATA_G, "data:");
  const columns = arrays.map((a) => {
    const m = code.match(new RegExp(`\\b${a.name.replace(/\$/g, "\\$")}\\s*\\[\\s*[\\w$]+\\s*\\[\\s*(\\d+)\\s*\\]\\s*\\]`));
    return m ? Number(m[1]) : -1;
  });
  const claimed = new Set<string>();
  const grouped: EmbeddedImage[] = [];
  if (columns.some((c) => c >= 0)) {
    for (const m of code.matchAll(ROWS_START)) {
      const text = balanced(code, m.index! + m[0].indexOf("["));
      let rows: unknown;
      try { rows = text && JSON.parse(text); } catch { continue; }
      if (!Array.isArray(rows) || rows.length < 2) continue;
      for (const row of rows) {
        if (!Array.isArray(row) || typeof row[0] !== "string" || !row[0].trim()) continue;
        arrays.forEach((a, ai) => {
          const idx = row[columns[ai]];
          if (columns[ai] >= 0 && Number.isInteger(idx) && idx >= 0 && idx < a.items.length) {
            grouped.push({ ...a.items[idx], group: row[0].trim() });
            claimed.add(`${ai}:${idx}`);
          }
        });
      }
      if (grouped.length) break; // first table that works
    }
  }

  const rest: EmbeddedImage[] = [];
  arrays.forEach((a, ai) => a.items.forEach((img, i) => { if (!claimed.has(`${ai}:${i}`)) rest.push(img); }));
  return [...grouped, ...rest, ...loose];
}
