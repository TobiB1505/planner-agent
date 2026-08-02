"use client";

import { composeCell, parseCell } from "@/components/PersonCellEditor";
import PeopleChipsField from "@/components/plan-editor/PeopleChipsField";
import { composeValue, parseValue, SOFTSPORT_OPTIONS } from "@/components/SoftsportCellEditor";
import type { EntryFieldType } from "@/lib/plan-editor/entryFieldType";
import type { CandidateInfo } from "@/lib/recommendations";
import { useEffect, useRef, useState } from "react";

function AutoResizeTextarea({
  value,
  onChange,
  onSubmit,
  ariaLabel,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  ariaLabel: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      className="day-entry-textarea"
      value={value}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      rows={2}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        // Enter bleibt Zeilenumbruch (mehrzeiliges Feld); nur Cmd/Ctrl+Enter übernimmt,
        // analog zum bestehenden Kurzbefehl in PersonCellEditor.
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          onSubmit();
        }
      }}
    />
  );
}

export default function DayEntryEditor({
  fieldType,
  value,
  people,
  candidates = [],
  suggestions = [],
  ariaLabelBase,
  onCommit,
  onCancel,
}: {
  fieldType: EntryFieldType;
  value: string;
  people: string[];
  candidates?: CandidateInfo[];
  suggestions?: string[];
  ariaLabelBase: string;
  onCommit: (nextValue: string) => void;
  onCancel: () => void;
}) {
  const parsedPerson = fieldType.kind === "people" ? parseCell(value) : null;
  const parsedSoftsport = fieldType.kind === "softsport" ? parseValue(value) : null;

  const [draftPrefix, setDraftPrefix] = useState(parsedPerson?.prefix ?? "");
  const [draftNames, setDraftNames] = useState<string[]>(parsedPerson?.names ?? parsedSoftsport?.names ?? []);
  const [draftActivity, setDraftActivity] = useState(parsedSoftsport?.activity ?? "");
  const [draftText, setDraftText] = useState(fieldType.kind === "text" || fieldType.kind === "text-suggest" ? value : "");
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onCancel]);

  function submit() {
    if (fieldType.kind === "people") {
      if (draftNames.length < fieldType.minimumPeople) {
        setError(`Bitte mindestens ${fieldType.minimumPeople} Mitarbeiter auswählen.`);
        return;
      }
      onCommit(composeCell(draftPrefix.trim(), draftNames));
      return;
    }
    if (fieldType.kind === "softsport") {
      const isEmpty = !draftActivity && draftNames.length === 0;
      if (!isEmpty && (!draftActivity || draftNames.length === 0)) {
        setError("Bitte Softsport-Art und mindestens einen Mitarbeiter auswählen.");
        return;
      }
      onCommit(composeValue(draftActivity, draftNames));
      return;
    }
    onCommit(draftText.trim());
  }

  function clearAll() {
    setDraftNames([]);
    setDraftPrefix("");
    setDraftActivity("");
    setDraftText("");
  }

  return (
    <div ref={rootRef} className="day-entry-editor" role="group" aria-label={`${ariaLabelBase} bearbeiten`}>
      {fieldType.kind === "people" && (
        <>
          <label className="day-entry-field">
            <span>Zusatzinfo (Ort, Uhrzeit, Künstler o. ä.)</span>
            <input
              type="text"
              value={draftPrefix}
              onChange={(event) => setDraftPrefix(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <label className="day-entry-field">
            <span>{fieldType.minimumPeople > 1 ? `Mitarbeiter (mind. ${fieldType.minimumPeople})` : "Mitarbeiter"}</span>
            <PeopleChipsField
              value={draftNames}
              onChange={setDraftNames}
              people={people}
              candidates={candidates}
              ariaLabel={`Mitarbeiter für ${ariaLabelBase}`}
              autoFocus
              onSubmitRequest={submit}
            />
          </label>
        </>
      )}

      {fieldType.kind === "softsport" && (
        <>
          <label className="day-entry-field">
            <span>Softsport-Art</span>
            <select value={draftActivity} onChange={(event) => setDraftActivity(event.target.value)}>
              <option value="">Art auswählen …</option>
              {(draftActivity && !SOFTSPORT_OPTIONS.includes(draftActivity)
                ? [draftActivity, ...SOFTSPORT_OPTIONS]
                : SOFTSPORT_OPTIONS
              ).map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="day-entry-field">
            <span>Mitarbeiter</span>
            <PeopleChipsField
              value={draftNames}
              onChange={setDraftNames}
              people={people}
              candidates={candidates}
              ariaLabel={`Mitarbeiter für ${ariaLabelBase}`}
              onSubmitRequest={submit}
            />
          </label>
        </>
      )}

      {fieldType.kind === "text-suggest" && (
        <label className="day-entry-field">
          <span>{ariaLabelBase}</span>
          <input
            type="text"
            list={`day-entry-suggestions-${ariaLabelBase}`}
            value={draftText}
            autoFocus
            onChange={(event) => setDraftText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
          />
          <datalist id={`day-entry-suggestions-${ariaLabelBase}`}>
            {suggestions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </label>
      )}

      {fieldType.kind === "text" && (
        <label className="day-entry-field">
          <span>{ariaLabelBase}</span>
          <AutoResizeTextarea value={draftText} onChange={setDraftText} onSubmit={submit} ariaLabel={ariaLabelBase} autoFocus />
        </label>
      )}

      {error && <div className="day-entry-error">{error}</div>}

      <div className="day-entry-actions">
        <button type="button" className="btn day-entry-clear" onClick={clearAll}>
          Inhalt leeren
        </button>
        <div className="day-entry-actions-primary">
          <button type="button" className="btn" onClick={onCancel}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={submit}>
            Übernehmen
          </button>
        </div>
      </div>
    </div>
  );
}
