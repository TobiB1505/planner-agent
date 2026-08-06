// AP12 (Schritt 3, hohe Priorität): Undo/Redo-Logik aus page.tsx extrahiert.
// Verhalten unverändert übernommen - siehe docs/refactoring/AP12_PLAN_EDITOR_SPLIT.md.
//
// AG Grid zeichnet nur Änderungen aus aktiven Zell-/Zeilen-Editiervorgängen
// (bzw. Paste/Fill) in seinen Undo-Stack auf - programmatische Mutationen wie
// die Tagesplanung-Inline-Bearbeitung und die Kopieraktionen tauchen dort nie
// auf. Diese laufen deshalb über einen eigenen Aktions-Stack (eine komplette
// Kopieraktion = genau ein Eintrag = ein Undo-Schritt). actionOrderRef merkt
// sich die Chronologie beider Stacks, damit die Toolbar-Buttons immer die
// zuletzt passierte Aktion rückgängig machen, egal aus welcher Quelle.
//
// Die Dirty-/Audit-/Manuell-Markierungs-Buchführung (isDirty, auditEventsRef,
// manuallyEditedCellsRef) bleibt bewusst bei usePlanPersistence - dieser Hook
// bekommt sie als Callbacks injiziert (onMarkDirty/onRecordAudit/
// onMarkManuallyEdited), damit die History-Mechanik nicht wissen muss, WIE
// "geändert" gebucht wird, nur DASS sie es melden muss.
import { useCallback, useRef, useState, type RefObject } from "react";
import type { CellValueChangedEvent, GridApi } from "ag-grid-community";
import type { PlanAuditEventInput } from "@/lib/api";
import { cellIssueKey } from "@/lib/planValidation";
import type { PlanHistoryAction, PlanHistoryChange, PlanRow } from "../types";

export interface UsePlanHistoryOptions {
  gridApiRef: RefObject<GridApi<PlanRow> | null>;
  onMarkDirty: (count?: number) => void;
  onRecordAudit: (event: PlanAuditEventInput) => void;
  onMarkManuallyEdited: (key: string) => void;
}

function popLastMarker(list: ("grid" | "custom")[], kind: "grid" | "custom") {
  const index = list.lastIndexOf(kind);
  if (index >= 0) list.splice(index, 1);
}

