# Dienstplan-Editor – UI-Spezifikation (Sprint 3)

Beschreibt die Soll-Gestalt des Editors nach dem Sprint-3-Redesign
("Quiet Command" aus Sprint 1, angewandt auf den Editor). Ergänzt
`EDITOR_CELL_STATE_MATRIX.md` (Zellzustände) und
`EDITOR_RESPONSIVE_SPEC.md` (Breakpoints/Mounting).

## 1. Informationsarchitektur

```
Page Header        PlanEditorSummary (aktiver Plan) bzw. PageHeader + Wizard
Editor Toolbar     Status & Bearbeitung / Ansicht & Sekundäres (sticky ≥900px)
Planning Workspace Wochen-Grid ODER Tagesansicht (gleiche Datenbasis)
Contextual Panels  PersonCellEditor (Zell-Popup), CopyPanel, Konfliktpanel,
                   Planqualität-Dialog, Vorschau-Dialog, ConfirmDialogs
```

- **Page Header**: Titel "Dienstplan KW n", Datumsbereich, Programm,
  Vorbereitung-Status-Chips, Wochenpicker. Keine Grid-Aktionen.
- **Editor Toolbar**, Zeile 1 (Status & Bearbeitung): Speicherstatus-Chip →
  Undo/Redo (Icon-Buttons mit Tooltip + aria-label) → **Speichern**
  (einzige Primäraktion, sichtbares Label, Loading-State, Strg/Cmd+S) →
  Planqualität-Chip → Konflikt-Chip (beide öffnen ihre Detailansicht).
- **Editor Toolbar**, Zeile 2 (Ansicht & Sekundäres): SegmentedControl
  Woche/Tag → Dichte-Auswahl → "Plan optimieren"-Menü (seltene Aktionen:
  freie Tage, Neuverteilung, Neuaufbau) → Excel-Export (sekundär).
- **Kontextuelle Aktionen** bleiben am Ort ihrer Wirkung: Zellbearbeitung im
  Zell-Popup, Tageskopien in der Tagesansicht-Aktionsleiste, Konflikt-
  Navigation im Konfliktpanel.

## 2. Aktionshierarchie

| Rang | Aktion | Darstellung |
|---|---|---|
| 1 | Speichern | Primary Button, Label, deaktiviert ohne Änderungen |
| 2 | Zellbearbeitung | Einzelklick/Enter auf Zelle (Pointer + Hover + Plus-Affordance) |
| 3 | Undo/Redo | Icon-Buttons + Strg/Cmd+Z(+Shift) |
| 4 | Ansicht/Dichte | SegmentedControl + Select |
| 5 | Export | Secondary Button mit Excel-Ikonografie |
| 6 | Optimieren/Automatik | Menü "Plan optimieren ▾" |
| Status | Speicherstatus, Planqualität, Konflikte | ruhige Chips ohne farbige Rahmen; Farbe nur auf Symbol/Kennzahl |

## 3. Grid-Hierarchie (Wochenübersicht)

Von laut nach leise: Zellinhalt (Chips/Text) → Konflikt-/Warnmarkierungen →
Tagesheader mit aktivem Tag → Kategorie-Kanten/-Punkte → Grundfläche.

- **Grundfläche**: neutral (`--surface`), Zeilentrennung über die
  bestehenden dezenten Grid-Linien, Hover als 7% Akzent-Tönung.
- **Tagesheader**: Wochentag + Datum als Kachel, "Heute" als Textzusatz,
  Status-Punkte (Konflikt/unvollständig/ungespeichert) darunter, aktiver
  Tag mit Akzent-Unterstreichung. Header sind zugleich die Tagesnavigation.
- **Erste Spalte**: Abschnittsname, 3px Kategorie-Kante, 5% Tönung.
  Zweite Spalte: Zeit/Zeile als gedämpfter Text, neutral.
- **Kategorieabschnitte**: neutrale Trennzeilen, Label horizontal zentriert
  und von zwei dezenten Linien in gedämpfter Kategoriefarbe flankiert
  (Visual Polish, Post-Sprint-5), Kategorie-Punkt bleibt am Label - keine
  Farbbänder. Kategorie-Farbwerte unverändert (`lib/categoryColors.ts` =
  Excel-Vorlage, Wiedererkennung bleibt). Etwas mehr Zeilenhöhe als zuvor
  für spürbaren Abstand zwischen Abschnitten.

## 4. Personen-Darstellung (PlanWeekCellRenderer)

- 1 Person → voller Name als Chip.
- 2 Personen → zwei Chips mit Vornamen (Nachnamen-Initiale bei
  Vornamens-Kollision).
- ≥3 Personen → ein Chip + `+n` (neutraler Chip, keine Akzentfarbe im
  Ruhezustand - Visual Polish, Post-Sprint-5). `title` nennt alle Namen.
