import { AlertCircle, CheckCircle2, Circle, LoaderCircle } from "lucide-react";

export type ImageTask = "image" | "atlas" | "modalities" | "connectivity";
type TaskStatus = "idle" | "uploading" | "running" | "completed" | "failed";

export function ImageWorkflow({ active, hasImage, hasRegions, hasExperiment = false, modalityCount, nativeConnectivity,
  importStatus, atlasStatus, modalityStatus, nativeStatus, busy, onNavigate,
}: {
  active: ImageTask;
  hasImage: boolean;
  hasRegions: boolean;
  hasExperiment?: boolean;
  modalityCount: number;
  nativeConnectivity: boolean;
  importStatus: TaskStatus;
  atlasStatus: TaskStatus;
  modalityStatus: TaskStatus;
  nativeStatus: TaskStatus;
  busy: boolean;
  onNavigate: (task: ImageTask) => void;
}) {
  const tasks = [
    { id: "image" as const, name: "Image", purpose: "Importer ou remplacer l'image de référence", ready: hasImage, status: importStatus, enabled: true, waiting: "À importer" },
    { id: "atlas" as const, name: "Recalage", purpose: "Appliquer les régions Allen à l'image", ready: hasRegions, status: atlasStatus, enabled: hasImage, waiting: "À calculer" },
    { id: "modalities" as const, name: "Modalités", purpose: "Ajouter et afficher les volumes complémentaires", ready: modalityCount > 0, status: modalityStatus, enabled: hasImage, waiting: "Facultatif" },
    { id: "connectivity" as const, name: "Connectivité", purpose: "Projeter une expérience Allen dans l'image", ready: nativeConnectivity, status: nativeStatus, enabled: hasRegions, waiting: hasExperiment ? "À projeter" : "Expérience à choisir" },
  ];
  return (
    <nav className="image-workflow" aria-label="Parcours de l'image personnelle">
      {tasks.map((task) => {
        const running = task.status === "running" || task.status === "uploading";
        const failed = task.status === "failed";
        const Icon = failed ? AlertCircle : running ? LoaderCircle : task.ready ? CheckCircle2 : Circle;
        const disabled = !task.enabled || (busy && task.id !== active);
        const status = failed ? "Échec" : running ? "En cours" : task.ready
          ? task.id === "modalities" ? `${modalityCount} importée${modalityCount > 1 ? "s" : ""}` : "Disponible"
          : !task.enabled ? task.id === "connectivity" ? "Recalage requis" : "Image requise" : task.waiting;
        return <button type="button" key={task.id} aria-current={active === task.id ? "step" : undefined}
          disabled={disabled} title={`${task.purpose} (${status})`}
          onClick={() => onNavigate(task.id)}>
          <Icon size={16} className={`${running ? "is-spinning" : ""}${failed ? " is-error" : ""}`} aria-hidden="true" />
          <span><strong>{task.name}{task.id === "modalities" && modalityCount > 0 && <b className="workflow-count" aria-hidden="true">{modalityCount}</b>}</strong>
            <small className={failed || running || !task.enabled ? undefined : "visually-hidden"}>{status}</small>
          </span>
        </button>;
      })}
    </nav>
  );
}

export function WorkflowStatus({ status, title, message, logs = [] }: {
  status: TaskStatus;
  title: string;
  message: string;
  logs?: string[];
}) {
  const running = status === "uploading" || status === "running";
  const Icon = status === "failed" ? AlertCircle : running ? LoaderCircle : status === "completed" ? CheckCircle2 : Circle;
  return <div className={`workflow-status is-${status}`}>
    <div className="workflow-status-heading" role={status === "failed" ? "alert" : "status"}>
      <Icon size={18} className={running ? "is-spinning" : undefined} aria-hidden="true" />
      <strong>{title}</strong>
    </div>
    {message && (running || status === "failed") && <p className="workflow-status-message" aria-live="polite">{message}</p>}
    {running && <div className="registration-progress" role="progressbar" aria-label={title}><span /></div>}
    {logs.length > 0 && <details className="workflow-logs">
      <summary>Journal technique</summary>
      {message && !running && status !== "failed" && <p>{message}</p>}
      <pre>{logs.join("\n")}</pre>
    </details>}
  </div>;
}
