import { useEffect } from "react";

export function useDialogFocus(titleId: string | null, onClose: () => void) {
  useEffect(() => {
    if (!titleId) return;
    const dialog = document.getElementById(titleId)?.closest<HTMLElement>("[role='dialog']");
    if (!dialog) return;
    const previous = document.activeElement;
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex='0']",
    )).filter((element) => element.getClientRects().length > 0);
    controls()[0]?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Tab") {
        const items = controls();
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [onClose, titleId]);
}
