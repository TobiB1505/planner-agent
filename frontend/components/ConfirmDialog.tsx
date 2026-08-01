"use client";

import { useEffect, useRef, type ReactNode } from "react";

export interface ConfirmDialogAction {
  label: string;
  onClick: () => void;
  /** primary = Haupt-Bestätigung, danger = zerstörerisch, default = neutral/Abbrechen. */
  variant?: "primary" | "danger" | "default";
  autoFocus?: boolean;
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  actions: ConfirmDialogAction[];
  /** Escape-Taste oder Klick auf den Hintergrund - wirkt wie Abbrechen. */
  onDismiss: () => void;
}

/**
 * Kleine, wiederverwendbare Bestätigungs-Dialog-Komponente - ersetzt native
 * window.confirm()-Dialoge im gesamten Dienstplan-Editor. Unterstützt 2
 * (Abbrechen/Bestätigen) oder 3 Aktionen (z.B. Abbrechen/Verwerfen/Speichern).
 */
export default function ConfirmDialog({ open, title, description, actions, onDismiss }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onDismiss]);

  useEffect(() => {
    if (!open) return;
    const autoFocusTarget = dialogRef.current?.querySelector<HTMLButtonElement>("[data-autofocus]");
    (autoFocusTarget ?? dialogRef.current?.querySelector("button"))?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="confirm-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div
        ref={dialogRef}
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
      >
        <h2 id="confirm-dialog-title">{title}</h2>
        <div id="confirm-dialog-description" className="confirm-dialog-description">
          {description}
        </div>
        <div className="confirm-dialog-actions">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              data-autofocus={action.autoFocus ? "true" : undefined}
              className={`btn ${action.variant === "primary" ? "btn-primary" : ""} ${action.variant === "danger" ? "btn-danger-solid" : ""}`}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
