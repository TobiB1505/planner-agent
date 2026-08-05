"use client";

import { useSyncExternalStore } from "react";
import type { ReadableStore } from "@/lib/plan-editor/useGridDayIndicators";
import type { DayStatus } from "@/lib/plan-editor/dayStatus";
import type { IHeaderParams } from "ag-grid-community";

export interface DayHeaderCellParams {
  dayLabel: string;
  isToday: boolean;
  /** AP8: abonnierbare Stores statt fertiger Werte, damit dieser Header sich
   * bei einem Tages-/Statuswechsel selbst neu rendert (useSyncExternalStore),
   * ohne dass sich `columnDefs` dafür neu bauen muss (siehe
   * useGridDayIndicators). Ein reines `ref.current` im Render-Body wäre laut
   * react-hooks/refs nicht erlaubt und würde von ag-grid-react ohnehin nicht
   * zuverlässig neu gerendert (refreshHeader() allein reicht dafür nicht). */
  activeDayStore: ReadableStore<string>;
  dayStatusesStore: ReadableStore<Record<string, DayStatus | undefined>>;
  onSelect: (dayLabel: string) => void;
}

/**
 * Ersetzt den Standard-AG-Grid-Spaltenkopf der Tagesspalten durch dieselbe
 * Kachel-Optik wie zuvor der separate DayNavigator - keine doppelte
 * Tagesnavigation mehr, die Kachel IST jetzt der Spaltenkopf.
 */
export default function DayHeaderCell(props: IHeaderParams & DayHeaderCellParams) {
  const { dayLabel, isToday, activeDayStore, dayStatusesStore, onSelect } = props;
  const isActive = useSyncExternalStore(
    activeDayStore.subscribe,
    () => activeDayStore.get() === dayLabel,
  );
  const status = useSyncExternalStore(
    dayStatusesStore.subscribe,
    () => dayStatusesStore.get()[dayLabel],
  );
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
