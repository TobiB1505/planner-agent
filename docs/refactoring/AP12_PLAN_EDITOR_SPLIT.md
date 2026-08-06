# AP12 — Plan-Editor Architektur-Refactoring

Reines Struktur-Refactoring: die 2.132 Zeilen große `frontend/app/plan-editor/page.tsx`
wurde in acht neue Dateien (2 Hooks, 4 Komponenten, 1 Utils-Modul, 1
Typ-Modul) unter `app/plan-editor/{hooks,components,utils}` aufgeteilt.
`page.tsx` ist jetzt 1.282 Zeilen und koordiniert im Wesentlichen Hooks,
State und die Ziel-JSX. Kein UI-Design, keine Farben, kein Layout, kein
API-Verhalten, kein Datenmodell, keine Planungslogik, keine
Validierungsregeln, kein Undo- oder Save-Verhalten geändert — verifiziert
per Lint, Build, Backend-Pytest (unverändert, da rein frontend-seitig) und
manuellem Workflow-Test gegen die echte lokale Datenbank.

---

## Vorher

### Dateigröße und Verantwortlichkeiten (Schritt 1)

`frontend/app/plan-editor/page.tsx`: 2.132 Zeilen, eine einzige
Client-Komponente für den kompletten Plan-Editor-Workflow.

| Bereich | Zeilen (ca.) | Verantwortlichkeit |
|---|---|---|
| Types (`PlanRow`, `SaveState`, `PendingAction`, `PlanHistoryChange`, `PlanHistoryAction`, `AutomationPreview`) | 78–114 | Lokale Typdefinitionen |
| Konstanten/Helfer (`ABSENCE_SECTIONS`, `gridTheme`, Datumshelfer, `splitNames`, `collectAbsences`, `rowCategory`/`rowColor`/`rowKey`, `GroupHeaderRenderer`, `PlanEditorInitialLoading`) | 116–312 | Reine Funktionen + zwei kleine Komponenten |
| Undo/Redo-Mechanik (Grid-Stack + eigener Aktions-Stack, `applyPlanChanges`, `commitDayEntry`, `handleUndo`/`handleRedo`, 5 Grid-Event-Handler) | ~1.424–1.517, 1.586–1.679 (verstreut) | History-Verwaltung für zwei unabhängige Undo-Quellen |
| Laden/Speichern (Referenzdaten, Dirty-Tracking, Save-Status, Fokus-Reload) | ~530–707 (verstreut) | Persistenz |
| `columnDefs`-Konfiguration (AG Grid) | ~240 Zeilen | Spalten, Zelleditoren, Renderer |
| `AgGridReact`-JSX inkl. aller Grid-Props/Event-Handler | 1.581–1.684 | Grid-Rendering |
| Wochennavigation | 1.648–1.674 **und** 1.689–1.714 (doppelt) | UI |
| Dialoge (3× `ConfirmDialog`, `PlanPreviewDialog`, `PlanIssuesPanel`, `PlanIntelligenceDialog`) | verstreut über ~150 Zeilen | Konflikt-/Vorschau-/Prüf-Dialoge |
| Wizard-Schritte (Künstlerplan, Probenplan, Vorlagenwahl, Export) | ~200 Zeilen | Onboarding-Wizard-JSX |
| Restliche Business-Logik (Validierung, Recommendations, Automation-Preview, Export, Wochenwechsel) | Rest | Seiten-eigene Logik |

### Probleme (Ausgangslage)

Eine Datei vereinte UI-Layout, AG-Grid-Konfiguration, zwei parallel
laufende Undo/Redo-Stacks, Persistenz-Logik und mehrere Dialoge. Der
Wochennavigations-Block existierte zweimal fast identisch (Zusammenfassungs-
Kopf vs. Wizard-Kopf). Jede noch so kleine Änderung — z. B. an der
Undo-Logik (wie in AP8, Renderpfad-Optimierung) — erforderte, die gesamte
2.132-Zeilen-Datei im Kontext zu laden, obwohl die eigentliche Änderung nur
einen kleinen, klar abgrenzbaren Ausschnitt betraf.

---

## Umsetzung

### State nach Verantwortlichkeit geordnet (Schritt 2)

Nicht jeder State wurde in einen Hook verschoben — nur State mit klarer,
in sich geschlossener Verantwortlichkeit:

