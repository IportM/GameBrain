import { Children, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const DEFAULT_SHARE = 0.6;

export default function Workspace({ children, resetRevision }: { children: ReactNode; resetRevision: number }) {
  const panels = Children.toArray(children);
  const element = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1280);
  const [share, setShare] = useState(DEFAULT_SHARE);
  const [resizing, setResizing] = useState(false);
  const available = Math.max(1, width - 8);
  const minimum = Math.min(520, available * 0.55) / available;
  const maximum = 1 - Math.min(420, available * 0.4) / available;
  const clampedShare = Math.max(minimum, Math.min(maximum, share));
  const resize = (next: number) => setShare(Math.max(minimum, Math.min(maximum, next)));

  useEffect(() => {
    setShare(DEFAULT_SHARE);
    setResizing(false);
  }, [resetRevision]);

  useEffect(() => {
    if (!element.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={element} className={`workspace${resizing ? " is-resizing" : ""}`}
      style={{ "--workspace-share": clampedShare } as CSSProperties}>
      {panels[0]}
      <div className="workspace-divider" role="separator" tabIndex={0}
        aria-label="Largeur de la vue 3D" aria-orientation="vertical"
        aria-valuemin={Math.round(minimum * 100)} aria-valuemax={Math.round(maximum * 100)}
        aria-valuenow={Math.round(clampedShare * 100)}
        aria-valuetext={`${Math.round(clampedShare * 100)} % pour la vue 3D`}
        title="Ajuster la largeur des vues. Double-clic pour rétablir."
        onDoubleClick={() => setShare(DEFAULT_SHARE)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            resize(clampedShare + (event.key === "ArrowRight" ? 0.01 : -0.01));
          } else if (event.key === "Home") {
            event.preventDefault();
            setShare(DEFAULT_SHARE);
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          setResizing(true);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId) || !element.current) return;
          resize((event.clientX - element.current.getBoundingClientRect().left - 4) / available);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          setResizing(false);
        }}
        onPointerCancel={() => setResizing(false)}
        onLostPointerCapture={() => setResizing(false)}
      ><span aria-hidden="true" /></div>
      {panels[1]}
    </div>
  );
}
