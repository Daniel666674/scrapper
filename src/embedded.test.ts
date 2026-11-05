import test from "node:test";
import assert from "node:assert/strict";
import { extractEmbedded } from "./embedded.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const uri = (n: number) => `data:image/png;base64,${PNG.replace("AAAA", "A".repeat(3) + n)}`;

test("names embedded photos after the product table", () => {
  const html = `<script>var D=[["PERFUME A","x",100,0,0,1,0],["PERFUME B","y",200,0,1,1,-1]];
    var IM=["${uri(1)}", "${uri(2)}"]; var IM2=["${uri(3)}"];
    L.forEach(function(r){ s='<img src="'+IM[r[4]]+'">'+(r[6]>=0?'<img src="'+IM2[r[6]]+'">':''); });</script>`;
  const out = extractEmbedded(html);
  const a = out.filter((e) => e.group === "PERFUME A");
  const b = out.filter((e) => e.group === "PERFUME B");
  assert.equal(a.length, 2); // main + close-up
  assert.equal(b.length, 1);
  assert.equal(out.length, 3);
});

test("falls back to ungrouped images without a product table", () => {
  const out = extractEmbedded(`<img src="${uri(7)}"><div style="background:url(${uri(8)})">`);
  assert.equal(out.length, 2);
  assert.ok(out.every((e) => !e.group));
});

test("no embedded images -> empty", () => assert.deepEqual(extractEmbedded("<p>hi</p>"), []));
