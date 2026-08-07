# Dienstplan-Editor – Visuelle Baseline (Sprint 3)

Stand vor den Sprint-3-Änderungen, erhoben am tatsächlichen laufenden
Editor (Playwright/Chromium gegen echtes Backend mit generiertem
37-Zeilen-Wochenplan, Viewports 1440×900 / 834×1194 / 390×844) plus
Code-Analyse von `plan-editor.css` (2.071 Zeilen), `page.tsx`-`columnDefs`,
`PlanEditorToolbar`, `PlanEditorSummary`, `PlanViewSwitcher`,
`GroupHeaderRenderer` und `PlanDayView`.

## 1. Bestandsaufnahme (Antworten auf die fünf Leitfragen)

**1. Welche visuellen Probleme haben den größten Einfluss?**

1. **Vollflächige Kategoriefarben** — die stärkste Excel-Assoziation:
   - Gruppenzeilen ("Meetings", "Abend-Entertainment", …) sind
     durchgehende, gesättigte Farbbänder über die volle Breite
     (`GroupHeaderRenderer`: `hexToRgba(color, 0.14)` + 3px-Kante).
   - Die erste Spalte ("Abschnitt") trägt pro Zeile eine getönte
     Vollfläche (`0.16`-Alpha) + Kante, die zweite Spalte eine weitere
     Tönung (`0.09`), und **jede Tageszelle** noch einmal eine
     Kategorie-Tönung (`0.06`). In Summe: ein Schachbrett aus rot/grün/
     violett/gelb getönten Flächen über den gesamten Bildschirm.
2. **Zellen wirken nicht bearbeitbar**: `cursor: text !important` auf allen
   Zellen signalisiert Textmarkierung statt Bearbeitung; leere Zellen sind
   von schreibgeschützten Flächen nicht unterscheidbar; kein Hover-Plus,
   kein Affordance-Signal.
3. **Textwüsten in Zellen**: Personenlisten als kommaloser Fließtext mit
   Ellipsis ("Greta Schulz Hanna…", "1x WASPO,1x FO, 1x…") — wer
   eingeteilt ist, ist ab der zweiten Person nicht mehr erfassbar.
4. **Mobile ist faktisch unbenutzbar**: Wochen-Grid ist auch bei 390px die
   Default-Ansicht (Spalten enden bei "Mo 0…"); in der Toolbar ist "Keine
   Konflikte" horizontal abgeschnitten und der Speichern-Button überlappt
   das Planqualität-Badge (siehe Screenshot-Befund).
5. **Doppelte/konkurrierende Kopfzeilen**: Wochenkontext erscheint dreimal
   (PageHeader-Titel "Dienstplan KW 32", Wochenpicker rechts daneben,
   Toolbar-Label "KW 32 · Woche B"), der Ansichtswechsel ist eine eigene
   ~70px hohe Zwei-Karten-Zeile (`PlanViewSwitcher`) zwischen Toolbar und
   Grid.

**2. Welche Bedienelemente sind redundant?**

- Der `PlanViewSwitcher` (zwei große Karten mit Titel+Untertitel) leistet
  dasselbe wie ein `SegmentedControl` aus Sprint 1, kostet aber eine ganze
  Layoutzeile und konkurriert visuell mit den Schritt-Karten des Wizards.
- Wochenanzeige in Toolbar ("KW 32 · Woche B") dupliziert den PageHeader.
- "37 Planzeilen" in der Toolbar hat keinen operativen Nutzwert.

**3. Welche Informationen sind zu dominant?**

- Kategoriefarben (siehe oben) — sie kodieren nur Zeilenzugehörigkeit,
  dominieren aber die gesamte Fläche.
- "Planqualität 61/100" und "Keine Konflikte" sind als grell umrandete,
  buttonartige Badges gleich laut wie echte Aktionen.
- "Plan optimieren" und "Excel exportieren" wirken gleichrangig mit
  Speichern; Speichern selbst ist dagegen nur ein Icon-Button ohne Label.

**4. Welche Informationen sind zu schwach?**

- Der Speichern-Button: icon-only, Status nur als winziger Punkt.
- Leere-Zellen-Affordance: nicht vorhanden.
- "Manuell bearbeitet": 4px-Punkt oben links in der Zelle, ohne Tooltip
  oder erklärenden Text (rein technisches Symbol).
- Personen-Anzahl bei abgeschnittenen Zellen: unsichtbar (Ellipsis
  verschluckt sie).

**5. Welche Änderungen können ohne Funktionsrisiko umgesetzt werden?**

- Alle reinen CSS-Änderungen an Flächen/Borders/Cursor (kein
  AG-Grid-Verhalten betroffen).
- `cellStyle`-Anpassungen in `columnDefs` (nur Style-Objekte, keine
  Grid-Optionen — aber nach der Sprint-2-Lektion: nach jeder
  columnDefs-Änderung Undo/Redo live gegenprüfen).
