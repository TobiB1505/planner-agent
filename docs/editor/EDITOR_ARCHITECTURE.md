# Dienstplan-Editor – Architektur (nach Sprint 2)

Beschreibt den Stand nach Sprint 2. Für den Stand davor siehe
`EDITOR_TECHNICAL_BASELINE.md`. Für die Sprint-2-Ergebnisse im Detail siehe
`SPRINT_2_RESULT.md`.

## 1. Zielarchitektur

Sprint 2 hat die bestehende, bereits größtenteils saubere Architektur
**beibehalten und gezielt gehärtet**, statt sie durch die im Auftrag
skizzierte Beispielstruktur zu ersetzen (siehe Baseline-Dokument, Frage 5,
für die Begründung). Neue Dateien entstanden nur dort, wo ein konkreter
Mangel nachgewiesen wurde:

```
app/plan-editor/
  page.tsx                    Koordination: State-Eigentümerschaft (rows/
                               dayLabels/weekDates/Wizard-Schritte),
                               columnDefs, Automatisierungs-Vorschau,
                               Speichern-/Export-Gates, Wochenwechsel,
                               globaler Undo/Redo-Tastaturkürzel-Listener (neu)
  types.ts                    PlanRow, PlanHistoryAction/-Change,
                               PendingAction, AutomationPreview
  components/
    PlanGrid.tsx               AG-Grid-Einbettung - Props jetzt stabil
                               (useCallback/modulweite Konstanten, neu)
    EditorDialogs.tsx          alle Dialoge/Panels
    PlanWizardSteps.tsx        Künstlerplan-/Probenplan-/Vorlagen-Schritte
    WeekNavigation.tsx         Wochenpicker-Wrapper
  hooks/
    usePlanHistory.ts          Undo/Redo - jetzt mit gezieltem
                               refreshAffectedCells() statt Full-Grid-Refresh (neu)
    usePlanPersistence.ts      Laden/Speichern/Dirty-State - jetzt mit
                               AbortController + Speichern-Ref-Schutz (neu)
  utils/
    planEditorHelpers.tsx      Datumsformatierung, assignRowIds, gridTheme
                               (todayIso() nach lib/plan-editor/today.ts ausgelagert)

components/plan-editor/        unverändert (PlanDayView, PlanDaySectionCard,
                               DayEntryEditor, DayNavigator, DayHeaderCell,
                               CopyPanel, PlanIntelligenceDialog,
                               PlanPreviewDialog, PlanViewSwitcher,
                               EditorViewControls) - DayNavigator nutzt jetzt
                               dieselbe todayIso()-Funktion wie page.tsx

lib/
  api.ts                       optionaler AbortSignal-Parameter für die vom
                               Editor genutzten Endpunkte (neu, additiv)
  ag-grid-setup.ts             einmalige Modulregistrierung, von
                               plan-editor UND artist-plan importiert (neu)
  plan-editor/
    today.ts                   einzige Quelle für "heutiges Datum als ISO" (neu)
    dayCopy.ts, daySections.ts, dayStatus.ts, entryFieldType.ts,
    planDiff.ts, saveStatus.ts, viewPreferences.ts,
    useGridDayIndicators.ts, useThrottledFocusReload.ts   unverändert
```

## 2. Datenfluss

```
                     ┌─────────────────────────┐
                     │  usePlanPersistence      │  Referenzdaten (Templates/
                     │  (Referenzdaten, Dirty,  │  Personen/Künstlerplan/
                     │   Speichern)             │  Probenplan/Archiv) - AbortController
                     └───────────┬──────────────┘  pro Ladevorgang
                                 │ isDirty, markDirty(), performSave()
                                 ▼
┌──────────────┐   rows (useState)   ┌─────────────────────┐
│  page.tsx     │◄───────────────────►│  usePlanHistory      │  Undo/Redo:
│  (Koordination)│  direkte Mutation   │  (Grid-Stack +       │  AG-Grid-Stack +
│               │  durch AG Grid via  │   eigener Stack)     │  eigener Stack,
│               │  onCellValueChanged │                      │  chronologisch
└──────┬────────┘                     └──────────┬───────────┘  verzahnt
       │ rows, columnDefs                        │ commitDayEntry(),
       │                                          │ applyPlanChanges(),
       ▼                                          │ gridEventHandlers
┌──────────────┐                                  │
│  PlanGrid     │  AG Grid (Wochenübersicht)       │
│  (stabile     │◄─────────────────────────────────┘
│   Props)      │  onCellValueChanged → usePlanHistory
└──────────────┘

┌──────────────┐
│  PlanDayView  │  rows (dieselbe Referenz wie PlanGrid)
│  (Tagesansicht)│  → commitDayEntry()/applyPlanChanges() → usePlanHistory
└──────────────┘
```

