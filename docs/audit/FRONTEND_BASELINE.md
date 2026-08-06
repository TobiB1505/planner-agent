# Frontend-Baseline (Sprint 0)

Ausgangsbasis für Sprint 1. Stand: Branch `design-overhaul`, nach Abschluss der Sprint-0-Fixes.

## 1. Build- und Qualitätsstatus

Alle Befehle wie im Repository definiert ausgeführt (keine erfundenen Skripte).

| Prüfung | Befehl | Ergebnis |
|---|---|---|
| Frontend-Dependencies | `npm install` (bereits vorhanden, nicht neu ausgeführt — `node_modules` vorhanden) | — |
| TypeScript | `npx tsc --noEmit -p tsconfig.json` | ✅ 0 Fehler |
| Lint | `npm run lint` (eslint) | ✅ 0 Fehler, 0 Warnungen |
| Frontend-Tests | `npm run test` (vitest run) | ✅ 2 Testdateien, 15 Tests, alle grün |
| Frontend-Build | `npm run build` (next build, Turbopack) | ✅ Erfolgreich. 1 vorbestehende Warnung: `./control/backend/status/route.ts` triggert eine Turbopack-NFT-Tracing-Warnung wegen `fs`-Operationen in `lib/backend-supervisor.ts` — deckt sich mit dem Audit-Finding „tote Route" (Abschnitt F/I.14), nicht in Sprint 0 entfernt (kein S1-Bezug). |
| Backend-Tests | `venv/bin/python -m pytest` (Repo-Root, `pytest.ini` → `backend/tests`) | ✅ 240 Tests, alle grün. Nur Umgebungswarnungen (Python 3.9 End-of-Life, `google-auth`/`pydantic`-Deprecations), keine mit Bezug zu diesem Sprint. |

**Neu verursachte Fehler durch Sprint-0-Änderungen: keine.** Alle vier Prüfungen liefen auch vor den Änderungen bereits grün (kein neuer Fehlerzustand eingeführt, per Zwischenständen während der Implementierung wiederholt verifiziert).

## 2. Frontend-Routen

| Route | Datei | Zweck |
|---|---|---|
| `/` | `app/page.tsx` | Redirect/Einstieg (leitet auf Dashboard) |
| `/dashboard` | `app/dashboard/page.tsx` | Planungsstand, Command-Center-Übersicht, Handlungsbedarf |
| `/plan-editor` | `app/plan-editor/page.tsx` (+ `components/`, `hooks/`, `utils/`, `types.ts` im selben Verzeichnis) | Dienstplan erstellen/bearbeiten (Wochenübersicht als AG-Grid + Tagesplanung) |
| `/artist-plan` | `app/artist-plan/page.tsx` | Künstlerplan importieren/bearbeiten (AG-Grid) |
| `/rehearsal-plan` | `app/rehearsal-plan/page.tsx` | Probenplan importieren/bearbeiten (HTML-`<table>`) |
| `/team` | `app/team/page.tsx` | Mitarbeiterverwaltung, Team-Intelligence-Übersicht |
| `/gedaechtnis` | `app/gedaechtnis/page.tsx` | MA-Gedächtnis (Historie/Muster pro Mitarbeiter) |
| `/planning-logic` | `app/planning-logic/page.tsx` | Read-only Anzeige der aktiven Planungsregeln |
| `/archiv` | `app/archiv/page.tsx` (+ `components/ArchiveImportFlow.tsx`) | Archivierte Dienstpläne, Alt-Plan-Import |
| `/system` | `app/system/page.tsx` | Backend-Status, Diagnose, Systemaktionen |
| `/control/backend/status`, `/control/backend/restart` | `app/control/backend/*/route.ts` | Interne API-Routen für den Backend-Supervisor (`status` laut Audit ohne Aufrufer — toter Code) |

Alle Seiten sind `"use client"` (100 % Client-Architektur, Audit-Finding C12, weiterhin `OPEN`). Kein `loading.tsx`/`error.tsx` in irgendeiner Route.

## 3. Wichtigste Komponenten pro Route

