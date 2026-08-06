# Dienstplan-Editor – Technische Baseline (Sprint 2)

Stand vor den Sprint-2-Änderungen. Grundlage für die Refactoring-
Entscheidungen in diesem Sprint. Ersetzt nicht die Analyse des tatsächlichen
Codes zum Zeitpunkt einer späteren Änderung.

## 1. Bestandsaufnahme (Kurzfassung)

**1. Welche Teile sind bereits sauber getrennt?**

Deutlich mehr als der Auftrag vermuten ließ. Ein früherer Sprint ("AP12",
siehe Kommentare im Code) hat den Editor bereits von einer 2.132-Zeilen-
`page.tsx` auf die heutige Struktur aufgeteilt:

- `usePlanHistory` (Undo/Redo, 264 Zeilen) und `usePlanPersistence`
  (Laden/Speichern/Dirty-State, 284 Zeilen) sind bereits eigene Hooks mit
  klar getrennten Verantwortlichkeiten.
- `PlanGrid` (AG-Grid-Einbettung), `EditorDialogs` (alle Dialoge/Panels),
  `PlanWizardSteps` (Künstlerplan-/Probenplan-/Vorlagen-Schritte),
  `WeekNavigation` sind bereits eigene Komponenten.
- Wochen- und Tagesansicht (`PlanGrid`/`PlanDayView`) greifen **bereits auf
  denselben `rows`-Zustand** zu - keine zwei Entwurfskopien, keine manuelle
  Synchronisation. `commitDayEntry`/`applyPlanChanges` aus `usePlanHistory`
  sind der einzige Schreibpfad für beide Ansichten.
- Row-Identität ist bereits stabil und deterministisch (`assignRowIds`,
  Sprint 0).
- Tagesindikatoren (aktiver Tag, Tagesstatus) laufen bereits über externe
  Stores (`useGridDayIndicators`) statt über `columnDefs`-Neubau bei jedem
  Klick - eine bereits vorhandene, gezielte Optimierung gegen unnötige
  Full-Grid-Arbeit.
- View-Preferences (`usePlanViewPreferences`) sind bereits SSR-sicher über
  `useSyncExternalStore` gelöst (Sprint 0).

**2. Welche Datei/Komponente trägt zu viele Verantwortlichkeiten?**

- `app/plan-editor/page.tsx` (1.293 Zeilen vor Sprint 2) bleibt die
  zentrale Koordinationsstelle: State-Eigentümerschaft für `rows`/
  `dayLabels`/`weekDates`/Wizard-Schritte, `columnDefs`-Aufbau (219 Zeilen,
  inkl. Cell-Editor-Auswahl), Automatisierungs-Vorschau-Logik
  (`buildGeneratedPlan`/`applyAutomationPreview`), Speichern-/Export-Gates,
  Wochenwechsel. Das ist mehr als eine reine "Shell" (siehe Zielarchitektur-
  Vorlage des Auftrags), aber die Verantwortlichkeiten sind bereits über
  benannte Funktionen strukturiert, nicht wahllos vermischt.
- `columnDefs` (Zeilen 519-765 vor Sprint 2) ist der dichteste Block:
  Spaltenbasis, `cellEditorSelector` (inkl. Empfehlungslogik-Aufruf),
  `cellClassRules`, `tooltipValueGetter` in einer Funktion. Funktional
  bereits von Nebeneffekten frei (keine API-Aufrufe direkt in `columnDefs`
  selbst - die Empfehlungsberechnung ist synchron/lokal), aber lang.

**3. Welche Risiken bestehen bei einem Refactoring?**

- Die Undo/Redo-Chronologie (`actionOrderRef`/`redoOrderRef` in
  `usePlanHistory`) verzahnt AG Grids eigenen `undoRedoCellEditing`-Stack
  mit einem eigenen Aktions-Stack für Tagesansicht/Kopieraktionen. Das ist
  fehleranfällig (siehe Abschnitt 3) und jede Änderung daran muss beide
  Pfade gemeinsam testen.
- `columnDefs` wird über `useMemo` mit vielen Abhängigkeiten gebaut;
  versehentlich fehlende oder überflüssige Abhängigkeiten sind schwer zu
  erkennen (das ESLint-`exhaustive-deps`-Override an dieser Stelle ist
  bewusst und dokumentiert - siehe Kommentar im Code).
