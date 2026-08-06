# Frontend-Audit-Status (Sprint 0)

**Abgeglichen gegen:** Branch `design-overhaul` (Basis: `main`, Commit `26f1a2b` — nach dem Plan-Editor-Split)
**Quelle:** `docs/audit/FRONTEND_AUDIT.md` (Branch `claude/planner-agent-frontend-audit-r5lqe1`)
**Methode:** Jedes Finding wurde gegen den tatsächlichen aktuellen Code geprüft (grep/Read der genannten Dateien, Live-Test im Browser wo sinnvoll), nicht nur gegen die Audit-Aussage selbst übernommen. Der Audit wurde erkennbar erstellt, *nachdem* die Command-Dark-Dashboard/Theme/Badge-Arbeit bereits im Repo lag (er lobt `badges.css` und beschreibt `data-theme="command"` als bereits vorhanden), aber *bevor* der Plan-Editor-Split (`26f1a2b`) gemergt wurde — die Zeilennummern für `app/plan-editor/page.tsx` im Audit sind deshalb durchgängig veraltet.

**Wichtiger Kontext für alle Plan-Editor-Findings:** Zwischen Audit-Erstellung und diesem Abgleich wurde `app/plan-editor/page.tsx` von ca. 2.132 auf 1.282 Zeilen reduziert (Extraktion von `components/{PlanGrid,PlanWizardSteps,WeekNavigation,EditorDialogs}.tsx`, `hooks/{usePlanHistory,usePlanPersistence}.ts`, `utils/planEditorHelpers.tsx`, `types.ts`). Die referenzierten Zeilennummern der ursprünglichen Findings stimmen daher nicht mehr; die *inhaltlichen* Probleme wurden einzeln gegen den neuen Dateien-Zuschnitt geprüft.

---

## Top-18-Findings (Abschnitt C des Audits)

