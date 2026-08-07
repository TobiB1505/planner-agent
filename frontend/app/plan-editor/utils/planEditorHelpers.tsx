// AP12: reine Hilfsfunktionen und kleine Präsentations-Komponenten aus
// page.tsx - unverändertes Verhalten, nur ausgelagert.
import type { ExtractedAbsence } from "@/lib/api";
import { categoryColor } from "@/lib/categoryColors";
import { themeQuartz, type ICellRendererParams } from "ag-grid-community";
import type { PlanRow } from "../types";

export const ABSENCE_SECTIONS = new Set(["Urlaub/Krank", "Frei"]);

export const gridTheme = themeQuartz.withParams({
  accentColor: "#6c7bff",
  backgroundColor: "var(--surface)",
  foregroundColor: "var(--foreground)",
  borderColor: "var(--border)",
  headerBackgroundColor: "var(--background)",
  oddRowBackgroundColor: "var(--surface)",
  rowHoverColor: "var(--accent-soft)",
  fontFamily: "var(--font-app)",
  fontSize: 13,
  headerFontSize: 12,
  spacing: 7,
});

export function mondayIso(): string {
  const now = new Date();
  const weekday = now.getDay() || 7;
  // Auf 12 Uhr mittags verankern: toISOString() rechnet in UTC um und würde sonst
  // in den Nachtstunden (bzw. bei positivem UTC-Offset) einen Tag zurückspringen -
  // die Planwoche startete dann auf einem Sonntag statt auf Montag.
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - weekday + 1, 12);
  return monday.toISOString().slice(0, 10);
}

export function addDays(iso: string, amount: number): string {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function isoWeek(iso: string): number {
  const date = new Date(`${iso}T12:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export function templateCodeForDate(iso: string): "A" | "B" {
  return isoWeek(iso) % 2 === 1 ? "A" : "B";
}

export function formatDateRange(startIso: string, endIso: string): string {
  const formatter = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${formatter.format(new Date(`${startIso}T12:00:00`))}–${formatter.format(new Date(`${endIso}T12:00:00`))}`;
}

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("de-DE", { weekday: "long" });
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });

export function weekdayLabelFor(iso?: string): string | undefined {
  if (!iso) return undefined;
  return WEEKDAY_FORMATTER.format(new Date(`${iso}T12:00:00`));
}

export function shortDateLabelFor(iso?: string): string | undefined {
  if (!iso) return undefined;
  // Intl hängt im de-DE-Format bei day+month bereits einen Punkt an ("27.07.").
  return SHORT_DATE_FORMATTER.format(new Date(`${iso}T12:00:00`));
}

/** Löst Uhrzeitangaben aus dem Zeilentext ("KP3 19:00 - 21:15" -> "KP3"), damit der
 *  Popup-Kopfbereich keine Zeit doppelt zeigt (die kommt separat aus serviceInterval). */