**Kernpunkt:** Es gibt genau **eine** fachliche Datenquelle (`rows` in
`page.tsx`) und genau **einen** Schreibpfad pro Aktionstyp
(`onCellValueChanged` für direkte Grid-Bearbeitung, `commitDayEntry`/
`applyPlanChanges` für alles andere) - beide münden in dieselbe Undo/Redo-
Buchführung. Wochen- und Tagesansicht sind zwei *Renderings* desselben
Zustands, keine zwei Zustände.

## 3. State-Eigentümer

Siehe `EDITOR_TECHNICAL_BASELINE.md` Abschnitt 3 - unverändert seit
Sprint 2, da bereits vor dem Sprint korrekt (ein Eigentümer pro Zustand,
keine unnötige Duplizierung).

## 4. Hook-Verantwortlichkeiten

| Hook | Verantwortlich für | Nicht verantwortlich für |
|---|---|---|
| `usePlanPersistence` | Referenzdaten laden (mit Abbruch), Dirty-/Save-State, Speichern (mit Re-Entrancy-Schutz) | Undo/Redo, Validierung, Grid-Rendering |
| `usePlanHistory` | Undo/Redo (beide Stacks), Grid-Event-Handler für Zellbearbeitung, gezielte Zell-Refreshs | Dirty-State selbst (bekommt `onMarkDirty` injiziert), Laden/Speichern |
| `useGridDayIndicators` | aktiver Tag/Tagesstatus als externe, AG-Grid-freundliche Stores | fachliche Tagesstatus-Berechnung (kommt von außen) |
| `usePlanViewPreferences` | Dichte/Ansicht, SSR-sicher, Local Storage | fachliche Plandaten |

Keine zyklischen Abhängigkeiten zwischen den Hooks: `usePlanHistory` kennt
`usePlanPersistence` nur über injizierte Callbacks (`onMarkDirty`,
`onRecordAudit`, `onMarkManuallyEdited`), nie umgekehrt.

## 5. Undo/Redo-Modell

Siehe Baseline Abschnitt 4 für das Grundmodell (unverändert). Sprint-2-
Änderungen:

- **Stabilitätsfix:** `PlanGrid` übergibt AG Grid jetzt referenzstabile
  Props (`useCallback` für `onGridReady`/`onCellClicked`/`getRowHeight`,
  modulweite Konstanten für `defaultColDef`/`getRowId`/`isFullWidthRow`).
  Ohne diesen Fix invalidierte praktisch jede Zellbearbeitung (die über
  `markDirty()` einen Re-Render auslöst) AG Grids eigenen Undo-Stack, noch
  bevor der Nutzer "Rückgängig" anklicken konnte.
- **Gezielte Refreshs:** `applyPlanChanges`/`revertOrReplayCustomAction`
  rufen jetzt `refreshCells({rowNodes, columns, force: true})` mit den
  tatsächlich betroffenen Zeilen/Spalten auf, statt eines ungezielten
  `refreshCells({force: true})` für das gesamte Grid.
- **Tastaturkürzel:** neuer globaler `keydown`-Listener (Capture-Phase) in
  `page.tsx` für Strg/Cmd+Z, Strg/Cmd+Umschalt+Z, Strg+Y - ruft dieselben
  `handleUndo`/`handleRedo` wie die Toolbar-Buttons auf. Greift nicht, wenn
  ein editierbares Element (Input/Textarea/Select/`contenteditable`)
  fokussiert ist, damit native Undo-Funktionen von Textfeldern
  (Zelleditor-Popups, Suchfelder) unangetastet bleiben.

**Transaktionsmodell (unverändert, bereits vor Sprint 2 korrekt):**

