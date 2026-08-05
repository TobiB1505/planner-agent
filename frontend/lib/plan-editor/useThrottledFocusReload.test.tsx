import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useThrottledFocusReload } from "@/lib/plan-editor/useThrottledFocusReload";

/**
 * Tests für AP8 (Fokus-Reload-Drosselung): vorher lud `window.focus` bei
 * jedem Tab-Wechsel ungedrosselt fünf Endpunkte neu. Deckt die in Schritt 12
 * geforderten sieben Szenarien ab.
 */

function fireFocus() {
  window.dispatchEvent(new Event("focus"));
}

/** Lässt die Microtask-Queue leerlaufen, damit .then()/.catch()/.finally()
 * einer bereits aufgelösten/abgelehnten Promise tatsächlich durchlaufen -
 * unabhängig von den Fake-Timern, die nur Timer-basierte Aufrufe betreffen. */
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** Erzeugt eine steuerbare Reload-Funktion: der Test entscheidet selbst,
 * wann sie sich auflöst bzw. fehlschlägt (simuliert einen laufenden Request). */
function makeControllableReload() {
  let resolveCurrent: (() => void) | null = null;
  let rejectCurrent: ((error: Error) => void) | null = null;
  const calls: number[] = [];
  const fn = vi.fn(() => {
    calls.push(Date.now());
    return new Promise<void>((resolve, reject) => {
      resolveCurrent = resolve;
      rejectCurrent = reject;
    });
  });
  return {
    fn,
    calls,
    resolve: () => resolveCurrent?.(),
    reject: (error: Error) => rejectCurrent?.(error),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-10T10:00:00Z"));
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useThrottledFocusReload", () => {
  it("führt beim ersten Fokus einen Reload aus", async () => {
    const reload = makeControllableReload();
    renderHook(() => useThrottledFocusReload(reload.fn));

    fireFocus();
    expect(reload.fn).toHaveBeenCalledTimes(1);
    await reload.resolve();
  });

  it("ignoriert einen zweiten Fokus innerhalb von 30 Sekunden", async () => {
    const reload = makeControllableReload();
    renderHook(() => useThrottledFocusReload(reload.fn));

    fireFocus();
    expect(reload.fn).toHaveBeenCalledTimes(1);
    await reload.resolve();

    vi.setSystemTime(new Date("2026-08-10T10:00:15Z")); // +15s, unter 30s
    fireFocus();
    expect(reload.fn).toHaveBeenCalledTimes(1);
  });

  it("erlaubt nach Ablauf des Mindestabstands wieder einen Reload", async () => {
    const reload = makeControllableReload();
    renderHook(() => useThrottledFocusReload(reload.fn));

    fireFocus();
    expect(reload.fn).toHaveBeenCalledTimes(1);
    reload.resolve();
    await flushMicrotasks();

    vi.setSystemTime(new Date("2026-08-10T10:00:31Z")); // +31s, über 30s
    fireFocus();
    expect(reload.fn).toHaveBeenCalledTimes(2);
    reload.resolve();
    await flushMicrotasks();
  });

  it("verhindert einen parallelen zweiten Reload, während einer noch läuft", () => {
    const reload = makeControllableReload();
    renderHook(() => useThrottledFocusReload(reload.fn));

    fireFocus(); // startet Reload 1, löst sich absichtlich nicht auf
    expect(reload.fn).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-08-10T10:00:31Z")); // Intervall wäre abgelaufen
    fireFocus(); // Reload 1 läuft noch -> kein zweiter Aufruf
    expect(reload.fn).toHaveBeenCalledTimes(1);
  });

  it("setzt den In-Flight-Status bei einem Fehlschlag zurück und erlaubt einen späteren Reload", async () => {
    const reload = makeControllableReload();
    renderHook(() => useThrottledFocusReload(reload.fn));

    fireFocus();
    expect(reload.fn).toHaveBeenCalledTimes(1);
    reload.reject(new Error("Netzwerkfehler"));
    await flushMicrotasks();

    vi.setSystemTime(new Date("2026-08-10T10:00:31Z"));
    fireFocus();
    expect(reload.fn).toHaveBeenCalledTimes(2);
    reload.resolve();
    await flushMicrotasks();
  });

  it("entfernt den Listener beim Unmount - danach löst focus keinen Reload mehr aus", async () => {
    const reload = makeControllableReload();
    const { unmount } = renderHook(() => useThrottledFocusReload(reload.fn));

    unmount();
    fireFocus();
    expect(reload.fn).not.toHaveBeenCalled();
  });

  it("reagiert nicht auf focus, solange der Tab nicht sichtbar ist (Schritt 9)", () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    const reload = makeControllableReload();
    renderHook(() => useThrottledFocusReload(reload.fn));

    fireFocus();
    expect(reload.fn).not.toHaveBeenCalled();
  });
});
