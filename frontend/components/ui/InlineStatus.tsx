import type { ReactNode } from "react";

export type InlineStatusVariant = "info" | "success" | "warning" | "danger" | "loading";

export interface InlineStatusProps {
  variant?: InlineStatusVariant;
  children: ReactNode;
  className?: string;
}

/**
 * Kleine Rückmeldung innerhalb einer Seite/eines Formulars (Auto-Save-Status,
 * Validierungsfehler, Verbindungsstatus). Siehe DESIGN_SYSTEM.md für die
 * Abgrenzung zu Toast/ConfirmDialog. `danger`/`warning` nutzen role="alert"
 * (unterbricht Screenreader), alle anderen role="status" (höflich).
 * `loading` animiert bewusst nur den Punkt, nicht den ganzen Text - kein
 * dauerhaft pulsierendes Flächenelement.
 */
export default function InlineStatus({ variant = "info", children, className = "" }: InlineStatusProps) {
  const role = variant === "danger" || variant === "warning" ? "alert" : "status";

  return (
    <div
      className={["ui-inline-status", `ui-inline-status--${variant}`, className].filter(Boolean).join(" ")}
      role={role}
      aria-live={role === "alert" ? "assertive" : "polite"}
    >
      {variant === "loading" ? (
        <span className="ui-inline-status-spinner" aria-hidden="true" />
      ) : (
        <span className="ui-inline-status-dot" aria-hidden="true" />
      )}
      <span>{children}</span>
    </div>
  );
}
