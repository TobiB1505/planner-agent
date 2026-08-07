import { describe, expect, it } from "vitest";
import { assignRowIds, mergeGeneratedPersonCell, rowKey } from "./planEditorHelpers";
import type { PlanRow } from "../types";

function makeRow(overrides: Partial<PlanRow>): PlanRow {
  const abschnitt = overrides.Abschnitt ?? "Meeting";
  return {
    Abschnitt: abschnitt,
    Zeile: "",
    _row_type: "data",
    _category: abschnitt,
    _group_label: null,
    _group_color: null,
    _row_id: "",
    ...overrides,
  };
}

describe("assignRowIds", () => {
  it("vergibt jeder Zeile eine _row_id, wenn noch keine gesetzt ist", () => {
    const rows = [makeRow({ Abschnitt: "Meeting", Zeile: "" }), makeRow({ Abschnitt: "Barfrei", Zeile: "" })];
    const result = assignRowIds(rows);
    expect(result[0]._row_id).toBe("Meeting::::0");
    expect(result[1]._row_id).toBe("Barfrei::::0");
  });

  it("unterscheidet zwei inhaltlich identische Zeilen (Sprint 0, C4) über einen Occurrence-Index", () => {
    const rows = [
      makeRow({ Abschnitt: "Kochdienste", Zeile: "KP1 7:50 - 10:00" }),
      makeRow({ Abschnitt: "Kochdienste", Zeile: "KP1 7:50 - 10:00" }),
      makeRow({ Abschnitt: "Kochdienste", Zeile: "KP1 7:50 - 10:00" }),
    ];
    const result = assignRowIds(rows);
    const ids = result.map((row) => row._row_id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual([
      "Kochdienste::KP1 7:50 - 10:00::0",
      "Kochdienste::KP1 7:50 - 10:00::1",
      "Kochdienste::KP1 7:50 - 10:00::2",
    ]);
  });

  it("behält eine bereits vergebene _row_id unverändert bei (keine Neuvergabe bei erneutem Aufruf)", () => {
    const rows = [makeRow({ Abschnitt: "Meeting", Zeile: "", _row_id: "Meeting::::0" })];
    const result = assignRowIds(rows);
    expect(result[0]).toBe(rows[0]);
    expect(result[0]._row_id).toBe("Meeting::::0");
  });

  it("ist deterministisch: gleiche Eingabereihenfolge liefert gleiche IDs (stabil über Neu-Generieren)", () => {
    const build = () => [
      makeRow({ Abschnitt: "Sportprogramm", Zeile: "10:30 Softsport" }),
      makeRow({ Abschnitt: "Sportprogramm", Zeile: "15:30 Softsport" }),
    ];
    const first = assignRowIds(build()).map((row) => row._row_id);
    const second = assignRowIds(build()).map((row) => row._row_id);
    expect(first).toEqual(second);
  });

  it("erzeugt keine IDs auf Basis von Array-Indizes allein, sondern des fachlichen Schlüssels", () => {
    const rows = [makeRow({ Abschnitt: "Barfrei", Zeile: "" }), makeRow({ Abschnitt: "Meeting", Zeile: "" })];
    const result = assignRowIds(rows);
    expect(result[0]._row_id).toContain("Barfrei");
    expect(result[1]._row_id).toContain("Meeting");
  });
});

describe("rowKey", () => {
  it("kombiniert Abschnitt und Zeile für den fachlichen assignmentRules-Lookup", () => {
    expect(rowKey(makeRow({ Abschnitt: "Kochdienste", Zeile: "KP1 7:50 - 10:00" }))).toBe(
      "Kochdienste::KP1 7:50 - 10:00",
    );
  });

  it("nutzt für Gruppenzeilen das Gruppen-Label statt Abschnitt/Zeile", () => {
    expect(rowKey(makeRow({ _row_type: "group", _group_label: "Kochdienste" }))).toBe("group::Kochdienste");
  });
});

describe("mergeGeneratedPersonCell", () => {
  it("übernimmt den generierten Wert unverändert, wenn kein Präfix-Trenner vorhanden ist", () => {
    expect(mergeGeneratedPersonCell("Anna", "Ben")).toBe("Ben");
  });

  it("erhält einen redaktionellen Präfix vor dem letzten '|' und ersetzt nur den Personenanteil", () => {
    expect(mergeGeneratedPersonCell("Boccia | Livia", "Boccia | Anna")).toBe("Boccia | Anna");
  });

  it("behält nur den redaktionellen Präfix, wenn der generierte Personenanteil leer ist", () => {
    // Bewusst kein null/leer: eine Neuverteilung ohne neuen Namen darf den
    // Präfix (z.B. Ortsangabe) nicht mit löschen, siehe Docstring der Quelle.
    expect(mergeGeneratedPersonCell("Boccia | Livia", "Boccia | ")).toBe("Boccia |");
  });
});
