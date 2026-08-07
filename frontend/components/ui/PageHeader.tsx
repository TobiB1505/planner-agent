import type { ReactNode } from "react";

export interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** z.B. Breadcrumb oder sonstiger Kontext-Text über dem Titel. */
  context?: ReactNode;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
  status?: ReactNode;
  className?: string;
}

/**
 * Zentraler Seitenkopf. Nicht jede Seite braucht jeden Bereich - alle
 * optional außer `title`. Aktionen brechen auf Mobile kontrolliert um statt
 * abgeschnitten zu werden.
 */
export default function PageHeader({
  eyebrow,
  title,
  subtitle,
  context,
  primaryAction,
  secondaryActions,
  status,
  className = "",
}: PageHeaderProps) {
  const hasActions = Boolean(primaryAction || secondaryActions);

  return (
    <div className={["ui-page-header", className].filter(Boolean).join(" ")}>
      <div className="ui-page-header-main">
        {context && <div className="ui-page-header-context">{context}</div>}
        {eyebrow && <span className="ui-page-header-eyebrow">{eyebrow}</span>}
        <div className="ui-page-header-title-row">
          <h1 className="ui-page-header-title">{title}</h1>
          {status && <div className="ui-page-header-status">{status}</div>}
        </div>
        {subtitle && <p className="ui-page-header-subtitle">{subtitle}</p>}
      </div>
      {hasActions && (
        <div className="ui-page-header-actions">
          {secondaryActions && <div className="ui-page-header-secondary-actions">{secondaryActions}</div>}
          {primaryAction}
        </div>
      )}
    </div>
  );
}
