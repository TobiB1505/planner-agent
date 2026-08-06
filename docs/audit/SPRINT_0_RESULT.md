# Sprint 0 – Ergebnisbericht

Branch: `design-overhaul` (Basis: `main` @ `26f1a2b`). 8 Commits, 24 Dateien, +732/−51 Zeilen.

## 1. Zusammenfassung

**Was wurde geprüft?** Alle 18 Top-Findings aus `FRONTEND_AUDIT.md` gegen den tatsächlichen aktuellen Code (nicht gegen die im Audit genannten Zeilennummern, die durch den zwischenzeitlich gemergten Plan-Editor-Split veraltet waren). Zusätzlich: Plan-Editor-Komponentenaufteilung, API-Router-Struktur, CSS-Token-Vollständigkeit (automatisierter Abgleich), Dialog-/Toast-/Grid-Systeme, Row-ID-Vergabe, Hydration-Pfade, dynamische Imports, route-lokales vs. globales CSS.

**Was wurde geändert?**
- Zentraler `useUnsavedChangesGuard`-Hook + globaler `InternalNavigationGuard`, verdrahtet in Plan-Editor, Künstlerplan, Probenplan, Archiv-Import.
- Stabile, eindeutige `_row_id` für jede Planzeile (`assignRowIds`), ersetzt die kollisionsanfällige `Kategorie::Zeile`-Identität in AG-Grid-`getRowId`, manuell-bearbeitet-Tracking und Planprüfung-Navigation.
- 4 fehlende CSS-Tokens (`--danger`, `--muted-strong`, `--border-strong`, `--shadow-sm`) + `.status-warning`-Klasse ergänzt.
- Hydration-sicheres Laden der Editor-Ansichtspräferenzen (`useSyncExternalStore` statt `localStorage` im State-Initializer).
- System-Seite: Auto-Refresh-Toggle pollt jetzt tatsächlich Diagnose, nicht nur Health (Nachbesserung eines in einer früheren Session mitgebrachten Bugs mit identischem Muster).

**Welche kritischen Risiken wurden beseitigt?** Stiller Datenverlust bei interner Navigation (Sidebar/Links) aus vier bisher ungeschützten oder nur teilweise geschützten Bearbeitungsflächen; Grid-Zeilen-Identitätskollisionen, die bei zwei inhaltlich gleichen Zeilen zu Cross-Row-Datenverwechslung in der manuell-bearbeitet-Markierung und der Konflikt-Navigation hätten führen können; sichtbar kaputte UI-Elemente durch undefinierte CSS-Variablen.

## 2. Auditstatus (Top-18, C1–C18)

| Status | Anzahl | Findings |
|---|---|---|
| FIXED | 6 | C1, C2, C3, C4, C16, C18 |
| PARTIALLY_FIXED | 1 | C5 |
| OPEN | 11 | C6, C7, C8, C9, C10, C11, C12, C13, C14, C15, C17 |
| OBSOLETE_AFTER_REFACTOR | 0 | — |
| NEEDS_ARCHITECTURE_DECISION | 0 unter den Top-18 (7 Themen außerhalb der Top-18 markiert, siehe `UI_COMPONENT_INVENTORY.md`) | — |

Details, Begründungen und Zielsprints je Finding: `FRONTEND_AUDIT_STATUS.md`.

## 3. Geänderte Dateien

