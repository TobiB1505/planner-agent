import type {
  AssignmentRule,
  PreviousWeekWorkload,
  RehearsalInterval,
} from "@/lib/api";

export type RecommendationRow = Record<string, string | null> & {
  Abschnitt: string;
  Zeile: string;
  _row_type: "data" | "group";
  _category: string;
};

export const RELIEF_CATEGORIES = new Set(["Ausschlafen", "Barfrei"]);

// Ab hier gilt jemand als "stark ausgelastet" für die entsprechende Warnung. Die
// zugrunde liegenden Zähler (dayTotal/weeklyTotal/categoryTotal) sind echte, aus
// dem aktuellen Wochenraster berechnete Werte - nur die Schwellen hier sind eine
// bewusste, dokumentierte Designentscheidung dieses Sprints, keine vorgegebene
// Fachregel.
export const HIGH_DAILY_LOAD_THRESHOLD = 2;
export const HIGH_WEEKLY_LOAD_FACTOR = 1.5;
export const REPEATED_TASK_THRESHOLD = 3;

export function categoryOf(row: RecommendationRow): string {
  return row._category || row.Abschnitt;
}

export function namesFromCell(value: string | null | undefined): string[] {
  if (!value) return [];
  const names = value
    .split(/\n+/)
    .flatMap((line) => {
      const personPart = line.includes("|") ? line.slice(line.lastIndexOf("|") + 1) : line;
      return personPart.split(/[,;]+/);
    })
    .map((name) => name.trim())
    .filter(Boolean);
  return [...new Set(names)];
}

