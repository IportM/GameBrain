import { useI18n } from "./i18n";
import type { DownloadedConnectivityExperiment } from "./data";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function ConnectivityLibrary({ experiments, activeId, disabled, error, onSelect }: {
  experiments: DownloadedConnectivityExperiment[];
  activeId: number | null;
  disabled: boolean;
  error: string | null;
  onSelect: (id: number) => void;
}) {
  const { t } = useI18n();
  if (experiments.length === 0 && !error) return activeId
    ? <strong className="connectivity-library-empty">{t("Expérience")} {activeId}</strong>
    : null;
  const current = experiments.findIndex((entry) => entry.id === activeId);
  return (
    <div className="connectivity-library" title={t(`${experiments.length} expérience(s) téléchargée(s)`)}>
      <select
        aria-label={t("Expériences de connectivité téléchargées")}
        value={current < 0 ? "" : String(activeId)}
        disabled={disabled || experiments.length === 0}
        onChange={(event) => onSelect(Number(event.currentTarget.value))}
      >
        {current < 0 && <option value="" disabled>{t("Choisir une expérience")}</option>}
        {experiments.map((entry) => (
          <option value={entry.id} key={entry.id}>
            #{entry.id}{entry.metadata?.primaryStructure.acronym ? ` · ${entry.metadata.primaryStructure.acronym}` : ""}
            {entry.nativeAvailable ? t(" · projetée") : ""}
          </option>
        ))}
      </select>
      <button type="button" aria-label={t("Expérience précédente")} title={t("Expérience précédente")}
        disabled={disabled || experiments.length < 2}
        onClick={() => onSelect(experiments[current < 0
          ? experiments.length - 1 : (current - 1 + experiments.length) % experiments.length].id)}>
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <button type="button" aria-label={t("Expérience suivante")} title={t("Expérience suivante")}
        disabled={disabled || experiments.length < 2}
        onClick={() => onSelect(experiments[(current + 1) % experiments.length].id)}>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
      {error && <small role="alert">{t(error)}</small>}
    </div>
  );
}
