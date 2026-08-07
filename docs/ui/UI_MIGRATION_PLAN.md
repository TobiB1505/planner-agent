# UI-Migrationsplan (Sprint 1 → folgende Sprints)

Begleitdokument zu `DESIGN_SYSTEM.md`. Hält fest, was in Sprint 1 neu
entstanden ist, was migriert wurde, was als Legacy bewusst stehen bleibt,
und in welcher Reihenfolge künftige Sprints weitermachen sollten.

> **Stand nach Sprint 4:** Abschnitt 0 (unten) dokumentiert den
> aktuellen Migrationsstand; die Abschnitte 1–8 beschreiben den
> historischen Sprint-1-Stand und bleiben als Begründungsarchiv erhalten.

## 0. Migrationsstand nach Sprint 4

Alle acht Kernseiten nutzen den zentralen Seitenkopf und das zentrale
Feedback-Modell (Details: `CORE_PAGES_SPEC.md`, `FEEDBACK_MATRIX.md`,
`SPRINT_4_RESULT.md`):

| Bereich | Status |
|---|---|
| `ui/PageHeader` | Auf allen 8 Kernseiten + Editor-Wizard; alte `components/PageHeader.tsx` **gelöscht** |
| `.status`-Banner | **0 Verwendungen** – vollständig durch `InlineStatus` ersetzt (inkl. `EmployeeIntelligenceDialog`) |
| `window.confirm`/`alert` | weiterhin **0 Verwendungen** |
| Erfolgs-Feedback | Toast für Mutationen auf Team/Gedächtnis/Archiv/Planseiten/System; keine stillen Erfolge mehr |
| `EmptyState` | Team, Gedächtnis, Archiv, Dashboard (Panels + keine-Woche-Fall) inkl. `filtered`-Variante mit Zurücksetzen |
| Dashboard-Legacy | `DashboardCommand`, `DashboardIntelligenceOverview`, `dashboard-command.css` **gelöscht** (C8 konsolidiert) |
| Dirty-State | `PlanReviewHeader` mit Dirty-Chip auf Künstler-/Probenplan (analog Editor-Status-Chip) |
| Verbleibende Ad-hoc-Buttons | `.btn`-Familie weiterhin auf Planseiten/Detailflächen aktiv – bewusst nicht in Sprint 4 (mechanischer Sprint-5/6-Task ohne UX-Effekt) |
| Verbleibende Karten-Klassen | seitenspezifische `*card*`-Klassen bestehen weiter, aber je Seite konsistent; keine vollständige `Card`-Ablösung erzwungen |
| Statusfarb-Literale | Restbestand unverändert (mechanische Migration, siehe Abschnitt 4) |

## 1. Neue zentrale Komponenten (Sprint 1)

Siehe `DESIGN_SYSTEM.md` Abschnitt 12 für die vollständige Liste. Alle in
`frontend/components/ui/`, TypeScript, typisierte Props, `className`
akzeptiert wo sinnvoll, keine fachliche Logik, kein direkter API-Zugriff.

## 2. Migrierte Bereiche (Sprint 1)

