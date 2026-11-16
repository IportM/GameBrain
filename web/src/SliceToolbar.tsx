import { useI18n } from "./i18n";
import { memo, type CSSProperties, type ReactNode } from "react";
import { Check, MapPin } from "lucide-react";

import type { ConnectivityInspection } from "./InteractiveSlice";
import {
  SLICE_PLANES,
  SLICE_PLANE_ORDER,
  SLICE_RESOLUTIONS,
  type RegionDefinition,
  type SlicePlane,
  type SliceResolution,
} from "./atlas";
import type { ConnectivityState } from "./data";
import type { ModalityPalette } from "./modalityVolume";

type SliceToolbarProps = {
  inspectionMode?: boolean;
  onExploreExperiments: () => void;
  onReturnToExperiment: () => void;
  library?: ReactNode;
  activePlane: SlicePlane;
  connectivityAvailable: boolean;
  connectivityControlsVisible: boolean;
  connectivityOpacity: number;
  connectivityState: ConnectivityState;
  connectivityThreshold: number;
  connectivityVisible: boolean;
  injectionVisible: boolean;
  modalityControlsVisible: boolean;
  modalityInverted: boolean;
  modalityMax: number;
  modalityMin: number;
  modalityPalette: ModalityPalette;
  projectionVisible: boolean;
  showAllenRegionColors: boolean;
  showBrainOnly: boolean;
  showImportedAnnotations: boolean;
  showImportedMask: boolean;
  sliceResolution: SliceResolution;
  subjectAnnotationsAvailable: boolean;
  viewerSource: "allen" | "subject";
  onConnectivityOpacityChange: (value: number) => void;
  onConnectivityThresholdChange: (value: number) => void;
  onConnectivityVisibleChange: (visible: boolean) => void;
  onInjectionVisibleChange: (visible: boolean) => void;
  onModalityInvertedChange: (value: boolean) => void;
  onModalityMaxChange: (value: number) => void;
  onModalityMinChange: (value: number) => void;
  onModalityPaletteChange: (value: ModalityPalette) => void;
  onModalitySettingsReset: () => void;
  onPlaneChange: (plane: SlicePlane) => void;
  onProjectionVisibleChange: (visible: boolean) => void;
  onResolutionChange: (resolution: SliceResolution) => void;
  onShowAllenRegionColorsChange: (visible: boolean) => void;
  onShowBrainOnlyChange: (visible: boolean) => void;
  onShowImportedAnnotationsChange: (visible: boolean) => void;
  onShowImportedMaskChange: (visible: boolean) => void;
};