function mentionedPeople(
  value: string | null | undefined,
  people: string[],
): string[] {
  const normalized = (value ?? "").toLocaleLowerCase("de");
  return people.filter((name) => {
    const escaped = name
      .toLocaleLowerCase("de")
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}([^\\p{L}\\p{N}_]|$)`, "u")
      .test(normalized);
  });
}

export function timeKey(category: string, slot: string): string {
  const match = slot.match(/(^|[^\d])(\d{1,2})[:.](\d{2})(?!\d)/);
  return match
    ? `${Number(match[2]).toString().padStart(2, "0")}:${match[3]}`
    : `KATEGORIE:${category.toLocaleLowerCase("de")}`;
}

export type TimeInterval = [number, number];

function clockMinutes(hour: string, minute: string): number {
  return Number(hour) * 60 + Number(minute);
}

export function serviceInterval(category: string, slot: string): TimeInterval | null {
  const text = `${slot} ${category}`;
  const range = text.match(
    /(^|[^\d])(\d{1,2})[:.](\d{2})\s*(?:-|–|bis)\s*(\d{1,2})[:.](\d{2})(?!\d)/i,
  );
  if (range) {
    const start = clockMinutes(range[2], range[3]);
    let end = clockMinutes(range[4], range[5]);
    if (end <= start) end += 1440;
    return [start, end];
  }
  const hourRange = text.match(
    /(^|[^\d])(\d{1,2})\s*(?:-|–|bis)\s*(\d{1,2})\s*uhr\b/i,
  );
  if (hourRange) {
    const start = clockMinutes(hourRange[2], "00");
    let end = clockMinutes(hourRange[3], "00");
    if (end <= start) end += 1440;
    return [start, end];
  }
  const single = text.match(/(^|[^\d])(\d{1,2})[:.](\d{2})(?!\d)/);
  if (single) {
    const start = clockMinutes(single[2], single[3]);
    const duration = category.includes("Süße Momente") ? 30 : 60;
    return [start, start + duration];
  }
  const defaults: Record<string, TimeInterval> = {
    "Moderation + Getränkedienst": [21 * 60 + 40, 24 * 60 + 30],
    "18 Uhr LEDs": [18 * 60, 18 * 60 + 30],
    "18:00 Saunaaufguss": [18 * 60, 19 * 60],
  };
  return defaults[category] ?? null;
}

export function storedInterval(startTime: string, endTime: string): TimeInterval {
  const [startHour, startMinute] = startTime.replace(".", ":").split(":");
  const [endHour, endMinute] = endTime.replace(".", ":").split(":");
  const start = clockMinutes(startHour, startMinute);
  let end = clockMinutes(endHour, endMinute);
  if (end <= start) end += 1440;
  return [start, end];
}

export function overlap(first: TimeInterval, second: TimeInterval): boolean {
  const firstVariants: TimeInterval[] = [first, [first[0] + 1440, first[1] + 1440]];
  const secondVariants: TimeInterval[] = [second, [second[0] + 1440, second[1] + 1440]];
  return firstVariants.some(([startA, endA]) =>
    secondVariants.some(([startB, endB]) => startA < endB && startB < endA)
  );
}

export function gapMinutes(first: TimeInterval, second: TimeInterval): number {
  if (overlap(first, second)) return 0;
  const gaps: number[] = [];
  for (const [startA, endA] of [first, [first[0] + 1440, first[1] + 1440]] as TimeInterval[]) {
    for (const [startB, endB] of [second, [second[0] + 1440, second[1] + 1440]] as TimeInterval[]) {
      if (endA <= startB) gaps.push(startB - endA);
      else if (endB <= startA) gaps.push(startA - endB);
    }
  }
  return gaps.length ? Math.min(...gaps) : 1440;
}

function increment(map: Map<string, number>, name: string) {
  map.set(name, (map.get(name) ?? 0) + 1);
}

export function clockLabel(raw: string): string {
  return raw.slice(0, 5);
}

/** Rundet auf eine ganze Zahl, aber nicht auf 0, wenn der echte Wert >0 ist -
 *  sonst würde "Team-Ø 0" bei z.B. 0,3 fälschlich "keine Belastung" suggerieren. */
function roundDisplay(value: number): number {
  if (value > 0 && value < 1) return Math.round(value * 10) / 10;
  return Math.round(value);
}

// ---------------------------------------------------------------------------
// Kandidaten-Statusmodell (Sprint 2)
// ---------------------------------------------------------------------------

/** Fachlicher Hauptstatus einer Person für eine bestimmte Zelle - genau einer pro
 *  Person, nie eine Kombination aus unabhängigen Booleans. */
export type CandidateAvailability = "recommended" | "available" | "warning" | "unavailable";

export type RecommendationReasonCode =
  | "no_time_conflict"
  | "low_daily_load"
  | "low_weekly_load"
  | "matching_experience"
  | "day_lead"
  | "fairness_balance"
  | "no_rehearsal"
  | "no_show_conflict"
  | "skill_match"
  | "experience"
  | "low_workload"
  | "fairness"
  | "availability"
  | "previous_success"
  | "preference"
  | "conflict_free";

export type ConflictReasonCode =
  | "absence"
  | "already_assigned_relief"
  | "deko_show_lock"
  | "time_conflict"
  | "rehearsal_overlap"
  | "rule_blocked"
  | "rehearsal_nearby"
  | "show_conflict"
  | "high_daily_load"
  | "high_weekly_load"
  | "repeated_task"
  | "department_preference";

export type ReasonCode = RecommendationReasonCode | ConflictReasonCode;

/** Anzeige-Priorität, wenn eine Person mehrere Gründe gleichzeitig hat - vorne
 *  steht, was Tobi zuerst wissen muss (siehe Sprint-2-Vorgabe Aufgabe 5). */
const REASON_PRIORITY: ReasonCode[] = [
  "time_conflict",
  "rehearsal_overlap",
  "rule_blocked",
  "absence",
  "already_assigned_relief",
  "deko_show_lock",
  "show_conflict",
  "rehearsal_nearby",
  "high_daily_load",
  "high_weekly_load",
  "repeated_task",
  "department_preference",
  "availability",
  "conflict_free",
  "skill_match",
  "experience",
  "low_workload",
  "fairness",
  "preference",
  "previous_success",
  "fairness_balance",
  "day_lead",
  "matching_experience",
  "low_daily_load",
  "low_weekly_load",
  "no_rehearsal",
  "no_show_conflict",
  "no_time_conflict",
];

export interface CandidateReason {
  code: ReasonCode;
  /** Fertiger, auf Deutsch formulierter Text - zentral in diesem Modul erzeugt
   *  (buildReason), damit UI-Komponenten keine eigenen Textbausteine pflegen. */
  text: string;
}

export interface CandidateInfo {
  name: string;
  status: CandidateAvailability;
  /** Sortiert nach REASON_PRIORITY, wichtigster Grund zuerst. */
  reasons: CandidateReason[];
  /** Interner Rang für die Sortierung innerhalb der "Empfohlen"-Gruppe (kleiner = besser). */
  score: number;
}

function buildReason(code: ReasonCode, text: string): CandidateReason {
  return { code, text };
}

function sortReasons(reasons: CandidateReason[]): CandidateReason[] {
  return [...reasons].sort(
    (a, b) => REASON_PRIORITY.indexOf(a.code) - REASON_PRIORITY.indexOf(b.code),
  );
}

export function serviceIntervalLabel(interval: TimeInterval): string {
  const clock = (minutes: number) => {
    const wrapped = ((minutes % 1440) + 1440) % 1440;
    const h = Math.floor(wrapped / 60);
    const m = wrapped % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };
  return `${clock(interval[0])}–${clock(interval[1])} Uhr`;
}

export function recommendForCell({
  targetRow,
  dayLabel,
  rows,
  dayLabels,
  people,
  personCategories,
  rule,
  weekDates,
  rehearsalIntervals,
  showDates,
  onStageByDate = {},
  onStageShowsByDate = {},
  dekoPeople,
  previousWeekWorkload,
}: {
  targetRow: RecommendationRow;
  dayLabel: string;
  rows: RecommendationRow[];
  dayLabels: string[];
  people: string[];
  personCategories: Set<string>;
  rule?: AssignmentRule;
  weekDates: string[];
  rehearsalIntervals: RehearsalInterval[];
  showDates: string[];
  /** Aus dem MA-Gedächtnis: wer steht an dem Abend auf der Bühne. */
  onStageByDate?: Record<string, string[]>;
  /** Aus dem MA-Gedächtnis: welche Show/Party läuft an dem Abend (nur Namen). */
  onStageShowsByDate?: Record<string, string[]>;
  dekoPeople: string[];
  previousWeekWorkload: Record<string, PreviousWeekWorkload>;
}) {
  const targetCategory = categoryOf(targetRow);
  const targetTime = timeKey(targetCategory, targetRow.Zeile);
  const isReliefTarget = RELIEF_CATEGORIES.has(targetCategory);
  const targetDayIndex = dayLabels.indexOf(dayLabel);
  const targetDate = weekDates[targetDayIndex];
  const targetInterval = serviceInterval(targetCategory, targetRow.Zeile);
  const previousDay = targetDayIndex > 0 ? dayLabels[targetDayIndex - 1] : undefined;
  const weeklyTotal = new Map<string, number>();
  const categoryTotal = new Map<string, number>();
  const cookingTotal = new Map<string, number>();
  const reliefTotal = new Map<string, number>();
  const dayTotal = new Map<string, number>();
  const unavailable = new Set<string>();
  const absenceKind = new Map<string, string>();
  const timeConflicts = new Set<string>();
  const workedLateBefore = new Set<string>();
  const rehearsalNearby = new Map<string, number>();
  const rehearsalNearbyDetail = new Map<string, RehearsalInterval>();
  const rehearsalOverlapDetail = new Map<string, RehearsalInterval>();
  const rehearsalToday = new Set<string>();
  const dayLeadPeople = new Set<string>();

  for (const row of rows) {
    if (row._row_type === "group") continue;
    const category = categoryOf(row);

    if (category === "Frei" || category === "Urlaub/Krank") {
      for (const name of namesFromCell(row[dayLabel])) {
        unavailable.add(name);
        if (!absenceKind.has(name)) absenceKind.set(name, category);
      }
      continue;
    }

    if (category === "Tagesverantwortung") {
      for (const name of namesFromCell(row[dayLabel])) dayLeadPeople.add(name);
    }

    if (category.includes("NITE CLUB")) {
      if (previousDay) {
        for (const name of mentionedPeople(row[previousDay], people)) {
          workedLateBefore.add(name);
        }
      }
      continue;
    }
    if (!personCategories.has(category)) continue;

    for (const day of dayLabels) {
      const isTargetCell =
        category === targetCategory &&
        row.Zeile === targetRow.Zeile &&
        day === dayLabel;
      if (isTargetCell) continue;

      const assigned = namesFromCell(row[day]);
      if (RELIEF_CATEGORIES.has(category)) {
        for (const name of assigned) increment(reliefTotal, name);
        continue;
      }

      for (const name of assigned) {
        increment(weeklyTotal, name);
        if (category === targetCategory) increment(categoryTotal, name);
        if (category === "Kochdienste") increment(cookingTotal, name);
        if (day === dayLabel) increment(dayTotal, name);
        if (day === previousDay && category === "Moderation + Getränkedienst") {
          workedLateBefore.add(name);
        }
      }

      if (
        !isReliefTarget &&
        day === dayLabel &&
        timeKey(category, row.Zeile) === targetTime
      ) {
        for (const name of assigned) timeConflicts.add(name);
      }
    }
  }

  const blocked = new Set(rule?.blocked_people ?? []);
  const dekoReliefBlocked =
    isReliefTarget &&
    Boolean(targetDate) &&
    showDates.includes(targetDate) &&
    dekoPeople.length > 0;
  for (const name of unavailable) blocked.add(name);
  if (isReliefTarget) {
    for (const [name, count] of reliefTotal) {
      if (count > 0) blocked.add(name);
    }
    if (dekoReliefBlocked) {
      for (const name of dekoPeople) blocked.add(name);
    }
  } else {
    for (const name of timeConflicts) blocked.add(name);
  }
  // Show-Teilnehmer können abends nicht gleichzeitig kochen - das ist aber eine
  // weiche Regel (Ausnahmen kommen vor), deshalb keine Sperre, nur eine eigene
  // "Show"-Kennzeichnung statt der normalen Proben-Nähe-Anzeige.
  const isEveningCooking =
    targetCategory === "Kochdienste" && Boolean(targetInterval) && targetInterval![0] >= 17 * 60;
  // Jeder Abenddienst, nicht nur der Kochdienst: wer laut Gedächtnis an dem Abend in
  // der Show/Party steht, wird abgewertet - auch für Wochen ohne importierten Probenplan.
  const isEveningTarget = Boolean(targetInterval) && targetInterval![0] >= 17 * 60;
  const showConflict = new Set<string>();
  const showConflictDetail = new Map<string, RehearsalInterval>();
  if (isEveningTarget && !isReliefTarget && targetDate) {
    for (const name of onStageByDate[targetDate] ?? []) showConflict.add(name);
  }
  if (!isReliefTarget && targetDate && targetInterval) {
    for (const rehearsal of rehearsalIntervals) {
      if (rehearsal.date !== targetDate) continue;
      rehearsalToday.add(rehearsal.person_name);
      const rehearsalSlot = storedInterval(
        rehearsal.start_time,
        rehearsal.end_time,
      );
      if (isEveningCooking && rehearsal.is_show) {
        showConflict.add(rehearsal.person_name);
        showConflictDetail.set(rehearsal.person_name, rehearsal);
        continue;
      }
      if (overlap(targetInterval, rehearsalSlot)) {
        blocked.add(rehearsal.person_name);
        rehearsalOverlapDetail.set(rehearsal.person_name, rehearsal);
        continue;
      }
      const gap = gapMinutes(targetInterval, rehearsalSlot);
      const level = gap <= 30 ? 2 : gap <= 60 ? 1 : 0;
      if (level > (rehearsalNearby.get(rehearsal.person_name) ?? 0)) {
        rehearsalNearby.set(rehearsal.person_name, level);
        rehearsalNearbyDetail.set(rehearsal.person_name, rehearsal);
      }
    }
  }

  const allowed = (rule?.allowed_people ?? people).filter((name) => !blocked.has(name));
  const baseRecommended = new Set(rule?.recommended_people ?? allowed);
  const recommendedCandidates = allowed.filter((name) => baseRecommended.has(name));
  const isOpsTarget = targetCategory.replace(/[\s/+]/g, "").toLocaleLowerCase("de") === "opswp";

  const reliefNeed = (name: string) => {
    const lateBonus = workedLateBefore.has(name)
      ? (targetCategory === "Ausschlafen" ? 1000 : 80)
      : 0;
    const cookingBonus =
      (cookingTotal.get(name) ?? 0) * (targetCategory === "Barfrei" ? 140 : 20);
    const workloadBonus = (weeklyTotal.get(name) ?? 0) * 25;
    const busyDayBonus = (dayTotal.get(name) ?? 0) * 10;
    return lateBonus + cookingBonus + workloadBonus + busyDayBonus;
  };
  const serviceLoad = (name: string) => {
    const previous = previousWeekWorkload[name];
    return (
      (rehearsalNearby.get(name) ?? 0) * 10000 +
      (showConflict.has(name) ? 8000 : 0) +
      (categoryTotal.get(name) ?? 0) * 90 +
      (weeklyTotal.get(name) ?? 0) * 24 +
      (dayTotal.get(name) ?? 0) * 8 +
      (previous?.overload ?? 0) * 20 +
      (previous?.weighted_load ?? 0) * 3
    );
  };

  const opsLeadRank = (name: string) =>
    isOpsTarget && dayLeadPeople.has(name) ? 0 : 1;

  if (isReliefTarget) {
    recommendedCandidates.sort((a, b) =>
      reliefNeed(b) - reliefNeed(a) || a.localeCompare(b, "de")
    );
  } else {
    recommendedCandidates.sort((a, b) =>
      opsLeadRank(a) - opsLeadRank(b) ||
      serviceLoad(a) - serviceLoad(b) ||
      a.localeCompare(b, "de")
    );
  }

  const recommended = recommendedCandidates.slice(0, 5);

  // --- Sprint 2: strukturierte Kandidatenliste für ALLE (aktiven) Personen ---

  const avgWeekly =
    people.length > 0
      ? [...weeklyTotal.values()].reduce((sum, value) => sum + value, 0) / people.length
      : 0;

  const showLabelsToday = targetDate ? onStageShowsByDate[targetDate] ?? [] : [];
  const showLabelText = showLabelsToday.join(" / ");
  const hasRehearsalDataThisWeek = rehearsalIntervals.length > 0;
  const hasShowDataThisWeek = Object.keys(onStageByDate).length > 0;

  function unavailableReasons(name: string): CandidateReason[] {
    const reasons: CandidateReason[] = [];
    if (unavailable.has(name)) {
      const kind = absenceKind.get(name) ?? "Urlaub/Krank";
      reasons.push(buildReason("absence", kind));
    }
    if (isReliefTarget && (reliefTotal.get(name) ?? 0) > 0) {
      reasons.push(
        buildReason(
          "already_assigned_relief",
          "Hat diese Woche bereits einen Ausschlaf- oder Barfrei-Tag",
        ),
      );
    }
    if (dekoReliefBlocked && dekoPeople.includes(name)) {
      reasons.push(
        buildReason(
          "deko_show_lock",
          "Deko-Mitarbeiter: an Showtagen für Ausschlafen/Barfrei gesperrt (Bühnenauf-/abbau)",
        ),
      );
    }
    if (!isReliefTarget && timeConflicts.has(name)) {
      reasons.push(
        buildReason("time_conflict", "Bereits in einem zeitgleichen Dienst eingeteilt"),
      );
    }
    const overlapRehearsal = rehearsalOverlapDetail.get(name);
    if (overlapRehearsal) {
      reasons.push(
        buildReason(
          "rehearsal_overlap",
          `Probe „${overlapRehearsal.activity}“ ${clockLabel(overlapRehearsal.start_time)}–${clockLabel(overlapRehearsal.end_time)} Uhr überschneidet sich`,
        ),
      );
    }
    if ((rule?.blocked_people ?? []).includes(name)) {
      reasons.push(
        buildReason("rule_blocked", rule?.message || "Für diesen Dienst nicht zulässig"),
      );
    }
    return sortReasons(reasons);
  }

  function warningReasons(name: string): CandidateReason[] {
    const reasons: CandidateReason[] = [];
    if (
      rule &&
      (rule.allowed_people ?? people).includes(name) &&
      !(rule.recommended_people ?? []).includes(name)
    ) {
      const preferenceText: Record<string, string> = {
        sport_spt: "Sportprogramm bevorzugt SPT; manuelle Ausnahme möglich",
        sport_guests_vs_robins: "Gäste vs. Robins bevorzugt SPT; manuelle Ausnahme möglich",
        kp3_no_sound_light: "KP3 bevorzugt andere Abteilungen vor S&L",
        ops_managers: "OPS/WP bevorzugt Manager",
        aperitif_sound_light: "Aperitif bevorzugt S&L",
      };
      reasons.push(
        buildReason(
          "department_preference",
          preferenceText[rule.id] ?? "Laut Abteilungslogik nicht die erste Empfehlung",
        ),
      );
    }
    if (showConflict.has(name)) {
      const detail = showConflictDetail.get(name);
      reasons.push(
        buildReason(
          "show_conflict",
          detail
            ? `Show „${detail.activity}“ ab ${clockLabel(detail.start_time)} Uhr`
            : showLabelText
              ? `Show „${showLabelText}“ an diesem Abend`
              : "Steht an diesem Abend laut Planung auf der Bühne",
        ),
      );
    }
    const nearbyLevel = rehearsalNearby.get(name) ?? 0;
    if (nearbyLevel > 0) {
      const detail = rehearsalNearbyDetail.get(name);
      const closeness = nearbyLevel === 2 ? "sehr knapper" : "knapper";
      reasons.push(
        buildReason(
          "rehearsal_nearby",
          detail
            ? `Probe „${detail.activity}“ ${clockLabel(detail.start_time)}–${clockLabel(detail.end_time)} Uhr – ${closeness} Übergang`
            : `Probe zeitlich nah an diesem Dienst – ${closeness} Übergang`,
        ),
      );
    }
    const day = dayTotal.get(name) ?? 0;
    if (day >= HIGH_DAILY_LOAD_THRESHOLD) {
      reasons.push(
        buildReason("high_daily_load", `Bereits ${day} Einsätze an diesem Tag`),
      );
    }
    const weekly = weeklyTotal.get(name) ?? 0;
    if (weekly >= 6 && weekly > avgWeekly * HIGH_WEEKLY_LOAD_FACTOR) {
      reasons.push(
        buildReason(
          "high_weekly_load",
          `Bereits ${weekly} Einsätze in dieser Woche (Team-Ø ${roundDisplay(avgWeekly)})`,
        ),
      );
    }
    const sameCategory = categoryTotal.get(name) ?? 0;
    if (sameCategory >= REPEATED_TASK_THRESHOLD) {
      reasons.push(
        buildReason(
          "repeated_task",
          `Bereits ${sameCategory}x diese Woche in ${targetCategory} eingeteilt`,
        ),
      );
    }
    return sortReasons(reasons);
  }

  function recommendedReasons(name: string): CandidateReason[] {
    const reasons: CandidateReason[] = [
      buildReason("no_time_conflict", "Keine Konflikte"),
    ];
    if (isReliefTarget) {
      reasons.push(
        buildReason("fairness_balance", "Faire Wochenverteilung bei Ausschlafen/Barfrei"),
      );
      return sortReasons(reasons);
    }
    if (isOpsTarget && dayLeadPeople.has(name)) {
      reasons.push(buildReason("day_lead", "Hat an diesem Tag die Tagesverantwortung"));
    }
    const day = dayTotal.get(name) ?? 0;
    const weekly = weeklyTotal.get(name) ?? 0;
    const sameCategory = categoryTotal.get(name) ?? 0;
    if (day === 0) {
      reasons.push(buildReason("low_daily_load", "Heute noch kein weiterer Dienst"));
    }
    if (weekly <= avgWeekly) {
      reasons.push(
        buildReason(
          "low_weekly_load",
          `${weekly} Dienste diese Woche (Team-Ø ${roundDisplay(avgWeekly)})`,
        ),
      );
    }
    if (sameCategory > 0 && sameCategory < REPEATED_TASK_THRESHOLD) {
      reasons.push(
        buildReason("matching_experience", `Bereits mit ${targetCategory} vertraut`),
      );
    }
    if (hasRehearsalDataThisWeek && !rehearsalToday.has(name)) {
      reasons.push(buildReason("no_rehearsal", "Keine Probe an diesem Tag"));
    }
    if (isEveningTarget && hasShowDataThisWeek && !showConflict.has(name)) {
      reasons.push(buildReason("no_show_conflict", "Steht diesen Abend nicht auf der Bühne"));
    }
    return sortReasons(reasons).slice(0, 3);
  }

  // "Empfohlen" ist bewusst auf Kandidaten ohne jede Warnung beschränkt - eine
  // Person mit Proben-Nähe- oder Show-Hinweis landet immer in der Warngruppe,
  // selbst wenn sie sonst ganz oben im Ranking stünde (siehe Aufgabe 3).
  const cleanRecommended = recommendedCandidates.filter(
    (name) => warningReasons(name).length === 0,
  );
  const recommendedForStatus = new Set(
    (isReliefTarget
      ? [...cleanRecommended].sort((a, b) => reliefNeed(b) - reliefNeed(a) || a.localeCompare(b, "de"))
      : [...cleanRecommended].sort((a, b) =>
          opsLeadRank(a) - opsLeadRank(b) ||
          serviceLoad(a) - serviceLoad(b) ||
          a.localeCompare(b, "de"),
        )
    ).slice(0, 5),
  );

  const candidates: CandidateInfo[] = people.map((name) => {
    if (blocked.has(name)) {
      return {
        name,
        status: "unavailable",
        reasons: unavailableReasons(name),
        score: 0,
      };
    }
    const warnings = warningReasons(name);
    if (warnings.length > 0) {
      return { name, status: "warning", reasons: warnings, score: serviceLoad(name) };
    }
    if (recommendedForStatus.has(name)) {
      return {
        name,
        status: "recommended",
        reasons: recommendedReasons(name),
        score: isReliefTarget ? -reliefNeed(name) : serviceLoad(name),
      };
    }
    return { name, status: "available", reasons: [], score: serviceLoad(name) };
  });

  return {
    recommendedPeople: recommended,
    blockedPeople: [...blocked],
    nearbyPeople: [...rehearsalNearby.keys()].filter((name) => !blocked.has(name)),
    showPeople: [...showConflict].filter((name) => !blocked.has(name)),
    hint: dekoReliefBlocked
      ? "Showtag: Deko ist wegen Bühnenaufbau und -abbau für Ausschlafen und Barfrei gesperrt."
      : showConflict.size > 0
        ? "Rot markierte MA stehen an diesem Abend in der Show – nur im Ausnahmefall einplanen."
        : rule?.message ?? "",
    candidates,
    targetInterval,
    targetDate,
  };
}
