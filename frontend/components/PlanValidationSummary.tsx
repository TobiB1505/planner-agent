"use client";

import type { PlanValidationSummary as Summary } from "@/lib/planValidation";

export type ValidationStatus = "idle" | "checking" | "failed";

export default function PlanValidationSummary({
  summary,
  status,
  onOpen,
}: {
  summary: Summary;
  status: ValidationStatus;
  onOpen: () => void;
}) {
  if (status === "checking") {
    return (
      <span className="plan-validation-summary is-checking" role="status">
        Plan wird geprüft …
      </span>
    );
  }

  if (status === "failed") {
    return (
      <button
        type="button"
        className="plan-validation-summary is-failed"
        onClick={onOpen}
      >
        <span aria-hidden="true">⚠</span>
        Planprüfung fehlgeschlagen
      </button>
    );
  }

  const hasErrors = summary.errors > 0;
  const hasWarnings = summary.warnings > 0;
  const hasIssues = hasErrors || hasWarnings || summary.info > 0;

  if (!hasIssues) {
    return (
      <button type="button" className="plan-validation-summary is-clean" onClick={onOpen}>
        <span aria-hidden="true">✓</span>
        Planprüfung ohne Konflikte
      </button>
    );
  }

  const parts: string[] = [];
  if (hasErrors) parts.push(`${summary.errors} ${summary.errors === 1 ? "Konflikt" : "Konflikte"}`);
  if (hasWarnings) parts.push(`${summary.warnings} ${summary.warnings === 1 ? "Hinweis" : "Hinweise"}`);
  if (!hasErrors && !hasWarnings && summary.info > 0) {
    parts.push(`${summary.info} ${summary.info === 1 ? "Info" : "Infos"}`);
  }

  return (
    <button
      type="button"
      className={`plan-validation-summary ${hasErrors ? "is-error" : "is-warning"}`}
      onClick={onOpen}
      aria-label={`Planprüfung öffnen: ${parts.join(", ")}`}
    >
      <span aria-hidden="true">{hasErrors ? "●" : "⚠"}</span>
      {parts.join(" · ")}
      <span className="plan-validation-summary-cta">Prüfung öffnen</span>
    </button>
  );
}
