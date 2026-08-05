# AP8 — Plan-Editor-Renderpfad und Fokus-Reload optimieren

Arbeitspaket aus dem Refactoring-Plan: `columnDefs` im Plan-Editor (AG Grid,
`frontend/app/plan-editor/page.tsx`) hing u. a. von `effectiveActiveDay` und
`dayStatuses` ab und wurde dadurch bei jedem Zellklick bzw. jeder
Planprüfung komplett neu gebaut, obwohl sich nur eine visuelle Markierung
ändert. Zusätzlich lud `window.focus` bei jedem Tab-Wechsel ungedrosselt
fünf Referenzdaten-Endpunkte neu. Baut auf AP3–AP7 auf, ändert weder Design,
Spaltenstruktur, Zelltypen noch Undo-/Redo-/Save-/Export-Logik.

Es wurden keine Backend-Dateien geändert. Alle Messungen/Tests liefen gegen
temporäre Test-Setups oder Kopien der Live-Datenbank — nie gegen die echte
Datei.

---

## Vorher

### `columnDefs`-Dependencies (Schritt 1, Analyse)

| State/Ref | in `columnDefs` verwendet | löst Neubau aus | nur visuell? | gezielt refreshbar? |
|---|---:|---:|---:|---:|
| `effectiveActiveDay` | ja (`headerComponentParams.isActive`, `headerClass`, `cellClassRules`) | ja | ja | ja (Refactoring-Ziel) |
| `dayStatuses` | ja (`headerComponentParams.status`) | ja | ja | ja (Refactoring-Ziel) |
| `cellIssueIndex` (Konflikte) | nein (bereits Ref, `cellIssueIndexRef`) | nein | ja | ja (bereits vor AP8 stabilisiert) |
| `rows` | nein direkt (`rowsRef` in Editor-Closures) | nein | – | – |
| `dayLabels` | ja (Spaltenanzahl/-namen selbst) | ja, korrekt (strukturell) | nein | nein (muss neu bauen) |
| `assignmentRules`/`people`/`personCategories`/`rehearsalIntervals`/`showDates`/`onStageByDate`/`onStageShowsByDate`/`dekoPeople`/`previousWeekWorkload` | ja (`cellEditorSelector`-Empfehlungslogik) | ja, korrekt (fachlich) | nein | nein |
| `startDate`/`weekDates` | ja (`isToday`, `intelligenceRequest`) | ja, korrekt (nur bei Wochenwechsel) | nein | nein |

Bereits vor AP8 etabliertes Muster: Konfliktmarkierungen lasen aus einem Ref
(`cellIssueIndexRef`) statt aus einer `columnDefs`-Abhängigkeit — AP8 wendet
dasselbe Prinzip auf `effectiveActiveDay`/`dayStatuses` an.

### Rebuild-Auslöser (Baseline, analytisch ermittelt)

- **10 Zellklicks in derselben Spalte**: React bricht `setActiveDay(sameValue)`
  bereits selbst ab (kein State-Wechsel bei identischem Primitive-Wert) — nur
  der **erste** Klick auf eine neue Spalte löst tatsächlich einen Rebuild aus.
- **10 Zellklicks über verschiedene Spalten hinweg** (realistisches
  Klickverhalten): **10 `columnDefs`-Rebuilds**, da jeder Klick eine neue
  `effectiveActiveDay`-Referenz erzeugt.
- **5 Statusänderungen** (`dayStatuses` — neues Objekt bei jeder
  Neuberechnung durch `computeDayStatuses`): **5 Rebuilds**, kein Bailout,
  da immer eine neue Objektreferenz.
- **`refreshHeader()`-Aufrufe**: 0 (nie implementiert — jede Aktualisierung
  lief über einen kompletten `columnDefs`-Rebuild).

### Fokus-Reload-Verhalten (Schritt 7, Analyse)

`useEffect(() => { const load = () => {...}; window.setTimeout(load, 0);
window.addEventListener("focus", load); ... }, [])`:
- Lädt bei jedem `window`-Fokus ungedrosselt `Promise.all([getPlanTemplates,
  getActivePeople, getArtistPlans, getRehearsalPlans, getWeeks])`.
- **Kein** Mindestabstand, **kein** In-Flight-Schutz — mehrere schnelle
  Fokuswechsel lösen entsprechend viele parallele Ladevorgänge aus.
- Berührt **weder** `rows` noch `dayLabels` noch `isDirty` — ein Fokus-Reload
  kann ungespeicherte Zelländerungen also nicht direkt überschreiben.
