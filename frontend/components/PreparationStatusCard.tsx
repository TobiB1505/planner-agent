"use client";

import Link from "next/link";

/**
 * Status-Karte für Künstler-/Probenplan - in beiden Editor-Modi (Assistent
 * und kompakte Bearbeitung) identisch verwendet, um Duplizierung zu vermeiden.
 */
export default function PreparationStatusCard({
  ready,
  readyLabel,
  readyDetail,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  href,
  reviewLabel = "Prüfen oder ändern",
  openLabel,
}: {
  ready: boolean;
  readyLabel: string;
  readyDetail: string;
  emptyIcon: string;
  emptyTitle: string;
  emptyDescription: string;
  href: string;
  reviewLabel?: string;
  openLabel: string;
}) {
  if (ready) {
    return (
      <div className="preparation-card is-complete">
        <span className="preparation-check">✓</span>
        <div className="preparation-copy">
          <small>Bereit für diese Woche</small>
          <strong>{readyLabel}</strong>
          <span>{readyDetail}</span>
        </div>
        <Link className="btn" href={href}>{reviewLabel}</Link>
      </div>
    );
  }
  return (
    <div className="preparation-card">
      <span className="preparation-icon">{emptyIcon}</span>
      <div className="preparation-copy">
        <small>Noch nicht hinterlegt</small>
        <strong>{emptyTitle}</strong>
        <span>{emptyDescription}</span>
      </div>
      <Link className="btn btn-primary" href={href}>{openLabel}</Link>
    </div>
  );
}
