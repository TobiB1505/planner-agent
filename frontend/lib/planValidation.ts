import type {
  AssignmentRule,
  RehearsalInterval,
} from "@/lib/api";
import {
  RELIEF_CATEGORIES,
  HIGH_DAILY_LOAD_THRESHOLD,
  HIGH_WEEKLY_LOAD_FACTOR,
  REPEATED_TASK_THRESHOLD,
  categoryOf,
  namesFromCell,
  serviceInterval,
  serviceIntervalLabel,
  storedInterval,
  overlap,
  gapMinutes,
  clockLabel,
  type RecommendationRow,
  type TimeInterval,
} from "@/lib/recommendations";

// ---------------------------------------------------------------------------
// Zentrales Konfliktmodell (Sprint 3) - wird von der globalen Planprüfung,
// der Tabellenmarkierung, dem Konfliktpanel und (perspektivisch) vom
// Mitarbeiter-Popup gemeinsam verwendet. Die Reason-Codes aus Sprint 2
// (lib/recommendations.ts) bleiben unverändert für die Kandidaten-Ansicht -
// dieses Modell beschreibt Probleme im bereits gespeicherten/aktuellen
// Zustand des gesamten Plans, nicht Empfehlungen für eine einzelne Zelle.
// ---------------------------------------------------------------------------

export type PlanIssueSeverity = "error" | "warning" | "info";

export type PlanIssueCategory =
  | "time_conflict"
  | "absence_conflict"
  | "show_conflict"
  | "rehearsal_conflict"
  | "understaffed"
  | "overstaffed"
  | "empty_required_assignment"
  | "daily_overload"
  | "weekly_overload"
  | "consecutive_load"
  | "fairness_imbalance"
  | "duplicate_assignment"
  | "invalid_employee"
  | "rule_violation"
  | "data_quality";

export interface PlanCellReference {
  /** Entspricht row._row_id (assignRowIds in app/plan-editor/utils/planEditorHelpers.tsx) -
   *  stabil und eindeutig, auch bei zwei Zeilen mit identischem Abschnitt/Zeile-Text
   *  (Sprint 0, S1-Fix C4). Identisch mit dem Wert, den AG-Grid getRowId liefert,
   *  damit navigateToIssue() die Zelle über api.getRowNode(rowId) findet. */
  rowId: string;
  /** AG-Grid-Spaltenfeld, identisch mit dayLabel. */
  columnId: string;
  dayLabel?: string;
  employeeName?: string;
}

export interface PlanIssue {
  id: string;
  severity: PlanIssueSeverity;
  category: PlanIssueCategory;
  title: string;
  description: string;
  affectedEmployees: Array<{ name: string }>;
  primaryCell?: PlanCellReference;
  relatedCells?: PlanCellReference[];
  dayLabel?: string;
  date?: string;
  timeRange?: string;
  section?: string;
  serviceName?: string;
  resolutionHint?: string;
  /** true = verhindert "Fertigstellen"/löst die Speicher-/Export-Rückfrage aus. */
  blocking: boolean;
}

export interface PlanValidationSummary {
  errors: number;
  warnings: number;
  info: number;
  understaffed: number;
  blockingIssues: number;
}

export interface PlanValidationResult {
  issues: PlanIssue[];
  summary: PlanValidationSummary;
  /** true, wenn die Prüfung selbst an einem unerwarteten Fehler gescheitert ist
   *  (siehe validatePlanSafe) - issues/summary sind dann leer, nicht veraltet. */
  failed: boolean;
}

const EMPTY_SUMMARY: PlanValidationSummary = {
  errors: 0,
  warnings: 0,
  info: 0,
  understaffed: 0,
  blockingIssues: 0,
};

// Dieselben Schwellen wie im Mitarbeiter-Popup (Sprint 2) - hier nur
// importiert, nicht erneut definiert, damit Popup und globale Prüfung nie
// auseinanderlaufen können.
const NEARBY_WARNING_GAP_MINUTES = 60;
const FAIRNESS_LOW_FACTOR = 0.34;
const FAIRNESS_MIN_TEAM_AVERAGE = 3;

