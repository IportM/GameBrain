import { Matrix4, Quaternion, Vector3 } from "three";

const ATLAS_SIZE_MM: [number, number, number] = [13.2, 8, 11.4];
const MESH_CENTER_MM: [number, number, number] = [7.50001, 3.394489, 5.687737];

export const ATLAS_VOLUME_CENTER_MM: [number, number, number] = [
  ATLAS_SIZE_MM[0] / 2 - MESH_CENTER_MM[0],
  ATLAS_SIZE_MM[1] / 2 - MESH_CENTER_MM[1],
  ATLAS_SIZE_MM[2] / 2 - MESH_CENTER_MM[2],
];

export type SlicePlane = "coronal" | "sagittal" | "axial";
export type SliceResolution = 10 | 25 | 50;
export type Slice3DMode = "none" | "plane" | "clip";
export type ClipDirection = "negative" | "positive";

export const SLICE_RESOLUTIONS: SliceResolution[] = [10, 25, 50];

type SliceDefinition = {
  label: string;
  title: string;
  sizeMm: number;
  meshCenterMm: number;
  negativeSide: string;
  positiveSide: string;
};

export const SLICE_PLANES: Record<SlicePlane, SliceDefinition> = {
  coronal: {
    label: "Coronale",
    title: "Coupe coronale",
    sizeMm: ATLAS_SIZE_MM[0],
    meshCenterMm: 7.50001,
    negativeSide: "Antérieur",
    positiveSide: "Postérieur",
  },
  sagittal: {
    label: "Sagittale",
    title: "Coupe sagittale",
    sizeMm: ATLAS_SIZE_MM[2],
    meshCenterMm: 5.687737,
    negativeSide: "Droit",
    positiveSide: "Gauche",
  },
  axial: {
    label: "Axiale",
    title: "Coupe axiale",
    sizeMm: ATLAS_SIZE_MM[1],
    meshCenterMm: 3.394489,
    negativeSide: "Supérieur",
    positiveSide: "Inférieur",
  },
};

export const SLICE_PLANE_ORDER: SlicePlane[] = ["coronal", "sagittal", "axial"];

export function resolutionMm(resolution: SliceResolution) {
  return resolution / 1000;
}

export function sliceCount(plane: SlicePlane, resolution: SliceResolution) {
  return Math.round(SLICE_PLANES[plane].sizeMm / resolutionMm(resolution));
}

export function sliceUrl(plane: SlicePlane, index: number, resolution: SliceResolution) {
  const indexWidth = Math.max(3, String(sliceCount(plane, resolution) - 1).length);
  const paddedIndex = index.toString().padStart(indexWidth, "0");
  return `/atlas/slices/${resolution}/${plane}/${plane}-${paddedIndex}.webp`;
}

export function sliceMaskUrl(plane: SlicePlane, index: number, resolution: SliceResolution) {
  const indexWidth = Math.max(3, String(sliceCount(plane, resolution) - 1).length);
  const paddedIndex = index.toString().padStart(indexWidth, "0");
  return `/atlas/slices/${resolution}/${plane}/masks/${plane}-${paddedIndex}.png`;
}

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

export type RegionDefinition = {
  id: number;
  acronym: string;
  name: string;
  color: string;
  parentId: number;
  parentName: string;
  opacity?: number;
};

export const REGIONS: RegionDefinition[] = [
  {
    id: 315,
    acronym: "Isocortex",
    name: "Isocortex",
    color: "#70ff71",
    parentId: 695,
    parentName: "Cortical plate",
    opacity: 0.24,
  },
  {
    id: 1089,
    acronym: "HPF",
    name: "Hippocampal formation",
    color: "#7ed04b",
    parentId: 695,
    parentName: "Cortical plate",
  },
  {
    id: 512,
    acronym: "CB",
    name: "Cerebellum",
    color: "#f0f080",
    parentId: 8,
    parentName: "Basic cell groups and regions",
  },
  {
    id: 703,
    acronym: "CTXsp",
    name: "Cortical subplate",
    color: "#8ada87",
    parentId: 688,
    parentName: "Cerebral cortex",
  },
  {
    id: 698,
    acronym: "OLF",
    name: "Olfactory areas",
    color: "#9ad2bd",
    parentId: 695,
    parentName: "Cortical plate",
  },
  {
    id: 477,
    acronym: "STR",
    name: "Striatum",
    color: "#98d6f9",
    parentId: 623,
    parentName: "Cerebral nuclei",
  },
  {
    id: 803,
    acronym: "PAL",
    name: "Pallidum",
    color: "#8599cc",
    parentId: 623,
    parentName: "Cerebral nuclei",
  },
  {
    id: 549,
    acronym: "TH",
    name: "Thalamus",
    color: "#ff7080",
    parentId: 1129,
    parentName: "Interbrain",
  },
  {
    id: 1097,
    acronym: "HY",
    name: "Hypothalamus",
    color: "#e64438",
    parentId: 1129,
    parentName: "Interbrain",
  },
  {
    id: 313,
    acronym: "MB",
    name: "Midbrain",
    color: "#ff64ff",
    parentId: 343,
    parentName: "Brain stem",
  },
  {
    id: 771,
    acronym: "P",
    name: "Pons",
    color: "#ff9b88",
    parentId: 1065,
    parentName: "Hindbrain",
  },
  {
    id: 354,
    acronym: "MY",
    name: "Medulla",
    color: "#ff9bcd",
    parentId: 1065,
    parentName: "Hindbrain",
  },
];

export const REGION_ID_BY_MASK_VALUE: Record<number, number> = Object.fromEntries(
  REGIONS.map((region, index) => [index + 1, region.id]),
);

export const MASK_VALUE_BY_REGION_ID: Record<number, number> = Object.fromEntries(
  REGIONS.map((region, index) => [region.id, index + 1]),
);

export const REGION_BY_ID = new Map(REGIONS.map((region) => [region.id, region]));