function SliceToolbarComponent({
  inspectionMode = false,
  onExploreExperiments,
  onReturnToExperiment,
  library,
  activePlane,
  connectivityAvailable,
  connectivityControlsVisible,
  connectivityOpacity,
  connectivityState,
  connectivityThreshold,
  connectivityVisible,
  injectionVisible,
  modalityControlsVisible,
  modalityInverted,
  modalityMax,
  modalityMin,
  modalityPalette,
  projectionVisible,
  showAllenRegionColors,
  showBrainOnly,
  showImportedAnnotations,
  showImportedMask,
  sliceResolution,
  subjectAnnotationsAvailable,
  viewerSource,
  onConnectivityOpacityChange,
  onConnectivityThresholdChange,
  onConnectivityVisibleChange,
  onInjectionVisibleChange,
  onModalityInvertedChange,
  onModalityMaxChange,
  onModalityMinChange,
  onModalityPaletteChange,
  onModalitySettingsReset,
  onPlaneChange,
  onProjectionVisibleChange,
  onResolutionChange,
  onShowAllenRegionColorsChange,
  onShowBrainOnlyChange,
  onShowImportedAnnotationsChange,
  onShowImportedMaskChange,
}: SliceToolbarProps) {
  const { t } = useI18n();
  const orientationTabs = <div className="slice-tabs" role="tablist" aria-label={t("Orientation de coupe")}>
    {SLICE_PLANE_ORDER.map((plane) => (
      <button type="button" role="tab" aria-selected={activePlane === plane}
        className={activePlane === plane ? "is-active" : undefined} key={plane}
        onClick={() => onPlaneChange(plane)}>{t(SLICE_PLANES[plane].label)}</button>
    ))}
  </div>;
  if (inspectionMode) return <div className="slice-toolbar-stack">{orientationTabs}</div>;
  return (
    <div className="slice-toolbar-stack">
      {viewerSource === "allen" && !connectivityControlsVisible && (
        <div className="connectivity-explorer-return">
          <span>{t("Points d'injection")}</span>
          {connectivityAvailable && <button type="button" onClick={onReturnToExperiment}>{t("Revenir à la carte")}</button>}
        </div>
      )}
      {(!connectivityAvailable || !connectivityControlsVisible) && library}
      <div className="slice-command-bar" aria-label={t("Outils de la coupe")}>
        {viewerSource === "allen" ? (
          <>
            <div className="slice-layer-controls" aria-label={t("Affichage des annotations Allen")}>
              <label>
                <input
                  type="checkbox"
                  checked={showAllenRegionColors}
                  onChange={(event) => onShowAllenRegionColorsChange(event.currentTarget.checked)}
                />
                <span className="layer-color is-allen" aria-hidden="true" />
                <span>{t("Régions")}</span>
              </label>
            </div>
            <div className="resolution-selector" role="group" aria-label={t("Résolution des coupes")}>
              {SLICE_RESOLUTIONS.map((resolution) => (
                <button
                  type="button"
                  aria-pressed={sliceResolution === resolution}
                  className={sliceResolution === resolution ? "is-active" : undefined}
                  key={resolution}
                  onClick={() => onResolutionChange(resolution)}
                >
                  {resolution} {t("µm")}</button>
              ))}
            </div>
          </>
        ) : (
          <div className="slice-layer-controls" aria-label={t("Superpositions de la coupe")}>
            <label>
              <input
                type="checkbox"
                checked={showBrainOnly}
                onChange={(event) => onShowBrainOnlyChange(event.currentTarget.checked)}
              />
              <span className="layer-color is-brain" aria-hidden="true" />
              <span>{t("Cerveau seul")}</span>
            </label>
            {subjectAnnotationsAvailable && (
              <label>
                <input
                  type="checkbox"
                  checked={showImportedAnnotations}
                  onChange={(event) => onShowImportedAnnotationsChange(event.currentTarget.checked)}
                />
                <span className="layer-color is-allen" aria-hidden="true" />
                <span>{t("Régions")}</span>
              </label>
            )}
            <label>
              <input
                type="checkbox"
                checked={showImportedMask}
                onChange={(event) => onShowImportedMaskChange(event.currentTarget.checked)}
              />
              <span className="layer-color is-mask" aria-hidden="true" />
              <span>{t("Masque")}</span>
            </label>
          </div>
        )}
      </div>
      {connectivityAvailable && connectivityControlsVisible && (
        <section className="connectivity-session" aria-label={t("Expérience de connectivité active")}>
          <div className="connectivity-session-header">
            <div className="connectivity-session-experiment">
              {library || <strong>{t("Expérience")} {connectivityState.experimentId}</strong>}
            </div>
            {viewerSource === "allen" && <button type="button" className="tool-icon-button"
              title={t("Explorer les points d'injection")} aria-label={t("Explorer les points d'injection")}
              onClick={onExploreExperiments}><MapPin size={16} aria-hidden="true" /></button>}
            <label className="connectivity-master-toggle">
              <span className="connectivity-check">
                <input
                  type="checkbox"
                  checked={connectivityVisible}
                  onChange={(event) => onConnectivityVisibleChange(event.currentTarget.checked)}
                />
                <Check size={12} className="connectivity-check-mark" aria-hidden="true" />
              </span>
              <span>{t("Afficher la carte")}</span>
            </label>
          </div>
          {connectivityState.metadata && (
            <details className="connectivity-experiment-details">
              <summary>{connectivityState.metadata.primaryStructure.name || t("Informations sur l'expérience")}</summary>
              <dl>
                <div><dt>{t("Identifiant")}</dt><dd>{connectivityState.experimentId}</dd></div>
                <div><dt>{t("Lignée")}</dt><dd>{connectivityState.metadata.transgenicLine || connectivityState.metadata.strain || t("Non renseignée")}</dd></div>
                <div><dt>{t("Sexe")}</dt><dd>{connectivityState.metadata.sex || t("Non renseigné")}</dd></div>
                <div><dt>{t("Injection")}</dt><dd>{connectivityState.metadata.injectionVolumeMm3 !== null ? t(`${connectivityState.metadata.injectionVolumeMm3.toFixed(3)} mm³`) : t("Non renseignée")}</dd></div>
              </dl>
            </details>
          )}
          <div className="connectivity-control-strip">
          <div className="connectivity-layers" aria-label={t("Calques de connectivité")}>
            <label>
              <span className="connectivity-check">
                <input
                  type="checkbox"
                  checked={projectionVisible}
                  onChange={(event) => onProjectionVisibleChange(event.currentTarget.checked)}
                />
                <Check size={12} className="connectivity-check-mark" aria-hidden="true" />
              </span>
              <span className="connectivity-swatch is-projection" aria-hidden="true" />{t("Projections")}</label>
            <label>
              <span className="connectivity-check">
                <input
                  type="checkbox"
                  checked={injectionVisible}
                  onChange={(event) => onInjectionVisibleChange(event.currentTarget.checked)}
                />
                <Check size={12} className="connectivity-check-mark" aria-hidden="true" />
              </span>
              <span className="connectivity-swatch is-injection" aria-hidden="true" />{t("Injection")}</label>
          </div>
          <div className="connectivity-control-ranges">
            <label className="connectivity-range">
              <span>{t("Opacité")} <output>{Math.round(connectivityOpacity * 100)}%</output></span>
              <input
                type="range"
                className="viewer-range"
                aria-label={t("Opacité de la connectivité")}
                aria-valuetext={`${Math.round(connectivityOpacity * 100)} %`}
                style={{ "--range-progress": `${Math.round(connectivityOpacity * 100)}%` } as CSSProperties}
                min="0"
                max="100"
                value={Math.round(connectivityOpacity * 100)}
                onChange={(event) => onConnectivityOpacityChange(Number(event.currentTarget.value) / 100)}
              />
              <span className="connectivity-range-limits" aria-hidden="true"><span>0 %</span><span>100 %</span></span>
            </label>
            <label className="connectivity-range">
              <span>{t("Seuil du signal")} <output>{Math.round(connectivityThreshold * 100)}%</output></span>
              <input
                type="range"
                className="viewer-range"
                aria-label={t("Seuil du signal de connectivité")}
                aria-valuetext={`${Math.round(connectivityThreshold * 100)} %`}
                style={{ "--range-progress": `${connectivityThreshold / 0.8 * 100}%` } as CSSProperties}
                min="0"
                max="80"
                value={Math.round(connectivityThreshold * 100)}
                onChange={(event) => onConnectivityThresholdChange(Number(event.currentTarget.value) / 100)}
              />
              <span className="connectivity-range-limits" aria-hidden="true"><span>0 %</span><span>80 %</span></span>
            </label>
          </div>
          </div>
        </section>
      )}
      {modalityControlsVisible && (
        <div className="modality-control-strip" aria-label={t("Réglages visuels de la modalité")}>
          <label className="modality-number-control">
            <span>{t("Min")}</span>
            <input
              type="number"
              value={Number(modalityMin.toPrecision(6))}
              onChange={(event) => onModalityMinChange(Number(event.currentTarget.value))}
            />
          </label>
          <label className="modality-number-control">
            <span>{t("Max")}</span>
            <input
              type="number"
              value={Number(modalityMax.toPrecision(6))}
              onChange={(event) => onModalityMaxChange(Number(event.currentTarget.value))}
            />
          </label>
          <label className="modality-palette-control">
            <span>{t("Palette")}</span>
            <select
              value={modalityPalette}
              onChange={(event) => onModalityPaletteChange(event.currentTarget.value as ModalityPalette)}
            >
              <option value="gray">{t("Gris")}</option>
              <option value="viridis">{t("Viridis")}</option>
              <option value="magma">{t("Magma")}</option>
              <option value="hot">{t("Chaud")}</option>
            </select>
          </label>
          <label className="modality-invert-toggle">
            <input
              type="checkbox"
              checked={modalityInverted}
              onChange={(event) => onModalityInvertedChange(event.currentTarget.checked)}
            />{t("Inverser")}</label>
          <button type="button" className="modality-settings-reset" onClick={onModalitySettingsReset}>{t("Réinitialiser")}</button>
        </div>
      )}
      {orientationTabs}
    </div>
  );
}

