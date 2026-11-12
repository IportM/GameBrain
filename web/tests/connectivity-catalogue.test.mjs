import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, mock, test } from "node:test";
import { fetchConnectivityCatalogue, loadConnectivityCatalogue } from "../server/allenApi.ts";

afterEach(() => mock.restoreAll());

test("bundled injection sites are available without a network request", async () => {
  const snapshot = JSON.parse(readFileSync(new URL("../../registration/resources/connectivity_experiments.json", import.meta.url), "utf8"));
  mock.method(Date, "now", () => Date.parse(snapshot.updatedAt) + 1000);
  const fetch = mock.method(globalThis, "fetch", async () => { throw new Error("Offline"); });
  const results = await loadConnectivityCatalogue();
  assert.equal(results.length, snapshot.results.length);
  assert.equal(fetch.mock.callCount(), 0);
  assert.ok(results.every((entry) => entry.injectionCoordinatesUm.length === 3));
});

test("online catalogue refresh uses a single request", async () => {
  const fetch = mock.method(globalThis, "fetch", async () => Response.json({
    success: true, total_rows: 1,
    msg: [{ data_set_id: 42, structure_id: 385, structure_abbrev: "VISp", injection_x: 1000, injection_y: 2000, injection_z: 3000 }],
  }));
  const results = await fetchConnectivityCatalogue();
  assert.equal(fetch.mock.callCount(), 1);
  assert.match(fetch.mock.calls[0].arguments[0], /num_rows=all/);
  assert.equal(results[0].id, 42);
});

test("an incomplete response cannot replace a full catalogue", async () => {
  mock.method(globalThis, "fetch", async () => Response.json({ success: true, total_rows: 20, msg: [{}] }));
  await assert.rejects(fetchConnectivityCatalogue(), /incomplet/);
});
