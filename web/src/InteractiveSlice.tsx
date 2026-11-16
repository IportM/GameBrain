import { useI18n } from "./i18n";
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
import type { ModalityPalette, ModalitySlice } from "./modalityVolume";
import { loadConnectivityPixels, type ConnectivityPixels } from "./connectivitySliceCache";
import { drawConnectivityOverlay } from "./drawConnectivityOverlay";

const PALETTES: Record<Exclude<ModalityPalette, "gray">, Array<[number, number, number]>> = {
  viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  magma: [[0, 0, 4], [81, 18, 124], [183, 55, 121], [252, 137, 97], [252, 253, 191]],
  hot: [[0, 0, 0], [180, 0, 0], [255, 95, 0], [255, 230, 80], [255, 255, 255]],
};

function paletteColor(value: number, palette: ModalityPalette): [number, number, number] {
  if (palette === "gray") {
    const gray = Math.round(value * 255);
    return [gray, gray, gray];
  }
  const colors = PALETTES[palette];
  const position = value * (colors.length - 1);
  const lower = Math.min(colors.length - 2, Math.floor(position));
  const ratio = position - lower;
  return colors[lower].map((channel, index) =>
    Math.round(channel + (colors[lower + 1][index] - channel) * ratio),
  ) as [number, number, number];
}

type SliceMaskData = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
};

type DetailedHighlight = {
  color: string;
  maskValue: number;
};

function maskValueAt(mask: SliceMaskData, pixel: number, rgbEncoded: boolean) {
  const offset = pixel * 4;
  return rgbEncoded
    ? mask.pixels[offset] | (mask.pixels[offset + 1] << 8) | (mask.pixels[offset + 2] << 16)
    : mask.pixels[offset];
}

export type ConnectivityInspection = {
  plane: SlicePlane;
  index: number;
  regionId: number | null;
  projection: number;
  injection: number;
};

type ConnectivitySample = Pick<ConnectivityInspection, "projection" | "injection">;
type ConnectivitySampler = (horizontal: number, vertical: number) => ConnectivitySample;

