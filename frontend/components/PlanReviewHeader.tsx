"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export interface ReviewMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export default function PlanReviewHeader({
  eyebrow,
  title,
  description,
  active,
  metrics,
  weekPicker,
  primaryLabel,
  onPrimary,
  busy,
  secondaryHref,
  secondaryLabel = "Zur Dienstplan-Erstellung",
  menuItems = [],
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  active: boolean;
  metrics: string[];
  weekPicker?: ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  busy: boolean;
  secondaryHref?: string;
  secondaryLabel?: string;
  menuItems?: ReviewMenuItem[];
  children?: ReactNode;
}) {
  return (
    <section className="panel plan-review-header">
      <div className="plan-review-main">
        <div className="plan-review-copy">
          <div className="plan-review-eyebrow">
            <span>{eyebrow}</span>
            <span className={`plan-review-status ${active ? "is-active" : ""}`}>
              {active ? "✓ Für Dienstplan aktiv" : "Noch nicht aktiviert"}
            </span>
          </div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <div className="plan-review-controls">
          {weekPicker}
          <div className="plan-review-metrics">
            {metrics.map((metric) => <span key={metric}>{metric}</span>)}
          </div>
        </div>
        <div className="plan-review-actions">
          {secondaryHref && active && (
            <Link className="btn" href={secondaryHref}>{secondaryLabel}</Link>
          )}
          <button className="btn btn-primary" disabled={busy} onClick={onPrimary}>
            {busy && <span className="spinner" />}
            {primaryLabel}
          </button>
          {menuItems.length > 0 && (
            <details className="plan-review-menu">
              <summary aria-label="Weitere Aktionen">•••</summary>
              <div>
                {menuItems.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    disabled={item.disabled}
                    className={item.danger ? "is-danger" : ""}
                    onClick={(event) => {
                      item.onClick();
                      event.currentTarget.closest("details")?.removeAttribute("open");
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}
