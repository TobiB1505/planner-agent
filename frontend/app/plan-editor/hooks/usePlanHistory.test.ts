// Regressionstest für die in Sprint 2 gefundene und behobene Undo/Redo-
// Instabilität (siehe Commit "fix(editor): stabilize AG-Grid props to fix
// broken undo/redo"): die eigentliche Ursache lag in instabilen PlanGrid-
// Props, die AG Grids internen undoRedoCellEditing-Stack invalidierten -
// dieser Test kann das nicht abdecken (kein echtes AG Grid vorhanden),
// deckt aber die davon unabhängige, mindestens ebenso fehleranfällige
// Chronologie-Logik ab, die Grid-Bearbeitungen und Tagesansicht-/Kopier-
// Aktionen (eigener Undo-Stack) in der richtigen Reihenfolge zusammenführt.
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePlanHistory } from "./usePlanHistory";
import type { PlanRow } from "../types";

function makeRow(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    Abschnitt: "Meeting",
    Zeile: "",
    _row_type: "data",
    _category: "Meeting",
    _group_label: null,
    _group_color: null,
    _row_id: "Meeting::::0",
    Montag: null,
    Dienstag: null,
    ...overrides,
  };
}

/** Minimale GridApi-Simulation: bildet nur nach, was usePlanHistory tatsächlich
 * aufruft (getCurrentUndoSize/getCurrentRedoSize/undoCellEditing/
 * redoCellEditing/refreshCells/getRowNode) - kein echtes AG Grid. */