| # | Finding | Status | Aktuelle Stelle | Bewertung | Zielsprint |
|---|---|---|---|---|---|
| C1 | Datenverlust bei Client-Navigation aus dem Editor | **FIXED** | `lib/useUnsavedChangesGuard.ts`, `components/InternalNavigationGuard.tsx`, eingebunden in `app/layout.tsx` und `app/plan-editor/page.tsx` | Sidebar-/interne Links werden global abgefangen und per `ConfirmDialog` bestätigt; live verifiziert (Klick auf „Team" mit ungespeicherten Änderungen → Dialog → Abbrechen bleibt, Verwerfen navigiert). Browser-Zurück/Vor bleibt technisch ungeschützt, siehe Abschnitt „Bekannte Navigations-Lücke" unten. | Sprint 0 (erledigt) |
| C2 | Ungespeicherte Änderungen ohne Schutz: Künstlerplan, Probenplan, Archiv-Import | **FIXED** | `app/artist-plan/page.tsx`, `app/rehearsal-plan/page.tsx`, `components/ArchiveImportFlow.tsx` | Alle drei nutzen jetzt `useUnsavedChangesGuard`; `ArchiveImportFlow.reset()`/Close-Button fragen zusätzlich lokal per `ConfirmDialog` nach, wenn ein geprüfter, aber ungespeicherter Import vorliegt. | Sprint 0 (erledigt) |
| C3 | 4 undefinierte CSS-Tokens (`--danger`, `--muted-strong`, `--border-strong`, `--shadow-sm`), 18 Referenzen | **FIXED** | `app/styles/foundation.css` (Basis + Dark-Media-Fallback), `app/styles/command-theme.css` (aktives Theme) | Automatisierter Abgleich aller `var(--...)`-Verwendungen gegen alle Definitionen in `app/styles/*.css` ergibt 0 undefinierte Tokens (die 3 verbleibenden „Treffer" `--quality`, `--quality-score`, `--cmd-score-deg` sind legitime, per Inline-`style` in TSX gesetzte React-CSSProperties, keine Bugs). Live verifiziert: `--shadow-sm` rendert jetzt einen echten `box-shadow` statt `none`. | Sprint 0 (erledigt) |
| C4 | `getRowId`-Kollisionen: `rowKey = Kategorie::Zeile` nicht eindeutig | **FIXED** | `app/plan-editor/utils/planEditorHelpers.tsx` (`assignRowIds`), `app/plan-editor/types.ts` (`PlanRow._row_id`), `components/plan-editor/PlanGrid.tsx`, `hooks/usePlanHistory.ts`, `lib/planValidation.ts`, `lib/plan-editor/daySections.ts` | Neue, deterministische, occurrence-indexierte `_row_id` ersetzt `rowKey()` überall dort, wo echte Zeilenidentität gebraucht wird (Grid-`getRowId`, manuell-bearbeitet-Tracking, Issue→Zelle-Navigation). `rowKey()` bleibt bewusst unverändert für die zwei Stellen, die den *fachlichen* `assignmentRules`-Lookup (Backend-Vertrag `category::slot`, `routers/plans.py`) berühren. Backend `grid.py` `META_COLS` um `_row_id` ergänzt, damit das neue Feld nicht als Tagesspalte fehlinterpretiert wird. Live verifiziert: Konflikt anklicken → `getRowNode(rowId)` → korrekte Zelle, Editor öffnet automatisch. | Sprint 0 (erledigt) |
| C5 | Hydration-Mismatch: `localStorage` im State-Initializer, `new Date()` im Renderpfad | **PARTIALLY_FIXED** | `lib/plan-editor/viewPreferences.ts` (`usePlanViewPreferences`) | Der deterministisch reproduzierbare Teil (Dichte/Ansicht aus `localStorage` im `useState`-Initializer) ist behoben — `useSyncExternalStore` mit `getServerSnapshot` liefert immer die Defaults, echte Präferenz zieht sicher nach dem Mount nach (Muster aus `pwa-install-button.tsx` übernommen). Live verifiziert: kein Hydration-Fehler, Präferenz übersteht Reload ohne sichtbaren Flash. **Offen:** `new Date()` im Renderpfad an 5 Stellen (`components/plan-editor/DayNavigator.tsx:18`, `components/WeekPicker.tsx:43,97,114,210`, `app/plan-editor/page.tsx` 2×) — nicht angefasst, weil nur bei einer Mitternachts-Grenze zwischen SSR- und Hydrations-Zeitpunkt tatsächlich reproduzierbar (der Auftrag verlangt explizit nur „reproduzierbare" Fixes); eine Änderung hätte `WeekPicker` (seitenübergreifend genutzt) berührt, ohne dass der Fehlerfall praktisch nachstellbar ist. | Sprint 1 (niedrige Priorität) |
| C6 | Kein Toast-/Feedback-System, 3 konkurrierende Modelle | **OPEN** | `app/*/page.tsx`, `components/EmployeeIntelligenceDialog.tsx` | Unverändert. Explizit Sprint-1/4-Scope laut Audit-Roadmap (Primitive-Schicht `ToastProvider`), nicht Teil der S1-Sicherheitskorrekturen. | Sprint 4 |
| C7 | 5× `window.confirm()` trotz vorhandener `ConfirmDialog` | **OPEN** (Zahl unverändert bei genau 5) | `app/archiv/page.tsx:111`, `app/artist-plan/page.tsx:293`, `app/team/page.tsx:221`, `app/system/page.tsx:147`, `app/rehearsal-plan/page.tsx:228` | Bewusst nicht angefasst — das sind bestehende Lösch-Bestätigungen (fachliche Aktionen), keine Navigations-Guards; Ersetzen ist ein reiner UI-Konsistenz-Sweep ohne S1-Bezug, siehe Sprint-1-Scope. | Sprint 1 |
| C8 | Dashboard-Dreifachredundanz (DashboardCommand + DashboardIntelligenceOverview + Seiten-Panels) | **OPEN** (unverändert, ggf. wahrgenommen schlimmer seit Command-Dashboard-Integration in einer früheren Session) | `app/dashboard/page.tsx`, `components/DashboardCommand.tsx`, `components/DashboardIntelligenceOverview.tsx` | Die vor dem Audit erfolgte Integration von `DashboardCommand` fügte eine *weitere* Overview-Ansicht hinzu, statt bestehende zu ersetzen — der Audit hat das bereits so vorgefunden und explizit als Sprint-3-Konsolidierungsaufgabe benannt („zu einem Modul verschmelzen"). Kein Sprint-0-Scope (fachliche/visuelle Neugestaltung ausgeschlossen). | Sprint 3 |
| C9 | Excel-Optik des Editors (Vollflächen-Zellfarben, `cursor: text`) | **OPEN** | `app/plan-editor/page.tsx`, `lib/categoryColors.ts`, `app/styles/plan-editor.css` | Unverändert — explizit Sprint-2-Scope, Sprint 0 schließt visuelle Neugestaltung des Editors ausdrücklich aus. | Sprint 2 |
| C10 | Fehler vs. Warnung nur farblich unterscheidbar | **OPEN** | `app/styles/plan-editor.css:926–950`, `components/plan-editor/DayHeaderCell.tsx` | Unverändert, Sprint-2-Scope (Teil der „Ent-Excelung"). | Sprint 2 |
| C11 | Fokus-Lücken (~20 `outline: none`, keine Focus-Traps) | **OPEN** | `app/styles/plan-editor.css`, `intelligence.css`, `components/EmployeeIntelligenceDialog.tsx`, `ConfirmDialog.tsx` | Unverändert. A11y-Grundausstattung ist explizit Sprint-4-Scope; `--shadow-focus`-Token existiert noch nicht. | Sprint 4 |
| C12 | 100 % Client-Architektur, kein Splitting/Cache, kein `loading.tsx`/`error.tsx` | **OPEN** | alle `app/*/page.tsx` | Bestätigt unverändert: alle Seiten weiterhin `"use client"`, `find … -name "loading.tsx" -o -name "error.tsx"` liefert 0 Treffer, `grep -rln "next/dynamic"` liefert 0 Treffer. Architekturthema, siehe „Architekturentscheidungen". | Sprint 5 (`NEEDS_ARCHITECTURE_DECISION`) |
| C13 | AG Grid `AllCommunityModule` doppelt registriert | **OPEN** | `app/plan-editor/page.tsx:78`, `app/artist-plan/page.tsx:33` (aktuelle Zeilen) | Bestätigt unverändert per grep. Performance-Scope, nicht S1. | Sprint 5 |
| C14 | Voll-Plan-Netzwerklast (`getPlanQuality`-Klon je Änderung, kein Abort) | **OPEN** | `app/plan-editor/page.tsx`, `hooks/usePlanPersistence.ts`, `components/PersonCellEditor.tsx` | Nicht geprüft im Detail (Performance-Scope, kein S1-Datenverlust-/Integritätsrisiko) — Struktur unverändert, da nur der Editor gesplittet, nicht die Netzwerklogik verändert wurde. | Sprint 5 |
| C15 | Archiv schneidet bei 120 Zuweisungen still ab | **OPEN** | `app/archiv/page.tsx` | Unverändert, nicht geprüft (kein S1-Bezug). | Sprint 3 |
| C16 | System-Seite: Poll ruft nur `checkHealth()`, nie `loadDiagnostics()` | **FIXED** | `app/system/page.tsx` | War *nach* Audit-Erstellung sogar neu hinzugekommen (ein „Diagnose automatisch aktualisieren"-Schalter aus einer früheren Session pollte ebenfalls nur `checkHealth()` und trug damit das exakt gleiche Label-Versprechen weiter). Jetzt ruft das Intervall `refreshAll()` (Health + Diagnostics), identisch zum „Jetzt prüfen"-Button. Live verifiziert: `/api/system/diagnostics` feuert jetzt periodisch mit. Persistenzfehler des Schalters werden weiterhin still verschluckt (siehe Restrisiko unten) — das ist ein separates, geringfügiges Detail des ursprünglichen Findings. | Sprint 0 (erledigt) |
| C17 | Sprach-/Begriffschaos („Gemini", „cold_start", rohe Enums) | **OPEN** | u. a. `components/DashboardCommand.tsx`, `app/gedaechtnis/page.tsx`, `app/system/page.tsx` | Unverändert, reines Wording/Copy-Thema ohne S1-Bezug. | Sprint 3 |
| C18 | `.status-warning` existiert nicht global | **FIXED** | `app/styles/shared-components.css` | Ergänzt (Token-basiert über `--status-warning`), zusammen mit C3. `app/gedaechtnis/page.tsx` nutzt die Klasse bereits, aktuell aber ohne im UI sichtbaren Warnzustand getestet (Live-Check ergab keine gerenderten `.status-warning`-Elemente im geprüften Datenstand) — CSS-Regel selbst ist per Konstruktion identisch zu `.status-success`/`.status-error` und damit als korrekt zu betrachten. | Sprint 0 (erledigt) |

---

## Bekannte Navigations-Lücke: Browser-Zurück/-Vor

Explizit dokumentiert statt stillschweigend offen gelassen (siehe Auftrag): `useUnsavedChangesGuard`/`InternalNavigationGuard` fangen **Sidebar-Klicks, interne `<Link>`-Navigation und `beforeunload`** vollständig ab. Der Browser-Zurück/Vor-Button (popstate) ist **technisch nicht abgedeckt** — zum Zeitpunkt, an dem das `popstate`-Event feuert, hat der Browser die URL bereits gewechselt; ein echtes „Abbrechen" gibt es dafür nicht, nur ein nachträgliches, erzwungenes Zurückspringen per `history.pushState()`. Ein Testaufbau dieses „History-Trap"-Musters interagierte unzuverlässig mit dem eigenen History-Handling von Next.js' App Router (doppelte Einträge, inkonsistentes Verhalten bei schnellem Vor/Zurück) und wurde verworfen, weil er das Risiko trug, die Grundfunktion „Zurück-Button" auf *jeder* Seite zu beschädigen — ein größerer Schaden als die ursprüngliche Lücke. Empfehlung für Sprint 1/2: entweder ein sorgfältig getesteter History-Trap oder (robuster) eine Migration auf einen Router, der native Navigation-Blocking-APIs bietet.

## Restrisiko C16: stiller Persistenzfehler des Schalters

Der „Diagnose automatisch aktualisieren"-Schalter schluckt einen Fehler beim Speichern der Einstellung (`setSetting(...)` in einem leeren `catch`) weiterhin still — das UI zeigt den *lokalen* Zustand korrekt an, nur die Server-Persistenz kann unbemerkt fehlschlagen (z. B. bei kurzzeitig nicht erreichbarem Backend). Kein Datenverlustrisiko (kein Nutzerinhalt betroffen, nur eine UI-Präferenz), daher nicht als S1 eingestuft.

---

## Zusätzlich geprüfte Auditpunkte (Auftrag Phase 1, über die Top-18 hinaus)

| Bereich | Status | Befund |
|---|---|---|
| Plan-Editor-Komponentenaufteilung | **PARTIALLY_FIXED** (vor Sprint 0 bereits begonnen) | `page.tsx`: 2.132 → 1.282 Zeilen, `useState`-Zahl im gesamten `app/plan-editor/`-Baum: 41 → 15 (11 davon noch in `page.tsx`). Der Audit-Zielwert „200–300 Zeilen Komposition" (Sprint 2) ist noch nicht erreicht — die Aufteilung ist eine sinnvolle Etappe, keine vollständige Umsetzung von F/I.3. Nicht weiter aufgeteilt in Sprint 0 (Auftrag: „Keine Komponenten nur wegen ihrer Größe erneut aufteilen, wenn dies bereits sauber umgesetzt wurde" — hier bewusst als „begonnen, nicht abgeschlossen" bewertet statt erneut angefasst). |
| API-Struktur | **OBSOLETE_AFTER_REFACTOR** (teilweise) | `backend/routers/` existiert bereits (aus Commit `d4b96e1`, „split fastapi routes into routers" — vor diesem Sprint), der Audit-Kommentar zu einer monolithischen `api.py` bezog sich vermutlich auf einen älteren Stand. `lib/api.ts` selbst (Frontend-Client) unverändert, rohe `fetch()`-Aufrufe (Finding G.15, `api.ts:731/868/934`) nicht geprüft (kein S1-Bezug). |
| Doppelte CSS-Definitionen | **OPEN**, quantifiziert | `#2da970`/`#db4b56`/`#d38a32`-artige Statusfarben kommen weiterhin an ~90 Stellen über 9 Dateien hart kodiert vor (aus einer früheren Session bekannt); nur `system.css`/`team.css`/`command-theme.css`/`shared-components.css` wurden bereits auf die `--status-*`-Tokens migriert. Vollständige Migration ist Sprint-1-Scope (I.1). |
| Undefinierte CSS Custom Properties | **FIXED** | Siehe C3 oben — vollständiger, automatisierter Abgleich durchgeführt (Python-Skript, siehe Vorgehen unten), 0 offene Fälle. |
| Dialog-/Toast-Systeme | **OPEN**, Bestand bestätigt | `ConfirmDialog` (Portal-los, kein Focus-Trap), `confirm-dialog-backdrop`, dazu 5× `window.confirm` (C7) und mehrere Status-Banner-Muster (`status`, `Notice`-Objekte) nebeneinander. Kein zentrales Toast-System. Unverändert seit Audit. |
| AG-Grid-Konfigurationen | **OPEN**, ergänzt | Doppelte `AllCommunityModule`-Registrierung bestätigt (C13). `getRowId` jetzt stabil (C4, s.o.), aber `defaultColDef`/Inline-Handler-Stabilisierung (Performance-Finding G.8) nicht angefasst. |
| Unsaved-Changes-Mechanismen | **FIXED** | Siehe C1/C2 — zentraler Hook jetzt vorhanden und auf 4 Oberflächen verdrahtet. |
| Row-ID-Generierung | **FIXED** | Siehe C4. |
| Hydration-Warnungen | **PARTIALLY_FIXED** | Siehe C5. |
| Dynamische Imports | **OPEN**, bestätigt 0 | `grep -rln "next/dynamic"` über `app/`+`components/` = 0 Treffer. Sprint-5-Scope (Performance). |
| Route-lokales vs. globales CSS | **OPEN**, bestätigt | `app/layout.tsx` importiert weiterhin 18 CSS-Dateien global (16 ursprüngliche + `badges.css` + `command-theme.css` aus einer früheren Session). Nur `dashboard-command.css` wird seitenlokal in `app/dashboard/page.tsx` importiert — exakt das im Audit als Vorbild genannte Ausnahme-Muster. Migration weiterer Dateien auf route-lokale Imports ist Sprint-1-Scope (H.8). |

---

## Vorgehen für den CSS-Token-Abgleich (C3)

Automatisiert statt manuell, um Vollständigkeit sicherzustellen:

```python
import re, glob
defined, used = set(), set()
for path in glob.glob("frontend/app/styles/*.css"):
    text = open(path, encoding="utf-8").read()
    for m in re.finditer(r'(?<![\w-])(--[a-zA-Z0-9-]+)\s*:', text):
        defined.add(m.group(1))
    for m in re.finditer(r'var\(\s*(--[a-zA-Z0-9-]+)', text):
        used.add(m.group(1))
print(sorted(used - defined))
```

Ergebnis vor dem Fix: `--danger`, `--muted-strong`, `--border-strong`, `--shadow-sm`. Nach dem Fix: leer (bis auf die 3 legitimen Inline-`style`-Properties, s. o.).

---

## Zusammenfassung nach Status (Top-18, C1–C18)

| Status | Anzahl | Findings |
|---|---|---|
| FIXED | 6 | C1, C2, C3, C4, C16, C18 |
| PARTIALLY_FIXED | 1 | C5 |
| OPEN | 11 | C6, C7, C8, C9, C10, C11, C12, C13, C14, C15, C17 |
| OBSOLETE_AFTER_REFACTOR | 0 | — |
| NEEDS_ARCHITECTURE_DECISION | 0 (unter den Top-18; siehe separate Architekturliste im Sprint-0-Ergebnisbericht für Themen außerhalb der Top-18) | — |

6 + 1 + 11 = 18. Die zusätzlich geprüften Punkte in der Tabelle darüber (Komponentenaufteilung, API-Struktur, CSS-Duplikate etc.) liegen außerhalb der Top-18-Zählung und sind einzeln bewertet.
