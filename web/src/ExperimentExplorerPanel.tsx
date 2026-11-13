import { useI18n } from "./i18n";
import type { ConnectivitySearchResult } from "./data";
import { X } from "lucide-react";

export default function ExperimentExplorerPanel({
  count, total, loading, error, filtered, regionName, selected, busy,
  onFilter, onClose, onRetry, onLoad,
}: {
  count: number;
  total: number;
  loading: boolean;
  error: string | null;
  filtered: boolean;
  regionName: string | null;
  selected: ConnectivitySearchResult | null;
  busy: boolean;
  onFilter: (filtered: boolean) => void;
  onClose: () => void;
  onRetry: () => void;
  onLoad: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="experiment-explorer-panel" aria-label={t("Explorateur des expériences Allen")}>
      <div className="experiment-explorer-toolbar">
        <strong>{t("Points d'injection")}</strong>
        <span className="experiment-explorer-count" role="status">
          {loading ? t("Chargement…") : `${count} / ${total}`}
        </span>
        <div className="experiment-explorer-filter" role="group" aria-label={t("Filtre des expériences")}>
          <button type="button" aria-pressed={!filtered} onClick={() => onFilter(false)}>{t("Toutes")}</button>
          <button type="button" aria-pressed={filtered} disabled={!regionName}
            title={regionName ?? t("Aucune région sélectionnée")} onClick={() => onFilter(true)}>{t("Région sélectionnée")}</button>
        </div>
        <button type="button" className="experiment-explorer-close" aria-label={t("Fermer l'explorateur")}
          title={t("Fermer l'explorateur")} onClick={onClose}><X size={16} aria-hidden="true" /></button>
      </div>
      {filtered && <p className="experiment-explorer-region">{regionName ?? t("Aucune région sélectionnée")}</p>}
      {error && <div className="experiment-explorer-error" role="alert">
        <span>{t(error)}</span><button type="button" onClick={onRetry}>{t("Réessayer")}</button>
      </div>}
      {!loading && !error && count === 0 && <p>{t("Aucune expérience dans cette région.")}</p>}
      {selected && (
        <div className="experiment-explorer-selection">
          <div>
            <strong>{t("Expérience #")}{selected.id}</strong>
            <span>{selected.primaryStructure.name || selected.primaryStructure.acronym || t("Région non renseignée")}</span>
            <small>{selected.transgenicLine || selected.strain || t("Lignée non renseignée")}</small>
          </div>
          <button type="button" disabled={busy} onClick={onLoad}>
            {busy ? t("Traitement en cours") : t("Charger la carte")}
          </button>
        </div>
      )}
    </section>
  );
}