function createMockGridApi() {
  type Entry = { row: PlanRow; field: string; prev: string | null; next: string | null };
  const undoStack: Entry[] = [];
  const redoStack: Entry[] = [];
  let handlers: ReturnType<typeof usePlanHistory>["gridEventHandlers"] | null = null;

  const refreshCells = vi.fn();

  const api = {
    getCurrentUndoSize: () => undoStack.length,
    getCurrentRedoSize: () => redoStack.length,
    getRowNode: (id: string) => ({ id }),
    refreshCells,
    undoCellEditing: () => {
      handlers!.onUndoStarted();
      const entry = undoStack.pop();
      let operationPerformed = false;
      if (entry) {
        const oldValue = entry.row[entry.field];
        entry.row[entry.field] = entry.prev;
        redoStack.push(entry);
        operationPerformed = true;
        handlers!.onCellValueChanged({
          oldValue,
          newValue: entry.prev,
          colDef: { field: entry.field },
          data: entry.row,
          api,
          node: { id: entry.row._row_id },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
      }
      handlers!.onUndoEnded({ operationPerformed });
    },
    redoCellEditing: () => {
      handlers!.onRedoStarted();
      const entry = redoStack.pop();
      let operationPerformed = false;
      if (entry) {
        const oldValue = entry.row[entry.field];
        entry.row[entry.field] = entry.next;
        undoStack.push(entry);
        operationPerformed = true;
        handlers!.onCellValueChanged({
          oldValue,
          newValue: entry.next,
          colDef: { field: entry.field },
          data: entry.row,
          api,
          node: { id: entry.row._row_id },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
      }
      handlers!.onRedoEnded({ operationPerformed });
    },
  };

  /** Simuliert eine direkte Grid-Zellbearbeitung (Tippen in der
   * Wochenübersicht) - AG Grid selbst hätte hier bereits einen Eintrag in
   * seinen internen Undo-Stack gelegt UND cellValueChanged gefeuert. */
  function simulateGridEdit(row: PlanRow, field: string, nextValue: string) {
    const prev = row[field];
    undoStack.push({ row, field, prev, next: nextValue });
    redoStack.length = 0;
    row[field] = nextValue;
    handlers!.onCellValueChanged({
      oldValue: prev,
      newValue: nextValue,
      colDef: { field },
      data: row,
      api,
      node: { id: row._row_id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    gridApiRef: { current: api as any },
    refreshCells,
    simulateGridEdit,
    setHandlers: (h: ReturnType<typeof usePlanHistory>["gridEventHandlers"]) => {
      handlers = h;
    },
  };
}

function setup() {
  const mock = createMockGridApi();
  const onMarkDirty = vi.fn();
  const onRecordAudit = vi.fn();
  const onMarkManuallyEdited = vi.fn();
  const { result } = renderHook(() =>
    usePlanHistory({
      gridApiRef: mock.gridApiRef,
      onMarkDirty,
      onRecordAudit,
      onMarkManuallyEdited,
    }),
  );
  mock.setHandlers(result.current.gridEventHandlers);
  return { result, mock, onMarkDirty };
}

describe("usePlanHistory", () => {
  it("bündelt mehrere Zelländerungen einer Tagesansicht-Aktion zu einem Undo-Schritt", () => {
    const { result, mock } = setup();
    const row1 = makeRow({ _row_id: "A::::0" });
    const row2 = makeRow({ _row_id: "B::::0" });

    act(() => {
      result.current.applyPlanChanges(
        [
          { row: row1, dayLabel: "Montag", nextValue: "Anna" },
          { row: row2, dayLabel: "Montag", nextValue: "Ben" },
        ],
        "copy_previous_day",
      );
    });

    expect(row1.Montag).toBe("Anna");
    expect(row2.Montag).toBe("Ben");
    expect(result.current.gridHistory.canUndo).toBe(true);
    expect(result.current.gridHistory.canRedo).toBe(false);

    act(() => result.current.handleUndo());
    expect(row1.Montag).toBeNull();
    expect(row2.Montag).toBeNull();
    expect(result.current.gridHistory.canUndo).toBe(false);
    expect(result.current.gridHistory.canRedo).toBe(true);

    act(() => result.current.handleRedo());
    expect(row1.Montag).toBe("Anna");
    expect(row2.Montag).toBe("Ben");

    // Gezieltes Refresh (Sprint 2, Phase 6): nur die betroffenen Zeilen/Spalten,
    // kein rowNodes-loses force-Refresh des gesamten Grids.
    const call = mock.refreshCells.mock.calls.at(-1)?.[0];
    expect(call.rowNodes).toHaveLength(2);
    expect(call.columns).toEqual(["Montag"]);
  });

  it("respektiert die chronologische Reihenfolge zwischen Grid- und Tagesansicht-Aktionen", () => {
    const { result, mock } = setup();
    const row = makeRow({ _row_id: "A::::0" });

    // 1) Tagesansicht-Aktion (eigener Stack)
    act(() => result.current.commitDayEntry(row, "Montag", "Anna"));
    // 2) Direkte Grid-Bearbeitung derselben Zeile, anderer Tag
    act(() => mock.simulateGridEdit(row, "Dienstag", "Ben"));

    expect(row.Montag).toBe("Anna");
    expect(row.Dienstag).toBe("Ben");

    // Undo muss die ZULETZT passierte Aktion rückgängig machen - das war die
    // Grid-Bearbeitung (Dienstag), nicht die Tagesansicht-Aktion (Montag).
    act(() => result.current.handleUndo());
    expect(row.Dienstag).toBeNull();
    expect(row.Montag).toBe("Anna");

    act(() => result.current.handleUndo());
    expect(row.Montag).toBeNull();

    act(() => result.current.handleRedo());
    expect(row.Montag).toBe("Anna");

    act(() => result.current.handleRedo());
    expect(row.Dienstag).toBe("Ben");
  });

  it("verwirft den Redo-Stack, sobald nach einem Undo eine neue Änderung erfolgt", () => {
    const { result, mock } = setup();
    const row = makeRow({ _row_id: "A::::0" });

    act(() => result.current.commitDayEntry(row, "Montag", "Anna"));
    act(() => result.current.handleUndo());
    expect(result.current.gridHistory.canRedo).toBe(true);

    act(() => result.current.commitDayEntry(row, "Montag", "Clara"));
    expect(result.current.gridHistory.canRedo).toBe(false);
    expect(row.Montag).toBe("Clara");

    act(() => result.current.handleUndo());
    expect(row.Montag).toBeNull();
    act(() => result.current.handleRedo());
    expect(row.Montag).toBe("Clara");

    void mock;
  });

  it("resetHistory() leert beide Stacks und deaktiviert Undo/Redo", () => {
    const { result } = setup();
    const row = makeRow({ _row_id: "A::::0" });

    act(() => result.current.commitDayEntry(row, "Montag", "Anna"));
    expect(result.current.gridHistory.canUndo).toBe(true);

    act(() => result.current.resetHistory());
    expect(result.current.gridHistory.canUndo).toBe(false);
    expect(result.current.gridHistory.canRedo).toBe(false);
  });
});
