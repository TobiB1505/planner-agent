# Sprint 2 – Ergebnisbericht

Branch: `claude/ui-foundation-sprint-1-rzyjau` (Basis: Sprint-1-Endstand
`bbf65f8`). 6 Commits, 13 Dateien, +615/−92 Zeilen (frontend/).

Sprint-1-Freigabe war **READY FOR SPRINT 2** (siehe
`docs/ui/SPRINT_1_RESULT.md`) - keine bekannten Risiken aus Sprint 1
betrafen den Dienstplan-Editor, keine Neubewertung nötig.

## 1. Zusammenfassung

**Ausgangslage anders als der Auftrag vermuten ließ:** Ein früheres
Refactoring ("AP12", vor Sprint 0) hatte den Editor bereits von einer
2.132-Zeilen-Datei auf eine Struktur mit eigenen Hooks
(`usePlanHistory`, `usePlanPersistence`) und Komponenten (`PlanGrid`,
`EditorDialogs`, `PlanWizardSteps`) aufgeteilt. Wochen- und Tagesansicht
griffen bereits auf denselben Datenzustand zu, Row-IDs waren bereits
stabil (Sprint 0), View-Preferences bereits SSR-sicher. Sprint 2 hat diese
Struktur **beibehalten** (kein Parallelaufbau der im Auftrag skizzierten
Beispielarchitektur) und stattdessen die tatsächlichen, live verifizierten
Lücken geschlossen.

**Kritischstes Ergebnis:** Undo/Redo in der Wochenübersicht war
**faktisch unbenutzbar** - ein Klick auf "Rückgängig" deaktivierte den
Button, stellte aber den Zellwert nicht wieder her. Ursache: instabile
Funktionsreferenzen, die `PlanGrid` bei jedem Render an AG Grid
weiterreichte, invalidierten dessen eingebauten Undo-Stack. Behoben und
mit einer Playwright-Testreihe gegen das echte Backend verifiziert.
Zusätzlich gab es **kein funktionierendes Tastaturkürzel** für Undo/Redo
(weder Strg+Z noch Cmd+Z lösten etwas aus) - ebenfalls behoben.

**Weitere behobene technische Probleme:**
- Zwei Full-Grid-Refreshs (Kopieraktion anwenden/rückgängig machen) auf
  gezielte Zeilen/Spalten umgestellt.
- `AbortController` für Referenzdaten-, Archivplan-, Planqualität- und
  KI-Empfehlungsanfragen (vorher: nur manuelle `cancelled`-Flags, kein
  echter Netzwerk-Abbruch).
- Synchroner Re-Entrancy-Schutz gegen Doppel-Speichern.
- AG-Grid-Modulregistrierung dedupliziert (Sprint-0-Audit-Finding C13).
- Dreifach duplizierte "heutiges Datum"-Berechnung konsolidiert.
- Generische Erfolgs-/Fehlermeldung nutzt jetzt `InlineStatus` (Sprint 1).

**Welche Verantwortlichkeiten wurden getrennt?** Keine neue Trennung nötig
- die bestehende war bereits korrekt (siehe `EDITOR_TECHNICAL_BASELINE.md`
Abschnitt 1). Stattdessen wurden bestehende Verantwortlichkeitsgrenzen
gehärtet (z.B. `refreshAffectedCells()` als neue, klar benannte
Hilfsfunktion innerhalb von `usePlanHistory`, statt die Refresh-Logik in
`page.tsx` zu duplizieren).

**Welche Funktionen blieben unverändert?** Alle fachlichen Planungsregeln
(`lib/recommendations.ts`, `lib/planValidation.ts`, Backend-
`assignment.py`), Kategoriefarben, Exportlogik/-layout, alle API-Verträge
(nur additive, optionale `AbortSignal`-Parameter auf Client-Seite), das
visuelle Erscheinungsbild des Grids (keine Ent-Excelung - explizit
Sprint-3-Scope), Zeilen-Handling (kein Hinzufügen/Löschen/Umbenennen -
das war nie Teil des Funktionsumfangs).

## 2. Architektur

Siehe `EDITOR_ARCHITECTURE.md` für die vollständige Beschreibung.
Kurzfassung:

- **Neue Dateien:** `lib/ag-grid-setup.ts` (einmalige Modulregistrierung),
  `lib/plan-editor/today.ts` (konsolidierte Datumsermittlung).