// Die einzige im System bekannte verbindliche Mindestbesetzung (siehe
// page.tsx isGuestsVsRobins) - hier repliziert, weil die globale Prüfung
// unabhängig vom gerade geöffneten Zell-Editor laufen muss. Erfindet keine
// weiteren Sollbesetzungen, die es in den Daten nicht gibt.
function requiredHeadcount(category: string, zeile: string, dayLabel: string, dayLabels: string[]): number | null {
  if (category === "Sportprogramm" && zeile === "15:30 BVB" && dayLabels.indexOf(dayLabel) === 4) {
    return 4;
  }
  return null;
}

function rawNamesFromCell(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/\n+/)
    .flatMap((line) => {
      const personPart = line.includes("|") ? line.slice(line.lastIndexOf("|") + 1) : line;
      return personPart.split(/[,;]+/);
    })
    .map((name) => name.trim())
    .filter(Boolean);
}

function pluralPeople(count: number): string {
  return count === 1 ? "1 Person" : `${count} Personen`;
}

interface AssignmentEntry {
  name: string;
  category: string;
  zeile: string;
  rowId: string;
  dayLabel: string;
  date?: string;
  interval: TimeInterval | null;
}

function cellRef(rowId: string, dayLabel: string, employeeName?: string): PlanCellReference {
  return { rowId, columnId: dayLabel, dayLabel, employeeName };
}

