"use client";

import DayNavigator from "@/components/plan-editor/DayNavigator";
import PlanDaySectionCard from "@/components/plan-editor/PlanDaySectionCard";
import { buildDaySections, type PlanRowLike } from "@/lib/plan-editor/daySections";
import type { DayStatus } from "@/lib/plan-editor/dayStatus";
import type { PlanIssue } from "@/lib/planValidation";
import { useMemo } from "react";

export default function PlanDayView({
  rows,
  dayLabels,
  weekDates,
  activeDay,
  onSelectDay,
  statuses,
  issues,
  onEditRow,
}: {
  rows: PlanRowLike[];
  dayLabels: string[];
  weekDates: string[];
  activeDay: string;
  onSelectDay: (dayLabel: string) => void;
  statuses: Record<string, DayStatus>;
  issues: PlanIssue[];
  onEditRow: (row: PlanRowLike, dayLabel: string) => void;
}) {
  const sections = useMemo(() => buildDaySections(rows), [rows]);
  const dayIndex = dayLabels.indexOf(activeDay);
  const dateLabel = dayIndex >= 0 ? weekDates[dayIndex] : undefined;

  return (
    <div className="plan-day-view">
      <div className="planner-grid-meta plan-workspace-orientation">
        <div className="plan-workspace-copy">
          <strong>Tagesplanung</strong>
          <span>Ein Tag im Detail · nach Dienstplan-Abschnitten gruppiert</span>
        </div>
        <DayNavigator
          dayLabels={dayLabels}
          weekDates={weekDates}
          activeDay={activeDay}
          onSelect={onSelectDay}
          statuses={statuses}
        />
      </div>
      {dateLabel && (
        <p className="plan-day-view-date">
          {activeDay} · {new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${dateLabel}T12:00:00`))}
        </p>
      )}
      <div className="plan-day-view-sections">
        {sections.map((section) => (
          <PlanDaySectionCard
            key={section.key}
            section={section}
            dayLabel={activeDay}
            issues={issues}
            onEditRow={onEditRow}
          />
        ))}
      </div>
    </div>
  );
}
