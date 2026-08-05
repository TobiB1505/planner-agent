"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { GridApi } from "ag-grid-community";
import type { DayStatus } from "@/lib/plan-editor/dayStatus";

/**
 * Minimaler, extern lesbarer/abonnierbarer Wert-Container (React-frei).
 *
 * AP8: `refreshHeader()` allein reicht bei ag-grid-react NICHT aus, um eine
 * benutzerdefinierte React-Headerkomponente neu rendern zu lassen - die
 * Wrapper-Komponente von ag-grid-react ruft die Nutzerkomponente nur mit den
 * (unveränderten) `headerComponentParams` erneut auf, wenn AG Grid selbst
 * einen Re-Render dieser Zelle anstößt, was `refreshHeader()` für bereits
 * gemountete React-Headerkomponenten nicht garantiert (im Live-Test
 * reproduziert: die Zellmarkierung über `cellClassRules`+`refreshCells()`
 * aktualisierte sich korrekt, der Header nicht). `useSyncExternalStore` mit
 * echtem Abo (statt eines No-op-Abos) löst das zuverlässig: die Komponente
 * re-rendert sich über React selbst, sobald `set()` aufgerufen wird -
 * unabhängig vom AG-Grid-Lifecycle.
 */
export interface ReadableStore<T> {
  get: () => T;
  subscribe: (onChange: () => void) => () => void;
}

interface Store<T> extends ReadableStore<T> {
  /** Aktualisiert den Wert und benachrichtigt Abonnenten - gibt zurück, ob
   * sich der Wert tatsächlich geändert hat (für den Aufrufer, um z.B. einen
   * zusätzlichen `refreshHeader()`-Aufruf nur bei echter Änderung zu machen). */
  set: (next: T) => boolean;
}

function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(value, next)) return false;
      value = next;
      listeners.forEach((listener) => listener());
      return true;
    },
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
  };
}

export interface GridDayIndicatorsResult {
  /** Spiegelt immer den aktuell aktiven Tag - von `columnDefs`-Closures
   * (cellClassRules, headerClass, onCellClicked-Guard) per `.get()` und von
   * `DayHeaderCell` per `useSyncExternalStore` gelesen, statt eine
   * `columnDefs`-Abhängigkeit zu sein. */
  activeDayStore: ReadableStore<string>;
  /** Spiegelt immer die aktuellen Tagesstatus. */
  dayStatusesStore: ReadableStore<Record<string, DayStatus | undefined>>;
}

/**
 * Hält die aktive Tagesspalte und die Tagesstatus-Punkte im AG-Grid-Header/
 * in den Zellen aktuell, ohne dass sich `columnDefs` dafür neu bauen muss
 * (AP8 - Findings zu häufigen columnDefs-Rebuilds bei rein visuellen
 * Änderungen). Beide Werte ändern sich bei jedem Zellklick bzw. jeder
 * Planprüfung - ein kompletter columnDefs-Rebuild wäre für AG Grid unnötig
 * teuer. Stattdessen werden sie in kleinen externen Stores gespiegelt: die
 * Zell-Markierung (cellClassRules) wird zusätzlich per `refreshCells()`
 * gezielt nachgezogen (dasselbe Ref+refreshCells-Muster, das für
 * Konfliktmarkierungen bereits verwendet wird), der Header aktualisiert sich
 * über das Store-Abo selbst.
 *
 * `activeDay`/`dayStatuses` bleiben die fachliche Quelle der Wahrheit
 * (State in der Elternkomponente) - diese Stores sind ausschließlich ein
 * Rendering-Detail für AG Grid.
 */
export function useGridDayIndicators<TRow>(
  gridApiRef: RefObject<GridApi<TRow> | null>,
  activeDay: string,
  dayStatuses: Record<string, DayStatus | undefined>,
): GridDayIndicatorsResult {
  const [activeDayStore] = useState(() => createStore(activeDay));
  const [dayStatusesStore] = useState(() => createStore(dayStatuses));
  const previousActiveDayRef = useRef(activeDay);

  useEffect(() => {
    const previousDay = previousActiveDayRef.current;
    activeDayStore.set(activeDay);
    previousActiveDayRef.current = activeDay;
    if (previousDay === activeDay) return;

    const api = gridApiRef.current;
    if (!api) return;
    api.refreshHeader();
    const affectedColumns = Array.from(new Set([previousDay, activeDay].filter(Boolean)));
    if (affectedColumns.length) {
      api.refreshCells({ columns: affectedColumns, force: true });
    }
  }, [activeDay, gridApiRef, activeDayStore]);

  useEffect(() => {
    const changed = dayStatusesStore.set(dayStatuses);
    if (!changed) return;
    gridApiRef.current?.refreshHeader();
  }, [dayStatuses, dayStatusesStore, gridApiRef]);

  return { activeDayStore, dayStatusesStore };
}
