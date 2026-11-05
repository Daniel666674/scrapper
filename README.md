# 📸 Photo Grabber

Paste your supplier's product links, click one button, get a ZIP with all the product photos.
Built for authorized resellers/distributors who need their suppliers' official product images.

## Step by step

### One-time setup (5 minutes)
1. **Install Node.js.** Go to <https://nodejs.org>, download the **LTS** version, and install it (Next → Next → Finish).
2. **Get the project.** On GitHub open this repository → green **Code** button → **Download ZIP**.
   Unzip it somewhere easy (e.g. your Desktop). *(If you use git: `git clone` it instead.)*

### Every time you want photos (1 minute)
3. **Double-click the launcher** inside the folder:
   - **Windows:** `Start Photo Grabber.bat`
   - **Mac:** `Start Photo Grabber.command`
     *(first time only: right-click → Open → Open, because macOS asks to confirm files from the internet)*

   The first run installs what it needs (about a minute). A black window appears — **leave it open**.
4. **Your browser opens by itself** at `http://localhost:3000`. (If not, open that address manually.)
5. **Choose how to give it the products:**
   - **🗂️ Whole catalog (recommended):** paste **one** link — the supplier's home page or a category page.
     The app finds all the products by itself (no need to paste 200 links).
   - **🔗 Specific products:** paste individual product links, one per line.
6. Click **Download photos**. The button shows progress (e.g. `Working… 37/200 pages · 120 photos`).
   You can click **Stop** at any time and keep what was already downloaded.
7. When it finishes, click the green **Download ZIP** button. The photos are also saved on your computer in the
   `downloads` folder inside the project: `downloads/<date>/<site-with-dashes>/<product>/01.jpg, 02.jpg…`
8. **When you're done**, close the black window to stop the app.

> ⏱️ **How long does it take?** Shopify stores are fast (a few minutes for 200 products). Other sites take about
> 4 seconds per product on purpose (the app waits between requests so it never overloads your supplier's site) —
> roughly 15 minutes for 200 products. You can keep working; leave the black window open.

### Options on the page
- **Also grab secondary images** — adds extra images from the page (related products, etc.). Leave off for clean results.
- **Skip robots.txt** — leave off unless your supplier explicitly gave you permission.

## Troubleshooting
| Problem | Fix |
|---|---|
| "Node.js is not installed" | Do step 1, then double-click the launcher again |
| Browser didn't open | Go to `http://localhost:3000` yourself |
| "Port 3000 is busy" | The app is already open in another window — use that one |
| "No product list found, so I'll read this page directly" | The site doesn't expose a product list I can detect. Paste the individual product links using **Specific products** |
| "No images found" | The site loads its photos with JavaScript, or blocks automated access. Tell your developer; a browser-based mode can be added |
| `robots.txt does not allow this page` | The site asks bots to stay out of that page. Ask your supplier for permission/an image pack, or tick the skip option only if they allow it |

## For developers
- `npm start` — the app (`src/server.ts`, UI in `src/ui.html`)
- `npm run scrape -- <url> [-a] [-f urls.txt]` — command-line mode
- `npm test` · `npm run typecheck`
- Catalog discovery (`src/discover.ts`): Shopify `/products.json` → `sitemap.xml` (incl. robots.txt `Sitemap:` lines) → crawl of category pages + "next" links. `npm run scrape -- -c <url> [--max 500]` does the same from the terminal.
- Embedded photos (`src/embedded.ts`): single-file sites that inline photos as base64 and render cards with JS are read as text (never executed), and each photo is named after its product using the page's own product table.
- Pasted links are cleaned of tracking junk (`fbclid`, `utm_*`, `#fragment`). The ZIP is streamed to disk, so big catalogs don't use much memory.
- Reads JSON-LD, `og:image`, `<img>`/`srcset`/lazy-load/zoom attributes; Shopify stores use `/products/<handle>.json`; upgrades thumbnail URLs; filters logos/duplicates/tiny files; honors robots.txt; 0.8–1 s delay between requests; app listens on `127.0.0.1` only.

> Use only on suppliers who authorized you to use their images. Photos remain the property of the brand.
