"use client";

import PageHeader from "@/components/PageHeader";
import PersonCellEditor from "@/components/PersonCellEditor";
import PlanEditorSummary from "@/components/PlanEditorSummary";
import PlanEditorToolbar from "@/components/PlanEditorToolbar";
import SoftsportCellEditor from "@/components/SoftsportCellEditor";
import DayHeaderCell from "@/components/plan-editor/DayHeaderCell";
import EditorViewControls from "@/components/plan-editor/EditorViewControls";
import PlanDayView from "@/components/plan-editor/PlanDayView";
import PlanViewSwitcher from "@/components/plan-editor/PlanViewSwitcher";
import {
  generatePlan,
  getArchivedPlan,
  getFreeSuggestion,
  getPlanQuality,
  type AssignmentRule,
  type PlanGenerateResult,
  type PlanQualityResult,
  type PreviousWeekWorkload,
  type RehearsalInterval,
  type WeekSummary,
  xlsxGenerate,
} from "@/lib/api";
import { hexToRgba } from "@/lib/categoryColors";
import { diffPlanRows } from "@/lib/plan-editor/planDiff";
import { computeDayStatuses } from "@/lib/plan-editor/dayStatus";
import { collectCategorySuggestions } from "@/lib/plan-editor/entryFieldType";
import { useGridDayIndicators } from "@/lib/plan-editor/useGridDayIndicators";
import {
  usePlanViewPreferences,
  type PlanDensity,
  type PlanEditorViewMode,
} from "@/lib/plan-editor/viewPreferences";
import {
  buildCellIssueIndex,
  cellIssueKey,
  validatePlanSafe,
  type PlanIssue,
} from "@/lib/planValidation";
import { recommendForCell, serviceIntervalLabel } from "@/lib/recommendations";
import { useUnsavedChangesGuard } from "@/lib/useUnsavedChangesGuard";
import "@/lib/ag-grid-setup";
import type { ColDef, GridApi } from "ag-grid-community";
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";

import EditorDialogs from "./components/EditorDialogs";
import PlanGrid from "./components/PlanGrid";
import { ArtistPlanStep, ExportStep, RehearsalPlanStep, TemplateChoiceStep } from "./components/PlanWizardSteps";
import WeekNavigation from "./components/WeekNavigation";
import { usePlanHistory } from "./hooks/usePlanHistory";
import { usePlanPersistence } from "./hooks/usePlanPersistence";
import type { AutomationPreview, PendingAction, PlanRow } from "./types";
import {
  ABSENCE_SECTIONS,
  PlanEditorInitialLoading,
  addDays,
  assignRowIds,
  collectAbsences,
  formatDateRange,
  isoWeek,
  mergeGeneratedPersonCell,
  mondayIso,
  rowCategory,
  rowColor,
  rowKey,
  serviceExtraLabel,
  shortDateLabelFor,
  splitNames,
  templateCodeForDate,
  weekdayLabelFor,
} from "./utils/planEditorHelpers";

