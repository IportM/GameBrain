import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, CircleAlert, RefreshCw, XCircle } from "lucide-react";
import { useI18n } from "./i18n";
import type { EnvironmentReport } from "./environmentTypes";

export function EnvironmentStatus({ report, error, onRetry }: {
  report: EnvironmentReport | null; error: string | null; onRetry: () => void;
}) {
  const { t, language, setLanguage } = useI18n();
  const busy = !error && (!report || report.status === "checking");
  const selected = report?.selected;
  return <main className="environment-screen">
    <section className="environment-dialog" aria-labelledby="environment-title" aria-busy={busy}>
      <header>
        <h1 id="environment-title">{t(busy ? "Vérification de l'installation" : "Installation à compléter")}</h1>
        <div className="environment-language" role="group" aria-label={t("Langue de l'interface")}>
          <button type="button" aria-pressed={language === "fr"} onClick={() => setLanguage("fr")}>FR</button>
          <button type="button" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>EN</button>
        </div>
      </header>
      <div className="environment-body">
        {busy ? <p role="status">{t("Recherche des Python disponibles et vérification des bibliothèques…")}</p>
          : <p role="alert"><CircleAlert size={18} aria-hidden="true" /> {t(error ?? "Les calculs nécessitent un Python compatible avec toutes les bibliothèques requises.")}</p>}
        {selected ? <dl className="environment-python">
          <div><dt>Python</dt><dd>{selected.python}</dd></div>
          <div><dt>{t("Version")}</dt><dd>{selected.version}{!selected.compatible && ` · ${t("Python 3.12 en 64 bits requis")}`}</dd></div>
        </dl> : !busy && !error && <p>{t("Aucun Python utilisable détecté.")}</p>}
        {!busy && selected && <table className="environment-checks">
          <thead><tr><th>{t("Bibliothèque")}</th><th>{t("État")}</th></tr></thead>
          <tbody>{selected.checks.map((check) => <tr key={check.module}>
            <td>{check.package}{check.module !== check.package && <small>import {check.module}</small>}</td>
            <td className={check.status === "available" ? "is-available" : "is-missing"}>
              {check.status === "available" ? <CheckCircle2 size={14} aria-hidden="true" /> : <XCircle size={14} aria-hidden="true" />}
              {t(check.status === "available" ? "Détectée" : check.status === "missing" ? "Manquante" : "Erreur de chargement")}
              {check.error && <small>{check.error}</small>}
            </td>
          </tr>)}</tbody>
        </table>}
        {!busy && selected && selected.resourcesMissing.length > 0 && <div className="environment-resources">
          <strong>{t("Ressources du projet manquantes")}</strong>
          <ul>{selected.resourcesMissing.map((name) => <li key={name}>{name}</li>)}</ul>
        </div>}
        {!busy && <div className="environment-help">
          <p>{t("Depuis le dossier web, installez les dépendances puis relancez la vérification :")}</p>
          <code>pnpm run setup</code>
          <details><summary>{t("Utiliser un autre Python")}</summary>
            <p>{t("Définissez GAMEBRAIN_PYTHON avec le chemin de son exécutable, puis redémarrez le site. Aucune installation existante n'est modifiée automatiquement.")}</p>
            <p>{t("La recherche couvre .venv-registration, les environnements virtuels ou Conda actifs et les Python du PATH. Elle ne parcourt pas tout le disque.")}</p>
            <p>{t("ANTs en ligne de commande ne remplace pas la bibliothèque Python antspyx.")}</p>
            {report?.explicit && <p>{t("GAMEBRAIN_PYTHON est défini : ce choix reste prioritaire, même si cet environnement est incomplet.")}</p>}
          </details>
          {report && (report.candidates.length > 0 || report.error) && <details><summary>{t("Diagnostic technique")}</summary>
            {report.candidates.map((candidate, index) => <p key={index}><code>{candidate.python}</code>{candidate.version && ` · ${candidate.version}`}<small>{candidate.error ?? (candidate.compatible ? "" : t("Version Python incompatible"))}</small></p>)}
            {report.error && <pre>{report.error}</pre>}
            <p><code>pnpm run doctor</code></p>
          </details>}
        </div>}
      </div>
      {!busy && <footer><button type="button" onClick={onRetry}><RefreshCw size={15} aria-hidden="true" />{t("Revérifier l'installation")}</button></footer>}
    </section>
  </main>;
}

export default function EnvironmentGate({ children }: { children: ReactNode }) {
  const [report, setReport] = useState<EnvironmentReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const response = await fetch("/api/environment", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const next = await response.json() as EnvironmentReport;
        if (!["checking", "ready", "blocked"].includes(next.status)) throw new Error();
        if (controller.signal.aborted) return;
        setReport(next); setError(null);
        if (next.status === "checking") timer = setTimeout(read, 1000);
      } catch {
        if (!controller.signal.aborted) setError("Vérification indisponible. Vérifiez que le serveur local est démarré.");
      }
    };
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [revision]);
  const retry = async () => {
    setError(null);
    setReport(null);
    try {
      const response = await fetch("/api/environment/recheck", { method: "POST" });
      if (!response.ok) throw new Error();
      setRevision((value) => value + 1);
    } catch { setError("Vérification indisponible. Vérifiez que le serveur local est démarré."); }
  };
  if (report?.status === "ready") return children;
  return <EnvironmentStatus report={report} error={error} onRetry={() => void retry()} />;
}
