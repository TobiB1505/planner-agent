# Sprint 1 – Ergebnisbericht

Branch: `claude/ui-foundation-sprint-1-rzyjau` (Basis: `main` @ `73683ac`,
Sprint-0-Endstand). 6 Commits, 32 Dateien, +3174/−142 Zeilen (frontend/).

Sprint-0-Freigabe war **READY WITH KNOWN RISKS**. Die dort dokumentierten
Risiken (Browser-Zurück/Vor-Lücke, nicht live durchgeklickte Künstlerplan-/
Probenplan-/Import-Guards) betreffen Navigation-Guards, nicht die
UI-Foundation — sie wurden in Sprint 1 nicht berührt und bleiben
unverändert offen (siehe Abschnitt 9).

## 1. Zusammenfassung

**Foundation geschaffen:** Ein vollständiges, dokumentiertes Design-Token-
System (Farbe, Spacing, Radius, Schatten, Z-Index, Motion, Typografie),
additiv zum bestehenden Token-Bestand aus Sprint 0. Inter/JetBrains Mono
laufen über `next/font/google` statt eines externen Runtime-Requests.

**Komponenten erstellt:** 13 zentrale Primitives in
`frontend/components/ui/` — `Button`, `Card` (+5 Unterkomponenten),
`MetricCard`, `StatusBadge`, `PageHeader`, `EmptyState`, `InlineStatus`,
`SegmentedControl`, `GlassDialog` (+5 Unterkomponenten), `ConfirmDialog`,
`ToastProvider`/`useToast`, `Field` (+3 Unterkomponenten), `Input`,
`Select`, `Checkbox`. Alle TypeScript, typisierte Props, ohne fachliche
Logik oder direkten API-Zugriff.

**Migrierte Bereiche:** `app/system/page.tsx` und
`app/planning-logic/page.tsx` (die zwei von Sprint 0 empfohlenen
Pilotbereiche) vollständig auf die neuen Primitives umgestellt. Zusätzlich:
alle 5 verbliebenen `window.confirm()`-Aufrufe projektweit (Team,
Künstlerplan, Probenplan, Archiv, System) durch `ConfirmDialog` ersetzt,
inklusive Erfolgsmeldung über `useToast()`. `components/ConfirmDialog.tsx`
wurde zum kompatiblen Re-Export der neuen Implementierung — alle 9
bestehenden Aufrufer (Plan-Editor, `InternalNavigationGuard`,
`ArchiveImportFlow`, AG-Grid-Zelleneditoren) profitieren automatisch vom
`GlassDialog`-Fundament (Portal, Focus-Trap, Scroll-Lock, Fokus-Rückgabe),
ohne dass an ihnen selbst etwas geändert wurde.

**Kein Redesign:** Der Dienstplan-Editor, das Dashboard, die
Kategoriefarben im Grid und das Exportlayout wurden nicht angefasst.

## 2. Token-System

| Kategorie | Neue Tokens | Datei |
|---|---|---|
| Farbe (semantisch) | `--color-background(-subtle)`, `--color-surface(-raised/-overlay/-hover/-active)`, `--color-text(-muted/-subtle/-inverse)`, `--color-border(-strong/-subtle)`, `--color-accent(-hover/-active/-subtle/-contrast)`, `--color-success/-warning/-danger/-info` (+`-subtle`), `--color-backdrop` | `app/styles/tokens.css` |
| Spacing | `--space-0` … `--space-16` (4px-Basis) | `tokens.css` |
| Radius | `--radius-sm/-md/-lg/-xl/-full` | `tokens.css` |
| Schatten | `--shadow-md/-lg/-overlay/-focus` (`--shadow-sm` bereits aus Sprint 0) | `tokens.css` |
| Z-Index | `--z-base/-sticky/-dropdown/-popover/-overlay/-dialog/-toast/-tooltip` | `tokens.css` |
| Motion | `--duration-fast/-normal/-slow`, `--ease-standard/-enter/-exit` | `tokens.css` |
| Typografie | `--font-size-xs` … `-4xl`, `--font-weight-regular/-medium/-semibold/-bold`, `--line-height-tight/-normal/-relaxed` | `tokens.css` |

**Ersetzte Werte:** Keine bestehenden Roh-Tokens (`--background`,
`--surface`, `--accent`, `--status-*` usw.) wurden verändert oder ersetzt —
die neue `--color-*`-Schicht referenziert sie per `var()`. Das
Command-Theme (`command-theme.css`) greift dadurch automatisch weiter, ohne
Duplizierung.

