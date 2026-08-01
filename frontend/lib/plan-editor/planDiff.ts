export interface DiffablePlanRow extends Record<string, string | null | undefined> {
  Abschnitt: string;
  Zeile: string;
  _row_type?: string;
  _category?: string;
  _group_label?: string | null;
}

export type PlanChangeKind = "added" | "changed" | "removed";

export interface PlanCellChange {
  id: string;
  kind: PlanChangeKind;
  dayLabel: string;
  section: string;
  rowLabel: string;
  before: string;
  after: string;
}

export interface PlanDiff {
  changes: PlanCellChange[];
  added: number;
  changed: number;
  removed: number;
}

function planRowKey(row: DiffablePlanRow): string {
  const category = row._category || row.Abschnitt;
  if (row._row_type === "group") return `group::${row._group_label ?? category}`;
  return `${category}::${row.Zeile}`;
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function diffPlanRows(
  beforeRows: DiffablePlanRow[],
  afterRows: DiffablePlanRow[],
  dayLabels: string[],
): PlanDiff {
  const beforeByKey = new Map(beforeRows.map((row) => [planRowKey(row), row]));
  const afterByKey = new Map(afterRows.map((row) => [planRowKey(row), row]));
  const rowKeys = new Set([...beforeByKey.keys(), ...afterByKey.keys()]);
  const changes: PlanCellChange[] = [];
  const dayOrder = new Map(dayLabels.map((label, index) => [label, index]));

  for (const key of rowKeys) {
    const beforeRow = beforeByKey.get(key);
    const afterRow = afterByKey.get(key);
    const row = afterRow ?? beforeRow;
    if (!row || row._row_type === "group") continue;

    for (const dayLabel of dayLabels) {
      const before = clean(beforeRow?.[dayLabel]);
      const after = clean(afterRow?.[dayLabel]);
      if (before === after) continue;
      const kind: PlanChangeKind = !before ? "added" : !after ? "removed" : "changed";
      changes.push({
        id: `${key}::${dayLabel}`,
        kind,
        dayLabel,
        section: row._category || row.Abschnitt,
        rowLabel: row.Zeile,
        before,
        after,
      });
    }
  }

  changes.sort((a, b) =>
    (dayOrder.get(a.dayLabel) ?? dayLabels.length) -
      (dayOrder.get(b.dayLabel) ?? dayLabels.length) ||
    a.section.localeCompare(b.section, "de") ||
    a.rowLabel.localeCompare(b.rowLabel, "de"),
  );

  return {
    changes,
    added: changes.filter((change) => change.kind === "added").length,
    changed: changes.filter((change) => change.kind === "changed").length,
    removed: changes.filter((change) => change.kind === "removed").length,
  };
}
