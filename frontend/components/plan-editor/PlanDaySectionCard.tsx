"use client";

import { hexToRgba } from "@/lib/categoryColors";
import { dayFillStats, type DaySection, type PlanRowLike } from "@/lib/plan-editor/daySections";
import type { PlanIssue } from "@/lib/planValidation";
import { useState } from "react";

function rowEntryLabel(row: PlanRowLike, dayLabel: string): { time: string; value: string } {
  const value = (row[dayLabel] ?? "").trim();
  return { time: row.Zeile, value };
}

function dataRowKey(row: PlanRowLike): string {
  return `${row._category || row.Abschnitt}::${row.Zeile}`;
}

export default function PlanDaySectionCard({
  section,
  dayLabel,
  issues,
  onEditRow,
  defaultOpen = true,
}: {
  section: DaySection;
  dayLabel: string;
  issues: PlanIssue[];
  onEditRow: (row: PlanRowLike, dayLabel: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { filled, total } = dayFillStats(section, dayLabel);
  const rowKeys = new Set(section.rows.map(dataRowKey));
  const sectionIssues = issues.filter(
    (issue) => issue.dayLabel === dayLabel && issue.primaryCell && rowKeys.has(issue.primaryCell.rowId),
  );
  const errorCount = sectionIssues.filter((issue) => issue.severity === "error").length;
  const warningCount = sectionIssues.filter((issue) => issue.severity === "warning").length;

  return (
    <section className="panel plan-day-section" style={{ borderLeftColor: section.color }}>
      <button
        type="button"
        className="plan-day-section-head"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className="plan-day-section-swatch" style={{ background: hexToRgba(section.color, 0.85) }} />
        <span className="plan-day-section-title">
          <strong>{section.title}</strong>
          <small>{total} {total === 1 ? "Zeile" : "Zeilen"} · {filled}/{total} ausgefüllt</small>
        </span>
        <span className="plan-day-section-badges">
          {errorCount > 0 && <span className="plan-day-badge is-error">{errorCount} Konflikt{errorCount === 1 ? "" : "e"}</span>}
          {warningCount > 0 && <span className="plan-day-badge is-warning">{warningCount} Hinweis{warningCount === 1 ? "" : "e"}</span>}
          <span className="plan-day-section-toggle" aria-hidden="true">{open ? "–" : "+"}</span>
        </span>
      </button>
      {open && (
        <div className="plan-day-section-body">
          {section.rows.map((row) => {
            const entry = rowEntryLabel(row, dayLabel);
            const key = dataRowKey(row);
            const rowIssues = issues.filter(
              (issue) => issue.dayLabel === dayLabel && issue.primaryCell?.rowId === key,
            );
            return (
              <button
                type="button"
                key={key}
                className={`plan-day-entry ${rowIssues.some((i) => i.severity === "error") ? "has-error" : rowIssues.length ? "has-warning" : ""} ${entry.value ? "" : "is-empty"}`}
                onClick={() => onEditRow(row, dayLabel)}
              >
                {entry.time && entry.time !== section.title && <span className="plan-day-entry-time">{entry.time}</span>}
                <span className="plan-day-entry-value">{entry.value || "– leer –"}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
