import { useSyncExternalStore } from "react";

export type PlanDensity = "compact" | "standard" | "large";
export type PlanEditorViewMode = "day" | "week";

export interface PlanViewPreferences {
  density: PlanDensity;
  viewMode: PlanEditorViewMode;
}

const STORAGE_KEY = "planner-agent:plan-editor:view-preferences:v1";

const DEFAULT_PREFERENCES: PlanViewPreferences = {
  density: "compact",
  viewMode: "week",
};

function isDensity(value: unknown): value is PlanDensity {
  return value === "compact" || value === "standard" || value === "large";
}

function isViewMode(value: unknown): value is PlanEditorViewMode {
  return value === "day" || value === "week";
}

export function defaultPlanViewPreferences(): PlanViewPreferences {
  return DEFAULT_PREFERENCES;
}

export function loadPlanViewPreferences(): PlanViewPreferences {
  const fallback = defaultPlanViewPreferences();
  if (typeof window === "undefined") return fallback;

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored) as Partial<PlanViewPreferences>;
    return {
      density: isDensity(parsed.density) ? parsed.density : fallback.density,
      viewMode: isViewMode(parsed.viewMode) ? parsed.viewMode : fallback.viewMode,
    };
  } catch {
    return fallback;
  }
}

export function savePlanViewPreferences(preferences: PlanViewPreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Der Editor bleibt auch bei deaktiviertem/vollem LocalStorage nutzbar.
  }
}

// Sprint 0 (S1-Fix, C5): useSyncExternalStore statt localStorage im
// State-Initializer bzw. setState im Mount-Effekt (React/eslint markiert
// Letzteres als Kaskaden-Render-Risiko). getServerSnapshot liefert bewusst
// immer die Defaults, exakt das bereits im Projekt etablierte,
// SSR-sichere Muster aus pwa-install-button.tsx - kein Hydration-Mismatch,
// weil Server und erster Client-Render garantiert dasselbe rendern.
let cachedPreferences: PlanViewPreferences | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): PlanViewPreferences {
  if (cachedPreferences === null) cachedPreferences = loadPlanViewPreferences();
  return cachedPreferences;
}

function getServerSnapshot(): PlanViewPreferences {
  return DEFAULT_PREFERENCES;
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export type SetPlanViewPreferences = (
  next: PlanViewPreferences | ((current: PlanViewPreferences) => PlanViewPreferences),
) => void;

const setPreferences: SetPlanViewPreferences = (next) => {
  const resolved = typeof next === "function" ? next(getSnapshot()) : next;
  cachedPreferences = resolved;
  savePlanViewPreferences(resolved);
  listeners.forEach((listener) => listener());
};

export function usePlanViewPreferences(): [PlanViewPreferences, SetPlanViewPreferences] {
  const preferences = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [preferences, setPreferences];
}
