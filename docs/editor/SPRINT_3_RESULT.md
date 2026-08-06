# Sprint 3 – Ergebnisbericht

Branch: `claude/ui-foundation-sprint-1-rzyjau` (Basis: Sprint-2-Endstand
`d4a6fee`). 7 Commits. Sprint-2-Freigabe war **READY FOR SPRINT 3** ohne
editor-relevante Risiken.

Alle Live-Prüfungen liefen mit Playwright/Chromium gegen das echte
FastAPI-Backend (lokale SQLite, 8 Testmitarbeiter, generierter
37-Zeilen-Wochenplan) - Dev-Server für Interaktionstests, Produktions-
Build für die Performance-Messung.

## 1. Zusammenfassung

**Gelöste visuelle Probleme** (vollständige Gegenüberstellung:
`EDITOR_VISUAL_COMPARISON.md`):

1. Das Kategorie-Farbschachbrett (Gruppenbänder + drei getönte
   Spaltenebenen + jede Tageszelle) ist einer ruhigen Grundfläche
   gewichen - Kategorien tragen jetzt Kante + Punkt + Label statt Fläche.
2. Zellen wirken bearbeitbar: Pointer, Hover-Tönung, Plus-Affordance auf
   leeren Zellen (Hover/Tastaturfokus), statt `cursor: text`.
3. Personen sind als Chips erfassbar (`[Finn Hoffmann]`, `[Greta] [+5]`)
   statt als abgeschnittener Fließtext; Abwesenheiten als Outline-Chips.
4. Mobile ist real nutzbar: Tagesansicht als Default unter 900px, sticky
   Tagesnavigation, frei umbrechende Toolbar ohne Überlappungen.
5. Aktionshierarchie: Speichern ist die einzige beschriftete Primäraktion
   (mit Strg/Cmd+S); Status-Chips (Qualität/Konflikte/Speicherstatus)
   sind ruhig statt button-laut; der Zwei-Karten-Ansichtswechsler wurde
   durch ein SegmentedControl in der Toolbar ersetzt (~80px gewonnen).

**Verbesserte Interaktionen:** Einzelklick-Bearbeitung ist jetzt sichtbar
eingeladen; "Manuell angepasst" wird im Tooltip erklärt; Strg/Cmd+S
speichert (Browser-Dialog unterdrückt); Woche/Tag-Wechsel kostet einen
Klick in der Toolbar statt einer eigenen Layoutzeile.

**Unverändert:** fachliche Planungslogik, API-Verträge, Datenstrukturen,
Exportpfad (Layout/Daten/Farben), Kategorie-Farbwerte, AG-Grid-Undo-Modell
aus Sprint 2, PersonCellEditor-Grundstruktur (entsprach bereits Phase 7),
Wizard-Flow, Copy/Paste-Panels, Tastaturbedienung.

## 2. Informationsarchitektur

Siehe `EDITOR_UI_SPEC.md` Abschnitt 1. Kern: Page Header (Kontext) →
Toolbar mit zwei Gruppen-Zeilen (Status & Bearbeitung / Ansicht &
Sekundäres, sticky ≥900px) → Workspace (Woche ODER Tag, gleiche
Datenbasis) → kontextuelle Panels (Zell-Popup, CopyPanel, Konfliktpanel,
Qualität, Vorschau, ConfirmDialogs). Redundante Wochenanzeige und
Zeilenzähler aus der Toolbar entfernt.

## 3. Grid-Redesign

- **Grundfläche:** neutral; Hover 7% Akzent; aktiver Tag 4% Tönung +
  Header-Unterstreichung (statt Gradient + doppelter Kanten).
- **Header:** Tageskacheln (Wochentag + Datum + "Heute" + Statuspunkte)
  unverändert als einzige Tagesnavigation - bereits vor Sprint 3 gut.
- **Kategorien:** 3px-Kante + 5% Tönung (nur 1. Spalte), Gruppenzeilen
  als neutrale Trennzeilen mit Kategorie-Punkt.
- **Zeilen/Zellen:** vollständige Zustands-Matrix in
  `EDITOR_CELL_STATE_MATRIX.md` (18 Zustände inkl. Tooltip/Screenreader).

