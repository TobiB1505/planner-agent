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

const RELIEF_CATEGORIES = new Set(["Ausschlafen", "Barfrei"]);

function categoryOf(row: RecommendationRow): string {
  return row._category || row.Abschnitt;
}

function namesFromCell(value: string | null | undefined): string[] {
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

function timeKey(category: string, slot: string): string {
  const match = slot.match(/(^|[^\d])(\d{1,2})[:.](\d{2})(?!\d)/);
  return match
    ? `${Number(match[2]).toString().padStart(2, "0")}:${match[3]}`
    : `KATEGORIE:${category.toLocaleLowerCase("de")}`;
}

type TimeInterval = [number, number];

function clockMinutes(hour: string, minute: string): number {
  return Number(hour) * 60 + Number(minute);
}

function serviceInterval(category: string, slot: string): TimeInterval | null {
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

function storedInterval(startTime: string, endTime: string): TimeInterval {
  const [startHour, startMinute] = startTime.replace(".", ":").split(":");
  const [endHour, endMinute] = endTime.replace(".", ":").split(":");
  const start = clockMinutes(startHour, startMinute);
  let end = clockMinutes(endHour, endMinute);
  if (end <= start) end += 1440;
  return [start, end];
}

function overlap(first: TimeInterval, second: TimeInterval): boolean {
  const firstVariants: TimeInterval[] = [first, [first[0] + 1440, first[1] + 1440]];
  const secondVariants: TimeInterval[] = [second, [second[0] + 1440, second[1] + 1440]];
  return firstVariants.some(([startA, endA]) =>
    secondVariants.some(([startB, endB]) => startA < endB && startB < endA)
  );
}

function gapMinutes(first: TimeInterval, second: TimeInterval): number {
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
  const timeConflicts = new Set<string>();
  const workedLateBefore = new Set<string>();
  const rehearsalNearby = new Map<string, number>();

  for (const row of rows) {
    if (row._row_type === "group") continue;
    const category = categoryOf(row);

    if (category === "Frei" || category === "Urlaub/Krank") {
      for (const name of namesFromCell(row[dayLabel])) unavailable.add(name);
      continue;
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
  if (isEveningTarget && !isReliefTarget && targetDate) {
    for (const name of onStageByDate[targetDate] ?? []) showConflict.add(name);
  }
  if (!isReliefTarget && targetDate && targetInterval) {
    for (const rehearsal of rehearsalIntervals) {
      if (rehearsal.date !== targetDate) continue;
      const rehearsalSlot = storedInterval(
        rehearsal.start_time,
        rehearsal.end_time,
      );
      if (isEveningCooking && rehearsal.is_show) {
        showConflict.add(rehearsal.person_name);
        continue;
      }
      if (overlap(targetInterval, rehearsalSlot)) {
        blocked.add(rehearsal.person_name);
        continue;
      }
      const gap = gapMinutes(targetInterval, rehearsalSlot);
      const level = gap <= 30 ? 2 : gap <= 60 ? 1 : 0;
      if (level > (rehearsalNearby.get(rehearsal.person_name) ?? 0)) {
        rehearsalNearby.set(rehearsal.person_name, level);
      }
    }
  }

  const allowed = (rule?.allowed_people ?? people).filter((name) => !blocked.has(name));
  const baseRecommended = new Set(rule?.recommended_people ?? allowed);
  const recommendedCandidates = allowed.filter((name) => baseRecommended.has(name));

  if (isReliefTarget) {
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
    recommendedCandidates.sort((a, b) =>
      reliefNeed(b) - reliefNeed(a) || a.localeCompare(b, "de")
    );
  } else {
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
    recommendedCandidates.sort((a, b) =>
      serviceLoad(a) - serviceLoad(b) || a.localeCompare(b, "de")
    );
  }

  const recommended = recommendedCandidates.slice(0, 5);

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
  };
}
