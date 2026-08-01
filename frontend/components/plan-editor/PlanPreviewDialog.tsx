"use client";

import type { PlanDiff } from "@/lib/plan-editor/planDiff";
import { useEffect, useMemo, useRef } from "react";

export default function PlanPreviewDialog({
  open,
  title,
  description,
  diff,
  busy,
  applyLabel,
  onApply,
  onDismiss,
}: {
  open: boolean;
  title: string;
  description: string;
  diff: PlanDiff;
  busy: boolean;
  applyLabel: string;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const grouped = useMemo(() => {
    const result = new Map<string, typeof diff.changes>();
    diff.changes.forEach((change) => {
      result.set(change.dayLabel, [...(result.get(change.dayLabel) ?? []), change]);
    });
    return [...result.entries()];
  }, [diff]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }
    document.addEventListener("keydown", handleKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onDismiss]);

  if (!open) return null;

  return (
    <div className="plan-preview-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onDismiss();
    }}>
      <section
        ref={dialogRef}
        className="plan-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-preview-title"
        tabIndex={-1}
      >
        <header className="plan-preview-header">
          <div>
            <span className="plan-preview-eyebrow">Änderungsvorschau</span>
            <h2 id="plan-preview-title">{title}</h2>
            <p>{description}</p>
          </div>
          <button type="button" onClick={onDismiss} disabled={busy} aria-label="Vorschau schließen">×</button>
        </header>

        <div className="plan-preview-stats" aria-label="Zusammenfassung der Änderungen">
          <span className="is-added"><strong>+{diff.added}</strong> neu</span>
          <span className="is-changed"><strong>~{diff.changed}</strong> geändert</span>
          <span className="is-removed"><strong>−{diff.removed}</strong> entfernt</span>
        </div>

        <div className="plan-preview-list">
          {grouped.length === 0 ? (
            <div className="plan-preview-empty">
              <strong>Keine Änderungen gefunden</strong>
              <span>Der aktuelle Plan entspricht bereits dem Vorschlag.</span>
            </div>
          ) : grouped.map(([day, changes]) => (
            <section key={day} className="plan-preview-day">
              <h3>{day}</h3>
              {changes.map((change) => (
                <article key={change.id} className="plan-preview-change">
                  <div>
                    <strong>{change.section}</strong>
                    <span>{change.rowLabel}</span>
                  </div>
                  <div className="plan-preview-values">
                    {change.before && <span className="is-before">− {change.before}</span>}
                    {change.after && <span className="is-after">+ {change.after}</span>}
                  </div>
                </article>
              ))}
            </section>
          ))}
        </div>

        <footer className="plan-preview-actions">
          <span>Es wird erst nach deiner Bestätigung übernommen.</span>
          <button type="button" className="btn" disabled={busy} onClick={onDismiss}>Abbrechen</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || diff.changes.length === 0}
            onClick={onApply}
          >
            {busy && <span className="spinner" />}
            {applyLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
