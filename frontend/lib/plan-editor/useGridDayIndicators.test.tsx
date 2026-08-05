import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import type { GridApi } from "ag-grid-community";
import type { DayStatus } from "@/lib/plan-editor/dayStatus";
import { useGridDayIndicators } from "@/lib/plan-editor/useGridDayIndicators";

/**
 * Tests für AP8 (Plan-Editor-Renderpfad): dieser Hook ist der Mechanismus,
 * der `columnDefs` bei Zellklick/Statusänderung stabil hält - er berührt
 * `columnDefs` selbst nie (kein Import, kein Aufruf), sondern spiegelt
 * `activeDay`/`dayStatuses` in abonnierbare Stores und stößt gezielte
 * AG-Grid-Refreshes an. Dass `columnDefs` dadurch nicht neu gebaut wird,
 * folgt direkt daraus, dass dieser Hook der EINZIGE Ort ist, an dem
 * `page.tsx` auf Tages-/Statusänderungen reagiert (siehe page.tsx:
 * effectiveActiveDay/dayStatuses stehen nicht mehr im columnDefs-
 * Dependency-Array).
 *
 * Die Subscribe-Tests decken einen im manuellen Browser-Test gefundenen
 * echten Fehler ab: `refreshHeader()` allein reicht bei ag-grid-react NICHT
 * aus, um eine benutzerdefinierte React-Headerkomponente neu rendern zu
 * lassen - ohne ein echtes Store-Abo blieb die Kachel-Markierung im Header
 * nach einem Tageswechsel visuell stehen, obwohl `cellClassRules` bereits
 * korrekt aktualisierte. Deshalb wird hier explizit geprüft, dass `set()`
 * registrierte Listener auch tatsächlich benachrichtigt.
 */

function makeGridApiRef(): RefObject<GridApi<unknown> | null> & {
  refreshHeader: ReturnType<typeof vi.fn>;
  refreshCells: ReturnType<typeof vi.fn>;
} {
  const refreshHeader = vi.fn();
  const refreshCells = vi.fn();
  const ref = {
    current: { refreshHeader, refreshCells } as unknown as GridApi<unknown>,
  } as RefObject<GridApi<unknown> | null>;
  return Object.assign(ref, { refreshHeader, refreshCells });
}

const status = (overrides: Partial<DayStatus> = {}): DayStatus => ({
  hasErrors: false,
  hasWarnings: false,
  incomplete: false,
  isToday: false,
  isDirty: false,
  ...overrides,
});

const STABLE_EMPTY_STATUSES: Record<string, DayStatus | undefined> = {};