| Bereich | Was wurde migriert | Risiko |
|---|---|---|
| `app/system/page.tsx` | `PageHeader`, `Button` (3 Aktionen), `InlineStatus` (Nachricht + Diagnosefehler), `ConfirmDialog` (Neustart-Bestätigung), `useToast` (Neustart-Erfolg) | Niedrig — reines UI-Markup, Diagnose-/Restart-Logik unverändert |
| `app/planning-logic/page.tsx` | `PageHeader`, `MetricCard` (3 Kennzahlen statt `.planning-logic-overview article`), `InlineStatus` (Laden/Fehler) | Niedrig — reine Anzeige, Regel-Logik/`PlanningRulesPanel` unverändert |
| `app/team/page.tsx` | Löschen-Bestätigung: `window.confirm` → `ConfirmDialog`, Erfolg → `useToast` | Niedrig — nur der Bestätigungs-/Feedback-Layer, `deletePerson`-Aufruf unverändert |
| `app/artist-plan/page.tsx` | Löschen-Bestätigung: `window.confirm` → `ConfirmDialog`, Erfolg → `useToast` | Niedrig |
| `app/rehearsal-plan/page.tsx` | Löschen-Bestätigung: `window.confirm` → `ConfirmDialog`, Erfolg → `useToast` | Niedrig |
| `app/archiv/page.tsx` | Löschen-Bestätigung: `window.confirm` → `ConfirmDialog`, Erfolg → `useToast` | Niedrig |
| `components/ConfirmDialog.tsx` | Wird zum kompatiblen Re-Export von `components/ui/ConfirmDialog.tsx` — alle bisherigen 9 Aufrufer (Plan-Editor, `InternalNavigationGuard`, `ArchiveImportFlow`, `PersonCellEditor`, `PlanDayView`, `CopyPanel`, `EditorDialogs`) profitieren automatisch vom GlassDialog-Fundament (Portal, Focus-Trap, Scroll-Lock, Fokus-Rückgabe), ohne Codeänderung an den Aufrufern | Niedrig — API (Props/Verhalten) unverändert, nur die interne Implementierung wurde ausgetauscht; alle bestehenden Verwendungen wurden gegen `tsc`/`lint`/Build geprüft |

Damit sind die geforderten „mindestens zwei repräsentative Bereiche"
(System, Planungslogik) migriert; zusätzlich wurden alle 5 verbliebenen
`window.confirm()`-Aufrufe projektweit ersetzt (Phase 5.3 des
Sprint-1-Auftrags — ursprünglich als Sprint-1-Scope, nicht nur „Pilot",
vorgesehen).

## 3. Bewusst nicht migriert (Sprint 1)

Explizit außerhalb des Sprint-1-Scopes, siehe Auftrag „Nicht Teil dieses
Sprints":