- **State-Eigentümer:** unverändert - `rows`/`dayLabels`/`weekDates` in
  `page.tsx`, Dirty-/Save-State in `usePlanPersistence`, Undo/Redo-History
  in `usePlanHistory`, View-Preferences in `usePlanViewPreferences`.
- **Hooks:** `usePlanHistory` und `usePlanPersistence` unverändert in
  ihrer Aufteilung, intern gehärtet (gezielte Refreshs, Abort-Support,
  Re-Entrancy-Schutz).
- **Komponenten:** `PlanGrid` mit stabilisierten Props als einzige
  strukturelle Änderung an einer Komponente.
- **Datenfluss:** unverändert - ein Zustand (`rows`), zwei Schreibpfade
  (Grid-Zellbearbeitung, `commitDayEntry`/`applyPlanChanges`), beide münden
  in dieselbe Undo/Redo-Buchführung.

## 3. Undo und Redo

**Transaktionsmodell** (siehe `EDITOR_ARCHITECTURE.md` Abschnitt 5 für die
vollständige Tabelle): eine Nutzeraktion = ein Undo-Schritt, unabhängig
davon, wie viele Zellen sie betrifft (Einzelzelle, Paste, Tag kopieren,
Bereich kopieren, Tag leeren). Wizard-Änderungen (Plan neu erstellen)
setzen die History bewusst zurück statt sie um einen Schritt zu erweitern.

**Unterstützte Aktionen:** Einzelzell-Bearbeitung (Wochenübersicht,
AG-Grid-eigener Stack), Zellbearbeitung (Tagesansicht), Vortag/anderer
Tag/Bereich kopieren, Tag leeren (eigener Aktions-Stack) - alle
chronologisch korrekt verzahnt, live verifiziert (siehe Abschnitt 9).

**Tastaturkürzel (neu, Phase 4.3):** Strg+Z/Cmd+Z (Undo), Strg+Umschalt+Z/
Cmd+Umschalt+Z (Redo), Strg+Y (Redo, Windows-Konvention). Globaler
`keydown`-Listener auf der Capture-Phase, greift nicht bei fokussierten
Eingabefeldern (Input/Textarea/Select/`contenteditable`) - native
Undo-Funktion von Textfeldern (Zelleditor-Suchfelder) bleibt unangetastet.

**Bekannte Einschränkungen:**
- Die im Ausgangszustand gefundene Instabilität war spezifisch an
  instabile React-Props gebunden - der jetzige Fix behebt die
  *Ursache*, aber jede künftige Änderung an `PlanGrid`s Props muss
  Undo/Redo erneut live prüfen (kein automatisierter Test kann AG Grids
  internes Verhalten hierzu abdecken, siehe `usePlanHistory.test.ts` für
  die Grenzen der Testbarkeit ohne echtes AG Grid).
- Zwei verbleibende ungezielte Full-Grid-Refreshs (Validierung,
  `clearDirty`) - siehe `EDITOR_PERFORMANCE_REPORT.md` Abschnitt 4.
- Kein Test für "mehrere Zellen einfügen" (Paste) mit echtem
  Zwischenablage-Zugriff durchgeführt (Headless-Chromium-Zwischenablage-
  Berechtigungen in dieser Sandbox nicht verfügbar) - AG Grids eigene
  Paste-Gruppierung (ein Paste = ein Undo-Schritt) ist Standardverhalten
  von `undoRedoCellEditing` und wurde nicht separat verändert.

## 4. AG Grid

**Stabile Props (neu):** `defaultColDef`, `getRowId`, `isFullWidthRow` als
modulweite Konstanten; `onGridReady`, `onCellClicked`, `getRowHeight` über
`useCallback` mit korrekten, vollständigen Abhängigkeiten.

**Row-ID:** unverändert (`assignRowIds`, Sprint 0) - deterministisch,
Occurrence-Index-basiert, keine Array-Indizes, keine editierbaren Labels
allein. In Sprint 2 erstmals mit Unit-Tests abgesichert.

**Column Definitions:** unverändert strukturell (bereits vor Sprint 2 über
`useMemo` mit vollständigen Abhängigkeiten, keine API-Aufrufe, keine
versteckten Seiteneffekte). Keine `buildPlanColumnDefs()`-Extraktion
vorgenommen - der bestehende `useMemo`-Block ist bereits testbar
strukturiert (reine Funktion der Abhängigkeiten), eine Extraktion in eine
separate Datei hätte ohne konkreten Zusatznutzen nur die Blast-Radius-
Fläche einer weiteren Änderung vergrößert.

