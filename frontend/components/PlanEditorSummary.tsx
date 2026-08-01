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
  details,
}: {
  kw: number;
  dateRange: string;
  programLabel: string;
  artistPlanReady: boolean;
  rehearsalPlanReady: boolean;
  peopleCount: number;
  statusLabel: string;
  /** Eingeklappter Detailbereich (Künstler-/Probenplan-Karten, Vorlagenwahl). */
  details: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="panel plan-editor-summary">
      <div className="plan-editor-summary-main">
        <div className="plan-editor-summary-copy">
          <h1>Dienstplan KW {kw}</h1>
          <p>{dateRange} · {programLabel}</p>
        </div>
        <div className="plan-editor-summary-checks">
          <span className={artistPlanReady ? "is-ready" : ""}>
            {artistPlanReady ? "✓" : "–"} Künstlerplan
          </span>
          <span className={rehearsalPlanReady ? "is-ready" : ""}>
            {rehearsalPlanReady ? "✓" : "–"} Probenplan
          </span>
          <span className="is-ready">✓ {peopleCount} aktive Mitarbeiter</span>
        </div>
        <div className="plan-editor-summary-status">
          <span>Status: {statusLabel}</span>
          <button
            type="button"
            className="plan-editor-summary-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "Vorbereitungsdetails ausblenden" : "Vorbereitungsdetails anzeigen"}
            <span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
          </button>
        </div>
      </div>
      {expanded && <div className="plan-editor-summary-details">{details}</div>}
    </section>
  );
}
