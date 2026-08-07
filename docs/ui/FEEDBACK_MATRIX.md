# Feedback-Matrix (Stand nach Sprint 4)

Verbindliche Zuordnung: welche Rückmeldung nutzt welchen Mechanismus.
Grundsatz aus `DESIGN_SYSTEM.md`: **Toast = flüchtiger Erfolg,
InlineStatus = an Ort und Stelle bleibende Information (Fehler, Laden,
Hinweis), ConfirmDialog = destruktive Entscheidung, EmptyState = leerer
oder gefilterter Zustand, Dirty-Chip/Zeilenstatus = Speicherzustand.**
Information wird nie nur über Farbe vermittelt (immer Text/Label).

## 1. Mechanismen

| Mechanismus | Wofür | Verhalten |
|---|---|---|
| `useToast` (success) | abgeschlossene Aktion, die keinen Platz auf der Seite braucht | verschwindet selbst, `role="status"` |
| `InlineStatus danger/warning` | Fehler/Warnung, die den Kontext betrifft und bestehen bleibt | `role="alert"`, bleibt bis behoben |
| `InlineStatus info` | erklärender Hinweis (z. B. „Automatik überschrieben") | höflich (`role="status"`) |
| `InlineStatus loading` | laufender Lade-/Hintergrundvorgang | animierter Punkt, kein pulsierendes Panel |
| `ConfirmDialog` | endgültiges Löschen, Backend-Neustart, Verwerfen ungespeicherter Änderungen | Fokus-Trap, Abbrechen als Default-Fokus |
| `EmptyState` (`empty`/`filtered`/`error`) | keine Daten / 0 Treffer bei Filtern / Ladefehler einer Liste | `filtered` immer mit Zurücksetzen-Aktion |
| Dirty-Chip / Zeilen-Save-Status | ungespeicherter Zustand (Editor, Künstler-/Probenplan, Team-Zeile) | textlich („Ungespeicherte Änderungen", „Speichert …") |
| Feld-Fehler (`Field`) | Validierung einzelner Formularfelder | am Feld, nicht als Banner |

## 2. Seiten × Situationen

| Seite | Erfolg | Fehler | Laden | Leer/Filter | Destruktiv | Speicherzustand |
|---|---|---|---|---|---|---|
| Dashboard | – (reine Anzeige) | InlineStatus danger | Skeleton (Erstladen), InlineStatus loading (Wochenwechsel) | EmptyState (Shows/Workload/Audit/keine Woche) | – | – |
| Team | Toast (angelegt, aktiviert/deaktiviert, gelöscht) | InlineStatus danger; Zeile „Fehler" | InlineStatus loading | EmptyState empty/filtered + „Filter zurücksetzen" | ConfirmDialog (Löschen) | Zeilenstatus „Speichert …/Gespeichert" |
| Gedächtnis | Toast pro Mutation (Show bestätigt/entfernt/ergänzt/zurückgeholt, Frei-Muster, Aufgaben) | InlineStatus danger | InlineStatus loading | EmptyState (Suche, Shows, Aufgaben) | – (Entfernen ist reversibel: „Zurückholen") | – |
| Künstlerplan | Toast (gelöscht); InlineStatus success (Import/Speichern/Export) | InlineStatus danger | ReadingProgress (Import), Button-Spinner | – (Quelle-Karten führen) | ConfirmDialog (Löschen), Guard bei Verlassen | Dirty-Chip im PlanReviewHeader |
| Probenplan | wie Künstlerplan | wie Künstlerplan | wie Künstlerplan | – | wie Künstlerplan | Dirty-Chip im PlanReviewHeader |
| Archiv | Toast (Woche gelöscht); InlineStatus success (Import) | InlineStatus danger | InlineStatus loading (Liste), Spinner (Detail) | EmptyState empty/filtered + „Filter zurücksetzen" | ConfirmDialog (Löschen) | – |
| Planungslogik | – | InlineStatus danger + „Erneut versuchen" | InlineStatus loading | – | – | – |
| System | Toast (Neustart erfolgreich) | InlineStatus danger | Banner „wird geprüft", Button-Loading | – | ConfirmDialog (Neustart) | „Zuletzt geprüft HH:MM:SS Uhr" |
| Dienstplan-Editor (Referenz, Sprint 2/3) | Toast/InlineStatus je nach Aktion | InlineStatus | Ladeskelett | Wizard | ConfirmDialog (Wochenwechsel bei dirty u. a.) | Status-Chip Gespeichert/Ungespeichert |

## 3. Regeln

1. **Erfolg niemals als bleibendes Banner** für Aktionen, deren Ergebnis
   ohnehin sichtbar ist (Liste aktualisiert sich) → Toast. Ausnahme:
   Import-/Speicher-Erfolge auf den Planseiten bleiben InlineStatus,
   weil sie den nächsten Schritt erklären („… wird automatisch
   übernommen").
2. **Fehler niemals als Toast** – sie müssen stehen bleiben, bis der
   Nutzer reagiert hat.
3. **Jede Mutation hat sichtbares Feedback.** Es gibt keine stillen
   Erfolge mehr (Gedächtnis-Altpunkt geschlossen).
4. **`window.confirm`/`alert`: 0 Verwendungen** projektweit (erneut
   verifiziert). Alle Bestätigungen laufen über `ConfirmDialog`.
5. **`.status`-Banner: 0 Verwendungen** projektweit; letzter Rest
   (EmployeeIntelligenceDialog) in Sprint 4 migriert.
6. Screenreader: Fehler unterbrechen (`assertive`), alles andere ist
   höflich (`polite`) – von InlineStatus/Toast zentral geregelt.
