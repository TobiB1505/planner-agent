// Sprint 3 (Phase 5.2/6): Anzeige-Renderer für Tageszellen der
// Wochenübersicht. Personenzellen zeigen ihre Namen als kompakte Chips mit
// kontrolliertem Überlauf ("+n") statt einer abgeschnittenen Textwüste -
// wer eingeteilt ist, bleibt ab der ersten Sekunde erfassbar. Reine
// Anzeige: der Zellwert, der Editor (PersonCellEditor) und damit
// Undo/Redo/Speichern/Export bleiben unverändert; der "+n"-Indikator
// braucht keinen eigenen Klick-Handler, weil bereits ein Einzelklick auf
// die Zelle den vollständigen Editor öffnet.
//
// Nutzt bewusst parseCell aus dem PersonCellEditor - dieselbe Logik, die
// auch der Editor zum Lesen der Zelle verwendet (Zeilen-, Pipe- und
// Komma-Trenner, mehrzeilige Präfixe wie beim Aperitif). Keine zweite,
// abweichende Namens-Parserei.
import type { CSSProperties } from "react";
import type { ICellRendererParams } from "ag-grid-community";
import { parseCell } from "@/components/PersonCellEditor";
import { hexToRgba } from "@/lib/categoryColors";
import type { PlanRow } from "../types";
import { rowCategory, rowColor } from "../utils/planEditorHelpers";

/** Mehr als zwei Chips passen bei üblichen Spaltenbreiten (~94-180px) nie in
 * eine Zeile. Bei genau zwei Personen werden beide gezeigt; ab drei Personen
 * ein lesbarer Chip + "+n" - zwei per Ellipsis zerquetschte Namen ("G…",
 * "Han…") wären schlechter erfassbar als einer plus Anzahl. Der volle Inhalt
 * bleibt über Zell-Tooltip, Chip-title und den Editor erreichbar. */
const MAX_VISIBLE_CHIPS = 2;

function visibleChipCount(totalNames: number): number {
  return totalNames <= MAX_VISIBLE_CHIPS ? totalNames : 1;
}

export type PlanWeekCellParams = ICellRendererParams<PlanRow> & {
  isPersonSection?: (category: string) => boolean;
  isAbsenceSection?: (category: string) => boolean;
};

/** Kontrollierte Namenskürzung (Phase 6, "Lange Namen kontrolliert kürzen"):
 * eine einzelne Person zeigt ihren vollen Namen; sobald mehrere Chips um den
 * Platz konkurrieren, zeigt jeder Chip den Vornamen - lesbar statt zweier
 * per Ellipsis auf "Gr…"/"Ha…" gestutzter Vollnamen. Teilen sich zwei
 * sichtbare Personen den Vornamen, disambiguiert die Nachnamen-Initiale.
 * Der volle Name bleibt über Chip-title, Zell-Tooltip und Editor erreichbar. */
function chipLabel(name: string, visible: string[], totalNames: number): string {
  if (totalNames <= 1) return name;
  const parts = name.split(/\s+/);
  const firstName = parts[0] ?? name;
  const sharesFirstName = visible.some(
    (other) => other !== name && other.split(/\s+/)[0]?.toLocaleLowerCase("de") === firstName.toLocaleLowerCase("de"),
  );
  if (sharesFirstName && parts.length > 1) {
    return `${firstName} ${parts[parts.length - 1][0]}.`;
  }
  return firstName;
}

export function PlanWeekCellRenderer(params: PlanWeekCellParams) {
  const raw = typeof params.value === "string" ? params.value.trim() : "";
  if (!raw) return null;

  const data = params.data;
  const category = data ? rowCategory(data) : "";
  const isPerson = Boolean(data && data._row_type !== "group" && params.isPersonSection?.(category));

  // Nicht-Personen-Zellen (Meetings, Kleidermottos, Specials, ...) bleiben
  // Text - dort ist der Inhalt redaktionell, keine Namensliste.
  if (!isPerson) return <span className="plan-cell-text">{raw}</span>;

  const { prefix, names } = parseCell(raw);
  if (names.length === 0) return <span className="plan-cell-text">{raw}</span>;

  const isAbsence = Boolean(params.isAbsenceSection?.(category));
  const visible = names.slice(0, visibleChipCount(names.length));
  const overflow = names.length - visible.length;
  const flatPrefix = prefix.replace(/\n+/g, " · ");

  // Visual Polish (Post-Sprint-5, AP2) + Korrektur: Kategoriefarbe als
  // dezente Chip-Tönung - Farbe kennzeichnet die Kategorie der Zuweisung,
  // nicht die Person (kein dauerhaftes Personen-Farbschema). Einmal pro
  // Zelle berechnet und für alle sichtbaren Chips derselben Zelle geteilt
  // (nicht pro Chip neu), um unnötige Objektallokationen zu vermeiden.
  // Abwesenheits-Zeilen behalten ihre eigene gestrichelte
  // Statusdarstellung und bekommen keine zusätzliche Kategorietönung
  // (Status muss dominant bleiben).
  //
  // WICHTIG: rowColor() statt categoryColor(category) direkt - Letzteres
  // nutzt lib/categoryColors.ts (eine kleinere, andere Palette mit
  // Zufallsfarben-Fallback für nicht gelistete Kategorien) und würde damit
  // von der Gruppenfarbe abweichen, die die Abschnitt-Spalte und der
  // Gruppenkopf für dieselbe Zeile bereits zeigen (row._group_color, aus
  // den echten Excel-A:H-Bandfarben in backend/template_spec.py
  // LAYOUT_GROUPS). rowColor() bevorzugt _group_color und fällt nur ohne
  // Backend-Wert auf categoryColor() zurück - siehe planEditorHelpers.tsx.
  const chipStyle: CSSProperties | undefined = isAbsence
    ? undefined
    : (() => {
        const color = rowColor(data);
        return {
          backgroundColor: hexToRgba(color, 0.12),
          borderColor: hexToRgba(color, 0.32),
        };
      })();

  return (
    <span className={`plan-cell-people${isAbsence ? " is-absence" : ""}`}>
      {flatPrefix && (
        <span className="plan-cell-prefix" title={flatPrefix}>
          {flatPrefix}
        </span>
      )}
      {visible.map((name) => (
        <span key={name} className="plan-person-chip" style={chipStyle} title={name}>
          {chipLabel(name, visible, names.length)}
        </span>
      ))}
      {overflow > 0 && (
        <span
          className="plan-person-chip plan-person-chip-more"
          title={`${names.length} Personen: ${names.join(", ")}`}
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}
