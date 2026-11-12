import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { clearConnectivityVolumeCache, retainConnectivityTexture } from "../src/connectivityVolumeCache.ts";

afterEach(() => {
  clearConnectivityVolumeCache();
  mock.restoreAll();
});

test("a recent volume reuses its request and texture", async () => {
  const fetch = mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([5])));
  const first = retainConnectivityTexture("/volume?a=1", [1, 1, 1]);
  const second = retainConnectivityTexture("/volume?a=1", [1, 1, 1]);
  const texture = await first.promise;
  assert.equal(await second.promise, texture);
  first.release();
  second.release();
  const again = retainConnectivityTexture("/volume?a=1", [1, 1, 1]);
  assert.equal(await again.promise, texture);
  assert.equal(fetch.mock.callCount(), 1);
  again.release();
});

test("reset defers disposal until the last active user releases", async () => {
  mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([5])));
  const first = retainConnectivityTexture("/volume", [1, 1, 1]);
  const second = retainConnectivityTexture("/volume", [1, 1, 1]);
  const texture = await first.promise;
  let disposed = 0;
  texture.addEventListener("dispose", () => { disposed += 1; });
  clearConnectivityVolumeCache();
  first.release();
  assert.equal(disposed, 0);
  second.release();
  second.release();
  assert.equal(disposed, 1);
});

test("only six recent volumes remain cached", async () => {
  const fetch = mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([5])));
  let evicted = false;
  for (let index = 0; index < 7; index += 1) {
    const retained = retainConnectivityTexture(`/volume?id=${index}`, [1, 1, 1]);
    const texture = await retained.promise;
    if (index === 0) texture.addEventListener("dispose", () => { evicted = true; });
    retained.release();
  }
  assert.equal(evicted, true);
  const again = retainConnectivityTexture("/volume?id=0", [1, 1, 1]);
  await again.promise;
  again.release();
  assert.equal(fetch.mock.callCount(), 8);
});

test("the byte budget evicts unused volumes before the count limit", async () => {
  const shape = [257, 256, 256];
  mock.method(globalThis, "fetch", async () => new Response(new Uint8Array(shape[0] * shape[1] * shape[2])));
  const first = retainConnectivityTexture("/large?id=1", shape);
  let evicted = false;
  (await first.promise).addEventListener("dispose", () => { evicted = true; });
  first.release();
  const second = retainConnectivityTexture("/large?id=2", shape);
  await second.promise;
  assert.equal(evicted, true);
  second.release();
});

test("an abandoned request is aborted and can be retried", async () => {
  mock.method(globalThis, "fetch", (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  const retained = retainConnectivityTexture("/pending", [1, 1, 1]);
  const rejected = assert.rejects(retained.promise, { name: "AbortError" });
  retained.release();
  await rejected;
  mock.restoreAll();
  mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([9])));
  const again = retainConnectivityTexture("/pending", [1, 1, 1]);
  assert.equal((await again.promise).image.data[0], 9);
  again.release();
});

test("native revisions cannot share a texture across subjects", async () => {
  mock.method(globalThis, "fetch", async (url) => new Response(new Uint8Array([url.includes("native=B") ? 9 : 5])));
  const first = retainConnectivityTexture("/api/connectivity/native-viewer/volume?native=A", [1, 1, 1]);
  const second = retainConnectivityTexture("/api/connectivity/native-viewer/volume?native=B", [1, 1, 1]);
  const a = await first.promise;
  const b = await second.promise;
  assert.notEqual(a, b);
  assert.equal(a.image.data[0], 5);
  assert.equal(b.image.data[0], 9);
  first.release();
  second.release();
});
