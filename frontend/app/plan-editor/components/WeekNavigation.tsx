// AP12 (Schritt 6): der Wochennavigations-Block stand vorher zweimal fast
// identisch in page.tsx (Zusammenfassungs-Kopf vs. Wizard-Kopf) - hier
// zusammengeführt, nur das WeekPicker-Label unterscheidet sich zwischen den
// beiden Aufrufstellen. Pixelidentisch zum Original.
import WeekPicker from "@/components/WeekPicker";

export interface WeekNavigationProps {
  startDate: string;
  weekPickerLabel: string;
  onChange: (nextDate: string) => void;
  addDays: (iso: string, amount: number) => string;
}

export default function WeekNavigation({
  startDate,
  weekPickerLabel,
  onChange,
  addDays,
}: WeekNavigationProps) {
  return (
    <div className="plan-editor-week-nav" aria-label="Planwoche wechseln">
      <button
        type="button"
        className="btn btn-icon plan-editor-week-arrow"
        onClick={() => onChange(addDays(startDate, -7))}
        aria-label="Vorherige Woche"
        title="Vorherige Woche"
      >
        ‹
      </button>
      <WeekPicker
        className="planner-week-picker plan-editor-summary-week-picker"
        label={weekPickerLabel}
        value={startDate}
        onChange={onChange}
      />
      <button
        type="button"
        className="btn btn-icon plan-editor-week-arrow"
        onClick={() => onChange(addDays(startDate, 7))}
        aria-label="Nächste Woche"
        title="Nächste Woche"
      >
        ›
      </button>
    </div>
  );
}
