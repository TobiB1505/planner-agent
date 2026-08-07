// AP12 (Schritt 4): Laden (Referenzdaten), Speichern, Dirty-Tracking, Save-
// Status und Fokus-Reload aus page.tsx extrahiert. Gleiche API-Aufrufe,
// gleiche Fehlerbehandlung, gleiche Speicher-Reihenfolge wie vorher - siehe
// docs/refactoring/AP12_PLAN_EDITOR_SPLIT.md für die Abgrenzung gegenüber dem
// (bewusst NICHT extrahierten) Archivplan-Ladeeffekt.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { GridApi } from "ag-grid-community";
import {
  getActivePeople,
  getArtistPlans,
  getPlanTemplates,
  getRehearsalPlans,
  getWeeks,
  savePlan,
  type ArtistPlanSummary,
  type PlanAuditEventInput,
  type PlanTemplate,
  type RehearsalPlanSummary,
  type WeekSummary,
} from "@/lib/api";
import { useThrottledFocusReload } from "@/lib/plan-editor/useThrottledFocusReload";
import type { PlanRow, SaveState } from "../types";
import { addDays, isoWeek, formatDateRange } from "../utils/planEditorHelpers";

export interface UsePlanPersistenceOptions {
  gridApiRef: RefObject<GridApi<PlanRow> | null>;
  rows: PlanRow[];
  dayLabels: string[];
  startDate: string;
  resolvedTemplateWeekId: number | null;
  loadedArchivedWeek: WeekSummary | null;
  onLoadedArchivedWeekChange: (week: WeekSummary) => void;
  onMessage: (message: { kind: "success" | "error" | "info"; text: string } | null) => void;
  onBusyChange: (busy: boolean) => void;
  /** Wird nach erfolgreichem Laden der Referenzdaten aufgerufen - die Seite
   * entscheidet selbst, ob `initializing` beendet werden kann (nämlich genau
   * dann, wenn keine archivierte Woche zum heutigen Montag passt und der
   * separate Archivplan-Ladeeffekt deshalb nie anläuft). */
  onReferenceDataLoaded: (storedWeeks: WeekSummary[]) => void;
  onReferenceDataError: (message: string) => void;
}

