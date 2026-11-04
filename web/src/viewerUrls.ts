import type { SlicePlane, SliceResolution } from "./atlas";
import type { ConnectivityManifest } from "./data";

function paddedSliceIndex(index: number) {
  return index.toString().padStart(3, "0");
}

function revisionQuery(revision: string | null) {
  return encodeURIComponent(revision ?? "current");
}

export function subjectSliceUrl(plane: SlicePlane, index: number, revision: string | null) {
  const paddedIndex = paddedSliceIndex(index);
  return `/api/import/viewer/slices/${plane}/${plane}-${paddedIndex}.webp?v=${revisionQuery(revision)}`;
}

export function modalitySliceUrl(
  modalityId: string,
  plane: SlicePlane,
  index: number,
  masked = false,
) {
  const paddedIndex = paddedSliceIndex(index);
  const folder = masked ? "slices-masked" : "slices";
  return `/api/modalities/${encodeURIComponent(modalityId)}/${folder}/${plane}/${plane}-${paddedIndex}.webp`;
}

export function subjectSlice3DUrl(plane: SlicePlane, index: number, revision: string | null) {
  const paddedIndex = paddedSliceIndex(index);
  return `/api/import/viewer/slices-3d/${plane}/${plane}-${paddedIndex}.webp?v=${revisionQuery(revision)}`;
}

export function subjectMaskOutlineUrl(plane: SlicePlane, index: number, revision: string | null) {
  const paddedIndex = paddedSliceIndex(index);
  return `/api/import/viewer/mask-outline/${plane}/${plane}-${paddedIndex}.webp?v=${revisionQuery(revision)}`;
}

export function subjectAllenMaskUrl(plane: SlicePlane, index: number, revision: string | null) {
  const paddedIndex = paddedSliceIndex(index);
  return `/api/allen-registration/viewer/masks/${plane}/${plane}-${paddedIndex}.png?v=${revisionQuery(revision)}`;
}

export function subjectAllenOutlineUrl(
  plane: SlicePlane,
  index: number,
  revision: string | null,
) {
  const paddedIndex = paddedSliceIndex(index);
  return `/api/allen-registration/viewer/outlines/${plane}/${plane}-${paddedIndex}.webp?v=${revisionQuery(revision)}`;
}

export function subjectAllenDetailedMaskUrl(
  plane: SlicePlane,
  index: number,
  revision: string | null,
) {
  const paddedIndex = paddedSliceIndex(index);
  return `/api/allen-registration/viewer/detailed-masks/${plane}/${plane}-${paddedIndex}.png?v=${revisionQuery(revision)}`;
}

export function subjectAllenDetailedOutlineUrl(
  plane: SlicePlane,
  index: number,
  revision: string | null,
) {
  const paddedIndex = paddedSliceIndex(index);
  return `/api/allen-registration/viewer/detailed-outlines/${plane}/${plane}-${paddedIndex}.webp?v=${revisionQuery(revision)}`;
}

export function subjectAllenRegionUrl(regionId: number, revision: string | null) {
  return `/api/allen-registration/viewer/regions/${regionId}.glb?v=${revisionQuery(revision)}`;
}

export function subjectAllenDetailedRegionUrl(regionId: number, revision: string | null) {
  return `/api/allen-registration/viewer/detailed-regions/${regionId}.glb?v=${revisionQuery(revision)}`;
}

export function connectivityOverlayUrl(
  layer: "projection" | "injection",
  plane: SlicePlane,
  atlasIndex: number,
  atlasResolution: SliceResolution,
  manifest: ConnectivityManifest,
  revision: string | null,
) {
  const positionUm = atlasIndex * atlasResolution;
  const count = manifest.slice_counts[plane];
  const connectivityIndex = Math.min(
    count - 1,
    Math.max(0, Math.round(positionUm / manifest.resolution_um)),
  );
  const paddedIndex = paddedSliceIndex(connectivityIndex);
  return `/api/connectivity/viewer/overlays/${layer}/${plane}/${plane}-${paddedIndex}.webp?v=${revisionQuery(revision)}`;
}

export function connectivityVolumeUrl(
  layer: "projection" | "injection",
  revision: string | null,
) {
  return `/api/connectivity/viewer/volumes/${layer}.bin?v=${revisionQuery(revision)}`;
}

export function nativeConnectivityOverlayUrl(
  layer: "projection" | "injection",
  plane: SlicePlane,
  index: number,
  revision: string | null,
) {
  const paddedIndex = paddedSliceIndex(index);
  return `/api/connectivity/native-viewer/overlays/${layer}/${plane}/${plane}-${paddedIndex}.webp?v=${revisionQuery(revision)}`;
}

export function nativeConnectivityVolumeUrl(
  layer: "projection" | "injection",
  revision: string | null,
) {
  return `/api/connectivity/native-viewer/volumes/${layer}.bin?v=${revisionQuery(revision)}`;
}
