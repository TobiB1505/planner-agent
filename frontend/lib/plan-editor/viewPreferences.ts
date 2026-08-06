import { useSyncExternalStore } from "react";

export type PlanDensity = "compact" | "standard" | "large";
export type PlanEditorViewMode = "day" | "week";

export interface PlanViewPreferences {
  density: PlanDensity;
  viewMode: PlanEditorViewMode;
}

const STORAGE_KEY = "planner-agent:plan-editor:view-preferences:v1";

/* Sprint 3 (Phase 9.4): unterhalb dieser Breite ist das Wochen-Grid faktisch
   unbenutzbar (7 Tagesspalten à min. 94px + 252px angepinnte Spalten) -
   ohne gespeicherte Präferenz startet der Editor dort in der Tagesansicht.
   Eine ausdrücklich gewählte und damit gespeicherte Ansicht gewinnt immer. */
const NARROW_VIEWPORT_QUERY = "(max-width: 900px)";

const DEFAULT_PREFERENCES: PlanViewPreferences = {
  density: "compact",
  viewMode: "week",
};

function defaultViewModeForViewport(): PlanEditorViewMode {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES.viewMode;
  return window.matchMedia(NARROW_VIEWPORT_QUERY).matches ? "day" : "week";
}

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

  // Viewport-abhängiger Default nur clientseitig - der Server rendert
  // weiterhin deterministisch die Woche (useSyncExternalStore-Muster:
  // getServerSnapshot liefert DEFAULT_PREFERENCES, der Client korrigiert
  // nach der Hydration, exakt wie beim localStorage-Wert selbst).
  const viewportFallback: PlanViewPreferences = {
    ...fallback,
    viewMode: defaultViewModeForViewport(),
  };

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return viewportFallback;
    const parsed = JSON.parse(stored) as Partial<PlanViewPreferences>;
    return {
      density: isDensity(parsed.density) ? parsed.density : viewportFallback.density,
      viewMode: isViewMode(parsed.viewMode) ? parsed.viewMode : viewportFallback.viewMode,
    };
  } catch {
    return viewportFallback;
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