export function serviceExtraLabel(zeile: string): string {
  return zeile
    .replace(/\d{1,2}[:.]\d{2}\s*(?:-|–|bis)\s*\d{1,2}[:.]\d{2}/gi, "")
    .replace(/\d{1,2}[:.]\d{2}/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function splitNames(value: string): string[] {
  return value
    .split(/[,;\n]+/)
    .map((part) => part.includes("|") ? part.split("|").at(-1)!.trim() : part.trim())
    .filter(Boolean);
}

/** Bei kombinierten Zellen (z.B. `Boccia | Livia` oder Aperitif mit
 * Ort/Uhrzeit/Künstler) gehört nur der Teil nach dem letzten Trenner zur
 * automatischen MA-Zuweisung. Eine Neuverteilung darf den redaktionellen
 * Präfix nicht nebenbei umformatieren. */
export function mergeGeneratedPersonCell(
  currentValue: string | null | undefined,
  generatedValue: string | null | undefined,
): string | null {
  const current = currentValue ?? "";
  const generated = generatedValue ?? "";
  const currentSeparator = current.lastIndexOf("|");
  const generatedSeparator = generated.lastIndexOf("|");
  if (currentSeparator < 0 || generatedSeparator < 0) return generatedValue ?? null;
  const generatedPeople = generated.slice(generatedSeparator + 1).trim();
  const currentPrefix = current.slice(0, currentSeparator + 1).trimEnd();
  return generatedPeople ? `${currentPrefix} ${generatedPeople}` : currentPrefix;
}

export function collectAbsences(
  rows: PlanRow[],
  dayLabels: string[],
  weekDates: string[],
): ExtractedAbsence[] {
  const absences: ExtractedAbsence[] = [];
  for (const row of rows) {
    if (!ABSENCE_SECTIONS.has(row.Abschnitt)) continue;
    dayLabels.forEach((label, index) => {
      splitNames(row[label] ?? "").forEach((person) => {
        absences.push({ date: weekDates[index], person, type: row.Abschnitt });
      });
    });
  }
  return absences;
}

export function rowCategory(row?: PlanRow): string {
  return row?._category || row?.Abschnitt || "";
}

export function rowColor(row?: PlanRow): string {
  return row?._group_color || categoryColor(rowCategory(row));
}

/** Fachlicher Lookup-Schlüssel für assignmentRules (Backend-Vertrag
 *  `${category}::${slot}`, siehe routers/plans.py) - NICHT für Grid-/
 *  Zeilenidentität verwenden, dafür gibt es row._row_id (assignRowIds). */
export function rowKey(row: PlanRow): string {
  if (row._row_type === "group") return `group::${row._group_label}`;
  return `${rowCategory(row)}::${row.Zeile}`;
}

/** Sprint 0 (S1-Fix, C4): vergibt jeder Zeile eine stabile, eindeutige
 *  technische ID. rowKey() allein (Kategorie::Zeile) ist nicht eindeutig -
 *  zwei Zeilen mit identischem Text kollidieren dort und dadurch auch in
 *  AG-Grid-getRowId, manuell-bearbeitet-Markierung und Planprüfung.
 *
 *  Deterministisch und ordnungsabhängig (nicht zufällig): die n-te Zeile mit
 *  einem bestimmten rowKey bekommt immer denselben `${rowKey}::${n}`-Suffix,
 *  solange sich die Reihenfolge/Zusammensetzung des Wochenrasters nicht
 *  ändert. Das hält bestehende IDs über Neu-Generieren/Neuladen stabil
 *  (dieselbe Vorlage → dieselbe Zeilenreihenfolge), ohne dass diese Funktion
 *  den alten Zeilenbestand kennen muss. Bereits vorhandene _row_id-Werte
 *  (z.B. aus einer laufenden Bearbeitung) werden beibehalten, nicht neu
 *  vergeben - nur wirklich neue/noch nicht normalisierte Zeilen erhalten
 *  eine frische ID. */
export function assignRowIds(rows: PlanRow[]): PlanRow[] {
  const occurrences = new Map<string, number>();
  return rows.map((row) => {
    const base = rowKey(row);
    const index = occurrences.get(base) ?? 0;
    occurrences.set(base, index + 1);
    if (row._row_id) return row;
    return { ...row, _row_id: `${base}::${index}` };
  });
}

export function GroupHeaderRenderer({ data }: ICellRendererParams<PlanRow>) {
  const color = data?._group_color || "#6c7bff";
  // Sprint 3 (Ent-Excelung, Phase 4.4): Abschnittsköpfe sind keine
  // durchgehenden Farbbänder mehr, sondern ruhige Trennzeilen mit
  // Kategorie-Punkt + Label - die Kategoriefarbe bleibt als Punkt und
  // linker Kante erkennbar, dominiert aber nicht mehr die Fläche.
  return (
    <div
      className="plan-group-row flex h-full w-full items-center gap-2 px-3 text-left"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <span
        aria-hidden="true"
        className="plan-group-dot"
        style={{ backgroundColor: color }}
      />
      {data?._group_label}
    </div>
  );
}

export function PlanEditorInitialLoading({ startDate }: { startDate: string }) {
  return (
    <div className="plan-editor-initial-loading" role="status" aria-live="polite">
      <section className="panel plan-editor-loading-summary">
        <div className="plan-editor-loading-copy">
          <span>Aktiver Dienstplan</span>
          <strong>KW {isoWeek(startDate)} wird geöffnet</strong>
          <small>
            {formatDateRange(startDate, addDays(startDate, 6))} · Gespeicherte Planung wird wiederhergestellt
          </small>
        </div>
        <div className="plan-editor-loading-indicator">
          <span className="spinner" aria-hidden="true" />
          Plan wird geladen
        </div>
      </section>

      <div className="plan-editor-loading-toolbar" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>

      <section className="panel plan-editor-loading-grid" aria-hidden="true">
        <div className="plan-editor-loading-grid-head">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
        {Array.from({ length: 9 }, (_, index) => (
          <div className="plan-editor-loading-grid-row" key={index}>
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        ))}
      </section>
    </div>
  );
}
