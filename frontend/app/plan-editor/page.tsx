"use client";

import PageHeader from "@/components/PageHeader";
import PersonCellEditor from "@/components/PersonCellEditor";
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
import { recommendForCell } from "@/lib/recommendations";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellValueChangedEvent,
  type ColDef,
  type ICellRendererParams,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import Link from "next/link";
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
  const [xlsxPath, setXlsxPath] = useState("");
  const [xlsxSheet, setXlsxSheet] = useState("");
  const [rehearsalIntervals, setRehearsalIntervals] = useState<RehearsalInterval[]>([]);
  const [showDates, setShowDates] = useState<string[]>([]);
  const [onStageByDate, setOnStageByDate] = useState<Record<string, string[]>>({});
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
        setXlsxPath(result.xlsx_template_path ?? "");
        setXlsxSheet(result.xlsx_sheet ?? "");
        setRehearsalIntervals(result.rehearsal_intervals ?? []);
        setShowDates(result.show_dates ?? []);
        setOnStageByDate(result.on_stage_by_date ?? {});
        setDekoPeople(result.deko_people ?? []);
        setPreviousWeekWorkload(result.previous_week_workload ?? {});
        if (result.template_code === "A" || result.template_code === "B") {
          setTemplateCode(result.template_code);
        }
        setLoadedArchivedWeek(result.existing_week);
        setExported(true);
        setActiveStep(3);
        setMessage({
          kind: "success",
          text: `${result.existing_week.label} ist bereits vollständig archiviert und wurde zum Bearbeiten geöffnet.`,
        });
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
  }, [archivedWeeks, startDate]);

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
        return isPersonSection(category)
          ? {
              component: PersonCellEditor,
              params: {
                people,
                recommendedPeople:
                  dynamicRecommendation?.recommendedPeople ?? rule?.recommended_people,
                blockedPeople:
                  dynamicRecommendation?.blockedPeople ?? rule?.blocked_people,
                ruleHint: dynamicRecommendation?.hint ?? rule?.message,
                nearbyPeople: dynamicRecommendation?.nearbyPeople ?? [],
                showPeople: dynamicRecommendation?.showPeople ?? [],
                minimumPeople: isGuestsVsRobins ? 4 : 1,
              },
              popup: true,
              popupPosition: "under",
            }
          : {
              component: "agLargeTextCellEditor",
              params: { maxLength: 500, rows: 5, cols: 35 },
              popup: true,
              popupPosition: "under",
            };
      },
      cellStyle: (params) => ({
        backgroundColor: hexToRgba(rowColor(params.data), 0.13),
        cursor: "text",
      }),
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
      setXlsxPath(result.xlsx_template_path ?? selectedTemplate?.path ?? "");
      setXlsxSheet(result.xlsx_sheet ?? selectedTemplate?.sheet ?? "");
      setRehearsalIntervals(result.rehearsal_intervals ?? []);
      setShowDates(result.show_dates ?? []);
      setOnStageByDate(result.on_stage_by_date ?? {});
      setDekoPeople(result.deko_people ?? []);
      setPreviousWeekWorkload(result.previous_week_workload ?? {});
      setExported(false);
      setActiveStep(3);
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

  async function save() {
    if (!rows.length) return;
    if (!resolvedTemplateWeekId) {
      setMessage({ kind: "error", text: "Bitte den Plan zuerst neu erstellen." });
      return;
    }
    setBusy(true);
    try {
      const result = await savePlan({
        start_date: startDate,
        end_date: addDays(startDate, 6),
        template_week_id: resolvedTemplateWeekId,
        existing_week_id: loadedArchivedWeek?.id,
        day_labels: dayLabels,
        rows,
      });
      setMessage({
        kind: result.warnings.length ? "info" : "success",
        text: loadedArchivedWeek
          ? `${loadedArchivedWeek.label} wurde mit deinen Änderungen aktualisiert.${
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
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Speichern fehlgeschlagen." });
    } finally {
      setBusy(false);
    }
  }

  async function exportExcel() {
    if (!xlsxSheet || !rows.length) return;
    setBusy(true);
    try {
      const blob = await xlsxGenerate({
        template_path: xlsxPath,
        sheet_name: xlsxSheet,
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

  return (
    <div className="mx-auto max-w-[1900px]">
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
          onChange={(value) => {
              setStartDate(value);
              if (value) setTemplateCode(templateCodeForDate(value));
              setRows([]);
              setDayLabels([]);
              setWeekDates([]);
              setRehearsalIntervals([]);
              setShowDates([]);
              setOnStageByDate({});
              setDekoPeople([]);
              setPreviousWeekWorkload({});
              setLoadedArchivedWeek(null);
              loadedArchiveKeyRef.current = null;
              setExported(false);
              setActiveStep(1);
          }}
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

      {message && <div className={`status status-${message.kind}`}>{message.text}</div>}

      {activeStep === 1 && (
        <section className="panel wizard-stage">
          <div className="wizard-stage-head">
            <span className="wizard-stage-number">01</span>
            <div>
              <h2>Künstlerprogramm vorbereiten</h2>
              <p>Shows, Partys, DJs, Chillout und Aperitif werden später automatisch in den Dienstplan übernommen.</p>
            </div>
          </div>
          {artistPlanForWeek ? (
            <div className="preparation-card is-complete">
              <span className="preparation-check">✓</span>
              <div className="preparation-copy">
                <small>Bereit für diese Woche</small>
                <strong>{artistPlanForWeek.sheet_name || artistPlanForWeek.source_filename || "Künstlerplan"}</strong>
                <span>{artistPlanForWeek.filled_entries} ausgefüllte Programmeinträge</span>
              </div>
              <Link className="btn" href="/artist-plan">Prüfen oder ändern</Link>
            </div>
          ) : (
            <div className="preparation-card">
              <span className="preparation-icon">K</span>
              <div className="preparation-copy">
                <small>Noch nicht hinterlegt</small>
                <strong>Künstlerplan hochladen</strong>
                <span>Excel-Datei auswählen, Woche prüfen und für den Dienstplan aktivieren.</span>
              </div>
              <Link className="btn btn-primary" href="/artist-plan">Künstlerplan öffnen</Link>
            </div>
          )}
          <div className="wizard-actions">
            <span>Der Schritt wird automatisch abgehakt, sobald der Plan für diese Woche gespeichert ist.</span>
            <button className="btn btn-primary" onClick={() => setActiveStep(2)}>
              Weiter zum Probenplan
            </button>
          </div>
        </section>
      )}

      {activeStep === 2 && (
        <section className="panel wizard-stage">
          <div className="wizard-stage-head">
            <span className="wizard-stage-number">02</span>
            <div>
              <h2>Proben und Verfügbarkeiten einlesen</h2>
              <p>Teilnehmer und Tanzchoreografen werden während ihrer Probe automatisch für parallele Dienste gesperrt.</p>
            </div>
          </div>
          {rehearsalPlanForWeek ? (
            <div className="preparation-card is-complete">
              <span className="preparation-check">✓</span>
              <div className="preparation-copy">
                <small>Zeitkonflikte werden berücksichtigt</small>
                <strong>{rehearsalPlanForWeek.source_filename || "Probenplan"}</strong>
                <span>{rehearsalPlanForWeek.rehearsal_count} erkannte Proben</span>
              </div>
              <Link className="btn" href="/rehearsal-plan">Prüfen oder ändern</Link>
            </div>
          ) : (
            <div className="preparation-card">
              <span className="preparation-icon">P</span>
              <div className="preparation-copy">
                <small>Noch nicht hinterlegt</small>
                <strong>Probenplan hochladen</strong>
                <span>PDF lokal auswerten, erkannte Zeiten prüfen und für diese Woche aktivieren.</span>
              </div>
              <Link className="btn btn-primary" href="/rehearsal-plan">Probenplan öffnen</Link>
            </div>
          )}
          <div className="wizard-actions">
            <button className="btn" onClick={() => setActiveStep(1)}>Zurück</button>
            <button className="btn btn-primary" onClick={() => setActiveStep(3)}>
              Weiter zur Dienstplanung
            </button>
          </div>
        </section>
      )}

      {activeStep === 3 && (
        <>
          <section className="panel wizard-stage">
            <div className="wizard-stage-head compact">
              <span className="wizard-stage-number">03</span>
              <div>
                <h2>Dienstplan erstellen und bearbeiten</h2>
                <p>Grundwoche wählen, Vorschlag erzeugen und Zuweisungen direkt im Plan anpassen.</p>
              </div>
            </div>
            {loadedArchivedWeek && (
              <div className="planner-existing-plan">
                <span className="planner-existing-plan-check" aria-hidden="true">✓</span>
                <div>
                  <small>Fertiger Dienstplan erkannt</small>
                  <strong>{loadedArchivedWeek.label}</strong>
                  <span>
                    {loadedArchivedWeek.assignment_count} Planeinträge ·{" "}
                    {loadedArchivedWeek.absence_count} Abwesenheiten · Änderungen können
                    direkt unten vorgenommen und wieder gespeichert werden.
                  </span>
                </div>
                <span className="planner-existing-plan-state">Vollständig archiviert</span>
              </div>
            )}
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
              <div className="planner-config-actions">
                <button className="btn btn-primary" disabled={busy} onClick={() => generate(false)}>
                  {busy && <span className="spinner" />}
                  {rows.length ? "Plan neu aufbauen" : "Dienstplan erstellen"}
                </button>
                {rows.length > 0 && (
                  <>
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={applyFreeSuggestion}
                      title="Trägt die üblichen Frei-Tage ein. Eigene Einträge bleiben erhalten."
                    >
                      Frei-Vorschlag übernehmen
                    </button>
                    <button className="btn" disabled={busy} onClick={() => generate(true)}>
                      Zuweisungen neu berechnen
                    </button>
                    <button className="btn" disabled={busy} onClick={save}>Im Archiv speichern</button>
                  </>
                )}
              </div>
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
              {loadedArchivedWeek && <span className="is-ready">✓ Fertiger Dienstplan</span>}
            </div>
          </section>

          {rows.length > 0 ? (
            <>
              <div className="planner-grid-meta">
                <div>
                  Namen tippen und auswählen · Infozeilen direkt als Klartext bearbeiten
                </div>
                <span className="badge">
                  {rows.filter((row) => row._row_type !== "group").length} Planzeilen · 7 Tage
                </span>
              </div>
              <section className="panel overflow-hidden">
                <div className="overflow-x-auto">
                  <div className="plan-grid h-[calc(100vh-315px)] min-h-[560px]">
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
                      onCellValueChanged={(event: CellValueChangedEvent<PlanRow>) => {
                        if (event.data) setRows((current) => [...current]);
                      }}
                      getRowId={(params) => rowKey(params.data)}
                    />
                  </div>
                </div>
              </section>
              <div className="planner-grid-actions">
                <button className="btn btn-primary" onClick={() => setActiveStep(4)}>
                  Export vorbereiten
                </button>
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

      {activeStep === 4 && (
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
                  <strong>Im Archiv speichern</strong>
                  <p>Der aktuelle Stand bleibt im Dashboard und in den Auswertungen verfügbar.</p>
                </div>
                <button className="btn" disabled={busy} onClick={save}>Archivieren</button>
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
    </div>
  );
}