**Weiterhin bestehende Legacy-Werte:** ~85 hartkodierte Statusfarb-Literale
(`#2da970`/`#db4b56`/`#d38a32`-Familie) außerhalb der bereits in Sprint 0
migrierten Dateien (Sprint-0-Bestand: ~90, davon System/Team/`command-
theme`/`shared-components` bereits migriert). Nicht in Sprint 1 angefasst —
mechanische, aber umfangreiche Migration, siehe `UI_MIGRATION_PLAN.md`
Abschnitt 4. Kategorie-Farben (`--cat-*`, Excel-Vorlage) unverändert, wie
gefordert.

## 3. Komponenten

Vollständige Beschreibung inkl. Varianten/Verwendungsbeispielen in
`DESIGN_SYSTEM.md` Abschnitt 12–13. Kurzüberblick:

| Komponente | Accessibility-Verhalten (verifiziert) | Aktuelle Verwendung | Bekannte Einschränkung |
|---|---|---|---|
| `Button` | `type="button"`-Default, Loading blockiert Klick+setzt `aria-busy`, Label bleibt für Screenreader im DOM, `size="icon"` ohne `aria-label` löst Dev-Warnung aus | System (3×), 5× Löschen-Bestätigungen | Keine automatisierte Kontrastprüfung über alle Varianten hinweg |
| `Card`+Unterkomponenten | `interactive`+`onClick` → automatisch `role="button"`/`tabIndex=0`/Enter-Leertaste | Noch keine Live-Seite (Primitive bereit, siehe Migrationsplan) | Noch nicht unter realen Daten validiert |
| `MetricCard` | tabellarische Ziffern, Status nie nur farblich | Planungslogik (3 Kacheln) | Kein Live-Test mit sehr langen Zahlenwerten |
| `StatusBadge` | Text/Icon Pflicht, kein reines Farbsignal | Noch keine Live-Seite | Fachliches Mapping-Beispiel dokumentiert, aber noch nicht produktiv verdrahtet |
| `PageHeader` | responsive, Aktionen brechen kontrolliert um | System, Planungslogik (2 von 9 Seiten) | 7 Seiten nutzen weiter die alte, kompatible `components/PageHeader.tsx` |
| `EmptyState` | Filter-Variante mit Reset-Aktion vorgesehen | Noch keine Live-Seite | Noch nicht unter realen Filterzuständen validiert |
| `InlineStatus` | `role="alert"` (warning/danger) bzw. `role="status"` | System (2×) | — |
| `SegmentedControl` | `aria-pressed`, volle Pfeiltasten-Navigation | Noch keine Live-Seite | Noch nicht unter realen Daten validiert |
| `GlassDialog` | Portal, Focus-Trap (per Playwright verifiziert), Fokus-Rückgabe (verifiziert), Escape (verifiziert), Scroll-Lock, Reduced-Motion (verifiziert) | Basis für `ConfirmDialog`, dadurch indirekt an 14 Stellen aktiv | Backdrop schließt aktuell immer (kein Anwendungsfall im Sprint, der das verbietet) |
| `ConfirmDialog` | sichere Standardaktion fokussiert (nie die destruktive), Loading verhindert Doppelbestätigung, konkrete Konsequenz im Text | 5 neue + 9 bestehende Aufrufer | Variant-Prop (`warning`/`danger`) beeinflusst aktuell nur den Header-Akzent, nicht Icon/Farbe der Beschreibung |
| `ToastProvider`/`useToast` | `aria-live`, Fehler zusätzlich `role="alert"`, Dedupe, Max. 4 sichtbar, Hover-Pause | 5 Erfolgsmeldungen (Team/Künstlerplan/Probenplan/Archiv/System) | Kein Live-Test mit echtem Backend (Erfolgspfad in dieser Umgebung nicht auslösbar, siehe Abschnitt 6) |
| `Field`/`Input`/`Select`/`Checkbox` | Label-Verknüpfung, `aria-describedby`, `aria-invalid`, 40px Mindesthöhe | Noch keine Live-Seite | `Select`/Textarea-Styling nicht unter echten langen Optionslisten geprüft |

## 4. Dialog- und Feedbackmigration