- Personen-Chips (nicht Abwesenheits-Zeilen) tragen seit dem Visual-Polish-
  Durchgang eine dezente Tönung in der Kategoriefarbe der jeweiligen Zeile
  (`rowCategory`/`categoryColor` + `hexToRgba`, dieselbe Quelle wie die
  Abschnitt-Spalte) - die Farbe kennzeichnet die Kategorie der Zuweisung,
  nicht die Person; dieselbe Person kann in unterschiedlichen Kategorien
  unterschiedlich getönte Chips haben.
- Präfixe (Ort/Zeit/Künstler, z.B. Aperitif) als gedämpfter Vortext.
- Abwesenheits-Zeilen: Outline-Chips (gestrichelt, gedämpft) - erkennbar
  als Status, nicht als Dienst-Zuweisung.
- Redaktionelle Zellen (Meetings, Mottos, Specials): unverändert Text.
- Kein Avatar/Initialen-Kreis: bei 8-40 Personen und 94px-Zellen tragen
  Initialen keine Information, kosten aber Fläche (bewusste Entscheidung).
- Parser: `parseCell` aus dem PersonCellEditor - exakt dieselbe Logik wie
  beim Bearbeiten, keine zweite Interpretation des Zellwerts.

## 5. Zelleditor (PersonCellEditor) - unverändert bestätigt

Struktur entspricht bereits Phase 7 der Vorgabe: Kopf (Dienst, Tag, Zeit) →
Belegungszähler → ausgewählte Chips (Entfernen per X, tastaturerreichbar) →
Suche (lokal, ohne Requests pro Tastendruck; KI-Empfehlungen laden einmal
asynchron mit AbortController) → gruppierte Kandidaten (Empfohlen /
Verfügbar / Mit Hinweis / Nicht verfügbar, mit konkreten Begründungen) →
explizite Bestätigung ("Übernehmen") / Abbrechen / Escape.

Bestätigungsmodell: **explizit** (ein Modell, keine Mischung) - Änderungen
landen erst mit "Übernehmen" in der Zelle; Escape/Abbrechen verwirft den
Entwurf vollständig. Undo nach Übernehmen funktioniert (ein Undo-Schritt
pro Übernahme).

## 6. Tagesansicht

Kein gestrecktes Grid, sondern: Sticky-Tagesnavigation (7 Tageskacheln mit
Status) → Tagesdatum + Tagesaktionen (Vortag übernehmen, aus anderem Tag,
Bereich kopieren, Tag leeren) → Abschnitts-Karten (Kategorie-Kante, Zähler
"n/m ausgefüllt", Einträge mit "+ Eintrag hinzufügen"-Affordance).
Gleiche Datenbasis wie die Woche (dieselben `rows`, derselbe Undo-Stack).

## 7. Motion

Nur funktionale Übergänge: Dialog-/Popover-Öffnung, Toast, Hover-Farben
(130-170ms), Zell-Flash bei Konflikt-Navigation (einmalig, 1200ms).
Keine Zell-Animationen, kein Pulsieren, keine dauerhaften Effekte.
`prefers-reduced-motion` deaktiviert Routen-/Dialog-Animationen (Sprint-1-
Foundation) - im Editor selbst existieren keine dauerhaften Animationen.

## 8. Accessibility (Editor-spezifisch)

- Alle Toolbar-Icon-Buttons: `aria-label` + `title`.
- SegmentedControl: `aria-pressed` + Pfeiltasten (Sprint-1-Komponente).
- Zellen: `ag-cell-focus`-Rahmen, Enter öffnet Editor, Escape schließt;
  leere Zellen zeigen Fokus-Plus.
- PersonCellEditor: `role="dialog"` + `aria-label`, Escape/Cmd+Enter,
  Fokus startet im Suchfeld.
- Konflikt-/Warnzellen: Symbol + Kante + Tooltip-Text (nicht nur Farbe).
- Bekannte Grenzen: siehe `EDITOR_CELL_STATE_MATRIX.md` (Screenreader-
  Ansage der Chip-Struktur) und `SPRINT_3_RESULT.md` Abschnitt 7.

## 9. Do / Don't

| Do | Don't |
|---|---|
| Kategorie als Kante/Punkt | Kategorie als Zeilen-/Zellfläche |
| Ein lesbarer Chip + "+n" (neutral) | zwei per Ellipsis zerquetschte Namen |
| Kategorie als dezente Chip-Tönung (8-15%) | Kategorie als kräftige Chip-Vollfläche |
| Speichern als beschriftete Primäraktion | Icon-only-Speichern + gleichlaute Status-Badges |
| Status-Chips: Farbe nur auf Symbol/Zahl | farbig umrandete Badge-Buttons |
| Plus-Affordance bei Hover/Fokus | dauerhaftes Plus in jeder leeren Zelle |
| Tagesansicht als Mobile-Default | 7-Spalten-Grid auf 390px |
| Tooltip erklärt Zustand ("Manuell angepasst") | unerklärte technische Marker |
