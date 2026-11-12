import type { DownloadedConnectivityExperiment } from "./data";

export default function ConnectivityLibrary({ experiments, activeId, disabled, error, onSelect }: {
  experiments: DownloadedConnectivityExperiment[];
  activeId: number | null;
  disabled: boolean;
  error: string | null;
  onSelect: (id: number) => void;
}) {
  if (experiments.length === 0 && !error) return null;
  const current = experiments.findIndex((entry) => entry.id === activeId);
  return (
    <div className="connectivity-library">
      <span>Téléchargées ({experiments.length})</span>
      <select
        aria-label="Expériences de connectivité téléchargées"
        value={current < 0 ? "" : String(activeId)}
        disabled={disabled || experiments.length === 0}
        onChange={(event) => onSelect(Number(event.currentTarget.value))}
      >
        {current < 0 && <option value="" disabled>Choisir une expérience</option>}
        {experiments.map((entry) => (
          <option value={entry.id} key={entry.id}>
            #{entry.id}{entry.metadata?.primaryStructure.acronym ? ` · ${entry.metadata.primaryStructure.acronym}` : ""}
            {entry.nativeAvailable ? " · projetée" : ""}
          </option>
        ))}
      </select>
      <button type="button" aria-label="Expérience précédente" title="Expérience précédente"
        disabled={disabled || experiments.length < 2}
        onClick={() => onSelect(experiments[current < 0
          ? experiments.length - 1 : (current - 1 + experiments.length) % experiments.length].id)}>
        ←
      </button>
      <button type="button" aria-label="Expérience suivante" title="Expérience suivante"
        disabled={disabled || experiments.length < 2}
        onClick={() => onSelect(experiments[(current + 1) % experiments.length].id)}>
        →
      </button>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
