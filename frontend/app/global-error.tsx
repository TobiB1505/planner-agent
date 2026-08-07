"use client";

import { useEffect } from "react";

/**
 * Letzte Auffangebene: greift nur, wenn bereits das Root-Layout
 * (Sidebar/Provider) fehlschlägt. Muss deshalb ein eigenes
 * <html>/<body> rendern und kommt ohne Layout-Komponenten und ohne die
 * globalen Stylesheets aus - bewusst mit Inline-Styles, damit die
 * Meldung auch ohne funktionierendes CSS-Fundament lesbar ist.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("Anwendungsfehler:", error);
  }, [error]);

  return (
    <html lang="de">
      <body
        style={{
          display: "grid",
          minHeight: "100vh",
          placeItems: "center",
          margin: 0,
          background: "#0c0d16",
          color: "#e8e9f4",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>
            Planner-Agent konnte nicht geladen werden
          </h1>
          <p style={{ color: "#9aa0b8", fontSize: 14, marginBottom: 20 }}>
            Ein unerwarteter Fehler ist aufgetreten. Deine gespeicherten Daten
            sind davon nicht betroffen.
          </p>
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              border: 0,
              borderRadius: 10,
              background: "#6c7bff",
              color: "#fff",
              padding: "10px 18px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Erneut versuchen
          </button>
        </div>
      </body>
    </html>
  );
}
