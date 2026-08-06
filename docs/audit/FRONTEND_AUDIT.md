# Frontend-Audit: Planner-Agent

**Stand:** August 2026 · Analysierter Stack: Next.js 16.2.12 (App Router), React 19.2.4, TypeScript, Tailwind v4, AG Grid Community 36.0.2
**Umfang:** 64 TS/TSX-Dateien (~15.000 LOC), 17 CSS-Dateien (~12.260 Zeilen, 249 KB unminifiziert), 9 Seiten
**Rahmen:** Reine Frontend-Analyse. Keine Änderungen an Backend, SQLite, API-Verträgen, Geschäftslogik oder Excel-Export.

---

## A. Executive Summary

**Aktueller Qualitätsstand.** Der Planner-Agent ist funktional weit fortgeschritten und stellenweise handwerklich überdurchschnittlich (Draft-basierte Zell-Editoren, Diff-Vorschau vor jeder Automatik, `useSyncExternalStore`-Pattern gegen Grid-Rebuilds, dokumentierte Bugfixes). Er *wirkt* aber wie ein Prototyp, weil die visuelle und interaktive Schicht nie systematisiert wurde: Es gibt 8 Farb-Tokens, aber **null** Tokens für Abstände, Radien, Schatten, Typografie, Motion und Z-Index. Das Ergebnis sind 77 verschiedene Schriftgrößen, 22 Radien, 77 Schatten-Unikate, ~33 Kartenklassen, 20 Button-Definitionen, 10 Eyebrow-Varianten, 13 Empty-State-Implementierungen und 3 parallele Dialog-Systeme. Jede Seite ist eine eigene visuelle Insel mit eigenem CSS-Namespace.

**Größte visuelle Schwächen.**
1. Vier CSS-Variablen (`--danger`, `--muted-strong`, `--shadow-sm`, `--border-strong`) werden 18× referenziert, sind aber **nirgends definiert** — Löschen-Buttons ohne Rotfärbung, Karten ohne Schatten, Formulare ohne Rahmen. Das System ist stellenweise sichtbar kaputt.
2. Das Light-Theme und das `prefers-color-scheme: dark`-Theme sind toter Code (hartes `data-theme="command"` in `layout.tsx:53`); ~70 Schatten sind auf dem tatsächlichen `#0a0b12`-Hintergrund unsichtbar.
3. Der Dienstplan-Editor übernimmt die Excel-Palette (`#ffff00`, `#00b0f0`, `#ffc000`) als vollflächige Zellfarben und wirkt dadurch exakt wie das, was er ersetzen soll.
4. Inter wird als Schrift deklariert, aber nie geladen — die gesamte Typo-Feinabstimmung (26 Font-Weights in 10er-Schritten) rendert auf den meisten Rechnern nicht.

**Größte UX-Schwächen.**
1. **Datenverlust-Risiken:** Client-Navigation aus dem Dienstplan-Editor verwirft ungespeicherte Änderungen ohne Rückfrage (`beforeunload` greift nur bei Reload); Künstlerplan und Probenplan haben gar keinen Schutz; `ArchiveImportFlow.reset()` verwirft geprüfte Importe per Fehlklick.
2. 5× natives `window.confirm()` neben einer vorhandenen, guten `ConfirmDialog`-Komponente.
3. Kein Toast-System, kein Auto-Dismiss, Feedback-Banner oft außerhalb des Viewports; auf `/gedaechtnis` und im Intelligence-Dialog gibt es nach Mutationen **gar kein** Erfolgs-Feedback.
4. Das Dashboard rendert dieselben Inhalte zwei- bis dreifach untereinander (DashboardCommand + DashboardIntelligenceOverview + eigene Panels).
5. Zustands-ARIA fehlt fast überall (Auswahl/Filter/Tabs nur per Farbe), Dialoge ohne Focus-Trap und Fokus-Rückgabe.

**Größte Performance-Risiken.**
1. 100 % Client-Only-Architektur: alle 9 Seiten `"use client"`, kein Server-Fetching, kein `loading.tsx`/`error.tsx`, kein Code-Splitting (`dynamic()` = 0 Treffer), kein Cache-Layer.
2. AG Grid als `AllCommunityModule` doppelt registriert (Plan-Editor + Künstlerplan) — der volle Grid-Chunk auf zwei Routen.
3. 249 KB CSS global auf jeder Route (16 Stylesheets in `layout.tsx`).
4. Voll-Plan-POST an das Backend nach jeder Zelländerung (Planqualität, 500 ms Debounce, ohne Abbruch) plus Voll-Plan-Klon bei jeder Editor-Öffnung.
5. `refreshCells({force:true})` über das gesamte Grid nach jedem Prüf-Lauf, auch bei unverändertem Ergebnis.

**Wichtigste Chance für ein fertiges Produktgefühl.** Ein zentrales Token- und Komponentensystem (Foundation-Schicht) plus die Ent-Excelung des Editors. ~80 % des „Prototyp-Eindrucks" entsteht durch Streuung, nicht durch fehlende Features: dieselben fünf Bauteile (Karte, Button, Badge, Empty-State, Dialog) existieren je 5–33× in leicht abweichender Form. Wer diese auf je **eine** Implementierung mit Tokens zusammenzieht, verändert den Gesamteindruck jeder Seite gleichzeitig — mit vergleichsweise geringem Risiko, weil Geschäftslogik und Datenflüsse unberührt bleiben.

**Reifegrad-Einordnung:**
- *funktional fertig:* weitgehend ja (Kern-Workflows vollständig, Fehlerbehandlung inhaltlich durchdacht)
- *visuell fertig:* nein (Streuung, kaputte Tokens, Excel-Optik, tote Themes)
- *UX-seitig fertig:* nein (Datenverlust-Lücken, Feedback-Lücken, native Dialoge, A11y)
- *technisch produktionsreif:* eingeschränkt (läuft lokal stabil; Architektur ohne Splitting/Caching, FD-Leak im Supervisor, Hydration-Mismatch im Editor)

---

## B. Scorecard

| Kriterium | Note | Begründung |
|---|---|---|
| Visuelle Qualität | **5/10** | Dunkles Command-Theme mit erkennbarer Absicht (Ambient-Gradients, color-mix, Container-Queries). Aber: 4 kaputte Tokens mit sichtbaren Ausfällen, ~70 unsichtbare Schatten, 22 Radien nebeneinander auf einer Seite (Dashboard: 13/14/15/17px), Inter nie geladen. |
| Eleganz | **4/10** | Einzelne elegante Momente (Editor-Skeleton mit KW-Kontext, Diff-Vorschau). Insgesamt Pixel-Feintuning per Hand (34× `10.5px`, Weights 620–850) statt ruhiger Skala; Excel-Vollfarben im Kernbereich; kein Motion-System. |
| Konsistenz | **3/10** | 33 Kartenklassen, 20 Buttons, 10 Eyebrows, 8 Badge- und 8 Tab-Implementierungen, 3 Dialog-Systeme, 3 Feedback-Modelle, 14 Breakpoints. `team.css` stylet die Sidebar, `archive.css` stylet Team, `dashboard.css` stylet Planungslogik. Wochenwechsel bedeutet auf zwei Schwesterseiten das Gegenteil. |
| Bedienbarkeit | **5/10** | Kern-Workflows funktionieren und sind teils sehr gut abgesichert (Wochenwechsel-Dialog, Kopier-Bilanz). Dagegen: `window.confirm`, verstecktes Löschen (nur im Inaktiv-Tab), Auto-Save-on-blur ohne Ankündigung, unklare Labels („Kann er trotzdem", „↺ Automatik"), globales `busy` friert ganze Seiten ein. |
| Informationsarchitektur | **5/10** | Sidebar-Gliederung (Planung/Verwaltung) ist klar und richtig. Aber: Dashboard-Dreifachredundanz, `/team` vs. `/gedaechtnis` kaum abgrenzbar, 7 Button-Beschriftungen für dasselbe Ziel `/plan-editor`, zwei Wochen-Kontexte unmarkiert gemischt. |
| Dienstplan-Editor | **6/10** | Fachlich der stärkste Bereich: Draft-Editoren, Kandidaten-Gruppen mit Begründungen, Undo/Redo-Doppelstack, Konflikt-Panel, Vorschau-Diffs, manuell-editiert-Schutz. Abzüge: Excel-Optik, Datenverlust bei Client-Navigation, Row-ID-Kollisionen, Fehler≙Warnung nur farblich, kein globales Strg+Z, 2.132-Zeilen-Komponente. |
| Responsive Design | **3/10** | 14 Breakpoints ohne Skala, Sidebar-Responsivität in zwei fremden Dateien mit widersprüchlichen Werten. Grid braucht ≥910 px, `100vh` statt `dvh`, kein Auto-Wechsel auf die (mobil-taugliche!) Tagesansicht. Tablets: Dauer-Horizontalscroll. |
| Accessibility | **3/10** | Nur 16 `:focus-visible`-Regeln bei ~40 interaktiven Komponenten; ~20× `outline: none`, 1 Element komplett ohne Fokus-Indikator; Dialoge ohne Focus-Trap/-Rückgabe; Tagesstatus-Punkte `aria-hidden`; Auswahl/Filter fast überall nur per Farbe. Positiv: PlanningRulesPanel, System-Switch, Editor-Skeleton, ArchiveImportFlow-Felder. |
| Performance | **5/10** | Lokal flüssig; die AG-Grid-Integration ist bewusst optimiert (AP8). Architektur-Ebene aber ungelöst: alles Client, kein Splitting, kein Cache, 249 KB globales CSS, Voll-Plan-Posts, Force-Refreshes, Hydration-Mismatch. Auf schwächeren Rechnern und bei wachsender Datenmenge kippt das. |
| Design-System-Reife | **3/10** | Solide 8-Token-Basis mit 1.136 `var()`-Referenzen und sauberem Theme-Override; `badges.css` als tokenreines Positivbeispiel. Aber: keine Tokens jenseits von Farbe, 419 hartkodierte Farbliterale (davon ~95 mit existierendem Token), 4 undefinierte Tokens, Tailwind installiert und ungenutzt. |
| Wahrgenommene Produktqualität | **4/10** | Erster Eindruck: dunkel, ambitioniert — dann brechen Details: unformatierte Warnboxen (`.status-warning` existiert nicht), native Browser-Dialoge, „Gemini"/„cold_start"/rohe Enums im UI, Next-Starter-SVGs in `public/`, Banner, die nie verschwinden. |
| Produktionsreife | **5/10** | Für den lokalen Einzelplatz-Betrieb nutzbar und robust im Fehlerfall (Teil-Degradation, deutsche Fehlertexte). Nicht produktionsreif im Produktsinn: Datenverlust-Lücken, FD-Leak im Supervisor, kein `error.tsx` (ein Renderfehler reißt die App), toter Code. |

