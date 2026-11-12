export type ConnectivityPixels = {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
};

const MAX_SLICES = 24;
const MAX_BYTES = 16 * 1024 * 1024;
const slices = new Map<string, ConnectivityPixels>();
let bytes = 0;
let generation = 0;

export function clearConnectivitySliceCache() {
  generation += 1;
  slices.clear();
  bytes = 0;
}

export function loadConnectivityPixels(source: string, signal: AbortSignal): Promise<ConnectivityPixels> {
  if (signal.aborted) return Promise.reject(new DOMException("Chargement annule", "AbortError"));
  const cached = slices.get(source);
  if (cached) {
    slices.delete(source);
    slices.set(source, cached);
    return Promise.resolve(cached);
  }
  const startedGeneration = generation;
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      image.onload = null;
      image.onerror = null;
    };
    const abort = () => {
      cleanup();
      image.src = "";
      reject(new DOMException("Chargement annule", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    image.onerror = () => {
      cleanup();
      reject(new Error(`Calque de connectivite indisponible : ${source}`));
    };
    image.onload = () => {
      cleanup();
      const canvas = document.createElement("canvas");
      try {
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Lecture du calque de connectivite indisponible");
        context.drawImage(image, 0, 0);
        const decoded = {
          pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
          width: canvas.width,
          height: canvas.height,
        };
        if (startedGeneration === generation && decoded.pixels.byteLength <= MAX_BYTES) {
          const previous = slices.get(source);
          if (previous) bytes -= previous.pixels.byteLength;
          slices.delete(source);
          slices.set(source, decoded);
          bytes += decoded.pixels.byteLength;
          while (slices.size > MAX_SLICES || bytes > MAX_BYTES) {
            const oldest = slices.keys().next().value!;
            bytes -= slices.get(oldest)!.pixels.byteLength;
            slices.delete(oldest);
          }
        }
        resolve(decoded);
      } catch (error) {
        reject(error);
      } finally {
        canvas.width = canvas.height = 0;
      }
    };
    image.src = source;
  });
}

export function connectivityAlphaTable(opacity: number, threshold: number) {
  const table = new Uint8ClampedArray(256);
  for (let alpha = 0; alpha < table.length; alpha += 1) {
    const strength = alpha / 255;
    if (strength < threshold) continue;
    const visible = Math.min(1, Math.max(0, (strength - threshold) / Math.max(0.001, 1 - threshold)));
    table[alpha] = Math.round(255 * opacity * (0.18 + 0.82 * Math.pow(visible, 0.7)));
  }
  return table;
}
