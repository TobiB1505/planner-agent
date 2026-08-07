// Sprint 2 (Phase 12): einzige Stelle, die das heutige Datum als lokales
// ISO-Datum (sv-SE liefert YYYY-MM-DD) ermittelt - vorher riefen
// app/plan-editor/page.tsx (zweimal) und components/plan-editor/
// DayNavigator.tsx dieselbe Berechnung unabhängig voneinander auf. In
// lib/plan-editor/ statt in den routenlokalen planEditorHelpers, damit
// sowohl die Route als auch die (route-übergreifend nutzbare)
// DayNavigator-Komponente sie ohne umgekehrte app/->components/-Abhängigkeit
// importieren können. Rein clientseitig verwendet (Tagesmarkierung nach dem
// Laden echter Plandaten) - kein SSR-Hydration-Pfad betroffen, da
// dayLabels/weekDates beim ersten (Server-)Render immer leer sind.
export function todayIso(): string {
  return new Date().toLocaleDateString("sv-SE");
}
