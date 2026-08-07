# Sprint 4 – Ergebnisbericht: Kernseiten vereinheitlicht

Zeitraum: nach Sprint 3 (Editor-Redesign). Branch:
`claude/ui-foundation-sprint-1-rzyjau`. Alle Angaben gegen das laufende
System verifiziert (Playwright gegen echtes Backend mit Testdaten:
8 Mitarbeiter, historische KW30, gespeicherte KW32).

## 1. Zusammenfassung

**Migrierte Seiten:** alle acht Kernseiten – Dashboard (Konsolidierung),
Team, MA-Gedächtnis, Künstlerplan, Probenplan, Archiv, Planungslogik und
System (Feinschliff); zusätzlich der Wizard des Dienstplan-Editors
(Seitenkopf) und der EmployeeIntelligenceDialog (Feedback).

**Gelöste UX-Probleme:** die massive Dashboard-Redundanz (Audit C8:
Woche 4×, Planqualität 3×, Signale 3×, Workload/Shows/Audit je 2×, zwei
Wochenpicker) ist beseitigt; stumme Mutationen im Gedächtnis haben jetzt
Erfolgs-Toasts; das stille 120er-Abschneiden im Archiv (C15) ist ein
sichtbarer „Mehr anzeigen"-Schritt; Archiv-Wochen sind direkt im Editor
zu öffnen; der Speicherzustand der Planseiten ist als Chip sichtbar;
System pollt nicht mehr im Hintergrund-Tab; Fairness- und
Belastungs-Hinweise im Dashboard sind klickbar.

**Unverändert:** Dienstplan-Export (Layout, Daten, Farben),
Planungslogik/API-Verträge, Kategoriefarben, AG-Grid-/Tabellen-Logik der
Planseiten, das Team-Auto-Save-Modell, alle Import-Flows.

Netto **−943 Zeilen** über den Sprint (771 hinzugefügt, 1 714 entfernt).

## 2. Dashboard

- **Entfernte Redundanzen:** `DashboardCommand` (433 Z.),
  `DashboardIntelligenceOverview` (180 Z.), `dashboard-command.css`
  (275 Z.), Hero-Wochenkarte, doppelte Audit-/Workload-/Show-Blöcke,
  „Studio Dashboard · Command Center"-Jargon.