- Toolbar-/Header-Umbau (reine React-Komposition außerhalb des Grids).
- Ein zusätzlicher `cellRenderer` für die Anzeige (Chips) ist risikoarm,
  solange er display-only bleibt (Editor/Value unverändert) und als
  stabile, modulweite Komponente übergeben wird.
- Mobile-Default auf Tagesansicht über den bestehenden
  `usePlanViewPreferences`-Store (client-seitiger Default, Muster bereits
  etabliert).

## 2. Aktuelle visuelle Hierarchie (Ist-Zustand)

Von laut nach leise, wie es aktuell wirkt: Kategoriefarbflächen →
Gruppenbänder → Planqualität-/Konflikt-Badges → "Excel exportieren" →
PageHeader-Titel → Tageszellen-Inhalt → Speichern-Button (Icon) →
Speicherstatus. **Soll**: Speichern/Inhalt nach oben, Kategoriefarben und
Status-Badges nach hinten.

## 3. Häufigste Interaktionen (aus Funktionsumfang abgeleitet)

1. Zelle öffnen → Person zuweisen/entfernen (PersonCellEditor)
2. Zwischen Tagen navigieren (Header-Kacheln/Tagesansicht)
3. Speichern
4. Undo/Redo
5. Tag/Bereich kopieren (Tagesansicht)
6. Konflikt öffnen → „Im Plan anzeigen"
7. Woche wechseln

Die visuelle Gewichtung entspricht dieser Reihenfolge derzeit nicht
(Interaktion 1 hat die schwächste Affordance, Interaktion 3 den
unauffälligsten Button).

## 4. Problematische Interaktionsmuster

- Zellöffnung wirkt wie Text-Selektion (`cursor: text`), obwohl
  `singleClickEdit` aktiv ist — die Interaktion ist da, wird aber visuell
  verleugnet.
- Entfernen einer Person erfordert Öffnen des Editors (akzeptiert —
  Chip-X in der Zelle wäre bei AG-Grid-Zellen fehlklickanfällig), aber
  der Editor-Öffnungs-Hinweis fehlt.
- Auf Mobile: horizontales Scrollen im Grid als einzige Möglichkeit, die
  Woche zu sehen.

## 5. Unklare Zustände

- Manuell bearbeitet: 4px-Punkt ohne Erklärung.
- Leer vs. gesperrt: nicht unterscheidbar (Gruppenzeilen sind die einzigen
  nicht bearbeitbaren Zeilen, sehen aber komplett anders aus — hier ok).
- Konflikt-Zelle: farbige Ecke (`::after`-Dreieck) + Tönung — ohne
  Tooltip-Hover nicht erklärt (Tooltip existiert, aber das Symbol allein
  trägt keine Semantik für Screenreader).

## 6. Accessibility-Probleme (Ist)

- `cursor: text` + fehlendes Affordance-Signal für leere Zellen.
- Konflikt-/Manuell-Markierungen rein visuell (CSS `::before`/`::after`),
  kein Screenreader-Text auf Zellebene (Tooltip via `tooltipValueGetter`
  hilft AG-Grid-intern, aria-Beschreibung fehlt).
- Speichern-Button hat `aria-label`, aber kein sichtbares Label — Label
  nur als Tooltip.
- Toolbar-Badges (Planqualität) ohne klaren Rollenkontext.

## 7. Responsive-Probleme (Ist, per Screenshot belegt)

- 390px: Wochen-Grid als Default; Toolbar-Badges abgeschnitten
  ("Keine Konflik…"); Speichern-Button überlappt Planqualität.
- 834px: Wochenpicker ragt aus der Header-Karte heraus (rechts
  abgeschnitten); Grid zeigt 3 von 7 Tagen.
- Kein Breakpoint bevorzugt die Tagesansicht automatisch.

## 8. Bewusst unverändert bleibende Elemente

- **Exportlayout/-farben**: komplett außerhalb dieses Sprints (Backend-
  Rendering, `xlsx_template.py`) — Bildschirm- und Exportdesign sind ab
  Sprint 3 bewusst getrennt.
- **Kategorie-Farbwerte selbst** (`lib/categoryColors.ts`,
  `category-colors.css`): Werte bleiben identisch, nur ihre *Anwendung*
  im Grid wird reduziert (Kante/Punkt statt Vollfläche).
- **AG-Grid-Technologie, Undo/Redo-Modell, Einzelklick-Editieren,
  PersonCellEditor-Grundstruktur** (Suche/Ausgewählt/Verfügbar/Konflikte/
  explizite Bestätigung — entspricht bereits Phase 7 des Auftrags).
- **Tagesansicht-Grundstruktur** (Kategorie → Zeile → Einträge als
  Karten) — entspricht bereits Phase 9.2; sie erhält gezielte
  Verbesserungen (Sticky-Navigation, Mobile-Default), keinen Neubau.
- **Wizard-Schritte** (Künstlerplan/Probenplan/Vorlage) — eigener
  Erstellungs-Flow, nicht Teil des Grid-Redesigns.
