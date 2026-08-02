"use client";

import type { DayStatus } from "@/lib/plan-editor/dayStatus";
import type { IHeaderParams } from "ag-grid-community";

export interface DayHeaderCellParams {
  dayLabel: string;
  isToday: boolean;
  isActive: boolean;
  status?: DayStatus;
  onSelect: (dayLabel: string) => void;
}

/**
 * Ersetzt den Standard-AG-Grid-Spaltenkopf der Tagesspalten durch dieselbe
 * Kachel-Optik wie zuvor der separate DayNavigator - keine doppelte
 * Tagesnavigation mehr, die Kachel IST jetzt der Spaltenkopf.
 */
export default function DayHeaderCell(props: IHeaderParams & DayHeaderCellParams) {
  const { dayLabel, isToday, isActive, status, onSelect } = props;
  const hasStatus = Boolean(
    status && (status.hasErrors || status.hasWarnings || status.incomplete || status.isDirty),
  );

  return (
    <button
      type="button"
      className={`plan-day-header-tile ${isActive ? "is-active" : ""} ${isToday ? "is-today" : ""}`}
      aria-pressed={isActive}
      onClick={() => onSelect(dayLabel)}
    >
      <span>{dayLabel}</span>
      {isToday && <small>Heute</small>}
      {hasStatus && (
        <span className="plan-day-navigator-status" aria-hidden="true">
          {status?.hasErrors && <i className="is-error" title="Konflikte" />}
          {!status?.hasErrors && status?.hasWarnings && <i className="is-warning" title="Hinweise" />}
          {status?.incomplete && <i className="is-incomplete" title="Unvollständig" />}
          {status?.isDirty && <i className="is-dirty" title="Ungespeicherte Änderungen" />}
        </span>
      )}
    </button>
  );
}
