import { useEffect, useRef } from "react";

function shortRegionName(name: string) {
  const short = name
    .replace(/Primary somatosensory area, barrel field/i, "Barrel cortex")
    .replace(/Primary somatosensory area/i, "Primary sensory cortex")
    .replace(/Supplemental somatosensory area/i, "Secondary sensory cortex")
    .replace(/Primary visual area/i, "Primary visual cortex")
    .replace(/Primary motor area/i, "Primary motor cortex")
    .replace(/Secondary motor area/i, "Secondary motor cortex")
    .replace(/Somatomotor areas/i, "Motor cortex")
    .replace(/Somatosensory areas/i, "Somatosensory cortex")
    .replace(/Hippocampal formation/i, "Hippocampal region")
    .replace(/Basic cell groups and regions/i, "Brain regions")
    .replace(/, (dorsal|ventral|lateral|medial|anterior|posterior) part/gi, ", $1")
    .replace(/, layer /gi, " / layer ")
    .replace(/, /g, " / ");
  return short.charAt(0).toUpperCase() + short.slice(1);
}

export default function RegionTooltip({
  name,
  acronym,
}: {
  name: string | null;
  acronym?: string;
}) {
  const tooltip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const element = tooltip.current;
      if (!element) return;
      if (event.buttons !== 0) {
        element.style.visibility = "hidden";
        return;
      }
      const bounds = element.getBoundingClientRect();
      const left = Math.max(8, Math.min(event.clientX + 14, window.innerWidth - bounds.width - 8));
      const top = event.clientY + 18 + bounds.height < window.innerHeight - 8
        ? event.clientY + 18
        : Math.max(8, event.clientY - bounds.height - 10);
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
      element.style.visibility = "visible";
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, []);

  return (
    <div ref={tooltip} className="region-hover-tooltip" role="tooltip" hidden={!name}>
      {name && shortRegionName(name)}
      {acronym && <span className="region-hover-tooltip-acronym">{acronym}</span>}
    </div>
  );
}
