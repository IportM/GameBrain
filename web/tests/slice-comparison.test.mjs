import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compiledModule } from "./render-module.mjs";

const { default: SliceComparison } = await import(compiledModule(new URL("../src/SliceComparison.tsx", import.meta.url)));
const { default: InteractiveSlice } = await import(compiledModule(new URL("../src/InteractiveSlice.tsx", import.meta.url)));
const { SliceToolbar } = await import(compiledModule(new URL("../src/SliceToolbar.tsx", import.meta.url)));
const { stepSliceZoom } = await import(compiledModule(new URL("../src/SliceViewport.tsx", import.meta.url)));
const { brainBounds, frameBrain } = await import(compiledModule(new URL("../src/sliceFraming.ts", import.meta.url)));
const toolbar = (props = {}) => renderToStaticMarkup(createElement(SliceToolbar, {
  activePlane: "coronal", sliceResolution: 25, viewerSource: "subject",
  connectivityAvailable: true, connectivityControlsVisible: true,
  connectivityOpacity: 0.85, connectivityThreshold: 0.05, connectivityVisible: true,
  projectionVisible: true, injectionVisible: true,
  connectivityState: { experimentId: 42, hasViewerAssets: true, hasNativeViewerAssets: true, metadata: null },
  ...props,
}));

test("imported-image connectivity controls remain available during registration inspection", () => {
  for (const inspectionMode of [false, true]) {
    const html = toolbar({ inspectionMode });
    assert.match(html, /Afficher la carte/);
    assert.match(html, /Opacité de la connectivité/);
    assert.match(html, /Seuil du signal de connectivité/);
    assert.match(html, /Projections/);
    assert.match(html, /Injection/);
  }
});

test("an unprojected experiment offers native projection rather than ineffective sliders", () => {
  const html = toolbar({ connectivityAvailable: false });
  assert.match(html, /Projeter dans mon image/);
  assert.doesNotMatch(html, /Opacité de la connectivité/);
  assert.doesNotMatch(toolbar({ viewerSource: "allen", connectivityAvailable: false }), /Projeter dans mon image/);
});
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

test("slice zoom is bounded and only enabled for imported single views", () => {
  assert.equal(stepSliceZoom(100, -1), 100);
  assert.equal(stepSliceZoom(100, 1), 125);
  assert.equal(stepSliceZoom(300, 1), 300);
  assert.equal(stepSliceZoom(125, -1), 100);
  assert.doesNotMatch(render({ enabled: false }), /Zoom de la coupe/);
  const html = render({ enabled: false, zoomEnabled: true });
  assert.match(html, /Zoom de la coupe/);
  assert.match(html, /aria-label="Zoomer"/);
  assert.match(html, /aria-label="Dézoomer" disabled/);
  assert.match(html, /100%/);
});

test("brain framing uses the mask rather than head intensities or image center", () => {
  const mask = new Uint8Array(100 * 100);
  for (let y = 5; y < 35; y++) for (let x = 20; x < 80; x++) mask[y * 100 + x] = 1;
  const bounds = brainBounds(mask, 100, 100);
  assert.deepEqual(bounds, { left: 20, right: 80, top: 5, bottom: 35, width: 100, height: 100 });
  const framed = frameBrain(bounds, 500, 300, 1.5);
  assert.equal(framed.zoom, 1.5);
  assert.equal(framed.x, 0);
  assert.equal(framed.y, 135);
  assert.equal(brainBounds(new Uint8Array(100), 10, 10), null);
  const alpha = new Uint8ClampedArray(16);
  alpha[0] = 255; // Bright tissue outside the mask must not influence framing.
  alpha[15] = 255;
  assert.deepEqual(brainBounds(alpha, 2, 2, 4, 3), { left: 1, top: 1, right: 2, bottom: 2, width: 2, height: 2 });
});

test("maximum brain zoom keeps the whole mask inside a resized viewport", () => {
  const bounds = { left: 5, right: 95, top: 10, bottom: 70, width: 100, height: 100 };
  for (const [width, height] of [[300, 200], [200, 400], [600, 150]]) {
    const frame = frameBrain(bounds, width, height, 3);
    const pixelsPerVoxel = Math.min(width / 100, height / 100);
    assert.ok((bounds.right - bounds.left) * pixelsPerVoxel * frame.zoom <= width);
    assert.ok((bounds.bottom - bounds.top) * pixelsPerVoxel * frame.zoom <= height);
    assert.ok(frame.zoom <= 3);
  }
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
  assert.equal((html.match(/aria-label="Zoom de la coupe"/g) ?? []).length, 2);
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