---

## C. Wichtigste Probleme (Top 18)

Legende Schweregrad: **S1** kritisch · **S2** hoch · **S3** mittel

| # | Problem | Betroffen | Datei(en) | Grad |
|---|---|---|---|---|
| C1 | **Datenverlust bei Client-Navigation aus dem Editor.** `beforeunload` (Z. 797–805) greift nicht bei Next-Links; Sidebar-Klick verwirft ungespeicherte Änderungen kommentarlos — obwohl der Wochenwechsel intern korrekt abgesichert ist (Z. 1456–1462). | Dienstplan-Editor | `app/plan-editor/page.tsx` | S1 |
| C2 | **Ungespeicherte Änderungen ohne jeden Schutz** in Künstlerplan (Grid, Z. 526) und Probenplan (Tabelle, Z. 146); `ArchiveImportFlow.reset()` (Z. 435) verwirft geprüfte Importe ohne Rückfrage — der Button steht direkt neben „Im Archiv speichern". | Künstlerplan, Probenplan, Archiv-Import | `app/artist-plan/page.tsx`, `app/rehearsal-plan/page.tsx`, `components/ArchiveImportFlow.tsx` | S1 |
| C3 | **4 undefinierte CSS-Tokens, 18 Referenzen** → Löschen-Buttons nicht rot (`intelligence.css:460`), fehlende Rahmen (`:492`), fehlende Schatten (`system.css:50,153`, `dashboard.css:1277`), verworfene `color-mix`-Deklarationen (`intelligence.css:588`). | global | `app/styles/intelligence.css`, `system.css`, `dashboard.css`, `memory.css` | S1 |
| C4 | **`getRowId`-Kollisionen im Editor:** `rowKey = Kategorie::Zeile` ist nicht eindeutig; Kollision → undefiniertes Grid-Verhalten, geteilte `manuallyEditedCells`-Keys, geteilter Issue-Index. Key wird auch als Merge- und Validierungsschlüssel benutzt. | Dienstplan-Editor | `app/plan-editor/page.tsx:239–242, 1114, 1678`, `lib/planValidation.ts:177` | S1 |
| C5 | **Hydration-Mismatch:** `viewPreferences` liest `localStorage` synchron im State-Initializer; Server rendert `plan-density-compact`, Client evtl. `-large`. Dazu `new Date()` im Renderpfad an ~10 Stellen. | Dienstplan-Editor u. a. | `app/plan-editor/page.tsx:349–352, 1585`, `lib/plan-editor/viewPreferences.ts:28–43`, `components/plan-editor/DayNavigator.tsx:18`, `components/WeekPicker.tsx` | S2 |
| C6 | **Kein Toast-/Feedback-System.** 3 konkurrierende Feedback-Modelle, kein Auto-Dismiss, Banner ohne `aria-live`, oft außerhalb des Viewports (Archiv: Löschbutton unten rechts, Meldung oben links). `/gedaechtnis` + Intelligence-Dialog: gar kein Erfolgs-Feedback. | alle Seiten | `app/*/page.tsx`, `components/EmployeeIntelligenceDialog.tsx` | S2 |
| C7 | **5× `window.confirm()`** trotz vorhandener `ConfirmDialog`-Komponente (die laut eigenem Doc-Kommentar genau dafür gebaut wurde). | Team, Künstlerplan, Probenplan, Archiv, System | `team:221`, `artist-plan:279`, `rehearsal-plan:216`, `archiv:111`, `system:147` | S2 |
| C8 | **Dashboard-Dreifachredundanz:** Planqualität, Signale, letzte Änderungen, Show-Tage und Team-Balance erscheinen je 2–3× untereinander in unterschiedlicher Optik (DashboardCommand + DashboardIntelligenceOverview + Seiten-Panels), inkl. 4 duplizierter Hilfsfunktionen. | Dashboard | `app/dashboard/page.tsx:320,412,414ff`, `components/DashboardCommand.tsx`, `components/DashboardIntelligenceOverview.tsx` | S2 |
| C9 | **Excel-Optik des Editors:** Original-Excel-Palette als vollflächige Zellfarben auf jeder Zelle (`cellStyle` mit `hexToRgba(rowColor, 0.06)`), `cursor: text !important`, maximale Dichte als Default, Ellipsen statt Information. | Dienstplan-Editor | `app/plan-editor/page.tsx:1023–1026`, `lib/categoryColors.ts`, `app/styles/plan-editor.css:1112–1121` | S2 |
| C10 | **Fehler vs. Warnung nur farblich unterscheidbar** (identisches ⚠-Glyph rot/orange); Tagesstatus-Punkte `aria-hidden`; „manuell bearbeitet"-Punkt ohne Legende; Urlaub/Krank und „Frei" visuell identisch (`#fef4c8` für beide). | Dienstplan-Editor | `app/styles/plan-editor.css:926–950`, `components/plan-editor/DayHeaderCell.tsx:47–57`, `lib/categoryColors.ts:5–6` | S2 |
| C11 | **Fokus-Lücken:** ~20 Formularelemente mit `outline: none`; `.plan-density-select select` komplett ohne Fokus-Indikator; `intelligence.css` und `system.css` mit 0 Focus-Regeln; Dialoge ohne Focus-Trap, ohne Fokus-Rückgabe. | global | `app/styles/plan-editor.css:1004`, `intelligence.css`, `components/EmployeeIntelligenceDialog.tsx:135–150`, `components/ConfirmDialog.tsx` | S2 |
| C12 | **100 % Client-Architektur ohne Splitting/Cache:** 9/9 Seiten `"use client"`, 0 Server-Fetches, 0 `dynamic()`, 0 `loading.tsx`/`error.tsx`, kein Cache (getWeeks 3×, TeamIntelligence 2× unabhängig geladen). | alle Seiten | `app/*/page.tsx`, `lib/api.ts` | S2 |
| C13 | **AG Grid vollregistriert, doppelt** (`AllCommunityModule` in 2 Routen) + statisch importierte Dialoge (PlanPreview, PlanIntelligence, EmployeeIntelligence 2×, ArchiveImportFlow). | Bundle | `app/plan-editor/page.tsx:76`, `app/artist-plan/page.tsx:32` | S2 |
| C14 | **Voll-Plan-Netzwerklast im Editor:** `getPlanQuality` mit komplettem Zeilen-Klon nach jeder Zelländerung (500 ms Debounce, kein Abort); `getIntelligentRecommendations` mit Voll-Plan-Klon bei jeder Editor-Öffnung, Effekt an instabiler Objekt-Referenz. | Dienstplan-Editor | `app/plan-editor/page.tsx:496–521, 1000–1007`, `components/PersonCellEditor.tsx:158–172` | S2 |
| C15 | **Archiv schneidet bei 120 Zuweisungen stumm ab** (`slice(0,120)` ohne Hinweis) — auf der Seite, deren Zweck das Prüfen ist. Detailbereich ist zudem ein Sackgassen-Viewer, dessen einzige Aktion „Woche löschen" ist. | Archiv | `app/archiv/page.tsx:320, 359–363` | S2 |
| C16 | **System-Seite verspricht Live-Status, hält ihn nicht:** Poll ruft nur `checkHealth()`, nie `loadDiagnostics()` — „Backend- und Datenbankstatus alle 5 Sekunden" (Label) stimmt nicht; Persistenzfehler des Schalters werden verschluckt. | System | `app/system/page.tsx:127–133, 135–144, 301–302` | S3 |
| C17 | **Sprach-/Begriffschaos:** „Command Center", „Intelligence", „Memory", „Signale", „MA", „T&C", „Gemini", „cold_start", rohe Konfidenz-Enums („low"/„high") und SQLite-`integrity_check`-Output direkt im UI; 7 Beschriftungen für das Ziel `/plan-editor`. | alle Seiten | u. a. `components/DashboardCommand.tsx:168–172`, `app/gedaechtnis/page.tsx:398–400, 579`, `app/system/page.tsx:264` | S3 |
| C18 | **`.status-warning` existiert nicht als globale Klasse** → zwei fachlich wichtige Warnungen auf `/gedaechtnis` (Z. 317, 323) rendern unformatiert. | MA-Gedächtnis | `app/styles/shared-components.css:99–123`, `app/gedaechtnis/page.tsx` | S3 |

