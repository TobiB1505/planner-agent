import type { PlanRowLike } from "@/lib/plan-editor/daySections";

export interface CopyChange<TRow extends PlanRowLike = PlanRowLike> {
  row: TRow;
  dayLabel: string;
  nextValue: string;
}

export interface CopyStats {
  /** Zellen mit Inhalt in der Quelle, die tatsächlich in ein Ziel übertragen werden. */
  toCopy: number;
  /** Davon: Ziel hatte bereits einen abweichenden Inhalt - wird überschrieben. */
  toOverwrite: number;
  /** Davon: Ziel war leer - wird neu ergänzt. */
  toFill: number;
}

/** Werktage (Mo-Fr) bzw. Wochenende (Sa-So) - reine Index-Konvention, die im
 * gesamten Plan-Editor bereits für dayLabels/weekDates gilt (Montag zuerst). */
export function weekdayLabels(dayLabels: string[]): string[] {
  return dayLabels.slice(0, 5);
}

export function weekendLabels(dayLabels: string[]): string[] {
  return dayLabels.slice(5, 7);
}

export function buildCopyChanges<TRow extends PlanRowLike>(
  rows: TRow[],
  sourceDay: string,
  targetDays: string[],
): CopyChange<TRow>[] {
  const changes: CopyChange<TRow>[] = [];
  for (const row of rows) {
    const sourceValue = (row[sourceDay] ?? "").trim();
    if (!sourceValue) continue;
    for (const targetDay of targetDays) {
      if (targetDay === sourceDay) continue;
      changes.push({ row, dayLabel: targetDay, nextValue: sourceValue });
    }
  }
  return changes;
}

export function computeCopyStats<TRow extends PlanRowLike>(
  rows: TRow[],
  sourceDay: string,
  targetDays: string[],
): CopyStats {
  let toCopy = 0;
  let toOverwrite = 0;
  let toFill = 0;
  for (const row of rows) {
    const sourceValue = (row[sourceDay] ?? "").trim();
    if (!sourceValue) continue;
    for (const targetDay of targetDays) {
      if (targetDay === sourceDay) continue;
      const targetValue = (row[targetDay] ?? "").trim();
      if (targetValue === sourceValue) continue;
      toCopy += 1;
      if (targetValue) toOverwrite += 1;
      else toFill += 1;
    }
  }
  return { toCopy, toOverwrite, toFill };
}
