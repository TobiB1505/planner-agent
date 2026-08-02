"use client";

import ConfirmDialog from "@/components/ConfirmDialog";
import type { DaySection, PlanRowLike } from "@/lib/plan-editor/daySections";
import { buildCopyChanges, computeCopyStats, weekdayLabels, weekendLabels, type CopyChange } from "@/lib/plan-editor/dayCopy";
import { useMemo, useState } from "react";

/**
 * Ein Dialog für alle Kopier-/Übernahme-Aktionen der Tagesplanung (Vortag
 * übernehmen, aus anderem Tag übernehmen, Bereich kopieren, einzelnen Eintrag
 * kopieren, Abschnitt kopieren) - dieselbe UI, nur mit anderen Optionen:
 * - `sourceOptions.length === 1` -> Quelltag ist fest (Anzeige, keine Auswahl).
 * - `targetOptions.length === 1` -> Zieltag ist fest (Anzeige, keine Auswahl).
 * - `sections` gesetzt -> Abschnitts-Checkboxen (Standard: nichts ausgewählt);
 *   sonst wirkt die Aktion direkt auf die übergebenen `rows` (einzelner
 *   Eintrag oder bereits ein ganzer Abschnitt).
 */
export default function CopyPanel({
  open,
  title,
  hint,
  rows,
  sections,
  dayLabels,
  weekDates,
  sourceOptions,
  defaultSource,
  targetOptions,
  defaultTargets = [],
  onApply,
  onClose,
}: {
  open: boolean;
  title: string;
  hint?: string;
  rows: PlanRowLike[];
  sections?: DaySection[];
  dayLabels: string[];
  weekDates: string[];
  sourceOptions: string[];
  defaultSource: string;
  targetOptions: string[];
  defaultTargets?: string[];
  onApply: (changes: CopyChange[]) => void;
  onClose: () => void;
}) {
  const [sourceDay, setSourceDay] = useState(defaultSource);
  const [targetDays, setTargetDays] = useState<Set<string>>(new Set(defaultTargets));
  const [selectedSections, setSelectedSections] = useState<Set<string>>(new Set());

  const dateFor = (label: string) => {
    const index = dayLabels.indexOf(label);
    const iso = index >= 0 ? weekDates[index] : undefined;
    return iso ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" }).format(new Date(`${iso}T12:00:00`)) : "";
  };

  const effectiveRows = useMemo(() => {
    if (!sections) return rows;
    return sections.filter((section) => selectedSections.has(section.key)).flatMap((section) => section.rows);
  }, [sections, selectedSections, rows]);

  const targets = useMemo(() => Array.from(targetDays), [targetDays]);

  const stats = useMemo(
    () => computeCopyStats(effectiveRows, sourceDay, targets),
    [effectiveRows, sourceDay, targets],
  );

  const canApply = effectiveRows.length > 0 && targets.length > 0 && stats.toCopy > 0;

  function toggleSection(key: string) {
    setSelectedSections((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleTarget(day: string) {
    setTargetDays((current) => {
      const next = new Set(current);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  function selectTargetGroup(days: string[]) {
    setTargetDays(new Set(days.filter((day) => day !== sourceDay && targetOptions.includes(day))));
  }

  function reset() {
    setSourceDay(defaultSource);
    setTargetDays(new Set(defaultTargets));
    setSelectedSections(new Set());
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleApply() {
    if (!canApply) return;
    onApply(buildCopyChanges(effectiveRows, sourceDay, targets));
    reset();
    onClose();
  }

  const workdayOptions = weekdayLabels(dayLabels).filter((day) => targetOptions.includes(day));
  const weekendOptions = weekendLabels(dayLabels).filter((day) => targetOptions.includes(day));

  return (
    <ConfirmDialog
      open={open}
      title={title}
      onDismiss={handleClose}
      actions={[
        { label: "Abbrechen", onClick: handleClose },
        { label: "Übernehmen", variant: "primary", autoFocus: true, disabled: !canApply, onClick: handleApply },
      ]}
      description={
        <div className="copy-panel">
          {hint && <p className="copy-panel-hint">{hint}</p>}

          <div className="copy-panel-days">
            <div className="copy-panel-field">
              <span>Quelltag</span>
              {sourceOptions.length > 1 ? (
                <select value={sourceDay} onChange={(event) => setSourceDay(event.target.value)}>
                  {sourceOptions.map((day) => (
                    <option key={day} value={day}>
                      {day} · {dateFor(day)}
                    </option>
                  ))}
                </select>
              ) : (
                <strong>{sourceOptions[0]} · {dateFor(sourceOptions[0])}</strong>
              )}
            </div>
            <span className="copy-panel-arrow" aria-hidden="true">→</span>
            <div className="copy-panel-field">
              <span>Zieltag{targetOptions.length > 1 ? "e" : ""}</span>
              {targetOptions.length > 1 ? (
                <div className="copy-panel-target-days">
                  {targetOptions.map((day) => (
                    <button
                      key={day}
                      type="button"
                      className={targetDays.has(day) ? "is-active" : ""}
                      disabled={day === sourceDay}
                      onClick={() => toggleTarget(day)}
                      aria-pressed={targetDays.has(day)}
                    >
                      {day.split(",")[0]}
                    </button>
                  ))}
                </div>
              ) : (
                <strong>{targetOptions[0]} · {dateFor(targetOptions[0])}</strong>
              )}
            </div>
          </div>

          {targetOptions.length > 1 && (workdayOptions.length > 0 || weekendOptions.length > 0) && (
            <div className="copy-panel-quick-select">
              {workdayOptions.length > 0 && (
                <button type="button" className="btn" onClick={() => selectTargetGroup(workdayOptions)}>
                  Alle Werktage
                </button>
              )}
              {weekendOptions.length > 0 && (
                <button type="button" className="btn" onClick={() => selectTargetGroup(weekendOptions)}>
                  Wochenende
                </button>
              )}
              <button type="button" className="btn" onClick={() => setTargetDays(new Set())}>
                Auswahl leeren
              </button>
            </div>
          )}

          {sections && (
            <div className="copy-panel-sections">
              <span className="copy-panel-field-label">Abschnitte</span>
              {sections.map((section) => {
                const sectionStats = computeCopyStats(section.rows, sourceDay, targets);
                return (
                  <label key={section.key} className="copy-panel-section-row">
                    <input
                      type="checkbox"
                      checked={selectedSections.has(section.key)}
                      onChange={() => toggleSection(section.key)}
                    />
                    <span>{section.title}</span>
                    {targets.length > 0 && selectedSections.has(section.key) && sectionStats.toCopy > 0 && (
                      <small>{sectionStats.toCopy} Eintrag/Einträge</small>
                    )}
                  </label>
                );
              })}
            </div>
          )}

          <div className="copy-panel-summary">
            {stats.toCopy > 0 ? (
              <>
                <span>{stats.toCopy} {stats.toCopy === 1 ? "Eintrag wird" : "Einträge werden"} kopiert</span>
                {stats.toOverwrite > 0 && (
                  <span className="is-warning">{stats.toOverwrite} bestehende {stats.toOverwrite === 1 ? "Eintrag wird" : "Einträge werden"} überschrieben</span>
                )}
                {stats.toFill > 0 && <span>{stats.toFill} leere {stats.toFill === 1 ? "Feld wird" : "Felder werden"} ergänzt</span>}
              </>
            ) : (
              <span className="is-muted">
                {sections && selectedSections.size === 0
                  ? "Bitte mindestens einen Abschnitt auswählen."
                  : targets.length === 0
                    ? "Bitte mindestens einen Zieltag auswählen."
                    : "Keine übertragbaren Inhalte in der Auswahl."}
              </span>
            )}
          </div>
        </div>
      }
    />
  );
}
