"use client";

import type { ReactNode } from "react";

export default function PlanEditorSummary({
  kw,
  dateRange,
  programLabel,
  artistPlanReady,
  rehearsalPlanReady,
  peopleCount,
  weekPicker,
}: {
  kw: number;
  dateRange: string;
  programLabel: string;
  artistPlanReady: boolean;
  rehearsalPlanReady: boolean;
  peopleCount: number;
  /** Datumsauswahl oben rechts. */
  weekPicker: ReactNode;
}) {
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

        <div className="plan-editor-summary-controls">{weekPicker}</div>
      </div>
    </section>
  );
}