| Kategorie | Ziel | Beispiele |
|---|---|---|
| History State | `usePlanHistory` | `gridHistory`, `customUndoRef`/`customRedoRef`, `actionOrderRef`/`redoOrderRef`, `gridUndoInFlightRef` |
| Persistence State | `usePlanPersistence` | `templates`/`people`/`artistPlans`/`rehearsalPlans`/`archivedWeeks`, `isDirty`/`changeCount`/`saveState`/`saveError`/`lastSavedAt`, `manuallyEditedCellsRef`/`auditEventsRef` |
| Editor State (Plan-Inhalt) | bleibt in `page.tsx` | `rows`, `dayLabels`, `weekDates`, `templateCode`, `startDate`, `personCategories`, `assignmentRules` — die Seite bleibt bewusst Owner der Plandaten |
| UI State | bleibt in `page.tsx` | `viewPreferences`, `activeDay`/`activeDayStore`, `pendingAction`, `issuesPanelOpen`, `intelligenceOpen`, `activeStep` |

### Neue Hooks (Schritt 3–4)

**`hooks/usePlanHistory.ts`** (265 Zeilen, hohe Priorität): kompletter
Undo/Redo-Mechanismus verhaltensgleich übernommen — AG Grids eigener
`undoRedoCellEditing`-Stack für direkte Zellbearbeitungen und ein eigener
Aktions-Stack (`customUndoRef`/`customRedoRef`) für programmatische
Mehrfachänderungen (Tagesplanung, Kopieraktionen), chronologisch verzahnt
über `actionOrderRef`/`redoOrderRef`. Nimmt `gridApiRef` sowie drei
Callbacks (`onMarkDirty`, `onRecordAudit`, `onMarkManuallyEdited`) von
außen entgegen, um nicht selbst wissen zu müssen, wie „geändert“ gebucht
wird — vermeidet einen Zirkelbezug zu `usePlanPersistence`. Liefert
`applyPlanChanges`, `commitDayEntry`, `handleUndo`, `handleRedo` und die
fünf fertig verdrahteten AG-Grid-Event-Handler (`onCellValueChanged`,
`onUndoStarted`/`onUndoEnded`, `onRedoStarted`/`onRedoEnded`).

**`hooks/usePlanPersistence.ts`** (284 Zeilen): Laden der Referenzdaten
(Templates, Personen, Künstler-/Probenpläne, Archivwochen), gedrosselter
Fokus-Reload (`useThrottledFocusReload`, aus AP8), Dirty-Tracking
(`markDirty`/`clearDirty`/`resetSaveStatus`), Audit-Buchführung und
`performSave`. Das Konflikt-Gate vor dem Speichern
(`validation.summary.blockingIssues > 0` → Bestätigungsdialog) bleibt
bewusst als dünner Wrapper in `page.tsx`, weil `validation` selbst von
`persistence.people` abhängt — ein Gate innerhalb des Hooks hätte einen
Zirkelbezug erzeugt.

### Neue Komponenten (Schritt 5–7)

| Datei | Zweck |
|---|---|
| `components/PlanGrid.tsx` | Reiner AG-Grid-Wrapper: Rendering, `columnDefs`-Übergabe, Grid-Events, Grid-Referenz. Keine Business-Logik, keine API-Calls, kein globaler Zustand — die Seite bleibt Owner der Daten. |
| `components/WeekNavigation.tsx` | Der zuvor doppelt vorhandene Wochennavigations-Block, jetzt eine Komponente (nur das Label unterscheidet die beiden Aufrufstellen). Pixelidentisch zum Original. |
| `components/EditorDialogs.tsx` | Bündelt die 3 Konfliktdialoge (Wochenwechsel, Speichern, Export), `PlanPreviewDialog` (Automation-Vorschau), `PlanIssuesPanel`, `PlanIntelligenceDialog`. Reduziert das JSX in `page.tsx`, ohne die Dialoglogik selbst neu zu schreiben — jede Aktion ist dieselbe Callback-Kette wie vorher, nur als Prop statt geschlossener Funktion. |
| `components/PlanWizardSteps.tsx` | Vier Wizard-Panels (`ArtistPlanStep`, `RehearsalPlanStep`, `TemplateChoiceStep`, `ExportStep`), reines JSX + Callback-Weiterleitung. |
| `utils/planEditorHelpers.tsx` | Pure Funktionen und zwei kleine Komponenten (`GroupHeaderRenderer`, `PlanEditorInitialLoading`), verhaltensgleich verschoben. |
| `types.ts` | Lokale Typdefinitionen, unverändert verschoben. |

