import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

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

function ConnectivityOverlay({
  injectionSrc,
  opacity,
  projectionSrc,
  threshold,
}: {
  injectionSrc?: string;
  opacity: number;
  projectionSrc?: string;
  threshold: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [images, setImages] = useState<HTMLImageElement[]>([]);

  useEffect(() => {
    const sources = [projectionSrc, injectionSrc].filter(
      (source): source is string => Boolean(source),
    );
    let cancelled = false;
    setImages([]);
    if (sources.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    const loadImage = (source: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () =>
          reject(new Error(`Calque de connectivité indisponible : ${source}`));
        image.src = source;
      });

    void Promise.all(sources.map(loadImage)).then((images) => {
      if (!cancelled) setImages(images);
    }).catch(() => {
      if (!cancelled) setImages([]);
    });

    return () => {
      cancelled = true;
    };
  }, [injectionSrc, projectionSrc]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (images.length === 0) return;

    const [first] = images;
    canvas.width = first.naturalWidth;
    canvas.height = first.naturalHeight;
    context.clearRect(0, 0, canvas.width, canvas.height);

    for (const image of images) {
      const layer = document.createElement("canvas");
      layer.width = canvas.width;
      layer.height = canvas.height;
      const layerContext = layer.getContext("2d", { willReadFrequently: true });
      if (!layerContext) continue;
      layerContext.drawImage(image, 0, 0);
      const pixels = layerContext.getImageData(0, 0, layer.width, layer.height);
      const minimumAlpha = Math.round(threshold * 255);
      for (let offset = 3; offset < pixels.data.length; offset += 4) {
        const alpha = pixels.data[offset];
        pixels.data[offset] = alpha < minimumAlpha ? 0 : Math.round(alpha * opacity);
      }
      layerContext.putImageData(pixels, 0, 0);
      context.drawImage(layer, 0, 0);
    }
  }, [images, opacity, threshold]);

  return <canvas ref={canvasRef} className="slice-connectivity-overlay" aria-hidden="true" />;
}

export default function InteractiveSlice({
  annotationOutlineSrc,
  annotationsEnabled = true,
  connectivityInjectionSrc,
  connectivityOpacity = 1,
  connectivityProjectionSrc,
  connectivityThreshold = 0,
  hoveredRegionId,
  imageSrc,
  index,
  maskOutlineSrc,
  maskSrc,
  onHoverRegion,
  onSelectRegion,
  plane,
  resolution,
}: {
  annotationOutlineSrc?: string;
  annotationsEnabled?: boolean;
  connectivityInjectionSrc?: string;
  connectivityOpacity?: number;
  connectivityProjectionSrc?: string;
  connectivityThreshold?: number;
  hoveredRegionId: number | null;
  imageSrc?: string;
  index: number;
  maskOutlineSrc?: string;
  maskSrc?: string;
  onHoverRegion: (regionId: number | null) => void;
  onSelectRegion: (regionId: number | null) => void;
  plane: SlicePlane;
  resolution: SliceResolution;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const maskDataRef = useRef<SliceMaskData | null>(null);
  const [maskRevision, setMaskRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
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
    const maskImage = new Image();

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
    return () => {
      cancelled = true;
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
    if (!context || !maskData || hoveredRegionId === null) {
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
  }, [hoveredRegionId, index, maskRevision, plane, resolution]);

  const regionAtPointer = (event: { clientX: number; clientY: number }) => {
    const maskData = maskDataRef.current;
    const image = imageRef.current;
    if (!maskData || !image || image.naturalWidth === 0 || image.naturalHeight === 0) {
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
    const x = Math.floor((event.clientX - renderedLeft) / scale);
    const y = Math.floor((event.clientY - renderedTop) / scale);

    if (x < 0 || y < 0 || x >= maskData.width || y >= maskData.height) {
      return null;
    }

    const maskValue = maskData.pixels[(y * maskData.width + x) * 4];
    return REGION_ID_BY_MASK_VALUE[maskValue] ?? null;
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (!annotationsEnabled) {
      return;
    }
    onHoverRegion(regionAtPointer(event));
  };

  return (
    <>
      <img
        ref={imageRef}
        src={imageSrc ?? sliceUrl(plane, index, resolution)}
        alt={annotationsEnabled
          ? `${SLICE_PLANES[plane].title} ${index} à ${resolution} micromètres de l'atlas Allen avec annotations`
          : `${SLICE_PLANES[plane].title} ${index} de l'image importée`}
        draggable={false}
        decoding="async"
        onClick={(event) => annotationsEnabled && onSelectRegion(regionAtPointer(event))}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => onHoverRegion(null)}
      />
      {(connectivityProjectionSrc || connectivityInjectionSrc) && (
        <ConnectivityOverlay
          injectionSrc={connectivityInjectionSrc}
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
