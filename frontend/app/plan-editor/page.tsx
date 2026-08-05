"use client";

import ConfirmDialog from "@/components/ConfirmDialog";
import PageHeader from "@/components/PageHeader";
import PersonCellEditor from "@/components/PersonCellEditor";
import PlanEditorSummary from "@/components/PlanEditorSummary";
import PlanEditorToolbar from "@/components/PlanEditorToolbar";
import PlanIssuesPanel from "@/components/PlanIssuesPanel";
import PreparationStatusCard from "@/components/PreparationStatusCard";
import SoftsportCellEditor from "@/components/SoftsportCellEditor";
import WeekPicker from "@/components/WeekPicker";
import DayHeaderCell from "@/components/plan-editor/DayHeaderCell";
import EditorViewControls from "@/components/plan-editor/EditorViewControls";
import PlanDayView from "@/components/plan-editor/PlanDayView";
import PlanPreviewDialog from "@/components/plan-editor/PlanPreviewDialog";
import PlanIntelligenceDialog from "@/components/plan-editor/PlanIntelligenceDialog";
import PlanViewSwitcher from "@/components/plan-editor/PlanViewSwitcher";
import {
  generatePlan,
  getActivePeople,
  getArchivedPlan,
  getArtistPlans,
  getFreeSuggestion,
  getPlanTemplates,
  getPlanQuality,
  getRehearsalPlans,
  getWeeks,
  savePlan,
  type AssignmentRule,
  type ArtistPlanSummary,
  type ExtractedAbsence,
  type PlanTemplate,
  type PlanGenerateResult,
  type PlanAuditEventInput,
  type PlanQualityResult,
  type PreviousWeekWorkload,
  type RehearsalInterval,
  type RehearsalPlanSummary,
  type WeekSummary,
  xlsxGenerate,
} from "@/lib/api";
import { categoryColor, hexToRgba } from "@/lib/categoryColors";
import { diffPlanRows, type PlanDiff } from "@/lib/plan-editor/planDiff";
import { computeDayStatuses } from "@/lib/plan-editor/dayStatus";
import { collectCategorySuggestions } from "@/lib/plan-editor/entryFieldType";
import { useGridDayIndicators } from "@/lib/plan-editor/useGridDayIndicators";
import { useThrottledFocusReload } from "@/lib/plan-editor/useThrottledFocusReload";
import {
  loadPlanViewPreferences,
  savePlanViewPreferences,
  type PlanDensity,
  type PlanEditorViewMode,
  type PlanViewPreferences,
} from "@/lib/plan-editor/viewPreferences";
import {
  buildCellIssueIndex,
  cellIssueKey,
  validatePlanSafe,
  type PlanIssue,
} from "@/lib/planValidation";
import { recommendForCell, serviceIntervalLabel } from "@/lib/recommendations";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellValueChangedEvent,
  type CellClickedEvent,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type ICellRendererParams,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

ModuleRegistry.registerModules([AllCommunityModule]);

type PlanRow = Record<string, string | null> & {
  Abschnitt: string;
  Zeile: string;
  _row_type: "data" | "group";
  _category: string;
  _group_label: string | null;
  _group_color: string | null;
};

type SaveState = "idle" | "saving" | "saved" | "error";

type PendingAction =
  | { kind: "week-change"; nextDate: string }
  | { kind: "save-with-conflicts" }
  | { kind: "export-with-conflicts" };

type PlanHistoryChange = {
  row: PlanRow;
  dayLabel: string;
  previousValue: string | null;
  nextValue: string | null;
};

type PlanHistoryAction = {
  changes: PlanHistoryChange[];
};

type AutomationPreview = {
  kind: "recalculate" | "rebuild" | "free-suggestion";
  title: string;
  description: string;
  applyLabel: string;
  diff: PlanDiff;
  nextRows: PlanRow[];
  result?: PlanGenerateResult;
  successMessage: string;
};

const ABSENCE_SECTIONS = new Set(["Urlaub/Krank", "Frei"]);

const gridTheme = themeQuartz.withParams({
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

function mondayIso(): string {
  const now = new Date();
  const weekday = now.getDay() || 7;
  // Auf 12 Uhr mittags verankern: toISOString() rechnet in UTC um und würde sonst
  // in den Nachtstunden (bzw. bei positivem UTC-Offset) einen Tag zurückspringen -
  // die Planwoche startete dann auf einem Sonntag statt auf Montag.
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - weekday + 1, 12);
  return monday.toISOString().slice(0, 10);
}

function addDays(iso: string, amount: number): string {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return date.toISOString().slice(0, 10);
}

function isoWeek(iso: string): number {
  const date = new Date(`${iso}T12:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function templateCodeForDate(iso: string): "A" | "B" {
  return isoWeek(iso) % 2 === 1 ? "A" : "B";
}

function formatDateRange(startIso: string, endIso: string): string {
  const formatter = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${formatter.format(new Date(`${startIso}T12:00:00`))}–${formatter.format(new Date(`${endIso}T12:00:00`))}`;
}

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("de-DE", { weekday: "long" });
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });

function weekdayLabelFor(iso?: string): string | undefined {
  if (!iso) return undefined;
  return WEEKDAY_FORMATTER.format(new Date(`${iso}T12:00:00`));
}

function shortDateLabelFor(iso?: string): string | undefined {
  if (!iso) return undefined;
  // Intl hängt im de-DE-Format bei day+month bereits einen Punkt an ("27.07.").
  return SHORT_DATE_FORMATTER.format(new Date(`${iso}T12:00:00`));
}

/** Löst Uhrzeitangaben aus dem Zeilentext ("KP3 19:00 - 21:15" -> "KP3"), damit der
 *  Popup-Kopfbereich keine Zeit doppelt zeigt (die kommt separat aus serviceInterval). */
