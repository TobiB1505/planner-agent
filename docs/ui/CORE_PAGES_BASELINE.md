# Kernseiten – Migrations-Baseline (Sprint 4)

Erhoben am tatsächlichen Code und laufenden System (Playwright-Screenshots
1440px gegen echtes Backend mit Testdaten). Stand: nach Sprint 3.

## Vorab: Antworten auf die fünf Leitfragen

**1. Welche Seiten sind bereits teilweise migriert?**
- **System** und **Planungslogik**: Sprint-1-Piloten - nutzen bereits
  `ui/PageHeader`, `Button`, `InlineStatus`, `MetricCard`, `ConfirmDialog`,
  `useToast`. Restarbeit: Polling-Pause bei inaktivem Tab, Zeitpunkt der
  letzten Prüfung, Retry-Button (Planungslogik).
- **Team, Archiv, Künstlerplan, Probenplan**: Lösch-Bestätigungen bereits
  auf `ConfirmDialog` + Erfolgs-Toasts (Sprint 1). Rest der Seiten alt.
- **Dienstplan-Editor**: Sprint 3 - Referenz für die Produktsprache.
- **Gedächtnis**: strukturell überraschend gut (Liste+Detail, KPI-Karten,
  verständliche Badges "Datenbereit"/"Lernt", Tabs) - aber ohne
  Erfolgs-Feedback bei Mutationen und mit alter `.status`-Fehlerbox.