- **Migrierte native Confirm-Aufrufe:** 5 von 5 (`app/team/page.tsx:221`,
  `app/artist-plan/page.tsx:293`, `app/rehearsal-plan/page.tsx:228`,
  `app/system/page.tsx:151`, `app/archiv/page.tsx:111`) — alle durch
  `ConfirmDialog` mit konkreter Konsequenzbeschreibung ersetzt, keine
  verbleibenden `window.confirm()`-Aufrufe im Frontend (verifiziert per
  `grep -rn "window.confirm" app components` → 0 Treffer).
- **Verbleibende native Confirm-Aufrufe:** 0.
- **Ersetzte Toastsysteme:** Keine — es gab zuvor kein echtes Toast-System
  (Sprint-0-Bestand: `.status`-Banner ohne Auto-Dismiss). `ToastProvider`
  ist rein additiv.
- **Verbleibende Feedbacksysteme:** Die seitenlokalen `{kind, text}`-
  Notice-Objekte (Team, Archiv, Künstlerplan, Probenplan, System,
  MA-Gedächtnis) bestehen für Fehler-/Ladezustände weiter — bewusst nicht
  vollständig abgelöst (siehe `UI_MIGRATION_PLAN.md` Abschnitt 7,
  „Toastarchitektur“). Nur die Erfolgs-/Hintergrundmeldungen der in Sprint 1
  migrierten Aktionen laufen jetzt über `useToast()`.

## 5. CSS-Struktur

**Neue globale Dateien:** `app/styles/tokens.css` (Token-System),
`app/styles/ui-primitives.css` (Styles aller `components/ui/*`, `ui-`-
Klassenpräfix zur Kollisionsvermeidung, siehe Auftrag Phase 8.3). Beide in
`app/layout.tsx` global importiert (18 → 20 CSS-Dateien).

**Route-lokal:** `app/styles/planning-logic.css` erhielt einen kleinen
zusätzlichen Block (`.planning-logic-metrics`-Grid) für die
`MetricCard`-Migration — bereits vor Sprint 1 route-spezifisch genutzt,
keine neue globale Datei nötig.

**Bereinigte Überschneidungen:** Keine CSS-Dateien wurden zusammengelegt
oder Regeln zwischen Dateien verschoben (Phase 8.2 „Sidebar-Regeln aus
`team.css`/`planning-workflow.css` zurückführen“ wurde **nicht**
angegangen — Risiko/Nutzen-Abwägung: reine Aufräumarbeit ohne
Komponentenbezug, für Sprint 1 zurückgestellt, siehe Abschnitt 10).

**Verbleibende Altlasten:**
- `.confirm-dialog`/`.confirm-dialog-backdrop`/`.confirm-dialog-actions`
  (`app/styles/plan-editor.css`) sind seit der `ConfirmDialog`-Umstellung
  **toter CSS-Code** (verifiziert: 0 Treffer außerhalb der Definition
  selbst). Nicht gelöscht, um diesen Sprint nicht zusätzlich mit einer
  CSS-Löschung zu belasten — für Sprint 2 vorgemerkt.
- Sidebar-Regeln in `team.css`/`planning-workflow.css` (aus Sprint 0
  übernommen, unverändert) weiterhin nicht zurückgeführt.
- 18 (jetzt 20) global importierte CSS-Dateien — route-lokale Migration
  nach dem `dashboard-command.css`-Vorbild weiterhin nur teilweise
  (2 von 20 Dateien: `dashboard-command.css`, `planning-logic.css`-Zusatz).
- Tailwind-Bestand unverändert (~30 Utility-Klassen), keine neuen
  Tailwind-Klassen in `components/ui/` eingeführt.

## 6. Tests

| Prüfung | Befehl | Ergebnis |
|---|---|---|
| TypeScript | `npx tsc --noEmit -p tsconfig.json` | ✅ 0 Fehler |
| Lint | `npm run lint` (eslint) | ✅ 0 Fehler, 0 Warnungen |
| Frontend-Tests | `npm run test` (vitest) | ✅ 46/46 Tests, 6 Testdateien (15 bestehende + 31 neue: `Button.test.tsx`, `ConfirmDialog.test.tsx`, `Toast.test.tsx`, `Field.test.tsx`) |
| Frontend-Build | `npm run build` (Next.js/Turbopack) | ✅ erfolgreich, gleiche vorbestehende, unveränderte Warnung wie in Sprint 0 (tote `/control/backend/status`-Route) |
| Backend-Tests | `pytest` | **Nicht erneut ausgeführt** — kein Backend-Code in Sprint 1 geändert, in dieser Sitzung war kein Python-venv vorhanden. Letzter bekannter Stand (Sprint 0): 240/240 grün. |