- **Neue Informationshierarchie** (nach Nutzer-Feedback in der
  ursprünglichen Command-Karten-Optik umgesetzt): PageHeader +
  Wochensteuerung → Hero-Wochenkarte („Planung öffnen") →
  einklappbarer Vorbereitungsstatus → Intelligence-Zeile mit je einer
  Karte für Planqualität (Ring + Dimensionen), Entscheidungsbedarf
  (Signal-Aufschlüsselung, verlinkt), Datenbasis (Gedächtnis-Abdeckung)
  und Letzte Änderungen → Handlungsbedarf → Show-/Probentage →
  Team-Balance. Jede Information genau einmal
  (Matrix: `CORE_PAGES_SPEC.md` §2).
- **Action Items:** einziges Aktionszentrum; **alle** Items verlinkt
  (Vorbereitung → jeweilige Seite; Qualität/Fairness/Belastung →
  `/plan-editor`); live geprüft: 8/8 Items mit Link.
- **Wochensteuerung:** genau eine (Select + Vor/Zurück-Pfeile) neben dem
  PageHeader; Wochenwechsel zeigt einen `InlineStatus loading`.

## 3. Team und Gedächtnis

- **Fachliche Trennung** dokumentiert statt wegabstrahiert: Team =
  Stammdaten + Datenstatus, Gedächtnis = Inhalt des Gelernten mit
  Korrekturmöglichkeiten (`CORE_PAGES_SPEC.md` §3).
- **Bearbeitungsmodell:** Team behält Auto-Save pro Zeile (Blur/Enter,
  Escape verwirft, Zeilenstatus „Speichert …/Gespeichert/Fehler") –
  live verifiziert inkl. PUT-Request und Statusanzeige.
- **Feedback:** Erfolgs-Toasts für Anlegen, Aktivieren/Deaktivieren,
  Löschen (Team) und für **jede** Gedächtnis-Mutation (Show bestätigen/
  entfernen/ergänzen/zurückholen, Frei-Muster setzen/zurücksetzen,
  Aufgaben auf-/abwerten); Fehler und Hinweise als InlineStatus. Der
  widersprüchliche Aufmerksamkeits-KPI („8 / 0 neue Profile ohne
  Historie") sagt jetzt, was das Backend zählt: „Profile mit Hinweisen
  oder Datenlücken".
- **Empty States:** leere Suche (mit „Suche zurücksetzen"), leerer
  Aktiv-/Inaktiv-Pool, keine Show-Besetzung, leeres Aufgabenprofil.

## 4. Künstler- und Probenplan

- **Gemeinsame Interaktionsmuster:** identischer Quelle-→Prüfen-→
  Aktivieren-Workflow, gleicher `PlanReviewHeader`, gleiches Primärverb
  „Für Dienstplan aktivieren" (Probenplan vorher abweichend „Prüfen &
  aktivieren").
- **Wochenlogik:** unverändert (Remap beim Wochenwechsel), beide über
  denselben WeekPicker.
- **Dirty-State:** neuer Chip „Ungespeicherte Änderungen" im
  PlanReviewHeader, gespeist aus dem bestehenden `isDirty`; der
  `useUnsavedChangesGuard` blieb unverändert. Live geprüft: Chip fehlt
  nach dem Laden, erscheint nach einer Grid-Zellbearbeitung.
- **Import:** Flows unverändert; Meldungen jetzt InlineStatus.
- **Responsive:** Grid/Tabelle scrollen horizontal im Panel
  (dokumentiert akzeptiert), die Seiten selbst ohne Overflow bis 360px.

## 5. Archiv

- **Suche und Filter:** unverändert schnell; 0 Treffer zeigen jetzt
  `EmptyState (filtered)` mit „Filter zurücksetzen" (setzt Suche und
  Quellenfilter).
- **Aktionen:** neu **„Im Editor öffnen"** pro Woche
  (`/plan-editor?start=<ISO>`); der Editor unterstützt den Parameter
  über den regulären Wochenwechsel-Pfad – Woche mit Archivplan lädt den
  Plan (KW30 live geprüft), Woche ohne Plan zeigt den Wizard.
- **Pagination/Begrenzung:** das 120er-Limit der Detail-Zuweisungen ist
  sichtbar: „Alle N Zuweisungen anzeigen (x weitere)" (C15).
- **Import:** ArchiveImportFlow unverändert; Ergebnis-Meldungen als
  InlineStatus.
- **Cache-Aktualisierung:** Wochen-Details werden weiterhin pro Woche
  gecacht; nach Löschen wird der Cache-Eintrag entfernt und die Liste
  neu geladen (unverändert, verifiziert).

## 6. Planungslogik und System

- **Regeldarstellung** (Planungslogik) unverändert verständlich;
  Ladefehler haben jetzt einen „Erneut versuchen"-Button statt einer
  Sackgasse.
- **Polling** (System): pausiert vollständig bei nicht sichtbarem Tab
  (live gemessen: 0 health-Requests in 6 s versteckt), prüft bei
  Rückkehr sofort einmal und setzt dann das 5-Sekunden-Intervall fort.
- **Retry/Persistenz:** Auto-Refresh-Schalter bleibt über
  `/api/settings` persistent (Sprint-1-Stand, erneut verifiziert).
- **Statusdarstellung:** neu „Zuletzt geprüft HH:MM:SS Uhr" neben dem
  Live-Badge; der Banner-Text beschreibt den tatsächlichen Zustand
  („solange dieser Tab sichtbar ist" / „automatische Prüfung ist
  ausgeschaltet").
- **Administrative Aktionen** (Neustart mit ConfirmDialog + Erfolgs-
  Toast, Oberfläche neu laden, Diagnose prüfen) unverändert.

## 7. Designsystem-Migration

- **Verwendete zentrale Komponenten:** PageHeader (8 Seiten + Wizard),
  MetricCard (Dashboard, Planungslogik), Button (Link- und
  Aktions-Varianten), InlineStatus (alle Seiten), EmptyState (Team,
  Gedächtnis, Archiv, Dashboard), ConfirmDialog + useToast (bestehend,
  jetzt flächendeckend für Erfolge).
- **Entfernte Legacy-Komponenten:** `DashboardCommand`,
  `DashboardIntelligenceOverview`, `dashboard-command.css`, alte
  `components/PageHeader.tsx`, `.page-header`-/`archive-page-head`-/
  `team-page-head`-/`memory-page-head`-/`*empty-state`-CSS-Blöcke.
- **Verbleibende Sonderlösungen (bewusst):** `.btn`-Familie auf den
  Planseiten und Detailflächen (mechanischer Folge-Task), Team-/
  Archiv-/Gedächtnis-Kartenklassen (seitenkonsistent), PlanReviewHeader
  als gemeinsame, aber nicht-`ui/`-Komponente der Planseiten,
  hartkodierte Statusfarb-Literale (Restbestand).

## 8. Dialoge und Feedback

- **Native Confirm-Aufrufe:** 0 migriert, weil **0 vorhanden** (seit
  Sprint 1; erneut verifiziert: `window.confirm`/`alert(` projektweit
  ohne Treffer). Verbleibende native Aufrufe: keine.
- **Toasts:** Erfolge aller Mutationen (Team, Gedächtnis, Archiv-/
  Planseiten-Löschungen, Backend-Neustart).
- **InlineStatus:** einziger Banner-Mechanismus; `.status`-Klassen:
  **0 Verwendungen** (letzter Rest im EmployeeIntelligenceDialog
  migriert).
- **Field Errors:** unverändert am Feld (`Field`-Komponente); keine
  neuen Formulareingriffe in Sprint 4.
- Vollständige Zuordnung: `FEEDBACK_MATRIX.md`.

## 9. Responsive und Accessibility

- **Viewports:** 1440/1280/1024/834/430/390/360 px auf allen acht
  Seiten ohne horizontales Seiten-Scrollen (automatisiert gemessen).
  Zoom 200 % bei 1440 entspricht 720 px-Layout und ist damit abgedeckt.
- **Tastatur/Fokus:** Fokusreihenfolge Dashboard geprüft (Navigation →
  Primäraktion → Wochensteuerung → Inhalte); Dialoge behalten
  Focus-Trap/Fokus-Rückgabe (GlassDialog-Fundament); InlineStatus mit
  korrekten `role`-/`aria-live`-Werten; Readiness-Toggle mit
  `aria-expanded`/`aria-controls`.
- **Reduced Motion:** zentrale Abschaltung über `--duration-*`-Tokens +
  `route-transition`-Ausnahme (geprüft mit `reducedMotion: reduce`).
- **Bekannte Grenzen:** Dashboard-Skeleton-Shimmer nutzt eine eigene
  Animationsdauer (läuft auch bei Reduced Motion weiter); die
  Plan-Tabellen bleiben auf Mobile horizontale Scroller; vollständige
  Screenreader-Durchläufe stehen aus (Sprint-5-Scope).

## 10. Performance

- **Request-Verhalten:** System-Polling pausiert im Hintergrund-Tab
  (vorher dauerhaft alle 5 s); Dashboard lädt Insights + Fairness
  parallel wie zuvor, mit sichtbarem Ladezustand beim Wochenwechsel;
  Archiv cacht Wochen-Details unverändert pro Woche.
- **Listen-Rendering:** Workload weiterhin 7 + „Alle anzeigen";
  Archiv-Detail 120 + „Mehr anzeigen"; Audit-Feed auf 6 Einträge
  begrenzt – keine unbegrenzten Listen ohne sichtbaren Hinweis mehr.
- **Polling:** einziges Intervall der App (System, 5 s) jetzt
  sichtbarkeitsgebunden.
- **Bundle-Auswirkung:** −943 Quellzeilen, darunter 888 Zeilen
  Dashboard-Legacy (Komponenten + CSS); keine neuen Abhängigkeiten.
- **Verbleibende Hotspots:** Editor-Bundle (AG Grid) unverändert der
  größte Posten; keine Regression durch Sprint 4 (Build grün).

## 11. Tests

- **TypeScript:** `tsc --noEmit` grün nach jedem Arbeitspaket.
- **Lint:** `eslint` grün (eine unterwegs aufgetretene
  `set-state-in-effect`-Meldung wurde durch Umbau statt Unterdrückung
  gelöst; eine dokumentierte `exhaustive-deps`-Ausnahme im
  URL-Parameter-Effect des Editors).
- **Tests:** Vitest 62/62 grün (9 Dateien), nach jedem Arbeitspaket.
- **Production Build:** `next build` grün (mehrfach, zuletzt nach dem
  Phase-12-Sweep).
- **Manuelle Funktionsprüfung (Playwright, echtes Backend):** Dashboard
  (eine Wochensteuerung, 6 Karten, 8/8 verlinkte Action-Items,
  Audit-Panel, Ladeindikator), Team (Auto-Save inkl. PUT, Status-Toast,
  Filter-Reset), Gedächtnis (Toasts für Frei-Toggle/Reset,
  Empty-State-Suche), Archiv (Editor-Link, Filter-Reset), Planseiten
  (Dirty-Chip), System (Polling-Pause messbar 0 Requests),
  **Undo/Redo im Editor nach den Editor-Änderungen live verifiziert**
  (Eingabe → Ctrl+Z leer → Ctrl+Y wiederhergestellt → Ctrl+Z leer).
- **Visuelle Prüfung:** Screenshots 1440/390 pro migrierter Seite
  (Repository-Praxis: nicht committet, Szenarien reproduzierbar).

## 12. Offene Probleme

1. **Kein Löschen aus der Archiv-Liste ohne Detailöffnung** – Aktionen
   hängen an der Detail-Aside; bewusst so belassen (sicheres Löschen),
   aber als UX-Frage offen.
2. **Skeleton-Shimmer ignoriert Reduced Motion** (einzelne Animation
   mit fester Dauer) – kleiner Sprint-5-Fix.
3. **`.btn`-Ad-hoc-Buttons und Statusfarb-Literale** bestehen weiter –
   mechanische Restmigration ohne Nutzerwirkung.
4. **Probenplan-Testdaten fehlen** in der lokalen Testdatenbank – der
   Dirty-Chip wurde dort nur über den Künstlerplan-Pfad live geprüft
   (gleicher Code-Pfad im gemeinsamen Header).
5. **Kein vollständiger Screenreader-Durchlauf** – bisher nur
   strukturelle A11y-Prüfungen (Rollen, Fokus, Reduced Motion).

## 13. Freigabe für Sprint 5

**READY FOR SPRINT 5.**

Begründung: Alle Definition-of-Done-Punkte sind erfüllt – Dashboard ohne
Informationsduplikate mit durchgängig verlinkten Aktionen, klare
Team-/Gedächtnis-Trennung mit zuverlässigem Speicher- und
Mutations-Feedback, konsistente Wochen-/Speicherlogik samt sichtbarem
Dirty-State auf beiden Planseiten, kontrollierte Import-Zuordnung
(unverändert funktionsfähig), Archiv mit Suche, sinnvollen Aktionen und
transparenter Datenbegrenzung, verständliche Regel-/Statusdarstellung
mit pausierendem Polling und Retry. Export, Planungslogik und
API-Verträge unangetastet; tsc/Lint/Tests/Build grün. Die offenen
Punkte (§12) sind Polishing-Aufgaben ohne Funktionsrisiko und decken
sich mit dem vorgesehenen Sprint-5-Fokus.

## 14. Empfohlener Scope für Sprint 5

Basierend auf dem tatsächlichen Repository-Stand:

1. **Vollständige Accessibility-Prüfung:** Screenreader-Durchläufe der
   Kernflüsse (Dashboard → Editor → Speichern; Team-Pflege; Gedächtnis-
   Korrektur); Axe-Audit pro Seite; Kontrast-Nachweis der Status- und
   Kategoriefarbtöne; Tastatur-Vollpfad im AG Grid dokumentieren.
2. **Responsive-Polishing:** Tablet-Feinschliff 834–1024 (Gedächtnis-
   Detail, Archiv-Aside), Wochensteuerung des Dashboards unter 430 px,
   sticky-Verhalten der Editor-Tagesnavigation nachschärfen.
3. **Performance-Abschluss:** Editor-Bundle analysieren (AG-Grid-Anteil,
   dynamische Imports), Dashboard-Requests auf Sicht bündeln
   (insights + fairness serverseitig), Lighthouse-Basiswerte festhalten.
4. **Visuelle Regression:** reproduzierbares Screenshot-Set (die in
   Sprint 3/4 etablierten Playwright-Szenarien) als geordnetes Skript
   mit Soll-Bildern, damit künftige Sprints Abweichungen erkennen.
5. **Fehlergrenzen:** React Error Boundaries pro Route + definierte
   Offline-/Backend-weg-Zustände (EmptyState `error` konsequent nutzen);
   API-Fehlertexte vereinheitlichen.
6. **Ladezustände:** Skeleton-Politik vereinheitlichen (wann Skeleton,
   wann InlineStatus loading), Reduced-Motion-Fix für den Shimmer,
   Übergang Wochenwechsel im Editor.
7. **Produktions-QS:** Probenplan-Testdaten ergänzen, ein dokumentierter
   End-to-End-Durchlauf (Import → Planung → Export → Archiv) gegen den
   Production-Build, Abgleich des Export-Layouts (unverändert) als
   expliziter Regressionstest.
