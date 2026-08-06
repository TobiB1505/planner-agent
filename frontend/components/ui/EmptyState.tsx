import type { ReactNode } from "react";

export type EmptyStateVariant = "empty" | "filtered" | "error" | "permission";

export interface EmptyStateProps {
  variant?: EmptyStateVariant;
  icon?: ReactNode;
  title: string;
  description?: string;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
}

const DEFAULT_ICON: Record<EmptyStateVariant, ReactNode> = {
  empty: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M4 10h16" />
    </svg>
  ),
  filtered: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4 5h16l-6 7.5V18l-4 2v-7.5z" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v5M12 16h.01" />
    </svg>
  ),
  permission: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="5" y="10.5" width="14" height="9" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  ),
};

/**
 * Zentraler Empty State. `error` erhält bewusst eine eigene Farbgebung, damit
 * er sich von einem normalen leeren Zustand unterscheidet. `filtered` ist für
 * "0 Treffer bei aktiven Filtern" gedacht - die zurücksetzende Aktion gehört
 * dann in `primaryAction`.
 */
export default function EmptyState({
  variant = "empty",
  icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  className = "",
}: EmptyStateProps) {
  return (
    <div className={["ui-empty-state", `ui-empty-state--${variant}`, className].filter(Boolean).join(" ")}>
      <div className="ui-empty-state-icon" aria-hidden="true">
        {icon ?? DEFAULT_ICON[variant]}
      </div>
      <p className="ui-empty-state-title">{title}</p>
      {description && <p className="ui-empty-state-description">{description}</p>}
      {(primaryAction || secondaryAction) && (
        <div className="ui-empty-state-actions">
          {secondaryAction}
          {primaryAction}
        </div>
      )}
    </div>
  );
}