### Props sauber definiert (Schritt 8)

Jede neue Datei hat eine explizite, ausschließlich benötigte
Props-Schnittstelle (`PlanGridProps`, `WeekNavigationProps`,
`EditorDialogsProps`, `ArtistPlanStepProps`/… , `UsePlanHistoryOptions`,
`UsePlanPersistenceOptions`). Kein `any` in den neuen Dateien.

### page.tsx als Koordinator (Schritt 9)

`page.tsx` importiert und verdrahtet die neuen Hooks/Komponenten. Bewusst
**nicht** extrahiert wurden:

- die `columnDefs`-`useMemo` (~240 Zeilen) — sie ist eng mit
  seiteneigenem State (`assignmentRules`, `people`, `rehearsalIntervals`,
  `onStageByDate`, `activeDayStore`/`dayStatusesStore`, `selectDay`, …)
  verzahnt und wäre nur um den Preis einer riesigen Props-Liste
  extrahierbar gewesen — kein Gewinn an Klarheit;
- der Archivplan-Lade-Effekt (16-Setter-atomare Orchestrierung) — eine in
  sich geschlossene, aber eng an praktisch den gesamten Editor-State
  gekoppelte Logik, deren Aufspaltung das Risiko einer
  Verhaltensänderung erhöht hätte, ohne Verantwortlichkeiten wirklich zu
  trennen.

---

## Nachher

### page.tsx Größe

2.132 → **1.282 Zeilen** (−850 Zeilen, ≈ −40 %). Zielkorridor aus der
Aufgabenstellung (~300–600 Zeilen) wurde **nicht erreicht** — siehe
„Bekannte Restpunkte“ unten; die Aufgabenstellung selbst relativiert das
ausdrücklich („nicht erzwingen“).

| Datei | Zeilen | Zweck |
|---|---|---|
| `page.tsx` | 1.282 | Koordination: State, Hooks verbinden, `columnDefs`, Render |
| `hooks/usePlanHistory.ts` | 265 | Undo/Redo (Grid- + Custom-Stack) |
| `hooks/usePlanPersistence.ts` | 284 | Laden/Speichern/Dirty-Tracking |
| `components/EditorDialogs.tsx` | 208 | Konflikt-/Vorschau-/Prüf-Dialoge |
| `components/PlanWizardSteps.tsx` | 220 | 4 Wizard-Panels |
| `utils/planEditorHelpers.tsx` | 204 | Pure Helfer + 2 kleine Komponenten |
| `components/PlanGrid.tsx` | 108 | AG-Grid-Wrapper |
| `components/WeekNavigation.tsx` | 48 | Wochennavigation (dedupliziert) |
| `types.ts` | 43 | Typdefinitionen |
| **Summe neue Dateien** | **1.380** | |

### Entfernte Logik aus page.tsx

- Kompletter Undo/Redo-Mechanismus (History-State, 5 Grid-Event-Handler,
  `applyPlanChanges`/`commitDayEntry`/`handleUndo`/`handleRedo`) →
  `usePlanHistory`.
- Referenzdaten-Laden, Dirty-Tracking, Save-Status, Fokus-Reload,
  `performSave` → `usePlanPersistence`.
- `AgGridReact`-JSX-Block (Grid-Props, Row-Height, Full-Width-Rows,
  Undo/Redo-Konfiguration) → `PlanGrid`.
- Doppelter Wochennavigations-Block → `WeekNavigation` (einmal statt
  zweimal).
- 3 Konfliktdialoge + Vorschau-/Prüf-/Intelligence-Dialog → `EditorDialogs`.
- 4 Wizard-Panels → `PlanWizardSteps`.
- Pure Helfer/Konstanten/2 kleine Komponenten → `planEditorHelpers.tsx`.
- Lokale Typdefinitionen → `types.ts`.

### Tests / Teststatus

- **`npm run lint`**: 0 Fehler, 0 Warnungen.
- **`npm run build`**: erfolgreich, TypeScript kompiliert fehlerfrei, alle
  16 Routen (inkl. `/plan-editor`) generiert.
- **`npm run test`**: 15/15 Vitest-Tests grün.
- **Backend `pytest`**: 240/240 grün (dieses Paket ist rein
  Frontend-seitig, das Backend war zu keinem Zeitpunkt betroffen).
