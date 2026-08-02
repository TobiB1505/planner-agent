"use client";

import type { PlanDensity } from "@/lib/plan-editor/viewPreferences";

const DENSITY_OPTIONS: { value: PlanDensity; label: string }[] = [
  { value: "compact", label: "Kompakt" },
  { value: "standard", label: "Standard" },
  { value: "large", label: "Groß" },
];

export default function EditorViewControls({
  density,
  onDensityChange,
}: {
  density: PlanDensity;
  onDensityChange: (value: PlanDensity) => void;
}) {
  return (
    <div className="plan-view-controls" aria-label="Tabellenansicht">
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
