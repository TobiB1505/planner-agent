"use client";

import PersonCellEditor from "@/components/PersonCellEditor";
import SoftsportCellEditor from "@/components/SoftsportCellEditor";
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
  const [draftText, setDraftText] = useState(fieldType.kind === "text" || fieldType.kind === "text-suggest" ? value : "");

  useEffect(() => {
    if (fieldType.kind === "text" || fieldType.kind === "text-suggest") return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [fieldType.kind, onCancel]);

  function submit() {
    onCommit(draftText.trim());
  }

  // Personen-Zuweisung (Softsport eingeschlossen) nutzt genau dasselbe Modul
  // wie die Wochenübersicht (PersonCellEditor/SoftsportCellEditor) statt einer
  // zweiten, eigenen Chip-Oberfläche - ein einziger, bekannter "MA
  // hinzufügen"-Baustein für beide Ansichten. `onValueChange` wird nur beim
  // "Übernehmen" aufgerufen, `stopEditing` sowohl beim Übernehmen (danach)
  // als auch beim Abbrechen/Escape - in beiden Fällen genügt es, den
  // Tagesplanung-Eintrag zu schließen.
  if (fieldType.kind === "people") {
    // PersonCellEditor ist als AG-Grid-CustomCellEditor typisiert (CustomCellEditorProps
    // mit vielen grid-internen Feldern wie column/node/api). Hier läuft es außerhalb
    // eines Grids - nur value/onValueChange/stopEditing werden tatsächlich benötigt
    // (siehe Komponente), der Rest wird nie gelesen. Cast statt Attrappen-Objekt.
    const props = {
      value,
      onValueChange: (nextValue: string | null | undefined) => onCommit(nextValue ?? ""),
      stopEditing: onCancel,
      people,
      candidates,
      minimumPeople: fieldType.minimumPeople,
      serviceName: ariaLabelBase,
    } as unknown as Parameters<typeof PersonCellEditor>[0];
    return <PersonCellEditor {...props} />;
  }

  if (fieldType.kind === "softsport") {
    const props = {
      value,
      onValueChange: (nextValue: string | null | undefined) => onCommit(nextValue ?? ""),
      stopEditing: onCancel,
      people,
      candidates,
    } as unknown as Parameters<typeof SoftsportCellEditor>[0];
    return <SoftsportCellEditor {...props} />;
  }

  return (
    <div className="day-entry-editor" role="group" aria-label={`${ariaLabelBase} bearbeiten`}>
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

      <div className="day-entry-actions">
        <button type="button" className="btn day-entry-clear" onClick={() => setDraftText("")}>
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
