import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type WheelEventHandler } from "react";
import { Minus, Plus } from "lucide-react";
import { useI18n } from "./i18n";
import { loadConnectivityPixels } from "./connectivitySliceCache";
import { brainBounds, frameBrain, type BrainBounds } from "./sliceFraming";
import type { ModalitySlice } from "./modalityVolume";

export function stepSliceZoom(current: number, direction: -1 | 1) {
  return Math.max(100, Math.min(300, current + direction * 25));
}

export default function SliceViewport({ children, zoomEnabled = false, className = "slice-image-wrap", onWheel, busy, brainMaskSrc, brainMaskData }: {
  children: ReactNode;
  zoomEnabled?: boolean;
  className?: string;
  onWheel?: WheelEventHandler<HTMLDivElement>;
  busy?: boolean;
  brainMaskSrc?: string;
  brainMaskData?: ModalitySlice | null;
}) {
  const { t } = useI18n();
  const [zoom, setZoom] = useState(100);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [bounds, setBounds] = useState<BrainBounds | null>(null);
  useEffect(() => {
    if (!zoomEnabled || !ref.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width - 36, height: entry.contentRect.height - 36 }));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [zoomEnabled]);
  useEffect(() => {
    if (!zoomEnabled || zoom === 100) return;
    if (brainMaskData) {
      setBounds((previous) => brainBounds(brainMaskData.mask, brainMaskData.width, brainMaskData.height) ?? previous);
      return;
    }
    if (!brainMaskSrc) return;
    const controller = new AbortController();
    void loadConnectivityPixels(brainMaskSrc, controller.signal).then(({ pixels, width, height }) => {
      if (!controller.signal.aborted) setBounds((previous) => brainBounds(pixels, width, height, 4, 3) ?? previous);
    }).catch(() => {
      // Keep the last framing while the next mask is unavailable or empty.
    });
    return () => controller.abort();
  }, [brainMaskSrc, brainMaskData, zoomEnabled, zoom > 100]);
  const frame = zoom > 100 && bounds && size.width > 0 && size.height > 0
    ? frameBrain(bounds, size.width, size.height, zoom / 100) : null;
  const effectiveZoom = zoom === 100 ? 1 : frame?.zoom ?? (brainMaskSrc || brainMaskData ? 1 : zoom / 100);
  const atLimit = zoom === 300 || (frame !== null && zoom / 100 >= frame.limit);
  return <div ref={ref} className={`${className}${zoomEnabled ? " is-zoomable" : ""}`} onWheel={onWheel} aria-busy={busy}
    style={zoomEnabled ? { "--slice-zoom": effectiveZoom, "--slice-pan-x": `${frame?.x ?? 0}px`, "--slice-pan-y": `${frame?.y ?? 0}px` } as CSSProperties : undefined}>
    {children}
    {zoomEnabled && <div className="slice-zoom-controls" role="group" aria-label={t("Zoom de la coupe")}
      onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <button type="button" title={t("Dézoomer")} aria-label={t("Dézoomer")} disabled={zoom === 100}
        onClick={() => setZoom((value) => stepSliceZoom(value, -1))}><Minus size={16} aria-hidden="true" /></button>
      <output aria-live="polite">{Math.round(effectiveZoom * 100)}%</output>
      <button type="button" title={t("Zoomer")} aria-label={t("Zoomer")} disabled={atLimit}
        onClick={() => setZoom((value) => stepSliceZoom(value, 1))}><Plus size={16} aria-hidden="true" /></button>
    </div>}
  </div>;
}
