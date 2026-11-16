import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compiledModule } from "./render-module.mjs";

const { default: SliceComparison } = await import(compiledModule(new URL("../src/SliceComparison.tsx", import.meta.url)));
const { default: InteractiveSlice } = await import(compiledModule(new URL("../src/InteractiveSlice.tsx", import.meta.url)));
const modality = { id: "t1", name: "T1 map", percentiles: [10, 90] };
const slice = createElement(InteractiveSlice, {
  plane: "coronal", index: 12, resolution: 25, hoveredRegionId: null,
  imageSrc: "/original.webp", modalityBrainOnly: true,
  onHoverRegion() {}, onSelectRegion() {},
});
const render = (props = {}) => renderToStaticMarkup(createElement(SliceComparison, {
  enabled: true, modalities: [modality], activeId: null, revision: "revision-1",
  className: "slice-image-wrap", onWheel() {}, ...props,
}, slice));

test("single view preserves the original slice and has no comparison controls", () => {
  const html = render({ enabled: false });
  assert.match(html, /\/original.webp/);
  assert.doesNotMatch(html, /comparison-pane/);
});

test("comparison defaults to RARE and first modality with separate controls", () => {
  const html = render();
  assert.equal((html.match(/class="comparison-pane"/g) ?? []).length, 2);
  assert.match(html, /aria-label="RARE"/);
  assert.match(html, /aria-label="T1 map"/);
  assert.match(html, /value="10"/);
  assert.match(html, /value="90"/);
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, /\/original.webp/);
});

test("missing selected modalities fall back to RARE without throwing", () => {
  const html = render({ activeId: "deleted", modalities: [] });
  assert.equal((html.match(/aria-label="RARE"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /type="number"/);
});

test("registration QC uses the native RARE reference and independent blend control", () => {
  const html = render({ qcEnabled: true, qcRevision: "atlas-1" });
  assert.match(html, /registration-qc/);
  assert.match(html, /id="registration-blend"/);
  assert.match(html, /value="50"/);
  assert.match(html, /\/api\/import\/viewer\/slices\/coronal\/coronal-012.webp/);
  assert.doesNotMatch(html, /comparison-pane/);
  assert.doesNotMatch(html, /\/original.webp/);
});
