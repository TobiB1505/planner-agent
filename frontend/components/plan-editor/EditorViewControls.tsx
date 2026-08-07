"use client";

import SegmentedControl from "@/components/ui/SegmentedControl";
import type { PlanDensity, PlanEditorViewMode } from "@/lib/plan-editor/viewPreferences";

const DENSITY_OPTIONS: { value: PlanDensity; label: string }[] = [
  { value: "compact", label: "Kompakt" },
  { value: "standard", label: "Standard" },
  { value: "large", label: "Komfortabel" },
];

const VIEW_OPTIONS: { value: PlanEditorViewMode; label: string }[] = [
  { value: "week", label: "Woche" },
  { value: "day", label: "Tag" },
];

/**
 * Ansicht-Gruppe der Editor-Toolbar (Sprint 3): Wochen-/Tagesumschalter als
 * SegmentedControl aus Sprint 1 (ersetzt den früheren Zwei-Karten-
 * PlanViewSwitcher, der eine eigene ~70px-Layoutzeile zwischen Toolbar und
 * Grid belegte) plus Dichte-Auswahl. Reine Anzeigepräferenzen - machen den
 * Plan nie dirty.
 */
export default function EditorViewControls({
  viewMode,
  onViewModeChange,
  density,
  onDensityChange,
}: {
  viewMode: PlanEditorViewMode;
  onViewModeChange: (mode: PlanEditorViewMode) => void;
  density: PlanDensity;
  onDensityChange: (value: PlanDensity) => void;
}) {
  return (
    <div className="plan-view-controls" aria-label="Ansicht und Dichte">
      <SegmentedControl
        label="Editor-Ansicht wählen"
        options={VIEW_OPTIONS}
        value={viewMode}
        onChange={onViewModeChange}
      />
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