| Nutzeraktion | Undo-Schritte |
|---|---|
| Einzelne Zelle in Wochenübersicht ändern | 1 (AG-Grid-Stack) |
| Mehrere Zellen einfügen (Paste in AG Grid) | 1 (AG Grid gruppiert Paste-Operationen selbst) |
| Zelle in Tagesansicht ändern | 1 (eigener Stack) |
| Vortag/anderer Tag/Bereich kopieren | 1 (eigener Stack, ein `applyPlanChanges()`-Aufruf pro Kopieraktion) |
| Tag leeren | 1 (eigener Stack) |
| Wizard-Änderung (Plan neu erstellen/automatisch verteilen) | kein Undo - `resetHistory()` wird bewusst aufgerufen (ein komplett neuer Planvorschlag ist keine inkrementelle Änderung, die man "zurücknehmen" würde - stattdessen bleibt der vorherige Stand nur durch Nicht-Speichern erreichbar) |

## 6. Dirty-State-Modell

Unverändert seit Sprint 2 im Kern (bereits vor dem Sprint korrekt - siehe
Baseline Abschnitt 5). Ergänzt um einen synchronen Re-Entrancy-Schutz
(`savingRef`) in `performSave()`, zusätzlich zum bestehenden
`disabled={busy || !isDirty}` am Speichern-Button.

## 7. Request-Modell

Neu in Sprint 2: `lib/api.ts` erlaubt ein optionales `AbortSignal` für
`getPlanTemplates`/`getActivePeople`/`getArtistPlans`/`getRehearsalPlans`/
`getWeeks`/`getArchivedPlan`/`getPlanQuality`/`getIntelligentRecommendations`.
`request()` erkennt einen `AbortError` und reicht ihn unverändert durch
(statt ihn als "Backend nicht erreichbar" zu maskieren).

Verdrahtet an vier Stellen:

1. `usePlanPersistence.loadReferenceData` - ein neuer Aufruf (z.B. durch
   `useThrottledFocusReload`) bricht einen noch laufenden vorherigen
   Ladevorgang ab; Unmount bricht ebenfalls ab.
2. `page.tsx`, Planqualität-Effekt - Wochenwechsel oder eine neue
   Zellbearbeitung während eine Prüfung noch läuft, bricht die alte
   Anfrage ab.
3. `page.tsx`, Archivplan-Ladeeffekt - ein Wochenwechsel bricht das Laden
   der vorherigen Woche ab.
4. `PersonCellEditor` - Zelle schließen bricht die KI-Empfehlungsanfrage ab.

**Bewusst nicht auf alle `lib/api.ts`-Funktionen ausgeweitet** - die
übrigen ~30 Endpunkt-Funktionen werden nicht vom Editor in einer Weise
genutzt, die zu tatsächlichen Race-/Ressourcen-Problemen führt (einmalige
Aufrufe ohne schnelle Folgeaktionen), eine Ausweitung wäre reine
Vorratsarbeit ohne nachgewiesenen Nutzen.

**Deduplizierung (Phase 9.3):** Kein separater Cache/Deduplizierungs-
Mechanismus eingeführt. Der "Abbrechen-und-neu-starten"-Ansatz (Punkt 1-4
oben) erfüllt denselben Zweck für die tatsächlich betroffenen Fälle (ein
neuer Aufruf ersetzt den alten, statt dass beide parallel laufen und um
das letzte Ergebnis konkurrieren) - eine allgemeine Request-Cache-
Bibliothek wäre für diesen Zweck eine nicht gerechtfertigte zusätzliche
Abhängigkeit gewesen.

## 8. Validierungsmodell

Unverändert seit Sprint 2 (bereits vor dem Sprint korrekt strukturiert):

- **Lokale Validierung** (`validatePlanSafe`, `lib/planValidation.ts`):
  synchron, läuft in einem `useMemo` bei jeder `rows`/`changeCount`-
  Änderung. Keine Staleness-Problematik möglich, da synchron - das
  Ergebnis gehört per Definition immer zum aktuellen `rows`-Stand.
- **Serverseitige Qualitätsprüfung** (`getPlanQuality`): debounced
  (500ms), jetzt mit echtem `AbortController` (siehe Abschnitt 7). Ein
  Ergebnis wird nur übernommen, wenn die zugehörige Anfrage nicht
  inzwischen abgebrochen wurde.