**2. Welche Seiten haben die größten UX-Probleme?**
Das **Dashboard** mit großem Abstand (Audit C8, live bestätigt): Woche
vierfach angezeigt, zwei Wochenpicker, Planqualität dreifach (KPI-Chip +
Donut-Panel in DashboardCommand + Ring-Karte in IntelligenceOverview),
Signale dreifach, Workload zweifach (cmd-wcards + Workload-Panel), Shows
zweifach, Audit-Feed zweifach, dazu Branding-Rauschen ("Studio Dashboard ·
Command Center") und Fairness-/Belastungs-Action-Items ohne Link.

**3. Welche Seiten besitzen besonders viele Legacy-Komponenten?**
Dashboard (`DashboardCommand` 433 Zeilen + `DashboardIntelligenceOverview`
180 Zeilen + `dashboard-command.css` 275 Zeilen - vollständig redundant
zur Seite selbst), Team (Ad-hoc-Buttons/Tabs/Karten), Archiv
(`archive-*`-Klassenfamilie), Künstler-/Probenplan (eigene Header-/
Toolbar-Muster).

**4. Welche Migrationen haben ein erhöhtes Funktionsrisiko?**
- Team: Auto-Save-pro-Zeile-Modell (funktioniert, hat Feedback pro Zeile) -
  Modellwechsel wäre riskant und unnötig → beibehalten, nur vereinheitlichen.
- Künstler-/Probenplan: AG-Grid bzw. Tabelle mit Import-Flows - Sprint-0-
  Guards hängen daran → nur Drumherum anfassen, keine Grid-/Zeilenlogik.
- Dashboard: reine Anzeige (keine Mutationen außer Wochenwahl) → Risiko
  niedrig trotz größtem Umbau.

**5. Reihenfolge:** Dashboard → Gedächtnis → Team → Archiv →
Künstler-/Probenplan (leichter Pass) → System/Planungslogik (Feinschliff).
Dashboard zuerst (größter Nutzen, geringstes Funktionsrisiko), dann die
Seiten mit echten Mutations-Feedback-Lücken.

---

## Seitensteckbriefe

### Dashboard (`app/dashboard/page.tsx`, 642 Zeilen + 613 Zeilen Legacy-Komponenten)

| Bereich | Inhalt |
|---|---|
| Primärer Zweck | Operative Wochenübersicht: Was ist der Stand, was braucht Aufmerksamkeit, was ist der nächste Schritt? |
| Hauptaktionen | Planung öffnen, Woche wechseln, Action-Item öffnen |
| Sekundäre Aktionen | Vorbereitung-Schritte öffnen (Künstler-/Probenplan/Editor) |
| Datenquellen | `getWeeks`, `getDashboardInsights(weekId)`, `getFairnessAlerts(weekId)` |
| Aktuelle Probleme | Massive Informationsduplikate (siehe Informationsmatrix in CORE_PAGES_SPEC.md); zwei Wochenpicker; KPI-Chips ohne Aktion; Fairness-/Belastungs-Items ohne Link; „Studio Dashboard/Command Center“-Jargon; Prozentwerte (Profil-Abdeckung) doppelt und unerklärt |
| Redundanzen | Woche 4×, Planqualität 3×, Signale 3×, Workload 2×, Shows 2×, Audit 2× |
| Legacy-Elemente | `DashboardCommand`, `DashboardIntelligenceOverview`, `dashboard-command.css`, `.status`-Fehlerbox, Ad-hoc-KPI-Karten |
| Migrationsrisiko | **Niedrig** (reine Anzeige) |
| Empfohlene Änderungen | Beide Legacy-Komponenten entfernen; eine Wochensteuerung im PageHeader-Bereich; MetricCards (max. 6, je einmal); Handlungsbedarf-Liste als einziges Aktionszentrum (alle Items verlinkt); Shows/Workload/Audit je einmal; `ui/PageHeader` + `MetricCard` + `InlineStatus` + `EmptyState` |

### Team (`app/team/page.tsx`, 657 Zeilen)

| Bereich | Inhalt |
|---|---|
| Primärer Zweck | Stammdaten + aktueller Status der Mitarbeiter |
| Hauptaktionen | Mitarbeiter hinzufügen, Name/Abteilung bearbeiten (Auto-Save), Status aktiv/inaktiv |
| Sekundäre Aktionen | Löschen (ConfirmDialog ✓), Intelligence-Profil öffnen, Suche/Filter |
| Datenquellen | `getTeam`, `getTeamIntelligenceOverview`, `createPerson`, `updatePerson`, `deletePerson` |
| Aktuelle Probleme | Alte PageHeader-Variante + Ad-hoc-Header-Button; Notice-Banner alt (`.status`); Empty State ad hoc; Tabs ohne Segmented-Muster |
| Redundanzen | Intelligence-Übersicht überschneidet sich mit Gedächtnis-Seite (bewusst: Team zeigt Status, Gedächtnis das Detail - Trennung dokumentieren statt entfernen) |
| Legacy-Elemente | `team-*`-Buttons/Tabs/Cards, `.status`-Banner |
| Migrationsrisiko | **Mittel** (Auto-Save-Zeilenmodell nicht anfassen) |
| Empfohlene Änderungen | `ui/PageHeader` mit primärer Aktion; `EmptyState` (gefiltert/leer); `InlineStatus` statt `.status`; Bearbeitungsmodell Auto-Save **beibehalten** (hat bereits Speichert…/Gespeichert/Fehler pro Zeile - erfüllt Phase 4.2) |

### Gedächtnis (`app/gedaechtnis/page.tsx`, 608 Zeilen)

| Bereich | Inhalt |
|---|---|
| Primärer Zweck | Nachvollziehen und Korrigieren, was die Planung über Mitarbeiter gelernt hat |
| Hauptaktionen | Mitarbeiter auswählen, Shows bestätigen/entfernen, Frei-Muster korrigieren |
| Sekundäre Aktionen | Pool-Wechsel aktiv/inaktiv, Intelligence-Profil öffnen |
| Datenquellen | `getMemory`, `getTeamIntelligenceOverview`, `setMemoryFree`, Show-Mutationen |
| Aktuelle Probleme | **Kein Erfolgs-Feedback nach Mutationen** (Audit-Altpunkt, bestätigt: `mutate()` zeigt nur Fehler); globale `.status`-Fehlerbox statt InlineStatus; „Aufmerksamkeit 8 / 0 neue Profile ohne Historie“-KPI verwirrend (Zahl und Text widersprechen sich); `busy` sperrt alle Aktionen gleichzeitig |
| Redundanzen | KPI-Karten teils deckungsgleich mit Team-Intelligence-Leiste (akzeptiert - unterschiedliche Seitenzwecke) |
| Legacy-Elemente | `memory-overview-card` (Ad-hoc-KPIs), `.status` |
| Migrationsrisiko | **Niedrig-mittel** |
| Empfohlene Änderungen | Erfolgs-Toast pro Mutation; `InlineStatus` für Fehler; Aufmerksamkeits-KPI-Text korrigieren; Sprachprüfung bestanden (bereits „Datenbereit/Lernt“, „abgeleitet/manuell“ statt Enums - nur `cold_start` intern) |

### Künstlerplan (`app/artist-plan/page.tsx`, 573 Zeilen)

| Bereich | Inhalt |
|---|---|
| Primärer Zweck | Wochenprogramm (Shows/DJs/Orte/Zeiten) importieren und pflegen |
| Hauptaktionen | Speichern/Aktivieren, Zellbearbeitung (AG Grid), Import |
| Sekundäre Aktionen | Export, Löschen (ConfirmDialog ✓), Wochenwechsel |
| Datenquellen | Artist-Plan-Endpunkte, Upload |
| Aktuelle Probleme | Save-Status nicht als sichtbarer Zustand (nur Button-Disabled); Header-Muster abweichend vom Editor; Meldungen als `.status`-Banner |
| Redundanzen | – |
| Legacy-Elemente | `.status`, PlanReviewHeader-eigene Buttons |
| Migrationsrisiko | **Mittel** (Grid/Import nicht anfassen) |
| Empfohlene Änderungen | Dirty-Status-Chip analog Editor; `InlineStatus` für Meldungen; Verben vereinheitlichen; Guard-Verhalten verifizieren (Sprint 0 ✓) |

### Probenplan (`app/rehearsal-plan/page.tsx`, 500 Zeilen)

Analog Künstlerplan (HTML-Tabelle statt Grid). Gleiche Empfehlungen;
zusätzlich Mobile-Prüfung der Tabelle (horizontales Scrollen akzeptiert,
dokumentieren).

### Archiv (`app/archiv/page.tsx`, 397 Zeilen + ArchiveImportFlow)

| Bereich | Inhalt |
|---|---|
| Primärer Zweck | Gespeicherte Wochen finden, prüfen, weiterverwenden, importieren |
| Hauptaktionen | Woche auswählen/prüfen, im Editor öffnen |
| Sekundäre Aktionen | Alt-Import, Löschen (ConfirmDialog ✓) |
| Datenquellen | `getWeeks`, `getWeekDetail`, `deleteWeek`, Import-Endpunkte |
| Aktuelle Probleme | **Stilles 120-Zuweisungen-Abschneiden im Detail** (C15, Zeile 334 bestätigt); kein „Im Editor öffnen“ direkt am Eintrag; Filter ohne sichtbaren Zurücksetzen-Zustand |
| Redundanzen | – |
| Legacy-Elemente | `archive-*`-Karten/Buttons, `.status` |
| Migrationsrisiko | **Niedrig** |
| Empfohlene Änderungen | „Mehr anzeigen“ statt stillem Slice; „Im Editor öffnen“-Aktion; `EmptyState` für leere Filter |

### Planungslogik (70 Zeilen) & System (417 Zeilen) - Sprint-1-Piloten

Restarbeiten: Planungslogik Retry-Button bei Ladefehler; System:
Polling-Pause bei inaktivem Tab, „zuletzt geprüft“-Zeitpunkt, Statusbegriffe
final prüfen. Beide Migrationsrisiko **niedrig**.

---

## Querschnitt

- `window.confirm`/`alert(`: **0 Treffer** projektweit (Sprint 1 erledigt,
  erneut verifiziert).
- Eigene Toast-Systeme: keine - nur der zentrale ToastProvider.
- Verbleibende `.status`-Banner: Dashboard, Gedächtnis, Team, Archiv,
  Künstler-/Probenplan (Migrationsziel InlineStatus).
- Responsive: alle Kernseiten sind einspaltig-fähig; kritisch sind nur
  Dashboard-KPI-Grids und die Plan-Tabellen (dokumentierte Scroll-Lösung).
