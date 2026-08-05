"use client";

import { useCallback, useEffect, useRef } from "react";

export interface UseThrottledFocusReloadOptions {
  /** Mindestabstand zwischen zwei gestarteten Reload-Versuchen (Schritt 8). */
  minIntervalMs?: number;
  /** Nur reagieren, wenn der Tab tatsächlich sichtbar ist (Schritt 9). */
  requireVisible?: boolean;
}

/**
 * Drosselt einen fokus-getriggerten Reload (AP8 - vorher lud `window.focus`
 * bei jedem Tab-Wechsel ungedrosselt fünf Endpunkte neu). Garantiert:
 *   - mindestens `minIntervalMs` (Standard 30s) zwischen zwei GESTARTETEN
 *     Versuchen - erfolgreich oder nicht
 *   - keinen parallelen zweiten Reload, während einer bereits läuft
 *   - dass nach Ablauf des Intervalls wieder normal geladen wird
 *   - dass ein Fehlschlag den In-Flight-Status zuverlässig zurücksetzt
 *
 * Der Zeitstempel wird bewusst beim START eines Versuchs gesetzt, nicht erst
 * bei Erfolg: ein hängender oder fehlschlagender Request soll das Intervall
 * trotzdem verbrauchen, statt beliebig viele Wiederholversuche in kurzer
 * Folge zuzulassen, solange kein Erfolg eintritt.
 *
 * `reloadFn` bleibt vollständig in der Verantwortung des Aufrufers - er
 * entscheidet selbst über Dirty-State-Umgang, Fehleranzeige und ob nach
 * einem Unmount noch State gesetzt werden darf (siehe `page.tsx`, das den
 * dafür bereits etablierten `active`-Flag-Musterstil verwendet).
 */
export function useThrottledFocusReload(
  reloadFn: () => Promise<void>,
  options: UseThrottledFocusReloadOptions = {},
): void {
  const { minIntervalMs = 30_000, requireVisible = true } = options;
  const lastReloadAtRef = useRef(0);
  const inFlightRef = useRef(false);
  const reloadFnRef = useRef(reloadFn);

  useEffect(() => {
    reloadFnRef.current = reloadFn;
  }, [reloadFn]);

  const triggerReload = useCallback(() => {
    if (requireVisible && typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }
    if (inFlightRef.current) return;
    const now = Date.now();
    if (now - lastReloadAtRef.current < minIntervalMs) return;

    inFlightRef.current = true;
    lastReloadAtRef.current = now;
    reloadFnRef
      .current()
      .catch(() => {
        // Fehleranzeige obliegt reloadFn selbst - hier ausschließlich der
        // In-Flight-Reset, damit ein späterer Versuch wieder möglich ist.
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, [minIntervalMs, requireVisible]);

  useEffect(() => {
    window.addEventListener("focus", triggerReload);
    return () => {
      window.removeEventListener("focus", triggerReload);
    };
  }, [triggerReload]);
}
