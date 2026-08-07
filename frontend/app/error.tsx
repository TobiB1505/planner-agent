"use client";

import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { useEffect } from "react";

/**
 * Route-Error-Boundary für alle Kernseiten: Ein Renderfehler einer Seite
 * darf nicht die gesamte App unbrauchbar machen. Sidebar und Layout
 * bleiben stehen; die Seite bietet Neuversuch und Rückweg an. Technische
 * Details landen in der Konsole, nicht in der Oberfläche.
 */
export default function RouteError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  /** Next 16: bevorzugter Wiederherstellungspfad - lädt Daten neu statt nur den Fehlerzustand zu leeren. */
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("Seitenfehler:", error);
  }, [error]);

  return (
    <div className="route-error-shell">
      <EmptyState
        variant="error"
        title="Diese Seite konnte nicht angezeigt werden"
        description="Ein unerwarteter Fehler ist aufgetreten. Deine gespeicherten Daten sind davon nicht betroffen."
        primaryAction={<Button onClick={() => unstable_retry()}>Erneut versuchen</Button>}
        secondaryAction={<Button variant="secondary" href="/dashboard">Zum Dashboard</Button>}
      />
    </div>
  );
}
