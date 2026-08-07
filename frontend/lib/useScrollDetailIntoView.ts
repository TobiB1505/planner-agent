"use client";

import { useEffect, useRef } from "react";

/**
 * Mobile Liste-und-Detail-Seiten (Gedächtnis, Archiv): Auf schmalen
 * Viewports rendert das Detail unterhalb der Liste - nach einer expliziten
 * Auswahl ohne Scroll wirkt der Tipp wie "nichts passiert" (Sprint-5-
 * Responsive-Befund). Der Hook scrollt das Detail nach einer Auswahl in
 * Sicht; nur wenn `markUserSelection()` vorher aufgerufen wurde, damit die
 * automatische Erstauswahl beim Laden die Seite nicht bewegt.
 */
export function useScrollDetailIntoView(
  selectionKey: unknown,
  selector: string,
  maxWidth = 760,
) {
  const pending = useRef(false);

  useEffect(() => {
    if (!pending.current || selectionKey === null) return;
    pending.current = false;
    if (!window.matchMedia(`(max-width: ${maxWidth}px)`).matches) return;
    const target = document.querySelector(selector);
    if (!target) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, [selectionKey, selector, maxWidth]);

  return () => {
    pending.current = true;
  };
}
