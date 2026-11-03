import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import {
  MASK_VALUE_BY_REGION_ID,
  REGION_BY_ID,
  REGION_ID_BY_MASK_VALUE,
  SLICE_PLANES,
  sliceMaskUrl,
  sliceUrl,
  type SlicePlane,
  type SliceResolution,
} from "./atlas";

type SliceMaskData = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
};

export type ConnectivityInspection = {
  plane: SlicePlane;
  index: number;
  regionId: number | null;
  projection: number;
  injection: number;
};

type ConnectivitySample = Pick<ConnectivityInspection, "projection" | "injection">;
type ConnectivitySampler = (horizontal: number, vertical: number) => ConnectivitySample;

type ConnectivityLayer = {
  kind: "projection" | "injection";
  image: HTMLImageElement;
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
};

function ConnectivityOverlay({
  injectionSrc,
  onSamplerChange,
  opacity,
  projectionSrc,
  threshold,
}: {
  injectionSrc?: string;
  onSamplerChange: (sampler: ConnectivitySampler | null) => void;
  opacity: number;
  projectionSrc?: string;
  threshold: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [layers, setLayers] = useState<ConnectivityLayer[]>([]);

  useEffect(() => {
    const sources = [
      projectionSrc ? { kind: "projection" as const, source: projectionSrc } : null,
      injectionSrc ? { kind: "injection" as const, source: injectionSrc } : null,
    ].filter((source): source is NonNullable<typeof source> => source !== null);
    let cancelled = false;
    setLayers([]);
    onSamplerChange(null);
    if (sources.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    const loadLayer = ({ kind, source }: (typeof sources)[number]) =>
      new Promise<ConnectivityLayer>((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) {
            reject(new Error("Lecture du calque de connectivité indisponible"));
            return;
          }
          context.drawImage(image, 0, 0);
          resolve({
            kind,
            image,
            pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
            width: canvas.width,
            height: canvas.height,
          });
        };
        image.onerror = () =>
          reject(new Error(`Calque de connectivité indisponible : ${source}`));
        image.src = source;
      });

    void Promise.all(sources.map(loadLayer)).then((loadedLayers) => {
      if (!cancelled) setLayers(loadedLayers);
    }).catch(() => {
      if (!cancelled) setLayers([]);
    });

    return () => {
      cancelled = true;
    };
  }, [injectionSrc, projectionSrc]);

  useEffect(() => {
    if (layers.length === 0) {
      onSamplerChange(null);
      return;
    }
    onSamplerChange((horizontal, vertical) => {
      const sample: ConnectivitySample = { projection: 0, injection: 0 };
      for (const layer of layers) {
        const x = Math.min(layer.width - 1, Math.max(0, Math.floor(horizontal * layer.width)));
        const y = Math.min(layer.height - 1, Math.max(0, Math.floor(vertical * layer.height)));
        sample[layer.kind] = layer.pixels[(y * layer.width + x) * 4 + 3] / 255;
      }
      return sample;
    });
    return () => onSamplerChange(null);
  }, [layers]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (layers.length === 0) return;

    const [first] = layers;
    canvas.width = first.width;
    canvas.height = first.height;
    context.clearRect(0, 0, canvas.width, canvas.height);

    for (const { image } of layers) {
      const layer = document.createElement("canvas");
      layer.width = canvas.width;
      layer.height = canvas.height;
      const layerContext = layer.getContext("2d", { willReadFrequently: true });
      if (!layerContext) continue;
      layerContext.drawImage(image, 0, 0);
      const pixels = layerContext.getImageData(0, 0, layer.width, layer.height);
      for (let offset = 3; offset < pixels.data.length; offset += 4) {
        const strength = pixels.data[offset] / 255;
        if (strength < threshold) {
          pixels.data[offset] = 0;
          continue;
        }
        const visibleStrength = Math.min(
          1,
          Math.max(0, (strength - threshold) / Math.max(0.001, 1 - threshold)),
        );
        const enhancedAlpha = 0.18 + 0.82 * Math.pow(visibleStrength, 0.7);
        pixels.data[offset] = Math.round(255 * opacity * enhancedAlpha);
      }
      layerContext.putImageData(pixels, 0, 0);
      context.drawImage(layer, 0, 0);
    }
  }, [layers, opacity, threshold]);

  return <canvas ref={canvasRef} className="slice-connectivity-overlay" aria-hidden="true" />;
}

