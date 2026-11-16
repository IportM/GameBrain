import assert from "node:assert/strict";
import { test } from "node:test";
import { compiledModule } from "./render-module.mjs";
const { drawConnectivityOverlay, drawSliceOutline } = await import(compiledModule(new URL("../src/drawConnectivityOverlay.ts", import.meta.url)));
const { connectivityAlphaTable } = await import(compiledModule(new URL("../src/connectivitySliceCache.ts", import.meta.url)));

test("2D and 3D share opacity/threshold pixels and draw injection after projection", () => {
  const original = globalThis.ImageData;
  globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
  try {
    const frames = [];
    let image;
    const scratch = { width: 0, height: 0, getContext: () => ({ putImageData: (next) => { image = next; } }) };
    const canvas = { width: 0, height: 0, getContext: () => ({ clearRect() {}, drawImage: () => frames.push([...image.data]) }) };
    const projection = { width: 2, height: 1, pixels: new Uint8ClampedArray([240, 220, 0, 200, 0, 255, 0, 10]) };
    const injection = { width: 2, height: 1, pixels: new Uint8ClampedArray([255, 70, 0, 255, 255, 70, 0, 100]) };
    drawConnectivityOverlay(canvas, [projection, injection], .6, .2, scratch);
    const alpha = connectivityAlphaTable(.6, .2);
    assert.deepEqual(frames, [[240, 220, 0, alpha[200], 0, 255, 0, 0], [255, 70, 0, alpha[255], 255, 70, 0, alpha[100]]]);
    assert.equal(canvas.width, 2); assert.equal(canvas.height, 1);
    assert.equal(projection.pixels[3], 200);
    frames.length = 0;
    drawConnectivityOverlay(canvas, [injection], 0, .2, scratch);
    assert.equal(frames[0][3], 0); assert.equal(frames[0][7], 0);
  } finally { if (original === undefined) delete globalThis.ImageData; else globalThis.ImageData = original; }
});

test("hiding all connectivity clears previously drawn pixels", () => {
  let cleared = 0;
  const canvas = { width: 4, height: 3, getContext: () => ({ clearRect: () => { cleared++; } }) };
  drawConnectivityOverlay(canvas, [], .8, .1, {});
  assert.equal(cleared, 1);
});

test("detailed region outlines preserve their thin edges, original colors and alpha", () => {
  const original = globalThis.ImageData;
  globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
  try {
    let drawn;
    const canvas = { width: 0, height: 0, getContext: () => ({ putImageData: (image) => { drawn = image; } }) };
    const source = { width: 2, height: 1, pixels: new Uint8ClampedArray([10, 200, 80, 220, 0, 0, 0, 0]) };
    drawSliceOutline(canvas, source);
    assert.deepEqual([...drawn.data], [...source.pixels]);
    assert.notEqual(drawn.data, source.pixels);
    assert.equal(canvas.width, 2); assert.equal(canvas.height, 1);
  } finally { if (original === undefined) delete globalThis.ImageData; else globalThis.ImageData = original; }
});
