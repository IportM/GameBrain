import assert from "node:assert/strict";
import { test } from "node:test";
import { BoxGeometry, BufferGeometry, Float32BufferAttribute } from "three";
import { compiledModule } from "./render-module.mjs";
const { markRegionMeshReady, regionHoverDelay, prepareRegionGeometry } = await import(compiledModule(new URL("../src/regionMeshPerformance.ts", import.meta.url)));

test("only actually loaded region revisions bypass hover intent delay", () => {
  const first = "/region/201.glb?native=one";
  const second = "/region/201.glb?native=two";
  assert.equal(regionHoverDelay(first), 80);
  markRegionMeshReady(first);
  assert.equal(regionHoverDelay(first), 0);
  assert.equal(regionHoverDelay(second), 80);
});

test("region readiness bookkeeping stays bounded rather than preloading every region", () => {
  for (let index = 0; index < 129; index++) markRegionMeshReady(`/bounded/${index}.glb`);
  assert.equal(regionHoverDelay("/bounded/0.glb"), 80);
  for (let index = 1; index < 129; index++) assert.equal(regionHoverDelay(`/bounded/${index}.glb`), 0);
});

test("existing mesh normals are reused without any geometry calculation", () => {
  const geometry = new BoxGeometry();
  const normals = geometry.getAttribute("normal");
  geometry.computeVertexNormals = () => { throw new Error("unexpected recalculation"); };
  prepareRegionGeometry(geometry);
  assert.equal(geometry.getAttribute("normal"), normals);
  geometry.dispose();
});

test("a mesh without normals computes them only once", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  const original = geometry.computeVertexNormals.bind(geometry);
  let calculations = 0;
  geometry.computeVertexNormals = () => { calculations++; original(); };
  prepareRegionGeometry(geometry);
  prepareRegionGeometry(geometry);
  assert.equal(calculations, 1);
  assert.equal(geometry.getAttribute("normal").count, 3);
  geometry.dispose();
});
