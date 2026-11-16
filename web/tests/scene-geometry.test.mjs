import assert from "node:assert/strict";
import { test } from "node:test";
import { FrontSide, BackSide, Matrix4, Quaternion, Vector3 } from "three";
import { compiledModule } from "./render-module.mjs";
const { slicePlaneTransform, sliceSectionSide } = await import(compiledModule(new URL("../src/sceneGeometry.ts", import.meta.url)));
const { CUT_SURFACE_STENCIL, connectivityCutMask } = await import(compiledModule(new URL("../src/cutSurfaceMask.ts", import.meta.url)));

function outwardNormal(quaternion, side) {
  const normal = new Vector3(0, 0, 1).applyQuaternion(quaternion);
  normal.y *= -1;
  return side === BackSide ? normal.negate() : normal;
}

test("all Allen cut faces point to the removed half for both clipping directions", () => {
  for (const plane of ["coronal", "sagittal", "axial"]) {
    for (const resolution of [10, 25, 50]) {
      const transform = slicePlaneTransform(plane, 10, resolution);
      const clipNormal = plane === "coronal" ? new Vector3(1, 0, 0) : plane === "sagittal" ? new Vector3(0, 0, 1) : new Vector3(0, -1, 0);
      for (const direction of [1, -1]) {
        const keptSide = clipNormal.clone().multiplyScalar(direction);
        const side = sliceSectionSide(transform.quaternion, keptSide);
        assert.ok(side === FrontSide || side === BackSide);
        assert.ok(outwardNormal(transform.quaternion, side).dot(keptSide) < -.999);
      }
    }
  }
});

test("the imported sagittal convention faces the open half without mirroring its image", () => {
  const quaternion = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(
    new Vector3(-1, 0, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1),
  ));
  const saved = quaternion.clone();
  for (const sign of [1, -1]) {
    const normal = new Vector3(0, 0, sign);
    assert.ok(outwardNormal(quaternion, sliceSectionSide(quaternion, normal)).dot(normal) < -.999);
  }
  assert.ok(quaternion.equals(saved));
});

test("3D connectivity is masked only where the visible cut face wrote stencil", () => {
  const mask = connectivityCutMask(true);
  assert.equal(mask.stencilWrite, true);
  assert.equal(mask.stencilRef, CUT_SURFACE_STENCIL.stencilRef);
  assert.notEqual(mask.stencilFunc, CUT_SURFACE_STENCIL.stencilFunc);
  assert.equal(mask.stencilWriteMask, 0);
  assert.equal(connectivityCutMask(false).stencilWrite, false);
});
