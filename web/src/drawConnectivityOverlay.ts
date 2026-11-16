import { connectivityAlphaTable, type ConnectivityPixels } from "./connectivitySliceCache";

export function drawConnectivityOverlay(canvas: HTMLCanvasElement, sources: readonly ConnectivityPixels[], opacity: number, threshold: number, scratch: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (sources.length === 0) return;
  canvas.width = sources[0].width;
  canvas.height = sources[0].height;
  const alphaTable = connectivityAlphaTable(opacity, threshold);
  for (const source of sources) {
    scratch.width = source.width;
    scratch.height = source.height;
    const layerContext = scratch.getContext("2d");
    if (!layerContext) continue;
    const pixels = new ImageData(new Uint8ClampedArray(source.pixels), source.width, source.height);
    for (let offset = 3; offset < pixels.data.length; offset += 4) pixels.data[offset] = alphaTable[pixels.data[offset]];
    layerContext.putImageData(pixels, 0, 0);
    context.drawImage(scratch, 0, 0, canvas.width, canvas.height);
  }
}
