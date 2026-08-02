"use client";

import ConfirmDialog from "@/components/ConfirmDialog";
import CopyPanel from "@/components/plan-editor/CopyPanel";
import DayNavigator from "@/components/plan-editor/DayNavigator";
import PlanDaySectionCard from "@/components/plan-editor/PlanDaySectionCard";
import { buildDaySections, type PlanRowLike } from "@/lib/plan-editor/daySections";
import type { CopyChange } from "@/lib/plan-editor/dayCopy";
import type { DayStatus } from "@/lib/plan-editor/dayStatus";
import type { PlanIssue } from "@/lib/planValidation";
import type { CandidateInfo } from "@/lib/recommendations";
import { useMemo, useState } from "react";

type DayPanel = "prev-day" | "other-day" | "copy-section" | "clear-day";

export default function PlanDayView({
  rows,
  dayLabels,
  weekDates,
  activeDay,
  onSelectDay,
  statuses,
  issues,
  people,
  isPersonSection,
  isAbsenceSection,
  getCandidates,
  getSuggestions,
  onCommitEntry,
  onApplyChanges,
}: {
  rows: PlanRowLike[];
  dayLabels: string[];
  weekDates: string[];
  activeDay: string;
  onSelectDay: (dayLabel: string) => void;
  statuses: Record<string, DayStatus>;
  issues: PlanIssue[];
  people: string[];
  isPersonSection: (category: string) => boolean;
  isAbsenceSection: (category: string) => boolean;
  getCandidates: (row: PlanRowLike, dayLabel: string) => CandidateInfo[];
  getSuggestions: (category: string) => string[];
  onCommitEntry: (row: PlanRowLike, dayLabel: string, nextValue: string) => void;
  onApplyChanges: (changes: CopyChange[], cause: string) => void;
}) {
  const sections = useMemo(() => buildDaySections(rows), [rows]);
  const [panel, setPanel] = useState<DayPanel | null>(null);
  const dayIndex = dayLabels.indexOf(activeDay);
  const dateLabel = dayIndex >= 0 ? weekDates[dayIndex] : undefined;
  const previousDay = dayIndex > 0 ? dayLabels[dayIndex - 1] : undefined;
  const otherDays = dayLabels.filter((label) => label !== activeDay);

  const filledOnActiveDay = useMemo(
    () => rows.filter((row) => row._row_type !== "group" && (row[activeDay] ?? "").trim()).length,
    [rows, activeDay],
  );

  function clearActiveDay() {
    const changes: CopyChange[] = rows
      .filter((row) => row._row_type !== "group" && (row[activeDay] ?? "").trim())
      .map((row) => ({ row, dayLabel: activeDay, nextValue: "" }));
    onApplyChanges(changes, "clear_day");
    setPanel(null);
  }

  return (
    <div className="plan-day-view">
      <div className="planner-grid-meta plan-workspace-orientation plan-workspace-orientation-full">
        <DayNavigator
          dayLabels={dayLabels}
          weekDates={weekDates}
          activeDay={activeDay}
          onSelect={onSelectDay}
          statuses={statuses}
        />
      </div>
      <div className="plan-day-view-bar">
        {dateLabel && (
          <p className="plan-day-view-date">
            {activeDay} · {new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${dateLabel}T12:00:00`))}
          </p>
        )}
        <div className="plan-day-actions" role="group" aria-label="Tagesaktionen">
          <button
            type="button"
            className="btn plan-day-action"
            disabled={!previousDay}
            title={previousDay ? `Inhalte von ${previousDay} übernehmen` : "Der Montag hat keinen Vortag in dieser Woche"}
            onClick={() => setPanel("prev-day")}
          >
            Vortag übernehmen
          </button>
          <button type="button" className="btn plan-day-action" onClick={() => setPanel("other-day")}>
            Aus anderem Tag übernehmen
          </button>
          <button type="button" className="btn plan-day-action" onClick={() => setPanel("copy-section")}>
            Bereich kopieren
          </button>
          <button
            type="button"
            className="btn plan-day-action is-danger"
            disabled={filledOnActiveDay === 0}
            onClick={() => setPanel("clear-day")}
          >
            Tag leeren
          </button>
        </div>
      </div>
      <div className="plan-day-view-sections">
        {sections.map((section) => (
          <PlanDaySectionCard
            key={section.key}
            section={section}
            dayLabel={activeDay}
            dayLabels={dayLabels}
            weekDates={weekDates}
            issues={issues}
            people={people}
            isPersonSection={isPersonSection}
            isAbsenceSection={isAbsenceSection}
            getCandidates={getCandidates}
            getSuggestions={getSuggestions}
            onCommitEntry={onCommitEntry}
            onApplyChanges={onApplyChanges}
          />
        ))}
      </div>

      {panel === "prev-day" && previousDay && (
        <CopyPanel
          open
          title="Vortag übernehmen"
          hint="Abschnitte auswählen, deren Inhalte vom Vortag auf den ausgewählten Tag übernommen werden."
          rows={rows}
          sections={sections}
          dayLabels={dayLabels}
          weekDates={weekDates}
          sourceOptions={[previousDay]}
          defaultSource={previousDay}
          targetOptions={[activeDay]}
          defaultTargets={[activeDay]}
          onApply={(changes) => onApplyChanges(changes, "copy_previous_day")}
          onClose={() => setPanel(null)}
        />
      )}

      {panel === "other-day" && (
        <CopyPanel
          open
          title="Aus anderem Tag übernehmen"
          hint="Quelltag wählen und Abschnitte auswählen, deren Inhalte auf den ausgewählten Tag übernommen werden."
          rows={rows}
          sections={sections}
          dayLabels={dayLabels}
          weekDates={weekDates}
          sourceOptions={otherDays}
          defaultSource={previousDay ?? otherDays[0]}
          targetOptions={[activeDay]}
          defaultTargets={[activeDay]}
          onApply={(changes) => onApplyChanges(changes, "copy_other_day")}
          onClose={() => setPanel(null)}
        />
      )}

      {panel === "copy-section" && (
        <CopyPanel
          open
          title="Bereich kopieren"
          hint="Abschnitte des ausgewählten Tages auf andere Tage übertragen."
          rows={rows}
          sections={sections}
          dayLabels={dayLabels}
          weekDates={weekDates}
          sourceOptions={[activeDay]}
          defaultSource={activeDay}
          targetOptions={otherDays}
          onApply={(changes) => onApplyChanges(changes, "copy_section")}
          onClose={() => setPanel(null)}
        />
      )}

      <ConfirmDialog
        open={panel === "clear-day"}
        title={`${activeDay} komplett leeren?`}
        description={`${filledOnActiveDay} ${filledOnActiveDay === 1 ? "ausgefüllter Eintrag wird" : "ausgefüllte Einträge werden"} entfernt. Die Aktion lässt sich mit Rückgängig widerrufen.`}
        actions={[
          { label: "Abbrechen", onClick: () => setPanel(null), autoFocus: true },
          { label: "Tag leeren", variant: "danger", onClick: clearActiveDay },
        ]}
        onDismiss={() => setPanel(null)}
      />
    </div>
  );
}
