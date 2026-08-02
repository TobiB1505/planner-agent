import type { PlanIssue } from "@/lib/planValidation";

export interface DayStatus {
  hasErrors: boolean;
  hasWarnings: boolean;
  incomplete: boolean;
  isToday: boolean;
  isDirty: boolean;
}

/**
 * Grundlegende Tages-Statuswerte für die Tagesnavigation - abgeleitet aus der
 * ohnehin laufenden Planprüfung (Sprint 3) statt einer neuen Regel-Engine.
 * "unvollständig" ist bewusst zurückhaltend: nur echte "understaffed"/
 * "empty_required_assignment"-Befunde zählen, keine geratene Vollständigkeit.
 * "ungespeicherte Änderungen" ist aktuell planweit (kein Zellen-Tracking pro
 * Tag) und wird deshalb auf jeden Tag gleich angewendet, solange der Plan
 * insgesamt dirty ist - eine grundlegende, ehrliche Näherung für diesen Schritt.
 */
export function computeDayStatuses(
  dayLabels: string[],
  weekDates: string[],
  issues: PlanIssue[],
  isDirty: boolean,
): Record<string, DayStatus> {
  const todayIso = new Date().toLocaleDateString("sv-SE");
  const result: Record<string, DayStatus> = {};
  dayLabels.forEach((label, index) => {
    const dayIssues = issues.filter((issue) => issue.dayLabel === label);
    result[label] = {
      hasErrors: dayIssues.some((issue) => issue.severity === "error"),
      hasWarnings: dayIssues.some((issue) => issue.severity === "warning"),
      incomplete: dayIssues.some(
        (issue) => issue.category === "understaffed" || issue.category === "empty_required_assignment",
      ),
      isToday: weekDates[index] === todayIso,
      isDirty,
    };
  });
  return result;
}
