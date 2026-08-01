"use client";

import ConfirmDialog, { type ConfirmDialogAction } from "@/components/ConfirmDialog";
import PageHeader from "@/components/PageHeader";
import PersonCellEditor from "@/components/PersonCellEditor";
import PlanEditorSummary from "@/components/PlanEditorSummary";
import PlanEditorToolbar from "@/components/PlanEditorToolbar";
import PlanIssuesPanel from "@/components/PlanIssuesPanel";
import PreparationStatusCard from "@/components/PreparationStatusCard";
import SoftsportCellEditor from "@/components/SoftsportCellEditor";
import WeekPicker from "@/components/WeekPicker";
import {
  generatePlan,
  getActivePeople,
  getArchivedPlan,
  getArtistPlans,
  getFreeSuggestion,
  getPlanTemplates,
  getRehearsalPlans,
  getWeeks,
  savePlan,
  type AssignmentRule,
  type ArtistPlanSummary,
  type ExtractedAbsence,
  type PlanTemplate,
  type PreviousWeekWorkload,
  type RehearsalInterval,
  type RehearsalPlanSummary,
  type WeekSummary,
  xlsxGenerate,
} from "@/lib/api";
import { categoryColor, hexToRgba } from "@/lib/categoryColors";
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
  | { kind: "recalculate" }
  | { kind: "rebuild" }
  | { kind: "free-suggestion" }
  | { kind: "week-change"; nextDate: string }
  | { kind: "save-with-conflicts" }
  | { kind: "export-with-conflicts" };

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