- **Dashboard:** `DashboardCommand`, `DashboardIntelligenceOverview`, `PreparationStatusCard` (Redundanz, C8, `OPEN`)
- **Plan-Editor:** `components/PlanGrid.tsx`, `PlanWizardSteps.tsx`, `WeekNavigation.tsx`, `EditorDialogs.tsx`; `hooks/usePlanHistory.ts`, `usePlanPersistence.ts`; `components/plan-editor/{PersonCellEditor,SoftsportCellEditor,PlanDayView,PlanDaySectionCard,DayEntryEditor,CopyPanel,DayHeaderCell,DayNavigator,PlanPreviewDialog,PlanIntelligenceDialog}.tsx`
- **Künstlerplan/Probenplan:** `FileDropzone`, `ReadingProgress`, `PlanReviewHeader`, `SavedPlanList`, `WeekPicker`, `ArtistTextCellEditor`
- **Team:** `EmployeeIntelligenceDialog`
- **Archiv:** `ArchiveImportFlow`
- **Global (neu, Sprint 0):** `InternalNavigationGuard` (in `app/layout.tsx` neben `Sidebar`)

## 4. CSS-Struktur

**Global importiert in `app/layout.tsx` (18 Dateien, ~12.300 Zeilen gesamt):**
`globals.css`, `foundation.css` (117), `sidebar.css` (392), `shared-components.css` (584), `planning-workflow.css` (2145), `dashboard.css` (2039), `category-colors.css` (23), `archive.css` (984), `team.css` (1116), `planning-logic.css` (150), `memory.css` (866), `system.css` (511), `plan-editor.css` (2071), `intelligence.css` (758), `badges.css` (119), `command-theme.css` (138).

**Route-lokal (Ausnahme, Vorbildmuster laut Audit):** `dashboard-command.css` (275 Zeilen), importiert nur in `app/dashboard/page.tsx`.

Migration weiterer Dateien auf route-lokale Imports ist unverändert Sprint-1-Scope (H.8) — in Sprint 0 nicht angefasst, da reine Performance-/Struktur-Frage ohne S1-Bezug.

## 5. UI-Primitives (Bestand, siehe auch `UI_COMPONENT_INVENTORY.md`)

`ConfirmDialog` (kein Portal, kein Focus-Trap), `.btn`-Familie (+13 Ad-hoc-Button-Klassen), `.panel`/`.stat-card` (+33 Karten-Varianten), `.status-*`-Banner (jetzt inkl. `.status-warning`, Sprint 0), `.badge-pill`/`.badge-dot` (Sprint einer früheren Session, tokenrein), `PageHeader` (ohne Actions-Slot), `EmptyState`-Muster (13 unterschiedliche Implementierungen, kein gemeinsames Primitive).

## 6. Dialog-Systeme

Drei parallele Ansätze, unverändert seit Audit: `ConfirmDialog`-Komponente (Editor + neu: `ArchiveImportFlow`), 5× natives `window.confirm()` (Archiv, Künstlerplan, Team, System, Probenplan — Liste in `FRONTEND_AUDIT_STATUS.md`, C7), diverse Custom-Popups (`PersonCellEditor`, `SoftsportCellEditor`, `EmployeeIntelligenceDialog` — jeweils eigene Backdrop-/Fokus-Logik ohne gemeinsame Basis).

## 7. Feedback-/Toast-Systeme

Kein zentrales System. Drei Muster nebeneinander: `.status`-Banner (statisch, kein Auto-Dismiss), lokale `Notice`-State-Objekte (`{kind, text}`, pro Seite eigene Variante), per-Zeile-Feedback in `team/page.tsx` (einziges selbst-verschwindendes Feedback, 1800 ms Auto-Reset). `/gedaechtnis` und `EmployeeIntelligenceDialog` haben laut Audit weiterhin kein Erfolgs-Feedback nach Mutationen (nicht verifiziert in Sprint 0, kein S1-Bezug).

## 8. Grid-Systeme

AG Grid Community 36.0.2, `AllCommunityModule` doppelt registriert (`app/plan-editor/page.tsx`, `app/artist-plan/page.tsx`) — unverändert `OPEN` (C13). Gemeinsame `getRowId`/Zeilenidentitäts-Logik jetzt vorhanden für den Plan-Editor (`assignRowIds`, Sprint 0), aber nicht als geteiltes `lib/ag-grid-setup.ts` extrahiert (Audit-Empfehlung H.9, Sprint 1).

