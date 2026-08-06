"use client";

// Sprint 0 (S1-Fix, C1/C2): zentraler Schutz vor stillem Datenverlust bei
// ungespeicherten Änderungen. Ersetzt die bisher editor-lokale
// beforeunload-Logik und macht sie für Künstlerplan, Probenplan und
// Archiv-Import wiederverwendbar.
//
// Architektur: ein Modul-weites Register (statt Context) hält fest, WELCHE
// Seite/Formular gerade "dirty" ist, mit einer Nachricht dafür. Das erlaubt
// zwei unabhängige Konsumenten, ohne dass sie sich im selben
// Komponentenbaum befinden müssen:
// 1) useUnsavedChangesGuard() selbst - meldet isDirty an, hängt den
//    nativen beforeunload-Listener ein (Reload/Tab schließen - dafür ist
//    laut Auftrag ein nativer Browserdialog ausdrücklich zulässig).
// 2) <InternalNavigationGuard> (global, einmal in layout.tsx montiert) -
//    fängt Klicks auf interne <a>/<Link> ab (Sidebar, Seiten-Links) und
//    zeigt bei aktivem Guard die bestehende ConfirmDialog-Komponente,
//    bevor tatsächlich navigiert wird.
//
// Browser-Zurück/Vor (popstate) ist damit NICHT abgedeckt: der Browser hat
// die URL zu dem Zeitpunkt, an dem popstate feuert, bereits gewechselt: ein
// echtes "Abbrechen" gibt es nicht, nur ein nachträgliches
// Zurückspringen. Siehe InternalNavigationGuard-Kommentar für die
// Best-Effort-Lösung und ihre bekannten Grenzen.

import { useEffect, useRef } from "react";

interface GuardEntry {
  message: string;
}

const activeGuards = new Map<symbol, GuardEntry>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function subscribeToUnsavedChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Synchron lesbar (z.B. im Klick-Handler des globalen Link-Interceptors) -
 *  bewusst kein Hook, damit der Interceptor nicht bei jeder Dirty-Änderung
 *  irgendeiner Seite neu rendert. */
export function isAnyUnsavedChangesGuardActive(): boolean {
  return activeGuards.size > 0;
}

export function getActiveUnsavedChangesMessage(): string {
  const first = activeGuards.values().next();
  return first.done ? DEFAULT_MESSAGE : first.value.message;
}

const DEFAULT_MESSAGE = "Es gibt ungespeicherte Änderungen, die dabei verloren gehen.";

export interface UseUnsavedChangesGuardOptions {
  /** Grund/Kontext für den Dialogtext des globalen Link-Interceptors. */
  message?: string;
}

/**
 * Meldet isDirty in die geteilte Registry (für den globalen
 * Link-Interceptor) und sichert Reload/Tab-Schließen nativ ab.
 *
 * Für lokale, programmatische Navigation (Wochenwechsel, Ansicht wechseln,
 * Import-Dialog schließen) bleibt jede Seite bewusst bei ihrem eigenen
 * pendingAction-State + der vorhandenen ConfirmDialog-Komponente (siehe
 * app/plan-editor/page.tsx) - das ist bereits die richtige Lösung dafür und
 * muss nicht zentralisiert werden, nur einheitlich denselben isDirty-Wert
 * nutzen, den dieser Hook auch an die Registry meldet.
 */
export function useUnsavedChangesGuard(
  isDirty: boolean,
  options?: UseUnsavedChangesGuardOptions,
): void {
  const idRef = useRef<symbol | null>(null);
  if (idRef.current === null) idRef.current = Symbol("unsaved-changes-guard");
  const message = options?.message ?? DEFAULT_MESSAGE;

  useEffect(() => {
    const id = idRef.current!;
    if (isDirty) {
      activeGuards.set(id, { message });
    } else {
      activeGuards.delete(id);
    }
    notify();
    return () => {
      activeGuards.delete(id);
      notify();
    };
  }, [isDirty, message]);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);
}
