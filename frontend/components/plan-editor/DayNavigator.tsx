"use client";

import type { DayStatus } from "@/lib/plan-editor/dayStatus";

export default function DayNavigator({
  dayLabels,
  weekDates,
  activeDay,
  onSelect,
  statuses,
}: {
  dayLabels: string[];
  weekDates: string[];
  activeDay: string;
  onSelect: (dayLabel: string) => void;
  statuses?: Record<string, DayStatus>;
}) {
  const todayIso = new Date().toLocaleDateString("sv-SE");

  return (
    <nav className="plan-day-navigator" aria-label="Zu einem Wochentag springen">
      {dayLabels.map((label, index) => {
        const isToday = weekDates[index] === todayIso;
        const selected = activeDay === label;
        const status = statuses?.[label];
        return (
          <button
            key={label}
            type="button"
            className={`${selected ? "is-active" : ""} ${isToday ? "is-today" : ""}`}
            aria-pressed={selected}
            onClick={() => onSelect(label)}
          >
            <span>{label.split(",")[0]}</span>
            {isToday && <small>Heute</small>}
            {status && (status.hasErrors || status.hasWarnings || status.incomplete || status.isDirty) && (
              <span className="plan-day-navigator-status" aria-hidden="true">
                {status.hasErrors && <i className="is-error" title="Konflikte" />}
                {!status.hasErrors && status.hasWarnings && <i className="is-warning" title="Hinweise" />}
                {status.incomplete && <i className="is-incomplete" title="Unvollständig" />}
                {status.isDirty && <i className="is-dirty" title="Ungespeicherte Änderungen" />}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
