"use client";

import { useId, type ReactNode } from "react";
import GlassDialog, { DialogBody, DialogFooter, DialogHeader, DialogTitle } from "./GlassDialog";
import Button, { type ButtonVariant } from "./Button";

export interface ConfirmDialogAction {
  label: string;
  onClick: () => void;
  /** primary = Haupt-Bestätigung, danger = zerstörerisch, default = neutral/Abbrechen. */
  variant?: "primary" | "danger" | "default";
  /** Fokussiert diese Aktion beim Öffnen. Für destruktive Aktionen bewusst nicht setzen - siehe DESIGN_SYSTEM.md. */
  autoFocus?: boolean;
  disabled?: boolean;
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  actions: ConfirmDialogAction[];
  /** Escape-Taste oder Klick auf den Hintergrund - wirkt wie Abbrechen. */
  onDismiss: () => void;
  /** Visuelle Einordnung - beeinflusst nur den Akzent, nicht die Aktionslogik. */
  variant?: "default" | "warning" | "danger";
}

const ACTION_VARIANT_TO_BUTTON: Record<NonNullable<ConfirmDialogAction["variant"]>, ButtonVariant> = {
  primary: "primary",
  danger: "danger",
  default: "secondary",
};

/**
 * Zentraler Bestätigungsdialog auf Basis von GlassDialog - Portal, Focus-Trap,
 * Fokus-Rückgabe, Escape/Backdrop-Verhalten kommen von dort. Bleibt bewusst
 * API-kompatibel zur bisherigen components/ConfirmDialog.tsx (actions-Array),
 * damit bestehende Aufrufer unverändert bleiben (siehe UI_MIGRATION_PLAN.md).
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  actions,
  onDismiss,
  variant = "default",
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <GlassDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
      titleId={titleId}
      descriptionId={descriptionId}
      size="sm"
      className={`ui-confirm-dialog ui-confirm-dialog--${variant}`}
    >
      <DialogHeader>
        <DialogTitle id={titleId}>{title}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div id={descriptionId} className="ui-confirm-dialog-description">
          {description}
        </div>
      </DialogBody>
      <DialogFooter>
        {actions.map((action) => (
          <Button
            key={action.label}
            variant={ACTION_VARIANT_TO_BUTTON[action.variant ?? "default"]}
            size="sm"
            disabled={action.disabled}
            data-autofocus={action.autoFocus ? "true" : undefined}
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        ))}
      </DialogFooter>
    </GlassDialog>
  );
}