Technische Ursache in fast allen Fällen: fehlende gemeinsame Schicht (Tokens, Primitives, Feedback-System, Dialog-System) — jede Seite löst dieselben Probleme lokal und leicht anders.

---

## D. Seitenanalyse

### Dashboard (`app/dashboard/page.tsx`, 642 Z. + DashboardCommand 434 Z. + DashboardIntelligenceOverview 181 Z.)
- **Stärken:** Einziger echter Skeleton des Projekts (mit `role="status"`); Wochenwechsel lässt alte Daten stehen statt zu flackern; Action-Items mit Kontext-Label; saubere `useMemo`-Ableitungen.
- **Schwächen:** Dreifachredundanz (siehe C8); zwei Wochen-Navigationen gleichzeitig; „Command Center"-Block ignoriert das Theme („bewusst immer dunkel") und nutzt Inline-Styles neben eigener CSS-Datei; Badge „0 hoch belastet" erscheint trotzdem in Warnfarbe (`DashboardCommand.tsx:259`).
- **UX:** Wochenwechsel ohne jedes visuelles Feedback (`loading && !insights` ist nach Erstladung nie mehr wahr); Fairness-/Belastungs-Items ohne `href` = tote Enden; Pfeil-Semantik hängt an unge­prüfter Sortier-Annahme von `getWeeks()`.
- **Visuell:** 4 Karten-Radien auf einer Seite (13/14/15/17 px); Heatmap-Status nur als Farbpunkt (`aria-hidden`).
- **Performance:** Effekt-Wasserfall (Weeks → Insights); kein Cache pro Woche; `DashboardInsights` ist der schwerste Response-Typ der App.
- **Maßnahmen:** DashboardCommand und DashboardIntelligenceOverview zu **einem** Modul verschmelzen (eine Quelle pro Information); Wochenwechsel-Ladezustand (Opacity-Dimm + Spinner); Action-Items immer verlinken; Loading als `loading.tsx`.

