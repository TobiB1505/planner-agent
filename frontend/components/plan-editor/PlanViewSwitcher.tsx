"use client";

import type { PlanEditorViewMode } from "@/lib/plan-editor/viewPreferences";

const MODES: { mode: PlanEditorViewMode; label: string; hint: string }[] = [
  { mode: "week", label: "Wochenübersicht", hint: "Alle Tage als Tabelle" },
  { mode: "day", label: "Tagesplanung", hint: "Ein Tag im Detail" },
];

export default function PlanViewSwitcher({
  mode,
  onChange,
}: {
  mode: PlanEditorViewMode;
  onChange: (mode: PlanEditorViewMode) => void;
}) {
  return (
    <nav className="plan-view-switcher" aria-label="Editor-Ansicht wählen">
      {MODES.map((entry) => (
        <button
          key={entry.mode}
          type="button"
          className={mode === entry.mode ? "is-active" : ""}
          aria-pressed={mode === entry.mode}
          onClick={() => onChange(entry.mode)}
        >
          <strong>{entry.label}</strong>
          <small>{entry.hint}</small>
        </button>
      ))}
    </nav>
  );
}
