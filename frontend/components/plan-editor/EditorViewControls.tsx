"use client";

import type { PlanDensity, PlanViewMode } from "@/lib/plan-editor/viewPreferences";

const VIEW_OPTIONS: { value: PlanViewMode; label: string; hint: string }[] = [
  { value: "week", label: "Wochenübersicht", hint: "Alle sieben Tage auf einen Blick" },
  { value: "detail", label: "Detailansicht", hint: "Zuweisungen aktiv bearbeiten" },
];

const DENSITY_OPTIONS: { value: PlanDensity; label: string }[] = [
  { value: "compact", label: "Kompakt" },
  { value: "standard", label: "Standard" },
  { value: "large", label: "Groß" },
];

export default function EditorViewControls({
  viewMode,
  density,
  onViewModeChange,
  onDensityChange,
}: {
  viewMode: PlanViewMode;
  density: PlanDensity;
  onViewModeChange: (value: PlanViewMode) => void;
  onDensityChange: (value: PlanDensity) => void;
}) {
  return (
    <div className="plan-view-controls" aria-label="Tabellenansicht">
      <div className="plan-view-segmented" role="group" aria-label="Ansichtsmodus">
        {VIEW_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={viewMode === option.value ? "is-active" : ""}
            aria-pressed={viewMode === option.value}
            title={option.hint}
            onClick={() => onViewModeChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <label className="plan-density-select">
        <span>Dichte</span>
        <select value={density} onChange={(event) => onDensityChange(event.target.value as PlanDensity)}>
          {DENSITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

