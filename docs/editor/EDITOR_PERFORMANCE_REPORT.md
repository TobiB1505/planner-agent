# Dienstplan-Editor – Performance-Bericht (Sprint 2)

Keine automatisierte Performance-Messinfrastruktur im Projekt vorhanden
(kein Lighthouse-CI, kein Bundle-Analyzer, kein synthetisches Monitoring -
konsistent mit Sprint 0/1). Alle Werte in diesem Bericht sind manuell mit
Browser-Werkzeugen erhoben, reproduzierbar dokumentiert, aber **keine
Laborbedingungen** - keine künstliche Exaktheit vorgetäuscht.

## Verwendete Werkzeuge/Umgebung

- **Browser:** Chromium (Playwright, `playwright-core`), headless, Viewport 1600×1100.
- **Frontend:** `npm run build` + `npm run start` (echter Produktions-Build,
  nicht `next dev`) für die Ladezeit-Messungen; `next dev` für die
  interaktiven Undo/Redo-/Bearbeitungstests (identisch zum lokalen
  Entwicklungsbetrieb, wie ihn der Planner-Agent im Alltag nutzt, siehe
  `start_linux.sh`).
- **Backend:** echtes FastAPI-Backend (`python -m backend.run_local`),
  lokale SQLite-Datenbank, in dieser Session frisch angelegt und mit 8
  Testmitarbeitern sowie einer historischen Woche befüllt (kein
  Produktivdatensatz).
- **Testdatensatz:** ein generierter Wochenplan "Woche B – Espania", 37
  Planzeilen, 7 Tage - eine reguläre, keine besonders große Woche
  (typische Größenordnung laut Sprint-0-Baseline).
- **Gerät:** Remote-Sandbox-Container (keine Angaben zu Consumer-Hardware
  möglich - absolute Werte sind daher nur bedingt auf ein Nutzergerät
  übertragbar, die *relativen* Vorher/Nachher-Aussagen zu Full-Grid-
  Refreshes sind hardwareunabhängig gültig).

## 1. Initiale Ladezeit des Editors

Gemessen: Zeit von Navigationsstart bis `load`-Event, bis die Toolbar
(`.plan-editor-toolbar`) sichtbar ist, und bis die erste Grid-Zelle im DOM
steht. Seite lädt einen bereits archivierten Plan automatisch (kein
manueller Wizard-Durchlauf nötig).

| Messung | Produktions-Build (`next start`) | Entwicklung (`next dev`, kalt) |
|---|---|---|
| `load`-Event | ~286 ms | ~641 ms |
| Toolbar sichtbar | ~942 ms | ~1725 ms |
| Erste Grid-Zelle im DOM | ~984 ms | ~1819 ms |
| Erneutes Laden (warmer Zustand) | ~542 ms bis Grid-Zelle | - |

Die Differenz zwischen `load`-Event (~0,3s) und "Grid-Zelle sichtbar"
(~1s) ist die Zeit für: Referenzdaten laden (`usePlanPersistence`,
5 parallele Requests), Archivplan laden (`getArchivedPlan`), React-Render
+ AG-Grid-Initialisierung. Das ist ein Netzwerk-/Backend-gebundener Anteil,
kein Frontend-Bundle-Problem - die lokale SQLite-Anbindung antwortet in
dieser Sandbox-Umgebung ausreichend schnell, dass keine der Anfragen
einzeln auffällig war.

**Sprint-2-Auswirkung:** keine messbare Verschlechterung. Die neuen
`AbortController`-Aufrufe und der zusätzliche Keyboard-Listener sind
Größenordnungen unterhalb der Meldbarkeitsschwelle dieser Messung.

## 2. Zeit bis zur Grid-Interaktion

Siehe oben ("Erste Grid-Zelle im DOM", ~1s Produktions-Build). Tatsächliche
*Interaktivität* (Zelle anklickbar, Editor öffnet) wurde qualitativ über
die zahlreichen Playwright-Testläufe dieser Session verifiziert - keine
spürbare Verzögerung zwischen Seitenladeabschluss und erster erfolgreicher
Zellbearbeitung.

## 3. Typische Renderursachen

- Jede Zellbearbeitung → `markDirty()` → React-State-Änderung
  (`isDirty`/`changeCount`) → Re-Render von `PlanEditorPage` →
  `PlanGrid`-Funktionskomponente läuft erneut (aber: `rows`/`columnDefs`
  bleiben referenzstabil, siehe unten).