## 4. Personen und Abwesenheiten

`PlanWeekCellRenderer` (neu): 1 Person voller Name; 2 Personen Vornamen
(+ Nachnamen-Initiale bei Kollision); ≥3 ein Chip + `+n`-Akzent-Chip mit
allen Namen im `title`. Kein eigener Klick-Handler nötig - Einzelklick
öffnet ohnehin den vollständigen Editor. Präfixe (Aperitif-Ort/-Zeit)
als gedämpfter Vortext. Abwesenheits-Zeilen (Urlaub/Krank, Frei) rendern
Outline-Chips - erkennbar als Status, nicht als Dienst. **Grenze:**
Urlaub und Krankheit teilen fachlich EINE Zeile ("Urlaub/Krank" aus der
Excel-Vorlage) - eine Zellebenen-Trennung erforderte eine
Datenstrukturänderung (nicht Teil dieses Sprints, dokumentiert).
Konflikte erscheinen zellgenau (Kante + ⚠ + Tooltip) und während der
Auswahl im Editor (Kandidaten-Begründungen) - unverändert aus dem Bestand.

## 5. Zelleditor

Bestand entsprach bereits Phase 7 (Suche/Ausgewählt/Verfügbar/Konflikte/
explizite Bestätigung, lokale Suche ohne Request-pro-Tastendruck,
KI-Empfehlungen einmal asynchron mit AbortController aus Sprint 2) -
bewusst **nicht** umgebaut, nur bestätigt und in `EDITOR_UI_SPEC.md`
spezifiziert. Bestätigungsmodell bleibt konsistent explizit
("Übernehmen"; Escape verwirft; Undo pro Übernahme funktioniert - live
geprüft: Person entfernen → Chips aktualisieren → Undo stellt zurück).

## 6. Tagesansicht und Responsive

Siehe `EDITOR_RESPONSIVE_SPEC.md`. Kurz: Desktop ≥901px Woche + sticky
Toolbar; Tablet hoch/Mobile (<900px) Tagesansicht als Default (nur ohne
gespeicherte Präferenz - aktive Wahl gewinnt); ≤760px sticky
Tagesnavigation mit Blur-Grund, Toolbar in Flow; Kopfkarte einspaltig ab
1020px. Mounting: beide Ansichten bleiben gemountet (Sprint-2-Entscheidung
beibehalten und begründet - Unmount verlöre den AG-Grid-Undo-Stack).
Geprüfte Viewports: 1440/1280/1024/834/430/390/360 - überall ohne
horizontalen Overflow, ohne Page-Errors, Speichern sichtbar, korrekte
Default-Ansicht.

## 7. Accessibility

- Tastatur: Zellfokus + Enter öffnet Editor; Strg/Cmd+Z/Y/S global;
  Editor-Escape/Cmd+Enter; SegmentedControl mit Pfeiltasten +
  `aria-pressed`; Icon-Buttons mit `aria-label` + Tooltip.
- Fokus: AG-Grid-Fokusrahmen, Plus-Affordance auch bei Tastaturfokus
  (nicht nur Hover), Sprint-1-Fokusring auf Toolbar-Elementen.
- Nicht nur Farbe: Konflikt = Kante + Symbol + Tooltip-Text; Speicher-
  status = Text; Abwesenheit = Chip-Form + Zeilenlabel; Qualität = Zahl.
- Zoom 200%: Toolbar/Grid/Kopf umbrechen ohne horizontalen Overflow
  (gemessen: scrollWidth == clientWidth), Speichern nicht abgeschnitten.
- Reduced Motion: Seite lädt und arbeitet fehlerfrei (emuliert geprüft);
  der Editor hat keine dauerhaften Animationen, Foundation-Dialoge
  reagieren auf `prefers-reduced-motion` (Sprint 1).
- **Bekannte Grenzen** (keine WCAG-Vollkonformitäts-Behauptung):
  AG Grid sagt den Zell-*Rohwert* an, nicht die Chip-Struktur;
  Konflikt-/Manuell-Zustände stehen im AG-Grid-Tooltip, sind aber nicht
  als `aria-description` je Zelle verdrahtet; die Tagesansicht-Karten
  wurden nicht einzeln mit Screenreader durchgeprüft.