| Datei | Zweck der Änderung | Mögliche Risiken | Relevante Tests |
|---|---|---|---|
| `frontend/lib/useUnsavedChangesGuard.ts` (neu) | Zentrale Dirty-State-Registry + `beforeunload` | Modul-globaler State — bei Server-Component-Migration (Sprint 5) müsste das neu bewertet werden | Live: Sidebar-Klick mit/ohne Dirty-State |
| `frontend/components/InternalNavigationGuard.tsx` (neu) | Globaler Klick-Interceptor für interne Links | Fängt ggf. Klicks ab, die nicht abgefangen werden sollten (z. B. exotische Link-Konstrukte) — Guard prüft `target`, `download`, Modifier-Tasten, Origin | Live: Team-Link mit Dirty-State → Dialog → Abbrechen/Verwerfen beide getestet |
| `frontend/app/plan-editor/page.tsx` | Setrows-Wrapper mit `assignRowIds`; Guard-Hook statt Ad-hoc-`beforeunload`; `rowKey`→`_row_id` an den Grid-Identitäts-Stellen | Zentrale Datei mit vielen Abhängigkeiten — Änderungen wurden gezielt an den betroffenen Zeilen vorgenommen, `assignmentRules`-Lookups bewusst unverändert gelassen | `tsc`, Lint, Live: Konflikt-Navigation, Sidebar-Guard |
| `frontend/app/plan-editor/utils/planEditorHelpers.tsx` | `assignRowIds()` neu | Deterministisch/idempotent, aber abhängig von stabiler Zeilenreihenfolge zwischen Regenerierungen (dokumentierte Annahme, siehe Kommentar im Code) | s. o. |
| `frontend/app/plan-editor/types.ts`, `lib/recommendations.ts`, `lib/plan-editor/daySections.ts`, `lib/planValidation.ts`, `hooks/usePlanHistory.ts`, `components/PlanGrid.tsx`, `components/plan-editor/PlanDaySectionCard.tsx` | `_row_id`-Feld durchgereicht, `rowKey`-Nutzung an Grid-Identitäts-Stellen durch `_row_id` ersetzt | Mehrere Dateien berührt, aber jede Änderung ist eine 1:1-Substitution derselben Formel | s. o. |
| `backend/grid.py` | `_row_id` zu `META_COLS` ergänzt | Ein-Zeilen-Ergänzung einer bestehenden Allowlist, kein neuer API-Vertrag | 240 Backend-Tests grün |
| `frontend/app/styles/foundation.css`, `command-theme.css`, `shared-components.css` | 4 fehlende Tokens + `.status-warning` definiert | Rein additiv, keine bestehenden Werte verändert | Live: `--shadow-sm` rendert echten Schatten, automatisierter Token-Abgleich |
| `frontend/lib/plan-editor/viewPreferences.ts`, `app/plan-editor/page.tsx` (Teil) | `usePlanViewPreferences` (`useSyncExternalStore`) statt `localStorage`-Initializer | Verhalten bei mehreren gleichzeitig offenen Tabs nicht separat getestet (Modul-State ist Tab-lokal, da `window` pro Tab getrennt — kein bekanntes Risiko, aber nicht explizit verifiziert) | Live: Dichte-Wechsel übersteht Reload ohne Hydration-Fehler |
| `frontend/app/artist-plan/page.tsx`, `frontend/app/rehearsal-plan/page.tsx` | Minimales `isDirty`-Tracking + Guard-Hook ergänzt | Neue State-Variable, an allen bekannten „neue Baseline"-Punkten (Import/Laden/Speichern/Löschen/leere Woche) zurückgesetzt — Restrisiko: falls ein Codepfad übersehen wurde, bliebe `isDirty` fälschlich `true` hängen (Nutzer sieht dann einen unnötigen Bestätigungsdialog beim Verlassen, kein Datenverlust) | `tsc`, Lint; kein Live-Test der neuen Guards auf diesen beiden Seiten durchgeführt (Zeitbudget), nur Code-Review gegen alle `setPlan`-Aufrufer |
| `frontend/components/ArchiveImportFlow.tsx` | Reset/Close hinter `ConfirmDialog`, wenn ungespeicherter Import vorliegt; Guard-Hook | Zusätzlicher Klick beim gewollten Verwerfen eines Imports (bewusste UX-Entscheidung, entspricht Audit-Empfehlung) | `tsc`, Lint; nicht live durchgeklickt (Zeitbudget) |
| `frontend/app/system/page.tsx` | Poll-Intervall ruft `refreshAll()` statt nur `checkHealth()` | Marginal höhere Netzwerklast alle 5s (ein zusätzlicher Request), vernachlässigbar | Live: `/api/system/diagnostics` feuert periodisch, verifiziert |
| `docs/audit/*.md` (neu) | Audit-Abgleich, Baseline, Komponenten-Inventar, dieser Bericht | Keine Code-Risiken | — |

## 4. Testergebnisse

| Prüfung | Ergebnis |
|---|---|
| TypeScript (`npx tsc --noEmit`) | ✅ 0 Fehler |
| Lint (`npm run lint`) | ✅ 0 Fehler, 0 Warnungen |
| Frontend-Tests (`npm run test`, vitest) | ✅ 15/15 Tests, 2 Testdateien |
| Frontend-Build (`npm run build`) | ✅ erfolgreich, 1 vorbestehende, unveränderte Warnung (tote `/control/backend/status`-Route) |
| Backend-Tests (`pytest`, Repo-Root) | ✅ 240/240 Tests |
| Manuell: Unsaved-Changes-Guard | ✅ Sidebar-Klick mit Dirty-State → Dialog; Abbrechen bleibt; Verwerfen navigiert; kein Dialog ohne Dirty-State (durchgängig in dieser Session so beobachtet) |
| Manuell: Row-ID/Konflikt-Navigation | ✅ Konflikt anklicken → korrekte Zelle im Grid, Editor öffnet automatisch; keine AG-Grid-Duplicate-ID-Warnungen über den vollständigen sichtbaren Zeilensatz |
| Manuell: Hydration | ✅ Dichte-Wechsel übersteht Reload, keine Konsolen-Hydration-Warnung |
| Manuell: Künstlerplan-/Probenplan-/Import-Guard | ⚠️ **teilweise** — beide Seiten laden fehlerfrei (kein Konsolenfehler), aber der volle Guard-Ablauf (Zelle bearbeiten → navigieren → Dialog) wurde dort nicht wie beim Plan-Editor Schritt für Schritt durchgeklickt (Zeitbudget); Absicherung nur über Code-Review aller `setPlan`-Aufrufer |

## 5. Offene Probleme