- Fehler/Warnungen werden stabil über `row._row_id` (nicht Zeilentext)
  einer Zeile zugeordnet (`PlanCellReference.rowId`, siehe
  `lib/planValidation.ts`) - identisch mit der AG-Grid-`getRowId`-
  Identität, damit `navigateToIssue()` zuverlässig die richtige Zelle
  findet, auch bei inhaltlich identischen Zeilen.

## 9. Grid-Update-Strategie

| Ereignis | Strategie (nach Sprint 2) |
|---|---|
| Einzelne Zellbearbeitung (Grid) | `refreshCells({rowNodes:[node], columns:[field], force:true})` - unverändert, war bereits gezielt |
| Batch-Aktion (Tag/Bereich kopieren, Tag leeren) | `refreshCells({rowNodes, columns, force:true})` - **jetzt gezielt** (vorher: vollständiges Grid) |
| Undo/Redo einer Batch-Aktion | wie Batch-Aktion selbst - **jetzt gezielt** |
| Aktiver Tag wechselt | `refreshHeader()` + `refreshCells({columns:[alterTag,neuerTag], force:true})` - bereits vor Sprint 2 gezielt (`useGridDayIndicators`) |
| Neue Planprüfung (Konfliktmarkierung) | `refreshCells({force:true})` **ohne** `rowNodes`/`columns` - weiterhin ein vollständiges Refresh, siehe Abschnitt 12 ("bekannte Grenzen") |
| Dichte-Wechsel | `refreshCells({force:true})` + `resetRowHeights()` - **bewusst vollständig**, da sich die Zeilenhöhe aller Zeilen ändert |
| `clearDirty()` (nach Speichern) | `refreshCells({force:true})` **ohne** `rowNodes`/`columns` - betrifft die "manuell bearbeitet"-Markierung aller Zellen, siehe Abschnitt 12 |

## 10. Row-ID-Modell

Unverändert seit Sprint 0/2 (siehe Baseline Abschnitt 6) - in Sprint 2
erstmals mit Unit-Tests abgesichert (`planEditorHelpers.test.ts`):
Eindeutigkeit bei inhaltlich identischen Zeilen, Determinismus über
mehrere Aufrufe, Beibehaltung bereits vergebener IDs.

## 11. View-Synchronisierung (Wochen-/Tagesansicht)

Beide Ansichten sind **bereits vor Sprint 2** dauerhaft gemountet (nur per
CSS `display:none` visuell umgeschaltet), mit Absicht: Ein Unmount/Remount
des AG-Grid-Elements würde AG Grids internen `undoRedoCellEditing`-Stack
und die Scrollposition verlieren. Sprint 2 hat diese Entscheidung geprüft
und **bewusst nicht geändert** - siehe Abschnitt 13 für die Abwägung.

Datensynchronisierung: da beide Ansichten auf **derselben** `rows`-Referenz
arbeiten und über denselben Schreibpfad (`usePlanHistory`) mutieren, ist
eine Änderung in der einen Ansicht sofort in der anderen sichtbar - live
verifiziert (Wochenübersicht bearbeiten → Tagesansicht öffnen → Änderung
sichtbar; Tagesansicht-Batch-Aktion → Undo → vorherige Wochenübersicht-
Bearbeitung bleibt korrekt erhalten).

## 12. Bekannte Grenzen (bewusst nicht in Sprint 2 behoben)

- **Zwei verbleibende ungezielte `refreshCells({force:true})`-Aufrufe:**
  der Konfliktmarkierungs-Effekt (`cellIssueIndex`) in `page.tsx` und
  `clearDirty()` in `usePlanPersistence`. Beide betreffen potenziell *jede*
  Zelle (Konfliktmarkierung: jede Zelle kann ein Problem haben; Dirty:
  jede Zelle kann manuell bearbeitet worden sein) - eine gezielte
  Eingrenzung wäre möglich (z.B. nur Zeilen mit tatsächlichen
  Änderungen/Issues), hätte aber zusätzliche Buchführung erfordert
  (welche Zeilen haben sich seit der letzten Prüfung geändert), die den
  Rahmen einer "kleinen, überprüfbaren" Änderung gesprengt hätte. Empfohlen
  für Sprint 3, siehe `SPRINT_2_RESULT.md`.