- Aktiver-Tag-Wechsel → `useGridDayIndicators`-Store-Update → gezieltes
  `refreshHeader()`/`refreshCells({columns:[...]})` - **kein** React-
  Re-Render von `PlanGrid` nötig (Store-Abo statt Props).
- Planqualität-Debounce (500ms) → `setPlanQuality`/`setQualityLoading` →
  Re-Render, betrifft nur die kleine Toolbar-Badge, nicht das Grid.

## 4. Full-Grid-Refreshes vor und nach Sprint 2

Gezählt: alle `gridApi.refreshCells({force: true})`-Aufrufe im Editor-Code,
danach unterschieden nach "gezielt" (mit `rowNodes`/`columns`) vs. "voller
Grid-Refresh" (ohne Eingrenzung).

| Auslöser | Vorher | Nachher | Ersatzstrategie |
|---|---|---|---|
| Einzelne Zellbearbeitung (Grid) | gezielt (1 Zeile, 1 Spalte) | unverändert gezielt | war bereits optimal |
| Aktiver-Tag-Wechsel | gezielt (betroffene Spalten) | unverändert gezielt | war bereits optimal |
| **Vortag/anderer Tag/Bereich kopieren** (`applyPlanChanges`) | **voller Grid-Refresh** | **gezielt** (betroffene Zeilen × betroffene Tage) | `refreshAffectedCells()`, neue Hilfsfunktion in `usePlanHistory.ts` |
| **Undo/Redo einer Kopieraktion** (`revertOrReplayCustomAction`) | **voller Grid-Refresh** | **gezielt** | dieselbe Hilfsfunktion |
| Neue Planprüfung (Konfliktmarkierung) | voller Grid-Refresh | **unverändert voller Grid-Refresh** | siehe „verbleibende notwendige Full Refreshes" unten |
| Dichte-Wechsel | voller Grid-Refresh + `resetRowHeights()` | unverändert | **bewusst voll** - betrifft jede Zeilenhöhe |
| Speichern erfolgreich (`clearDirty`) | voller Grid-Refresh | **unverändert voller Grid-Refresh** | siehe unten |

**Ergebnis:** von 5 Auslösern für einen vollen Grid-Refresh vor Sprint 2
wurden 2 (Kopieraktion anwenden/rückgängig machen) auf gezielte Refreshs
umgestellt. Das ist der in der Praxis häufigste Auslöser für einen vollen
Refresh (jede Kopieraktion in der Tagesansicht), da Einzelzellbearbeitung
bereits vorher gezielt war.

**Verbleibende notwendige Full Refreshes (bewusst nicht geändert):**

1. **Dichte-Wechsel** - technisch zwingend, jede Zeile ändert ihre Höhe.
2. **Neue Planprüfung** - potenziell jede Zelle kann ein neues/entferntes
   Konflikt-Flag bekommen; eine gezielte Eingrenzung bräuchte eine
   Vorher/Nachher-Diff-Berechnung der Konfliktliste (welche `_row_id` +
   `dayLabel`-Kombinationen haben sich geändert), die aktuell nicht
   existiert. Machbar, aber ein eigenständiges kleines Feature, kein
   Einzeiler - für Sprint 3 vorgemerkt (siehe `SPRINT_2_RESULT.md`).
3. **`clearDirty()` nach Speichern** - betrifft die „manuell bearbeitet"-
   Markierung (`plan-cell-manual`) potenziell jeder Zelle, aus demselben
   Grund wie oben nicht ohne zusätzliche Buchführung eingrenzbar.

Beide verbleibenden Fälle treten **selten** auf (einmal pro Planprüfung
bzw. einmal pro erfolgreichem Speichern, nicht pro Tastenanschlag) - der
Optimierungsdruck ist dadurch geringer als bei den jetzt behobenen
Kopieraktionen, die bei jeder einzelnen Nutzeraktion in der Tagesansicht
ausgelöst wurden.

## 5. Anzahl relevanter API-Aufrufe

Beim Öffnen einer bereits archivierten Woche (häufigster Fall):
`getPlanTemplates`, `getActivePeople`, `getArtistPlans`,
`getRehearsalPlans`, `getWeeks` (parallel, `usePlanPersistence`) +
`getArchivedPlan` (danach) + `getPlanQuality` (500ms debounced, nach dem
Laden). **7 Requests** für den vollständigen initialen Ladevorgang - live
im Backend-Log verifiziert, keine unerwarteten Zusatzaufrufe.

## 6. Parallele doppelte Requests