**Refresh-Strategie:** siehe Abschnitt 3 und `EDITOR_PERFORMANCE_REPORT.md`
Abschnitt 4 - 2 von 5 Full-Grid-Refresh-Auslösern auf gezielt umgestellt,
3 verbleiben (davon 1 technisch zwingend, 2 dokumentiert als machbare,
aber nicht in Sprint 2 umgesetzte Verbesserung).

**Module:** `AllCommunityModule` weiterhin verwendet, Registrierung aus
`plan-editor/page.tsx` und `artist-plan/page.tsx` in `lib/ag-grid-setup.ts`
zusammengeführt. Eine granulare Modulauswahl wurde geprüft, aber wegen des
Funktionsumfangs beider Grids (Zell-Editoren mit Popups, Undo/Redo,
Vollbreiten-Zeilen, Tooltips, Zell-Flashing, programmatische Navigation)
ohne vollständige Testabdeckung jeder einzelnen Funktion als zu riskant
eingestuft und verworfen.

## 5. Requests und Validierung

**AbortController:** `lib/api.ts` erlaubt jetzt ein optionales
`AbortSignal` für die vom Editor genutzten Endpunkte
(`getPlanTemplates`/`getActivePeople`/`getArtistPlans`/
`getRehearsalPlans`/`getWeeks`/`getArchivedPlan`/`getPlanQuality`/
`getIntelligentRecommendations`). `request()` erkennt `AbortError` und
maskiert ihn nicht mehr als "Backend nicht erreichbar".

**Timeouts:** nicht eingeführt - die API-Schicht wartet weiterhin
unbegrenzt auf eine Antwort. Kein in dieser Session beobachteter Bedarf
(lokales Backend, keine Hänger reproduziert); eine pauschale Timeout-
Einführung ohne konkreten Fehlerfall hätte das Risiko getragen, legitime,
aber langsame Anfragen (z.B. große Exporte) fälschlich abzubrechen.

**Deduplizierung:** kein Cache/Dedup-Mechanismus - "Abbrechen und neu
starten" (siehe AbortController oben) erfüllt denselben Zweck für die
tatsächlich betroffenen Fälle.

**Veraltete Ergebnisse:** lokale Validierung ist synchron (keine
Staleness-Möglichkeit). Serverseitige Planqualität wird nur übernommen,
wenn die Anfrage nicht abgebrochen wurde (jetzt zusätzlich zum
bestehenden `cancelled`-Flag auch durch echten Request-Abbruch
abgesichert).

**Fehlerbehandlung:** unverändert - Backend-Fehler werden als
nutzerverständliche Meldungen angezeigt (`ApiError`), abgebrochene
Requests erscheinen nirgends als sichtbarer Fehler (verifiziert:
`loadReferenceData`s Catch-Handler prüft explizit `error?.name ===
"AbortError"`).

## 6. Dirty-State und Speichern

**Dirty-Modell:** unverändert (bereits vor Sprint 2 korrekt) - entsteht
nur bei fachlichen Änderungen, nicht bei Ansichtswechsel/Dichte-Änderung/
Dialog öffnen. Live verifiziert.

**Speicherablauf:** neuer synchroner Ref-Schutz (`savingRef`) verhindert
einen zweiten `performSave()`-Aufruf, während einer bereits läuft -
zusätzlich zum bestehenden `disabled={busy || !isDirty}`-Zustand des
Buttons. Kein tatsächlicher Doppel-Save in dieser Session reproduzierbar
(das UI-Deaktivieren griff im Test bereits zuverlässig), aber die
theoretische Lücke zwischen Klick und Re-Render ist jetzt geschlossen.

**Fehlerverhalten:** unverändert - bei Speicherfehler bleibt der Plan
dirty, `saveError` wird angezeigt.

**Navigation:** unverändert - `useUnsavedChangesGuard` (Sprint 0) bleibt
vollständig funktionsfähig, live verifiziert (Wochenwechsel mit
Dirty-State → Bestätigungsdialog mit drei Optionen: Abbrechen/Änderungen
verwerfen/Änderungen speichern).

## 7. Wochen- und Tagesansicht