## 8. Performance

Vergleich mit `EDITOR_PERFORMANCE_REPORT.md` (Sprint 2), identische
Methode (Produktions-Build, frisches Laden der archivierten Woche):

| Messung | Sprint 2 | Sprint 3 |
|---|---|---|
| `load`-Event | ~286ms | ~259ms |
| Toolbar sichtbar | ~942ms | ~905ms |
| Erste Grid-Zelle | ~984ms | ~933ms |
| Reload bis Grid | ~542ms | ~511ms |

Innerhalb des Messrauschens unverändert - der neue Zell-Renderer
(~260 leichte React-Komponenten ohne Hooks/State) ist nicht messbar.
Keine neuen Full-Grid-Refreshes (Chips rendern innerhalb der bestehenden
Refresh-Pfade; `cellClassRules`-Erweiterung `plan-cell-empty` läuft in
denselben Zyklen). Keine neuen Abhängigkeiten, keine Icon-Bibliothek
(Symbole sind Text/CSS), einziger neuer Blur: der schmale Sticky-Grund
der mobilen Tagesnavigation (eine Leiste, kein Grid-Overlay).
Verbleibende Hotspots unverändert wie in Sprint 2 dokumentiert (zwei
ungezielte refreshCells-Auslöser, AG-Grid-Doppel-Bundling pro Route).

## 9. Tests

| Prüfung | Ergebnis |
|---|---|
| TypeScript (`npx tsc --noEmit`) | ✅ 0 Fehler |
| Lint (`npm run lint`) | ✅ 0 Fehler, 0 Warnungen |
| Frontend-Tests (`npm run test`) | ✅ 62/62 (unverändert - keine fachliche Logik berührt) |
| Produktions-Build (`npm run build`) | ✅ erfolgreich (gleiche vorbestehende NFT-Warnung wie Sprint 0-2) |
| Funktionale Regression (live) | ✅ Plan laden · Woche wechseln (inkl. Dirty-Guard-Dialog) · Zelle bearbeiten · Person hinzufügen/entfernen (Chips aktualisieren korrekt) · Undo/Redo (nach jeder columnDefs-/Renderer-Änderung erneut!) · Strg+S speichert · Tagesansicht bearbeitbar · Wochen↔Tag-Sync · Konfliktpanel öffnet · Export lädt gültige XLSX herunter |
| Visuelle Zustände | ✅ leer/Hover/Fokus-Plus, Chips (1/2/+n), Abwesenheits-Outline, aktiver Tag, Gruppenzeilen; Warn-/Fehlerzellen unverändert aus Bestand (in dieser Woche keine aktiven Konflikte im Datensatz - Stil-Regeln unverändert gelassen, nicht neu erzeugt) |
| Viewports | ✅ 1440/1280/1024/834/430/390/360: kein Overflow, keine Page-Errors, korrekte Default-Ansicht, Speichern sichtbar |
| Zoom | ✅ 200% ohne horizontalen Overflow (150% impliziert) |
| Reduced Motion | ✅ emuliert geprüft, fehlerfrei |
| Zeile hinzufügen/löschen (Testliste 7/8) | ⛔ nicht anwendbar - der Editor kennt keine manuellen Zeilenoperationen (Zeilen stammen aus Vorlage/Automatik, siehe Sprint-2-Architekturdoku) |
| Copy/Paste (AG-Grid-Zwischenablage) | ⚠️ nicht mit echter Zwischenablage testbar (Headless-Sandbox); Tages-/Bereichskopie über CopyPanel live geprüft (inkl. Undo) |

## 10. Export-Sicherheit

Ausdrücklich bestätigt:

- **Exportlayout unverändert** - kein Backend-File berührt
  (`git diff d4a6fee..HEAD -- backend/` ist leer).
- **Exportdaten unverändert** - `xlsxGenerate`-Aufruf und Payload in
  `page.tsx` unverändert (Diff-geprüft); der neue Zell-Renderer ist
  display-only, Zellwerte bleiben Rohtext.
- **Exportfarben unverändert** - `lib/categoryColors.ts` und
  `category-colors.css` unverändert; reduziert wurde nur die
  *Bildschirm*-Anwendung der Farben.