- Dienstplan-Editor (`app/plan-editor/`) — visuelles Redesign folgt Sprint 2
  („Ent-Excelung").
- Künstlerplan-/Probenplan-Grid/Tabelle selbst (nur die Löschen-Bestätigung
  und die Erfolgsmeldung wurden migriert, nicht das AG-Grid/die Tabelle).
- Dashboard (`DashboardCommand`, `DashboardIntelligenceOverview`,
  `PreparationStatusCard`) — Konsolidierung ist Sprint-3-Scope (C8).
- Team-/Archiv-/Gedächtnis-Hauptinhalte (nur `PageHeader`-fähige Bereiche
  der bereits migrierten Seiten wurden angefasst, nicht die Tabellen/Karten
  im Seiteninneren).
- Kategoriefarben im Grid (`category-colors.css`, `lib/categoryColors.ts`)
  — unverändert, wie im Auftrag verlangt.
- Exportlayout — unverändert.

## 4. Legacy-Komponenten (bestehen bleiben, sind aber Migrationsziel für spätere Sprints)

| Legacy | Ersetzt (perspektivisch) durch | Kommentar |
|---|---|---|
| `.btn`/`.btn-primary`/`.btn-danger` + ~13 Ad-hoc-Button-Klassen (`archive-close-button`, `team-delete-button`, `pwa-install-button`, `dashboard-week-arrow`, `plan-editor-week-arrow`, `system-action-icon` u.a.) | `components/ui/Button` | Nicht gelöscht — noch aktiv auf allen nicht migrierten Seiten. Empfehlung: Buttons zuerst dort migrieren, wo ohnehin an einer Seite gearbeitet wird (opportunistisch), volle Migration in Sprint 3/4. |
| `.panel`/`.stat-card` + ~33 seitenspezifische `*card*`-Klassen | `components/ui/Card`/`MetricCard` | Größter Hebel laut Sprint-0-Inventar (143 `-card`-Klassennamen-Treffer) — bewusst nicht in Sprint 1 vollständig migriert (Scope-Grenze „kein vollständiges Redesign"). Zielsprint: 3 (Dashboard-Konsolidierung berührt ohnehin viele Karten). |
| `.badge-pill`/`.badge-dot`/`.status`-Banner | `components/ui/StatusBadge`/`InlineStatus` | Tokens bereits einheitlich (`--status-*`), nur Markup/Klassennamen-Konsolidierung offen. Niedriges Risiko, guter Kandidat für Sprint 2/3. |
| `.confirm-dialog`/`.confirm-dialog-backdrop`/`.confirm-dialog-actions` (`app/styles/plan-editor.css`) | `components/ui/GlassDialog` (intern von `ConfirmDialog` genutzt) | **Toter CSS-Code seit Sprint 1** — keine Komponente rendert diese Klassen mehr (verifiziert: 0 Treffer außerhalb der CSS-Datei selbst). Nicht gelöscht, um diesen Sprint nicht mit einer zusätzlichen CSS-Löschung zu belasten; Entfernung ist ein risikoloser Aufräum-Task für Sprint 2. |
| `PreparationStatusCard` (`components/PreparationStatusCard.tsx`) | `components/ui/Card` (perspektivisch) | Nicht angefasst — gehört zum Plan-Editor-Umfeld (`PlanWizardSteps.tsx`), explizit Sprint-2-Scope. |
| Alte `components/PageHeader.tsx` | `components/ui/PageHeader` | Bleibt für die 7 noch nicht migrierten Seiten (Dashboard, Dienstplan-Editor, Künstlerplan, Probenplan, Team, Archiv, MA-Gedächtnis) unverändert bestehen — deren `title`/`subtitle`-Aufrufe sind 1:1 kompatibel zur neuen Komponente, eine spätere Migration ist ein reiner Importwechsel ohne Verhaltensänderung. |
| Restliche ~85 hartkodierte Statusfarb-Literale (`#2da970`/`#db4b56`/`#d38a32`-Familie, außerhalb der bereits in Sprint 0 migrierten Dateien) | `--status-*`/`--color-{success,warning,danger}` | Nicht angefasst — mechanische Migration ohne visuelle Änderung, aber viele Fundstellen; guter Kandidat für einen eigenen kleinen Sprint-2/3-Task mit Vorher/Nachher-Screenshot-Vergleich statt Blindumstellung. |

## 5. Seitenreihenfolge für künftige Vollmigration (Empfehlung)

Nach Redundanz-Umfang und Risiko, wie im Sprint-0-Inventar begründet:

1. **Team, Archiv, MA-Gedächtnis** — überwiegend Listen/Karten/Formulare,
   kein AG-Grid, niedrigstes Risiko.
2. **Dashboard** — fällt mit der in Sprint 3 ohnehin geplanten
   `DashboardCommand`/`DashboardIntelligenceOverview`-Konsolidierung
   zusammen; nicht vorher isoliert migrieren (doppelte Arbeit).
3. **Künstlerplan/Probenplan** — Grid/Tabelle bleibt technisch unverändert,
   aber Drumherum (Toolbar, Dialoge, Empty States) kann migriert werden.
4. **Dienstplan-Editor** — erst nach der Sprint-2-„Ent-Excelung", damit
   nicht zweimal am selben Code gearbeitet wird.

## 6. Abhängigkeiten

- Karten-Migration (Punkt 4 oben) sollte **vor** einer möglichen
  Server-Component-Migration (Sprint 5, `NEEDS_ARCHITECTURE_DECISION`)
  erfolgen, da client-seitige Interaktivität (`Card--interactive`,
  `SegmentedControl`) sonst zweimal anzufassen wäre.
- Button-/Card-Vollmigration sollte **vor** einer Tailwind-Entscheidung
  (siehe unten) erfolgen — sie verringert die Zahl der Stellen, die eine
  Tailwind-Entfernung berühren würde, zusätzlich.

## 7. Architekturentscheidungen — Status nach Sprint 1

### Tailwind

**Bestand:** Weiterhin nur ~30 Utility-Klassen aktiv genutzt (`flex`,
`min-w-0`, `px-`, `py-`, `mt-`, `h-full`, `overflow-*` u.ä.), primär in
`app/layout.tsx` und alten Seiten-Wrappern. Sprint 1 hat bewusst **keine**
neuen Tailwind-Klassen in `components/ui/` eingeführt (durchgängig eigenes
CSS mit `ui-`-Präfix in `ui-primitives.css`), um keine zweite parallele
Token-Logik zu etablieren (Auftrag: „Vermeide eine parallele
Tailwind-Migration").

**Empfehlung (unverändert seit Sprint 0):** Tailwind eher entfernen als
ausbauen, sobald die verbleibenden ~30 Utility-Klassen durch
CSS-Custom-Property-Nutzung ersetzt sind. Das ist ein eigener, kleiner
Sprint-3/4-Task, keine Sprint-1-Entscheidung.

### Light Theme

**Bestand:** `data-theme="command"` ist weiterhin fest in `app/layout.tsx`
gesetzt. Die `@media (prefers-color-scheme: dark)`-Blöcke in
`foundation.css`/`tokens.css` sind für den aktuellen Nutzungsfall toter
Code (nie aktiv, da `data-theme` das Attribut-Override immer gewinnt) —
Sprint 1 hat sie **nicht entfernt**, sondern als defensiven Fallback
beibehalten (siehe `DESIGN_SYSTEM.md` Kommentar in `tokens.css`), falls
`data-theme` je entfernt würde. Keine bestehende Nutzerfunktion geht dadurch
verloren, da ohnehin niemand das Light-Theme aktuell sieht.

**Empfehlung (unverändert seit Sprint 0):** Entfernen, sobald eine
Architekturentscheidung das ausdrücklich freigibt — das ist bewusst
außerhalb des Sprint-1-Scopes, da Sprint 0 dies nicht bereits eindeutig
freigegeben hat (siehe Auftrag Phase 10.3).

### Dialogarchitektur

**Entschieden in Sprint 1:** Ein gemeinsames Fundament (`GlassDialog`) für
alle künftigen Dialoge, `ConfirmDialog` setzt darauf auf. Bestehende
Custom-Popups mit eigener Positionierung (`PersonCellEditor`,
`SoftsportCellEditor` — AG-Grid `popup: true`-Zellen) wurden **nicht** auf
`GlassDialog` umgestellt, da deren Positionierungslogik an die Grid-Zelle
gebunden ist und ein Wechsel auf ein zentriertes Portal die AG-Grid-Editor-
UX verändern würde (außerhalb des Sprint-1-Risikorahmens). `
EmployeeIntelligenceDialog`/`PlanPreviewDialog`/`PlanIntelligenceDialog`
sind Kandidaten für eine spätere `GlassDialog`-Migration (Sprint 2/3),
da sie bereits zentrierte Vollbild-Dialoge sind.

### Toastarchitektur

**Entschieden in Sprint 1:** Ein einziger `ToastProvider` in
`app/layout.tsx`, keine parallelen Toast-Systeme. Die seitenlokalen
`{kind, text}`-Notice-Objekte (Team, Archiv, Künstlerplan, Probenplan,
System, MA-Gedächtnis) bleiben für **Fehler-** und **Ladezustände**
bestehen (siehe Feedbackstrategie in `DESIGN_SYSTEM.md`) — nur die
Erfolgs-/Hintergrundmeldungen der in Sprint 1 migrierten Lösch-/Neustart-
Aktionen wurden auf `useToast()` umgestellt. Eine vollständige Ablösung
aller Notice-Objekte durch `InlineStatus` ist ein eigener Sprint-2/3-Task
(mechanisch, aber viele Fundstellen).

### CSS Modules vs. globale Klassen

**Entschieden in Sprint 1:** Kein Wechsel zu CSS Modules (keine im Projekt
etablierte Konvention, siehe Sprint-0-Bestand: reines globales CSS mit
Datei-pro-Bereich-Konvention). Stattdessen: zentrale UI-Komponenten nutzen
einen dedizierten `ui-`-Klassenpräfix (`ui-btn`, `ui-card`, `ui-dialog`,
...) in einer eigenen Datei (`app/styles/ui-primitives.css`), um Kollisionen
mit seitenspezifischem CSS zu vermeiden, ohne die bestehende
CSS-Architektur zu brechen.

## 8. Verbleibende native `window.confirm()`-Aufrufe

**Keine.** Alle 5 aus Sprint 0 dokumentierten Aufrufe (Team, Künstlerplan,
Probenplan, Archiv, System) wurden in Sprint 1 auf `ConfirmDialog`
umgestellt (siehe Abschnitt 2).