**Manuelle visuelle Tests (Playwright/Chromium, da kein Storybook/visuelles
Regressions-Tooling im Projekt vorhanden ist — konsistent mit Sprint 0):**

- Desktop 1440×900, 1280×800; Tablet 1024×768, 834×1194; Mobile 390×844,
  360×800 — jeweils `System`-Seite (PageHeader, Buttons, Cards,
  `ConfirmDialog`) gerendert und per Screenshot geprüft: keine
  Überlappungen, Aktionen bleiben erreichbar, Dialog wird auf Mobile
  bodenverankert (Bottom-Sheet-artig) statt zentriert abgeschnitten.
- `ConfirmDialog` geöffnet/Escape/Tab-Zyklus/Fokus-Rückgabe live im
  Browser verifiziert (nicht nur im Test): Tab zyklisiert ausschließlich
  zwischen den beiden Dialog-Buttons, Escape schließt, Fokus kehrt sichtbar
  (Fokus-Ring) zum auslösenden Button zurück.
- `prefers-reduced-motion: reduce` per Playwright-Emulation geprüft:
  `animation-duration` von Dialog/Backdrop sinkt auf ~0 (die
  Motion-Tokens greifen).
- Browser-Zoom 200 % auf der System-Seite: Text bricht kontrolliert um,
  keine abgeschnittenen oder überlappenden Elemente.
- **Nicht geprüft:** lange Titel/Fehlermeldungen mit tatsächlich sehr
  langen (>100 Zeichen) Werten, mehrere gleichzeitige Toasts mit
  unterschiedlichen Höhen, `Card`/`StatusBadge`/`EmptyState`/
  `SegmentedControl` visuell (noch nicht auf einer Live-Seite verdrahtet).

**Während der visuellen Prüfung gefundener und behobener Bug:** Der
`ToastProvider` rendert seinen Portal-Viewport unbedingt, obwohl auf dem
Server kein `document` existiert — das führte zu einem echten
React-Hydration-Fehler auf jeder Seite (im Playwright-Smoke-Test als
Konsolenfehler sichtbar). Behoben nach dem im Projekt bereits etablierten
`useSyncExternalStore`-Muster (`pwa-install-button.tsx`), siehe Commit
`cb398f1`. Ohne die Playwright-Sichtprüfung wäre dieser Fehler nicht
aufgefallen, da `tsc`/`lint`/vitest ihn nicht erkennen.

**Accessibility-Prüfung (siehe auch `DESIGN_SYSTEM.md` Abschnitt 10):**

- ✅ Sichtbarer Fokus-Ring (global + komponentenspezifisch)
- ✅ Korrekte Button-Semantik (`type="button"`-Default)
- ✅ Dialog-Focus-Trap (live geprüft)
- ✅ Escape-Unterstützung (live geprüft)
- ✅ Fokus-Rückgabe (live geprüft)
- ✅ Dialogtitel technisch verknüpft (`aria-labelledby`)
- ✅ Icon-Buttons beschriftet (erzwungen per Dev-Warnung bei fehlendem Label)
- ✅ Statusmeldungen über `aria-live` (`Toast`, `InlineStatus`)
- ✅ Formfelder mit Labels (`Field`, per Test verifiziert)
- ✅ Fehlertexte technisch verbunden (`aria-describedby`, per Test verifiziert)
- ✅ Status nicht nur durch Farbe (Text/Icon in `StatusBadge`/`InlineStatus` obligatorisch)
- ⚠️ Touch-Ziele ≥40×40px: für alle neuen Komponenten eingehalten (Token-
  basiert), aber nicht flächendeckend mit einem echten Touch-Gerät
  gemessen, nur anhand der CSS-Werte verifiziert.
- ⚠️ Ausreichende Kontraste: visuell in den migrierten Bereichen geprüft
  (Screenshots), **keine automatisierte WCAG-Kontrastmessung**
  durchgeführt — keine pauschale WCAG-Konformitätsaussage.

## 7. Performance

**Neue Dependencies:** Keine. `package.json`/`package-lock.json`
unverändert — `next/font/google` ist Teil von Next.js selbst, keine neue
npm-Abhängigkeit. Kein neues UI-Framework, keine Icon-Bibliothek (SVGs
inline).