function contrastColor(hex: string): string {
  const color = hex.replace("#", "");
  const r = parseInt(color.slice(0, 2), 16);
  const g = parseInt(color.slice(2, 4), 16);
  const b = parseInt(color.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 145 ? "#171717" : "#ffffff";
}

function GroupHeaderRenderer({ data }: ICellRendererParams<PlanRow>) {
  const color = data?._group_color || "#6c7bff";
  return (
    <div
      className="flex h-full w-full items-center justify-center px-4 text-center text-sm font-extrabold tracking-[0.015em]"
      style={{ backgroundColor: color, color: contrastColor(color) }}
    >
      {data?._group_label}
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

  const refreshGridHistory = useCallback(() => {
    const api = gridApiRef.current;
    if (!api) return;
    setGridHistory({
      canUndo: api.getCurrentUndoSize() > 0,
      canRedo: api.getCurrentRedoSize() > 0,
    });
  }, []);

  const markDirty = useCallback((count = 1) => {
    setIsDirty(true);
    setChangeCount((current) => current + count);
    setSaveState("idle");
  }, []);

  const clearDirty = useCallback(() => {
    setIsDirty(false);
    setChangeCount(0);
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
      revalidateNonce,
    ],
  );

  const cellIssueIndex = useMemo(() => buildCellIssueIndex(validation.issues), [validation.issues]);

  useEffect(() => {
    cellIssueIndexRef.current = cellIssueIndex;
    gridApiRef.current?.refreshCells({ force: true });
  }, [cellIssueIndex]);

  function navigateToIssue(issue: PlanIssue, options?: { openEditor?: boolean }) {
    const ref = issue.primaryCell;
    const api = gridApiRef.current;
    if (!ref || !api) return;
    const node = api.getRowNode(ref.rowId);
    if (!node || node.rowIndex == null) {
      setIssuesPanelOpen(false);
      setMessage({
        kind: "error",
        text: "Diese Stelle gibt es im aktuellen Plan nicht mehr - die Planprüfung wird aktualisiert.",
      });
      return;
    }
    setIssuesPanelOpen(false);
    api.ensureIndexVisible(node.rowIndex, "middle");
    api.ensureColumnVisible(ref.columnId);
    api.setFocusedCell(node.rowIndex, ref.columnId);
    api.flashCells({ rowNodes: [node], columns: [ref.columnId], flashDuration: 1200, fadeDuration: 800 });
    if (options?.openEditor) {
      const rowIndex = node.rowIndex;
      window.setTimeout(() => api.startEditingCell({ rowIndex, colKey: ref.columnId }), 80);
    }
  }

  useEffect(() => {
    const load = () => {
      Promise.all([
        getPlanTemplates(),
        getActivePeople(),
        getArtistPlans(),
        getRehearsalPlans(),
        getWeeks(),
      ])
      .then(([templateData, activePeople, storedArtistPlans, storedRehearsalPlans, storedWeeks]) => {
        setTemplates(templateData);
        setPeople(activePeople);
        setArtistPlans(storedArtistPlans);
        setRehearsalPlans(storedRehearsalPlans);
        setArchivedWeeks(storedWeeks);
      })
      .catch((error) => setMessage({ kind: "error", text: error.message }));
    };
    const timer = window.setTimeout(load, 0);
    window.addEventListener("focus", load);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", load);
    };
  }, []);

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
      })
      .catch((error) => {
        if (!active) return;
        loadedArchiveKeyRef.current = null;
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

  const isPersonSection = useCallback(
    (category: string) => personCategories.has(category) || ABSENCE_SECTIONS.has(category),
    [personCategories],
  );

  const columnDefs = useMemo<ColDef<PlanRow>[]>(() => {
    const fixed: ColDef<PlanRow>[] = [
      {
        field: "Abschnitt",
        headerName: "Abschnitt",
        pinned: "left",
        width: 190,
        editable: false,
        lockPinned: true,
        cellStyle: (params) => ({
          backgroundColor: hexToRgba(rowColor(params.data), 0.32),
          borderLeft: `4px solid ${rowColor(params.data)}`,
          fontWeight: "700",
        }),
      },
      {
        field: "Zeile",
        headerName: "Zeile / Uhrzeit",
        pinned: "left",
        width: 190,
        editable: false,
        lockPinned: true,
        wrapText: true,
        autoHeight: true,
        cellStyle: (params) => ({
          backgroundColor: hexToRgba(rowColor(params.data), 0.18),
          color: "var(--muted)",
          fontWeight: "600",
        }),
      },
    ];
    const days = dayLabels.map<ColDef<PlanRow>>((label) => ({
      field: label,
      headerName: label,
      minWidth: 170,
      flex: 1,
      editable: true,
      singleClickEdit: true,
      wrapText: true,
      autoHeight: true,
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
          },
          popup: true,
          popupPosition: "under",
        };
      },
      cellStyle: (params) => ({
        backgroundColor: hexToRgba(rowColor(params.data), 0.13),
        cursor: "text",
      }),
      // Konfliktmarkierungen (Sprint 3): liest aus einem Ref statt aus einer
      // columnDefs-Abhängigkeit, damit eine neue Planprüfung nicht die
      // komplette Spaltenkonfiguration neu aufbaut - nur ein gezieltes
      // refreshCells() nach der Prüfung (siehe cellIssueIndex-Effekt).
      cellClassRules: {
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
        if (!list || list.length === 0) return undefined;
        const prefix = list.length > 1 ? `${list.length} Probleme: ` : "";
        return prefix + list.map((issue) => issue.description).join(" | ");
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
    weekDates,
  ]);

  /** Trägt die üblichen Frei-Tage ein. Hängt ausschließlich an: bereits eingetragene
   *  Namen bleiben unangetastet, es wird nie etwas entfernt oder umsortiert. */
  async function applyFreeSuggestion() {
    if (!startDate || !rows.length) return;
    setBusy(true);
    setMessage({ kind: "info", text: "Frei-Vorschlag wird geholt …" });
    try {
      const existing = collectAbsences(rows, dayLabels, weekDates);
      const result = await getFreeSuggestion(startDate, existing);
      // Wer diese Woche schon irgendwo als abwesend steht, wird nicht erneut eingetragen.
      const alreadyPlanned = new Set(
        existing.map((absence) => absence.person.toLocaleLowerCase("de")),
      );
      const byDate = new Map<string, string[]>();
      for (const suggestion of result.suggestions) {
        if (alreadyPlanned.has(suggestion.person.toLocaleLowerCase("de"))) continue;
        for (const iso of suggestion.dates) {
          byDate.set(iso, [...(byDate.get(iso) ?? []), suggestion.person]);
        }
      }
      let added = 0;
      setRows((current) => current.map((row) => {
        if (row.Abschnitt !== "Frei") return row;
        const next = { ...row };
        dayLabels.forEach((label, index) => {
          const names = byDate.get(weekDates[index]) ?? [];
          if (!names.length) return;
          const cell = (next[label] ?? "").trim();
          const present = new Set(splitNames(cell).map((n) => n.toLocaleLowerCase("de")));
          const fresh = names.filter((n) => !present.has(n.toLocaleLowerCase("de")));
          if (!fresh.length) return;
          added += fresh.length;
          next[label] = cell ? `${cell}, ${fresh.join(", ")}` : fresh.join(", ");
        });
        return next;
      }));
      const manual = result.needs_manual.length
        ? ` · ${result.needs_manual.length} MA ohne erkennbares Muster: ${result.needs_manual.join(", ")} – bitte manuell setzen.`
        : "";
      if (added) markDirty(added);
      setMessage({
        kind: added ? "success" : "info",
        text: added
          ? `${added} Frei-Tage eingetragen.${manual} Danach einmal „Zuweisungen neu berechnen“ drücken, damit die Dienste sie berücksichtigen.`
          : `Keine neuen Frei-Tage nötig – alles schon eingetragen.${manual}`,
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Frei-Vorschlag fehlgeschlagen.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function generate(recalculate = false) {
    if (!templateCode || !startDate) {
      setMessage({ kind: "error", text: "Bitte zuerst Woche A oder B und ein Startdatum auswählen." });
      return;
    }
    setBusy(true);
    setMessage({ kind: "info", text: recalculate ? "Zuweisungen werden neu verteilt …" : "Wochenplan wird aufgebaut …" });
    try {
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
          return old && preserve ? { ...row, ...old } : row;
        });
      }
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
      // Ein voll ersetzter Datensatz kappt AG Grids Undo/Redo-Verlauf - die
      // Anzeige muss das widerspiegeln, statt fälschlich "verfügbar" zu zeigen.
      setGridHistory({ canUndo: false, canRedo: false });
      setMessage({
        kind: "success",
        text: recalculate
          ? "Zuweisungen neu berechnet. Deine Info- und Abwesenheitsfelder wurden beibehalten."
          : (
              `${selectedTemplate?.name ?? `Woche ${templateCode}`} · ${selectedTemplate?.program ?? ""} wurde erstellt. ` +
              (
                result.artist_plan
                  ? "Der gespeicherte Künstlerplan wurde automatisch übernommen."
                  : "Für diese Woche ist noch kein Künstlerplan gespeichert."
              ) +
              (
                result.rehearsal_plan
                  ? " Der Probenplan schützt automatisch vor zeitlichen Überschneidungen."
                  : " Für diese Woche ist noch kein Probenplan gespeichert."
              )
            ),
      });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Plan konnte nicht erstellt werden." });
    } finally {
      setBusy(false);
    }
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
      });
      // Ab dem ersten erfolgreichen Speichern ist dies ein bestehender
      // Archivplan. Dadurch aktualisiert jeder weitere Klick exakt dieselbe
      // Woche, statt einen zweiten Datensatz anzulegen.
      setLoadedArchivedWeek(result.week);
      setArchivedWeeks((current) => [
        result.week,
        ...current.filter(
          (week) =>
            week.id !== result.week.id &&
            week.start_date !== result.week.start_date,
        ),
      ]);
      setMessage({
        kind: result.warnings.length ? "info" : "success",
        text: loadedArchivedWeek
          ? `${result.week.label} wurde mit deinen Änderungen aktualisiert.${
              result.warnings.length
                ? ` Planungs-Hinweis: ${result.warnings.slice(0, 2).join(" · ")}`
                : ""
            }`
          : `Plan gespeichert (Archiv-Nr. ${result.week_plan_id}).${
              result.warnings.length
                ? ` Planungs-Hinweis: ${result.warnings.slice(0, 2).join(" · ")}`
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
    setGridHistory({ canUndo: false, canRedo: false });
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

  function handleUndo() {
    gridApiRef.current?.undoCellEditing();
    refreshGridHistory();
  }

  function handleRedo() {
    gridApiRef.current?.redoCellEditing();
    refreshGridHistory();
  }

  const weekLabel = `KW ${isoWeek(startDate)} · ${selectedTemplate?.name ?? `Woche ${templateCode}`}`;
  const visibleRowCount = rows.filter((row) => row._row_type !== "group").length;

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
      changeCount={changeCount}
      lastSavedAt={lastSavedAt}
      saveError={saveError}
      onSave={save}
      busy={busy}
      onExport={exportExcel}
      exportDisabled={!xlsxSheet}
      tools={[
        { label: "Frei-Tage vorschlagen", onClick: () => setPendingAction({ kind: "free-suggestion" }), disabled: busy },
        { label: "Zuweisungen neu berechnen", onClick: () => setPendingAction({ kind: "recalculate" }), disabled: busy },
        { label: "Plan vollständig neu erstellen", onClick: () => setPendingAction({ kind: "rebuild" }), disabled: busy },
      ]}
      validationSummary={validation.summary}
      validationStatus={validation.failed ? "failed" : "idle"}
      onOpenValidation={() => setIssuesPanelOpen(true)}
    />
  );

  const preparationDetails = (
    <>
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
      <div className="field field-grow min-w-[280px]">
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
    </>
  );

  const gridSection = rows.length > 0 && (
    <>
      <div className="planner-grid-meta">
        <div>
          Namen tippen und auswählen · Infozeilen direkt als Klartext bearbeiten
        </div>
        <span className="badge">{visibleRowCount} Planzeilen · 7 Tage</span>
      </div>
      <section className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <div className={`plan-grid ${hasExistingPlan ? "h-[calc(100vh-260px)]" : "h-[calc(100vh-315px)]"} min-h-[560px]`}>
            <AgGridReact<PlanRow>
              theme={gridTheme}
              rowData={rows}
              columnDefs={columnDefs}
              suppressFieldDotNotation
              defaultColDef={{ sortable: false, resizable: true }}
              isFullWidthRow={(params) => params.rowNode.data?._row_type === "group"}
              fullWidthCellRenderer={GroupHeaderRenderer}
              getRowHeight={(params) => params.data?._row_type === "group" ? 36 : undefined}
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
                if (event.oldValue !== event.newValue) markDirty(1);
                refreshGridHistory();
              }}
              getRowId={(params) => rowKey(params.data)}
            />
          </div>
        </div>
      </section>
      <div className="plan-editor-bottom-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
          {saveState === "saving" && <span className="spinner" />}
          Änderungen speichern
        </button>
        <button type="button" className="btn" disabled={busy || !xlsxSheet} onClick={exportExcel}>
          Excel exportieren
        </button>
      </div>
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
          statusLabel={isDirty ? "Ungespeicherte Änderungen" : "Gespeichert"}
          weekPicker={
            <WeekPicker
              className="planner-week-picker plan-editor-summary-week-picker"
              label="Andere Planwoche öffnen"
              value={startDate}
              onChange={requestWeekChange}
            />
          }
          details={preparationDetails}
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
            <WeekPicker
              className="planner-week-picker"
              label="Planwoche beginnt am"
              value={startDate}
              onChange={requestWeekChange}
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
                <div className="field field-grow min-w-[360px]">
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
              {gridSection}
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

      {pendingAction?.kind === "recalculate" && (
        <ConfirmDialog
          open
          title="Zuweisungen neu berechnen?"
          description={
            <>
              <p>Automatisch erzeugte Zuweisungen werden neu berechnet. Manuell bearbeitete Informations- und Abwesenheitsfelder bleiben erhalten.</p>
              {isDirty && <p>Du hast noch ungespeicherte Änderungen an diesem Plan.</p>}
              <p>Einzelne Zellbearbeitungen lassen sich per Strg/Cmd+Z rückgängig machen, solange du die Seite nicht neu lädst. Die Neuberechnung selbst kann anschließend nicht automatisch rückgängig gemacht werden.</p>
            </>
          }
          actions={buildActions(isDirty, "Neu berechnen", closeConfirmDialog, async () => {
            const ok = await performSave();
            if (ok) generate(true);
          }, () => generate(true))}
          onDismiss={closeConfirmDialog}
        />
      )}

      {pendingAction?.kind === "rebuild" && (
        <ConfirmDialog
          open
          title="Plan vollständig neu erstellen?"
          description={
            <>
              <p>Der gesamte Dienstplan wird verworfen und komplett neu aufgebaut - das betrifft auch manuell bearbeitete Informations- und Abwesenheitsfelder.</p>
              {isDirty && <p>Du hast noch ungespeicherte Änderungen an diesem Plan.</p>}
              <p>Dieser Neuaufbau kann anschließend nicht automatisch rückgängig gemacht werden.</p>
            </>
          }
          actions={buildActions(isDirty, "Neu erstellen", closeConfirmDialog, async () => {
            const ok = await performSave();
            if (ok) generate(false);
          }, () => generate(false), "danger")}
          onDismiss={closeConfirmDialog}
        />
      )}

      {pendingAction?.kind === "free-suggestion" && (
        <ConfirmDialog
          open
          title="Frei-Vorschlag übernehmen?"
          description={
            <p>Für Mitarbeiter ohne Eintrag werden die üblichen Frei-Tage ergänzt. Bestehende Frei-Einträge werden dabei nicht verändert oder entfernt.</p>
          }
          actions={[
            { label: "Abbrechen", onClick: closeConfirmDialog, variant: "default" },
            {
              label: "Übernehmen",
              variant: "primary",
              autoFocus: true,
              onClick: () => { closeConfirmDialog(); applyFreeSuggestion(); },
            },
          ]}
          onDismiss={closeConfirmDialog}
        />
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
    </div>
  );
}

function buildActions(
  isDirty: boolean,
  confirmLabel: string,
  onCancel: () => void,
  onSaveFirst: () => void,
  onConfirm: () => void,
  confirmVariant: "primary" | "danger" = "primary",
): ConfirmDialogAction[] {
  const actions: ConfirmDialogAction[] = [
    { label: "Abbrechen", onClick: onCancel, variant: "default" },
  ];
  if (isDirty) {
    actions.push({ label: "Erst speichern", onClick: onSaveFirst, variant: "default" });
  }
  actions.push({ label: confirmLabel, onClick: onConfirm, variant: confirmVariant, autoFocus: !isDirty });
  return actions;
}
