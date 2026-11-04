import type { SlicePlane } from "./atlas";

export type ModalitySlice = {
  values: Float32Array;
  mask: Uint8Array;
  width: number;
  height: number;
};

export type ModalityPalette = "gray" | "viridis" | "magma" | "hot";

const MAX_CACHED_SLICES = 96;
const cache = new Map<string, Promise<ModalitySlice>>();

export function loadModalitySlice(
  modalityId: string,
  plane: SlicePlane,
  index: number,
): Promise<ModalitySlice> {
  const key = `${modalityId}:${plane}:${index}`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const encodedId = encodeURIComponent(modalityId);
  const request = fetch(`/api/modalities/${encodedId}/raw-slice/${plane}/${index}`)
    .then(async (response) => {
      if (!response.ok) throw new Error("Coupe numérique indisponible");
      const width = Number(response.headers.get("X-Slice-Width"));
      const height = Number(response.headers.get("X-Slice-Height"));
      const pixels = width * height;
      const buffer = await response.arrayBuffer();
      if (!Number.isInteger(pixels) || pixels <= 0 || buffer.byteLength !== pixels * 5) {
        throw new Error("Dimensions de coupe numérique incompatibles");
      }
      return {
        values: new Float32Array(buffer, 0, pixels),
        mask: new Uint8Array(buffer, pixels * Float32Array.BYTES_PER_ELEMENT, pixels),
        width,
        height,
      };
    });
  cache.set(key, request);
  void request.catch(() => cache.delete(key));
  while (cache.size > MAX_CACHED_SLICES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return request;
}