**Bundle-Auswirkung:** Nicht separat gemessen (kein Bundle-Analyzer im
Projekt eingerichtet, außerhalb des Sprint-1-Scopes). Qualitativ: 13 kleine,
gebaumshakte Komponenten statt einer UI-Bibliothek; `GlassDialog`/`Toast`
rendern ihren Portal-Inhalt nur bei tatsächlichem Bedarf
(`open`/vorhandene Toasts), nicht dauerhaft.

**Bekannte Risiken:**
- `ToastProvider` sitzt in `app/layout.tsx` (App-Root) statt näher an der
  Nutzung — architekturbedingt notwendig, da Toasts von jeder Seite aus
  ausgelöst werden sollen. Der Context-Wert (`{toast, dismiss}`) ist per
  `useMemo` stabil, löst also keine Re-Renders des gesamten Baums bei
  jedem Toast aus (nur die `ToastViewport`-Subkomponente re-rendert).
  Nicht mit React DevTools Profiler verifiziert.
- Kein `React.memo` auf den neuen Komponenten (konsistent mit dem
  Sprint-0-Bestand: 0× `React.memo` im gesamten Projekt) — für die
  aktuelle Nutzungsgröße (einzelne Buttons/Cards, keine langen Listen)
  nicht als Risiko eingeschätzt, aber nicht gemessen.
- `next/font` lädt zwei Schriftfamilien (Inter + JetBrains Mono) statt
  bisher keiner echten Web-Font-Ladung (Sprint 0: `Inter` war im
  CSS-Fallback-Stack genannt, aber nie tatsächlich geladen — lief also auf
  `ui-sans-serif`/Systemschrift). Das ist eine bewusste, im Auftrag
  geforderte Änderung (Phase 3.1), aber ein zusätzlicher (wenn auch
  lokal gehosteter, gecachter) Font-Payload, der vorher nicht existierte.

## 8. Offene Architekturentscheidungen

Siehe `UI_MIGRATION_PLAN.md` Abschnitt 7 für die vollständige Begründung.

| Thema | Status nach Sprint 1 |
|---|---|
| Tailwind | Unverändert (~30 Utility-Klassen), keine neuen Tailwind-Klassen in `components/ui/`. Endgültige Entfernen/Ausbauen-Entscheidung weiterhin offen, empfohlen: entfernen (unverändert seit Sprint 0). |
| Light Theme | Unverändert nicht entfernt (`data-theme="command"` weiterhin hart gesetzt), Dark-Media-Query-Fallback bewusst als defensiver Totcode beibehalten statt gelöscht. |
| Dialogarchitektur | **Entschieden:** `GlassDialog` als gemeinsames Fundament, `ConfirmDialog` darauf aufgesetzt. AG-Grid-gebundene Custom-Popups (`PersonCellEditor` u.a.) bewusst nicht migriert (Positionierungslogik an Grid-Zelle gebunden). |
| Toastarchitektur | **Entschieden:** Ein `ToastProvider` in `app/layout.tsx`, keine parallelen Systeme. Seitenlokale Notice-Objekte bleiben für Fehler-/Ladezustände bestehen. |
| CSS-Strategie | **Entschieden:** Kein CSS-Modules-Wechsel, stattdessen `ui-`-Klassenpräfix in einer dedizierten Datei (`ui-primitives.css`) zur Kollisionsvermeidung mit bestehendem globalem CSS. |
| Statusfarb-Vollmigration | Offen — ~85 verbleibende hartkodierte Literale, mechanisch aber umfangreich, für Sprint 2/3 vorgemerkt. |

## 9. Freigabe für Sprint 2

## **READY FOR SPRINT 2**

**Begründung:** Alle Definition-of-Done-Punkte sind erfüllt — zentrales
dokumentiertes Token-System, Inter korrekt über `next/font` geladen,
Typografie/Radien/Schatten/Spacing konsolidiert, zentrale `Button`/`Card`
vorhanden, `StatusBadge`/`InlineStatus` vorhanden, `PageHeader`/`EmptyState`
vorhanden, zugängliches zentrales Dialogsystem (`GlassDialog`) mit darauf
aufsetzendem `ConfirmDialog` vorhanden, zentrales Toastsystem vorhanden,
grundlegende Formkomponenten verfügbar. Mindestens zwei repräsentative
Bereiche (System, Planungslogik) erfolgreich migriert, zusätzlich alle 5
nativen Confirm-Dialoge projektweit ersetzt. Keine fachliche Logik
verändert (jede migrierte Funktion wurde 1:1 auf ihre bestehende
API-Aufrufe geprüft), Exportdesign unverändert, kein Editor-Redesign.
TypeScript/Lint/Tests/Build sind grün.

