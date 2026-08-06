import type { ReactNode } from "react";
import { Card } from "./Card";

export interface MetricCardProps {
  title: string;
  /** Kennzahl als fertig formatierter String (Aufrufer entscheidet über Formatierung/Rundung). */
  value: string;
  unit?: string;
  /** z.B. "+4 ggü. Vorwoche" - Vorzeichen/Text liegt beim Aufrufer, keine implizite Positiv/Negativ-Logik. */
  change?: { label: string; tone?: "positive" | "negative" | "neutral" };
  status?: { label: string; tone?: "positive" | "warning" | "danger" | "neutral" };
  action?: ReactNode;
  className?: string;
}

const CHANGE_TONE_CLASS: Record<NonNullable<MetricCardProps["change"]>["tone"] & string, string> = {
  positive: "ui-metric-change--positive",
  negative: "ui-metric-change--negative",
  neutral: "ui-metric-change--neutral",
};

const STATUS_TONE_CLASS: Record<NonNullable<MetricCardProps["status"]>["tone"] & string, string> = {
  positive: "ui-metric-status--positive",
  warning: "ui-metric-status--warning",
  danger: "ui-metric-status--danger",
  neutral: "ui-metric-status--neutral",
};

/**
 * Zentrale Kennzahl-Kachel. Zeigt Titel + Kennzahl mit tabellarischen Ziffern
 * (kein Zahlenspringen bei Wertewechsel), optionale Einheit/Veränderung/Status
 * und optionale Aktion. Bewusst ohne dekorative Mini-Diagramme (siehe
 * Sprint-1-Auftrag) - Status wird immer über Text, nicht nur Farbe vermittelt.
 */
export default function MetricCard({ title, value, unit, change, status, action, className = "" }: MetricCardProps) {
  return (
    <Card variant="raised" className={["ui-metric-card", className].filter(Boolean).join(" ")}>
      <div className="ui-metric-card-head">
        <span className="ui-metric-title">{title}</span>
        {status && (
          <span className={["ui-metric-status", STATUS_TONE_CLASS[status.tone ?? "neutral"]].join(" ")}>
            {status.label}
          </span>
        )}
      </div>
      <div className="ui-metric-value-row">
        <span className="ui-metric-value tabular-nums">{value}</span>
        {unit && <span className="ui-metric-unit">{unit}</span>}
      </div>
      {(change || action) && (
        <div className="ui-metric-footer">
          {change && (
            <span className={["ui-metric-change", CHANGE_TONE_CLASS[change.tone ?? "neutral"]].join(" ")}>
              {change.label}
            </span>
          )}
          {action && <span className="ui-metric-action">{action}</span>}
        </div>
      )}
    </Card>
  );
}