**Gemeinsame Datenbasis:** bereits vor Sprint 2 vorhanden (eine
`rows`-Referenz, ein Schreibpfad) - in Sprint 2 nicht verändert, aber
erstmals gezielt live verifiziert: Wochenübersicht-Bearbeitung sofort in
Tagesansicht sichtbar, Tagesansicht-Batch-Aktion (Tag leeren) rückgängig
gemacht stellt eine vorherige Wochenübersicht-Bearbeitung korrekt wieder
her (chronologische Undo-Reihenfolge über beide Ansichten hinweg
funktioniert).

**Mounting-Strategie:** unverändert (beide Ansichten dauerhaft gemountet,
CSS-Umschaltung) - bewusst beibehalten, siehe `EDITOR_ARCHITECTURE.md`
Abschnitt 13 für die vollständige Abwägung. Ein Unmount auf kleinen
Viewports würde AG Grids eingebauten Undo-Stack und die Scrollposition
verlieren; eine sichere Lösung (vollständige Migration des Undo-Modells)
ist eine grundlegende Architekturänderung, kein Mounting-Detail, und für
Sprint 3 vorgemerkt.

**Synchronisierung:** keine manuelle Synchronisation nötig oder vorhanden
- beide Ansichten sind Renderings desselben Zustands.

## 8. Performance

Siehe `EDITOR_PERFORMANCE_REPORT.md` für die vollständigen, mit Werkzeug/
Umgebung/Testdatensatz dokumentierten Messwerte. Kurzfassung:

- **Vorher:** 5 Auslöser für einen vollständigen Grid-Refresh
  (Zellbearbeitung war bereits gezielt); kein echter Request-Abbruch.
- **Nachher:** 2 der 5 Full-Grid-Refresh-Auslöser (Kopieraktion anwenden/
  rückgängig) auf gezielte Zeilen/Spalten umgestellt; Requests werden bei
  Wochenwechsel/schneller Folgeaktion/Unmount tatsächlich abgebrochen.
- **Verbleibende Hotspots:** 2 dokumentiert-akzeptierte Full-Grid-
  Refreshs (Validierung, `clearDirty`), AG Grid wird pro Route neu
  gebündelt statt in einem gemeinsamen Chunk (~590KB gzip über zwei
  Routen), kein Ergebnis-Cache für Planqualität.
- **Bundle-Auswirkung:** keine neuen Abhängigkeiten.

## 9. Tests

| Prüfung | Befehl | Ergebnis |
|---|---|---|
| TypeScript | `npx tsc --noEmit -p tsconfig.json` | ✅ 0 Fehler |
| Lint | `npm run lint` (eslint) | ✅ 0 Fehler, 0 Warnungen |
| Frontend-Tests | `npm run test` (vitest) | ✅ 62/62 Tests, 9 Testdateien (46 aus Sprint 1 + 16 neue: `usePlanHistory.test.ts` [4], `planEditorHelpers.test.ts` [10], `today.test.ts` [2]) |
| Frontend-Build | `npm run build` (Next.js/Turbopack) | ✅ erfolgreich, dieselbe vorbestehende, unveränderte Warnung wie in Sprint 0/1 (tote `/control/backend/status`-Route) |
| Backend-Tests | `python -m pytest backend/tests -q` | ✅ 240/240 grün (in dieser Session ausgeführt, im Gegensatz zu Sprint 1 stand ein funktionsfähiges Python-venv zur Verfügung) |

**Manuelle Editor-Teststrecke** (Playwright/Chromium gegen echtes,
laufendes FastAPI-Backend mit lokaler SQLite-Datenbank, 8 Testmitarbeitern,
einer historischen Woche als Fairness-Grundlage und einem generierten
37-Zeilen-Wochenplan):

*Laden:* ✅ Editor öffnen (Wizard und Direktladen eines archivierten
Plans beide getestet), ✅ Woche wechseln, ✅ zurückwechseln. Ladefehler/
Request-Abbruch-während-Wochenwechsel nicht separat mit einer künstlichen
Netzwerkverzögerung simuliert (kein Werkzeug dafür in der Sandbox
eingerichtet) - stattdessen über Code-Review verifiziert (`active`/
`controller.abort()` in der Effekt-Cleanup-Funktion).