export function usePlanPersistence({
  gridApiRef,
  rows,
  dayLabels,
  startDate,
  resolvedTemplateWeekId,
  loadedArchivedWeek,
  onLoadedArchivedWeekChange,
  onMessage,
  onBusyChange,
  onReferenceDataLoaded,
  onReferenceDataError,
}: UsePlanPersistenceOptions) {
  // ---------- Referenzdaten (Laden) ----------
  const [templates, setTemplates] = useState<PlanTemplate[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [artistPlans, setArtistPlans] = useState<ArtistPlanSummary[]>([]);
  const [rehearsalPlans, setRehearsalPlans] = useState<RehearsalPlanSummary[]>([]);
  const [archivedWeeks, setArchivedWeeks] = useState<WeekSummary[]>([]);

  // AP8: `mountedRef` schützt sowohl den initialen Ladevorgang als auch den
  // fokus-getriggerten Reload (useThrottledFocusReload) davor, nach einem
  // Unmount noch State zu setzen.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Sprint 2 (Phase 9.1): ein neuer Ladevorgang (z.B. erneuter Fokus-Reload,
  // siehe useThrottledFocusReload) bricht einen noch laufenden vorherigen
  // Ladevorgang wirklich ab (AbortController), statt nur dessen Ergebnis
  // über mountedRef zu verwerfen - erspart dem Backend unnötige Arbeit bei
  // schnellen Folgeaktionen und wird beim Unmount ebenfalls abgebrochen.
  const loadAbortControllerRef = useRef<AbortController | null>(null);

  const loadReferenceData = useCallback(() => {
    loadAbortControllerRef.current?.abort();
    const controller = new AbortController();
    loadAbortControllerRef.current = controller;
    const { signal } = controller;
    return Promise.all([
      getPlanTemplates(signal),
      getActivePeople(signal),
      getArtistPlans(signal),
      getRehearsalPlans(signal),
      getWeeks(signal),
    ])
      .then(([templateData, activePeople, storedArtistPlans, storedRehearsalPlans, storedWeeks]) => {
        if (!mountedRef.current) return;
        setTemplates(templateData);
        setPeople(activePeople);
        setArtistPlans(storedArtistPlans);
        setRehearsalPlans(storedRehearsalPlans);
        setArchivedWeeks(storedWeeks);
        onReferenceDataLoaded(storedWeeks);
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        if (!mountedRef.current) return;
        onReferenceDataError(error.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(loadReferenceData, 0);
    return () => {
      window.clearTimeout(timer);
      loadAbortControllerRef.current?.abort();
    };
  }, [loadReferenceData]);

  // AP8: vorher lud `window.focus` ungedrosselt bei jedem Tab-Wechsel dieselben
  // fünf Endpunkte neu - jetzt mit Mindestabstand (30s) und In-Flight-Schutz
  // (siehe useThrottledFocusReload). Verhalten bezüglich Dirty State
  // unverändert: `loadReferenceData` berührt weder `rows` noch `isDirty`.
  useThrottledFocusReload(loadReferenceData);

  // ---------- Dirty-Tracking ----------
  const [isDirty, setIsDirty] = useState(false);
  const [changeCount, setChangeCount] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const manuallyEditedCellsRef = useRef<Set<string>>(new Set());
  const auditEventsRef = useRef<PlanAuditEventInput[]>([]);
  // Sprint 2 (Phase 10): synchroner Schutz gegen Doppel-Speichern zusätzlich
  // zum disabled-Zustand des Speichern-Buttons (busy || !isDirty) - der
  // React-State-Update, der den Button deaktiviert, greift erst nach dem
  // nächsten Render, ein Ref dagegen sofort beim ersten performSave()-Aufruf.
  const savingRef = useRef(false);

  const markDirty = useCallback((count = 1) => {
    setIsDirty(true);
    setChangeCount((current) => current + count);
    setSaveState("idle");
  }, []);

  const clearDirty = useCallback(() => {
    setIsDirty(false);
    setChangeCount(0);
    manuallyEditedCellsRef.current.clear();
    auditEventsRef.current = [];
    gridApiRef.current?.refreshCells({ force: true });
  }, [gridApiRef]);

  const recordAudit = useCallback((event: PlanAuditEventInput) => {
    auditEventsRef.current.push(event);
  }, []);

  const markManuallyEdited = useCallback((key: string) => {
    manuallyEditedCellsRef.current.add(key);
  }, []);

  /** Setzt den Speicherstatus auf den Ausgangszustand zurück - aufgerufen
   * nach einem Wochenwechsel und nach dem Laden eines Archivplans (beides
   * markiert eine neue Vergleichsbasis, für die noch nichts "gespeichert"
   * oder "fehlgeschlagen" sein kann). */
  const resetSaveStatus = useCallback(() => {
    setSaveState("idle");
    setSaveError("");
    setLastSavedAt(null);
  }, []);

  // ---------- Speichern ----------
  const performSave = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) return false;
    if (!rows.length) return false;
    if (!resolvedTemplateWeekId) {
      onMessage({ kind: "error", text: "Bitte den Plan zuerst neu erstellen." });
      return false;
    }
    savingRef.current = true;
    onBusyChange(true);
    setSaveState("saving");
    try {
      const result = await savePlan({
        start_date: startDate,
        end_date: addDays(startDate, 6),
        template_week_id: resolvedTemplateWeekId,
        existing_week_id: loadedArchivedWeek?.id,
        day_labels: dayLabels,
        rows,
        audit_events: auditEventsRef.current,
      });
      const savedEndDate = addDays(startDate, 6);
      const fallbackWeek: WeekSummary = {
        id: result.week_plan_id,
        kw: isoWeek(startDate),
        start_date: startDate,
        end_date: savedEndDate,
        source: null,
        label: `KW${isoWeek(startDate)} · ${formatDateRange(startDate, savedEndDate)}`,
        assignment_count: 0,
        absence_count: 0,
      };
      let savedWeek = result.week ?? fallbackWeek;
      let refreshedWeeks: WeekSummary[] | null = null;

      // Ältere, noch laufende Backend-Prozesse liefern nach dem Speichern nur
      // week_plan_id. In diesem Fall laden wir die Archivübersicht nach und
      // bleiben selbst dann funktionsfähig, wenn dieser zweite Abruf scheitert.
      if (!result.week) {
        try {
          refreshedWeeks = await getWeeks();
          savedWeek =
            refreshedWeeks.find((week) => week.id === result.week_plan_id) ??
            refreshedWeeks.find((week) => week.start_date === startDate) ??
            fallbackWeek;
        } catch {
          // Der Plan selbst wurde bereits erfolgreich gespeichert. Die lokal
          // erzeugte Zusammenfassung reicht bis zum nächsten Seitenabruf aus.
        }
      }
      const saveWarnings = result.warnings ?? [];
      // Ab dem ersten erfolgreichen Speichern ist dies ein bestehender
      // Archivplan. Dadurch aktualisiert jeder weitere Klick exakt dieselbe
      // Woche, statt einen zweiten Datensatz anzulegen.
      onLoadedArchivedWeekChange(savedWeek);
      setArchivedWeeks((current) =>
        refreshedWeeks ?? [
          savedWeek,
          ...current.filter(
            (week) =>
              week.id !== savedWeek.id &&
              week.start_date !== savedWeek.start_date,
          ),
        ],
      );
      onMessage({
        kind: saveWarnings.length ? "info" : "success",
        text: loadedArchivedWeek
          ? `${savedWeek.label} wurde mit deinen Änderungen aktualisiert.${
              saveWarnings.length
                ? ` Planungs-Hinweis: ${saveWarnings.slice(0, 2).join(" · ")}`
                : ""
            }`
          : `Plan gespeichert (Archiv-Nr. ${result.week_plan_id}).${
              saveWarnings.length
                ? ` Planungs-Hinweis: ${saveWarnings.slice(0, 2).join(" · ")}`
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
      onMessage({ kind: "error", text });
      setSaveState("error");
      setSaveError(text);
      return false;
    } finally {
      savingRef.current = false;
      onBusyChange(false);
    }
  }, [
    clearDirty,
    dayLabels,
    loadedArchivedWeek,
    onBusyChange,
    onLoadedArchivedWeekChange,
    onMessage,
    resolvedTemplateWeekId,
    rows,
    startDate,
  ]);

  // Das Konflikt-Gate (Sprint 3, Aufgabe 8: "vor dem Speichern erst
  // validation.summary.blockingIssues prüfen") bleibt bewusst in page.tsx -
  // `validation` selbst hängt an `people` aus diesem Hook, ein Gate hier
  // hätte einen Zirkelbezug erzeugt. page.tsx definiert dafür einen
  // hauchdünnen `save()`-Wrapper um `performSave()`.

  return {
    // Referenzdaten
    templates,
    people,
    artistPlans,
    rehearsalPlans,
    archivedWeeks,
    setArchivedWeeks,
    loadReferenceData,
    // Dirty/Save-Status
    isDirty,
    changeCount,
    saveState,
    saveError,
    lastSavedAt,
    manuallyEditedCellsRef,
    auditEventsRef,
    markDirty,
    clearDirty,
    resetSaveStatus,
    recordAudit,
    markManuallyEdited,
    // Speichern
    performSave,
  };
}
