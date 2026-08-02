import { categoryColor } from "@/lib/categoryColors";

export type PlanRowLike = Record<string, string | null> & {
  Abschnitt: string;
  Zeile: string;
  _row_type: "data" | "group";
  _category: string;
  _group_label: string | null;
  _group_color: string | null;
};

export interface DaySection<TRow extends PlanRowLike = PlanRowLike> {
  key: string;
  title: string;
  color: string;
  isGroup: boolean;
  rows: TRow[];
}

/**
 * Leitet die Tagesplanung-Sektionen direkt aus den vorhandenen Plan-Zeilen ab -
 * keine zweite Datenquelle. Gruppen-Marker-Zeilen (z.B. "Meetings", "Kochdienste")
 * bündeln ihre nachfolgenden Datenzeilen zu einer Sektion; Zeilen außerhalb einer
 * Gruppe (z.B. "Urlaub/Krank", "Frei") bilden jeweils ihre eigene Sektion - exakt
 * dieselbe Struktur, die die Wochenübersicht als Gruppen-Bänder/Einzelzeilen zeigt.
 */
export function buildDaySections<TRow extends PlanRowLike>(rows: TRow[]): DaySection<TRow>[] {
  const sections: DaySection<TRow>[] = [];
  let current: DaySection<TRow> | null = null;

  for (const row of rows) {
    if (row._row_type === "group") {
      current = {
        key: `group::${row._group_label ?? sections.length}`,
        title: row._group_label ?? "",
        color: row._group_color || "#6c7bff",
        isGroup: true,
        rows: [],
      };
      sections.push(current);
      continue;
    }
    if (current) {
      current.rows.push(row);
      continue;
    }
    sections.push({
      key: `row::${row.Abschnitt}::${row.Zeile}`,
      title: row.Abschnitt,
      color: categoryColor(row._category || row.Abschnitt),
      isGroup: false,
      rows: [row],
    });
  }

  return sections.filter((section) => section.rows.length > 0);
}

export function dayFillStats<TRow extends PlanRowLike>(
  section: DaySection<TRow>,
  dayLabel: string,
): { filled: number; total: number } {
  let filled = 0;
  for (const row of section.rows) {
    if ((row[dayLabel] ?? "").trim().length > 0) filled += 1;
  }
  return { filled, total: section.rows.length };
}
