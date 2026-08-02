"use client";

import DayEntryEditor from "@/components/plan-editor/DayEntryEditor";
import { hexToRgba } from "@/lib/categoryColors";
import { dayFillStats, type DaySection, type PlanRowLike } from "@/lib/plan-editor/daySections";
import { resolveEntryFieldType } from "@/lib/plan-editor/entryFieldType";
import type { CandidateInfo } from "@/lib/recommendations";
import type { PlanIssue } from "@/lib/planValidation";
import { useState } from "react";

function dataRowKey(row: PlanRowLike): string {
  return `${row._category || row.Abschnitt}::${row.Zeile}`;
}

export default function PlanDaySectionCard({
  section,
  dayLabel,
  dayLabels,
  issues,
  people,
  isPersonSection,
  isAbsenceSection,
  getCandidates,
  getSuggestions,
  onCommitEntry,
  defaultOpen = true,
}: {
  section: DaySection;
  dayLabel: string;
  dayLabels: string[];
  issues: PlanIssue[];
  people: string[];
  isPersonSection: (category: string) => boolean;
  isAbsenceSection: (category: string) => boolean;
  getCandidates: (row: PlanRowLike, dayLabel: string) => CandidateInfo[];
  getSuggestions: (category: string) => string[];
  onCommitEntry: (row: PlanRowLike, dayLabel: string, nextValue: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const { filled, total } = dayFillStats(section, dayLabel);
  const rowKeys = new Set(section.rows.map(dataRowKey));
  const sectionIssues = issues.filter(
    (issue) => issue.dayLabel === dayLabel && issue.primaryCell && rowKeys.has(issue.primaryCell.rowId),
  );
  const errorCount = sectionIssues.filter((issue) => issue.severity === "error").length;
  const warningCount = sectionIssues.filter((issue) => issue.severity === "warning").length;

  function copyValue(text: string) {
    if (!text) return;
    navigator.clipboard?.writeText(text).catch(() => {
      // Zwischenablage kann in manchen Kontexten (kein sicherer Ursprung) fehlschlagen -
      // das Kopieren ist eine reine Komfortfunktion, kein kritischer Pfad.
    });
  }

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
            const key = dataRowKey(row);
            const category = row._category || row.Abschnitt;
            const value = (row[dayLabel] ?? "").trim();
            const rowIssues = issues.filter(
              (issue) => issue.dayLabel === dayLabel && issue.primaryCell?.rowId === key,
            );
            const isEditing = editingKey === key;
            const entryLabel = row.Zeile && row.Zeile !== section.title ? `${section.title} · ${row.Zeile}` : section.title;

            if (isEditing) {
              const fieldType = resolveEntryFieldType({
                category,
                zeile: row.Zeile,
                dayLabel,
                dayLabels,
                isPersonSection,
                isAbsenceSection,
              });
              return (
                <div key={key} className="plan-day-entry-wrap is-editing">
                  {row.Zeile && row.Zeile !== section.title && <div className="plan-day-entry-context">{row.Zeile}</div>}
                  <DayEntryEditor
                    fieldType={fieldType}
                    value={row[dayLabel] ?? ""}
                    people={people}
                    candidates={fieldType.kind === "people" || fieldType.kind === "softsport" ? getCandidates(row, dayLabel) : []}
                    suggestions={fieldType.kind === "text-suggest" ? getSuggestions(category) : []}
                    ariaLabelBase={entryLabel}
                    onCommit={(nextValue) => {
                      onCommitEntry(row, dayLabel, nextValue);
                      setEditingKey(null);
                    }}
                    onCancel={() => setEditingKey(null)}
                  />
                </div>
              );
            }

            return (
              <div
                key={key}
                className={`plan-day-entry-wrap ${value ? "" : "is-empty"}`}
              >
                <button
                  type="button"
                  className={`plan-day-entry ${rowIssues.some((i) => i.severity === "error") ? "has-error" : rowIssues.length ? "has-warning" : ""}`}
                  onClick={() => setEditingKey(key)}
                >
                  {row.Zeile && row.Zeile !== section.title && <span className="plan-day-entry-time">{row.Zeile}</span>}
                  {value ? (
                    <span className="plan-day-entry-value">{value}</span>
                  ) : (
                    <span className="plan-day-entry-placeholder">
                      Noch nicht geplant
                      <em>+ Eintrag hinzufügen</em>
                    </span>
                  )}
                </button>
                <span className="plan-day-entry-actions">
                  <button
                    type="button"
                    className="plan-day-entry-action"
                    title="Bearbeiten"
                    aria-label={`${entryLabel} bearbeiten`}
                    onClick={() => setEditingKey(key)}
                  >
                    ✎
                  </button>
                  {value && (
                    <>
                      <button
                        type="button"
                        className="plan-day-entry-action"
                        title="Kopieren"
                        aria-label={`${entryLabel} kopieren`}
                        onClick={() => copyValue(value)}
                      >
                        ⧉
                      </button>
                      <button
                        type="button"
                        className="plan-day-entry-action"
                        title="Leeren"
                        aria-label={`${entryLabel} leeren`}
                        onClick={() => onCommitEntry(row, dayLabel, "")}
                      >
                        ×
                      </button>
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
