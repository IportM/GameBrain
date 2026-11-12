import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  clearConnectivitySliceCache,
  connectivityAlphaTable,
  loadConnectivityPixels,
} from "../src/connectivitySliceCache.ts";

const originalImage = Object.getOwnPropertyDescriptor(globalThis, "Image");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");

afterEach(() => {
  clearConnectivitySliceCache();
  for (const [name, descriptor] of [["Image", originalImage], ["document", originalDocument]]) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

function browser({ width = 1, height = 1, fail = false } = {}) {
  let decodes = 0;
  const images = [];
  globalThis.Image = class {
    naturalWidth = width;
    naturalHeight = height;
    onload = null;
    onerror = null;
    constructor() { images.push(this); }
    set src(value) {
      if (!value) return;
      decodes += 1;
      queueMicrotask(() => fail ? this.onerror?.() : this.onload?.());
    }
  };
  globalThis.document = {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({
        drawImage() {},
        getImageData: () => ({ data: new Uint8ClampedArray(width * height * 4).fill(75) }),
      }),
    }),
  };
  return { count: () => decodes, images };
}

const load = (source) => loadConnectivityPixels(source, new AbortController().signal);

test("returning to a recent slice reuses decoded pixels", async () => {
  const fake = browser();
  const first = await load("/projection?experiment=A");
  assert.equal(await load("/projection?experiment=A"), first);
  assert.equal(fake.count(), 1);
});

test("slice cache retains at most 24 entries and refreshes recency", async () => {
  const fake = browser();
  const first = await load("/slice/0");
  for (let i = 1; i < 24; i += 1) await load(`/slice/${i}`);
  assert.equal(await load("/slice/0"), first);
  await load("/slice/24");
  assert.equal(await load("/slice/0"), first);
  await load("/slice/1");
  assert.equal(fake.count(), 26);
});

test("byte budget evicts old pixels before the count limit", async () => {
  const fake = browser({ width: 1536, height: 1536 });
  await load("/large/A");
  await load("/large/B");
  await load("/large/A");
  assert.equal(fake.count(), 3);
});

test("abandoned image loads are detached and can be retried", async () => {
  const fake = browser();
  const controller = new AbortController();
  const pending = loadConnectivityPixels("/slice", controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(fake.images[0].onload, null);
  await load("/slice");
  assert.equal(fake.count(), 2);
});

test("reset clears old slices and prevents pending loads repopulating the cache", async () => {
  const fake = browser();
  const pending = load("/slice");
  clearConnectivitySliceCache();
  await pending;
  await load("/slice");
  assert.equal(fake.count(), 2);
  clearConnectivitySliceCache();
  await load("/slice");
  assert.equal(fake.count(), 3);
});

test("failed images are not cached", async () => {
  browser({ fail: true });
  await assert.rejects(load("/slice"));
  const fake = browser();
  await load("/slice");
  assert.equal(fake.count(), 1);
});

test("experiments and native revisions have independent cache entries", async () => {
  const fake = browser();
  const a = await load("/slice?experiment=1&native=A");
  const b = await load("/slice?experiment=2&native=A");
  const c = await load("/slice?experiment=1&native=B");
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.equal(fake.count(), 3);
});

test("alpha lookup is identical to the previous pixel formula", () => {
  for (const opacity of [0, 0.35, 0.85, 1]) {
    for (const threshold of [0, 0.05, 0.2, 0.75, 1]) {
      const table = connectivityAlphaTable(opacity, threshold);
      for (let alpha = 0; alpha < 256; alpha += 1) {
        const strength = alpha / 255;
        const visible = Math.min(1, Math.max(0, (strength - threshold) / Math.max(0.001, 1 - threshold)));
        const expected = strength < threshold ? 0
          : Math.round(255 * opacity * (0.18 + 0.82 * Math.pow(visible, 0.7)));
        assert.equal(table[alpha], expected);
      }
    }
  }
});