- AG Grid reagiert nachweislich empfindlich auf instabile Props (siehe
  Abschnitt 3) - jede Änderung an `PlanGrid`/`columnDefs` muss Undo/Redo
  live erneut prüfen, nicht nur `tsc`/Build.
- `rows`-Mutation: AG Grid mutiert `event.data` (dieselben Objekte wie in
  `rows`) direkt bei Zellbearbeitung, statt dass die App `setRows(...)`
  aufruft. Das ist bewusst so (siehe Kommentar in `onCellValueChanged`),
  macht den Datenfluss aber weniger offensichtlich als reiner Immutable-
  State - ein Refactoring, das versehentlich doch `setRows(...)` bei jeder
  Zellbearbeitung einführt, würde den AG-Grid-Undo-Stack invalidieren.

**4. Welche Teile dürfen in diesem Sprint nicht verändert werden?**

- Fachliche Planungsregeln (`lib/recommendations.ts`, `lib/planValidation.ts`,
  Backend-`assignment.py`) - nur gelesen, nicht verändert.
- Kategoriefarben (`lib/categoryColors.ts`, `app/styles/category-colors.css`).
- Exportlogik/-layout (`xlsxGenerate`, Backend-Template-Rendering).
- API-Verträge (`savePlan`/`generatePlan`/`getArchivedPlan`-Payloads) - in
  Sprint 2 nur um optionale, rückwärtskompatible `AbortSignal`-Parameter
  auf der Frontend-Client-Seite erweitert, keine Vertragsänderung.
- Das visuelle Erscheinungsbild des Grids (Zellfarben, `cursor: text`,
  Excel-Optik) - explizit Sprint-3-Scope ("Ent-Excelung").

**5. Welche Zielstruktur wird tatsächlich benötigt?**