export function usePlanHistory({
  gridApiRef,
  onMarkDirty,
  onRecordAudit,
  onMarkManuallyEdited,
}: UsePlanHistoryOptions) {
  const [gridHistory, setGridHistory] = useState({ canUndo: false, canRedo: false });
  const customUndoRef = useRef<PlanHistoryAction[]>([]);
  const customRedoRef = useRef<PlanHistoryAction[]>([]);
  const actionOrderRef = useRef<("grid" | "custom")[]>([]);
  const redoOrderRef = useRef<("grid" | "custom")[]>([]);
  const gridUndoInFlightRef = useRef(false);

  const refreshGridHistory = useCallback(() => {
    const api = gridApiRef.current;
    if (!api) return;
    setGridHistory({
      canUndo: api.getCurrentUndoSize() > 0 || customUndoRef.current.length > 0,
      canRedo: api.getCurrentRedoSize() > 0 || customRedoRef.current.length > 0,
    });
  }, [gridApiRef]);

  const resetHistory = useCallback(() => {
    customUndoRef.current = [];
    customRedoRef.current = [];
    actionOrderRef.current = [];
    redoOrderRef.current = [];
    setGridHistory({ canUndo: false, canRedo: false });
  }, []);

  /** Wendet eine Menge von Zelländerungen als EINE zusammenhängende Aktion an
   * (dieselbe Buchführung wie onCellValueChanged: dirty, Audit, Manuell-
   * Markierung, Zell-Refresh) und legt sie als einen Eintrag im eigenen
   * Undo-Stack ab - eine komplette Kopieraktion ist damit genau ein
   * Undo-Schritt. */
  const applyPlanChanges = useCallback(
    (
      requested: { row: PlanRow; dayLabel: string; nextValue: string }[],
      cause: string,
    ) => {
      const changes: PlanHistoryChange[] = [];
      for (const request of requested) {
        const previousValue = request.row[request.dayLabel] ?? null;
        const nextValue = request.nextValue.trim() ? request.nextValue : null;
        if (previousValue === nextValue) continue;
        changes.push({ row: request.row, dayLabel: request.dayLabel, previousValue, nextValue });
      }
      if (changes.length === 0) return;
      for (const change of changes) {
        change.row[change.dayLabel] = change.nextValue;
        const key = cellIssueKey(change.row._row_id, change.dayLabel);
        onMarkManuallyEdited(key);
        onRecordAudit({
          event_type: "cell_changed",
          cause,
          cell_key: key,
          previous_value: change.previousValue,
          new_value: change.nextValue,
          metadata: { section: change.row.Abschnitt, row: change.row.Zeile, day: change.dayLabel },
        });
      }
      customUndoRef.current.push({ changes });
      customRedoRef.current = [];
      redoOrderRef.current = [];
      actionOrderRef.current.push("custom");
      gridApiRef.current?.refreshCells({ force: true });
      onMarkDirty(changes.length);
      refreshGridHistory();
    },
    [gridApiRef, onMarkDirty, onMarkManuallyEdited, onRecordAudit, refreshGridHistory],
  );

  const commitDayEntry = useCallback(
    (row: PlanRow, dayLabel: string, rawNextValue: string) => {
      applyPlanChanges([{ row, dayLabel, nextValue: rawNextValue }], "manual_edit");
    },
    [applyPlanChanges],
  );

  const revertOrReplayCustomAction = useCallback(
    (action: PlanHistoryAction, direction: "undo" | "redo") => {
      for (const change of action.changes) {
        change.row[change.dayLabel] = direction === "undo" ? change.previousValue : change.nextValue;
      }
      onRecordAudit({ event_type: direction, cause: direction });
      gridApiRef.current?.refreshCells({ force: true });
      onMarkDirty(action.changes.length);
    },
    [gridApiRef, onMarkDirty, onRecordAudit],
  );

  const handleUndo = useCallback(() => {
    const api = gridApiRef.current;
    const gridCanUndo = (api?.getCurrentUndoSize() ?? 0) > 0;
    const customCanUndo = customUndoRef.current.length > 0;
    let kind = actionOrderRef.current[actionOrderRef.current.length - 1];
    if (kind === "grid" && !gridCanUndo) kind = "custom";
    if (kind === "custom" && !customCanUndo) kind = "grid";
    if (!kind) kind = gridCanUndo ? "grid" : "custom";

    if (kind === "custom" && customCanUndo) {
      const action = customUndoRef.current.pop()!;
      revertOrReplayCustomAction(action, "undo");
      customRedoRef.current.push(action);
      popLastMarker(actionOrderRef.current, "custom");
      redoOrderRef.current.push("custom");
    } else if (gridCanUndo) {
      // Marker-Buchführung passiert im onUndoEnded-Handler des Grids, damit
      // auch Grid-interne Tastatur-Undos (Strg+Z im Grid) erfasst werden.
      api?.undoCellEditing();
      onRecordAudit({ event_type: "undo", cause: "undo" });
    }
    refreshGridHistory();
  }, [gridApiRef, onRecordAudit, refreshGridHistory, revertOrReplayCustomAction]);

  const handleRedo = useCallback(() => {
    const api = gridApiRef.current;
    const gridCanRedo = (api?.getCurrentRedoSize() ?? 0) > 0;
    const customCanRedo = customRedoRef.current.length > 0;
    let kind = redoOrderRef.current[redoOrderRef.current.length - 1];
    if (kind === "grid" && !gridCanRedo) kind = "custom";
    if (kind === "custom" && !customCanRedo) kind = "grid";
    if (!kind) kind = gridCanRedo ? "grid" : "custom";

    if (kind === "custom" && customCanRedo) {
      const action = customRedoRef.current.pop()!;
      revertOrReplayCustomAction(action, "redo");
      customUndoRef.current.push(action);
      popLastMarker(redoOrderRef.current, "custom");
      actionOrderRef.current.push("custom");
    } else if (gridCanRedo) {
      api?.redoCellEditing();
      onRecordAudit({ event_type: "redo", cause: "redo" });
    }
    refreshGridHistory();
  }, [gridApiRef, onRecordAudit, refreshGridHistory, revertOrReplayCustomAction]);

  /** Fertig verdrahtete AG-Grid-Event-Handler für den Undo/Redo-Teil von
   * onCellValueChanged/onUndoStarted/onUndoEnded/onRedoStarted/onRedoEnded -
   * PlanGrid reicht sie unverändert an AgGridReact durch. */
  const onCellValueChanged = useCallback(
    (event: CellValueChangedEvent<PlanRow>) => {
      // KEIN setRows(...) hier: AG Grid mutiert event.data (dasselbe
      // Objekt wie in rows) bereits direkt, und markDirty löst ohnehin
      // einen Re-Render aus. Ein neues rowData-Array-Objekt an AG Grid
      // zu geben, hätte hier den undoRedoCellEditing-Stack invalidiert
      // (jede Zuweisung machte Rückgängig sofort wieder wirkungslos).
      if (event.oldValue !== event.newValue) {
        const field = event.colDef.field;
        if (field && event.data) {
          const key = cellIssueKey(event.data._row_id, field);
          onMarkManuallyEdited(key);
          onRecordAudit({
            event_type: "cell_changed",
            cause: "manual_edit",
            cell_key: key,
            previous_value: event.oldValue == null ? null : String(event.oldValue),
            new_value: event.newValue == null ? null : String(event.newValue),
            metadata: {
              section: event.data.Abschnitt,
              row: event.data.Zeile,
              day: field,
            },
          });
          event.api.refreshCells({ rowNodes: [event.node], columns: [field], force: true });
        }
        // Chronologie-Marker nur für echte Bearbeitungen - während
        // eines Grid-Undo/Redo feuert cellValueChanged ebenfalls,
        // erzeugt aber keinen neuen Undo-Eintrag.
        if (!gridUndoInFlightRef.current) {
          actionOrderRef.current.push("grid");
          customRedoRef.current = [];
          redoOrderRef.current = [];
        }
        onMarkDirty(1);
      }
      refreshGridHistory();
    },
    [onMarkDirty, onMarkManuallyEdited, onRecordAudit, refreshGridHistory],
  );

  const onUndoStarted = useCallback(() => {
    gridUndoInFlightRef.current = true;
  }, []);

  const onUndoEnded = useCallback(
    (event: { operationPerformed: boolean }) => {
      gridUndoInFlightRef.current = false;
      if (event.operationPerformed) {
        popLastMarker(actionOrderRef.current, "grid");
        redoOrderRef.current.push("grid");
      }
      refreshGridHistory();
    },
    [refreshGridHistory],
  );

  const onRedoStarted = useCallback(() => {
    gridUndoInFlightRef.current = true;
  }, []);

  const onRedoEnded = useCallback(
    (event: { operationPerformed: boolean }) => {
      gridUndoInFlightRef.current = false;
      if (event.operationPerformed) {
        popLastMarker(redoOrderRef.current, "grid");
        actionOrderRef.current.push("grid");
      }
      refreshGridHistory();
    },
    [refreshGridHistory],
  );

  return {
    gridHistory,
    refreshGridHistory,
    resetHistory,
    applyPlanChanges,
    commitDayEntry,
    handleUndo,
    handleRedo,
    gridEventHandlers: {
      onCellValueChanged,
      onUndoStarted,
      onUndoEnded,
      onRedoStarted,
      onRedoEnded,
    },
  };
}
