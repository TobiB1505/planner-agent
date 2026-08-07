import type { HTMLAttributes, ReactNode } from "react";

export type StatusBadgeVariant = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

export interface StatusBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "className"> {
  variant?: StatusBadgeVariant;
  /** Zeigt einen kleinen Statuspunkt vor dem Text (dekorativ, aria-hidden). */
  dot?: boolean;
  icon?: ReactNode;
  compact?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Zentrale Status-Komponente. Kennt keine fachlichen Enums (Backend-Status,
 * Mitarbeiterstatus etc.) - das Mapping von fachlichem Wert auf `variant`
 * gehört in die aufrufende Seite/den aufrufenden Feature-Code, z.B.:
 *   const employeeStatusToBadgeVariant = { active: "success", inactive: "neutral" } as const;
 * Farbe ist nie das einzige Signal: Text oder Icon sind Pflicht (`children`).
 */
export default function StatusBadge({
  variant = "neutral",
  dot = false,
  icon,
  compact = false,
  className = "",
  children,
  ...rest
}: StatusBadgeProps) {
  const classes = [
    "ui-status-badge",
    `ui-status-badge--${variant}`,
    compact ? "ui-status-badge--compact" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} {...rest}>
      {dot && <span className="ui-status-badge-dot" aria-hidden="true" />}
      {icon && (
        <span className="ui-status-badge-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="ui-status-badge-label">{children}</span>
    </span>
  );
}
