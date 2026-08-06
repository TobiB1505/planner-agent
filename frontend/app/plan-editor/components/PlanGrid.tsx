// AP12 (Schritt 5): AG-Grid-Einbettung der Wochenübersicht aus page.tsx
// extrahiert. Reines Rendering + Event-Weiterleitung - keine Business-Logik,
// keine API-Aufrufe, kein globaler Zustand. Die Seite bleibt Owner der Daten
// (rows/columnDefs kommen als Props, gridApiRef wird von außen befüllt).
import { AgGridReact } from "ag-grid-react";
import type {
  CellClickedEvent,
  CellValueChangedEvent,
  ColDef,
  GridReadyEvent,
} from "ag-grid-community";
import type { RefObject } from "react";
import type { GridApi } from "ag-grid-community";
import type { ReadableStore } from "@/lib/plan-editor/useGridDayIndicators";
import type { PlanDensity } from "@/lib/plan-editor/viewPreferences";
import type { PlanRow } from "../types";
import { GroupHeaderRenderer, gridTheme } from "../utils/planEditorHelpers";

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
            defaultColDef={{ sortable: false, resizable: true }}
            isFullWidthRow={(params) => params.rowNode.data?._row_type === "group"}
            fullWidthCellRenderer={GroupHeaderRenderer}
            getRowHeight={(params) => {
              if (params.data?._row_type === "group") {
                return density === "compact" ? 30 : density === "large" ? 44 : 36;
              }
              return density === "compact" ? 32 : density === "large" ? 48 : 40;
            }}
            stopEditingWhenCellsLoseFocus
            undoRedoCellEditing
            undoRedoCellEditingLimit={30}
            onGridReady={(params: GridReadyEvent<PlanRow>) => {
              gridApiRef.current = params.api;
              onGridReady();
            }}
            onCellValueChanged={historyEventHandlers.onCellValueChanged}
            onUndoStarted={historyEventHandlers.onUndoStarted}
            onUndoEnded={historyEventHandlers.onUndoEnded}
            onRedoStarted={historyEventHandlers.onRedoStarted}
            onRedoEnded={historyEventHandlers.onRedoEnded}
            onCellClicked={(event: CellClickedEvent<PlanRow>) => {
              const field = event.colDef.field;
              // AP8: kein unnötiges setActiveDay, wenn der Tag bereits aktiv
              // ist - vermeidet ein wirkungsloses Re-Render bei Klicks
              // innerhalb derselben Spalte.
              if (field && dayLabels.includes(field) && field !== activeDayStore.get()) {
                onCellClickActivatesDay(field);
              }
            }}
            // Sprint 0 (S1-Fix, C4): _row_id statt Kategorie::Zeile - zwei
            // inhaltlich gleiche Zeilen kollidierten sonst in AG Grid.
            getRowId={(params) => params.data._row_id}
          />
        </div>
      </div>
    </section>
  );
}
