import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { downloadedExperiments, invalidateConnectivityLibrary, readyExperiment } from "../server/connectivityLibrary.ts";

const roots = [];
function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), "gamebrain-cache-"));
  roots.push(root);
  return root;
}

function experiment(root, id) {
  const web = join(root, String(id), "web");
  mkdirSync(join(web, "volumes"), { recursive: true });
  for (const layer of ["projection", "injection"]) {
    writeFileSync(join(web, "volumes", `${layer}.bin`), new Uint8Array([1]));
    for (const plane of ["coronal", "sagittal", "axial"]) {
      const directory = join(web, "overlays", layer, plane);
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, `${plane}-000.webp`), "synthetic test placeholder");
    }
  }
  writeFileSync(join(web, "manifest.json"), JSON.stringify({
    experiment_id: id, resolution_um: 50, volume_shape: [1, 1, 1],
    slice_counts: { coronal: 1, sagittal: 1, axial: 1 },
  }));
  return web;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    invalidateConnectivityLibrary(root);
    rmSync(root, { recursive: true, force: true });
  }
});

test("a warm index is reused and invalidated after a download", () => {
  const root = temporaryRoot();
  experiment(root, 1);
  const initial = downloadedExperiments(root);
  assert.equal(initial.length, 1);
  assert.equal(downloadedExperiments(root), initial);
  experiment(root, 2);
  invalidateConnectivityLibrary(root, 2);
  assert.equal(downloadedExperiments(root).length, 2);
});

test("changed volume files invalidate readiness immediately", () => {
  const root = temporaryRoot();
  const web = experiment(root, 1);
  assert.equal(readyExperiment(root, 1).id, 1);
  writeFileSync(join(web, "volumes", "projection.bin"), new Uint8Array([1, 2]));
  assert.equal(readyExperiment(root, 1), null);
});

test("explicit invalidation rechecks every slice", () => {
  const root = temporaryRoot();
  const web = experiment(root, 1);
  assert.equal(readyExperiment(root, 1).id, 1);
  rmSync(join(web, "overlays", "projection", "coronal", "coronal-000.webp"));
  invalidateConnectivityLibrary(root, 1);
  assert.equal(readyExperiment(root, 1), null);
});

test("updated metadata is visible after invalidation", () => {
  const root = temporaryRoot();
  experiment(root, 1);
  assert.equal(readyExperiment(root, 1).metadata, null);
  writeFileSync(join(root, "1", "metadata.json"), JSON.stringify({ id: 1, primaryStructure: { acronym: "VISp" } }));
  invalidateConnectivityLibrary(root, 1);
  assert.equal(readyExperiment(root, 1).metadata.primaryStructure.acronym, "VISp");
});
