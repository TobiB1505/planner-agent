// AP12 (Schritt 5): AG-Grid-Einbettung der Wochenübersicht aus page.tsx
// extrahiert. Reines Rendering + Event-Weiterleitung - keine Business-Logik,
// keine API-Aufrufe, kein globaler Zustand. Die Seite bleibt Owner der Daten
// (rows/columnDefs kommen als Props, gridApiRef wird von außen befüllt).
import { AgGridReact } from "ag-grid-react";
import type {
  CellClickedEvent,
  CellValueChangedEvent,
  ColDef,
  GetRowIdParams,
  GridReadyEvent,
  RowHeightParams,
} from "ag-grid-community";
import { useCallback } from "react";
import type { RefObject } from "react";
import type { GridApi } from "ag-grid-community";
import type { ReadableStore } from "@/lib/plan-editor/useGridDayIndicators";
import type { PlanDensity } from "@/lib/plan-editor/viewPreferences";
import type { PlanRow } from "../types";
import { GroupHeaderRenderer, gridTheme } from "../utils/planEditorHelpers";

// Stabile Referenzen außerhalb der Komponente: beide Werte hängen von nichts
// Render-Abhängigem ab. Sprint 2 (Phase 5.1) - AG Grid bekam vorher bei jedem
// Render der Elternkomponente ein frisches Objekt/eine frische Funktion für
// defaultColDef/getRowId, obwohl sich der Inhalt nie ändert.
const DEFAULT_COL_DEF: ColDef<PlanRow> = { sortable: false, resizable: true };

function getRowId(params: GetRowIdParams<PlanRow>): string {
  return params.data._row_id;
}

function isFullWidthRow(params: { rowNode: { data?: PlanRow } }): boolean {
  return params.rowNode.data?._row_type === "group";
}

export interface PlanGridEventHandlers {
  onCellValueChanged: (event: CellValueChangedEvent<PlanRow>) => void;
  onUndoStarted: () => void;
  onUndoEnded: (event: { operationPerformed: boolean }) => void;
  onRedoStarted: () => void;
  onRedoEnded: (event: { operationPerformed: boolean }) => void;
}

export interface PlanGridProps {
  rows: PlanRow[];
  columnDefs: ColDef<PlanRow>[];
  density: PlanDensity;
  hasExistingPlan: boolean;
  gridApiRef: RefObject<GridApi<PlanRow> | null>;
  onGridReady: () => void;
  dayLabels: string[];
  activeDayStore: ReadableStore<string>;
  /** Bewusst der rohe Setter, nicht `selectDay` - ein Zellklick auf eine
   * Tagesspalte scrollt sie nicht zusätzlich in die Sichtbarkeit (sie ist ja
   * bereits sichtbar, sonst hätte man nicht draufklicken können), anders als
   * die Tagesnavigation über den Spaltenkopf oder die Tagesansicht. */
  onCellClickActivatesDay: (dayLabel: string) => void;
  historyEventHandlers: PlanGridEventHandlers;
}

export default function PlanGrid({
  rows,
  columnDefs,
  density,
  hasExistingPlan,
  gridApiRef,
  onGridReady,
  dayLabels,
  activeDayStore,
  onCellClickActivatesDay,
  historyEventHandlers,
}: PlanGridProps) {
  // Sprint 2 (Phase 5.1): stabile Referenzen über useCallback - vorher
  // erzeugte jeder Render der Elternkomponente (z.B. bei jedem markDirty()
  // nach einer Zellbearbeitung) neue Funktionsobjekte für onGridReady/
  // onCellClicked/getRowHeight. AG Grids React-Integration behandelt
  // Grid-Options-Props reaktiv - eine neue Referenz je Render ist unnötige
  // Arbeit für Funktionen, die sich inhaltlich nicht geändert haben.
  const handleGridReady = useCallback(
    (params: GridReadyEvent<PlanRow>) => {
      gridApiRef.current = params.api;
      onGridReady();
    },
    [gridApiRef, onGridReady],
  );

  const handleCellClicked = useCallback(
    (event: CellClickedEvent<PlanRow>) => {
      const field = event.colDef.field;
      // AP8: kein unnötiges setActiveDay, wenn der Tag bereits aktiv
      // ist - vermeidet ein wirkungsloses Re-Render bei Klicks
      // innerhalb derselben Spalte.
      if (field && dayLabels.includes(field) && field !== activeDayStore.get()) {
        onCellClickActivatesDay(field);
      }
    },
    [activeDayStore, dayLabels, onCellClickActivatesDay],
  );

  const handleGetRowHeight = useCallback(
    (params: RowHeightParams<PlanRow>) => {
      if (params.data?._row_type === "group") {
        return density === "compact" ? 30 : density === "large" ? 44 : 36;
      }
      return density === "compact" ? 32 : density === "large" ? 48 : 40;
    },
    [density],
  );

  return (
    <section className="panel plan-grid-shell overflow-hidden">
      <div className="plan-grid-scroll-shell">
        <div
          className={`plan-grid plan-grid-week plan-density-${density} ${
            hasExistingPlan ? "h-[calc(100vh-244px)]" : "h-[calc(100vh-300px)]"
          } min-h-[520px]`}
        >
          <AgGridReact<PlanRow>
            theme={gridTheme}
            rowData={rows}
            columnDefs={columnDefs}
            suppressFieldDotNotation
            // Höher als der Standard, damit die Tageskacheln (Wochentag, Datum,
            // "Heute", Status-Punkte) als Spaltenkopf Platz haben.
            headerHeight={54}
            defaultColDef={DEFAULT_COL_DEF}
            isFullWidthRow={isFullWidthRow}
            fullWidthCellRenderer={GroupHeaderRenderer}
            getRowHeight={handleGetRowHeight}
            stopEditingWhenCellsLoseFocus
            undoRedoCellEditing
            undoRedoCellEditingLimit={30}
            onGridReady={handleGridReady}
            onCellValueChanged={historyEventHandlers.onCellValueChanged}
            onUndoStarted={historyEventHandlers.onUndoStarted}
            onUndoEnded={historyEventHandlers.onUndoEnded}
            onRedoStarted={historyEventHandlers.onRedoStarted}
            onRedoEnded={historyEventHandlers.onRedoEnded}
            onCellClicked={handleCellClicked}
            // Sprint 0 (S1-Fix, C4): _row_id statt Kategorie::Zeile - zwei
            // inhaltlich gleiche Zeilen kollidierten sonst in AG Grid.
            getRowId={getRowId}
          />
        </div>
      </div>
    </section>
  );
}