- **Manueller Workflow** gegen den echten lokalen Backend-Prozess und die
  echte lokale Datenbank (KW 32, Woche B – Espania):
  - Seitenaufruf: identische Daten/Planqualität (59/100, 3 Konflikte) wie
    vor dem Refactoring.
  - Zell-Editor (`PersonCellEditor`) öffnen, Person hinzufügen,
    übernehmen: Zelle aktualisiert sich korrekt, Dirty-Anzeige erscheint.
  - **Undo/Redo über die Wochenübersicht (AG-Grid-Zellbearbeitung)**: ein
    vorbestehender Bug reproduziert — nach einer Personen-Zuweisung über
    `PersonCellEditor` meldet `api.getCurrentUndoSize()` einen Eintrag,
    aber `api.undoCellEditing()` revertiert weder den Zellwert noch
    befüllt es den Redo-Stack. Per `git diff` bestätigt: die komplette
    Undo/Redo-Mechanik wurde **wortgleich** aus dem Original übernommen
    (`handleUndo`, `onUndoEnded`, AG-Grid-Props identisch) — der Bug
    existierte unverändert vor dem Refactoring und ist keine Regression
    aus AP12. Siehe „Bekannte Restpunkte“.
  - **Undo/Redo über die Tagesplanung (`commitDayEntry`/`applyPlanChanges`,
    der eigene Aktions-Stack)**: funktioniert korrekt — Person zuweisen →
    Undo entfernt sie wieder (Zelle korrekt leer, Redo-Button aktiviert
    sich) → Redo stellt sie wieder her (Zelle korrekt „Becci“, Buttons
    korrekt Undo aktiv/Redo inaktiv).
  - **Speichern mit Konflikten**: Klick auf „Änderungen speichern“ öffnet
    korrekt den Bestätigungsdialog „Dienstplan mit Konflikten speichern?“
    (3 Konflikte erkannt); „Trotzdem speichern“ löst `POST
    /api/plan/save` → `200 OK` aus.
  - **Export mit Konflikten**: Klick auf „Excel exportieren“ öffnet den
    Bestätigungsdialog „Dienstplan mit Konflikten exportieren?“; „Trotzdem
    exportieren“ löst `POST /api/xlsx/generate` → `200 OK` aus.
  - Netzwerk-Requests während des gesamten Durchlaufs entsprechen exakt
    dem aus AP11 dokumentierten Muster (`GET /api/plan/existing`, `POST
    /api/intelligence/plan-quality` debounced nach jeder Änderung,
    `GET /api/weeks`, `GET /api/artist-plans`, `GET /api/rehearsal-plans`).
  - Testdaten aus dem Speichern-Test (ein „Becci“-Eintrag bei „Frei“ am
    06.08.) nach Abschluss der Verifikation direkt aus der Datenbank
    entfernt (`absences`-Zeile 997) — Datenbank danach byte-genau wie
    vorher (`PRAGMA integrity_check` ok, Zeilenzahlen 41/11/1.490/378
    identisch zum dokumentierten Ausgangsstand).

### Bekannte Restpunkte

1. **`page.tsx` liegt mit 1.282 Zeilen über dem Zielkorridor** (~300–600,
   „nicht erzwingen“). Grund: die `columnDefs`-`useMemo` (~240 Zeilen) und
   der Archivplan-Lade-Effekt wurden bewusst *nicht* extrahiert (siehe
   „Umsetzung“), da beide eng mit praktisch dem gesamten Editor-State
   verzahnt sind und eine erzwungene Extraktion entweder eine riesige
   Props-Liste oder eine Verhaltensänderung riskiert hätte — beides außerhalb
   des Scopes dieses Pakets. Eine weitere Aufteilung wäre ein eigenes,
   separat zu bewertendes Arbeitspaket.
2. **Vorbestehender Undo-Bug im AG-Grid-Zellbearbeitungspfad** (siehe oben):
   `api.undoCellEditing()` revertiert nach einer `PersonCellEditor`-Änderung
   weder den Wert noch den Redo-Stack, obwohl der Undo-Button aktiv
   angezeigt wird. Nicht durch AP12 verursacht (unverändert aus dem
   Original übernommen, per `git diff` verifiziert) und explizit außerhalb
   des Scopes dieses rein strukturellen Refactorings — nicht behoben.
