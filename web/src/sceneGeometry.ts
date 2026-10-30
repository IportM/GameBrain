import { Matrix4, Quaternion, Vector3 } from "three";

import {
  ATLAS_SIZE_MM,
  ATLAS_VOLUME_CENTER_MM,
  SLICE_PLANES,
  resolutionMm,
  type SlicePlane,
  type SliceResolution,
} from "./atlas";

export type SlicePlaneTransform = {
  position: [number, number, number];
  quaternion: Quaternion;
  size: [number, number];
};

export function slicePlaneTransform(
  plane: SlicePlane,
  index: number,
  resolution: SliceResolution,
): SlicePlaneTransform {
  const center = ATLAS_VOLUME_CENTER_MM;
  const offset = index * resolutionMm(resolution) - SLICE_PLANES[plane].meshCenterMm;

  let position: [number, number, number];
  let size: [number, number];
  let horizontal: Vector3;
  let vertical: Vector3;
  let normal: Vector3;

  if (plane === "coronal") {
    position = [offset, center[1], center[2]];
    size = [ATLAS_SIZE_MM[2], ATLAS_SIZE_MM[1]];
    horizontal = new Vector3(0, 0, 1);
    vertical = new Vector3(0, -1, 0);
    normal = new Vector3(1, 0, 0);
  } else if (plane === "sagittal") {
    position = [center[0], center[1], offset];
    size = [ATLAS_SIZE_MM[0], ATLAS_SIZE_MM[1]];
    horizontal = new Vector3(1, 0, 0);
    vertical = new Vector3(0, -1, 0);
    normal = new Vector3(0, 0, -1);
  } else {
    position = [center[0], offset, center[2]];
    size = [ATLAS_SIZE_MM[2], ATLAS_SIZE_MM[0]];
    horizontal = new Vector3(0, 0, 1);
    vertical = new Vector3(-1, 0, 0);
    normal = new Vector3(0, -1, 0);
  }

  const basis = new Matrix4().makeBasis(horizontal, vertical, normal);
  return {
    position,
    quaternion: new Quaternion().setFromRotationMatrix(basis),
    size,
  };
}