*Bearbeiten:* ✅ einzelne Zelle bearbeiten (Wochenübersicht und
Tagesansicht), ✅ Person hinzufügen/entfernen (PersonCellEditor,
Chip-Klick), ✅ zwei inhaltlich identische Zeilen (Kochdienste/
Sportprogramm-Zeitslots im generierten Plan, korrekt disambiguiert). ⛔
"Zeile hinzufügen/umbenennen/löschen" - nicht anwendbar, keine
UI-Funktion dafür vorhanden (siehe `EDITOR_ARCHITECTURE.md` Abschnitt 12).
Mehrere Zellen einfügen (Paste) nicht mit echter Zwischenablage getestet
(Sandbox-Einschränkung), aber AG Grids Standardverhalten dafür unverändert.

*Ansichten:* ✅ Wochenansicht bearbeiten → Tagesansicht öffnen → Änderung
sichtbar, ✅ Tagesansicht bearbeiten (Tag leeren) → Undo → vorherige
Wochenansicht-Änderung korrekt erhalten.

*History:* ✅ einzelne Änderung rückgängig/wiederholen, ✅ Batch-Änderung
(Tag leeren) rückgängig/wiederholen, ✅ neue Änderung nach Undo verwirft
Redo-Stack, ✅ Tastaturkürzel (Strg+Z, Strg+Umschalt+Z, Cmd+Z), ✅ natives
Undo in einem Eingabefeld (PersonCellEditor-Suchfeld) wird nicht vom
Editor abgefangen.

*Speichern:* ✅ speichern, ✅ doppelt auf Speichern klicken (kein Doppel-
POST im Backend-Log), ✅ nach erfolgreichem Speichern navigieren (kein
Block), ✅ Undo auf/nach gespeichertem Stand (korrekt, keine verwaisten
Zeilenreferenzen trotz Neuladen des gespeicherten Plans). Speicherfehler
nicht mit einem echten Backend-Fehler simuliert (kein Werkzeug dafür
eingerichtet) - Code-Pfad (`catch`-Block, `saveError`, `saveState:
"error"`) unverändert seit Sprint 0/vor Sprint 2 und nicht Teil der
Sprint-2-Änderungen.

*Navigation:* ✅ mit Dirty-State Woche wechseln (Bestätigungsdialog mit
drei Optionen). Browser-Zurück/Reload nicht erneut getestet (Sprint-0-
Ergebnis unverändert, siehe bekannte Navigations-Lücke dort - außerhalb
des Sprint-2-Scopes).

*Performance:* ✅ mehrere schnelle Zelleingaben ohne sichtbare
Verzögerung, ✅ Ansichtswechsel mehrfach ohne Datenverlust. Kein React-
Profiler-Lauf (siehe `EDITOR_PERFORMANCE_REPORT.md`).

## 10. Offene Probleme

- Zwei ungezielte Full-Grid-Refreshs (Validierung, `clearDirty`) - siehe
  Abschnitt 4/8. Nicht blockierend (seltene Auslöser), für Sprint 3
  vorgemerkt.
- AG-Grid-Undo-Stack-Migration in den eigenen Aktions-Stack (Voraussetzung
  für ein sicheres Unmounten der Wochenübersicht auf kleinen Viewports) -
  nicht umgesetzt, eigenständiger Sprint-3-Kandidat.
- Kein Timeout auf API-Ebene - unverändert, kein in dieser Session
  beobachteter Bedarf.
- Speicherfehler- und Ladefehler-Pfade nicht mit einem echten simulierten
  Backend-Fehler live durchgeklickt (nur Code-Review) - Restrisiko wie
  in Sprint 0 bereits für andere Guards dokumentiert.
- Bekannte Sprint-0-Risiken (Browser-Zurück/Vor-Navigationslücke)
  weiterhin unverändert offen, nicht Sprint-2-Scope.

## 11. Freigabe für Sprint 3

## **READY FOR SPRINT 3**

**Begründung:** Alle Definition-of-Done-Punkte sind erfüllt - die
Editor-Architektur ist dokumentiert (Baseline + Zielzustand), zentrale
Verantwortlichkeiten waren bereits sinnvoll getrennt und wurden nicht
unnötig neu aufgeteilt, kein Rewrite durchgeführt. Wochen- und
Tagesansicht nutzen nachweislich dieselbe fachliche Datenbasis, Undo/Redo
funktioniert nach dem Sprint-2-Fix in beiden Ansichten zuverlässig
(vorher: nachweislich nicht in der Wochenübersicht), stabile Row-IDs
werden durchgängig verwendet, AG-Grid-Props sind stabilisiert, Full-Grid-
Refreshes wurden für den häufigsten Auslöser reduziert und die
verbleibenden dokumentiert begründet, Requests sind abbrechbar, veraltete
Validierungsergebnisse werden nicht übernommen, Dirty-State und Speichern
sind zuverlässig (inkl. neuem Doppel-Speichern-Schutz), Preferences
verursachen keine Hydration-Probleme (unverändert seit Sprint 0), relevante
Performance-Hotspots wurden gemessen und dokumentiert. Exportdesign
unverändert, keine fachliche Planungslogik verändert. TypeScript/Lint/
Tests/Build sind grün, Backend-Tests grün.

