# Sprint 5 – Ergebnisbericht: Production Polish & Release-QA

Branch `claude/ui-foundation-sprint-1-rzyjau`, nach Abschluss von
Sprint 0–4. Alle Aussagen sind gegen den laufenden Code verifiziert
(Playwright gegen Dev- und Production-Build mit echtem Backend).
Begleitdokumente: `FRONTEND_RELEASE_BASELINE.md`,
`FRONTEND_PERFORMANCE_FINAL.md`, `UI_CONSISTENCY_REPORT.md`,
`DEPLOYMENT_HANDOFF.md`.

## 1. Executive Summary

**Releasezustand: UI READY FOR PRODUCTION** (Begründung §13).

Wichtigste behobene Probleme dieses Sprints:

1. **Fehlergrenzen** (Baseline-Blocker B1): Der App Router hatte keine
   einzige `error.tsx`/`not-found.tsx` - ein Seitenfehler bedeutete
   weißen Screen, unbekannte URLs die englische Next-Standardseite.
   Jetzt: Route-Boundary mit Retry und intakter Sidebar,
   `global-error` als letzte Ebene, gestaltete deutsche 404.
2. **Kontrast**: Warn-/Fehler-Chiptexte lagen auf dem Dark-Theme bei
   3,74–4,49:1; zentral über den Theme-Override auf die hellen
   Statusfarben gehoben (nachgemessen 4,85–15,26:1).
3. **Mobile Liste→Detail**: Auf Gedächtnis öffnete die Personenwahl das
   Detail unsichtbar unterhalb des Viewports - jetzt scrollt die
   Auswahl das Detail in Sicht (Gedächtnis + Archiv, Reduced-Motion-
   konform).
4. **API-Fehlertexte**: FastAPI-Validierungsfehler (detail-Objektliste)
   hätten als „[object Object]" enden können - jetzt verständlicher
   deutscher Text.
5. **Reduced Motion**: Skeleton-Shimmer/Fortschritts-Slides ruhen jetzt
   zentral (Sprint-4-Restpunkt).
6. Fokusring für das Dichte-Select im Editor (einziger interaktiver
   Fund ohne sichtbaren Fokus); nachweislich totes CSS entfernt.

Verbleibende Risiken: keine kritischen; dokumentierte nicht-kritische
Punkte in §11/§12.

## 2. Accessibility