function serviceExtraLabel(zeile: string): string {
  return zeile
    .replace(/\d{1,2}[:.]\d{2}\s*(?:-|–|bis)\s*\d{1,2}[:.]\d{2}/gi, "")
    .replace(/\d{1,2}[:.]\d{2}/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function splitNames(value: string): string[] {
  return value
    .split(/[,;\n]+/)
    .map((part) => part.includes("|") ? part.split("|").at(-1)!.trim() : part.trim())
    .filter(Boolean);
}

/** Bei kombinierten Zellen (z.B. `Boccia | Livia` oder Aperitif mit
 * Ort/Uhrzeit/Künstler) gehört nur der Teil nach dem letzten Trenner zur
 * automatischen MA-Zuweisung. Eine Neuverteilung darf den redaktionellen
 * Präfix nicht nebenbei umformatieren. */
function mergeGeneratedPersonCell(
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

function collectAbsences(
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

function rowCategory(row?: PlanRow): string {
  return row?._category || row?.Abschnitt || "";
}

function rowColor(row?: PlanRow): string {
  return row?._group_color || categoryColor(rowCategory(row));
}

function rowKey(row: PlanRow): string {
  if (row._row_type === "group") return `group::${row._group_label}`;
  return `${rowCategory(row)}::${row.Zeile}`;
}

function GroupHeaderRenderer({ data }: ICellRendererParams<PlanRow>) {
  const color = data?._group_color || "#6c7bff";
  return (
    <div
      className="plan-group-row flex h-full w-full items-center px-4 text-left text-[12.5px] font-semibold tracking-[0.02em]"
      style={{
        backgroundColor: hexToRgba(color, 0.14),
        borderLeft: `3px solid ${color}`,
        color: "var(--foreground)",
      }}
    >
      {data?._group_label}
    </div>
  );
}

function PlanEditorInitialLoading({ startDate }: { startDate: string }) {
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

export default function PlanEditorPage() {
  const initialStart = useMemo(() => mondayIso(), []);
  const [templates, setTemplates] = useState<PlanTemplate[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [templateCode, setTemplateCode] = useState<"A" | "B">(() => templateCodeForDate(initialStart));
  const [resolvedTemplateWeekId, setResolvedTemplateWeekId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState(initialStart);
  const [rows, setRows] = useState<PlanRow[]>([]);
  const rowsRef = useRef<PlanRow[]>([]);
  const [dayLabels, setDayLabels] = useState<string[]>([]);
  const [weekDates, setWeekDates] = useState<string[]>([]);
  const [personCategories, setPersonCategories] = useState<Set<string>>(new Set());
  const [assignmentRules, setAssignmentRules] = useState<Record<string, AssignmentRule>>({});
  const [initializing, setInitializing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const [xlsxSheet, setXlsxSheet] = useState("");
  const [rehearsalIntervals, setRehearsalIntervals] = useState<RehearsalInterval[]>([]);
  const [showDates, setShowDates] = useState<string[]>([]);
  const [onStageByDate, setOnStageByDate] = useState<Record<string, string[]>>({});
  const [onStageShowsByDate, setOnStageShowsByDate] = useState<Record<string, string[]>>({});
  const [dekoPeople, setDekoPeople] = useState<string[]>([]);
  const [previousWeekWorkload, setPreviousWeekWorkload] = useState<
    Record<string, PreviousWeekWorkload>
  >({});
  const [artistPlans, setArtistPlans] = useState<ArtistPlanSummary[]>([]);
  const [rehearsalPlans, setRehearsalPlans] = useState<RehearsalPlanSummary[]>([]);
  const [archivedWeeks, setArchivedWeeks] = useState<WeekSummary[]>([]);
  const [loadedArchivedWeek, setLoadedArchivedWeek] = useState<WeekSummary | null>(null);
  const [activeStep, setActiveStep] = useState(1);
  const [exported, setExported] = useState(false);
  const loadedArchiveKeyRef = useRef<string | null>(null);
  const manuallyEditedCellsRef = useRef<Set<string>>(new Set());

  // ---------- Sprint 4: Arbeitsansicht ----------
  const [viewPreferences, setViewPreferences] = useState<PlanViewPreferences>(() =>
    loadPlanViewPreferences(),
  );
  const { density, viewMode } = viewPreferences;
  const setViewMode = useCallback((nextMode: PlanEditorViewMode) => {
    setViewPreferences((current) => ({ ...current, viewMode: nextMode }));
  }, []);
  const [activeDay, setActiveDay] = useState("");
  const [automationPreview, setAutomationPreview] = useState<AutomationPreview | null>(null);

  // ---------- Sprint 5: Intelligence & Audit ----------
  const [planQuality, setPlanQuality] = useState<PlanQualityResult | null>(null);
  const [qualityLoading, setQualityLoading] = useState(false);
  const [intelligenceOpen, setIntelligenceOpen] = useState(false);
  const auditEventsRef = useRef<PlanAuditEventInput[]>([]);

  // ---------- Änderungsstatus (Aufgabe 3) ----------
  const [isDirty, setIsDirty] = useState(false);
  const [changeCount, setChangeCount] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  // ---------- Planprüfung (Sprint 3) ----------
  const [issuesPanelOpen, setIssuesPanelOpen] = useState(false);
  // Die Prüfung läuft ohnehin reaktiv (siehe validation-useMemo); dieser Zähler
  // erzwingt bei Bedarf trotzdem einen echten Neu-Lauf (z.B. "Erneut prüfen"
  // nach einem Prüf-Fehler, bei dem sich sonst nichts an den Eingaben ändert).
  const [revalidateNonce, setRevalidateNonce] = useState(0);
  const cellIssueIndexRef = useRef<Map<string, PlanIssue[]>>(new Map());

  // ---------- Undo/Redo (Aufgabe 3) ----------
  const gridApiRef = useRef<GridApi<PlanRow> | null>(null);
  const [gridHistory, setGridHistory] = useState({ canUndo: false, canRedo: false });
  // AG Grid zeichnet nur Änderungen aus aktiven Zell-/Zeilen-Editiervorgängen
  // (bzw. Paste/Fill) in seinen Undo-Stack auf - programmatische Mutationen wie
  // die Tagesplanung-Inline-Bearbeitung und die Kopieraktionen tauchen dort nie
  // auf. Diese laufen deshalb über einen eigenen Aktions-Stack (eine komplette
  // Kopieraktion = genau ein Eintrag = ein Undo-Schritt). actionOrderRef merkt
  // sich die Chronologie beider Stacks, damit die Toolbar-Buttons immer die
  // zuletzt passierte Aktion rückgängig machen, egal aus welcher Quelle.
  const customUndoRef = useRef<PlanHistoryAction[]>([]);
  const customRedoRef = useRef<PlanHistoryAction[]>([]);
  const actionOrderRef = useRef<("grid" | "custom")[]>([]);
  const redoOrderRef = useRef<("grid" | "custom")[]>([]);
  const gridUndoInFlightRef = useRef(false);

  useEffect(() => {
    savePlanViewPreferences(viewPreferences);
  }, [viewPreferences]);

  const effectiveActiveDay = useMemo(() => {
    if (dayLabels.includes(activeDay)) return activeDay;
    const todayIso = new Date().toLocaleDateString("sv-SE");
    const todayIndex = weekDates.indexOf(todayIso);
    return dayLabels[todayIndex >= 0 ? todayIndex : 0] ?? "";
  }, [activeDay, dayLabels, weekDates]);

  const refreshGridHistory = useCallback(() => {
    const api = gridApiRef.current;
    if (!api) return;
    setGridHistory({
      canUndo: api.getCurrentUndoSize() > 0 || customUndoRef.current.length > 0,
      canRedo: api.getCurrentRedoSize() > 0 || customRedoRef.current.length > 0,
    });
  }, []);

  const resetHistory = useCallback(() => {
    customUndoRef.current = [];
    customRedoRef.current = [];
    actionOrderRef.current = [];
    redoOrderRef.current = [];
    setGridHistory({ canUndo: false, canRedo: false });
  }, []);

  const markDirty = useCallback((count = 1) => {
    setIsDirty(true);
    setChangeCount((current) => current + count);
    setSaveState("idle");
  }, []);

  const clearDirty = useCallback(() => {
    setIsDirty(false);
    setChangeCount(0);
    manuallyEditedCellsRef.current.clear();
    auditEventsRef.current = [];
    gridApiRef.current?.refreshCells({ force: true });
  }, []);

  // Globale Planprüfung (Sprint 3). Läuft synchron über den aktuellen
  // Wochenzustand - bei ~40 Zeilen/7 Tagen ausreichend schnell, keine
  // Debounce/Web-Worker-Lösung nötig. `changeCount` steht zusätzlich zu `rows`
  // in den Abhängigkeiten, weil AG-Grid-Zellbearbeitungen die Objekte in
  // `rows` direkt mutieren (siehe onCellValueChanged) und die Array-Referenz
  // selbst unverändert bleibt - ohne changeCount würde die Prüfung nach einer
  // Zuweisung nicht neu laufen.
  const validation = useMemo(
    () =>
      validatePlanSafe({
        rows,
        dayLabels,
        weekDates,
        people,
        personCategories,
        assignmentRules,
        rehearsalIntervals,
        onStageByDate,
        onStageShowsByDate,
        showDates,
        dekoPeople,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      rows,
      changeCount,
      dayLabels,
      weekDates,
      people,
      personCategories,
      assignmentRules,
      rehearsalIntervals,
      onStageByDate,
      onStageShowsByDate,
      showDates,
      dekoPeople,
      revalidateNonce,
    ],
  );

  const cellIssueIndex = useMemo(() => buildCellIssueIndex(validation.issues), [validation.issues]);

  const dayStatuses = useMemo(
    () => computeDayStatuses(dayLabels, weekDates, validation.issues, isDirty),
    [dayLabels, weekDates, validation.issues, isDirty],
  );

  // AP8: aktiver Tag und Tagesstatus ändern sich bei jedem Zellklick bzw.
  // jeder Planprüfung - werden hier in abonnierbare Stores gespiegelt und
  // gezielt per refreshHeader()/refreshCells() ins Grid nachgezogen, statt
  // `columnDefs` dafür neu zu bauen (siehe useGridDayIndicators).
  const { activeDayStore, dayStatusesStore } = useGridDayIndicators(
    gridApiRef,
    effectiveActiveDay,
    dayStatuses,
  );

  useEffect(() => {
    if (!rows.length || !dayLabels.length) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setQualityLoading(true);
      getPlanQuality({
        start_date: startDate,
        day_labels: dayLabels,
        rows: rows.map((row) => ({ ...row })),
      })
        .then((result) => {
          if (!cancelled) setPlanQuality(result);
        })
        .catch(() => {
          if (!cancelled) setPlanQuality(null);
        })
        .finally(() => {
          if (!cancelled) setQualityLoading(false);
        });
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // changeCount ist nötig, weil AG Grid Zeilenobjekte direkt mutiert.
  }, [rows, changeCount, startDate, dayLabels]);

  useEffect(() => {
    cellIssueIndexRef.current = cellIssueIndex;
    gridApiRef.current?.refreshCells({ force: true });
  }, [cellIssueIndex]);

  /** Fokussiert eine Zelle im (immer gemounteten) AG-Grid der Wochenübersicht -
   * genutzt von der Planprüfung (navigateToIssue), um bei einem Konflikt direkt
   * an die betroffene Stelle in der Wochenübersicht zu springen. */
  function focusGridCell(
    rowId: string,
    columnId: string,
    options?: { openEditor?: boolean; onMissing?: () => void },
  ) {
    const api = gridApiRef.current;
    if (!api) return;
    const node = api.getRowNode(rowId);
    if (!node || node.rowIndex == null) {
      options?.onMissing?.();
      return;
    }
    const rowIndex = node.rowIndex;
    api.ensureIndexVisible(rowIndex, "middle");
    api.ensureColumnVisible(columnId);
    api.setFocusedCell(rowIndex, columnId);
    api.flashCells({ rowNodes: [node], columns: [columnId], flashDuration: 1200, fadeDuration: 800 });
    if (options?.openEditor) {
      window.setTimeout(() => api.startEditingCell({ rowIndex, colKey: columnId }), 80);
    }
  }

  /** Übernimmt eine Tagesplanung-Inline-Bearbeitung in dieselbe `rows`-Struktur
   * und dieselbe Buchführung (dirty/Audit/Konfliktmarkierung), die
   * onCellValueChanged für Bearbeitungen in der Wochenübersicht nutzt - ein
   * einziger Bearbeitungs-"Motor" für beide Ansichten, keine zweite
   * Speicherlogik. */
  const isPersonSection = useCallback(
    (category: string) => personCategories.has(category) || ABSENCE_SECTIONS.has(category),
    [personCategories],
  );
  const isAbsenceSection = useCallback((category: string) => ABSENCE_SECTIONS.has(category), []);

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
        const key = cellIssueKey(rowKey(change.row), change.dayLabel);
        manuallyEditedCellsRef.current.add(key);
        auditEventsRef.current.push({
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
      markDirty(changes.length);
      refreshGridHistory();
    },
    [markDirty, refreshGridHistory],
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
      auditEventsRef.current.push({ event_type: direction, cause: direction });
      gridApiRef.current?.refreshCells({ force: true });
      markDirty(action.changes.length);
    },
    [markDirty],
  );

  /** Dieselbe Empfehlungslogik (recommendForCell), die die Wochenübersicht in
   * ihrem cellEditorSelector nutzt - für die Kandidatenliste in der
   * Tagesplanung-Inline-Bearbeitung. */
  const getCandidatesFor = useCallback(
    (row: PlanRow, dayLabel: string) => {
      const category = rowCategory(row);
      if (!isPersonSection(category) || ABSENCE_SECTIONS.has(category)) return [];
      const rule = assignmentRules[rowKey(row)];
      const recommendation = recommendForCell({
        targetRow: row,
        dayLabel,
        rows: rowsRef.current,
        dayLabels,
        people,
        personCategories,
        rule,
        weekDates,
        rehearsalIntervals,
        showDates,
        onStageByDate,
        onStageShowsByDate,
        dekoPeople,
        previousWeekWorkload,
      });
      return recommendation?.candidates ?? [];
    },
    [
      isPersonSection,
      assignmentRules,
      dayLabels,
      people,
      personCategories,
      weekDates,
      rehearsalIntervals,
      showDates,
      onStageByDate,
      onStageShowsByDate,
      dekoPeople,
      previousWeekWorkload,
    ],
  );

  const getSuggestionsFor = useCallback(
    (category: string) => collectCategorySuggestions(rowsRef.current, category, dayLabels),
    [dayLabels],
  );

  function navigateToIssue(issue: PlanIssue, options?: { openEditor?: boolean }) {
    const ref = issue.primaryCell;
    if (!ref) return;
    setIssuesPanelOpen(false);
    setViewMode("week");
    window.setTimeout(() => {
      focusGridCell(ref.rowId, ref.columnId, {
        openEditor: options?.openEditor,
        onMissing: () =>
          setMessage({
            kind: "error",
            text: "Diese Stelle gibt es im aktuellen Plan nicht mehr - die Planprüfung wird aktualisiert.",
          }),
      });
    }, 60);
  }

  // AP8: `mountedRef` schützt sowohl den initialen Ladevorgang als auch den
  // fokus-getriggerten Reload (useThrottledFocusReload) davor, nach einem
  // Unmount noch State zu setzen - derselbe Zweck wie die bereits an anderer
  // Stelle in dieser Datei verwendeten lokalen `active`/`cancelled`-Flags,
  // hier komponentenweit, weil beide Aufrufer dieselbe Funktion teilen.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadReferenceData = useCallback(() => {
    return Promise.all([
      getPlanTemplates(),
      getActivePeople(),
      getArtistPlans(),
      getRehearsalPlans(),
      getWeeks(),
    ])
      .then(([templateData, activePeople, storedArtistPlans, storedRehearsalPlans, storedWeeks]) => {
        if (!mountedRef.current) return;
        setTemplates(templateData);
        setPeople(activePeople);
        setArtistPlans(storedArtistPlans);
        setRehearsalPlans(storedRehearsalPlans);
        setArchivedWeeks(storedWeeks);
        if (!storedWeeks.some((week) => week.start_date === mondayIso())) {
          setInitializing(false);
        }
      })
      .catch((error) => {
        if (!mountedRef.current) return;
        setInitializing(false);
        setMessage({ kind: "error", text: error.message });
      });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(loadReferenceData, 0);
    return () => window.clearTimeout(timer);
  }, [loadReferenceData]);

  // AP8: vorher lud `window.focus` ungedrosselt bei jedem Tab-Wechsel dieselben
  // fünf Endpunkte neu - jetzt mit Mindestabstand (30s) und In-Flight-Schutz
  // (siehe useThrottledFocusReload). Verhalten bezüglich Dirty State
  // unverändert: `loadReferenceData` berührt weder `rows` noch `isDirty`.
  useThrottledFocusReload(loadReferenceData);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    const archivedWeek = archivedWeeks.find((week) => week.start_date === startDate);
    if (!archivedWeek) return;
    const archiveKey = `${startDate}:${archivedWeek.id}`;
    if (loadedArchiveKeyRef.current === archiveKey) return;
    loadedArchiveKeyRef.current = archiveKey;

    let active = true;
    getArchivedPlan(startDate)
      .then((result) => {
        if (!active) return;
        setRows(result.rows as PlanRow[]);
        setDayLabels(result.day_labels);
        setWeekDates(result.week_dates_iso);
        setPersonCategories(new Set(result.person_categories));
        setAssignmentRules(result.assignment_rules);
        setResolvedTemplateWeekId(result.template_week_id);
        setXlsxSheet(result.xlsx_sheet ?? "");
        setRehearsalIntervals(result.rehearsal_intervals ?? []);
        setShowDates(result.show_dates ?? []);
        setOnStageByDate(result.on_stage_by_date ?? {});
        setOnStageShowsByDate(result.on_stage_shows_by_date ?? {});
        setDekoPeople(result.deko_people ?? []);
        setPreviousWeekWorkload(result.previous_week_workload ?? {});
        if (result.template_code === "A" || result.template_code === "B") {
          setTemplateCode(result.template_code);
        }
        setLoadedArchivedWeek(result.existing_week);
        setExported(true);
        setActiveStep(3);
        // Frisch geladener Plan ist die neue Vergleichsbasis - keine Änderung.
        clearDirty();
        setSaveState("idle");
        setLastSavedAt(null);
        setInitializing(false);
      })
      .catch((error) => {
        if (!active) return;
        loadedArchiveKeyRef.current = null;
        setInitializing(false);
        setMessage({
          kind: "error",
          text: error instanceof Error
            ? error.message
            : "Der archivierte Dienstplan konnte nicht geöffnet werden.",
        });
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archivedWeeks, startDate]);

  // ---------- Schutz vor Datenverlust: Browser-Tab schließen/neu laden ----------
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const hasExistingPlan = Boolean(loadedArchivedWeek);
  const selectedTemplate = templates.find((template) => template.code === templateCode);
  const artistPlanForWeek = artistPlans.find((plan) => plan.start_date === startDate);
  const rehearsalPlanForWeek = rehearsalPlans.find((plan) => plan.start_date === startDate);
  const stepStates = [
    {
      number: 1,
      eyebrow: "Programm",
      title: "Künstlerplan",
      description: "Shows, DJs und Tagesprogramm",
      complete: Boolean(artistPlanForWeek),
    },
    {
      number: 2,
      eyebrow: "Verfügbarkeit",
      title: "Probenplan",
      description: "Proben und Zeitkonflikte",
      complete: Boolean(rehearsalPlanForWeek),
    },
    {
      number: 3,
      eyebrow: "Planung",
      title: "Dienstplan",
      description: loadedArchivedWeek
        ? "Fertig · weiterhin bearbeitbar"
        : "Vorschläge prüfen und bearbeiten",
      complete: rows.length > 0 || Boolean(loadedArchivedWeek),
    },
    {
      number: 4,
      eyebrow: "Abschluss",
      title: "Export",
      description: loadedArchivedWeek
        ? "Vollständig archiviert"
        : "Excel erzeugen und archivieren",
      complete: exported || Boolean(loadedArchivedWeek),
    },
  ];


  const handleDensityChange = useCallback((nextDensity: PlanDensity) => {
    setViewPreferences((current) => ({ ...current, density: nextDensity }));
    window.requestAnimationFrame(() => {
      const api = gridApiRef.current;
      if (!api) return;
      api.refreshCells({ force: true });
      api.resetRowHeights();
    });
  }, []);

  const selectDay = useCallback((dayLabel: string) => {
    setActiveDay(dayLabel);
    gridApiRef.current?.ensureColumnVisible(dayLabel);
  }, []);

  const columnDefs = useMemo<ColDef<PlanRow>[]>(() => {
    const fixed: ColDef<PlanRow>[] = [
      {
        field: "Abschnitt",
        headerName: "Abschnitt",
        pinned: "left",
        width: 132,
        editable: false,
        lockPinned: true,
        cellStyle: (params) => ({
          backgroundColor: hexToRgba(rowColor(params.data), 0.16),
          borderLeft: `3px solid ${rowColor(params.data)}`,
          fontWeight: "700",
        }),
      },
      {
        field: "Zeile",
        headerName: "Zeile / Uhrzeit",
        pinned: "left",
        width: 120,
        editable: false,
        lockPinned: true,
        wrapText: false,
        autoHeight: false,
        cellStyle: (params) => ({
          backgroundColor: hexToRgba(rowColor(params.data), 0.09),
          color: "var(--muted)",
          fontWeight: "600",
        }),
      },
    ];
    const todayIso = new Date().toLocaleDateString("sv-SE");
    const days = dayLabels.map<ColDef<PlanRow>>((label, index) => ({
      field: label,
      headerName: label,
      // Die Tageskachel (Wochentag, Datum, "Heute", Status-Punkte) ersetzt den
      // Standard-Spaltenkopf komplett - dadurch gibt es nur noch eine einzige
      // Tagesnavigation statt einer Kachel-Leiste plus separater Spaltenköpfe.
      headerComponent: DayHeaderCell,
      headerComponentParams: {
        dayLabel: label,
        isToday: weekDates[index] === todayIso,
        // AP8: abonnierbare Stores statt fertiger Werte - DayHeaderCell
        // rendert sich darüber selbst neu (useSyncExternalStore), columnDefs
        // muss dafür nicht neu gebaut werden (siehe useGridDayIndicators).
        activeDayStore,
        dayStatusesStore,
        onSelect: selectDay,
      },
      minWidth: 94,
      flex: 1,
      editable: true,
      singleClickEdit: true,
      wrapText: false,
      autoHeight: false,
      // AP8: Funktion statt fertigem String - wird bei refreshHeader() neu
      // ausgewertet und liest den aktiven Tag live aus dem Store.
      headerClass: () => (activeDayStore.get() === label ? "plan-day-header-active" : undefined),
      // AG Grid beendet Editoren standardmäßig selbst bei Enter (noch vor dem
      // React-Editor). Die jeweiligen Editoren übernehmen Enter kontrolliert.
      suppressKeyboardEvent: (params) =>
        params.editing && params.event.key === "Enter",
      cellEditorSelector: (params) => {
        const category = rowCategory(params.data);
        const rule = params.data ? assignmentRules[rowKey(params.data)] : undefined;
        const dayLabel = params.colDef.field ?? "";
        const dynamicRecommendation =
          params.data &&
          dayLabel &&
          isPersonSection(category) &&
          !ABSENCE_SECTIONS.has(category)
            ? recommendForCell({
                targetRow: params.data,
                dayLabel,
                rows: rowsRef.current,
                dayLabels,
                people,
                personCategories,
                rule,
                weekDates,
                rehearsalIntervals,
                showDates,
                onStageByDate,
                onStageShowsByDate,
                dekoPeople,
                previousWeekWorkload,
              })
            : undefined;
        const isSoftsport =
          category === "Sportprogramm" && params.data?.Zeile.includes("Softsport");
        const isGuestsVsRobins =
          category === "Sportprogramm" &&
          params.data?.Zeile === "15:30 BVB" &&
          dayLabels.indexOf(dayLabel) === 4;
        if (isSoftsport) {
          return {
            component: SoftsportCellEditor,
            params: {
              people,
              candidates: dynamicRecommendation?.candidates ?? [],
              recommendedPeople:
                dynamicRecommendation?.recommendedPeople ?? rule?.recommended_people,
              blockedPeople:
                dynamicRecommendation?.blockedPeople ?? rule?.blocked_people,
              ruleHint: dynamicRecommendation?.hint ?? rule?.message,
              nearbyPeople: dynamicRecommendation?.nearbyPeople ?? [],
            },
            popup: true,
            popupPosition: "under",
          };
        }
        if (!isPersonSection(category)) {
          return {
            component: "agLargeTextCellEditor",
            params: { maxLength: 500, rows: 5, cols: 35 },
            popup: true,
            popupPosition: "under",
          };
        }
        const extraLabel = serviceExtraLabel(params.data?.Zeile ?? "");
        const serviceName =
          extraLabel && extraLabel !== category ? `${category} · ${extraLabel}` : category;
        const targetDate = dynamicRecommendation?.targetDate;
        const targetInterval = dynamicRecommendation?.targetInterval;
        return {
          component: PersonCellEditor,
          params: {
            people,
            candidates: dynamicRecommendation?.candidates ?? [],
            ruleHint: dynamicRecommendation?.hint ?? rule?.message,
            minimumPeople: isGuestsVsRobins ? 4 : 1,
            serviceName,
            sectionName: params.data?.Abschnitt && params.data.Abschnitt !== category
              ? params.data.Abschnitt
              : undefined,
            weekdayLabel: weekdayLabelFor(targetDate),
            dateLabel: shortDateLabelFor(targetDate),
            timeLabel: targetInterval ? serviceIntervalLabel(targetInterval) : undefined,
            intelligenceRequest: {
              start_date: startDate,
              day_labels: dayLabels,
              rows: rowsRef.current.map((row) => ({ ...row })),
              day_label: dayLabel,
              category,
              subcategory: params.data?.Zeile ?? null,
            },
            onRecommendationSelected: (name: string) => {
              if (!params.data) return;
              auditEventsRef.current.push({
                event_type: "recommendation_applied",
                cause: "recommendation",
                cell_key: cellIssueKey(rowKey(params.data), dayLabel),
                new_value: name,
                metadata: { category, subcategory: params.data.Zeile, day: dayLabel },
              });
            },
          },
          popup: true,
          popupPosition: "under",
        };
      },
      cellStyle: (params) => ({
        backgroundColor: hexToRgba(rowColor(params.data), 0.06),
        cursor: "text",
      }),
      // Konfliktmarkierungen (Sprint 3): liest aus einem Ref statt aus einer
      // columnDefs-Abhängigkeit, damit eine neue Planprüfung nicht die
      // komplette Spaltenkonfiguration neu aufbaut - nur ein gezieltes
      // refreshCells() nach der Prüfung (siehe cellIssueIndex-Effekt).
      cellClassRules: {
        // AP8: liest aus demselben Store wie der Header (statt der
        // geschlossenen effectiveActiveDay-Variable), damit ein Tageswechsel
        // keinen columnDefs-Rebuild mehr braucht - nur refreshCells() (siehe
        // useGridDayIndicators).
        "plan-day-cell-active": () => activeDayStore.get() === label,
        "plan-cell-manual": (params) =>
          Boolean(
            params.data &&
              params.data._row_type !== "group" &&
              manuallyEditedCellsRef.current.has(cellIssueKey(rowKey(params.data), label)),
          ),
        "plan-cell-issue-error": (params) =>
          Boolean(
            params.data &&
              params.data._row_type !== "group" &&
              cellIssueIndexRef.current
                .get(cellIssueKey(rowKey(params.data), label))
                ?.some((issue) => issue.severity === "error"),
          ),
        "plan-cell-issue-warning": (params) => {
          if (!params.data || params.data._row_type === "group") return false;
          const list = cellIssueIndexRef.current.get(
            cellIssueKey(rowKey(params.data), label),
          );
          return Boolean(
            list &&
              list.length > 0 &&
              !list.some((issue) => issue.severity === "error"),
          );
        },
      },
      tooltipValueGetter: (params) => {
        if (!params.data || params.data._row_type === "group") return undefined;
        const list = cellIssueIndexRef.current.get(
          cellIssueKey(rowKey(params.data), label),
        );
        const issueText = list?.length
          ? `${list.length > 1 ? `${list.length} Probleme: ` : ""}${list
              .map((issue) => issue.description)
              .join(" | ")}`
          : "";
        const cellText = typeof params.value === "string" ? params.value.trim() : "";
        if (cellText) {
          return issueText ? `${issueText}\n\nInhalt: ${cellText}` : cellText;
        }
        return issueText || undefined;
      },
    }));
    return [...fixed, ...days];
  }, [
    assignmentRules,
    dayLabels,
    isPersonSection,
    people,
    personCategories,
    rehearsalIntervals,
    showDates,
    onStageByDate,
    onStageShowsByDate,
    dekoPeople,
    previousWeekWorkload,
    startDate,
    weekDates,
    // AP8: effectiveActiveDay/dayStatuses bewusst NICHT hier - sie werden über
    // activeDayStore/dayStatusesStore gelesen (useGridDayIndicators) und
    // gezielt per refreshHeader()/refreshCells() nachgezogen, damit ein
    // Zellklick oder eine neue Planprüfung keinen kompletten columnDefs-
    // Rebuild mehr auslöst.
    activeDayStore,
    dayStatusesStore,
    selectDay,
  ]);

  async function buildGeneratedPlan(recalculate: boolean) {
    const absenceInput = recalculate ? collectAbsences(rows, dayLabels, weekDates) : [];
    const result = await generatePlan({
      template_code: templateCode,
      new_start: startDate,
      absences: absenceInput,
    });
    let nextRows = result.rows as PlanRow[];
    if (recalculate && rows.length) {
      const previous = new Map(rows.map((row) => [rowKey(row), row]));
      const generatedPersonCategories = new Set(result.person_categories);
      nextRows = nextRows.map((row) => {
        const old = previous.get(rowKey(row));
        const category = rowCategory(row);
        const preserve =
          ABSENCE_SECTIONS.has(category) ||
          !generatedPersonCategories.has(category);
        if (!old) return row;
        if (preserve) return { ...row, ...old };

        // Eine automatische Optimierung darf bewusst bearbeitete Zellen nicht
        // still überschreiben. Nur unveränderte Personenzellen werden aus dem
        // neuen Vorschlag übernommen; die Vorschau zeigt dadurch exakt den
        // tatsächlich anwendbaren Stand.
        const merged = { ...row };
        for (const label of result.day_labels) {
          if (manuallyEditedCellsRef.current.has(cellIssueKey(rowKey(old), label))) {
            merged[label] = old[label];
          } else {
            merged[label] = mergeGeneratedPersonCell(old[label], row[label]);
          }
        }
        return merged;
      });
    }
    return { result, nextRows };
  }

  function applyGeneratedPlan(result: PlanGenerateResult, nextRows: PlanRow[], recalculate: boolean) {
    if (!recalculate) manuallyEditedCellsRef.current.clear();
    setRows(nextRows);
    setDayLabels(result.day_labels);
    setWeekDates(result.week_dates_iso);
    setPersonCategories(new Set(result.person_categories));
    setAssignmentRules(result.assignment_rules);
    setResolvedTemplateWeekId(result.template_week_id);
    setXlsxSheet(result.xlsx_sheet ?? selectedTemplate?.sheet ?? "");
    setRehearsalIntervals(result.rehearsal_intervals ?? []);
    setShowDates(result.show_dates ?? []);
    setOnStageByDate(result.on_stage_by_date ?? {});
    setOnStageShowsByDate(result.on_stage_shows_by_date ?? {});
    setDekoPeople(result.deko_people ?? []);
    setPreviousWeekWorkload(result.previous_week_workload ?? {});
    setExported(false);
    setActiveStep(3);
    markDirty(1);
    resetHistory();
    setMessage({
      kind: "success",
      text: recalculate
        ? "Automatische Verteilung übernommen. Info- und Abwesenheitsfelder wurden beibehalten."
        : (
            `${selectedTemplate?.name ?? `Woche ${templateCode}`} · ${selectedTemplate?.program ?? ""} wurde erstellt. ` +
            (result.artist_plan
              ? "Der gespeicherte Künstlerplan wurde automatisch übernommen."
              : "Für diese Woche ist noch kein Künstlerplan gespeichert.") +
            (result.rehearsal_plan
              ? " Der Probenplan schützt automatisch vor zeitlichen Überschneidungen."
              : " Für diese Woche ist noch kein Probenplan gespeichert.")
          ),
    });
  }

  async function generate(recalculate = false) {
    if (!templateCode || !startDate) {
      setMessage({ kind: "error", text: "Bitte zuerst Woche A oder B und ein Startdatum auswählen." });
      return;
    }
    setBusy(true);
    setMessage({ kind: "info", text: recalculate ? "Automatische Verteilung wird vorbereitet …" : "Wochenplan wird aufgebaut …" });
    try {
      const { result, nextRows } = await buildGeneratedPlan(recalculate);
      applyGeneratedPlan(result, nextRows, recalculate);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Plan konnte nicht erstellt werden." });
    } finally {
      setBusy(false);
    }
  }

  async function prepareGeneratedPreview(recalculate: boolean) {
    if (!templateCode || !startDate || !rows.length) return;
    setBusy(true);
    setMessage({ kind: "info", text: "Änderungsvorschau wird berechnet …" });
    try {
      const { result, nextRows } = await buildGeneratedPlan(recalculate);
      setAutomationPreview({
        kind: recalculate ? "recalculate" : "rebuild",
        title: recalculate ? "Automatische Verteilung verbessern" : "Plan komplett neu erstellen",
        description: recalculate
          ? "Personenzuweisungen werden neu verteilt. Info- und Abwesenheitsfelder bleiben erhalten."
          : "Der aktuelle Wochenplan wird durch einen vollständig neuen Planungsvorschlag ersetzt.",
        applyLabel: recalculate ? "Verteilung übernehmen" : "Neuen Plan übernehmen",
        diff: diffPlanRows(rows, nextRows, result.day_labels),
        nextRows,
        result,
        successMessage: recalculate
          ? "Automatische Verteilung wurde übernommen."
          : "Der neue Planungsvorschlag wurde übernommen.",
      });
      setMessage(null);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Vorschau konnte nicht erstellt werden." });
    } finally {
      setBusy(false);
    }
  }

  async function prepareFreeSuggestionPreview() {
    if (!startDate || !rows.length) return;
    setBusy(true);
    setMessage({ kind: "info", text: "Vorschau für freie Tage wird vorbereitet …" });
    try {
      const existing = collectAbsences(rows, dayLabels, weekDates);
      const result = await getFreeSuggestion(startDate, existing);
      const alreadyPlanned = new Set(existing.map((absence) => absence.person.toLocaleLowerCase("de")));
      const byDate = new Map<string, string[]>();
      for (const suggestion of result.suggestions) {
        if (alreadyPlanned.has(suggestion.person.toLocaleLowerCase("de"))) continue;
        for (const iso of suggestion.dates) {
          byDate.set(iso, [...(byDate.get(iso) ?? []), suggestion.person]);
        }
      }
      const nextRows = rows.map((row) => {
        if (row.Abschnitt !== "Frei") return row;
        const next = { ...row };
        dayLabels.forEach((label, index) => {
          const names = byDate.get(weekDates[index]) ?? [];
          if (!names.length) return;
          const cell = (next[label] ?? "").trim();
          const present = new Set(splitNames(cell).map((name) => name.toLocaleLowerCase("de")));
          const fresh = names.filter((name) => !present.has(name.toLocaleLowerCase("de")));
          if (fresh.length) next[label] = cell ? `${cell}, ${fresh.join(", ")}` : fresh.join(", ");
        });
        return next;
      });
      const manual = result.needs_manual.length
        ? ` ${result.needs_manual.length} Mitarbeiter benötigen weiterhin eine manuelle Entscheidung.`
        : "";
      setAutomationPreview({
        kind: "free-suggestion",
        title: "Freie Tage optimieren",
        description: `Bestehende Frei-Einträge bleiben unverändert; nur fehlende Vorschläge werden ergänzt.${manual}`,
        applyLabel: "Freie Tage übernehmen",
        diff: diffPlanRows(rows, nextRows, dayLabels),
        nextRows,
        successMessage: "Vorgeschlagene freie Tage wurden übernommen. Prüfe danach die automatische Verteilung.",
      });
      setMessage(null);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Vorschau konnte nicht erstellt werden." });
    } finally {
      setBusy(false);
    }
  }

  function applyAutomationPreview() {
    if (!automationPreview) return;
    const preview = automationPreview;
    setAutomationPreview(null);
    auditEventsRef.current.push({
      event_type: "automation_applied",
      cause: "automation",
      metadata: {
        kind: preview.kind,
        title: preview.title,
        changed_cells: preview.diff.changes.length,
      },
    });
    if (preview.result) {
      applyGeneratedPlan(preview.result, preview.nextRows, preview.kind === "recalculate");
      return;
    }
    setRows(preview.nextRows);
    markDirty(Math.max(1, preview.diff.changes.length));
    resetHistory();
    setMessage({ kind: "success", text: preview.successMessage });
  }

  async function performSave(): Promise<boolean> {
    if (!rows.length) return false;
    if (!resolvedTemplateWeekId) {
      setMessage({ kind: "error", text: "Bitte den Plan zuerst neu erstellen." });
      return false;
    }
    setBusy(true);
    setSaveState("saving");
    try {
      const result = await savePlan({
        start_date: startDate,
        end_date: addDays(startDate, 6),
        template_week_id: resolvedTemplateWeekId,
        existing_week_id: loadedArchivedWeek?.id,
        day_labels: dayLabels,
        rows,
        audit_events: auditEventsRef.current,
      });
      const savedEndDate = addDays(startDate, 6);
      const fallbackWeek: WeekSummary = {
        id: result.week_plan_id,
        kw: isoWeek(startDate),
        start_date: startDate,
        end_date: savedEndDate,
        source: null,
        label: `KW${isoWeek(startDate)} · ${formatDateRange(startDate, savedEndDate)}`,
        assignment_count: 0,
        absence_count: 0,
      };
      let savedWeek = result.week ?? fallbackWeek;
      let refreshedWeeks: WeekSummary[] | null = null;

      // Ältere, noch laufende Backend-Prozesse liefern nach dem Speichern nur
      // week_plan_id. In diesem Fall laden wir die Archivübersicht nach und
      // bleiben selbst dann funktionsfähig, wenn dieser zweite Abruf scheitert.
      if (!result.week) {
        try {
          refreshedWeeks = await getWeeks();
          savedWeek =
            refreshedWeeks.find((week) => week.id === result.week_plan_id) ??
            refreshedWeeks.find((week) => week.start_date === startDate) ??
            fallbackWeek;
        } catch {
          // Der Plan selbst wurde bereits erfolgreich gespeichert. Die lokal
          // erzeugte Zusammenfassung reicht bis zum nächsten Seitenabruf aus.
        }
      }
      const saveWarnings = result.warnings ?? [];
      // Ab dem ersten erfolgreichen Speichern ist dies ein bestehender
      // Archivplan. Dadurch aktualisiert jeder weitere Klick exakt dieselbe
      // Woche, statt einen zweiten Datensatz anzulegen.
      setLoadedArchivedWeek(savedWeek);
      setArchivedWeeks((current) =>
        refreshedWeeks ?? [
          savedWeek,
          ...current.filter(
            (week) =>
              week.id !== savedWeek.id &&
              week.start_date !== savedWeek.start_date,
          ),
        ],
      );
      setMessage({
        kind: saveWarnings.length ? "info" : "success",
        text: loadedArchivedWeek
          ? `${savedWeek.label} wurde mit deinen Änderungen aktualisiert.${
              saveWarnings.length
                ? ` Planungs-Hinweis: ${saveWarnings.slice(0, 2).join(" · ")}`
                : ""
            }`
          : `Plan gespeichert (Archiv-Nr. ${result.week_plan_id}).${
              saveWarnings.length
                ? ` Planungs-Hinweis: ${saveWarnings.slice(0, 2).join(" · ")}`
                : ""
            }`,
      });
      clearDirty();
      setSaveState("saved");
      setSaveError("");
      setLastSavedAt(new Date());
      return true;
    } catch (error) {
      const text = error instanceof Error ? error.message : "Speichern fehlgeschlagen.";
      setMessage({ kind: "error", text });
      setSaveState("error");
      setSaveError(text);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function performExport() {
    if (!xlsxSheet || !rows.length) return;
    setBusy(true);
    try {
      const blob = await xlsxGenerate({
        template_code: templateCode,
        start_date: startDate,
        day_labels: dayLabels,
        rows,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Dienstplan_${startDate}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      setExported(true);
      setMessage({ kind: "success", text: "Excel-Dienstplan wurde erstellt und heruntergeladen." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Excel-Export fehlgeschlagen." });
    } finally {
      setBusy(false);
    }
  }

  // Speichern/Exportieren mit Konflikten (Sprint 3, Aufgabe 8): beide nutzen
  // dieselbe validation.summary wie Toolbar und Konfliktpanel, keine separate
  // Berechnung. Nur die primären Nutzeraktionen laufen über diese Gate-
  // Funktionen - das interne "Erst speichern" innerhalb der Neuberechnen-/
  // Neuaufbauen-Dialoge ruft weiterhin performSave() direkt auf, sonst gäbe
  // es dort eine verwirrende doppelte Rückfrage.
  async function save(): Promise<boolean> {
    if (validation.summary.blockingIssues > 0) {
      setPendingAction({ kind: "save-with-conflicts" });
      return false;
    }
    return performSave();
  }

  async function exportExcel() {
    if (validation.summary.blockingIssues > 0) {
      setPendingAction({ kind: "export-with-conflicts" });
      return;
    }
    await performExport();
  }

  function applyWeekChange(value: string) {
    setStartDate(value);
    if (value) setTemplateCode(templateCodeForDate(value));
    setRows([]);
    setDayLabels([]);
    setWeekDates([]);
    setRehearsalIntervals([]);
    setShowDates([]);
    setOnStageByDate({});
    setOnStageShowsByDate({});
    setDekoPeople([]);
    setPreviousWeekWorkload({});
    setLoadedArchivedWeek(null);
    loadedArchiveKeyRef.current = null;
    setExported(false);
    setActiveStep(1);
    clearDirty();
    setSaveState("idle");
    setSaveError("");
    setLastSavedAt(null);
    resetHistory();
  }

  function requestWeekChange(value: string) {
    if (isDirty) {
      setPendingAction({ kind: "week-change", nextDate: value });
    } else {
      applyWeekChange(value);
    }
  }

  function closeConfirmDialog() {
    setPendingAction(null);
  }

  function popLastMarker(list: ("grid" | "custom")[], kind: "grid" | "custom") {
    const index = list.lastIndexOf(kind);
    if (index >= 0) list.splice(index, 1);
  }

  function handleUndo() {
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
      auditEventsRef.current.push({ event_type: "undo", cause: "undo" });
    }
    refreshGridHistory();
  }

  function handleRedo() {
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
      auditEventsRef.current.push({ event_type: "redo", cause: "redo" });
    }
    refreshGridHistory();
  }

  const weekLabel = `KW ${isoWeek(startDate)} · ${selectedTemplate?.name ?? `Woche ${templateCode}`}`;
  const visibleRowCount = rows.filter((row) => row._row_type !== "group").length;

  if (initializing) {
    return (
      <div className="mx-auto max-w-[1900px] plan-editor-page">
        <PlanEditorInitialLoading startDate={startDate} />
      </div>
    );
  }

  const toolbar = rows.length > 0 && (
    <PlanEditorToolbar
      weekLabel={weekLabel}
      rowCount={visibleRowCount}
      canUndo={gridHistory.canUndo}
      canRedo={gridHistory.canRedo}
      onUndo={handleUndo}
      onRedo={handleRedo}
      saveState={saveState}
      isDirty={isDirty}
      saveError={saveError}
      onSave={save}
      busy={busy}
      onExport={exportExcel}
      exportDisabled={!xlsxSheet}
      tools={[
        {
          label: "Freie Tage optimieren",
          description: "Fehlende Frei-Muster ergänzen und vorher als Vergleich prüfen.",
          onClick: prepareFreeSuggestionPreview,
          disabled: busy,
        },
        {
          label: "Automatische Verteilung verbessern",
          description: "Personenzuweisungen neu verteilen; Infos und Abwesenheiten bleiben erhalten.",
          onClick: () => prepareGeneratedPreview(true),
          disabled: busy,
        },
        {
          label: "Plan komplett neu erstellen",
          description: "Alle Planfelder durch einen neuen Vorschlag ersetzen.",
          onClick: () => prepareGeneratedPreview(false),
          disabled: busy,
        },
      ]}
      validationSummary={validation.summary}
      validationStatus={validation.failed ? "failed" : "idle"}
      onOpenValidation={() => setIssuesPanelOpen(true)}
      qualityScore={planQuality?.score}
      qualityStatus={planQuality?.status}
      qualityLoading={qualityLoading}
      onOpenIntelligence={() => setIntelligenceOpen(true)}
      viewControls={
        <EditorViewControls
          density={density}
          onDensityChange={handleDensityChange}
        />
      }
    />
  );

  const gridSection = rows.length > 0 && (
    <>
      <section className="panel plan-grid-shell overflow-hidden">
        <div className="plan-grid-scroll-shell">
          <div className={`plan-grid plan-grid-week plan-density-${density} ${hasExistingPlan ? "h-[calc(100vh-244px)]" : "h-[calc(100vh-300px)]"} min-h-[520px]`}>
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
                refreshGridHistory();
              }}
              onCellValueChanged={(event: CellValueChangedEvent<PlanRow>) => {
                // KEIN setRows(...) hier: AG Grid mutiert event.data (dasselbe
                // Objekt wie in rows) bereits direkt, und markDirty löst ohnehin
                // einen Re-Render aus. Ein neues rowData-Array-Objekt an AG Grid
                // zu geben, hätte hier den undoRedoCellEditing-Stack invalidiert
                // (jede Zuweisung machte Rückgängig sofort wieder wirkungslos).
                if (event.oldValue !== event.newValue) {
                  const field = event.colDef.field;
                  if (field && event.data) {
                    const key = cellIssueKey(rowKey(event.data), field);
                    manuallyEditedCellsRef.current.add(key);
                    auditEventsRef.current.push({
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
                  markDirty(1);
                }
                refreshGridHistory();
              }}
              onUndoStarted={() => {
                gridUndoInFlightRef.current = true;
              }}
              onUndoEnded={(event: { operationPerformed: boolean }) => {
                gridUndoInFlightRef.current = false;
                if (event.operationPerformed) {
                  popLastMarker(actionOrderRef.current, "grid");
                  redoOrderRef.current.push("grid");
                }
                refreshGridHistory();
              }}
              onRedoStarted={() => {
                gridUndoInFlightRef.current = true;
              }}
              onRedoEnded={(event: { operationPerformed: boolean }) => {
                gridUndoInFlightRef.current = false;
                if (event.operationPerformed) {
                  popLastMarker(redoOrderRef.current, "grid");
                  actionOrderRef.current.push("grid");
                }
                refreshGridHistory();
              }}
              onCellClicked={(event: CellClickedEvent<PlanRow>) => {
                const field = event.colDef.field;
                // AP8: kein unnötiges setActiveDay, wenn der Tag bereits aktiv
                // ist - vermeidet ein wirkungsloses Re-Render bei Klicks
                // innerhalb derselben Spalte.
                if (field && dayLabels.includes(field) && field !== activeDayStore.get()) {
                  setActiveDay(field);
                }
              }}
              getRowId={(params) => rowKey(params.data)}
            />
          </div>
        </div>
      </section>
    </>
  );

  return (
    <div className="mx-auto max-w-[1900px] plan-editor-page">
      {hasExistingPlan ? (
        <PlanEditorSummary
          kw={isoWeek(startDate)}
          dateRange={formatDateRange(startDate, addDays(startDate, 6))}
          programLabel={`${selectedTemplate?.name ?? `Woche ${templateCode}`} – ${selectedTemplate?.program ?? ""}`}
          artistPlanReady={Boolean(artistPlanForWeek)}
          rehearsalPlanReady={Boolean(rehearsalPlanForWeek)}
          peopleCount={people.length}
          weekPicker={
            <div className="plan-editor-week-nav" aria-label="Planwoche wechseln">
              <button
                type="button"
                className="btn btn-icon plan-editor-week-arrow"
                onClick={() => requestWeekChange(addDays(startDate, -7))}
                aria-label="Vorherige Woche"
                title="Vorherige Woche"
              >
                ‹
              </button>
              <WeekPicker
                className="planner-week-picker plan-editor-summary-week-picker"
                label="Andere Planwoche öffnen"
                value={startDate}
                onChange={requestWeekChange}
              />
              <button
                type="button"
                className="btn btn-icon plan-editor-week-arrow"
                onClick={() => requestWeekChange(addDays(startDate, 7))}
                aria-label="Nächste Woche"
                title="Nächste Woche"
              >
                ›
              </button>
            </div>
          }
        />
      ) : (
        <>
          <PageHeader
            title="Dienstplan erstellen"
            subtitle="In vier klaren Schritten vom Wochenprogramm bis zur fertigen Excel-Datei"
          />

          <section className="planner-week-context">
            <div>
              <span className="planner-week-eyebrow">Aktuelle Planung</span>
              <strong>KW {isoWeek(startDate)} · {selectedTemplate?.name ?? `Woche ${templateCode}`}</strong>
              <span>{selectedTemplate?.program ?? "Wochenprogramm"}</span>
            </div>
            <div className="plan-editor-week-nav" aria-label="Planwoche wechseln">
              <button
                type="button"
                className="btn btn-icon plan-editor-week-arrow"
                onClick={() => requestWeekChange(addDays(startDate, -7))}
                aria-label="Vorherige Woche"
                title="Vorherige Woche"
              >
                ‹
              </button>
              <WeekPicker
                className="planner-week-picker plan-editor-summary-week-picker"
                label="Planwoche beginnt am"
                value={startDate}
                onChange={requestWeekChange}
              />
              <button
                type="button"
                className="btn btn-icon plan-editor-week-arrow"
                onClick={() => requestWeekChange(addDays(startDate, 7))}
                aria-label="Nächste Woche"
                title="Nächste Woche"
              >
                ›
              </button>
            </div>
          </section>

          <nav className="planner-steps" aria-label="Schritte der Dienstplanerstellung">
            {stepStates.map((step) => (
              <button
                key={step.number}
                type="button"
                className={`planner-step ${activeStep === step.number ? "is-active" : ""} ${step.complete ? "is-complete" : ""}`}
                onClick={() => setActiveStep(step.number)}
                aria-current={activeStep === step.number ? "step" : undefined}
              >
                <span className="planner-step-marker">
                  {step.complete ? "✓" : step.number}
                </span>
                <span className="planner-step-copy">
                  <small>{step.eyebrow}</small>
                  <strong>{step.title}</strong>
                  <span>{step.description}</span>
                </span>
              </button>
            ))}
          </nav>
        </>
      )}

      {message && <div className={`status status-${message.kind}`}>{message.text}</div>}

      {!hasExistingPlan && activeStep === 1 && (
        <section className="panel wizard-stage">
          <div className="wizard-stage-head">
            <span className="wizard-stage-number">01</span>
            <div>
              <h2>Künstlerprogramm vorbereiten</h2>
              <p>Shows, Partys, DJs, Chillout und Aperitif werden später automatisch in den Dienstplan übernommen.</p>
            </div>
          </div>
          <PreparationStatusCard
            ready={Boolean(artistPlanForWeek)}
            readyLabel={artistPlanForWeek?.sheet_name || artistPlanForWeek?.source_filename || "Künstlerplan"}
            readyDetail={`${artistPlanForWeek?.filled_entries ?? 0} Programmeinträge`}
            emptyIcon="K"
            emptyTitle="Künstlerplan hochladen"
            emptyDescription="Excel-Datei auswählen, Woche prüfen und für den Dienstplan aktivieren."
            href="/artist-plan"
            openLabel="Künstlerplan öffnen"
          />
          <div className="wizard-actions">
            <span>Der Schritt wird automatisch abgehakt, sobald der Plan für diese Woche gespeichert ist.</span>
            <button className="btn btn-primary" onClick={() => setActiveStep(2)}>
              Weiter zum Probenplan
            </button>
          </div>
        </section>
      )}

      {!hasExistingPlan && activeStep === 2 && (
        <section className="panel wizard-stage">
          <div className="wizard-stage-head">
            <span className="wizard-stage-number">02</span>
            <div>
              <h2>Proben und Verfügbarkeiten einlesen</h2>
              <p>Teilnehmer und Tanzchoreografen werden während ihrer Probe automatisch für parallele Dienste gesperrt.</p>
            </div>
          </div>
          <PreparationStatusCard
            ready={Boolean(rehearsalPlanForWeek)}
            readyLabel={rehearsalPlanForWeek?.source_filename || "Probenplan"}
            readyDetail={`${rehearsalPlanForWeek?.rehearsal_count ?? 0} Proben`}
            emptyIcon="P"
            emptyTitle="Probenplan hochladen"
            emptyDescription="PDF lokal auswerten, erkannte Zeiten prüfen und für diese Woche aktivieren."
            href="/rehearsal-plan"
            openLabel="Probenplan öffnen"
          />
          <div className="wizard-actions">
            <button className="btn" onClick={() => setActiveStep(1)}>Zurück</button>
            <button className="btn btn-primary" onClick={() => setActiveStep(3)}>
              Weiter zur Dienstplanung
            </button>
          </div>
        </section>
      )}

      {(hasExistingPlan || activeStep === 3) && (
        <>
          {!hasExistingPlan && (
            <section className="panel wizard-stage">
              <div className="wizard-stage-head compact">
                <span className="wizard-stage-number">03</span>
                <div>
                  <h2>Dienstplan erstellen und bearbeiten</h2>
                  <p>Grundwoche wählen, Vorschlag erzeugen und Zuweisungen direkt im Plan anpassen.</p>
                </div>
              </div>
              <div className="planner-config">
                <div className="field field-grow planner-template-field">
                  <span className="field-label">Programm-Rhythmus</span>
                  <div className="template-choice-grid">
                    {templates.map((template) => (
                      <button
                        key={template.code}
                        type="button"
                        className={`template-choice ${templateCode === template.code ? "is-selected" : ""}`}
                        onClick={() => setTemplateCode(template.code)}
                      >
                        <span>{template.name}</span>
                        <strong>{template.program}</strong>
                        <small>{template.code === "A" ? "Ungerade Kalenderwochen" : "Gerade Kalenderwochen"}</small>
                      </button>
                    ))}
                  </div>
                </div>
                {!rows.length && (
                  <div className="planner-config-actions">
                    <button className="btn btn-primary" disabled={busy} onClick={() => generate(false)}>
                      {busy && <span className="spinner" />}
                      Dienstplan erstellen
                    </button>
                  </div>
                )}
              </div>
              <div className="planner-source-status">
                <span className={artistPlanForWeek ? "is-ready" : ""}>
                  {artistPlanForWeek ? "✓" : "–"} Künstlerplan
                </span>
                <span className={rehearsalPlanForWeek ? "is-ready" : ""}>
                  {rehearsalPlanForWeek ? "✓" : "–"} Probenplan
                </span>
                <span>✓ Planungsregeln</span>
                <span>✓ {people.length} aktive MA</span>
              </div>
            </section>
          )}

          {rows.length > 0 ? (
            <>
              {toolbar}
              <PlanViewSwitcher mode={viewMode} onChange={setViewMode} />
              <div style={viewMode === "day" ? undefined : { display: "none" }}>
                <PlanDayView
                  rows={rows}
                  dayLabels={dayLabels}
                  weekDates={weekDates}
                  activeDay={effectiveActiveDay}
                  onSelectDay={selectDay}
                  statuses={dayStatuses}
                  issues={validation.issues}
                  people={people}
                  isPersonSection={isPersonSection}
                  isAbsenceSection={isAbsenceSection}
                  getCandidates={getCandidatesFor}
                  getSuggestions={getSuggestionsFor}
                  onCommitEntry={commitDayEntry}
                  onApplyChanges={(changes, cause) =>
                    applyPlanChanges(
                      changes.map((change) => ({
                        row: change.row as PlanRow,
                        dayLabel: change.dayLabel,
                        nextValue: change.nextValue,
                      })),
                      cause,
                    )
                  }
                />
              </div>
              {/* AG Grid bleibt beim Moduswechsel gemountet (nur per CSS versteckt) -
                  ein Remount würde Undo/Redo-Historie und Scrollposition verlieren. */}
              <div style={viewMode === "week" ? undefined : { display: "none" }}>
                {gridSection}
              </div>
            </>
          ) : (
            <section className="planner-empty-state">
              <span>03</span>
              <strong>Bereit für den Planungsvorschlag</strong>
              <p>Mit „Dienstplan erstellen“ werden Programm, Proben, Abwesenheiten, Abteilungen und faire Verteilung zusammengeführt.</p>
            </section>
          )}
        </>
      )}

      {!hasExistingPlan && activeStep === 4 && (
        <section className="panel wizard-stage">
          <div className="wizard-stage-head">
            <span className="wizard-stage-number">{exported ? "✓" : "04"}</span>
            <div>
              <h2>Dienstplan abschließen</h2>
              <p>Den geprüften Plan im Archiv sichern und im Originaldesign als Excel-Datei ausgeben.</p>
            </div>
          </div>
          {rows.length > 0 ? (
            <div className="export-choice-grid">
              <div className="export-choice">
                <span className="export-choice-icon">A</span>
                <div>
                  <small>Interne Sicherung</small>
                  <strong>Änderungen speichern</strong>
                  <p>Der aktuelle Stand bleibt im Dashboard und in den Auswertungen verfügbar.</p>
                </div>
                <button className="btn" disabled={busy} onClick={save}>Speichern</button>
              </div>
              <div className={`export-choice is-primary ${exported ? "is-complete" : ""}`}>
                <span className="export-choice-icon">{exported ? "✓" : "X"}</span>
                <div>
                  <small>{exported ? "Erfolgreich erstellt" : "Originalvorlage"}</small>
                  <strong>Excel-Dienstplan herunterladen</strong>
                  <p>Farben, Zeilen und verbundene Felder entsprechen der gewählten A-/B-Vorlage.</p>
                </div>
                <button className="btn btn-primary" disabled={busy || !xlsxSheet} onClick={exportExcel}>
                  {exported ? "Erneut herunterladen" : "Excel erstellen"}
                </button>
              </div>
            </div>
          ) : (
            <div className="preparation-card">
              <span className="preparation-icon">!</span>
              <div className="preparation-copy">
                <small>Noch kein Dienstplan</small>
                <strong>Zuerst den Wochenplan erstellen</strong>
                <span>Nach der Erstellung erscheint hier der Excel-Export.</span>
              </div>
              <button className="btn btn-primary" onClick={() => setActiveStep(3)}>Zur Dienstplanung</button>
            </div>
          )}
          <div className="wizard-actions">
            <button className="btn" onClick={() => setActiveStep(3)}>Plan nochmals prüfen</button>
            {exported && <span className="wizard-complete-note">✓ Workflow abgeschlossen</span>}
          </div>
        </section>
      )}

      {pendingAction?.kind === "week-change" && (
        <ConfirmDialog
          open
          title="Ungespeicherte Änderungen"
          description={
            <p>
              Für die aktuelle Woche gibt es {changeCount} ungespeicherte {changeCount === 1 ? "Änderung" : "Änderungen"}.
              Wenn du fortfährst, gehen diese verloren, sofern du sie nicht vorher speicherst.
            </p>
          }
          actions={[
            { label: "Abbrechen", onClick: closeConfirmDialog, variant: "default" },
            {
              label: "Änderungen verwerfen",
              variant: "danger",
              onClick: () => {
                const next = pendingAction.nextDate;
                closeConfirmDialog();
                applyWeekChange(next);
              },
            },
            {
              label: "Änderungen speichern",
              variant: "primary",
              autoFocus: true,
              onClick: async () => {
                const next = pendingAction.nextDate;
                closeConfirmDialog();
                const ok = await performSave();
                if (ok) applyWeekChange(next);
              },
            },
          ]}
          onDismiss={closeConfirmDialog}
        />
      )}

      {pendingAction?.kind === "save-with-conflicts" && (
        <ConfirmDialog
          open
          title="Dienstplan mit Konflikten speichern?"
          description={
            <>
              <p>Der Plan enthält:</p>
              <ul>
                {validation.summary.errors > 0 && (
                  <li>
                    {validation.summary.errors} {validation.summary.errors === 1 ? "kritischen Konflikt" : "kritische Konflikte"}
                  </li>
                )}
                {validation.summary.understaffed > 0 && (
                  <li>
                    {validation.summary.understaffed} {validation.summary.understaffed === 1 ? "unbesetzten Pflichtdienst" : "unbesetzte Pflichtdienste"}
                  </li>
                )}
              </ul>
              <p>Der Plan kann trotzdem gespeichert werden.</p>
            </>
          }
          actions={[
            { label: "Abbrechen", onClick: closeConfirmDialog, variant: "default" },
            {
              label: "Planprüfung öffnen",
              variant: "default",
              onClick: () => { closeConfirmDialog(); setIssuesPanelOpen(true); },
            },
            {
              label: "Trotzdem speichern",
              variant: "primary",
              autoFocus: true,
              onClick: () => { closeConfirmDialog(); void performSave(); },
            },
          ]}
          onDismiss={closeConfirmDialog}
        />
      )}

      {pendingAction?.kind === "export-with-conflicts" && (
        <ConfirmDialog
          open
          title="Dienstplan mit Konflikten exportieren?"
          description={
            <p>
              Der Export enthält {validation.summary.errors}{" "}
              {validation.summary.errors === 1 ? "kritischen Konflikt" : "kritische Konflikte"}.
            </p>
          }
          actions={[
            { label: "Abbrechen", onClick: closeConfirmDialog, variant: "default" },
            {
              label: "Planprüfung öffnen",
              variant: "default",
              onClick: () => { closeConfirmDialog(); setIssuesPanelOpen(true); },
            },
            {
              label: "Trotzdem exportieren",
              variant: "primary",
              autoFocus: true,
              onClick: () => { closeConfirmDialog(); void performExport(); },
            },
          ]}
          onDismiss={closeConfirmDialog}
        />
      )}

      {automationPreview && (
        <PlanPreviewDialog
          open
          title={automationPreview.title}
          description={automationPreview.description}
          diff={automationPreview.diff}
          busy={busy}
          applyLabel={automationPreview.applyLabel}
          onApply={applyAutomationPreview}
          onDismiss={() => setAutomationPreview(null)}
        />
      )}

      <PlanIssuesPanel
        open={issuesPanelOpen}
        issues={validation.issues}
        summary={validation.summary}
        failed={validation.failed}
        onClose={() => setIssuesPanelOpen(false)}
        onNavigate={(issue) => navigateToIssue(issue)}
        onEdit={(issue) => navigateToIssue(issue, { openEditor: true })}
        onRefresh={() => setRevalidateNonce((current) => current + 1)}
      />
      <PlanIntelligenceDialog
        open={intelligenceOpen}
        quality={planQuality}
        weekPlanId={loadedArchivedWeek?.id}
        startDate={startDate}
        onClose={() => setIntelligenceOpen(false)}
      />
    </div>
  );
}
