import { useEffect, useState } from "react";
import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three";
import { loadConnectivityPixels } from "./connectivitySliceCache";
import { drawConnectivityOverlay, drawSliceOutline } from "./drawConnectivityOverlay";

function useSliceLayerTexture(projection: string | undefined, injection: string | undefined, opacity: number, threshold: number, preserveAlpha: boolean) {
  const key = JSON.stringify([projection, injection, opacity, threshold, preserveAlpha]);
  const [loaded, setLoaded] = useState<{ key: string; texture: CanvasTexture } | null>(null);
  useEffect(() => {
    const sources = [projection, injection].filter((source): source is string => Boolean(source));
    if (sources.length === 0) return;
    const controller = new AbortController();
    let texture: CanvasTexture | null = null;
    void Promise.all(sources.map((source) => loadConnectivityPixels(source, controller.signal))).then((layers) => {
      if (controller.signal.aborted) return;
      const canvas = document.createElement("canvas");
      if (preserveAlpha) {
        drawSliceOutline(canvas, layers[0]);
      } else {
        drawConnectivityOverlay(canvas, layers, opacity, threshold, document.createElement("canvas"));
      }
      texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      texture.generateMipmaps = false;
      texture.minFilter = LinearFilter;
      setLoaded({ key, texture });
    }).catch(() => {
      // A missing layer must not hide the anatomical slice or crash the scene.
    });
    return () => { controller.abort(); texture?.dispose(); };
  }, [projection, injection, opacity, threshold, preserveAlpha, key]);
  return loaded?.key === key ? loaded.texture : null;
}

export function useConnectivitySliceTexture(projection: string | undefined, injection: string | undefined, opacity: number, threshold: number) {
  return useSliceLayerTexture(projection, injection, opacity, threshold, false);
}

export function useSliceOutlineTexture(source: string | undefined) {
  return useSliceLayerTexture(source, undefined, 1, 0, true);
}