Die im Auftrag skizzierte Zielstruktur (`PlanEditorShell`,
`usePlanData`/`usePlanEditing`/`usePlanValidation` als separate Hooks,
`lib/plan-editor/plan-grid.ts` usw.) wurde **nicht** eins-zu-eins
eingeführt. Begründung: Die bestehende Aufteilung (`usePlanHistory`/
`usePlanPersistence` + `page.tsx` als Koordinator) erfüllt dieselben
fachlichen Anforderungen bereits (siehe Abschnitt 1), und ein Zwang zur
Auftrags-Beispielstruktur hätte ohne konkreten Fehlerbefund eine
Parallelarchitektur zur bereits funktionierenden erzeugt - explizit
untersagt ("Erstelle keine neue Architektur parallel zu einer bereits
funktionierenden Architektur"). Stattdessen wurden **gezielte** neue
Dateien ergänzt, wo eine konkrete, nachgewiesene Lücke bestand:
`lib/ag-grid-setup.ts` (Modul-Dedupe), `lib/plan-editor/today.ts`
(Datums-Konsolidierung), erweiterte `AbortSignal`-Parameter in `lib/api.ts`.
Siehe `EDITOR_ARCHITECTURE.md` für die vollständige, tatsächlich
resultierende Struktur.

## 2. Dateistruktur (vor Sprint 2)

```
app/plan-editor/
  page.tsx                          1293 Zeilen - Koordination, columnDefs, Automatisierung
  types.ts                            51 Zeilen - PlanRow, PlanHistoryAction, PendingAction, AutomationPreview
  components/
    PlanGrid.tsx                     110 Zeilen - AG-Grid-Einbettung (Wochenübersicht)
    EditorDialogs.tsx                208 Zeilen - alle Dialoge/Panels gebündelt
    PlanWizardSteps.tsx              220 Zeilen - Künstlerplan-/Probenplan-/Vorlagen-Schritte
    WeekNavigation.tsx                48 Zeilen - Wochenpicker-Wrapper
  hooks/
    usePlanHistory.ts                264 Zeilen - Undo/Redo (Grid + eigener Aktions-Stack)
    usePlanPersistence.ts            284 Zeilen - Referenzdaten laden, Dirty-State, Speichern
  utils/
    planEditorHelpers.tsx            232 Zeilen - Datumsformatierung, assignRowIds, gridTheme, Ladeanzeige

components/plan-editor/
  PlanDayView.tsx                              - Tagesansicht-Container
  PlanDaySectionCard.tsx                       - ein Abschnitt in der Tagesansicht
  DayEntryEditor.tsx                           - Inline-Editor für eine Tageszelle
  DayNavigator.tsx                              - Tagesauswahl-Leiste (Tagesansicht)
  DayHeaderCell.tsx                            - Spaltenkopf (Wochenübersicht, liest Stores)
  CopyPanel.tsx                                - Vortag/anderer Tag/Bereich kopieren
  PlanIntelligenceDialog.tsx                    - Planqualität-Detailansicht
  PlanPreviewDialog.tsx                        - Diff-Vorschau vor Übernahme
  PlanViewSwitcher.tsx                          - Wochen-/Tagesansicht umschalten
  EditorViewControls.tsx                       - Dichte-Auswahl

components/ (projektweit, vom Editor genutzt)
  PersonCellEditor.tsx              635 Zeilen - Popup-Zelleditor für Personenzuweisung
  SoftsportCellEditor.tsx                      - Variante für Softsport-Sonderfall
  PlanEditorToolbar.tsx                        - Speichern/Undo/Redo/Export/Validierung/Tools
  PlanEditorSummary.tsx                        - Kopfbereich für bereits gespeicherte Pläne
  PlanIssuesPanel.tsx                          - Konfliktliste
  PlanValidationSummary.tsx                    - kompakte Konflikt-Zusammenfassung (Toolbar)

lib/
  api.ts                            940 Zeilen - typisierter Fetch-Client (projektweit)
  planValidation.ts                 639 Zeilen - globale Planprüfung (synchron, lokal)
  recommendations.ts                713 Zeilen - Personen-Empfehlungslogik (synchron, lokal)
  useUnsavedChangesGuard.ts                     - Sprint-0-Navigationsschutz (projektweit)
  plan-editor/
    dayCopy.ts, daySections.ts, dayStatus.ts, entryFieldType.ts,
    planDiff.ts, saveStatus.ts, viewPreferences.ts
    useGridDayIndicators.ts (+.test.tsx)
    useThrottledFocusReload.ts (+.test.tsx)
```

## 3. State-Quellen und Datenfluss

| Zustand | Eigentümer | Persistenz | Ableitung |
|---|---|---|---|
| `rows` (aktueller Entwurf) | `page.tsx` (`useState`), mutiert von AG Grid + `usePlanHistory` | Backend (nach Speichern) | aus generiertem/geladenem Plan |
| `dayLabels`/`weekDates` | `page.tsx` | Backend | aus generiertem/geladenem Plan |
| Dirty-State (`isDirty`/`changeCount`) | `usePlanPersistence` | lokal (Session) | aus `markDirty()`-Aufrufen bei fachlichen Änderungen |
| Undo/Redo-History | `usePlanHistory` (eigener Stack) + AG Grid (eingebauter Stack) | lokal (Session) | aus Transaktionen (Zellbearbeitung/Batch-Aktion) |
| Aktive Woche (`startDate`) | `page.tsx` | URL nicht genutzt, nur State | nein |
| Aktive Ansicht (`viewMode`) | `usePlanViewPreferences` (externer Store) | Local Storage | nein |
| Aktiver Tag (`activeDay`) | `page.tsx`, gespiegelt in `useGridDayIndicators`-Stores für AG Grid | lokal | nein (aber `effectiveActiveDay` leitet einen Fallback auf "heute" ab) |
| Validierung (`validation`) | `page.tsx` (`useMemo`, synchron) | keine | aus `rows`+Referenzdaten |
| Planqualität (`planQuality`, Server) | `page.tsx` | keine | aus `rows` (debounced Serveraufruf) |
| Referenzdaten (Templates/Personen/Künstlerplan/Probenplan/Archiv) | `usePlanPersistence` | Backend | nein |
| Manuell bearbeitete Zellen | `usePlanPersistence` (`manuallyEditedCellsRef`) | lokal (Session) | aus Bearbeitungen, für Konfliktmarkierung + Automatisierungs-Schutz |

**Bewertung gegen die Anforderungen aus dem Auftrag (Phase 3):** Bereits
erfüllt - kein Plan wird doppelt in React State und Grid-internem State
geführt (AG Grid mutiert dieselben Objekte), keine getrennten Wochen-/
Tageskopien, Dirty-State ist zentral in `usePlanPersistence`, Preferences
sind bereits getrennt (Local Storage, eigener Store) von den fachlichen
Plandaten.

## 4. Undo/Redo-Modell (vor Sprint 2)

Zwei Stacks, chronologisch verzahnt über `actionOrderRef`/`redoOrderRef`:

1. **AG Grids eingebauter Stack** (`undoRedoCellEditing`, Limit 30) - für
   direkte Zellbearbeitungen in der Wochenübersicht.
2. **Eigener Aktions-Stack** (`customUndoRef`/`customRedoRef`) - für
   Tagesansicht-Bearbeitungen (`commitDayEntry`) und Batch-Aktionen (Tag/
   Bereich kopieren, Tag leeren, Vortag übernehmen). Eine komplette
   Kopieraktion ist ein einziger Undo-Schritt.

`handleUndo`/`handleRedo` entscheiden anhand von `actionOrderRef`, welcher
der beiden Stacks die zuletzt passierte Aktion enthält, und rufen
entsprechend `api.undoCellEditing()` oder die eigene
`revertOrReplayCustomAction()` auf.

**Kritischer Befund dieser Session (behoben, siehe `EDITOR_ARCHITECTURE.md`
und `SPRINT_2_RESULT.md`):** `PlanGrid` übergab AG Grid bei praktisch jedem
Render der Elternkomponente (u.a. nach jeder Zellbearbeitung) neue
Funktionsreferenzen für `getRowHeight`/`onGridReady`/`onCellClicked` sowie
ein neues `defaultColDef`-Objekt. Live gegen das laufende Backend
reproduziert: AG Grids `undoRedoCellEditing`-Stack wurde dadurch
invalidiert, bevor ein Klick auf "Rückgängig" überhaupt etwas bewirken
konnte - der Button deaktivierte sich, der Zellwert blieb aber unverändert.
Fix in Commit `593e257`.

## 5. Dirty-State-Modell (vor Sprint 2)

`markDirty(count)`/`clearDirty()` in `usePlanPersistence`, aufgerufen von:
Zellbearbeitung (Grid + Tagesansicht), Automatisierung übernehmen, Plan neu
generieren. **Nicht** ausgelöst von: Ansichtswechsel (Tag/Woche-Umschalter),
Dichte-Änderung, Dialog öffnen/schließen - bereits korrekt getrennt von
reinen Anzeigepräferenzen. `clearDirty()` läuft nach erfolgreichem
Speichern und nach dem Laden eines Archivplans (neue Vergleichsbasis).

## 6. Row-ID-Modell (vor Sprint 2)

`assignRowIds()` (Sprint 0) - deterministisch, ordnungsabhängig,
Occurrence-Index-basiert (`${rowKey}::${n}`), bewahrt bereits vergebene
IDs. Bereits vollständig den Anforderungen aus Phase 5.2 entsprechend, in
Sprint 2 unverändert übernommen (nur erstmals mit gezielten Unit-Tests
abgesichert, siehe `planEditorHelpers.test.ts`).

## 7. Grid-Konfiguration (vor Sprint 2)

- `AllCommunityModule` unabhängig in `app/plan-editor/page.tsx` UND
  `app/artist-plan/page.tsx` registriert (Sprint-0-Audit-Finding C13,
  weiterhin offen).
- `getRowId` bereits stabil (`params.data._row_id`), aber als Inline-Arrow-
  Funktion definiert (neue Referenz pro Render).
- `defaultColDef`, `getRowHeight`, `onGridReady`, `onCellClicked`: alle als
  Inline-Werte/-Funktionen in `PlanGrid` definiert - neue Referenz bei
  jedem Render der Elternkomponente.
- `columnDefs`: über `useMemo` mit vollständigen, dokumentierten
  Abhängigkeiten - bereits korrekt stabil zwischen unabhängigen Renders.
- Tagesmarkierung (aktiver Tag, Konfliktstatus) läuft bereits über externe
  Stores + gezielte `refreshCells({columns:[...]})`/`refreshHeader()`
  statt `columnDefs`-Neubau (`useGridDayIndicators`).

## 8. Bekannte Performance-Hotspots (vor Sprint 2, aus Audit/Sprint 0 übernommen und live geprüft)

- `applyPlanChanges`/`revertOrReplayCustomAction` in `usePlanHistory`
  riefen `refreshCells({force: true})` **ohne** `rowNodes`/`columns` auf -
  ein vollständiges Grid-Refresh bei jeder Batch-Aktion (Tag kopieren/
  leeren) und deren Undo/Redo. Behoben in Sprint 2 (gezielt auf
  betroffene Zeilen/Spalten beschränkt).
- `getPlanQuality` (Server-Qualitätsprüfung) hatte ein 500ms-Debounce,
  aber keinen echten `AbortController` - nur einen manuellen
  `cancelled`-Flag. Der eigentliche HTTP-Request lief bei schnellen
  Folgeänderungen trotzdem bis zum Ende durch. Behoben in Sprint 2.
- `loadReferenceData` (5 parallele Requests, Mount + gedrosselter Fokus-
  Reload) hatte ebenfalls keinen `AbortController`. Behoben in Sprint 2.

## 9. Bekannte Render-Hotspots

- Jede Zellbearbeitung löst über `markDirty()` einen Re-Render der
  gesamten `PlanEditorPage` aus (React-Zustandsänderung), wodurch
  `PlanGrid`s Funktionskomponente erneut ausgeführt wird. Da `rows` und
  `columnDefs` bereits referenzstabil sind (siehe oben), betraf das primär
  die jetzt behobenen instabilen Callback-Props.
- `validation` (`useMemo`) läuft synchron bei jeder `rows`/`changeCount`-
  Änderung - bei den in dieser Session getesteten Plangrößen (~37-40
  Zeilen, 7 Tage) ohne spürbare Verzögerung (siehe
  `EDITOR_PERFORMANCE_REPORT.md`).

## 10. Bekannte Stabilitätsprobleme (in Sprint 2 gefunden)

1. **Undo/Redo in der Wochenübersicht war faktisch unbenutzbar** (siehe
   Abschnitt 4) - behoben.
2. **Kein funktionierendes Tastaturkürzel für Undo/Redo** - weder ein
   projekteigener globaler Listener noch AG Grids interne Behandlung
   waren zuverlässig mit dem vereinheitlichten `handleUndo`/`handleRedo`
   verbunden. Behoben (neuer, Capture-Phase-basierter globaler Listener).
3. Doppel-Speichern war nur über den `disabled`-Zustand des Buttons
   verhindert (State-Update nach dem Klick, kein synchroner Schutz) - in
   dieser Session kein tatsächlicher Doppel-Save reproduzierbar, aber
   Lücke geschlossen (Ref-Guard).

## 11. Bereits erledigte Auditpunkte (Sprint 0/1, zur Einordnung)

Siehe `docs/audit/FRONTEND_AUDIT_STATUS.md`. Für den Editor relevant:
C4 (Row-IDs, FIXED), C5 (Hydration-Mismatch View-Preferences, teilweise
FIXED). Weiterhin offen und **nicht** Sprint-2-Scope: C9/C10 (Excel-Optik,
Fehler/Warnung nur farblich - Sprint 3), C13 (AG-Grid-Doppelregistrierung -
in Sprint 2 behoben, siehe oben), C14 (Voll-Plan-Netzwerklast bei jeder
Änderung - teilweise durch AbortController/Debounce entschärft, nicht
strukturell verändert).

## 12. Abhängigkeiten zu Backend und Export

- `POST /api/plan/generate`, `GET /api/plan/existing`, `POST
  /api/plan/save`, `POST /api/intelligence/plan-quality`, `POST
  /api/intelligence/recommendations` - alle Verträge unverändert.
- Export (`POST /api/plan/xlsx`, `lib/api.ts xlsxGenerate`) unverändert,
  nicht angefasst.
- `backend/grid.py` (`META_COLS`, inkl. `_row_id` seit Sprint 0) -
  unverändert.
