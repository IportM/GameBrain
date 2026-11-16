import type { BufferGeometry } from "three";

const MAX_READY_REGIONS = 128;
const readyRegions = new Set<string>();

export function markRegionMeshReady(url: string) {
  readyRegions.delete(url);
  readyRegions.add(url);
  while (readyRegions.size > MAX_READY_REGIONS) readyRegions.delete(readyRegions.values().next().value!);
}

export function regionHoverDelay(url: string) {
  return readyRegions.has(url) ? 0 : 80;
}

export function prepareRegionGeometry(geometry: BufferGeometry) {
  if (!geometry.hasAttribute("normal")) geometry.computeVertexNormals();
}