function InteractiveSlice({
  annotationOutlineSrc,
  annotationsEnabled = true,
  connectivityInjectionSrc,
  connectivityInspectionEnabled = false,
  connectivityOpacity = 1,
  connectivityProjectionSrc,
  connectivityThreshold = 0,
  hoveredRegionId,
  imageSrc,
  index,
  maskOutlineSrc,
  maskSrc,
  onConnectivityInspect,
  onConnectivityPin,
  onHoverRegion,
  onSelectRegion,
  plane,
  regionColorsVisible = true,
  resolution,
}: {
  annotationOutlineSrc?: string;
  annotationsEnabled?: boolean;
  connectivityInjectionSrc?: string;
  connectivityInspectionEnabled?: boolean;
  connectivityOpacity?: number;
  connectivityProjectionSrc?: string;
  connectivityThreshold?: number;
  hoveredRegionId: number | null;
  imageSrc?: string;
  index: number;
  maskOutlineSrc?: string;
  maskSrc?: string;
  onConnectivityInspect?: (inspection: ConnectivityInspection | null) => void;
  onConnectivityPin?: (inspection: ConnectivityInspection | null) => void;
  onHoverRegion: (regionId: number | null) => void;
  onSelectRegion: (regionId: number | null) => void;
  plane: SlicePlane;
  regionColorsVisible?: boolean;
  resolution: SliceResolution;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const maskDataRef = useRef<SliceMaskData | null>(null);
  const connectivitySamplerRef = useRef<ConnectivitySampler | null>(null);
  const [maskRevision, setMaskRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let loadDelay: number | null = null;
    maskDataRef.current = null;
    if (!annotationsEnabled) {
      if (overlayRef.current) {
        const context = overlayRef.current.getContext("2d");
        context?.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
      }
      return () => {
        cancelled = true;
      };
    }
    const loadMask = () => {
      const maskImage = new Image();
      maskImage.decoding = "async";
      maskImage.onload = () => {
        if (cancelled) {
          return;
        }

        const readCanvas = document.createElement("canvas");
        readCanvas.width = maskImage.naturalWidth;
        readCanvas.height = maskImage.naturalHeight;
        const context = readCanvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          return;
        }

        context.drawImage(maskImage, 0, 0);
        maskDataRef.current = {
          width: readCanvas.width,
          height: readCanvas.height,
          pixels: context.getImageData(0, 0, readCanvas.width, readCanvas.height).data,
        };

        if (overlayRef.current) {
          overlayRef.current.width = readCanvas.width;
          overlayRef.current.height = readCanvas.height;
        }
        setMaskRevision((current) => current + 1);
      };
      maskImage.src = maskSrc ?? sliceMaskUrl(plane, index, resolution);
    };

    if (resolution === 10) {
      loadDelay = window.setTimeout(loadMask, 90);
    } else {
      loadMask();
    }
    return () => {
      cancelled = true;
      if (loadDelay !== null) window.clearTimeout(loadDelay);
    };
  }, [annotationsEnabled, index, maskSrc, plane, resolution]);

  useEffect(() => {
    const canvas = overlayRef.current;
    const maskData = maskDataRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    context?.clearRect(0, 0, canvas.width, canvas.height);
    if (!context || !maskData || hoveredRegionId === null || !regionColorsVisible) {
      return;
    }

    const maskValue = MASK_VALUE_BY_REGION_ID[hoveredRegionId];
    const region = REGION_BY_ID.get(hoveredRegionId);
    if (!maskValue || !region) {
      return;
    }

    const color = Number.parseInt(region.color.slice(1), 16);
    const red = (color >> 16) & 255;
    const green = (color >> 8) & 255;
    const blue = color & 255;
    const highlight = context.createImageData(maskData.width, maskData.height);
    for (let pixel = 0; pixel < maskData.width * maskData.height; pixel += 1) {
      if (maskData.pixels[pixel * 4] !== maskValue) {
        continue;
      }
      const x = pixel % maskData.width;
      const y = Math.floor(pixel / maskData.width);
      const isBoundary = [1, 2].some((distance) =>
        x - distance < 0 ||
        x + distance >= maskData.width ||
        y - distance < 0 ||
        y + distance >= maskData.height ||
        maskData.pixels[(y * maskData.width + x - distance) * 4] !== maskValue ||
        maskData.pixels[(y * maskData.width + x + distance) * 4] !== maskValue ||
        maskData.pixels[((y - distance) * maskData.width + x) * 4] !== maskValue ||
        maskData.pixels[((y + distance) * maskData.width + x) * 4] !== maskValue,
      );
      if (!isBoundary) {
        continue;
      }
      const offset = pixel * 4;
      highlight.data[offset] = red;
      highlight.data[offset + 1] = green;
      highlight.data[offset + 2] = blue;
      highlight.data[offset + 3] = 235;
    }
    context.putImageData(highlight, 0, 0);
  }, [hoveredRegionId, index, maskRevision, plane, regionColorsVisible, resolution]);

  const pointerPosition = (event: { clientX: number; clientY: number }) => {
    const image = imageRef.current;
    if (!image || image.naturalWidth === 0 || image.naturalHeight === 0) {
      return null;
    }

    const bounds = image.getBoundingClientRect();
    const scale = Math.min(
      bounds.width / image.naturalWidth,
      bounds.height / image.naturalHeight,
    );
    const renderedWidth = image.naturalWidth * scale;
    const renderedHeight = image.naturalHeight * scale;
    const renderedLeft = bounds.left + (bounds.width - renderedWidth) / 2;
    const renderedTop = bounds.top + (bounds.height - renderedHeight) / 2;
    const horizontal = (event.clientX - renderedLeft) / renderedWidth;
    const vertical = (event.clientY - renderedTop) / renderedHeight;

    if (horizontal < 0 || vertical < 0 || horizontal >= 1 || vertical >= 1) {
      return null;
    }
    return { horizontal, vertical };
  };

  const regionAtPosition = (position: { horizontal: number; vertical: number } | null) => {
    const maskData = maskDataRef.current;
    if (!maskData || !position) return null;
    const x = Math.min(maskData.width - 1, Math.floor(position.horizontal * maskData.width));
    const y = Math.min(maskData.height - 1, Math.floor(position.vertical * maskData.height));

    const maskValue = maskData.pixels[(y * maskData.width + x) * 4];
    return REGION_ID_BY_MASK_VALUE[maskValue] ?? null;
  };

  const connectivityAtPosition = (
    position: { horizontal: number; vertical: number } | null,
  ): ConnectivityInspection | null => {
    const sampler = connectivitySamplerRef.current;
    if (!connectivityInspectionEnabled || !position || !sampler) return null;
    const sample = sampler(position.horizontal, position.vertical);
    const projection = sample.projection >= connectivityThreshold ? sample.projection : 0;
    const injection = sample.injection >= connectivityThreshold ? sample.injection : 0;
    if (projection === 0 && injection === 0) return null;
    return {
      plane,
      index,
      regionId: regionAtPosition(position),
      projection,
      injection,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLImageElement>) => {
    const position = pointerPosition(event);
    if (annotationsEnabled) onHoverRegion(regionAtPosition(position));
    onConnectivityInspect?.(connectivityAtPosition(position));
  };

  return (
    <>
      <img
        ref={imageRef}
        className={regionColorsVisible ? undefined : "is-region-colors-hidden"}
        src={imageSrc ?? sliceUrl(plane, index, resolution)}
        alt={annotationsEnabled
          ? `${SLICE_PLANES[plane].title} ${index} à ${resolution} micromètres de l'atlas Allen avec annotations`
          : `${SLICE_PLANES[plane].title} ${index} de l'image importée`}
        draggable={false}
        decoding="async"
        onClick={(event) => {
          const position = pointerPosition(event);
          if (connectivityInspectionEnabled) {
            onConnectivityPin?.(connectivityAtPosition(position));
            return;
          }
          if (annotationsEnabled) onSelectRegion(regionAtPosition(position));
        }}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => {
          onHoverRegion(null);
          onConnectivityInspect?.(null);
        }}
      />
      {(connectivityProjectionSrc || connectivityInjectionSrc) && (
        <ConnectivityOverlay
          injectionSrc={connectivityInjectionSrc}
          onSamplerChange={(sampler) => {
            connectivitySamplerRef.current = sampler;
          }}
          opacity={connectivityOpacity}
          projectionSrc={connectivityProjectionSrc}
          threshold={connectivityThreshold}
        />
      )}
      {maskOutlineSrc && (
        <img
          className="slice-mask-outline"
          src={maskOutlineSrc}
          alt=""
          aria-hidden="true"
          draggable={false}
          decoding="async"
        />
      )}
      {annotationOutlineSrc && (
        <img
          className="slice-annotation-outline"
          src={annotationOutlineSrc}
          alt=""
          aria-hidden="true"
          draggable={false}
          decoding="async"
        />
      )}
      <canvas ref={overlayRef} aria-hidden="true" />
    </>
  );
}

export default memo(InteractiveSlice);