describe("useGridDayIndicators - Zellklick (aktiver Tag)", () => {
  it("spiegelt den aktiven Tag sofort in den Store, auch vor Grid-Initialisierung", () => {
    const gridApiRef = { current: null } as RefObject<GridApi<unknown> | null>;
    const { result } = renderHook(
      ({ day }) => useGridDayIndicators(gridApiRef, day, STABLE_EMPTY_STATUSES),
      { initialProps: { day: "Mo, 10.08." } },
    );
    expect(result.current.activeDayStore.get()).toBe("Mo, 10.08.");
  });

  it("ruft bei einem Tageswechsel refreshHeader() und ein gezieltes refreshCells() auf", () => {
    const gridApiRef = makeGridApiRef();
    const { result, rerender } = renderHook(
      ({ day }) => useGridDayIndicators(gridApiRef, day, STABLE_EMPTY_STATUSES),
      { initialProps: { day: "Mo, 10.08." } },
    );

    rerender({ day: "Di, 11.08." });

    expect(result.current.activeDayStore.get()).toBe("Di, 11.08.");
    expect(gridApiRef.refreshHeader).toHaveBeenCalledTimes(1);
    expect(gridApiRef.refreshCells).toHaveBeenCalledTimes(1);
    expect(gridApiRef.refreshCells).toHaveBeenCalledWith({
      columns: ["Mo, 10.08.", "Di, 11.08."],
      force: true,
    });
  });

  it("benachrichtigt abonnierte Listener bei einem Tageswechsel (Header-Re-Render-Mechanismus)", () => {
    const gridApiRef = makeGridApiRef();
    const { result, rerender } = renderHook(
      ({ day }) => useGridDayIndicators(gridApiRef, day, STABLE_EMPTY_STATUSES),
      { initialProps: { day: "Mo, 10.08." } },
    );

    const listener = vi.fn();
    const unsubscribe = result.current.activeDayStore.subscribe(listener);

    rerender({ day: "Di, 11.08." });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    rerender({ day: "Mi, 12.08." });
    expect(listener).toHaveBeenCalledTimes(1); // nach unsubscribe keine weiteren Aufrufe
  });

  it("mehrere Klicks auf denselben, bereits aktiven Tag lösen keinen weiteren Refresh und keine Listener-Benachrichtigung aus", () => {
    const gridApiRef = makeGridApiRef();
    const { result, rerender } = renderHook(
      ({ day }) => useGridDayIndicators(gridApiRef, day, STABLE_EMPTY_STATUSES),
      { initialProps: { day: "Mo, 10.08." } },
    );
    const listener = vi.fn();
    result.current.activeDayStore.subscribe(listener);

    // Simuliert mehrere Zellklicks innerhalb derselben Spalte - der aktive
    // Tag ändert sich dabei nie.
    rerender({ day: "Mo, 10.08." });
    rerender({ day: "Mo, 10.08." });
    rerender({ day: "Mo, 10.08." });

    expect(gridApiRef.refreshHeader).not.toHaveBeenCalled();
    expect(gridApiRef.refreshCells).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("wartet mit dem Refresh, bis das Grid bereit ist (kein Fehler vor onGridReady)", () => {
    const gridApiRef = { current: null } as RefObject<GridApi<unknown> | null>;
    const { result, rerender } = renderHook(
      ({ day }) => useGridDayIndicators(gridApiRef, day, STABLE_EMPTY_STATUSES),
      { initialProps: { day: "Mo, 10.08." } },
    );

    expect(() => rerender({ day: "Di, 11.08." })).not.toThrow();
    expect(result.current.activeDayStore.get()).toBe("Di, 11.08.");

    // Grid wird jetzt "bereit" (onGridReady) - der zuletzt gültige Wert muss
    // sofort korrekt lesbar sein, auch ohne dass seither ein erneuter
    // Tageswechsel stattgefunden hat.
    const refreshHeader = vi.fn();
    const refreshCells = vi.fn();
    (gridApiRef as { current: unknown }).current = { refreshHeader, refreshCells };
    expect(result.current.activeDayStore.get()).toBe("Di, 11.08.");
  });
});

describe("useGridDayIndicators - Statusänderung", () => {
  it("aktualisiert den Status-Store und ruft NUR refreshHeader() auf (keine Zell-Refreshes)", () => {
    const gridApiRef = makeGridApiRef();
    const { result, rerender } = renderHook(
      ({ statuses }) => useGridDayIndicators(gridApiRef, "Mo, 10.08.", statuses),
      { initialProps: { statuses: { "Mo, 10.08.": status() } } },
    );

    rerender({ statuses: { "Mo, 10.08.": status({ hasErrors: true }) } });

    expect(result.current.dayStatusesStore.get()["Mo, 10.08."]?.hasErrors).toBe(true);
    expect(gridApiRef.refreshHeader).toHaveBeenCalledTimes(1);
    expect(gridApiRef.refreshCells).not.toHaveBeenCalled();
  });

  it("benachrichtigt abonnierte Listener bei einer Statusänderung", () => {
    const gridApiRef = makeGridApiRef();
    const { result, rerender } = renderHook(
      ({ statuses }) => useGridDayIndicators(gridApiRef, "Mo, 10.08.", statuses),
      { initialProps: { statuses: { "Mo, 10.08.": status() } } },
    );
    const listener = vi.fn();
    result.current.dayStatusesStore.subscribe(listener);

    rerender({ statuses: { "Mo, 10.08.": status({ hasWarnings: true } ) } });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("mehrere Statusänderungen rufen refreshHeader() jeweils genau einmal auf", () => {
    const gridApiRef = makeGridApiRef();
    const { rerender } = renderHook(
      ({ statuses }) => useGridDayIndicators(gridApiRef, "Mo, 10.08.", statuses),
      { initialProps: { statuses: { "Mo, 10.08.": status() } } },
    );

    for (let i = 0; i < 5; i += 1) {
      rerender({ statuses: { "Mo, 10.08.": status({ hasWarnings: i % 2 === 0 }) } });
    }

    expect(gridApiRef.refreshHeader).toHaveBeenCalledTimes(5);
    expect(gridApiRef.refreshCells).not.toHaveBeenCalled();
  });
});