type ConnectivityLayer = ConnectivityPixels & {
  kind: "projection" | "injection";
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
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const [layers, setLayers] = useState<ConnectivityLayer[]>([]);

  useEffect(() => {
    const sources = [
      projectionSrc ? { kind: "projection" as const, source: projectionSrc } : null,
      injectionSrc ? { kind: "injection" as const, source: injectionSrc } : null,
    ].filter((source): source is NonNullable<typeof source> => source !== null);
    let cancelled = false;
    const controller = new AbortController();
    setLayers([]);
    onSamplerChange(null);
    if (sources.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    const loadLayer = async ({ kind, source }: (typeof sources)[number]): Promise<ConnectivityLayer> =>
      ({ kind, ...await loadConnectivityPixels(source, controller.signal) });

    void Promise.all(sources.map(loadLayer)).then((loadedLayers) => {
      if (!cancelled) setLayers(loadedLayers);
    }).catch(() => {
      if (!cancelled) setLayers([]);
    });

    return () => {
      cancelled = true;
      controller.abort();
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
    const layer = scratchRef.current ?? document.createElement("canvas");
    scratchRef.current = layer;
    drawConnectivityOverlay(canvas, layers, opacity, threshold, layer);
  }, [layers, opacity, threshold]);

  useEffect(() => () => {
    if (scratchRef.current) scratchRef.current.width = scratchRef.current.height = 0;
  }, []);

  return <canvas ref={canvasRef} className="slice-connectivity-overlay" aria-hidden="true" />;
}

function InteractiveSlice({
  annotationOutlineSrc,
  annotationsEnabled = true,
  annotationsVisible = annotationsEnabled,
  connectivityInjectionSrc,
  connectivityInspectionEnabled = false,
  connectivityOpacity = 1,
  connectivityProjectionSrc,
  connectivityThreshold = 0,
  detailedHighlight,
  detailedMaskSrc,
  detailedMaskValueToRegionId,
  hoveredRegionId,
  imageSrc,
  imageResolutionMicrometers,
  index,
  maskOutlineSrc,
  maskSrc,
  modalityInverted = false,
  modalityBrainOnly = true,
  modalityPalette = "gray",
  modalityVisible = false,
  modalitySliceData,
  modalityWindow,
  onConnectivityInspect,
  onConnectivityPin,
  onHoverDetailedRegion,
  onHoverRegion,
  onInspectRegion,
  onSelectDetailedRegion,
  onSelectRegion,
  plane,
  regionColorsVisible = true,
  resolution,
}: {
  annotationOutlineSrc?: string;
  annotationsEnabled?: boolean;
  annotationsVisible?: boolean;
  connectivityInjectionSrc?: string;
  connectivityInspectionEnabled?: boolean;
  connectivityOpacity?: number;
  connectivityProjectionSrc?: string;
  connectivityThreshold?: number;
  detailedHighlight?: DetailedHighlight | null;
  detailedMaskSrc?: string;
  detailedMaskValueToRegionId?: ReadonlyMap<number, number>;
  hoveredRegionId: number | null;
  imageSrc?: string;
  imageResolutionMicrometers?: number;
  index: number;
  maskOutlineSrc?: string;
  maskSrc?: string;
  modalityInverted?: boolean;
  modalityBrainOnly?: boolean;
  modalityPalette?: ModalityPalette;
  modalityVisible?: boolean;
  modalitySliceData?: ModalitySlice | null;
  modalityWindow?: [number, number];
  onConnectivityInspect?: (inspection: ConnectivityInspection | null) => void;
  onConnectivityPin?: (inspection: ConnectivityInspection | null) => void;
  onHoverDetailedRegion?: (regionId: number | null) => void;
  onHoverRegion: (regionId: number | null) => void;
  onInspectRegion?: (regionId: number | null) => void;
  onSelectDetailedRegion?: (regionId: number | null) => void;
  onSelectRegion: (regionId: number | null) => void;
  plane: SlicePlane;
  regionColorsVisible?: boolean;
  resolution: SliceResolution;
}) {
  const { t } = useI18n();
  const imageRef = useRef<HTMLImageElement>(null);
  const modalityCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const maskDataRef = useRef<SliceMaskData | null>(null);
  const detailedMaskDataRef = useRef<SliceMaskData | null>(null);
  const connectivitySamplerRef = useRef<ConnectivitySampler | null>(null);
  const [maskRevision, setMaskRevision] = useState(0);
  const [detailedMaskRevision, setDetailedMaskRevision] = useState(0);

  useEffect(() => {
    const canvas = modalityCanvasRef.current;
    if (!canvas || !modalitySliceData || !modalityWindow) return;
    const { width, height } = modalitySliceData;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;
    const image = context.createImageData(width, height);
    const low = Math.min(modalityWindow[0], modalityWindow[1] - Number.EPSILON);
    const high = Math.max(modalityWindow[1], low + Number.EPSILON);
    const range = high - low;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const source = y * width + x;
        const target = source * 4;
        let normalized = Math.min(1, Math.max(0, (modalitySliceData.values[source] - low) / range));
        if (modalityInverted) normalized = 1 - normalized;
        const [red, green, blue] = paletteColor(normalized, modalityPalette);
        image.data[target] = red;
        image.data[target + 1] = green;
        image.data[target + 2] = blue;
        image.data[target + 3] = modalityBrainOnly && modalitySliceData.mask[source] === 0 ? 0 : 255;
      }
    }
    context.putImageData(image, 0, 0);
  }, [modalityBrainOnly, modalityInverted, modalityPalette, modalitySliceData, modalityWindow]);

  useEffect(() => {
    let cancelled = false;
    let loadDelay: number | null = null;
    maskDataRef.current = null;
    const overlay = overlayRef.current;
    overlay?.getContext("2d")?.clearRect(0, 0, overlay.width, overlay.height);
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
    let cancelled = false;
    detailedMaskDataRef.current = null;
    const overlay = overlayRef.current;
    overlay?.getContext("2d")?.clearRect(0, 0, overlay.width, overlay.height);
    if (!detailedMaskSrc) {
      setDetailedMaskRevision((current) => current + 1);
      return () => {
        cancelled = true;
      };
    }
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0);
      detailedMaskDataRef.current = {
        width: canvas.width,
        height: canvas.height,
        pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
      };
      setDetailedMaskRevision((current) => current + 1);
    };
    image.src = detailedMaskSrc;
    return () => {
      cancelled = true;
    };
  }, [detailedMaskSrc]);

  useEffect(() => {
    const canvas = overlayRef.current;
    const detailedMaskData = detailedMaskDataRef.current;
    const maskData = detailedHighlight
      ? detailedMaskData
      : maskDataRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    context?.clearRect(0, 0, canvas.width, canvas.height);
    if (
      !context ||
      !maskData ||
      (!detailedHighlight && hoveredRegionId === null) ||
      !regionColorsVisible
    ) {
      return;
    }

    const maskValue = detailedHighlight?.maskValue ??
      (hoveredRegionId === null ? undefined : MASK_VALUE_BY_REGION_ID[hoveredRegionId]);
    const regionColor = detailedHighlight?.color ??
      (hoveredRegionId === null ? undefined : REGION_BY_ID.get(hoveredRegionId)?.color);
    if (!maskValue || !regionColor) {
      return;
    }

    // The detailed and major-region masks can have different pixel dimensions.
    if (canvas.width !== maskData.width) canvas.width = maskData.width;
    if (canvas.height !== maskData.height) canvas.height = maskData.height;

    const color = Number.parseInt(regionColor.slice(1), 16);
    const red = (color >> 16) & 255;
    const green = (color >> 8) & 255;
    const blue = color & 255;
    const highlight = context.createImageData(maskData.width, maskData.height);
    for (let pixel = 0; pixel < maskData.width * maskData.height; pixel += 1) {
      const pixelOffset = pixel * 4;
      const pixelMaskValue = detailedHighlight
        ? maskData.pixels[pixelOffset] |
          (maskData.pixels[pixelOffset + 1] << 8) |
          (maskData.pixels[pixelOffset + 2] << 16)
        : maskData.pixels[pixelOffset];
      if (pixelMaskValue !== maskValue) {
        continue;
      }
      const x = pixel % maskData.width;
      const y = Math.floor(pixel / maskData.width);
      const isBoundary = [1, 2].some((distance) =>
        x - distance < 0 ||
        x + distance >= maskData.width ||
        y - distance < 0 ||
        y + distance >= maskData.height ||
        maskValueAt(maskData, y * maskData.width + x - distance, Boolean(detailedHighlight)) !== maskValue ||
        maskValueAt(maskData, y * maskData.width + x + distance, Boolean(detailedHighlight)) !== maskValue ||
        maskValueAt(maskData, (y - distance) * maskData.width + x, Boolean(detailedHighlight)) !== maskValue ||
        maskValueAt(maskData, (y + distance) * maskData.width + x, Boolean(detailedHighlight)) !== maskValue,
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
  }, [
    detailedHighlight,
    detailedMaskRevision,
    hoveredRegionId,
    index,
    maskRevision,
    plane,
    regionColorsVisible,
    resolution,
  ]);

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

  const detailedRegionAtPosition = (
    position: { horizontal: number; vertical: number } | null,
  ) => {
    const maskData = detailedMaskDataRef.current;
    if (!maskData || !position || !detailedMaskValueToRegionId) return null;
    const x = Math.min(maskData.width - 1, Math.floor(position.horizontal * maskData.width));
    const y = Math.min(maskData.height - 1, Math.floor(position.vertical * maskData.height));
    return detailedMaskValueToRegionId.get(maskValueAt(maskData, y * maskData.width + x, true)) ?? null;
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
    onInspectRegion?.(detailedRegionAtPosition(position) ?? (
      annotationsEnabled ? regionAtPosition(position) : null
    ));
    if (annotationsEnabled) onHoverRegion(regionAtPosition(position));
    onHoverDetailedRegion?.(detailedRegionAtPosition(position));
    onConnectivityInspect?.(connectivityAtPosition(position));
  };

  return (
    <>
      <img
        ref={imageRef}
        className={regionColorsVisible ? undefined : "is-region-colors-hidden"}
        style={modalityVisible && modalitySliceData ? { opacity: 0 } : undefined}
        src={imageSrc ?? sliceUrl(plane, index, resolution)}
        alt={`${t(SLICE_PLANES[plane].title)} ${index} ${
          imageSrc
            ? t(`de l'image importée${imageResolutionMicrometers
              ? t(` à ${imageResolutionMicrometers} micromètres`)
              : ""}`)
            : t(`à ${resolution} micromètres de l'atlas Allen`)
        }${annotationsVisible ? t(" avec annotations") : ""}`}
        draggable={false}
        decoding="async"
        onClick={(event) => {
          const position = pointerPosition(event);
          if (connectivityInspectionEnabled) {
            onConnectivityPin?.(connectivityAtPosition(position));
          }
          if (annotationsEnabled) {
            const detailedRegionId = detailedRegionAtPosition(position);
            if (detailedRegionId !== null && onSelectDetailedRegion) {
              onSelectDetailedRegion(detailedRegionId);
            } else {
              onSelectRegion(regionAtPosition(position));
            }
          }
        }}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => {
          onInspectRegion?.(null);
          onHoverRegion(null);
          onHoverDetailedRegion?.(null);
          onConnectivityInspect?.(null);
        }}
      />
      {modalitySliceData && (
        <canvas
          ref={modalityCanvasRef}
          className="slice-modality-base"
          style={modalityVisible ? undefined : { display: "none" }}
          aria-hidden="true"
        />
      )}
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
