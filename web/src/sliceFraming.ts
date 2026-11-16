export type BrainBounds = { left: number; top: number; right: number; bottom: number; width: number; height: number };

export function brainBounds(mask: ArrayLike<number>, width: number, height: number, stride = 1, offset = 0): BrainBounds | null {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[(y * width + x) * stride + offset] <= 0) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  return right < left ? null : { left, top, right: right + 1, bottom: bottom + 1, width, height };
}

export function frameBrain(bounds: BrainBounds, viewportWidth: number, viewportHeight: number, requestedZoom: number) {
  const scale = Math.min(viewportWidth / bounds.width, viewportHeight / bounds.height);
  const limit = Math.max(1, Math.min(
    viewportWidth / ((bounds.right - bounds.left) * scale),
    viewportHeight / ((bounds.bottom - bounds.top) * scale),
  ) * 0.94);
  const zoom = Math.min(requestedZoom, limit);
  return {
    zoom, limit,
    x: (bounds.width / 2 - (bounds.left + bounds.right) / 2) * scale * zoom,
    y: (bounds.height / 2 - (bounds.top + bounds.bottom) / 2) * scale * zoom,
  };
}
