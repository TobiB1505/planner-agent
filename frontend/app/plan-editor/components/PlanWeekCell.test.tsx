import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PlanWeekCellRenderer, type PlanWeekCellParams } from "./PlanWeekCell";
import type { PlanRow } from "../types";

/**
 * Regressionstest für den Merge-Konflikt-Fix (Sprint "post-5"): eine
 * andere Session hatte die Chip-Farbe versehentlich von row._group_color
 * (Backend, echte Excel-A:H-Bandfarbe aus template_spec.LAYOUT_GROUPS,
 * bereits für Abschnitt-Spalte/Gruppenkopf verwendet) auf
 * categoryColor(_category) umgestellt - eine kleinere, andere Palette aus
 * lib/categoryColors.ts, die viele Kategorien gar nicht kennt (Zufallsfarbe)
 * und bei den übrigen andere Werte liefert als die Gruppenfarbe. Dieser
 * Test belegt, dass der Chip wieder row._group_color folgt.
 */
function makeRow(overrides: Partial<PlanRow>): PlanRow {
  return {
    Abschnitt: "Ausschlafen",
    Zeile: "",
    _row_type: "data",
    _category: "Ausschlafen",
    _group_label: "Abend-Entertainment",
    _group_color: "#95CA82",
    _row_id: "row-1",
    ...overrides,
  };
}

function makeParams(row: PlanRow, value: string): PlanWeekCellParams {
  return {
    value,
    data: row,
    isPersonSection: () => true,
    isAbsenceSection: () => false,
  } as unknown as PlanWeekCellParams;
}

describe("PlanWeekCellRenderer – Kategoriefarbe", () => {
  it("färbt den Chip mit row._group_color, nicht mit der abweichenden lib/categoryColors-Palette", () => {
    // "Ausschlafen" liegt in categoryColors.ts auf #6b6b6b (Grau) - die
    // Gruppe "Abend-Entertainment" (Backend, LAYOUT_GROUPS) ist aber grün
    // (#95CA82), identisch zur Abschnitt-Spalte/zum Gruppenkopf dieser
    // Zeile. Der Chip muss die Gruppenfarbe zeigen, nicht die Zufalls-/
    // Fehlfarbe der kleineren Palette.
    const row = makeRow({ _category: "Ausschlafen", _group_color: "#95CA82" });
    const { container } = render(<PlanWeekCellRenderer {...makeParams(row, "Anna Müller")} />);
    const chip = container.querySelector(".plan-person-chip");
    expect(chip).not.toBeNull();
    const style = (chip as HTMLElement).style;
    expect(style.backgroundColor).toBe("rgba(149, 202, 130, 0.12)");
    expect(style.borderColor).toBe("rgba(149, 202, 130, 0.32)");
  });

  it("nutzt categoryColor() nur als Rückfallebene, wenn _group_color fehlt", () => {
    const row = makeRow({ _category: "Sportprogramm", _group_color: null });
    const { container } = render(<PlanWeekCellRenderer {...makeParams(row, "Ben Schmidt")} />);
    const chip = container.querySelector(".plan-person-chip") as HTMLElement;
    // "Sportprogramm" ist sowohl in categoryColors.ts als auch als
    // LAYOUT_GROUPS-Farbe #00b0f0 hinterlegt - ohne _group_color muss die
    // Rückfallebene trotzdem eine sinnvolle, nicht zufällige Farbe liefern.
    expect(chip.style.backgroundColor).toBe("rgba(0, 176, 240, 0.12)");
  });

  it("lässt Abwesenheits-Chips ungefärbt (Status bleibt dominant)", () => {
    const row = makeRow({ _category: "Frei", Abschnitt: "Frei", _group_color: "#fef4c8" });
    const params = { ...makeParams(row, "Clara Fischer"), isAbsenceSection: () => true } as PlanWeekCellParams;
    const { container } = render(<PlanWeekCellRenderer {...params} />);
    const chip = container.querySelector(".plan-person-chip") as HTMLElement;
    expect(chip.style.backgroundColor).toBe("");
    expect(chip.style.borderColor).toBe("");
  });
});