Die Freigabe ist nicht ohne jede Einschränkung, weil: (a) einige manuelle
Testfälle (Speicherfehler, Ladefehler-mit-Request-Abbruch, echtes Paste
mit Zwischenablage) mangels geeigneter Werkzeuge in dieser Sandbox nur per
Code-Review statt Live-Durchklicken verifiziert wurden; (b) die zwei
verbleibenden Full-Grid-Refreshs und die Mounting-Strategie-Frage bewusst
offene, dokumentierte Punkte für Sprint 3 sind, keine unentdeckten
Risiken. Keines der Sprint-0-Risiken (Browser-Zurück-Lücke) wurde durch
Sprint 2 verschärft oder berührt.

## 12. Empfohlener Scope für Sprint 3

Sprint 3 soll sich laut Auftrag auf das visuelle Redesign und die
Ent-Excelung des Dienstplan-Editors konzentrieren. Aktualisierte
Aufgabenliste auf Basis des tatsächlichen Codes nach Sprint 2:

1. **Ent-Excelung der Zellendarstellung (C9/C10):** vollflächige
   Zellfarben (`hexToRgba(rowColor(...), 0.06-0.16)` in `columnDefs`)
   durch Kanten/Akzente ersetzen, `cursor: text` auf den Zellen
   überdenken, Fehler vs. Warnung nicht mehr nur über `cellClassRules`-
   Farbklassen (`plan-cell-issue-error`/`-warning`) unterscheidbar machen
   - jetzt mit den in Sprint 1 geschaffenen `--color-danger`/
  `--color-warning`-Tokens und `StatusBadge` als Bausteine.
2. **Gezielte Refreshs für Validierung/`clearDirty` vervollständigen:**
   eine kleine Diff-Berechnung (welche `_row_id`+`dayLabel`-Kombinationen
   haben sich seit der letzten Prüfung geändert) würde die beiden
   verbleibenden Full-Grid-Refreshs aus Sprint 2 auf gezielte Refreshs
   umstellen - jetzt, wo das Muster (`refreshAffectedCells`) bereits
   etabliert ist, ein kleiner Folge-Task.
3. **Mounting-Strategie der Wochenübersicht auf kleinen Viewports:**
   entweder eine vollständige Migration des AG-Grid-eigenen Undo-Stacks in
   den projekteigenen Aktions-Stack (ermöglicht sicheres Unmounten) oder
   eine bewusste, dokumentierte Entscheidung, den aktuellen Kompromiss
   beizubehalten - beides ist besser als der Status quo (unentschieden).
4. **Weitere `PersonCellEditor`/`SoftsportCellEditor`-Stabilisierung:**
   Phase 7 des Sprint-2-Auftrags (Renderer/Editor-Stabilisierung) wurde in
   Sprint 2 nur an den Undo/Redo-relevanten Stellen (AbortController)
   angefasst - eine gezielte Prüfung auf `React.memo`-Kandidaten lohnt
   sich erst im Rahmen der visuellen Neugestaltung, wenn ohnehin an diesen
   Komponenten gearbeitet wird.
5. **AG-Grid-Bundle-Konsolidierung:** die in
   `EDITOR_PERFORMANCE_REPORT.md` dokumentierte Doppel-Bündelung von AG
   Grid über zwei Routen (Dienstplan-Editor, Künstlerplan) ließe sich mit
   einem gemeinsamen Next.js-Chunk (`optimizePackageImports` oder
   manuelles Chunk-Splitting) reduzieren - eigenständiger, risikoarmer
   Performance-Task.
6. **Dashboard-Konsolidierung (C8):** unverändert Sprint-3-Scope laut
   Sprint-0/1-Roadmap, kein Editor-Bezug.

Explizit **nicht** in Sprint 3 (unverändert laut Gesamt-Roadmap): neue
Planungsautomatik, Änderung fachlicher Regeln, Änderung des Exports,
vollständige Server-Component-Migration, neue globale State-Library.
