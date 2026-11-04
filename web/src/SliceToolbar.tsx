import { memo } from "react";

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
  activePlane: SlicePlane;
  connectivityAvailable: boolean;
  connectivityOpacity: number;
  connectivitySettingsOpen: boolean;
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
  onConnectivitySettingsToggle: () => void;
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
  activePlane,
  connectivityAvailable,
  connectivityOpacity,
  connectivitySettingsOpen,
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
  onConnectivitySettingsToggle,
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
  return (
    <div className="slice-toolbar-stack">
      <div className="slice-command-bar" aria-label="Outils de la coupe">
        {connectivityAvailable && (
          <div className="connectivity-settings">
            <button
              type="button"
              className={`connectivity-toggle${connectivityVisible ? " is-active" : ""}`}
              aria-expanded={connectivitySettingsOpen}
              onClick={onConnectivitySettingsToggle}
            >
              <span aria-hidden="true" />
              Connectivité {connectivityState.experimentId}
            </button>
          </div>
        )}
        {viewerSource === "allen" ? (
          <>
            <div className="slice-layer-controls" aria-label="Affichage des annotations Allen">
              <label>
                <input
                  type="checkbox"
                  checked={showAllenRegionColors}
                  onChange={(event) => onShowAllenRegionColorsChange(event.currentTarget.checked)}
                />
                <span className="layer-color is-allen" aria-hidden="true" />
                <span>Régions</span>
              </label>
            </div>
            <div className="resolution-selector" role="group" aria-label="Résolution des coupes">
              {SLICE_RESOLUTIONS.map((resolution) => (
                <button
                  type="button"
                  aria-pressed={sliceResolution === resolution}
                  className={sliceResolution === resolution ? "is-active" : undefined}
                  key={resolution}
                  onClick={() => onResolutionChange(resolution)}
                >
                  {resolution} µm
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="slice-layer-controls" aria-label="Superpositions de la coupe">
            <label>
              <input
                type="checkbox"
                checked={showBrainOnly}
                onChange={(event) => onShowBrainOnlyChange(event.currentTarget.checked)}
              />
              <span className="layer-color is-brain" aria-hidden="true" />
              <span>Cerveau seul</span>
            </label>
            {subjectAnnotationsAvailable && (
              <label>
                <input
                  type="checkbox"
                  checked={showImportedAnnotations}
                  onChange={(event) => onShowImportedAnnotationsChange(event.currentTarget.checked)}
                />
                <span className="layer-color is-allen" aria-hidden="true" />
                <span>Régions</span>
              </label>
            )}
            <label>
              <input
                type="checkbox"
                checked={showImportedMask}
                onChange={(event) => onShowImportedMaskChange(event.currentTarget.checked)}
              />
              <span className="layer-color is-mask" aria-hidden="true" />
              <span>Masque</span>
            </label>
          </div>
        )}
      </div>
      {connectivitySettingsOpen && connectivityAvailable && (
        <div className="connectivity-control-strip">
          <div className="connectivity-control-summary">
            <div className="connectivity-control-heading">
              <strong>
                {connectivityState.metadata?.primaryStructure.acronym ||
                  `Exp. ${connectivityState.experimentId}`}
              </strong>
              <label className="connectivity-master-toggle">
                <input
                  type="checkbox"
                  checked={connectivityVisible}
                  onChange={(event) => onConnectivityVisibleChange(event.currentTarget.checked)}
                />
                <span>Afficher</span>
              </label>
            </div>
            <span>
              {connectivityState.metadata?.primaryStructure.name ||
                "Métadonnées anatomiques en cours de récupération"}
            </span>
            {connectivityState.metadata && (
              <small>
                {connectivityState.metadata.transgenicLine ||
                  connectivityState.metadata.strain ||
                  "Lignée non renseignée"}
                {connectivityState.metadata.sex ? ` · ${connectivityState.metadata.sex}` : ""}
                {connectivityState.metadata.injectionVolumeMm3 !== null
                  ? ` · injection ${connectivityState.metadata.injectionVolumeMm3.toFixed(3)} mm³`
                  : ""}
              </small>
            )}
          </div>
          <div className="connectivity-layers" aria-label="Calques de connectivité">
            <label>
              <input
                type="checkbox"
                checked={projectionVisible}
                onChange={(event) => onProjectionVisibleChange(event.currentTarget.checked)}
              />
              <span className="connectivity-swatch is-projection" aria-hidden="true" />
              Projections
            </label>
            <label>
              <input
                type="checkbox"
                checked={injectionVisible}
                onChange={(event) => onInjectionVisibleChange(event.currentTarget.checked)}
              />
              <span className="connectivity-swatch is-injection" aria-hidden="true" />
              Injection
            </label>
          </div>
          <div className="connectivity-control-ranges">
            <label className="connectivity-range">
              <span>Opacité <output>{Math.round(connectivityOpacity * 100)}%</output></span>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(connectivityOpacity * 100)}
                onChange={(event) => onConnectivityOpacityChange(Number(event.currentTarget.value) / 100)}
              />
            </label>
            <label className="connectivity-range">
              <span>Signal minimal <output>{Math.round(connectivityThreshold * 100)}%</output></span>
              <input
                type="range"
                min="0"
                max="80"
                value={Math.round(connectivityThreshold * 100)}
                onChange={(event) => onConnectivityThresholdChange(Number(event.currentTarget.value) / 100)}
              />
            </label>
          </div>
        </div>
      )}
      {modalityControlsVisible && (
        <div className="modality-control-strip" aria-label="Réglages visuels de la modalité">
          <label className="modality-number-control">
            <span>Min</span>
            <input
              type="number"
              value={Number(modalityMin.toPrecision(6))}
              onChange={(event) => onModalityMinChange(Number(event.currentTarget.value))}
            />
          </label>
          <label className="modality-number-control">
            <span>Max</span>
            <input
              type="number"
              value={Number(modalityMax.toPrecision(6))}
              onChange={(event) => onModalityMaxChange(Number(event.currentTarget.value))}
            />
          </label>
          <label className="modality-palette-control">
            <span>Palette</span>
            <select
              value={modalityPalette}
              onChange={(event) => onModalityPaletteChange(event.currentTarget.value as ModalityPalette)}
            >
              <option value="gray">Gris</option>
              <option value="viridis">Viridis</option>
              <option value="magma">Magma</option>
              <option value="hot">Chaud</option>
            </select>
          </label>
          <label className="modality-invert-toggle">
            <input
              type="checkbox"
              checked={modalityInverted}
              onChange={(event) => onModalityInvertedChange(event.currentTarget.checked)}
            />
            Inverser
          </label>
          <button type="button" className="modality-settings-reset" onClick={onModalitySettingsReset}>
            Réinitialiser
          </button>
        </div>
      )}
      <div className="slice-tabs" role="tablist" aria-label="Orientation de coupe">
        {SLICE_PLANE_ORDER.map((plane) => (
          <button
            type="button"
            role="tab"
            aria-selected={activePlane === plane}
            className={activePlane === plane ? "is-active" : undefined}
            key={plane}
            onClick={() => onPlaneChange(plane)}
          >
            {SLICE_PLANES[plane].label}
          </button>
        ))}
      </div>
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
  return (
    <div className="connectivity-readout" aria-live="polite">
      <div className="connectivity-readout-heading">
        <strong>{pinned ? "Point sélectionné" : "Lecture de la coupe"}</strong>
        {pinned && (
          <button type="button" onClick={onClear}>
            Effacer
          </button>
        )}
      </div>
      {inspection ? (
        <>
          <span className="connectivity-readout-region">
            {region ? `${region.acronym} · ${region.name}` : "Région principale non identifiée"}
          </span>
          <dl>
            <div>
              <dt>Projection</dt>
              <dd>{Math.round(inspection.projection * 100)}%</dd>
            </div>
            <div>
              <dt>Injection</dt>
              <dd>{Math.round(inspection.injection * 100)}%</dd>
            </div>
          </dl>
        </>
      ) : (
        <p>Survolez une zone colorée, puis cliquez pour conserver la lecture.</p>
      )}
    </div>
  );
}

export const ConnectivityReadout = memo(ConnectivityReadoutComponent);
