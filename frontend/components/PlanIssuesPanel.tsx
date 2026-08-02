"use client";

import type { PlanIssue, PlanIssueSeverity, PlanValidationSummary } from "@/lib/planValidation";
import { useEffect, useMemo, useRef, useState } from "react";

type FilterKey = "all" | "error" | "attention" | "understaffed";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Alle" },
  { key: "error", label: "Konflikte" },
  { key: "attention", label: "Hinweise" },
  { key: "understaffed", label: "Unbesetzt" },
];

const STAFFING_CATEGORIES = new Set(["understaffed", "overstaffed", "empty_required_assignment"]);

function cardLabel(issue: PlanIssue): string {
  if (issue.category === "understaffed" || issue.category === "empty_required_assignment") return "Unbesetzt";
  if (issue.category === "overstaffed") return "Überbesetzt";
  if (issue.severity === "error") return "Kritisch";
  if (issue.severity === "warning") return "Hinweis";
  return "Info";
}

function cardTone(severity: PlanIssueSeverity): string {
  if (severity === "error") return "is-error";
  if (severity === "warning") return "is-warning";
  return "is-info";
}

function matchesFilter(issue: PlanIssue, filter: FilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "error") return issue.severity === "error" && !STAFFING_CATEGORIES.has(issue.category);
  if (filter === "understaffed") return STAFFING_CATEGORIES.has(issue.category);
  return (issue.severity === "warning" || issue.severity === "info") && !STAFFING_CATEGORIES.has(issue.category);
}

function actionLabel(issue: PlanIssue): string | null {
  switch (issue.category) {
    case "understaffed":
    case "empty_required_assignment":
      return "Mitarbeiter zuweisen";
    case "invalid_employee":
      return "Eintrag bearbeiten";
    case "time_conflict":
    case "absence_conflict":
    case "show_conflict":
    case "rehearsal_conflict":
    case "rule_violation":
    case "duplicate_assignment":
    case "overstaffed":
      return "Zuweisung bearbeiten";
    default:
      return null;
  }
}

export default function PlanIssuesPanel({
  open,
  issues,
  summary,
  failed,
  onClose,
  onNavigate,
  onEdit,
  onRefresh,
}: {
  open: boolean;
  issues: PlanIssue[];
  summary: PlanValidationSummary;
  failed: boolean;
  onClose: () => void;
  onNavigate: (issue: PlanIssue) => void;
  onEdit: (issue: PlanIssue) => void;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const filtered = useMemo(() => issues.filter((issue) => matchesFilter(issue, filter)), [issues, filter]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className="plan-issues-panel"
      role="dialog"
      aria-modal="false"
      aria-label="Planprüfung"
      tabIndex={-1}
    >
      <div className="plan-issues-panel-header">
        <div>
          <h2>Planprüfung</h2>
          <p className="plan-issues-panel-counts">
            {summary.errors} {summary.errors === 1 ? "Konflikt" : "Konflikte"} · {summary.warnings}{" "}
            {summary.warnings === 1 ? "Hinweis" : "Hinweise"}
            {summary.understaffed > 0 && ` · ${summary.understaffed} unbesetzt`}
          </p>
        </div>
        <div className="plan-issues-panel-header-actions">
          <button type="button" className="btn" onClick={onRefresh}>
            Erneut prüfen
          </button>
          <button type="button" className="plan-issues-panel-close" onClick={onClose} aria-label="Planprüfung schließen">
            ×
          </button>
        </div>
      </div>

      <div className="plan-issues-panel-filters" role="tablist" aria-label="Nach Schweregrad filtern">
        {FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={filter === item.key}
            className={`plan-issues-filter ${filter === item.key ? "is-active" : ""}`}
            onClick={() => setFilter(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="plan-issues-panel-list">
        {failed && (
          <div className="plan-issues-panel-error" role="alert">
            Die Planprüfung ist fehlgeschlagen. Zuletzt bekannte Konflikte werden hier nicht angezeigt, damit
            nichts fälschlich als „geprüft“ gilt.
            <button type="button" className="btn" onClick={onRefresh}>
              Erneut versuchen
            </button>
          </div>
        )}

        {!failed && filtered.length === 0 && (
          <div className="plan-issues-panel-empty">
            <strong>Keine Konflikte gefunden</strong>
            <p>
              {issues.length === 0
                ? "Der Dienstplan enthält derzeit keine erkannten kritischen Konflikte oder Warnungen."
                : "Für diesen Filter gibt es aktuell keine Meldungen."}
            </p>
          </div>
        )}

        {!failed &&
          filtered.map((issue) => {
            const action = actionLabel(issue);
            return (
              <article key={issue.id} className={`plan-issue-card ${cardTone(issue.severity)}`}>
                <div className="plan-issue-card-label">{cardLabel(issue)}</div>
                <div className="plan-issue-card-who">
                  {issue.affectedEmployees.length > 0 && (
                    <span>{issue.affectedEmployees.map((employee) => employee.name).join(", ")}</span>
                  )}
                  {issue.dayLabel && <span className="plan-issue-card-day">{issue.dayLabel}</span>}
                </div>
                <h3>{issue.title}</h3>
                <p>{issue.description}</p>
                {issue.timeRange && <div className="plan-issue-card-time">{issue.timeRange}</div>}
                <div className="plan-issue-card-actions">
                  {issue.primaryCell && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => (action ? onEdit(issue) : onNavigate(issue))}
                    >
                      {action ?? "Im Plan anzeigen"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
      </div>
    </div>
  );
}
