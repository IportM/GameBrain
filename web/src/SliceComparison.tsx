import { cloneElement, useEffect, useState, type ComponentProps, type ReactElement, type WheelEventHandler } from "react";
import { RotateCcw } from "lucide-react";
import InteractiveSlice from "./InteractiveSlice";
import RegistrationQC from "./RegistrationQC";
import type { ModalityRecord } from "./data";
import { useI18n } from "./i18n";
import { loadModalitySlice, type ModalityPalette, type ModalitySlice } from "./modalityVolume";
import { modalitySliceUrl, subjectSlice3DUrl, subjectSliceUrl } from "./viewerUrls";

type SliceElement = ReactElement<ComponentProps<typeof InteractiveSlice>>;
type Settings = { min: number; max: number; palette: ModalityPalette; inverted: boolean };

function ComparisonPane({ children, modalities, initialId, revision }: {
  children: SliceElement;
  modalities: ModalityRecord[];
  initialId: string | null;
  revision: string | null;
}) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState(initialId);
  const [settings, setSettings] = useState<Record<string, Settings>>({});
  const [loaded, setLoaded] = useState<{ key: string; data: ModalitySlice } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const modality = modalities.find((entry) => entry.id === selectedId) ?? null;
  const { plane, index, modalityBrainOnly } = children.props;
  const key = modality ? `${modality.id}:${plane}:${index}` : null;
  const current = modality ? settings[modality.id] ?? {
    min: modality.percentiles[0], max: modality.percentiles[1], palette: "gray", inverted: false,
  } : null;
  const data = loaded?.key === key ? loaded.data : null;

  useEffect(() => {
    if (!modality || !key) return;
    let cancelled = false;
    setFailure(null);
    void loadModalitySlice(modality.id, plane, index).then((data) => {
      if (!cancelled) setLoaded({ key, data });
    }).catch(() => {
      if (!cancelled) setFailure(key);
    });
    return () => { cancelled = true; };
  }, [modality?.id, key, plane, index, attempt]);

  function update(patch: Partial<Settings>) {
    if (modality && current) setSettings((previous) => ({
      ...previous, [modality.id]: { ...current, ...patch },
    }));
  }

  const loading = modality !== null && data === null;
  return (
    <section className="comparison-pane" aria-label={modality?.name ?? "RARE"}>
      <div className="comparison-pane-controls">
        <label className="comparison-volume">
          <span>{t("Volume")}</span>
          <select value={modality?.id ?? "rare"} onChange={(event) => setSelectedId(event.target.value === "rare" ? null : event.target.value)}>
            <option value="rare">RARE</option>
            {modalities.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </label>
        {modality && current ? <>
          <div className="comparison-window">
            <label>Min<input type="number" step="any" value={current.min} onChange={(event) => {
              const value = event.currentTarget.valueAsNumber;
              if (Number.isFinite(value) && value < current.max) update({ min: value });
            }} /></label>
            <label>Max<input type="number" step="any" value={current.max} onChange={(event) => {
              const value = event.currentTarget.valueAsNumber;
              if (Number.isFinite(value) && value > current.min) update({ max: value });
            }} /></label>
            <button type="button" title={t("Réinitialiser")} aria-label={t("Réinitialiser")} onClick={() => update({ min: modality.percentiles[0], max: modality.percentiles[1], palette: "gray", inverted: false })}><RotateCcw size={14} /></button>
          </div>
          <div className="comparison-palette">
            <select aria-label={t("Palette")} value={current.palette} onChange={(event) => update({ palette: event.target.value as ModalityPalette })}>
              {["gray", "viridis", "magma", "hot"].map((palette) => <option key={palette} value={palette}>{palette}</option>)}
            </select>
            <label><input type="checkbox" checked={current.inverted} onChange={(event) => update({ inverted: event.target.checked })} />{t("Inverser")}</label>
          </div>
        </> : <span className="comparison-reference">{t("Image de référence")}</span>}
      </div>
      <div className="slice-image-wrap" aria-busy={loading}>
        {!loading && cloneElement(children, {
          // Remount on slice changes so a previous image cannot masquerade as the current slice.
          key: `${modality?.id ?? "rare"}:${plane}:${index}`,
          imageSrc: modality ? modalitySliceUrl(modality.id, plane, index, modalityBrainOnly)
            : modalityBrainOnly ? subjectSlice3DUrl(plane, index, revision) : subjectSliceUrl(plane, index, revision),
          modalitySliceData: data,
          modalityVisible: data !== null,
          modalityWindow: current ? [current.min, current.max] : undefined,
          modalityPalette: current?.palette ?? "gray",
          modalityInverted: current?.inverted ?? false,
        })}
        {loading && <div className="comparison-status" role="status">
          {t(failure === key ? "Impossible de charger la coupe" : "Chargement de la coupe…")}
          {failure === key && <button type="button" onClick={() => setAttempt((value) => value + 1)}>{t("Réessayer")}</button>}
        </div>}
      </div>
    </section>
  );
}

export default function SliceComparison({ enabled, children, modalities, activeId, revision, className, onWheel, qcEnabled = false, qcRevision = null }: {
  enabled: boolean;
  children: SliceElement;
  modalities: ModalityRecord[];
  activeId: string | null;
  revision: string | null;
  className: string;
  onWheel: WheelEventHandler<HTMLDivElement>;
  qcEnabled?: boolean;
  qcRevision?: string | null;
}) {
  if (qcEnabled) return <RegistrationQC revision={revision} atlasRevision={qcRevision} onWheel={onWheel}>{children}</RegistrationQC>;
  if (!enabled) return <div className={className} onWheel={onWheel}>{children}</div>;
  return <div className="slice-comparison" onWheel={onWheel}>
    <ComparisonPane key={`left:${revision}`} modalities={modalities} initialId={null} revision={revision}>{children}</ComparisonPane>
    <ComparisonPane key={`right:${revision}:${activeId}`} modalities={modalities} initialId={activeId ?? modalities[0]?.id ?? null} revision={revision}>{children}</ComparisonPane>
  </div>;
}