**Geprüft** (alle 9 Kernseiten, automatisiert + gezielt): zugängliche
Namen/Labels/`for`-Zuordnung/doppelte IDs/alt-Attribute (0 Befunde;
keine Placeholder-als-Label-Fälle), Fokus-Sichtbarkeit über je 25
Tab-Stopps pro Seite, Dialog-Semantik (role=dialog, aria-modal,
Titel + Beschreibung, Focus-Trap über 8 Tabs, Escape, Fokus-Rückgabe
zum Auslöser, Scroll-Lock, „Abbrechen" initial fokussiert),
Toast-Semantik (role=status, aria-live=polite), Statusmeldungen
(InlineStatus: Fehler assertive, Rest polite), Browser-Zoom 100/150/
200 % (Dialoge nutzbar, keine abgeschnittenen Hauptaktionen),
AG-Grid-Tastatur (Pfeilnavigation, Enter öffnet Editor, Escape
schließt ohne Trap, Fokus bleibt im Grid), Kontrastmessung mit
Alpha-Compositing über den echten Flächen.

**Behoben:** Chip-Kontraste (§1.2), Dichte-Select-Fokusring.

**Bekannte Einschränkungen:** Kein Test mit echten Screenreadern
(NVDA/VoiceOver) - die Semantik ist programmatisch geprüft, nicht
per Hörprobe. Die AG-Grid-interne Fokusdarstellung ist der
Grid-eigene 1px-Ring (bewusst, seit Sprint 3 dokumentiert).
**Es wird keine vollständige WCAG-Konformität behauptet**; geprüft
wurde gezielt gegen die im Auftrag genannten Kriterien.

## 3. Responsive

**Getestet:** 9 Kernseiten × 10 Viewports (1920×1080, 1440×900,
1280×800, 1024×768, 834×1194, 768×1024, 430×932, 390×844, 375×812,
360×800) - kein horizontaler Überlauf, Primäraktion überall
erreichbar. Editor auf Mobile: Tagesansicht als Default, Wochen-Grid
wird nicht im Hintergrund gerendert, Speichern erreichbar; Sidebar
nutzt `100dvh`.

**Korrigiert:** Liste→Detail-Scroll auf Gedächtnis/Archiv (§1.3).

**Bekannte Grenzen:** Künstlerplan-Grid und Probenplan-Tabelle
scrollen auf Mobile horizontal im Panel (dokumentiert akzeptiert,
CORE_PAGES_SPEC §8); keine gesonderten iOS-Safe-Area-Insets über
`100dvh` hinaus (kein reproduzierbares Gerät im Testumfeld -
dokumentiert, kein bekanntes Problem).

## 4. Performance

Details: `FRONTEND_PERFORMANCE_FINAL.md`. Kurzfassung:

- **Bundle:** initiale Last ~560 KB JS (unkomprimiert) ohne Grid,
  +1,07 MB AG-Grid-Chunk auf Editor/Künstlerplan; CSS ~221 KB.
  AG Grid liegt doppelt in zwei Routen-Chunks (dokumentierter
  Folge-Hotspot); Idle-Prefetch lädt im Leerlauf ~3,2 MB
  (Next-Standard, lokal unkritisch).
- **Rendering:** Sprint-2/3-Optimierungen bestätigt, keine neuen
  Hotspots.
- **Requests:** keine Duplikate in Produktion, AbortController-Pfade
  aktiv, einziges Polling (System, 5 s) sichtbarkeitsgebunden.
- **CSS:** toter `.confirm-dialog*`-Block und `.btn-danger-solid`
  entfernt; 5 begründete `!important` (AG-Grid-Overrides).
- **Vergleich:** Sprint-0-Redundanzen (−943 Zeilen in Sprint 4) und
  Sprint-2-Request-Arbeit unverändert wirksam.

## 5. Loading, Error und Empty States

**Geprüft:** alle 9 Seiten. Ladezustände: Dashboard-Skeleton +
InlineStatus beim Wochenwechsel, Editor-Ladeskelett, InlineStatus
loading auf Team/Gedächtnis/Archiv/Planungslogik, Button-Loading
(ui-Button `loading`, PlanReviewHeader-Spinner), System-Prüfbanner.
**Ergänzt:** Route-/Global-Error-Boundary, 404 (§1.1).
Fehlerzustände je Seite über Request-Abbruch simuliert: Dashboard,
Team (inkl. Rollback der optimistischen Änderung), Gedächtnis,
Planungslogik (mit funktionierendem Retry), Editor (Speicherfehler:
Fehler sichtbar, Daten und Dirty-State bleiben, Guard greift).
Empty States: Sprint-4-Bestand bestätigt (gefilterte Varianten mit
Zurücksetzen-Aktion). **Verbleibende Ausnahme:** der
Keine-Regeln-Leerzustand im PlanningRulesPanel nutzt noch die alte
`dashboard-empty`-Klasse (funktional vollständig, DEFERRED).

## 6. UI-Konsistenz

Details: `UI_CONSISTENCY_REPORT.md`. Entfernte Legacy in Sprint 4/5:
alte PageHeader-Komponente, Dashboard-Command-Komponenten,
`.status`-Banner, tote Dialog-/Button-CSS-Blöcke. Verbleibende
begründete Ausnahmen: ~18 `.btn`-Altbuttons (optisch identisch,
mechanischer Resttausch), seitenspezifische Kartenklassen (bewusste
Sprint-4-Entscheidung), zwei koexistierende Spinner-Implementierungen,
Titelvarianz der Löschdialoge. Terminologie: keine englischen
Aktions-/Fehlertexte, keine Backend-Enums im UI, einheitliche Verben.

## 7. Regression

Vollständige Kernstrecke (48 automatisierte Prüfschritte in zwei
Läufen, alle bestanden):

- **Navigation:** Sidebar über alle Seiten, Browser vor/zurück,
  direkte URLs, Reload auf Unterseiten.
- **Dashboard:** Wochenwechsel, Action-Item-Links, Planung öffnen,
  simulierter Fehlerzustand.
- **Editor:** Laden, Zellbearbeitung (Person hinzufügen/entfernen),
  Undo/Redo, Speichern, simulierter Speicherfehler (Daten + Dirty +
  Guard bleiben), Validierungsanzeige, Tages-/Wochenansicht,
  Dirty-Navigation-Guard, Export.
- **Team:** Suche, Datenstatus-Filter, Anlegen → Umbenennen (Auto-
  Save) → Deaktivieren → Löschen (Netto-Null), simulierter
  Speicherfehler mit Rollback.
- **Gedächtnis:** Auswahl, Frei-Muster-Mutation mit Toast und
  Rücksetzung, Empty State, simulierter Mutationsfehler.
- **Künstlerplan:** leere Woche → bearbeiten (Dirty-Chip) →
  aktivieren → Excel-Export → löschen (Netto-Null).
- **Probenplan:** neu geseedeter Testplan (2 Proben, KW32) - Laden,
  Teilnehmer ändern (Dirty-Chip), Speichern, MA-Erkennung.
- **Archiv:** Suche, Filter, Detail, „Im Editor öffnen",
  Löschen-Dialog abbrechen ohne Datenverlust.
- **Planungslogik:** simulierter Ladefehler + Retry lädt Regeln.
- **System:** Statusprüfung, echter Backend-Neustart mit
  Erfolgs-Toast nach Wiederanlauf.

**Gefundene Bugs: 0 echte.** Zwei anfängliche FAIL-Ergebnisse waren
Testskript-Artefakte (falscher Endpunkt-/Button-Selektor) und wurden
nach Korrektur als PASS verifiziert; die vermeintliche
Dirty-Verlust-Beobachtung war die korrekte Fehler-Chip-Anzeige - der
Guard greift nachweislich auch nach einem Speicherfehler.

## 8. Export

Ausdrücklich bestätigt:

- **Dienstplan-Exportlayout unverändert:** `performExport` und der
  `/api/xlsx/generate`-Aufruf wurden seit dem Vor-Overhaul-Commit
  `140ca19` nicht verändert (Git-Nachweis via `git log -L`); die
  UI-Sprints haben nur Darstellung, nie das Zeilen-Datenmodell des
  Exports berührt.
- **Exportdaten unverändert:** Zwei Exporte derselben Woche sind
  inhaltlich identisch (entpackter `xl/`-Baum diff-gleich, 56
  Zeilen/10 Spalten-Definitionen).
- **Exportfarben unverändert:** die Excel-Vorlagen-Palette
  (FF00B050, FFFF0000, FF00B0F0, …) ist vollständig im Styles-Teil
  enthalten; Seitenformat (A4 hoch, scale 23) unverändert.
- Künstlerplan-Export liefert ein gültiges Excel (Regression 12.6);
  ein separater Probenplan-Export existiert nicht.

## 9. Build

| Prüfung | Befehl | Ergebnis | Laufzeit |
|---|---|---|---|
| TypeScript | `npx tsc --noEmit` | 0 Fehler | ~3,4 s |
| Lint | `npm run lint` | 0 Fehler/Warnungen | ~14,7 s |
| Tests | `npm test` (Vitest) | 62/62 in 9 Dateien | ~6,7 s |
| Production Build | `npm run build` | erfolgreich (Turbopack) | ~7–9 s |

(Ein `typecheck`-Skript existiert nicht; `tsc --noEmit` direkt.)
Keine bestehenden und keine neuen Fehler.

**Production Runtime** (`next start`): alle 9 Kernseiten + 404 über
direkte URLs geöffnet und neu geladen, API-Kommunikation über den
Prod-Rewrite verifiziert, Konsole ohne unerwartete Meldungen (einzig
der korrekte 404-HTTP-Status der absichtlich aufgerufenen
Nicht-Seite). Hinweis für lokale QA: ein hängengebliebener alter
`next start`-Prozess mit gelöschtem Build-Stand erzeugte
Chunk-500er - Umgebungsartefakt, per Port-Kill behoben, kein
App-Fehler.

## 10. Console

- **Production:** 0 Errors, 0 Warnings auf allen Kernseiten
  (Erstladen, Reload, Interaktion).
- **Development:** 0 Meldungen im Interaktionspass (Editor: Ansicht,
  Dichte, Zellbearbeitung, Undo, Wochenwechsel) und in allen
  Sprint-Prüfläufen.
- **Bekannte akzeptierte Meldungen:** keine; die 404-Statusmeldung
  beim Aufruf nicht existierender URLs ist korrektes Verhalten.
  `nextjs-portal` (Dev-Overlay) erscheint nur im Dev-Modus in
  Fokusketten.

## 11. Dependencies

- **Entfernt:** keine (package.json ist minimal; keine ungenutzten
  Pakete gefunden).
- **Offene Updates:** Next 16.2.12 → 16.3.0 (behebt die 3
  npm-audit-High-Findings, alle transitiv in Nexts gebündeltem
  postcss/sharp - Build-Zeit-Werkzeuge, kein an den Browser
  ausgelieferter Code; Upgrade bewusst nicht mitten im
  Release-Sprint), AG Grid 36.0.2 → 36.1.0 (minor), ESLint 10 /
  jsdom 30 (Dev-Major, unkritisch).
- **Bekannte Risiken:** die audit-Findings bis zum Next-Update
  (praktische Ausnutzbarkeit im lokalen Betrieb: gering, da
  postcss/sharp nur eigene, vertrauenswürdige Inhalte verarbeiten).

## 12. Release Blocker

**Keine offenen Blocker.** Gegen die Phase-18-Liste geprüft:
Datenverlust (Guard + Speicherfehlerpfad verifiziert), Speichern
(Editor/Team/Gedächtnis/Planseiten grün), Export (unverändert,
§8), Dirty-Navigation (Guard greift, auch nach Speicherfehler),
Seiten-Crashes (Error-Boundaries neu + 0 Pageerrors), Hydration
(0 Meldungen), Mobile-Erreichbarkeit (Matrix grün), Dialoge
(schließbar, kein Trap), Build (grün), Request-Schleifen (keine;
Polling sichtbarkeitsgebunden), Duplicate Row IDs (seit Sprint 0
`_row_id`, 0 AG-Grid-Warnungen), Speicher-Races (savingRef-Schutz,
Sprint 2), Statusanzeigen (Regression grün), Import-Verarbeitung
(unverändert; Fehlerpfade sichtbar).

## 13. Produktionsfreigabe

**UI READY FOR PRODUCTION.**

Begründung: Alle Phase-18-Blockerkategorien sind explizit geprüft und
frei (§12); die vollständige Kern-Regression (48 Schritte) lief ohne
echten Befund; Export ist nachweislich unverändert; Build-Gate und
Production-Runtime sind grün; die in diesem Sprint gefundenen realen
Probleme (Fehlergrenzen, Kontraste, Mobile-Detail-Scroll,
422-Fehlertext, Reduced Motion, Fokusring) wurden behoben und
nachgemessen. Die verbleibenden Punkte (AG-Grid-Chunk-Duplikat,
Next-16.3-Update, `.btn`-Resttausch, Screenreader-Hörprobe) sind
dokumentierte, nicht-kritische Folgearbeiten ohne Datenverlust- oder
Funktionsrisiko - sie stehen einer Produktivnahme des Frontends
nicht entgegen. Der nächste Projektabschnitt (Deployment) ist über
`DEPLOYMENT_HANDOFF.md` vorbereitet.