**Vor Sprint 2 möglich, nach Sprint 2 durch Abbruch ausgeschlossen:**
schneller Fokus-Wechsel (`useThrottledFocusReload`, min. 30s Abstand -
bereits vor Sprint 2 gedrosselt) während `loadReferenceData` noch läuft,
sowie schneller Wochenwechsel während `getArchivedPlan`/`getPlanQuality`
noch laufen. Nicht in dieser Session als sichtbarer Fehler reproduziert
(die bestehenden `active`/`cancelled`/`mountedRef`-Flags haben das
*Anwenden* veralteter Ergebnisse bereits vorher verhindert), aber die
zugrunde liegenden HTTP-Requests liefen vor Sprint 2 trotzdem bis zum Ende
durch (unnötige Backend-/Netzwerklast). Mit `AbortController` wird die
Anfrage jetzt tatsächlich abgebrochen.

## 7. Verhalten bei schneller Zelleingabe

Manuell getestet: mehrere Zellbearbeitungen kurz hintereinander (Grid und
Tagesansicht, siehe Playwright-Testläufe in `SPRINT_2_RESULT.md`) -
keine sichtbare Verzögerung, keine verpassten/verworfenen Änderungen, Save-
Status-Anzeige aktualisiert sich korrekt nach jeder Änderung. Kein
React-Profiler-Lauf durchgeführt (kein im Projekt etabliertes Werkzeug
dafür, außerhalb des Sprint-2-Zeitbudgets für eine Einzelmessung ohne
bekannte Auffälligkeit).

## 8. Bundle-Auswirkung

**Neue Abhängigkeiten: keine.** `package.json`/`package-lock.json`
unverändert - alle Sprint-2-Änderungen nutzen ausschließlich bereits
vorhandene Pakete (`ag-grid-community`, `ag-grid-react`, React-Bordmittel).

**Bestehende Bundle-Größe (zur Einordnung, Produktions-Build, `.next/static`):**

| Messung | Wert |
|---|---|
| Gesamte JS-Chunks (roh) | ~3,1 MB |
| Gesamte JS-Chunks (gzip) | ~900 KB |
| AG Grid (zwei größte Chunks, roh) | ~1,1 MB + ~1,1 MB |
| AG Grid (zwei größte Chunks, gzip) | ~294 KB + ~294 KB |

Die beiden AG-Grid-Chunks sind nahezu gleich groß - ein Hinweis darauf,
dass Next.js/Turbopack AG Grid **pro Route** bündelt (Dienstplan-Editor und
Künstlerplan importieren beide unabhängig `ag-grid-community`/
`ag-grid-react`), nicht in einem gemeinsamen Chunk. Die in Sprint 2
vorgenommene Zusammenführung der Modulregistrierung
(`lib/ag-grid-setup.ts`) betraf nur den `ModuleRegistry.registerModules()`-
Aufruf selbst (Code-Duplizierung, Laufzeit-Sauberkeit) - **nicht** die
Bundle-Größe, die weiterhin pro Route anfällt. Eine echte Bundle-Reduktion
(gemeinsamer Chunk oder Modulauswahl statt `AllCommunityModule`) wäre ein
eigenständiger, größerer Task mit vollständiger Feature-Testabdeckung -
siehe `EDITOR_ARCHITECTURE.md` Abschnitt 13 für die Begründung, warum das
in Sprint 2 nicht umgesetzt wurde.

## 9. Dynamisch geladene Module

Keine (`next/dynamic` weiterhin 0 Treffer im gesamten Projekt, siehe
Sprint-0-Baseline) - unverändert, siehe `EDITOR_ARCHITECTURE.md` Abschnitt
13 ("Dynamische Imports") für die Begründung.

## 10. Verbleibende Hotspots

1. Zwei ungezielte `refreshCells({force:true})`-Aufrufe (Validierung,
   `clearDirty`) - siehe Abschnitt 4.
2. AG Grid wird pro Route neu gebündelt (Dienstplan-Editor + Künstlerplan)
   statt in einem gemeinsamen Chunk - Bundle-Optimierung, kein
   Laufzeitverhalten.
3. `getPlanQuality` läuft bei jeder Änderung erneut (debounced, aber ohne
   Ergebnis-Cache) - unverändert seit Sprint 0 (Audit-Finding C14,
   Sprint-5-Scope laut Sprint-1-Roadmap).
4. Kein `React.memo` im Projekt (unverändert, Sprint-0-Bestand) - bei der
   aktuellen Plangröße (37-40 Zeilen) nicht als Risiko eingeschätzt, aber
   nicht gemessen für größere Wochen (z.B. bei mehreren parallelen
   Programmen/Locations, falls fachlich vorgesehen).