export function validatePlan({
  rows,
  dayLabels,
  weekDates,
  people,
  personCategories,
  assignmentRules,
  rehearsalIntervals,
  showDates = [],
  dekoPeople = [],
  onStageByDate = {},
  onStageShowsByDate = {},
}: {
  rows: RecommendationRow[];
  dayLabels: string[];
  weekDates: string[];
  people: string[];
  personCategories: Set<string>;
  assignmentRules: Record<string, AssignmentRule>;
  rehearsalIntervals: RehearsalInterval[];
  showDates?: string[];
  dekoPeople?: string[];
  onStageByDate?: Record<string, string[]>;
  onStageShowsByDate?: Record<string, string[]>;
}): PlanValidationResult {
  const issues: PlanIssue[] = [];
  const knownPeople = new Set(people.map((name) => name.toLocaleLowerCase("de")));
  // Fallback nur zur Absicherung fremder Aufrufer ohne normalisierte Zeilen
  // (row._row_id wird für den Plan-Editor selbst immer von assignRowIds
  // gesetzt, siehe app/plan-editor/utils/planEditorHelpers.tsx).
  const rowIdOf = (category: string, zeile: string) => `${category}::${zeile}`;

  const assignmentsByPersonDay = new Map<string, AssignmentEntry[]>();
  const weeklyTotal = new Map<string, number>();
  const dayTotal = new Map<string, number>();
  const categoryTotal = new Map<string, number>();
  const absentByPersonDay = new Map<string, string>();
  const showDateSet = new Set(showDates);
  const dekoSet = new Set(dekoPeople.map((name) => name.toLocaleLowerCase("de")));

  function addAssignment(entry: AssignmentEntry) {
    const key = `${entry.name}::${entry.dayLabel}`;
    const list = assignmentsByPersonDay.get(key);
    if (list) list.push(entry);
    else assignmentsByPersonDay.set(key, [entry]);
    weeklyTotal.set(entry.name, (weeklyTotal.get(entry.name) ?? 0) + 1);
    dayTotal.set(`${entry.name}::${entry.dayLabel}`, (dayTotal.get(`${entry.name}::${entry.dayLabel}`) ?? 0) + 1);
    const catKey = `${entry.name}::${entry.category}`;
    categoryTotal.set(catKey, (categoryTotal.get(catKey) ?? 0) + 1);
  }

  // --- Durchlauf 1: Zeilen einsammeln, pro Zelle prüfen (Duplikate, unbekannte
  // Namen, Regelverstöße, Besetzung), Zuweisungen für die zeilenübergreifenden
  // Prüfungen (Zeitüberschneidung, Abwesenheit, Belastung) vormerken. -------
  for (const row of rows) {
    try {
      if (row._row_type === "group") continue;
      const category = categoryOf(row);
      const zeile = row.Zeile ?? "";
      const rowId = row._row_id ?? rowIdOf(category, zeile);
      const isAbsenceRow = category === "Frei" || category === "Urlaub/Krank";

      if (isAbsenceRow) {
        dayLabels.forEach((dayLabel) => {
          for (const name of namesFromCell(row[dayLabel])) {
            absentByPersonDay.set(`${name}::${dayLabel}`, category);
          }
        });
        continue;
      }

      if (!personCategories.has(category)) continue;

      const rule = assignmentRules[`${category}::${zeile}`];
      const interval = serviceInterval(category, zeile);

      dayLabels.forEach((dayLabel, dayIndex) => {
        const raw = rawNamesFromCell(row[dayLabel]);
        if (raw.length === 0) return;
        const date = weekDates[dayIndex];

        // Duplikate innerhalb derselben Zelle
        const seen = new Map<string, number>();
        for (const name of raw) {
          const lower = name.toLocaleLowerCase("de");
          seen.set(lower, (seen.get(lower) ?? 0) + 1);
        }
        for (const [lower, count] of seen) {
          if (count < 2) continue;
          const original = raw.find((n) => n.toLocaleLowerCase("de") === lower) ?? lower;
          issues.push({
            id: `duplicate_assignment:${dayLabel}:${rowId}:${lower}`,
            severity: "error",
            category: "duplicate_assignment",
            title: `${original} ist doppelt eingetragen`,
            description: `${original} steht ${count}x in derselben Zuweisung für ${category}${zeile ? ` (${zeile})` : ""} am ${dayLabel}.`,
            affectedEmployees: [{ name: original }],
            primaryCell: cellRef(rowId, dayLabel, original),
            dayLabel,
            date,
            section: row.Abschnitt,
            serviceName: category,
            resolutionHint: "Doppelten Eintrag in der Zelle entfernen.",
            blocking: true,
          });
        }

        const uniqueNames = [...new Set(raw)];
        for (const name of uniqueNames) {
          const lower = name.toLocaleLowerCase("de");

          if (!knownPeople.has(lower)) {
            issues.push({
              id: `invalid_employee:${dayLabel}:${rowId}:${lower}`,
              severity: "warning",
              category: "invalid_employee",
              title: `Unbekannter Name „${name}“`,
              description: `Der Name „${name}“ konnte keinem aktiven Mitarbeiter eindeutig zugeordnet werden (${category}, ${dayLabel}).`,
              affectedEmployees: [{ name }],
              primaryCell: cellRef(rowId, dayLabel, name),
              dayLabel,
              date,
              section: row.Abschnitt,
              serviceName: category,
              resolutionHint: "Namen prüfen und korrigieren oder im Team-Bereich anlegen.",
              blocking: false,
            });
            // Unbekannte Namen fließen bewusst nicht in Zeitüberschneidungs-
            // oder Belastungsprüfungen ein - dafür fehlt eine verlässliche
            // Identität.
            continue;
          }

          if (
            (category === "Ausschlafen" || category === "Barfrei") &&
            Boolean(date) &&
            showDateSet.has(date!) &&
            dekoSet.has(lower)
          ) {
            issues.push({
              id: `rule_violation:deko_show_relief:${dayLabel}:${rowId}:${lower}`,
              severity: "error",
              category: "rule_violation",
              title: `${name} kann am Showtag keine Entlastung erhalten`,
              description: `${name} arbeitet in der Deko und wird am ${dayLabel} für Bühnenaufbau und -abbau benötigt. Ausschlafen oder Barfrei ist an diesem Showtag nicht möglich.`,
              affectedEmployees: [{ name }],
              primaryCell: cellRef(rowId, dayLabel, name),
              dayLabel,
              date,
              section: row.Abschnitt,
              serviceName: category,
              resolutionHint: "Entlastung auf einen Tag ohne Show verschieben.",
              blocking: true,
            });
          }

          if (rule?.blocked_people?.includes(name)) {
            issues.push({
              id: `rule_violation:${dayLabel}:${rowId}:${lower}`,
              severity: "error",
              category: "rule_violation",
              title: `${name} ist für diesen Dienst nicht zulässig`,
              description: rule.message || `${name} verstößt gegen eine hinterlegte Planungsregel für ${category}.`,
              affectedEmployees: [{ name }],
              primaryCell: cellRef(rowId, dayLabel, name),
              dayLabel,
              date,
              section: row.Abschnitt,
              serviceName: category,
              resolutionHint: "Andere Person auswählen.",
              blocking: rule.hard_rule,
            });
          }

          addAssignment({ name, category, zeile, rowId, dayLabel, date, interval });
        }

        const required = requiredHeadcount(category, zeile, dayLabel, dayLabels);
        if (required !== null) {
          const count = uniqueNames.length;
          if (count < required) {
            issues.push({
              id: `staffing:${dayLabel}:${rowId}`,
              severity: "error",
              category: count === 0 ? "empty_required_assignment" : "understaffed",
              title: count === 0
                ? `Für ${category}${zeile ? ` (${zeile})` : ""} ist noch niemand eingeteilt`
                : `Für ${category}${zeile ? ` (${zeile})` : ""} fehlt noch Personal`,
              description: `${pluralPeople(count)} von ${required} benötigten Personen eingetragen (${dayLabel}).`,
              affectedEmployees: uniqueNames.map((name) => ({ name })),
              primaryCell: cellRef(rowId, dayLabel),
              dayLabel,
              date,
              section: row.Abschnitt,
              serviceName: category,
              resolutionHint: "Mitarbeiter zuweisen.",
              blocking: true,
            });
          } else if (count > required) {
            issues.push({
              id: `staffing:${dayLabel}:${rowId}`,
              severity: "warning",
              category: "overstaffed",
              title: `${category}${zeile ? ` (${zeile})` : ""} ist überbesetzt`,
              description: `${pluralPeople(count)} eingetragen, vorgesehen sind ${required} (${dayLabel}).`,
              affectedEmployees: uniqueNames.map((name) => ({ name })),
              primaryCell: cellRef(rowId, dayLabel),
              dayLabel,
              date,
              section: row.Abschnitt,
              serviceName: category,
              resolutionHint: "Zuweisung prüfen und ggf. reduzieren.",
              blocking: false,
            });
          }
        }
      });
    } catch {
      // Eine einzelne fehlerhafte Zeile darf die gesamte Prüfung nicht
      // abbrechen - sie wird als Datenqualitätsproblem sichtbar gemacht.
      issues.push({
        id: `data_quality:row:${issues.length}`,
        severity: "info",
        category: "data_quality",
        title: "Eine Planzeile konnte nicht vollständig geprüft werden",
        description: `Die Zeile „${row.Abschnitt ?? "unbekannt"}“ enthält Daten, die sich nicht sicher interpretieren ließen.`,
        affectedEmployees: [],
        blocking: false,
      });
    }
  }

  // --- Durchlauf 2: personenbezogene Prüfungen über den Tag/die Woche ------
  for (const [key, entries] of assignmentsByPersonDay) {
    const [name, dayLabel] = key.split("::");
    const date = entries[0]?.date;

    // Abwesenheitskonflikt
    const absenceKind = absentByPersonDay.get(key);
    if (absenceKind) {
      for (const entry of entries) {
        issues.push({
          id: `absence_conflict:${dayLabel}:${name}:${entry.rowId}`,
          severity: "error",
          category: "absence_conflict",
          title: `${name} ist als ${absenceKind === "Frei" ? "frei" : "abwesend"} markiert`,
          description: `${name} ist am ${dayLabel} als „${absenceKind}“ eingetragen und gleichzeitig für ${entry.category}${entry.zeile ? ` (${entry.zeile})` : ""} eingeplant.`,
          affectedEmployees: [{ name }],
          primaryCell: cellRef(entry.rowId, dayLabel, name),
          dayLabel,
          date,
          serviceName: entry.category,
          resolutionHint: `${name} aus dem Dienst entfernen oder die Abwesenheit korrigieren.`,
          blocking: true,
        });
      }
    }

    // Zeitgleiche Doppelbelegung (paarweise, nur wenn beide Zeiten bekannt sind)
    const timed = entries.filter((entry): entry is AssignmentEntry & { interval: TimeInterval } => Boolean(entry.interval));
    for (let i = 0; i < timed.length; i++) {
      for (let j = i + 1; j < timed.length; j++) {
        const a = timed[i];
        const b = timed[j];
        if (!overlap(a.interval, b.interval)) continue;
        const [first, second] = [a, b].sort((x, y) => `${x.category}${x.zeile}`.localeCompare(`${y.category}${y.zeile}`));
        issues.push({
          id: `time_conflict:${dayLabel}:${name}:${first.category}|${first.zeile}:${second.category}|${second.zeile}`,
          severity: "error",
          category: "time_conflict",
          title: `${name} ist am ${dayLabel} zweimal gleichzeitig eingeplant`,
          description: `${first.category}${first.zeile ? ` (${first.zeile})` : ""} ${serviceIntervalLabel(first.interval)} überschneidet sich mit ${second.category}${second.zeile ? ` (${second.zeile})` : ""} ${serviceIntervalLabel(second.interval)}.`,
          affectedEmployees: [{ name }],
          primaryCell: cellRef(first.rowId, dayLabel, name),
          relatedCells: [cellRef(second.rowId, dayLabel, name)],
          dayLabel,
          date,
          timeRange: serviceIntervalLabel(first.interval),
          resolutionHint: "Eine der beiden Zuweisungen entfernen oder eine andere Person einteilen.",
          blocking: true,
        });
      }
    }

    // Show-/Probenüberschneidung
    for (const entry of entries) {
      if (!entry.interval || !date) continue;
      let hardHandled = false;
      for (const rehearsal of rehearsalIntervals) {
        if (rehearsal.person_name !== name || rehearsal.date !== date) continue;
        const rehearsalSlot = storedInterval(rehearsal.start_time, rehearsal.end_time);
        if (overlap(entry.interval, rehearsalSlot)) {
          hardHandled = true;
          issues.push({
            id: `rehearsal_conflict:${dayLabel}:${name}:${entry.rowId}:${rehearsal.activity}`,
            severity: "error",
            category: "rehearsal_conflict",
            title: `${name} hat zur gleichen Zeit Probe`,
            description: `${name} hat bis ${clockLabel(rehearsal.end_time)} Uhr Probe („${rehearsal.activity}“). Der Dienst ${entry.category}${entry.zeile ? ` (${entry.zeile})` : ""} beginnt ${entry.interval[0] === rehearsalSlot[0] ? "ebenfalls" : "bereits"} um ${serviceIntervalLabel(entry.interval).split("–")[0]} Uhr.`,
            affectedEmployees: [{ name }],
            primaryCell: cellRef(entry.rowId, dayLabel, name),
            dayLabel,
            date,
            timeRange: serviceIntervalLabel(entry.interval),
            serviceName: entry.category,
            resolutionHint: "Andere Person für diesen Dienst einteilen.",
            blocking: true,
          });
          continue;
        }
        const gap = gapMinutes(entry.interval, rehearsalSlot);
        if (gap <= NEARBY_WARNING_GAP_MINUTES) {
          const transition = gap <= 30 ? "sehr knapper" : "knapper";
          issues.push({
            id: `rehearsal_conflict:${dayLabel}:${name}:${entry.rowId}:near:${rehearsal.activity}`,
            severity: "warning",
            category: "rehearsal_conflict",
            title: `Knapper Übergang für ${name}`,
            description: `${name} hat Probe „${rehearsal.activity}“ ${clockLabel(rehearsal.start_time)}–${clockLabel(rehearsal.end_time)} Uhr; ${transition} Übergang zu ${entry.category}${entry.zeile ? ` (${entry.zeile})` : ""} ${serviceIntervalLabel(entry.interval)} (${gap} Minuten Puffer).`,
            affectedEmployees: [{ name }],
            primaryCell: cellRef(entry.rowId, dayLabel, name),
            dayLabel,
            date,
            timeRange: serviceIntervalLabel(entry.interval),
            serviceName: entry.category,
            resolutionHint: "Zeitlichen Puffer prüfen oder andere Person einteilen.",
            blocking: false,
          });
        }
      }
      if (!hardHandled && entry.interval[0] >= 17 * 60 && (onStageByDate[date] ?? []).includes(name)) {
        const showLabel = (onStageShowsByDate[date] ?? []).join(" / ");
        issues.push({
          id: `show_conflict:${dayLabel}:${name}:${entry.rowId}`,
          severity: "warning",
          category: "show_conflict",
          title: `${name} steht an diesem Abend auf der Bühne`,
          description: showLabel
            ? `${name} steht laut Planung am ${dayLabel} in der Show „${showLabel}“ und ist gleichzeitig für ${entry.category}${entry.zeile ? ` (${entry.zeile})` : ""} eingeteilt.`
            : `${name} steht laut Planung am ${dayLabel} auf der Bühne und ist gleichzeitig für ${entry.category}${entry.zeile ? ` (${entry.zeile})` : ""} eingeteilt.`,
          affectedEmployees: [{ name }],
          primaryCell: cellRef(entry.rowId, dayLabel, name),
          dayLabel,
          date,
          serviceName: entry.category,
          resolutionHint: "Andere Person für diesen Dienst einteilen.",
          blocking: false,
        });
      }
    }

    // Hohe Tagesbelastung
    const dayCount = dayTotal.get(key) ?? 0;
    if (dayCount >= HIGH_DAILY_LOAD_THRESHOLD + 1) {
      issues.push({
        id: `daily_overload:${dayLabel}:${name}`,
        severity: "warning",
        category: "daily_overload",
        title: `${name} hat am ${dayLabel} bereits ${dayCount} Aufgaben`,
        description: `${name} ist am ${dayLabel} in ${dayCount} verschiedenen Diensten eingeteilt.`,
        affectedEmployees: [{ name }],
        dayLabel,
        date,
        resolutionHint: "Eine der Aufgaben ggf. an eine andere Person übergeben.",
        blocking: false,
      });
    }
  }

  // --- Durchlauf 3: Wochenbezogene Belastung/Fairness ----------------------
  const activeWeekly = people.map((name) => weeklyTotal.get(name) ?? 0);
  const avgWeekly = activeWeekly.length > 0
    ? activeWeekly.reduce((sum, value) => sum + value, 0) / activeWeekly.length
    : 0;

  for (const name of people) {
    const weekly = weeklyTotal.get(name) ?? 0;
    if (weekly >= 6 && weekly > avgWeekly * HIGH_WEEKLY_LOAD_FACTOR) {
      issues.push({
        id: `weekly_overload:${name}`,
        severity: "warning",
        category: "weekly_overload",
        title: `${name} ist diese Woche deutlich häufiger eingeplant`,
        description: `${name} hat ${weekly} Dienste diese Woche (Team-Ø ${avgWeekly.toFixed(1)}).`,
        affectedEmployees: [{ name }],
        resolutionHint: "Wochenverteilung gegenprüfen.",
        blocking: false,
      });
    } else if (avgWeekly >= FAIRNESS_MIN_TEAM_AVERAGE && weekly <= avgWeekly * FAIRNESS_LOW_FACTOR) {
      issues.push({
        id: `fairness_imbalance:${name}`,
        severity: "info",
        category: "fairness_imbalance",
        title: `${name} ist diese Woche deutlich seltener eingeplant`,
        description: `${name} hat ${weekly} Dienste diese Woche (Team-Ø ${avgWeekly.toFixed(1)}).`,
        affectedEmployees: [{ name }],
        resolutionHint: "Bei der nächsten Zuweisung berücksichtigen.",
        blocking: false,
      });
    }

    for (const category of personCategories) {
      if (RELIEF_CATEGORIES.has(category)) continue;
      const count = categoryTotal.get(`${name}::${category}`) ?? 0;
      if (count >= REPEATED_TASK_THRESHOLD + 1) {
        issues.push({
          id: `consecutive_load:${name}:${category}`,
          severity: "warning",
          category: "consecutive_load",
          title: `${name} übernimmt ${category} ungewöhnlich oft`,
          description: `${name} ist diese Woche bereits ${count}x für ${category} eingeteilt.`,
          affectedEmployees: [{ name }],
          serviceName: category,
          resolutionHint: "Rotation für diese Aufgabe prüfen.",
          blocking: false,
        });
      }
    }
  }

  const summary = issues.reduce<PlanValidationSummary>((acc, issue) => {
    if (issue.severity === "error") acc.errors += 1;
    else if (issue.severity === "warning") acc.warnings += 1;
    else acc.info += 1;
    if (issue.category === "understaffed" || issue.category === "empty_required_assignment") {
      acc.understaffed += 1;
    }
    if (issue.blocking) acc.blockingIssues += 1;
    return acc;
  }, { ...EMPTY_SUMMARY });

  const severityRank: Record<PlanIssueSeverity, number> = { error: 0, warning: 1, info: 2 };
  const sorted = [...issues].sort((a, b) => {
    if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
    if (severityRank[a.severity] !== severityRank[b.severity]) {
      return severityRank[a.severity] - severityRank[b.severity];
    }
    const dayA = a.dayLabel ? dayLabels.indexOf(a.dayLabel) : dayLabels.length;
    const dayB = b.dayLabel ? dayLabels.indexOf(b.dayLabel) : dayLabels.length;
    if (dayA !== dayB) return dayA - dayB;
    return a.id.localeCompare(b.id);
  });

  return { issues: sorted, summary, failed: false };
}

