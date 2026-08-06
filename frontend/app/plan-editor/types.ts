// AP12: gemeinsame Typen des Plan-Editors - unverändert aus page.tsx übernommen,
// nur an eine eigene Datei ausgelagert, damit Hooks/Komponenten sie ohne
// Zirkelimport von page.tsx mitnutzen können.
import type { PlanGenerateResult } from "@/lib/api";
import type { PlanDiff } from "@/lib/plan-editor/planDiff";

export type PlanRow = Record<string, string | null> & {
  Abschnitt: string;
  Zeile: string;
  _row_type: "data" | "group";
  _category: string;
  _group_label: string | null;
  _group_color: string | null;
};

export type SaveState = "idle" | "saving" | "saved" | "error";

export type PendingAction =
  | { kind: "week-change"; nextDate: string }
  | { kind: "save-with-conflicts" }
  | { kind: "export-with-conflicts" };

export type PlanHistoryChange = {
  row: PlanRow;
  dayLabel: string;
  previousValue: string | null;
  nextValue: string | null;
};

export type PlanHistoryAction = {
  changes: PlanHistoryChange[];
};

export type AutomationPreview = {
  kind: "recalculate" | "rebuild" | "free-suggestion";
  title: string;
  description: string;
  applyLabel: string;
  diff: PlanDiff;
  nextRows: PlanRow[];
  result?: PlanGenerateResult;
  successMessage: string;
};