export default function PlanEditorPage() {
  const initialStart = useMemo(() => mondayIso(), []);
  const [templateCode, setTemplateCode] = useState<"A" | "B">(() => templateCodeForDate(initialStart));
  const [resolvedTemplateWeekId, setResolvedTemplateWeekId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState(initialStart);
  const [rows, setRowsRaw] = useState<PlanRow[]>([]);
  // Sprint 0 (S1-Fix, C4): einziger Weg, `rows` zu setzen - normalisiert dabei
  // immer über assignRowIds(), damit jede Zeile eine stabile, eindeutige
  // _row_id trägt (Grid-Identität, manuell-bearbeitet-Markierung,
  // Planprüfung). Bereits vergebene IDs bleiben unverändert erhalten.
  const setRows = useCallback((update: SetStateAction<PlanRow[]>) => {
    setRowsRaw((previous) =>
      assignRowIds(typeof update === "function" ? (update as (prev: PlanRow[]) => PlanRow[])(previous) : update),
    );
  }, []);
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
  const [loadedArchivedWeek, setLoadedArchivedWeek] = useState<WeekSummary | null>(null);
  const [activeStep, setActiveStep] = useState(1);
  const [exported, setExported] = useState(false);
  const loadedArchiveKeyRef = useRef<string | null>(null);

  // ---------- Sprint 4: Arbeitsansicht ----------
  // Sprint 0 (S1-Fix, C5): useSyncExternalStore statt localStorage im
  // State-Initializer - Letzteres lief während des Renders, auch beim
  // allerersten Client-Render vor der Hydration. Der Server kennt den
  // gespeicherten Wert nie und rendert immer die Defaults; ein Client, der
  // sofort den echten Wert einliest, weicht vom SSR-Markup ab
  // (Hydration-Mismatch, sichtbar an plan-density-*). usePlanViewPreferences
  // liefert serverseitig deterministisch die Defaults, zieht die echte
  // Präferenz clientseitig sicher nach (siehe lib/plan-editor/viewPreferences.ts).
  const [viewPreferences, setViewPreferences] = usePlanViewPreferences();
  const { density, viewMode } = viewPreferences;
  const setViewMode = useCallback((nextMode: PlanEditorViewMode) => {
    setViewPreferences((current) => ({ ...current, viewMode: nextMode }));
  }, [setViewPreferences]);
  const [activeDay, setActiveDay] = useState("");
  const [automationPreview, setAutomationPreview] = useState<AutomationPreview | null>(null);

  // ---------- Sprint 5: Intelligence & Audit ----------
  const [planQuality, setPlanQuality] = useState<PlanQualityResult | null>(null);
  const [qualityLoading, setQualityLoading] = useState(false);
  const [intelligenceOpen, setIntelligenceOpen] = useState(false);

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  // ---------- Planprüfung (Sprint 3) ----------
  const [issuesPanelOpen, setIssuesPanelOpen] = useState(false);
  // Die Prüfung läuft ohnehin reaktiv (siehe validation-useMemo); dieser Zähler
  // erzwingt bei Bedarf trotzdem einen echten Neu-Lauf (z.B. "Erneut prüfen"
  // nach einem Prüf-Fehler, bei dem sich sonst nichts an den Eingaben ändert).
  const [revalidateNonce, setRevalidateNonce] = useState(0);
  const cellIssueIndexRef = useRef<Map<string, PlanIssue[]>>(new Map());

  const gridApiRef = useRef<GridApi<PlanRow> | null>(null);

  const effectiveActiveDay = useMemo(() => {
    if (dayLabels.includes(activeDay)) return activeDay;
    const todayIso = new Date().toLocaleDateString("sv-SE");
    const todayIndex = weekDates.indexOf(todayIso);
    return dayLabels[todayIndex >= 0 ? todayIndex : 0] ?? "";
  }, [activeDay, dayLabels, weekDates]);

  // ---------- AP12: Referenzdaten laden, Dirty-Tracking, Speichern ----------
  const persistence = usePlanPersistence({
    gridApiRef,
    rows,
    dayLabels,
    startDate,
    resolvedTemplateWeekId,
    loadedArchivedWeek,
    onLoadedArchivedWeekChange: setLoadedArchivedWeek,
    onMessage: setMessage,
    onBusyChange: setBusy,
    onReferenceDataLoaded: (storedWeeks) => {
      if (!storedWeeks.some((week) => week.start_date === mondayIso())) {
        setInitializing(false);
      }
    },
    onReferenceDataError: (errorMessage) => {
      setInitializing(false);
      setMessage({ kind: "error", text: errorMessage });
    },
  });
  const {
    templates,
    people,
    artistPlans,
    rehearsalPlans,
    archivedWeeks,
    isDirty,
    changeCount,
    saveState,
    saveError,
    manuallyEditedCellsRef,
    auditEventsRef,
    markDirty,
    clearDirty,
    resetSaveStatus,
    recordAudit,
    markManuallyEdited,
    performSave,
  } = persistence;

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

  // ---------- AP12: Undo/Redo ----------
  const history = usePlanHistory({
    gridApiRef,
    onMarkDirty: markDirty,
    onRecordAudit: recordAudit,
    onMarkManuallyEdited: markManuallyEdited,
  });
  const { gridHistory, refreshGridHistory, resetHistory, applyPlanChanges, commitDayEntry, handleUndo, handleRedo } =
    history;

  useEffect(() => {
    if (!rows.length || !dayLabels.length) return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setQualityLoading(true);
      getPlanQuality(
        {
          start_date: startDate,
          day_labels: dayLabels,
          rows: rows.map((row) => ({ ...row })),
        },
        controller.signal,
      )
        .then((result) => {
          if (!cancelled) setPlanQuality(result);
        })
        .catch(() => {
          // Abgebrochene Requests (Wochenwechsel, neue Zellbearbeitung
          // während eine ältere Prüfung noch läuft) sind kein sichtbarer
          // Fehler - `cancelled` ist in diesem Fall bereits true.
          if (!cancelled) setPlanQuality(null);
        })
        .finally(() => {
          if (!cancelled) setQualityLoading(false);
        });
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
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
    const controller = new AbortController();
    getArchivedPlan(startDate, controller.signal)
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
        resetSaveStatus();
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
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archivedWeeks, startDate]);

  // ---------- Schutz vor Datenverlust (Sprint 0, S1-Fix C1) ----------
  // Meldet isDirty an die geteilte Registry: sichert beforeunload (Reload/
  // Tab schließen) UND macht den globalen InternalNavigationGuard
  // (Sidebar-/interne Links, siehe app/layout.tsx) für diese Seite aktiv.
  // Der bestehende pendingAction-Mechanismus für Wochenwechsel bleibt
  // unverändert - er behandelt programmatische Navigation innerhalb der
  // Seite selbst, die dieser Hook bewusst nicht abstrahiert.
  useUnsavedChangesGuard(isDirty, {
    message: "Der Dienstplan hat ungespeicherte Änderungen, die dabei verloren gehen.",
  });

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
  }, [setViewPreferences]);

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
                cell_key: cellIssueKey(params.data._row_id, dayLabel),
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
              manuallyEditedCellsRef.current.has(cellIssueKey(params.data._row_id, label)),
          ),
        "plan-cell-issue-error": (params) =>
          Boolean(
            params.data &&
              params.data._row_type !== "group" &&
              cellIssueIndexRef.current
                .get(cellIssueKey(params.data._row_id, label))
                ?.some((issue) => issue.severity === "error"),
          ),
        "plan-cell-issue-warning": (params) => {
          if (!params.data || params.data._row_type === "group") return false;
          const list = cellIssueIndexRef.current.get(
            cellIssueKey(params.data._row_id, label),
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
          cellIssueKey(params.data._row_id, label),
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
    // Stabile Refs aus usePlanPersistence - ESLint kann die Ref-Stabilität
    // über die Hook-Grenze hinweg nicht erkennen; sie ändern ihre Identität
    // nie, das Hinzufügen löst nie eine zusätzliche Neuberechnung aus.
    auditEventsRef,
    manuallyEditedCellsRef,
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
          if (manuallyEditedCellsRef.current.has(cellIssueKey(old._row_id, label))) {
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
    resetSaveStatus();
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
    <PlanGrid
      rows={rows}
      columnDefs={columnDefs}
      density={density}
      hasExistingPlan={hasExistingPlan}
      gridApiRef={gridApiRef}
      onGridReady={refreshGridHistory}
      dayLabels={dayLabels}
      activeDayStore={activeDayStore}
      onCellClickActivatesDay={setActiveDay}
      historyEventHandlers={history.gridEventHandlers}
    />
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
            <WeekNavigation
              startDate={startDate}
              weekPickerLabel="Andere Planwoche öffnen"
              onChange={requestWeekChange}
              addDays={addDays}
            />
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
            <WeekNavigation
              startDate={startDate}
              weekPickerLabel="Planwoche beginnt am"
              onChange={requestWeekChange}
              addDays={addDays}
            />
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
        <ArtistPlanStep artistPlanForWeek={artistPlanForWeek} onContinue={() => setActiveStep(2)} />
      )}

      {!hasExistingPlan && activeStep === 2 && (
        <RehearsalPlanStep
          rehearsalPlanForWeek={rehearsalPlanForWeek}
          onBack={() => setActiveStep(1)}
          onContinue={() => setActiveStep(3)}
        />
      )}

      {(hasExistingPlan || activeStep === 3) && (
        <>
          {!hasExistingPlan && (
            <TemplateChoiceStep
              templates={templates}
              templateCode={templateCode}
              onTemplateCodeChange={setTemplateCode}
              hasRows={rows.length > 0}
              busy={busy}
              onGenerate={() => generate(false)}
              artistPlanReady={Boolean(artistPlanForWeek)}
              rehearsalPlanReady={Boolean(rehearsalPlanForWeek)}
              activePeopleCount={people.length}
            />
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
        <ExportStep
          exported={exported}
          hasRows={rows.length > 0}
          busy={busy}
          onSave={() => void save()}
          onExport={() => void exportExcel()}
          xlsxSheet={xlsxSheet}
          onBackToStep3={() => setActiveStep(3)}
        />
      )}

      <EditorDialogs
        pendingAction={pendingAction}
        changeCount={changeCount}
        onCloseConfirmDialog={closeConfirmDialog}
        onApplyWeekChange={applyWeekChange}
        onPerformSave={performSave}
        onPerformExport={performExport}
        validationSummary={validation.summary}
        onOpenIssuesPanel={() => setIssuesPanelOpen(true)}
        automationPreview={automationPreview}
        busy={busy}
        onApplyAutomationPreview={applyAutomationPreview}
        onDismissAutomationPreview={() => setAutomationPreview(null)}
        issuesPanelOpen={issuesPanelOpen}
        validationIssues={validation.issues}
        validationFailed={validation.failed}
        onCloseIssuesPanel={() => setIssuesPanelOpen(false)}
        onNavigateToIssue={(issue) => navigateToIssue(issue)}
        onEditIssue={(issue) => navigateToIssue(issue, { openEditor: true })}
        onRefreshValidation={() => setRevalidateNonce((current) => current + 1)}
        intelligenceOpen={intelligenceOpen}
        planQuality={planQuality}
        weekPlanId={loadedArchivedWeek?.id}
        startDate={startDate}
        onCloseIntelligence={() => setIntelligenceOpen(false)}
      />
    </div>
  );
}
