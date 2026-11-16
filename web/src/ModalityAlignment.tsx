import { useI18n } from "./i18n";
import { useState } from "react";
import type { SessionRecord } from "./data";

export type ModalitySession = "" | "same" | "other" | "unknown";

export function modalityAlignmentConfirmed(session: ModalitySession, aligned: boolean, registeredSession = false) {
  return aligned && (session === "same" || (session === "other" && registeredSession));
}

export function SessionImport({ disabled, onRegister }: { disabled: boolean; onRegister: (name: string, file: File) => Promise<boolean> }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  return <section className="session-import" aria-label={t("Nouvelle session") }>
    <h3>{t("RARE de la nouvelle session")}</h3>
    <div className="session-import-fields">
      <label>{t("Nom de la session")}<input value={name} maxLength={80} disabled={disabled} onChange={(event) => setName(event.target.value)} /></label>
      <label className="registration-file-picker">
        <input type="file" accept=".nii,.nii.gz" disabled={disabled} aria-label={t("RARE de la nouvelle session")}
          onClick={(event) => { event.currentTarget.value = ""; }} onChange={(event) => {
            const next = event.target.files?.[0] ?? null;
            setFile(next);
            if (next && !name.trim()) setName(next.name.replace(/\.nii(?:\.gz)?$/i, ""));
          }} />
        <span>{file?.name ?? t("Choisir la RARE")}</span>
      </label>
      <button type="button" disabled={disabled || !file || !name.trim()} onClick={async () => {
        if (file && await onRegister(name.trim(), file)) { setFile(null); setName(""); }
      }}>{t(disabled ? "Traitement en cours" : "Recaler cette RARE")}</button>
    </div>
    <p>{t("Même souris uniquement. La RARE de référence reste conservée.")}</p>
  </section>;
}

export default function ModalityAlignment({ session, aligned, disabled, onSessionChange, onAlignedChange,
  sessions = [], selectedSessionId = "", onSessionIdChange, onAddSession, onViewSession,
}: {
  session: ModalitySession;
  aligned: boolean;
  disabled: boolean;
  onSessionChange: (session: ModalitySession) => void;
  onAlignedChange: (aligned: boolean) => void;
  sessions?: SessionRecord[];
  selectedSessionId?: string;
  onSessionIdChange?: (id: string) => void;
  onAddSession?: () => void;
  onViewSession?: (session: SessionRecord) => void;
}) {
  const { t } = useI18n();
  const selected = sessions.find((entry) => entry.id === selectedSessionId);
  return <div className="modality-alignment">
    <label className="modality-session-field">
      <span>{t("Session de la modalité")}</span>
      <select value={session} disabled={disabled} onChange={(event) => onSessionChange(event.target.value as ModalitySession)}>
        <option value="">{t("Choisir la session")}</option>
        <option value="same">{t("Même session que la RARE de référence")}</option>
        <option value="other">{t("Autre session")}</option>
        <option value="unknown">{t("Je ne sais pas")}</option>
      </select>
    </label>
    {session === "same" && <>
      <label className="modality-alignment-confirm">
        <input type="checkbox" disabled={disabled} checked={aligned} onChange={(event) => onAlignedChange(event.target.checked)} />
        <span>{t("Cette image est déjà alignée sur la RARE de référence. Autoriser l'adaptation de sa grille si nécessaire.")}</span>
      </label>
      <p>{t("Une grille identique ne garantit pas l'alignement anatomique. Le rééchantillonnage ne corrige pas les déplacements.")}</p>
    </>}
    {session === "other" && <>
      <div className="session-selection">
      <label className="modality-session-field"><span>{t("Session de cette modalité")}</span>
        <select value={selected?.id ?? ""} disabled={disabled} onChange={(event) => onSessionIdChange?.(event.target.value)}>
          <option value="">{t("Choisir une session recalée")}</option>
          {sessions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
      </label>
      {onAddSession && <button type="button" disabled={disabled} onClick={onAddSession}>{t("Ajouter une session (RARE)")}</button>}
      </div>
      {selected && <>
        <div className="session-reference"><span>{selected.sourceFile}</span>
          <button type="button" disabled={disabled} onClick={() => onViewSession?.(selected)}>{t("Vérifier la RARE")}</button>
        </div>
        <label className="modality-alignment-confirm"><input type="checkbox" checked={aligned} disabled={disabled}
          onChange={(event) => onAlignedChange(event.target.checked)} />
          <span>{t("Cette modalité est déjà alignée sur la RARE de la session choisie. Lui appliquer le même recalage vers la référence.")}</span>
        </label>
      </>}
    </>}
    {session === "unknown" && <p className="modality-alignment-warning" role="status">
      {t("Identifiez d'abord la session et sa RARE. Une grille identique ne suffit pas pour garantir l'alignement.")}
    </p>}
  </div>;
}