### Dienstplan-Editor (`app/plan-editor/page.tsx`, 2.132 Z.)
- **Stärken:** Draft-Editoren (nichts wird vor „Übernehmen" geschrieben, Escape verwirft); Kandidaten in 4 Gruppen mit Begründungen und „Warum?"-Aufklappern; Diff-Vorschau vor jeder Automatik; Kopier-Bilanz („x kopiert, y überschrieben"); Schutz manuell bearbeiteter Zellen bei Neugenerierung; Undo/Redo-Doppelstack; `useSyncExternalStore`-Pattern gegen columnDefs-Rebuilds; bester Skeleton der App; nicht-modales Konflikt-Panel, das Prüf-Fehler ehrlich anzeigt.
- **Schwächen:** 1 Komponente, 1.819 Zeilen, **41 useState**; Excel-Optik (C9); Fehler/Warnung nur farblich (C10); Wizard verschwindet nach dem ersten Speichern komplett; Toolbar und Wizard-Schritt 4 bieten dieselben Aktionen mit unterschiedlicher Sicherheit (Wizard generiert **ohne** Vorschau, Toolbar **mit**).
- **UX:** Datenverlust bei Client-Navigation (C1); Strg+Z wird im Tooltip versprochen, funktioniert aber nur bei Grid-Fokus — ausgerechnet in der Tagesplanung mit „Tag leeren" nicht; 240-ms-Klicksperre im PersonCellEditor verschluckt schnelle bewusste Klicks; Konfliktklick wirft Tagesplaner in die Wochenansicht; Kopierfunktionen (5 Einstiege) existieren nur in der Tagesansicht, Textvorschläge (`datalist`) ebenfalls; Statusmeldungen schließen nie.
- **Performance:** ~10 instabile Grid-Props pro Render (u. a. `defaultColDef`-Literal, `getRowId` inline); `refreshCells({force:true})` nach jedem Prüf-Lauf, auch ohne Änderung (Map ist immer neu); `PlanDayView` permanent gemountet mit O(Zeilen×Issues)-Filtern statt des vorhandenen `cellIssueIndex`; Referenzdaten-Reload bei Tab-Fokus invalidiert columnDefs auch bei identischen Daten; Voll-Plan-POSTs (C14); `headerHeight={54}` macht die drei Dichte-Headerhöhen wirkungslos; `lastSavedAt` ist toter State.
- **Mobile:** Grid ≥910 px Mindestbreite, `100vh` statt `dvh`, kein Auto-Switch auf die mobil-taugliche Tagesansicht.
- **Maßnahmen:** siehe Sprint 2 (J) und Abschnitt E (Ent-Excelung).

### Künstlerplan (`app/artist-plan/page.tsx`, 545 Z.)
- **Stärken:** klarer 3-Schritt-Import mit `ReadingProgress` (`role="status"`); Sheet-Erkennung; gemeinsamer Komponentensatz mit Probenplan (untereinander am konsistentesten).
- **Schwächen/UX:** ungeschützte Grid-Änderungen (C2); Wochenwechsel löst die Plan-Verknüpfung still (`id: undefined`) — Gegenteil der Schwesterseite; Löschen doppelt versteckt (Kebab „•••" → nativer confirm) und nur für den geöffneten Plan möglich; Download-Erfolgsmeldung feuert unabhängig vom tatsächlichen Download, `revokeObjectURL` synchron nach `click()` (kann Download abbrechen); AllCommunityModule-Registrierung auch hier; `type="button"` fehlt mehrfach; Verben-Wildwuchs („übernehmen"/„anlegen"/„aktivieren"/„speichern").
- **Maßnahmen:** Dirty-Guard (gemeinsamer Hook mit Editor); Wochenwechsel-Verhalten mit Probenplan vereinheitlichen und mit Dialog erklären; Löschen als Zeilenaktion in `SavedPlanList`; Export über gemeinsame Download-Utility (`setTimeout`-revoke).

### Probenplan (`app/rehearsal-plan/page.tsx`, 467 Z.)
- **Stärken:** echte `<table>`-Semantik; native `type="date"/"time"`; spiegelt den Künstlerplan-Aufbau.
- **Schwächen/UX:** Zeile löschen ohne Bestätigung/Undo (nur `title`, kein `aria-label`); „Nicht im Mitarbeiterpool: …"-Warnung ohne Zuordnungsmöglichkeit (die im ArchiveImportFlow existiert) = totes Ende; Dropzone zeigt beim Sheet-Einlesen keinen Busy-Zustand (`processingSource` wird hier nicht gesetzt — Abweichung zur Schwesterseite); „Gemini" als Vendorname im UI; Wochenwechsel überschreibt still den gespeicherten Plan (behält `id` — Gegenteil des Künstlerplans); 7 Inputs pro Zeile ohne Labels, `<th>` ohne `scope`; Index in React-Keys (Fokus-/Eingabeverlust beim Zeilenlöschen); dreifacher Speicher-Wasserfall (save → refresh → get).
- **Maßnahmen:** ConfirmDialog für Zeilen-Löschen; `aria-label` je Feld (Vorbild: ArchiveImportFlow); „Automatische Texterkennung" statt „Gemini"; Wochenwechsel-Semantik klären; stabile Row-Keys.

### Team (`app/team/page.tsx`, 627 Z.)
- **Stärken:** bester Empty-State der App (differenziert nach Filter); optimistisches Statuswechseln mit Rollback; per-Zeile-Speicherstatus mit `aria-live` und Auto-Reset (einziges selbst-verschwindendes Feedback); Teil-Degradation via `Promise.allSettled`.
- **Schwächen/UX:** Auto-Save-on-blur, dessen einziger Hinweis unter der ganzen Liste steht; stiller Datenverlust bei Save-Fehler (Eingabe wird kommentarlos zurückgesetzt); Karte als `role="button"` mit Inputs/Buttons darin (ungültige ARIA-Verschachtelung, `closest()`-Workaround); Löschen nur im Inaktiv-Tab ohne Erklärung; Voll-Reload nach Anlegen (Liste verschwindet und flackert); jede Namensänderung triggert kompletten Team-Intelligence-Request; Tab-Pattern halb (kein tabpanel/controls/Pfeiltasten); Filter ohne `aria-pressed`; „MA hinzufügen"/„Neuer Mitarbeiter"/„Zum Team hinzufügen" für einen Vorgang.
- **Performance:** `TeamMemberRow` unmemoisiert mit 5 Inline-Callbacks — jeder Such-Tastendruck re-rendert die gesamte Liste (bei 40 Personen = 120 State-Slots).
- **Maßnahmen:** `React.memo` + `useCallback`; expliziter Speichern-Moment oder klar sichtbarer Auto-Save-Hinweis am Feld; Fehlertext an der Zeile statt Banner oben; Karte in Container + separaten Profil-Button trennen; Anlegen mit lokalem Insert statt Voll-Reload.

### MA-Gedächtnis (`app/gedaechtnis/page.tsx`, 608 Z.)
- **Stärken:** inhaltlich exzellente Empty-Texte („Ab etwa 6 Frei-Tagen wird ein Muster erkannt"); Mutationen übernehmen konsequent die Backend-Antwort statt lokalem Nachbau; `<details>` für Sekundäres.
- **Schwächen/UX:** globales `busy` deaktiviert **alle** Buttons der Seite gleichzeitig (wirkt wie ein Bug); null Erfolgs-Feedback; `.status-warning` unformatiert (C18); leere Detailhälfte ohne Empty-State, wenn Pool leer; Show-Entfernen (btn-danger) ohne Rückfrage; „Kann er trotzdem" (umgangssprachlich + männlich gegendert), „↺ Automatik", „wirkt nicht", roher Konfidenz-Enum als Badge-Text; `SHOW_CHOICES` hartkodiert (neue Show = Deploy); Intelligence-Ausfall wird verschluckt → Karten zeigen still 0; jeder Wochentag-Klick lädt den kompletten Team-Overview neu; nutzt fremde CSS-Namespaces (`team-search`, `dashboard-empty`) per Klassennamen-Copy.
- **Maßnahmen:** `busy` pro Aktion statt global; Erfolgs-Feedback (Toast); Konfidenz-Mapping auf Deutsch; Wortlaut-Überarbeitung; Abgrenzung zu `/team` schärfen (Gedächtnis = Historie/Muster, Team = Stammdaten) oder mittelfristig zusammenführen.

### Planungslogik (`app/planning-logic/page.tsx`, 73 Z.)
- **Stärken:** einzige Seite mit `role="status"`/`role="alert"` an Load/Error; `PlanningRulesPanel` ist die zugänglichste Komponente des Projekts (aria-expanded/controls, `hidden`, aria-pressed, Filter-Reset im Empty-State).
- **Schwächen:** kein Retry im Fehlerfall (Seite dann tot); Zählweise doppelt (KPI-Zeile + Panel-Filter, unterschiedliche Reihenfolge); Header-Text doppelt; `defaultOpen` macht den Toggle zur Falle (einziger Seiteninhalt lässt sich wegklappen); reine Read-only-Seite ohne Bezug zur konkreten Woche.
- **Maßnahmen:** Retry-Button; Panel auf dieser Seite ohne Collapse rendern; KPI und Filter zusammenführen; Link „Auswirkung im Plan ansehen".

### Archiv (`app/archiv/page.tsx`, 370 Z. + ArchiveImportFlow 447 Z.)
- **Stärken:** sehr gute Empty-Texte; getrennte Fehlerbehandlung beim Import („archiviert, aber Vorschau fehlgeschlagen"); Detail-Cache pro Woche; ArchiveImportFlow mit vorbildlichen `aria-label`s und exzellenter Mikrocopy („Erst nach deiner Prüfung landet er dauerhaft im Archiv").
- **Schwächen/UX:** `slice(0,120)` ohne Hinweis (C15); Detailbereich ohne Weiterverwenden-Aktion trotz gegenteiligem Untertitel; `btn-danger` als prominenteste Aktion; Erfolgsmeldung weit weg von der Aktion; `isGenerated()` rät per Substring „generiert"; Detail-Cache ohne Invalidierung nach Re-Import; Stepper-State hängt am deutschen UI-String (`busyLabel.includes("Archiv")`); Zuordnung rendert Vollliste je Select (60 Personen × 40 Namen = 2.400 Options); `valueKey`-Falle: Tippen in nicht zugeordnete Zeilen ändert `raw_text` und wird nie zur Personenzuweisung, ohne visuellen Unterschied.
- **Maßnahmen:** „… und n weitere anzeigen"; Aktionen „Im Editor öffnen"/„Als Vorlage" ergänzen (Verlinkung auf bestehende Editor-Funktion „archivierte Wochen erneut öffnen"); Quelle als explizites Feld statt Substring; Import-Flow-State bei Schließen mit Rückfrage sichern.

### System (`app/system/page.tsx`, 388 Z.)
- **Stärken:** beste State-Disziplin des Projekts; dreiwertiger Health-State mit ausformulierten Texten; `aria-live` am Banner; `<dl>`/`<ul>`-Semantik; der einzige korrekt implementierte Switch (`role="switch"` + `aria-checked`); Restart-Flow mit klaren Phasen und Handlungsanweisung im Fehlerfall.
- **Schwächen:** Auto-Refresh-Versprechen falsch (C16); Persistenzfehler des Schalters still; „Oberfläche neu laden" optisch fast identisch neben „Backend neu starten"; Restart-Warteschleife bis 16 s ohne Fortschritt/Abbruch und ohne Unmount-Guard; Diagnose-Panels verschwinden bei `null` komplett; SQLite-Output ungefiltert; Poll läuft im Hintergrund-Tab weiter; `/control/backend/status`-Route ist toter Code; Health-Poll ohne `visibilitychange`-Guard.
- **Maßnahmen:** Poll auch `loadDiagnostics()` ausführen lassen oder Text korrigieren; `mountedRef`; Visibility-Guard; Fehlerdifferenzierung „nicht prüfbar" vs. „fehlt".

---

## E. Designrichtung: „Quiet Command"

Ziel: hochwertig, ruhig, präzise, dunkel — ein Werkzeug für tägliche Arbeit, kein Dashboard-Showcase. Die vorhandene Command-Basis (`#0a0b12`/`#12141f`/`#171a28`, Indigo `#7c8bff`, `--cmd-violet #8b7cff`) ist der richtige Ausgangspunkt und wird systematisiert statt ersetzt.

**Farben.**
- Basis: die bestehende Anthrazit-Rampe als **einzige** Neutral-Rampe (aktuell 18 Grauwerte, 3 Rampen → 1 Rampe à 6 Stufen: `#0a0b12`, `#101321`, `#12141f`, `#171a28`, `#1d2133`, Border-Alpha einheitlich).
- Primärakzent: **helles Lila** — `--accent: #9a8cff` (aus `--cmd-violet #8b7cff` aufgehellt für AA-Kontrast auf `#12141f`), abgeleitete Stufen ausschließlich per `color-mix` (`--accent-soft`, `--accent-strong`), nie als neue Hex-Werte. Der bisherige Indigo-Doppelgänger (`#7c8bff` vs. `#8b7cff` vs. Tippfehler `#8c7cff` in `system.css:371`) wird auf einen Wert kollabiert.
- Status: exakt 3 semantische Farben + je eine `-strong`-Stufe (`--status-positive/warning/critical`), Cyan `#3ee0d0` bleibt als positiver Zustand erhalten (differenziert gut vom Lila). Die 8 Grün-, 11 Amber- und 6 Rottöne werden darauf abgebildet.
- Kategoriefarben (`category-colors.css`) bleiben fachlich erhalten (Excel-Wiedererkennung), werden aber im Editor **nur noch als Kanten/Akzente** verwendet, nie mehr als Fläche (siehe unten). Der Export bleibt unberührt.

**Typografie.**
- Inter Variable **tatsächlich laden** (self-hosted via `next/font/local` oder `next/font/google`, `display: swap`) — sonst bleibt jede Weight-Nuance Theorie.
- Skala: 9 Größen (`--fs-2xs` 10px … `--fs-3xl` 32px) statt 77; 5 Weights (400/550/650/750/850) statt 26; 3 Line-Heights. Eine `h1`–`h3`-Definition global in `foundation.css`, Seiten übersteuern nicht mehr (aktuell 9 verschiedene `h2`).
- Tabellenzahlen: `font-variant-numeric: tabular-nums` für KPI und Grid.

**Materialsystem (Layer).** 4 klar benannte Ebenen statt impliziter Streuung:
1. `--layer-canvas` — Seitenhintergrund inkl. der bestehenden zwei Ambient-Radialgradients (beibehalten, sie geben Tiefe ohne Animation).
2. `--layer-surface` — Karten/Panels: opak, `--radius-lg` (16px), 1px-Border, **ein** Schatten-Token.
3. `--layer-raised` — Inputs, Hover-Flächen: `--surface-2`.
4. `--layer-overlay` — Glass (siehe unten).

**Glass-System.** Kontrolliert und nur auf Overlay-/Navigations-Ebene:
- **Einsetzen:** Sidebar (halbtransparenter Sockel über dem Canvas-Gradient), sticky Editor-Toolbar (dann aber mit *transparentem* Hintergrund — aktuell ist `blur(8px)` über deckendem `--surface-2` wirkungsloser Renderaufwand, `plan-editor.css:406–420`), Dialoge/Popovers (WeekPicker, Kebab-Menüs), Kopier-Panel, Befehlsflächen.
- **Nicht einsetzen:** AG-Grid-Zellen, Tabellenkörper, lange Formulare, Archiv-/Teamlisten.
- Tokens: `--glass-bg: color-mix(in srgb, var(--surface) 72%, transparent)`, `--glass-blur: 12px` (Dialoge) / `8px` (Toolbar/Popover), `--glass-edge: inset 0 1px 0 rgb(255 255 255 / 0.06)` (Lichtkante oben), `--backdrop: color-mix(in srgb, #050713 68%, transparent)`. Ein Backdrop-Wert statt aktuell drei (10px/`#050713 70%` vs. 5px/`rgba(8,8,18,.58)` vs. ohne Blur).
- Fallback: `@supports not (backdrop-filter: blur(1px))` → opakes `--surface` (aktuell existiert kein einziger `@supports`-Block).
- Kontrast-Regel: Text auf Glass ausschließlich `--foreground`/`--muted`; keine Glass-Fläche unter 4.5:1.

**Karten.** Eine `.card`-Primitive (+ `.card--interactive` mit einheitlichem Hover: `translateY(-1px)`, ein Schatten-Token, ein `color-mix`-Border-Wert) ersetzt die 4 kopierten Hover-Lift-Karten und 5 Statistik-Kacheln. Radius einheitlich `--radius-lg`; KPI-Kacheln `--radius-md`.

**Navigation.** Sidebar behält Struktur und Icon-Stil (24px-Stroke-SVGs sind gut — nur `LogicIcon` ist ein Unicode-Glyph `⌁` statt SVG und fällt aus der Reihe, `Sidebar.tsx:192–194`). Aktiv-Zustand: bestehende Inset-Ring-Lösung aus `command-theme.css:91–95` wird der Standard; dazu eine 2px-Akzentschiene links mit 150ms-Transition. Collapsed-Zustand ohne Layout-Shift (Initialwert per Inline-Script vor Paint statt `useEffect`).

**Tabellen.** Ruhig: nur horizontale Trennlinien, Zebra optional, Header `--muted`/uppercase/`--fs-2xs`, Zeilen-Hover `--accent-soft` bei 30 %. Der Editor bekommt: neutrale Zellflächen, Kategoriefarbe als 3px-Schiene nur in der Abschnittsspalte + Gruppen-Band (existiert bereits), Namen als Chips (`+n`-Overflow), Standard-Dichte als Default, unterschiedliche Glyphen für Fehler (●/!) und Warnung (▲), sichtbare Legende, `+`-Affordanz auf leeren Zellen bei Hover, `cursor: pointer` statt `text`.

**Dialoge.** Ein System: `GlassDialog` (Portal, Focus-Trap, Fokus-Rückgabe, Escape, `--backdrop`, `--radius-xl`, ein Enter-Motion 180ms translateY(8px)+fade). ConfirmDialog wird darauf aufgesetzt und ersetzt alle 5 `window.confirm`.

**Animationen.** Siehe Motion-Language unten (Abschnitt H der Roadmap nutzt die Tokens `--dur-fast 140ms`, `--dur-base 180ms`, `--dur-slow 240ms`, `--ease-out: cubic-bezier(0.22,1,0.36,1)` — die bereits de facto verwendete Kurve).

**Motion-Language (Kurzfassung).**
- Navigation/Sidebar-Aktiv: 150ms Farb-/Ring-Transition, keine Bewegung.
- Seitenwechsel: bestehendes `route-enter` (240ms Fade + 6px) beibehalten — es ist bereits korrekt ohne transform gelöst.
- Dialoge/Popovers: 160–180ms Fade + 8px translateY, Exit 120ms; Dropdowns identisch.
- Buttons: 140ms Hintergrund/Border; `:active` mit `translateY(0)`/`scale(0.98)` — flächendeckend statt nur 3 Stellen.
- Statusänderungen: Farb-Crossfade 180ms; Erfolgs-Toast slide-in 200ms, Auto-Dismiss 4s.
- Ladezustände: bestehender Shimmer, aber **ein** Keyframe statt zwei Duplikaten; bei `prefers-reduced-motion` statische Alternative statt eingefrorenem Spinner (der globale Reduced-Motion-Reset friert aktuell `.spinner` nach einem Umlauf ein und liegt zudem in `planning-workflow.css:2136` statt `foundation.css`).
- Verboten: Dauer-Pulse (`cmd-pulse` läuft unbegrenzt), Glows, Skalierungen > 2 %, Animationen pro Tabellenzelle, transform in Route-Transition (dokumentierter Bug).

**Datenvisualisierung.** Balken/Ringe (Workload, Qualität) einheitlich: Track `--surface-2`, Fill `--accent` bzw. Statusfarbe, 999px-Radius, Wert immer als Text daneben (nie nur Balken), `aria-hidden` am Balken + Zahl im Fließtext (heute schon meist korrekt).

**Icon-Stil.** Beibehalten: inline SVG, 24er-ViewBox, `stroke-width: 2`, `currentColor`. Konsolidieren: `SystemGlyph`-Bibliothek (`system/page.tsx:22–35`) und Sidebar-Icons in eine gemeinsame `components/icons.tsx`; `⌁`-Unicode ersetzen; Logo-Gradient nur noch an einer Stelle definieren (aktuell identisch in `sidebar.css:55` und `app/icon.tsx:23`).

---

## F. Komponenten-Mapping

| Bestehende Komponente/Klasse | Problem | Maßnahme | Neue Zielkomponente |
|---|---|---|---|
| `.panel`, `.stat-card`, 33 `*card*`-Klassen | 5 Radien, 4 Hover-Varianten, Copy-Paste über 8 Dateien | vereinheitlichen | `Card` / `.card` + `.card--interactive`, `MetricCard` |
| `.btn`-Familie + 13 Ad-hoc-Buttons (`.archive-close-button`, `.team-delete-button`, `.pwa-install-button`, …) | umgehen das Button-System; `.btn-danger` = nur Textfarbe | auf `.btn`-Modifier reduzieren | `Button` (primary/secondary/danger/ghost/icon) |
| `ConfirmDialog` | gut, aber nur im Editor genutzt; kein Focus-Trap, kein Portal, hartkodierte IDs | erweitern + überall einsetzen | `ConfirmDialog` auf `GlassDialog`-Basis |
| `EmployeeIntelligenceDialog` | kein Focus-Trap/-Rückgabe, DOM-Manipulation für Scroll-Lock, Loading-Flash nach Mutation, 1-Zeilen-Subkomponenten | aufteilen + auf Dialog-Basis stellen | `GlassDialog` + `SkillCard`/`MemoryCard` als echte Komponenten |
| `.intelligence-backdrop`, `.confirm-dialog-backdrop`, `.plan-preview-backdrop` | 3 Backdrop-Systeme (Blur 10/–/5, 3 Farben, 3 z-Indizes) | ersetzen | ein `--backdrop`-Token + `GlassDialog` |
| 10 Eyebrow-Klassen | keine zwei identisch | vereinheitlichen | `.eyebrow` |
| 13 Empty-State-Klassen | 5 konkurrierende Muster | vereinheitlichen | `EmptyState` (Icon, Titel, Text, optionale Aktion) |
| 8 Tab-/Filter-Leisten | halb implementiertes ARIA-Pattern, kein `aria-pressed` | vereinheitlichen | `SegmentedControl` / `Tabs` (mit Pfeiltasten + aria-controls) |
| 8 Badge-Implementierungen | `badges.css` ist tokenrein, Rest nicht | auf `badges.css` konsolidieren | `StatusBadge` |
| `PageHeader` | kein Actions-Slot → 4 Wrapper-Klassen (`dashboard-page-head` …) | erweitern | `PageHeader` mit `actions`-Prop |
| `DashboardCommand` + `DashboardIntelligenceOverview` | inhaltliche Dopplung, 4 duplizierte Helfer, Theme-Ignoranz, Inline-Styles | verschmelzen | ein `DashboardOverview`-Modul |
| `PreparationStatusCard` vs. `ReadinessCard` (dashboard-lokal) | zwei Komponenten für „Schritt bereit/offen" | vereinheitlichen | `PreparationStatusCard` |
| `window.confirm`-Aufrufe (5×) | native, nicht stilisierbar, blockierend | ersetzen | `ConfirmDialog` |
| `.status`-Banner + `Notice` + `error`-String | 3 Feedback-Modelle, kein Auto-Dismiss, kein `aria-live` | ersetzen/ergänzen | `ToastProvider` + `InlineStatus` (mit `role="status"`) |
| `FileDropzone` | Zone nicht fokussierbar, Span-als-Button, kein `aria-live` am Label | erweitern | `FileDropzone` v2 |
| `SavedPlanList` | keine Zeilenaktionen; clientseitige KW-Berechnung | erweitern | `SavedPlanList` mit Aktions-Slot |
| `PersonCellEditor` / `SoftsportCellEditor` | stark, aber 240ms-Klicksperre, instabiler `intelligenceRequest`, Effect ohne Dep-Array | erweitern/fixen | beibehalten |
| `PlanDayView`/`PlanDaySectionCard` | permanent gemountet, Issue-Filter O(n²), unmemoisiert | erweitern | beibehalten + `React.memo`, bedingtes Mounten |
| `app/plan-editor/page.tsx` (2.132 Z., 41 useState) | God-Component | aufteilen | `usePlanData`, `usePlanEditing`, `usePlanHistory`, `usePlanPersistence`, `buildPlanColumnDefs`, `PlanWeekGrid`, `PlanWizard`, `PlanEditorDialogs` |
| `lib/api.ts` rohe fetches (Z. 731/868/934) | umgehen Fehlerbehandlung → „Failed to fetch" statt deutscher Meldung | vereinheitlichen | alles über `request<T>()` |
| `restartBackend()` (`api.ts:923`), `/control/backend/status`-Route, `lastSavedAt`, Starter-SVGs in `public/`, doppelte `archiv.load()` | toter Code | löschen | — |
| Tailwind v4 (installiert, ~5 genutzte Utilities) | Build-Overhead ohne Gegenwert | entscheiden: entfernen **oder** `@theme` auf neue Tokens erweitern und nutzen | — |
| `dashboard-command.css` `.cmd`-Token-Scope | dupliziert 5 Hexwerte aus `command-theme.css` | auf globale Tokens mappen | — |

---

## G. Performance-Audit (priorisiert)

### Kritisch
1. **Kein Code-Splitting; AG Grid vollregistriert (2×).** `app/plan-editor/page.tsx:76`, `app/artist-plan/page.tsx:32`. Gezielte Module (ClientSideRowModel, CustomEditor, TextEditor, UndoRedoEdit, CellStyle, Tooltip, RowStyle) + `next/dynamic` für Grid und alle Dialoge + `experimental.optimizePackageImports`. Erwartung: −40–60 % Grid-Chunk.
2. **Instabiler `intelligenceRequest` + Voll-Plan-Payloads.** `page.tsx:1000–1007` (Klon je Editor-Öffnung), `PersonCellEditor.tsx:158–172` (Effect an Objekt-Referenz), `page.tsx:496–521` (`getPlanQuality`-Klon je Änderung, kein Abort). Stabiler Key, kleinere Payloads, `AbortController`.
3. **100 % Client-Architektur ohne loading/error-Segmente.** 9/9 Seiten `"use client"`, 0 Server-Fetches, 0 `loading.tsx`/`error.tsx` — Routenwechsel zeigt nichts, Renderfehler reißt die App. Mindestens Dashboard/Team/Archiv/Planungslogik serverseitig + `loading.tsx` je Route.

### Hoch
4. **249 KB CSS global** (`layout.tsx:3–18`); nur `dashboard-command.css` ist bereits seitenlokal — Muster durchziehen (~30 KB global verbleibend).
5. **`refreshCells({force:true})` nach jedem Prüf-Lauf** (`page.tsx:523–526`, Map immer neu) + 4 weitere Full-Refresh-Stellen (436, 599, 619, 852). Issue-Signatur diffen; auf `{rowNodes, columns}` einschränken (Vorbild existiert in Z. 1633).
6. **API-Client ohne Timeout/Abort/Retry** (`lib/api.ts:16–54`); `active`-Flags verwerfen nur Ergebnisse, Requests laufen weiter; PersonCellEditor-Spinner kann ewig laufen.
7. **Hydration-Mismatch** `viewPreferences` (localStorage im Initializer, `page.tsx:349–352`) + `new Date()` im Renderpfad (10 Stellen).
8. **~10 instabile AG-Grid-Props pro Render** (`defaultColDef`-Literal Z. 1594, `getRowId` inline Z. 1678, 8 Inline-Handler).
9. **Kein Client-Cache:** `getWeeks()` 3×, `getTeamIntelligenceOverview()` 2× unabhängig; nur `archiv/page.tsx:95` cached. TTL-Map in `lib/api.ts` oder Server-Fetch-Cache.
10. **Referenzdaten-Reload invalidiert columnDefs + Validierung auch bei identischen Daten** (Tab-Fokus alle 30 s; `page.tsx:710–719` + Deps 1081–1103). Inhaltsvergleich vor `setState`.
11. **backend-supervisor:** FD-Leak (`logFd` nie geschlossen, `lib/backend-supervisor.ts:61–72`), modulglobaler `trackedChild`, Log ohne Rotation, 500ms-Sleep im Request-Handler.

### Mittel
12. **0× `React.memo` im Projekt**; `TeamMemberRow` (5 Inline-Callbacks, jede Sucheingabe re-rendert alles), Personenliste Gedächtnis, Kandidatenlisten.
13. **`PlanDayView` permanent gemountet** mit O(Zeilen×Issues)-Filtern (`PlanDaySectionCard.tsx:50–52, 99–102`) statt vorhandenem `cellIssueIndex`; bedingt mounten + memoisieren.
14. **Toter/redundanter Code:** `/control/backend/status`-Route (0 Aufrufer, je GET bis 1500 ms Health-Fetch), `restartBackend()`, `xlsxGenerateUrl()`, doppelte `archiv.load()`, Starter-SVGs, `lastSavedAt`.
15. **3 rohe `fetch()`-Aufrufe** umgehen `request()` (`api.ts:731/868/934`) → „Failed to fetch" statt deutscher Meldung.
16. **Schwache Response-Typen:** 4 Typen faktisch `any` (`WeekDetail`, `OverviewStats`, `DepartmentActivity`, `FairnessAlert`); `getMemory()`/`getDashboardInsights()` ohne Pagination/Feldauswahl.
17. **Timer ohne Cleanup:** `team:480`, `plan-editor:549/677`, System-Restart-Schleife ohne Unmount-Guard (`system:172–182`); Health-Poll ohne `visibilitychange`.
18. **`next.config.ts` ohne Optimierungen** (optimizePackageImports, output: standalone, poweredByHeader, Cache-Header für /icons).

### Niedrig
19. `useEffect` ohne Dep-Array (`PersonCellEditor.tsx:252–265`) — Listener-Churn pro Tastendruck.
20. `setTimeout(…,0)`-Hydration-Workarounds (4×) — entfallen mit Server Components.
21. Sidebar-Layout-Shift beim Laden (localStorage erst nach Mount) — Inline-Script vor Paint.
22. `hexToRgba` pro Zell-Repaint ohne Memo (`categoryColors.ts:47–53`).
23. `WeekPicker` registriert Dokument-Listener auch geschlossen (bis zu 6 permanent).
24. `filledCount` ohne `useMemo` (`artist-plan:320`); `headerHeight={54}` schlägt Dichte-CSS.

### Wahrgenommene Performance
**Vorhanden:** 2 gute Skeletons (Editor mit KW-Kontext + `role="status"`; Dashboard), 13 konsistente Spinner mit sprechendem Text, Busy-Disable auf Buttons, lokaler Kandidaten-Fallback vor Backend-Empfehlung (`effectiveCandidates`), Teil-Degradation via `allSettled`.
**Fehlend:** `loading.tsx` (Routenwechsel zeigt *nichts*), Skeletons auf 7 von 9 Seiten, optimistische Updates (0× `useOptimistic`/`useTransition` — jede Mutation blockiert bis zur Antwort, auf `/gedaechtnis` sperrt sie die ganze Seite), Prefetch des Editor-Chunks, Auto-Dismiss von Erfolgsmeldungen.

---

## H. Quick Wins (je ≤ 1 Tag, sofort sichtbare Wirkung)

1. **4 fehlende Tokens definieren** (`--danger`, `--muted-strong`, `--border-strong`, `--shadow-sm` in `foundation.css` + Command-Override) — behebt 18 sichtbare Defekte mit 4 Zeilen.
2. **`.status-warning` global definieren** — repariert die unformatierten Warnungen auf `/gedaechtnis`.
3. **Inter via `next/font` laden** — die gesamte vorhandene Typo-Abstimmung wird erstmals wirksam.
4. **5× `window.confirm` → `ConfirmDialog`** — die Komponente existiert bereits.
5. **Focus-Fixes:** `--shadow-focus`-Token + `:focus-visible` für die 13 Ad-hoc-Buttons; `.plan-density-select` reparieren.
6. **Editor-Blur entfernen** (`plan-editor.css:417`, wirkungslos über deckendem Grund) und die zwei Dialog-Backdrops auf einen Token vereinheitlichen.
7. **Toter Code raus:** Starter-SVGs, status-Route, `restartBackend()`, doppelte `archiv.load()`, `lastSavedAt`.
8. **CSS seitenlokal importieren** statt 16× global — −115 KB pro Route, Muster existiert bereits (dashboard-command.css).
9. **AG-Grid-Module gezielt registrieren** + Registrierung in gemeinsames `lib/ag-grid-setup.ts`.
10. **`defaultColDef`/`getRowId`/Handler stabilisieren** (Modul-Konstante + `useCallback`) — eine Stunde Arbeit, dauerhafter Gewinn.
11. **Fehler-/Warn-Glyphen trennen + Legende** in der Editor-Toolbar (inkl. „manuell bearbeitet"-Punkt).
12. **Erfolgsmeldungen mit Auto-Dismiss + `role="status"`** (Muster von `team`-Zeilenstatus übernehmen, 1800 ms existiert dort schon).
13. **`aria-pressed` auf alle Filter-/Toggle-Buttons** (team, archiv, gedaechtnis, dashboard-Filter).
14. **„Gemini" → „automatische Texterkennung"**, Konfidenz-Enums übersetzen, `integrity_check` mappen.
15. **`reduced-motion`-Block nach `foundation.css`** verschieben, redundante Teilblöcke löschen, Spinner-Ausnahme ergänzen.

## I. Strukturelle Verbesserungen

1. **Token-System vollständig** (Spacing 7 Stufen, Radius 6, Schatten 4+Focus, Typo 9+5+3, Motion 3+2, Z-Index 6, Breakpoints 4: 520/760/1080/1320) + mechanische Migration der 419 Farbliterale (~180 sofort ersetzbar).
2. **Primitive-Schicht** (`Card`, `Button`, `StatusBadge`, `EmptyState`, `SegmentedControl`, `GlassDialog`, `ToastProvider`, `PageHeader` mit Actions-Slot) und Rückbau der 33/20/13/8er-Duplikate; CSS-Datei-Hygiene (Sidebar-Regeln aus `team.css`/`planning-workflow.css` zurückführen).
3. **Plan-Editor-Zerlegung** in die unter F genannten Hooks/Komponenten; `page.tsx` → 200–300 Zeilen Komposition. Verhalten unverändert (Undo-Stacks, Merge-Schutz, Draft-Editoren bleiben).
4. **Navigations-Guard-System:** gemeinsamer `useUnsavedChangesGuard` (PendingAction-Mechanik aus dem Editor generalisieren) für Editor, Künstlerplan, Probenplan, ArchiveImportFlow.
5. **Server-Component-Migration** für Dashboard, Team, Archiv, Planungslogik (+ `loading.tsx`/`error.tsx` je Route); interaktive Inseln bleiben Client.
6. **Stabile Row-IDs** für den Editor (beim Laden vergeben, überall statt `rowKey`) — Voraussetzung für verlässliches Grid-Verhalten.
7. **Dashboard-Konsolidierung:** ein Overview-Modul, eine Quelle pro Information.
8. **Responsive-Konzept:** unter 900 px startet der Editor in der Tagesansicht (Grid ungemountet), `dvh` statt `vh`; Tabellen-Seiten bekommen definierte Stack-Layouts statt geschrumpfter Desktop-Ansichten; Team/Archiv als Karten-Stack, Master-Detail als Sheet.
9. **Backend-Supervisor härten** (FD schließen, PID-Datei, Log-Rotation) — Frontend-seitig, kein Backend-Eingriff.

---

## J. Priorisierte Roadmap

### Sprint 1 — Product Finish Foundation
**Ziel:** Eine gemeinsame visuelle Sprache; jede Seite sieht danach automatisch aufgeräumter aus.
**Aufgaben:** Quick Wins 1–3, 6, 15; Token-System (I.1); Inter laden; Light-Theme-Entscheidung (tote Schemata entfernen oder Toggle bauen — Empfehlung: entfernen); `Button`/`Card`/`StatusBadge`/`EmptyState`/`eyebrow`-Primitives; PageHeader-Actions-Slot; Sidebar-Politur (Aktiv-Zustand, Shift-freier Initialzustand, `⌁`-Icon ersetzen); CSS-Hygiene (Datei-Grenzverletzungen); Tailwind-Entscheidung.
**Dateien:** `foundation.css`, `command-theme.css`, `shared-components.css`, `sidebar.css`, `layout.tsx`, `PageHeader.tsx`, `Sidebar.tsx`, alle Seiten-CSS mechanisch.
**Wirkung:** Konsistenz 3→7, wahrgenommene Qualität deutlich; Basis für alles Weitere.
**Risiken:** breite mechanische Ersetzungen → visuelle Regressionen. **Abnahme:** 0 undefinierte Tokens; ≤ 12 Schriftgrößen, ≤ 6 Radien, ≤ 5 Schatten im Code; Inter rendert nachweislich; alle Buttons auf `.btn`-Basis; Screenshot-Abgleich aller 9 Seiten.

### Sprint 2 — Dienstplan-Editor
**Ziel:** Der Editor wirkt wie ein modernes Planungswerkzeug, bleibt aber mindestens so schnell bedienbar.
**Aufgaben:** Ent-Excelung (neutrale Zellen, Kategorie-Kanten, Chips, Standard-Dichte, Glyphen-Trennung, Legende, Leer-Affordanz, Cursor); Navigations-Guard (C1); stabile Row-IDs (C4); Hydration-Fix `viewPreferences`; Grid-Props stabilisieren; `refreshCells`-Diffing; globales Strg+Z; Toolbar konsolidieren (eine Aktionsquelle, Wizard-Schritt-4-Buttons entfernen); Wizard bleibt als kompakte Fortschrittsleiste sichtbar; 240ms-Klicksperre ersetzen (event.detail); `getPlanQuality` 1500ms + Abort; Editor-Chunk via `dynamic()`.
**Dateien:** `app/plan-editor/page.tsx`, `components/plan-editor/*`, `PersonCellEditor.tsx`, `plan-editor.css`, `lib/plan-editor/*`.
**Wirkung:** Kern-Screen der App springt von „Excel im Browser" zu Produkt; Editor-Score 6→8.
**Risiken:** Chips-Renderer vs. Zeilenhöhe; Undo-Stacks bei Refactoring. **Abnahme:** kein Datenverlust bei Sidebar-Navigation (manueller Test); Excel-Export byte-identisch zu vorher; Undo/Redo in beiden Ansichten; Zellöffnung < 100 ms; Lighthouse-A11y des Editors ≥ 90.

### Sprint 3 — Kernseiten
**Ziel:** Jede Seite folgt demselben Muster (Header, Karten, Zustände, Feedback).
**Aufgaben:** Dashboard-Konsolidierung (C8) + Wochenwechsel-Feedback; Team (memo, Auto-Save-Kommunikation, Fehler an der Zeile, Karte/Button-Trennung, Löschen erklärt); Gedächtnis (busy pro Aktion, Erfolgs-Feedback, Wortlaut, Konfidenz-Mapping, Empty-Detail); Künstler-/Probenplan (Dirty-Guards, Wochenwechsel-Semantik vereinheitlicht + erklärt, ConfirmDialog, Dropzone-Busy-Fix, Feld-Labels, Zeilen-Löschen-Bestätigung); Archiv (slice-Hinweis, Weiterverwenden-Aktionen, Cache-Invalidierung, Stepper-Fix); SegmentedControl überall.
**Dateien:** die 6 Seiten + `DashboardCommand`/`-IntelligenceOverview` (Merge), `ArchiveImportFlow.tsx`, `SavedPlanList.tsx`.
**Wirkung:** IA 5→7, Bedienbarkeit 5→7.
**Risiken:** Dashboard-Merge berührt viele Datenpfade. **Abnahme:** keine Information doppelt auf dem Dashboard; alle destruktiven Aktionen mit ConfirmDialog; alle Seiten mit `EmptyState`-Primitive; Wochenwechsel-Semantik auf beiden Planseiten identisch dokumentiert.

### Sprint 4 — Product Polish
**Ziel:** Zustände, Motion, Responsive, A11y vollständig.
**Aufgaben:** `GlassDialog`-System (Portal, Focus-Trap, Rückgabe, ein Backdrop) + Migration beider Dialoge; `ToastProvider` + Auto-Dismiss + `aria-live`; `loading.tsx`/`error.tsx` je Route + Skeletons für die 7 Seiten ohne; Motion-Tokens anwenden (`:active` flächendeckend, Dialog-/Popover-Enter, reduced-motion-Alternative); Responsive-Konzept (I.8); ARIA-Runde (Tabs mit Pfeiltasten, `aria-pressed`, Tabellen-Scope, Feld-Labels Probenplan, `role="button"`-Karte Team); Touch-Ziele ≥ 40px.
**Dateien:** `components/*Dialog*`, neues `components/ui/`, alle `app/*/`-Segmente, betroffene CSS.
**Wirkung:** A11y 3→7, Responsive 3→6, „fertig"-Gefühl in den Details.
**Risiken:** Focus-Trap-Kanten mit AG-Grid-Popups. **Abnahme:** axe-Scan ohne Criticals auf allen Seiten; kompletter Editor-Durchlauf nur mit Tastatur möglich; Dialog-Fokus-Zyklus verifiziert; alle Mutationen erzeugen wahrnehmbares Feedback.

### Sprint 5 — Performance & QS
**Ziel:** Messbare und wahrgenommene Performance, abgesichert.
**Aufgaben:** Server-Components-Migration (I.5); CSS-Split (H.8, falls nicht früher); Cache-Layer (TTL + In-Flight-Dedupe in `lib/api.ts`); `AbortController`/Timeout in `request()`; rohe fetches vereinheitlichen; `React.memo`-Runde; PlanDayView bedingt mounten; Supervisor-Härtung; `next.config`-Optimierungen; toter Code final; Bundle-Analyse; Vitest-Tests für `planValidation`, `recommendations`, Guard-Hook, Toast; visueller Regressionslauf.
**Dateien:** `lib/api.ts`, `lib/backend-supervisor.ts`, `next.config.ts`, Seiten, `package.json`.
**Wirkung:** Initial-JS −40 %+, CSS/Route −80 %, keine hängenden Spinner, stabil auf schwachen Rechnern.
**Risiken:** Server-Migration ändert Datenfluss-Timing. **Abnahme:** Bundle-Report dokumentiert; Route-CSS ≤ 60 KB; kein Request ohne Timeout; 0 bekannte Leaks; alle Tests grün; Editor-Interaktionsbudget (Zell-Commit < 50 ms Main-Thread bei 40 Zeilen) gemessen.

---

## K. Top-10-Maßnahmen (größter Hebel)

1. **Token-System + kaputte Tokens fixen** — verändert jede Seite gleichzeitig; behebt sichtbare Defekte sofort.
2. **Editor ent-excel-n** (neutrale Flächen, Kategorie-Kanten, Chips, Glyphen, Legende) — der meistgesehene Screen definiert das Produktgefühl.
3. **Navigations-Guards gegen Datenverlust** (Editor, Künstlerplan, Probenplan, Import) — Vertrauen ist Produktqualität.
4. **Ein Dialog-System** (GlassDialog + ConfirmDialog überall, keine `window.confirm`) — größter Einzelbeitrag zur „aus einem Guss"-Wahrnehmung.
5. **Toast-/Feedback-System mit Auto-Dismiss und `aria-live`** — jede Aktion bekommt eine wahrnehmbare Antwort.
6. **Primitive-Schicht (Card/Button/Badge/EmptyState/SegmentedControl)** — löst 100+ Duplikate auf und macht künftige Änderungen einwertig.
7. **Inter laden + globale Typo-Hierarchie** — Präzision wird erstmals sichtbar; 9 h2-Varianten → 1.
8. **AG-Grid-Module gezielt + `dynamic()` + CSS-Split** — größter messbarer Performance-Sprung mit geringem Risiko.
9. **Dashboard-Konsolidierung** — aus drei konkurrierenden Ansichten wird eine ruhige, glaubwürdige Übersicht.
10. **Focus-/ARIA-Grundausstattung** (Focus-Ring-Token, aria-pressed, Focus-Trap, Glyphen statt Nur-Farbe) — professionelle Software erkennt man an der Tastatur.

---

## Anhang: Positivliste (erhalten und als Vorbild nutzen)

- `lib/plan-editor/useGridDayIndicators.ts` (useSyncExternalStore-Pattern), `useThrottledFocusReload.ts` (Throttle + In-Flight + Visibility)
- Draft-Semantik der Zell-Editoren; `PlanPreviewDialog` + `diffPlanRows`; `CopyPanel` + `computeCopyStats`; Schutz manuell bearbeiteter Zellen
- `validatePlanSafe` + ehrliche Prüf-Fehleranzeige im `PlanIssuesPanel`
- `PlanningRulesPanel` (A11y-Referenz), System-Switch (`role="switch"`), Editor-Initial-Skeleton, `ArchiveImportFlow`-Feld-Labels und Mikrocopy
- `pwa-install-button.tsx` (useSyncExternalStore, SSR-sicher), `badges.css` (tokenrein), `color-mix`-Nutzung (~90 Stellen), Container-Queries (system, plan-editor)
- Teil-Degradation via `Promise.allSettled` (team, gedaechtnis); durchgängig deutsche, handlungsleitende Fehlertexte in `lib/api.ts`
- Dokumentierte Bugfixes (`foundation.css:71–77` Route-Transition/Containing-Block; AP8-Doku)