- **Zeilen können nicht manuell hinzugefügt/gelöscht/umbenannt werden** -
  das ist keine Lücke, sondern der tatsächliche Funktionsumfang der
  Anwendung (Zeilen stammen ausschließlich aus Vorlage/Automatik). Die im
  Auftrag (Phase 4.4) genannten Testfälle "Zeile hinzufügen/löschen/
  umbenennen" sind daher nicht anwendbar.
- **AG-Grid-Doppelregistrierung war kein reines Editor-Problem** -
  `artist-plan/page.tsx` nutzt ebenfalls AG Grid; die Modul-Zusammenführung
  (`lib/ag-grid-setup.ts`) betrifft beide Seiten.

## 13. Technische Entscheidungen

### Mounting von Wochen- und Tagesansicht

**Entscheidung: beibehalten (beide dauerhaft gemountet, CSS-Umschaltung).**

Der Auftrag verlangt zu prüfen, ob AG Grid auf kleinen Viewports unnötig im
Hintergrund läuft, wenn nur die Tagesansicht sichtbar ist. Das ist korrekt
beobachtet - ein Kompromiss wurde aber bereits vor Sprint 2 bewusst
eingegangen (siehe Code-Kommentar: "AG Grid bleibt beim Moduswechsel
gemountet - ein Remount würde Undo/Redo-Historie und Scrollposition
verlieren"). Ein Unmount bei Ansichtswechsel auf mobilen Geräten würde:

- den AG-Grid-eigenen Undo-Stack löschen (der eigene Aktions-Stack bliebe
  zwar erhalten, aber die Chronologie zwischen beiden bräche),
- die Scrollposition der Wochenübersicht verlieren,
- bei jedem Wechsel zurück zur Wochenansicht eine sichtbare Re-
  Initialisierung des Grids verursachen.

Eine vollständige Migration des AG-Grid-eigenen Undo-Stacks in den eigenen
Aktions-Stack (was ein sicheres Unmounten ermöglichen würde) ist eine
grundlegende Architekturänderung des Undo/Redo-Modells, kein isoliertes
Mounting-Detail - passend für einen eigenen, dedizierten Sprint-3-Task mit
vollständiger Testabdeckung, nicht für eine Nebenbei-Änderung in Sprint 2.

### Grid Transactions

**Entscheidung: nicht eingeführt.** AG Grids Transaction-API
(`applyTransaction`) ist für Zeilen-Hinzufügen/-Entfernen/-Verschieben
gedacht. Da der Editor keine Zeilen-Operationen kennt (siehe Abschnitt 12)
und Zellwert-Änderungen bereits über direkte Objekt-Mutation + gezielte
`refreshCells()` laufen, gäbe es für Transactions in diesem Editor keinen
Anwendungsfall.

### Request-Deduplizierung

Siehe Abschnitt 7 - "Abbrechen-und-neu-starten" statt einer
Cache-/Dedup-Bibliothek.

### Dynamische Imports

**Entscheidung: nicht eingeführt (Sprint 2 bewusst zurückgestellt).**
AG Grid, die Dialoge und der Wizard werden weiterhin statisch importiert.
Eine Umstellung auf `next/dynamic` wurde nicht vorgenommen, weil: (a) AG
Grid ist der Kern-Interaktionsbereich der Seite - ein verzögertes Laden
würde die Kernbearbeitung selbst verzögern (explizit gegen Phase 13.2:
"keine unnötige Verzögerung der Kernbearbeitung"), (b) die selten
genutzten Dialoge (`PlanIntelligenceDialog`, `PlanPreviewDialog`) sind
bereits klein genug, dass ihr Bundle-Anteil laut Build-Output nicht
separat ausgewiesen wird (siehe `EDITOR_PERFORMANCE_REPORT.md`). Empfohlen
für Sprint 5 (Performance-Scope laut Sprint-1-Roadmap), zusammen mit der
dort bereits geplanten Server-Component-Prüfung.

### AG-Grid-Module

**Entscheidung: weiterhin `AllCommunityModule`, nur die doppelte
Registrierung zusammengeführt.** Siehe `SPRINT_2_RESULT.md` Abschnitt 4 für
die Begründung (Funktionsumfang beider Grids zu groß für eine granulare
Modulauswahl ohne vollständige Testabdeckung jeder einzelnen Funktion).

### Preferences-Strategie

Unverändert (`usePlanViewPreferences`, `useSyncExternalStore`) - bereits
vor Sprint 2 korrekt, siehe Baseline.
