import { sliceCount, type SlicePlane, type SliceResolution } from "./atlas";

export type DetailedAnnotationStructure = {
  acronym: string;
  color: string;
  id: number;
  maskValue: number;
  meshAvailable: boolean;
  name: string;
  parentId: number | null;
  parentName: string | null;
  path: number[];
};

export type DetailedAnnotationManifest = {
  encoding: "rgb24-mask-value";
  resolution_um: 25;
  structure_count: number;
  structures: DetailedAnnotationStructure[];
};

function detailedAnnotationIndex(
  plane: SlicePlane,
  index: number,
  resolution: SliceResolution,
) {
  if (resolution === 25) return index;
  const sourceLastIndex = Math.max(1, sliceCount(plane, resolution) - 1);
  const detailedLastIndex = sliceCount(plane, 25) - 1;
  return Math.round((index / sourceLastIndex) * detailedLastIndex);
}

export function detailedAnnotationMaskUrl(
  plane: SlicePlane,
  index: number,
  resolution: SliceResolution = 25,
) {
  const paddedIndex = detailedAnnotationIndex(plane, index, resolution)
    .toString()
    .padStart(3, "0");
  return `/atlas/slices/25/${plane}/detailed-masks/${plane}-${paddedIndex}.png`;
}

export function detailedAnnotationOutlineUrl(
  plane: SlicePlane,
  index: number,
  resolution: SliceResolution = 25,
) {
  const paddedIndex = detailedAnnotationIndex(plane, index, resolution)
    .toString()
    .padStart(3, "0");
  return `/atlas/slices/25/${plane}/detailed-outlines/${plane}-${paddedIndex}.webp`;
}

export function detailedAnnotationMeshUrl(regionId: number) {
  return `/atlas/detailed-regions/${regionId}.glb`;
}