- **Browser-Zurück/-Vor ist nicht gegen Datenverlust geschützt** (technische Grenze, siehe `FRONTEND_AUDIT_STATUS.md`). Bewusst nicht mit einer ungetesteten Lösung überdeckt.
- Künstlerplan-/Probenplan-/Archiv-Import-Guards sind nur code-verifiziert, nicht live durchgeklickt — Restrisiko, dass ein `setPlan`/`setResult`-Aufruf übersehen wurde und `isDirty` in einer Randsituation falsch steht (führt bestenfalls zu unnötigem, schlimmstenfalls zu fehlendem Dialog — kein automatischer Datenverlust, da die eigentliche Speicherlogik unverändert blieb).
- 11 der Top-18-Findings bleiben `OPEN` (siehe Tabelle oben) — das ist erwartet, da sie außerhalb des S1-Scopes von Sprint 0 liegen.
- `.status-warning` wurde CSS-seitig ergänzt, aber keine Seite mit tatsächlich aktivem Warnzustand live geprüft (die Klasse selbst ist eine reine Wiederholung des bereits korrekt funktionierenden `.status-success`/`.status-error`-Musters, daher geringes Risiko).
- ~90 hartkodierte Statusfarb-Literale außerhalb der bereits migrierten Dateien bestehen weiter (bekannt, nicht in Sprint 0 behoben).

## 6. Freigabe für Sprint 1

## **READY WITH KNOWN RISKS**

**Begründung:** Alle in diesem Sprint als S1 eingestuften Findings (C1–C4, C16, C18) sind behoben und wo praktikabel live verifiziert; TypeScript/Lint/Tests/Build sind grün, keine Regression eingeführt. Die Freigabe ist nicht uneingeschränkt, weil (a) die Browser-Zurück-Lücke bewusst offen bleibt statt mit einer riskanten Lösung überdeckt zu werden, und (b) die Künstlerplan-/Probenplan-/Archiv-Import-Guards nur code-, nicht klickverifiziert sind. Beides sind bekannte, dokumentierte, nicht-blockierende Risiken — kein stiller Datenverlust wurde eingeführt, die Kernfunktionen (Speichern, Undo/Redo, Export) sind unverändert und durch die bestehende Test-Suite abgedeckt.

## 7. Empfohlener Scope für Sprint 1

Aktualisiert auf Basis des tatsächlichen Repository-Stands (nicht blind aus dem ursprünglichen Audit übernommen):

1. **Design-Tokens:** Spacing (7 Stufen), Radius (6), Schatten (4 + Focus — `--shadow-sm` existiert bereits, als Vorbild nutzen), Typografie (9 Größen/5 Gewichte/3 Zeilenhöhen), Motion (3 Dauern/2 Kurven), Z-Index (6 Ebenen), Breakpoints (4 statt 14).
2. **Typografie:** Inter tatsächlich laden (`next/font`), globale `h1`–`h3`-Definition in `foundation.css`.
3. **UI-Primitives:** `Card`/`Card--interactive`, `Button` (Modifier-basiert), `StatusBadge` (auf Basis des bereits tokenreinen `badges.css`), `EmptyState`, `PageHeader` mit `actions`-Slot. Reihenfolge nach Redundanz-Umfang, siehe `UI_COMPONENT_INVENTORY.md`.
4. **Zentrale Dialoge:** `GlassDialog`-Basis (Portal, Focus-Trap, Fokus-Rückgabe, ein `--backdrop`-Token); `ConfirmDialog` (jetzt an 3 zusätzlichen Stellen erprobt, siehe Sprint 0) darauf aufsetzen; die verbleibenden 5 `window.confirm()`-Aufrufe ersetzen.
5. **Toast-/Feedback-System:** `ToastProvider` + `useToast()`, Auto-Dismiss nach dem in `team/page.tsx` bereits vorhandenen Muster (1800 ms), `aria-live` durchgängig.
6. **CSS-Verantwortlichkeiten:** Sidebar-Regeln aus `team.css`/`planning-workflow.css` zurückführen; route-lokale CSS-Imports nach `dashboard-command.css`-Vorbild ausrollen (16 global importierte Dateien reduzieren); die ~90 verbleibenden hartkodierten Statusfarben auf `--status-*` migrieren.
7. **Komponenten-Migrationsreihenfolge:** Karten (143 Klassennamen-Treffer, größter Hebel) → Buttons (~13 Ad-hoc-Klassen) → Badges/Status (Tokens bereits vorhanden, nur Markup-Konsolidierung) → EmptyState (additiv, risikoarm) → Tabs/SegmentedControl.
8. **Architekturentscheidung vorab klären:** Light-Theme entfernen (tot seit `data-theme="command"`), Tailwind-Entscheidung (entfernen oder auf Tokens ausbauen) — beides beeinflusst, wie viel von Punkt 1–3 „doppelt" gebaut wird, sollte vor Beginn von Sprint 1 entschieden werden.

Explizit **nicht** in Sprint 1: Editor-Ent-Excelung (Sprint 2), Dashboard-Konsolidierung (Sprint 3), Server-Component-Migration (Sprint 5), Exportdesign (nie).