## 9. Größere Client-Komponenten (>400 Zeilen)

`app/plan-editor/page.tsx` (1.282, war 2.132 vor dem — separat von Sprint 0 erfolgten — Split), `app/styles/dashboard.css`/`plan-editor.css`/`planning-workflow.css` (>2.000 Zeilen CSS), `app/team/page.tsx` (627), `app/gedaechtnis/page.tsx` (608), `app/artist-plan/page.tsx` (~550), `components/ArchiveImportFlow.tsx` (~480), `app/rehearsal-plan/page.tsx` (~480), `app/archiv/page.tsx` (370).

## 10. Dynamische Imports

`grep -rln "next/dynamic" app components` → **0 Treffer.** Bestätigt unverändert (C12/C13, Sprint-5-Scope: AG-Grid und alle Dialoge werden statisch importiert).

## 11. Bekannte Performance-Hotspots (aus Audit übernommen, in Sprint 0 nicht verifiziert/verändert — kein S1-Bezug)

Voll-Plan-POST nach jeder Zelländerung (`usePlanPersistence.ts`), `refreshCells({force:true})` nach jedem Prüf-Lauf, kein Client-Cache (`getWeeks()` mehrfach unabhängig geladen), 0× `React.memo` im Projekt, `TeamMemberRow` unmemoisiert. Details siehe `FRONTEND_AUDIT.md` Abschnitt G.

## 12. Bekannte Accessibility-Probleme (aus Audit übernommen, in Sprint 0 nicht verändert — Sprint-4-Scope)

~16 `:focus-visible`-Regeln bei ~40 interaktiven Komponenten, `.plan-density-select` ohne Fokus-Indikator, keine Focus-Traps in Dialogen, Tagesstatus-Punkte `aria-hidden`. Positive Ausnahmen unverändert: `PlanningRulesPanel`, System-Switch (`role="switch"`), `ArchiveImportFlow`-Feld-Labels.

## 13. Bekannte responsive Einschränkungen (aus Audit übernommen, unverändert)

Plan-Editor-Grid benötigt ≥910 px, `100vh` statt `dvh`, kein Auto-Wechsel auf die Tagesansicht unter 900 px. 14 uneinheitliche Breakpoints projektweit.

## 14. Manuelle Screenshot-Checkliste (Ersatz für fehlende visuelle Regressionstests)

Kein Playwright/Storybook/Screenshot-Testing im Repository vorhanden (`package.json` enthält nur `vitest`). Keine neue Test-Infrastruktur in Sprint 0 eingeführt (Auftrag: „führe keine große neue Testing-Infrastruktur ein"). Stattdessen reproduzierbare manuelle Checkliste für Sprint 1 als Referenzpunkt:

**Viewports:** Desktop 1280×800, Tablet 768×1024, Mobile 375×812 (Grid-Ansichten ab <910 px nur eingeschränkt nutzbar, siehe oben — dort Tagesansicht statt Wochenübersicht prüfen).

**Zustände pro Ansicht:** Normal (Daten vorhanden), Ladezustand (Reload während `getWeeks()`/`getDashboardInsights()` pending), Fehlerzustand (Backend stoppen und Seite laden), Empty State (z. B. Team-Filter ohne Treffer, Archiv ohne Einträge).

**Zu prüfende Ansichten:** Dashboard; Dienstplan-Editor Wochenansicht; Dienstplan-Editor Tagesansicht; Team; MA-Gedächtnis; Künstlerplan; Probenplan; Archiv; Planungslogik; System; Konflikt-Dialog (`PlanIssuesPanel`); `PersonCellEditor`-Popup; `ConfirmDialog` (z. B. beim Verwerfen ungespeicherter Änderungen, Sprint-0-Feature); Wochenwechsel-Bestätigung im Editor.

Screenshots wurden für diesen Baseline-Stand **nicht** committed (Repo-Größe), da kein Tooling dafür vorhanden ist — die Checkliste selbst ist die Referenz für Sprint 1.
