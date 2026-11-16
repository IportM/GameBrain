import { cloneElement, useEffect, useState, type ComponentProps, type CSSProperties, type ReactElement, type WheelEventHandler } from "react";
import InteractiveSlice from "./InteractiveSlice";
import { useI18n } from "./i18n";
import { subjectSliceUrl } from "./viewerUrls";

export default function RegistrationQC({ children, revision, atlasRevision, onWheel }: {
  children: ReactElement<ComponentProps<typeof InteractiveSlice>>;
  revision: string | null;
  atlasRevision: string | null;
  onWheel: WheelEventHandler<HTMLDivElement>;
}) {
  const { t } = useI18n();
  const [blend, setBlend] = useState(50);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const { plane, index } = children.props;
  const key = `${atlasRevision}:${plane}:${index}:${attempt}`;
  const image = loaded?.key === key ? loaded.url : null;

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setFailure(null);
    const url = `/api/allen-registration/qc/${plane}/${plane}-${String(index).padStart(3, "0")}.webp?v=${encodeURIComponent(atlasRevision ?? "")}`;
    void fetch(url, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("QC unavailable");
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setLoaded({ key, url: objectUrl });
    }).catch(() => {
      if (!controller.signal.aborted) setFailure(key);
    });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [key, plane, index, atlasRevision]);

  return <div className="registration-qc">
    <div className="registration-qc-controls">
      <label htmlFor="registration-blend">{t("Superposition Allen")}</label>
      <output htmlFor="registration-blend">{blend}%</output>
      <input id="registration-blend" type="range" className="viewer-range" min="0" max="100" step="1"
        value={blend} onChange={(event) => setBlend(Number(event.target.value))}
        style={{ "--range-progress": `${blend}%` } as CSSProperties} />
      <div className="registration-qc-limits"><span>RARE</span><span>{t("Allen recalé")}</span></div>
    </div>
    <div className="slice-image-wrap" onWheel={onWheel} aria-busy={!image && failure !== key}>
      {cloneElement(children, {
        key: `qc:${revision}:${plane}:${index}`,
        imageSrc: subjectSliceUrl(plane, index, revision),
        modalityVisible: false, modalitySliceData: null,
        annotationsEnabled: false, annotationsVisible: false,
        annotationOutlineSrc: undefined, maskOutlineSrc: undefined,
        detailedHighlight: null, hoveredRegionId: null,
        connectivityProjectionSrc: undefined, connectivityInjectionSrc: undefined,
        connectivityInspectionEnabled: false,
        onHoverRegion: () => {}, onHoverDetailedRegion: undefined, onInspectRegion: undefined,
        onConnectivityInspect: undefined,
      })}
      {image && <img key={image} src={image} className="registration-qc-overlay" style={{ opacity: blend / 100 }}
        alt={t("Allen recalé")} draggable={false} />}
      {!image && <div className="comparison-status" role="status">
        {t(failure === key ? "Vérification indisponible. Vérifiez que le recalage est terminé." : "Préparation de la vue de vérification…")}
        {failure === key && <button type="button" onClick={() => setAttempt((value) => value + 1)}>{t("Réessayer")}</button>}
      </div>}
    </div>
  </div>;
}
