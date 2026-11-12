import type { ConnectivitySearchResult } from "./data";

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
  return (
    <section className="experiment-explorer-panel" aria-label="Explorateur des expériences Allen">
      <div className="experiment-explorer-toolbar">
        <strong>Expériences Allen</strong>
        <span className="experiment-explorer-count" role="status">
          {loading ? "Chargement…" : `${count} / ${total}`}
        </span>
        <div className="experiment-explorer-filter" role="group" aria-label="Filtre des expériences">
          <button type="button" aria-pressed={!filtered} onClick={() => onFilter(false)}>Toutes</button>
          <button type="button" aria-pressed={filtered} disabled={!regionName}
            title={regionName ?? "Aucune région sélectionnée"} onClick={() => onFilter(true)}>
            Région sélectionnée
          </button>
        </div>
        <button type="button" className="experiment-explorer-close" aria-label="Fermer l'explorateur"
          title="Fermer l'explorateur" onClick={onClose}>×</button>
      </div>
      {filtered && <p className="experiment-explorer-region">{regionName ?? "Aucune région sélectionnée"}</p>}
      {error && <div className="experiment-explorer-error" role="alert">
        <span>{error}</span><button type="button" onClick={onRetry}>Réessayer</button>
      </div>}
      {!loading && !error && count === 0 && <p>Aucune expérience dans cette région.</p>}
      {selected && (
        <div className="experiment-explorer-selection">
          <div>
            <strong>Expérience #{selected.id}</strong>
            <span>{selected.primaryStructure.name || selected.primaryStructure.acronym || "Région non renseignée"}</span>
            <small>{selected.transgenicLine || selected.strain || "Lignée non renseignée"}</small>
          </div>
          <button type="button" disabled={busy} onClick={onLoad}>
            {busy ? "Traitement en cours" : "Charger la carte"}
          </button>
        </div>
      )}
    </section>
  );
}