export const SliceToolbar = memo(SliceToolbarComponent);

type ConnectivityReadoutProps = {
  inspection: ConnectivityInspection | null;
  pinned: boolean;
  region: RegionDefinition | null;
  onClear: () => void;
};

function ConnectivityReadoutComponent({
  inspection,
  pinned,
  region,
  onClear,
}: ConnectivityReadoutProps) {
  const { t } = useI18n();
  return (
    <div className="connectivity-readout" aria-live="polite">
      <div className="connectivity-readout-heading">
        <strong>{pinned ? t("Point sélectionné") : t("Lecture de la coupe")}</strong>
        {pinned && (
          <button type="button" onClick={onClear}>{t("Effacer")}</button>
        )}
      </div>
      {inspection ? (
        <>
          <span className="connectivity-readout-region">
            {region ? `${region.acronym} · ${region.name}` : t("Région principale non identifiée")}
          </span>
          <dl>
            <div>
              <dt>{t("Projection")}</dt>
              <dd>{Math.round(inspection.projection * 100)}%</dd>
            </div>
            <div>
              <dt>{t("Injection")}</dt>
              <dd>{Math.round(inspection.injection * 100)}%</dd>
            </div>
          </dl>
        </>
      ) : (
        <p>{t("Survolez une zone colorée, puis cliquez pour conserver la lecture.")}</p>
      )}
    </div>
  );
}

export const ConnectivityReadout = memo(ConnectivityReadoutComponent);
