/**
 * Bestimmt, welche Art von Eingabefeld ein Planzeilen-Eintrag in der
 * Tagesplanung braucht. Spiegelt exakt dieselbe Klassifizierung, die
 * `columnDefs`/`cellEditorSelector` in der Wochenübersicht bereits verwendet
 * (personCategories + ABSENCE_SECTIONS + Softsport-/Gäste-vs-Robins-
 * Sonderfälle) - keine zweite, abweichende Klassifizierung.
 */
export type EntryFieldType =
  | { kind: "people"; minimumPeople: number }
  | { kind: "softsport" }
  | { kind: "text-suggest" }
  | { kind: "text" };

export const KLEIDERMOTTO_CATEGORIES = new Set(["Kleidermotto Tag", "Kleidermotto Abend"]);

export function resolveEntryFieldType({
  category,
  zeile,
  dayLabel,
  dayLabels,
  isPersonSection,
}: {
  category: string;
  zeile: string;
  dayLabel: string;
  dayLabels: string[];
  isPersonSection: (category: string) => boolean;
  isAbsenceSection: (category: string) => boolean;
}): EntryFieldType {
  // isPersonSection ist true für Personen- UND Abwesenheits-Kategorien
  // (dieselbe Prüfung wie im cellEditorSelector der Wochenübersicht) - beide
  // nutzen dort denselben PersonCellEditor mit minimumPeople 1, also gilt
  // hier genau dieselbe Regel statt einer abweichenden Sonderbehandlung.
  if (isPersonSection(category)) {
    if (category === "Sportprogramm" && zeile.includes("Softsport")) {
      return { kind: "softsport" };
    }
    const isGuestsVsRobins =
      category === "Sportprogramm" && zeile === "15:30 BVB" && dayLabels.indexOf(dayLabel) === 4;
    return { kind: "people", minimumPeople: isGuestsVsRobins ? 4 : 1 };
  }
  if (KLEIDERMOTTO_CATEGORIES.has(category)) {
    return { kind: "text-suggest" };
  }
  return { kind: "text" };
}

/** Sammelt bereits verwendete Werte derselben Kategorie über alle Tage - für
 * die Kleidermotto-Vorschläge ("vorhandene Werte wiederverwenden"), rein aus
 * den schon geladenen Planzeilen, keine neue Datenquelle. */
export function collectCategorySuggestions<
  TRow extends { _category: string; Abschnitt: string } & Record<string, string | null>,
>(rows: TRow[], category: string, dayLabels: string[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    if ((row._category || row.Abschnitt) !== category) continue;
    for (const label of dayLabels) {
      const value = (row[label] ?? "").trim();
      if (value) seen.add(value);
    }
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b, "de"));
}