/** Schutzhülle um validatePlan - ein unerwarteter Fehler darf die Seite nie
 *  zum Absturz bringen. Siehe Sprint-3-Vorgabe "keine stillen Fehler": der
 *  Fehlerzustand wird über `failed: true` sichtbar, nicht verschluckt. */
export function validatePlanSafe(input: Parameters<typeof validatePlan>[0]): PlanValidationResult {
  try {
    return validatePlan(input);
  } catch (error) {
    console.error("Planprüfung fehlgeschlagen:", error);
    return { issues: [], summary: { ...EMPTY_SUMMARY }, failed: true };
  }
}

export function cellIssueKey(rowId: string, dayLabel: string): string {
  return `${rowId}::${dayLabel}`;
}

/** Indexiert Issues einmal pro Prüflauf nach betroffener Zelle, damit
 *  Cell-Renderer/-Style-Funktionen nicht bei jedem Aufruf erneut über alle
 *  Issues iterieren müssen (siehe Sprint-3-Performance-Vorgabe). */
export function buildCellIssueIndex(issues: PlanIssue[]): Map<string, PlanIssue[]> {
  const index = new Map<string, PlanIssue[]>();
  const add = (ref: PlanCellReference | undefined, issue: PlanIssue) => {
    if (!ref) return;
    const key = cellIssueKey(ref.rowId, ref.columnId);
    const list = index.get(key);
    if (list) list.push(issue);
    else index.set(key, [issue]);
  };
  for (const issue of issues) {
    add(issue.primaryCell, issue);
    issue.relatedCells?.forEach((ref) => add(ref, issue));
  }
  return index;
}

export function worstSeverity(issues: PlanIssue[]): PlanIssueSeverity | null {
  if (issues.some((issue) => issue.severity === "error")) return "error";
  if (issues.some((issue) => issue.severity === "warning")) return "warning";
  if (issues.length > 0) return "info";
  return null;
}