- **Bereits bestehendes, nicht durch AP8 verursachtes Risiko** (dokumentiert,
  nicht behoben — siehe „Bewusst nicht veränderte Editorlogik"): Aktualisiert
  der Reload `archivedWeeks` und ändert sich dadurch der Eintrag für die
  aktuell geöffnete Woche, kann der separate Effekt
  (`archivedWeeks`/`startDate` → `getArchivedPlan`) einen kompletten
  Server-Reload der Planwoche auslösen und `clearDirty()` aufrufen — das gilt
  unabhängig davon, ob der Reload durch Fokus oder durch `performSave`
  ausgelöst wurde, und war bereits vor AP8 so.
- Keine `AbortController`-Logik, kein Sequenz-Schutz.

### Test-Baseline

Vor AP8 existierte **keine** Frontend-Testinfrastruktur (kein `npm test`,
keine Testdatei). `npm run build`/`npm run lint`: grün (1 vorbestehende
Warnung).

### Grenze der Live-Instrumentierung

Eine geplante Browser-Instrumentierung (`console.count` in `columnDefs`) vor
den Änderungen war durch eine parallel laufende Dev-Server-Instanz einer
anderen Session blockiert; die Baseline-Zahlen oben sind daher analytisch aus
dem Code hergeleitet (Dependency-Array-Inspektion, Grep nach
`refreshHeader`), nicht durch Live-Zählung erhoben.

---

## Umsetzung

### Neue Dateien

- **`frontend/lib/plan-editor/useGridDayIndicators.ts`**: Hook, der
  `activeDay`/`dayStatuses` in zwei kleine, abonnierbare Stores spiegelt
  (nicht in reine `useRef`s — Begründung siehe unten) und bei einer
  tatsächlichen Änderung gezielt `gridApi.refreshHeader()` bzw.
  `gridApi.refreshCells({ columns: [...], force: true })` auslöst.
- **`frontend/lib/plan-editor/useThrottledFocusReload.ts`**: kleiner lokaler
  Hook für den gedrosselten Fokus-Reload (Schritt 8–10).

### Warum Stores statt reiner Refs (wichtige Korrektur während der Umsetzung)

Der erste Ansatz (Schritt 3 des Aufgabentexts folgend) spiegelte
`activeDay`/`dayStatuses` in `useRef`s und ließ `DayHeaderCell` `ref.current`
direkt im Render lesen. Das scheiterte an zwei Stellen:

1. **ESLint (`react-hooks/refs`)**: Ein Ref-Zugriff im Render-Body einer
   React-Komponente ist nicht erlaubt (`Cannot access refs during render`).
2. **Echter Bug, im manuellen Browser-Test gefunden**: Selbst mit
   `useSyncExternalStore` und einem No-op-Abo (nur zur lint-konformen
   Ref-Lesung) blieb die Header-Markierung nach einem Tageswechsel visuell
   stehen, obwohl `cellClassRules` (liest denselben Wert, aber außerhalb des
   React-Renderns, direkt durch AG Grid aufgerufen) bereits korrekt
   aktualisierte. Ursache: `refreshHeader()` garantiert bei `ag-grid-react`
   **nicht**, dass eine bereits gemountete, benutzerdefinierte
   React-Headerkomponente neu gerendert wird — der interne Wrapper übergibt
   zwar bei jedem Redraw dieselben `headerComponentParams`, ruft die
   Nutzerkomponente aber nicht zuverlässig erneut auf, wenn sich weder
   `columnDefs` noch die Spaltenbreite/-position ändern.

**Korrektur**: `useGridDayIndicators` verwaltet stattdessen zwei minimale,
React-freie Stores mit echtem Publish/Subscribe (`get`/`set`/`subscribe`).
`DayHeaderCell` abonniert sie über `useSyncExternalStore(store.subscribe,
store.get)` — dadurch rendert sich die Komponente über React selbst neu,
sobald `set()` aufgerufen wird, unabhängig vom AG-Grid-Lifecycle.
`cellClassRules`/`headerClass`/der `onCellClicked`-Guard in `page.tsx` lesen
denselben Store synchron über `.get()` (kein React-Render, daher ohne
Lint-Einschränkung). Verifiziert per Live-Test im Browser (siehe „Nachher").

### Gezielte Grid-Refreshes

- Tageswechsel: `refreshHeader()` **und** `refreshCells({ columns:
  [vorherigerTag, neuerTag], force: true })` — bewusst nur auf die zwei
  betroffenen Spalten begrenzt statt eines vollen Grid-Refreshs.
- Statusänderung: **nur** `refreshHeader()` — die Tagesstatus-Punkte werden
  ausschließlich im Header dargestellt, keine Zelle zeigt sie an.
- Beide Effekte prüfen `gridApiRef.current` vor jedem Aufruf (kein Fehler vor
  `onGridReady`) und überspringen unveränderte Werte (kein Effekt beim
  Mount, keine Doppel-Refreshes bei mehrfachem Klick auf denselben Tag).

### Neue `columnDefs`-Dependency-Struktur

`effectiveActiveDay` und `dayStatuses` wurden aus dem Dependency-Array
entfernt und durch die stabilen Store-Objekte (`activeDayStore`,
`dayStatusesStore`) ersetzt — deren Referenz ändert sich nie, ein
Tageswechsel oder eine Planprüfung lösen dadurch keinen `columnDefs`-Rebuild
mehr aus. Alle anderen (fachlich/strukturell relevanten) Abhängigkeiten
blieben unverändert.

### `onCellClicked`-Guard (Schritt 6)

```ts
if (field && dayLabels.includes(field) && field !== activeDayStore.get()) {
  setActiveDay(field);
}
```

Verhindert einen wirkungslosen `setActiveDay`-Aufruf bei Klicks innerhalb
derselben Spalte. `selectDay` (Klick auf die Header-Kachel) blieb
unverändert, da `ensureColumnVisible(dayLabel)` bewusst bei jedem Klick
erneut laufen soll (Scroll-zu-Spalte auch bei bereits aktivem Tag).

### Fokus-Reload-Drosselung (Schritt 8–10)

- **Mindestabstand 30 s zwischen gestarteten Versuchen** (nicht erst bei
  Erfolg) — bewusste Entscheidung: ein hängender oder fehlschlagender
  Request soll das Intervall trotzdem verbrauchen, statt beliebig viele
  Wiederholversuche in kurzer Folge zuzulassen.
- **In-Flight-Ref**: verhindert einen parallelen zweiten Reload.
- **`document.visibilityState === "visible"`-Guard** (Schritt 9): kein Reload,
  solange der Tab nicht wirklich sichtbar ist — im Live-Test bestätigt (siehe
  „Nachher").
- Kein `AbortController`/keine Sequenznummer eingeführt — nicht nötig, da der
  In-Flight-Schutz bereits ausschließt, dass zwei Ladevorgänge gleichzeitig
  laufen; „Stale Response überschreibt neuere Daten" kann dadurch nicht
  auftreten.
- `mountedRef` in `page.tsx` (nicht im Hook selbst): schützt die
  State-Setter in `loadReferenceData` (`setTemplates` etc.) davor, nach einem
  Unmount noch aufgerufen zu werden — derselbe Zweck wie die bereits an
  anderer Stelle in `page.tsx` verwendeten lokalen `active`/`cancelled`-Flags
  (z. B. im `archivedWeeks`-Ladeeffekt), hier komponentenweit, weil sowohl
  der initiale Mount-Load als auch der Fokus-Reload dieselbe Funktion teilen.

### Bewusst nicht veränderte Editorlogik

- `PersonCellEditor`/`SoftsportCellEditor`: nicht angefasst.
- Undo-/Redo-Stack, `onCellValueChanged`, `applyPlanChanges`,
  `revertOrReplayCustomAction`: unverändert.
- Save-/Export-Logik (`performSave`, `xlsxGenerate`): unverändert.
- Plan-Quality-Requests (`getPlanQuality`-Debounce-Effekt): unverändert.
- Das unter „Fokus-Reload-Verhalten" dokumentierte Risiko (indirekter
  Vollreload der Planwoche über den `archivedWeeks`-Effekt) wurde
  **dokumentiert, nicht behoben** — Korrektur würde Produktlogik
  (Vergleichsbasis für Dirty-State) berühren und liegt außerhalb dieses
  Pakets.

---

## Nachher

### `columnDefs`-Call-Counts

Durch Entfernen von `effectiveActiveDay`/`dayStatuses` aus dem
Dependency-Array (verifiziert per Codeinspektion: keine Referenz mehr in der
`columnDefs`-Closure) baut `columnDefs` bei Tageswechsel oder Statusänderung
**nicht mehr neu** — bestätigt durch:
- 15/15 automatisierte Tests (`useGridDayIndicators.test.tsx`), die exakt
  diese Szenarien gegen den echten Hook-Mechanismus prüfen.
- Manuellen Live-Test im Browser (siehe unten).

### Grid-Refresh-Counts (aus den Tests)

| Szenario | `refreshHeader()` | `refreshCells()` |
|---|---:|---:|
| Tageswechsel (1×) | 1 | 1 (gezielt auf 2 Spalten) |
| 3 Klicks auf bereits aktiven Tag | 0 | 0 |
| Statusänderung (1×) | 1 | 0 |
| 5 Statusänderungen | 5 | 0 |
| Vor `onGridReady` | 0 (kein Fehler) | 0 (kein Fehler) |

### Fokus-Reload-Counts (aus den Tests)

| Szenario | Reload-Aufrufe |
|---|---:|
| Erster Fokus | 1 |
| Zweiter Fokus innerhalb 30 s | 0 (blockiert) |
| Fokus nach Ablauf des Intervalls | 1 (wieder erlaubt) |
| Fokus während laufendem Reload | 0 (blockiert) |
| Nach Fehlschlag: späterer Fokus (nach Intervall) | 1 (In-Flight-Reset funktioniert) |
| Nach Unmount | 0 (Listener entfernt) |
| Tab nicht sichtbar (`visibilityState !== "visible"`) | 0 |

### Manueller Kern-Workflow (Schritt 14, Live-Browser-Test)

Gegen eine per `uvicorn`/`.env.local` umgeleitete **Kopie** der lokalen
Datenbank (nie die echte Datei) im eigenen Dev-Server getestet:

- Plan öffnen (KW 32), Wochenübersicht (AG-Grid) laden: **erfolgreich**.
- Tageswechsel per Zellklick (Klick in „Fr 07.08."-Spalte): Header **und**
  Zell-Markierung wechseln korrekt und synchron zu „Fr 07.08." — dabei wurde
  der oben beschriebene Store-Bug gefunden und noch in dieser Session
  behoben (vor der Korrektur blieb die Header-Kachel visuell hängen, obwohl
  die Zellmarkierung bereits korrekt war).
- Tageswechsel per Klick auf die Header-Kachel: nach dem Fix ebenfalls
  korrekt (Header + Zellen synchron, verifiziert für „Di 04.08.").
- Konfliktmarkierungen (orangene Dreiecke) und Tagesstatus-Punkte: unverändert
  sichtbar.
- `document.visibilityState` war in der automatisierten Browser-Session
  durchgehend `"hidden"` (Tab nicht wirklich sichtbar) — der
  `requireVisible`-Schutz griff dadurch live und verhinderte jeden
  Fokus-Reload-Versuch; bestätigt, dass der Schutz nicht nur im Unit-Test,
  sondern auch gegen echtes Browser-Verhalten korrekt reagiert.
- Zell-Editor-Popups (`PersonCellEditor`) ließen sich über synthetische
  Klicks des Automatisierungswerkzeugs nicht zuverlässig öffnen — vermutlich
  eine Einschränkung der simulierten Klick-Events gegenüber AG Grids
  internem Editor-Start (Mousedown/-up-Sequenz), nicht durch AP8 verursacht,
  da `cellEditorSelector`/`PersonCellEditor`/`SoftsportCellEditor` nicht
  angefasst wurden. Nicht weiter verifizierbar in dieser Session — als
  Grenze dokumentiert statt als Regression gewertet, da kein Codepfad davon
  berührt wurde.
- Ein bei den ersten Live-Tests aufgetretener Konsolenfehler („The final
  argument passed to %s changed size between renders") erwies sich als
  Fast-Refresh-Artefakt aus der iterativen Live-Bearbeitung (React löste ihn
  selbst über einen vollständigen Reload auf) und trat nach einem sauberen
  Neuladen nicht erneut auf.
- Ein während der Vorbereitung entdeckter, vom AP8-Scope unabhängiger
  Backend-Bug (SQLite-Connection wird bei echter Parallelität in einem
  anderen Thread geschlossen als erzeugt, siehe `db.get_db_connection`)
  wurde **nicht** im Rahmen von AP8 behoben (Backend-Änderungen sind
  ausdrücklich nicht erlaubt) und stattdessen als eigenständige Aufgabe
  gemeldet.

### Testergebnisse

| Befehl | Exit-Code | Ergebnis |
|---|---|---|
| `npx vitest run` | 0 | **15 passed** (neu — vorher keine Tests) |
| `npx tsc --noEmit` | 0 | keine Fehler |
| `npm run lint` | 0 | 0 Fehler, 1 vorbestehende, unveränderte Warnung |
| `npm run build` | 0 | erfolgreich |
| `pytest` (Backend-Regression) | 0 | **117 passed** (unverändert, keine Backend-Datei berührt) |

### Verbleibende Renderengpässe

- Die Renderdauer selbst wurde nicht separat mit dem React Profiler
  gemessen (siehe Grenzen der Messung im Abschlussbericht) — die
  Call-Count-Reduktion (0 statt 10 bzw. 5 `columnDefs`-Rebuilds) ist der
  belastbare Beleg, keine Zeitmessung.
- `columnDefs` bleibt weiterhin von `assignmentRules`, `people`,
  `personCategories`, `rehearsalIntervals`, `showDates`, `onStageByDate`,
  `onStageShowsByDate`, `dekoPeople`, `previousWeekWorkload`, `startDate`,
  `weekDates`, `dayLabels` abhängig — bewusst nicht angetastet, da diese
  Werte echte strukturelle/fachliche Änderungen darstellen (nicht Teil des
  in der Aufgabenstellung benannten Problems).
- Das dokumentierte, vorbestehende Risiko eines indirekten Vollreloads über
  den `archivedWeeks`-Effekt bleibt bestehen (siehe „Bewusst nicht
  veränderte Editorlogik").
