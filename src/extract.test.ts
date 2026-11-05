import test from "node:test";
import assert from "node:assert/strict";
import { extractImages, upgradeResolution, shopifyJsonUrl } from "./extract.js";

test("upgradeResolution quita sufijos de tamaño", () => {
  assert.equal(upgradeResolution("https://a.com/p/foto_200x200.jpg?v=1"), "https://a.com/p/foto.jpg?v=1");
  assert.equal(upgradeResolution("https://a.com/p/foto-300x300.jpg"), "https://a.com/p/foto.jpg");
});

test("extractImages prioriza JSON-LD/og y descarta logos", () => {
  const html = `<html><head><title>Perfume X</title>
    <meta property="og:image" content="/img/og.jpg">
    <script type="application/ld+json">{"@type":"Product","image":["https://a.com/img/p1.jpg","/img/p2.jpg"]}</script>
    </head><body><img src="/img/logo.png"><img data-src="/img/g1-300x300.jpg" srcset="/s.jpg 1x, /img/g1-big.jpg 2x"></body></html>`;
  const r = extractImages(html, "https://a.com/producto");
  assert.deepEqual(r.main, ["https://a.com/img/p1.jpg", "https://a.com/img/p2.jpg", "https://a.com/img/og.jpg"]);
  assert.ok(r.other.includes("https://a.com/img/g1.jpg"));
  assert.ok(!r.other.some((u) => u.includes("logo")));
});

test("shopifyJsonUrl", () => {
  assert.equal(shopifyJsonUrl("https://t.com/collections/x/products/abc?v=2"), "https://t.com/collections/x/products/abc.json");
  assert.equal(shopifyJsonUrl("https://t.com/about"), null);
});
