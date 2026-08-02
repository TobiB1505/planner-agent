"use client";

import { useState, type ReactNode } from "react";

export default function PlanEditorSummary({
  kw,
  dateRange,
  programLabel,
  artistPlanReady,
  rehearsalPlanReady,
  peopleCount,
  statusLabel,
  weekPicker,
  details,
}: {
  kw: number;
  dateRange: string;
  programLabel: string;
  artistPlanReady: boolean;
  rehearsalPlanReady: boolean;
  peopleCount: number;
  statusLabel: string;
  /** Datumsauswahl, oben rechts neben dem Vorbereitungsdetails-Umschalter. */
  weekPicker: ReactNode;
  /** Eingeklappter Detailbereich (Künstler-/Probenplan-Karten, Vorlagenwahl). */
  details: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusTone = statusLabel.toLocaleLowerCase("de").includes("ungespeichert")
    ? "is-dirty"
    : "is-saved";

  return (
    <section className="panel plan-editor-summary">
      <div className="plan-editor-summary-main">
        <div className="plan-editor-summary-identity">
          <div className="plan-editor-summary-copy">
            <span className="plan-editor-summary-eyebrow">Aktiver Dienstplan</span>
            <h1>Dienstplan KW {kw}</h1>
            <p>{dateRange} · {programLabel}</p>
          </div>
          <div className="plan-editor-summary-checks" aria-label="Vorbereitungsstatus">
            <span className={artistPlanReady ? "is-ready" : "is-pending"}>
              {artistPlanReady ? "✓" : "–"} Künstlerplan
            </span>
            <span className={rehearsalPlanReady ? "is-ready" : "is-pending"}>
              {rehearsalPlanReady ? "✓" : "–"} Probenplan
            </span>
            <span className="is-ready">✓ {peopleCount} aktive MA</span>
          </div>
        </div>

        <div className="plan-editor-summary-controls">
          <span className={`plan-editor-summary-status ${statusTone}`}>
            <span aria-hidden="true" />
            {statusLabel}
          </span>
          <div className="plan-editor-summary-header-actions">
            <button
              type="button"
              className="plan-editor-summary-toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
            >
              <span className="plan-editor-summary-toggle-long">
                {expanded ? "Vorbereitungsdetails ausblenden" : "Vorbereitungsdetails anzeigen"}
              </span>
              <span className="plan-editor-summary-toggle-short">Details</span>
              <span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
            </button>
            {weekPicker}
          </div>
        </div>
      </div>
      {expanded && <div className="plan-editor-summary-details">{details}</div>}
    </section>
  );
}
