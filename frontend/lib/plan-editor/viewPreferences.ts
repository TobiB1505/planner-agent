export type PlanViewMode = "week" | "detail";
export type PlanDensity = "compact" | "standard" | "large";

export interface PlanViewPreferences {
  viewMode: PlanViewMode;
  density: PlanDensity;
}

const STORAGE_KEY = "planner-agent:plan-editor:view-preferences:v1";

const DEFAULT_PREFERENCES: PlanViewPreferences = {
  viewMode: "detail",
  density: "standard",
};

function isViewMode(value: unknown): value is PlanViewMode {
  return value === "week" || value === "detail";
}

function isDensity(value: unknown): value is PlanDensity {
  return value === "compact" || value === "standard" || value === "large";
}

export function defaultPlanViewPreferences(viewportWidth?: number): PlanViewPreferences {
  if (viewportWidth !== undefined && viewportWidth < 1500) {
    return { viewMode: "week", density: "compact" };
  }
  return DEFAULT_PREFERENCES;
}

export function loadPlanViewPreferences(viewportWidth?: number): PlanViewPreferences {
  const fallback = defaultPlanViewPreferences(viewportWidth);
  if (typeof window === "undefined") return fallback;

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored) as Partial<PlanViewPreferences>;
    return {
      viewMode: isViewMode(parsed.viewMode) ? parsed.viewMode : fallback.viewMode,
      density: isDensity(parsed.density) ? parsed.density : fallback.density,
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

