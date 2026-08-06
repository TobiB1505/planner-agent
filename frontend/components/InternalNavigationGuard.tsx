"use client";

// Sprint 0 (S1-Fix, C1/C2): global (einmal in app/layout.tsx neben
// <Sidebar />) montierter Klick-Interceptor. Fängt Klicks auf interne
// <a>/<Link>-Elemente ab (Sidebar-Navigation, PageHeader-Verlinkungen,
// Dashboard-Aktionen, ...), solange irgendeine Seite über
// useUnsavedChangesGuard() ungespeicherte Änderungen gemeldet hat, und
// fragt über die bestehende ConfirmDialog-Komponente nach, bevor die
// Navigation tatsächlich stattfindet.
//
// Bewusst NICHT abgedeckt: der Browser-Zurück/Vor-Button (popstate). Zu dem
// Zeitpunkt, an dem ein popstate-Event feuert, hat der Browser die URL
// bereits gewechselt - ein echtes "Abbrechen" gibt es nicht, nur ein
// nachträgliches, mit history.pushState() erzwungenes Zurückspringen. Ein
// erster Testaufbau dafür (History-Trap-Pattern) interagierte unzuverlässig
// mit dem eigenen History-Handling von Next.js' App Router (doppelte
// Einträge, inkonsistentes Verhalten bei schnellem Vor/Zurück) - das hätte
// die Grundfunktion "Zurück-Button" auf JEDER Seite riskiert, nicht nur den
// Datenverlust-Fall. Diese Lücke bleibt deshalb bewusst offen und ist in
// FRONTEND_AUDIT_STATUS.md als PARTIALLY_FIXED mit Empfehlung für Sprint 1/2
// dokumentiert, statt sie mit einer ungetesteten Lösung zu verdecken.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  getActiveUnsavedChangesMessage,
  isAnyUnsavedChangesGuardActive,
} from "@/lib/useUnsavedChangesGuard";

function resolveInternalHref(anchor: HTMLAnchorElement): string | null {
  if (anchor.target && anchor.target !== "_self") return null;
  if (anchor.hasAttribute("download")) return null;
  if (anchor.origin !== window.location.origin) return null;
  const targetPath = anchor.pathname + anchor.search + anchor.hash;
  const currentPath = window.location.pathname + window.location.search + window.location.hash;
  if (targetPath === currentPath) return null;
  return anchor.pathname + anchor.search;
}

export default function InternalNavigationGuard() {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return; // nur Linksklick
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; // Öffnen in neuem Tab etc. respektieren

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!anchor) return;

      if (!isAnyUnsavedChangesGuardActive()) return;
      const href = resolveInternalHref(anchor);
      if (!href) return;

      event.preventDefault();
      setPendingHref(href);
    }

    // Capture-Phase: muss vor Next.js' eigenem Link-Click-Handler greifen.
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  return (
    <ConfirmDialog
      open={pendingHref !== null}
      title="Ungespeicherte Änderungen verwerfen?"
      description={getActiveUnsavedChangesMessage()}
      onDismiss={() => setPendingHref(null)}
      actions={[
        { label: "Abbrechen", onClick: () => setPendingHref(null) },
        {
          label: "Verwerfen und wechseln",
          variant: "danger",
          autoFocus: true,
          onClick: () => {
            const href = pendingHref;
            setPendingHref(null);
            if (href) router.push(href);
          },
        },
      ]}
    />
  );
}