Die Freigabe ist nicht „ohne jede Einschränkung“, weil: (a) mehrere neue
Komponenten (`Card`, `StatusBadge`, `EmptyState`, `SegmentedControl`,
`Select`) noch nicht auf einer echten Seite unter realen Daten validiert
sind, nur isoliert getestet und in den Beispielen dokumentiert; (b) keine
automatisierte Kontrastmessung stattfand; (c) der Toast-Erfolgspfad in
dieser Umgebung mangels erreichbarem Backend nicht end-to-end (nur isoliert
per Test) verifiziert werden konnte. Das sind bekannte, dokumentierte,
nicht-blockierende Risiken — keine der Sprint-0-Risiken (Browser-Zurück-
Lücke, Künstlerplan-/Probenplan-Guards) wurde durch Sprint 1 verschärft
oder berührt.

## 10. Empfohlener Scope für Sprint 2

Sprint 2 fokussiert laut Auftrag auf technische Stabilität und Entkopplung
des Dienstplan-Editors. Aktualisierte Aufgabenliste auf Basis des
tatsächlichen Codes:

1. **Editor-Ent-Excelung (C9/C10):** Vollflächige Zellfarben durch
   Kanten/Akzente ersetzen, Fehler vs. Warnung nicht mehr nur farblich
   unterscheidbar (`app/styles/plan-editor.css:926–950`,
   `components/plan-editor/DayHeaderCell.tsx`) — jetzt mit den in Sprint 1
   geschaffenen `--color-danger`/`--color-warning`-Tokens und
   `StatusBadge`/`InlineStatus` als Bausteine, statt neuer Ad-hoc-Farben.
2. **`PreparationStatusCard` → `Card`-Migration:** Kleine, risikoarme
   Migration der Plan-Editor-Statuskarte auf die neue `Card`-Primitive
   (Sprint 1 hat sie bewusst ausgespart, siehe `UI_MIGRATION_PLAN.md`
   Abschnitt 3).
3. **Weitere Confirm-Dialog-Migration:** `EmployeeIntelligenceDialog`,
   `PlanPreviewDialog`, `PlanIntelligenceDialog` auf `GlassDialog`
   umstellen (bereits zentrierte Vollbild-Dialoge, siehe
   `UI_MIGRATION_PLAN.md` Abschnitt 7 „Dialogarchitektur“).
4. **Tote CSS-Regeln entfernen:** `.confirm-dialog*` aus
   `app/styles/plan-editor.css` (verifiziert unbenutzt seit Sprint 1).
5. **Card-Vollmigration einleiten:** 143 `-card`-Klassennamen-Treffer
   laut Sprint-0-Inventar — größter verbleibender Hebel, aber Umfang
   spricht für einen eigenen Sprint statt eines Nebenbei-Tasks in Sprint 2
   (ggf. auf Sprint 3 mit Dashboard-Konsolidierung verschieben, siehe
   `UI_MIGRATION_PLAN.md` Abschnitt 5).
6. **Focus-Trap/A11y-Grundausstattung für Plan-Editor-Popups (C11):**
   `PersonCellEditor`/`SoftsportCellEditor` haben weiterhin kein
   Focus-Trap — jetzt, wo `GlassDialog` als Referenzimplementierung
   existiert, mit angepasster (grid-zellen-gebundener) Positionierung
   nachziehen.
7. **AG-Grid-Doppelregistrierung (C13):** `AllCommunityModule` weiterhin
   in `plan-editor/page.tsx` und `artist-plan/page.tsx` doppelt
   registriert — unverändert seit Sprint 0, technischer Schuld-Punkt ohne
   UI-Bezug, aber im Rahmen der „technischen Stabilität“-Ausrichtung von
   Sprint 2 sinnvoll mit zu erledigen.
8. **Plan-Editor-Komponentenaufteilung fortsetzen:** `page.tsx` weiterhin
   bei 1.282 Zeilen (Sprint-0-Zwischenstand), Audit-Zielwert 200–300
   Zeilen Komposition nicht erreicht.

Explizit **nicht** in Sprint 2: Dashboard-Konsolidierung (Sprint 3),
vollständige Tailwind-Entfernung, Server-Component-Migration (Sprint 5),
Exportlayout (nie).