- End-to-End geprüft: Export-Klick lädt eine gültige XLSX herunter
  (ZIP-Struktur verifiziert).

Keine Abweichungen, keine Blocker.

## 11. Offene Probleme

1. Tagesansicht-Abschnittskarten nutzen noch voll gesättigte
   Kategorie-Kanten (nicht auf Wochenansicht-Niveau reduziert) - rein
   visuell, Kandidat für Polishing.
2. Kein fixiertes Speichern auf Mobile (Toolbar in Flow; keine Bottom
   Action Bar) - bewusster Zuschnitt, siehe `EDITOR_RESPONSIVE_SPEC.md`.
3. Chip-Struktur/Zustände nicht als `aria-description` je Zelle
   (AG-Grid-Grenze, siehe Abschnitt 7).
4. Warn-/Fehlerzellen-Styling wurde nicht live mit aktiven Konflikten
   gesichtet (Testdatensatz war konfliktfrei; Regeln unverändert aus
   Bestand, der in Sprint 2 mit Konflikten lief).
5. Wizard-Erstellungsflow und `.status`-Banner der Wizard-Schritte noch
   im Alt-Stil.

## 12. Freigabe für Sprint 4

## **READY FOR SPRINT 4**

**Begründung:** Alle Definition-of-Done-Punkte sind erfüllt - Header/
Toolbar klar strukturiert, Aktionshierarchie eindeutig (eine Primäraktion),
Grid ohne Excel-Farbflächen bei erhaltener Tabellenlogik und
Informationsdichte, Zellzustände vollständig dokumentiert und umgesetzt,
Personen kompakt mit kontrolliertem Überlauf, Warnung/Fehler
unterscheidbar (Kante+Symbol+Text), Abwesenheiten eindeutig (im Rahmen
der fachlichen Datenstruktur), Zelleditor tastaturbedienbar, beide
Ansichten auf derselben Datenbasis, Tagesansicht mobil sinnvoll nutzbar,
Sprint-2-Performance erhalten (gemessen), Export nachweislich
unangetastet, TypeScript/Lint/Tests/Build grün. Die offenen Punkte
(Abschnitt 11) sind Polishing bzw. dokumentierte Grenzen, keine Blocker.

## 13. Empfohlener Scope für Sprint 4

Sprint 4 soll die übrigen Kernseiten auf das Designsystem migrieren.
Aktualisierte Aufgabenliste nach aktuellem Repository-Stand:

1. **Team-Seite** (627 Zeilen, größte verbleibende Kernseite):
   Karten/Buttons/Tabs auf Sprint-1-Primitives (`Card`, `Button`,
   `SegmentedControl`, `StatusBadge`), Notice-Objekte auf
   Toast/InlineStatus-Strategie, `EmptyState` für Filter-ohne-Treffer
   (bestes Alt-Muster laut Audit - als Erstes migrieren).
2. **MA-Gedächtnis** (608 Zeilen): gleiche Primitive-Migration; fehlendes
   Erfolgs-Feedback nach Mutationen ergänzen (Audit-Altpunkt).
3. **Archiv** (370 Zeilen + ArchiveImportFlow): Wochenkarten auf `Card`,
   Import-Flow-Statusanzeigen auf InlineStatus; 120-Zuweisungen-
   Abschneiden (C15) beheben.
4. **Künstlerplan/Probenplan-Drumherum** (Toolbar/Meldungen/Empty
   States - Grid/Tabelle selbst unangetastet lassen).
5. **Editor-Polishing aus Abschnitt 11**: Tagesansicht-Kanten,
   Wizard-Banner, ggf. Bottom-Save auf Mobile.
6. **Dashboard-Konsolidierung (C8)** falls Kapazität: DashboardCommand +
   DashboardIntelligenceOverview + Seiten-Panels zu einem Modul -
   größter Einzelposten, ggf. eigener Sprint 5.
7. **Loading/Error-Zustände** (`loading.tsx`/`error.tsx` je Route,
   Audit C12-Teilaspekt) für die migrierten Seiten.

Explizit nicht in Sprint 4: Export, fachliche Regeln, Server-Components,
neue State-Library, Backend-Endpunkte.
