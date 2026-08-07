# Dienstplan-Editor – Zellzustands-Matrix (Sprint 3)

Dokumentiert alle visuellen Zustände einer Tageszelle in der Wochenübersicht
nach dem Sprint-3-Redesign. Quellen: `plan-editor.css` (Zustands-Klassen),
`page.tsx`-`cellClassRules` (Zuweisung), `PlanWeekCell.tsx` (Inhalt),
`tooltipValueGetter` (Tooltip/Screenreader-nahe Texte).

Grundprinzip: Die Zellfläche ist neutral (keine Kategorie-Tönung mehr);
Zustände werden über Kanten, Symbole, Chips und Text vermittelt - nie nur
über Farbe (Symbol/Text ist immer Teil des Signals).

| Zustand | Hintergrund | Border/Kante | Text/Inhalt | Icon/Symbol | Interaktion | Tooltip | Screenreader |
|---|---|---|---|---|---|---|---|
| **Leer** | neutral (Grid-Fläche) | Zeilentrennung | – | – | Pointer-Cursor, Einzelklick öffnet Editor | – | AG-Grid-Zelle ohne Wert |
| **Leer + Hover** | 7% Akzent-Tönung | 1px Akzent-Inset | – | zentriertes "+" | wie oben | – | – |
| **Leer + Tastaturfokus** | neutral | 1px Akzent-Inset (`ag-cell-focus`) | – | zentriertes "+" | Enter/Klick öffnet Editor | – | AG-Grid-Fokusansage |
| **Fokussiert (belegt)** | neutral | 1px Akzent-Inset | Inhalt | – | Enter öffnet Editor | Inhalt | Zellwert wird angesagt |
| **In Bearbeitung** | Editor-Popup | 2px Akzent-Inset (`ag-cell-inline-editing`) | Editor | – | PersonCellEditor/Textarea | – | Dialog "Mitarbeiter zuweisen" |
| **Belegt (Personen)** | neutral | Zeilentrennung | Chips: 1 Name voll; 2 Namen als Vornamen; ≥3: `[Vorname] [+n]` | – | Einzelklick öffnet Editor | voller Inhalt + ggf. Konflikte | Zellwert (Rohtext) via AG Grid |
| **Mehrfach belegt (Überlauf)** | neutral | Zeilentrennung | `+n`-Chip (Akzent) | – | Zellklick öffnet Editor mit allen | `title`: "n Personen: …alle Namen" | Rohtext enthält alle Namen |
| **Belegt (redaktionell, z.B. Motto/Meeting)** | neutral | Zeilentrennung | Text mit Ellipsis | – | Klick öffnet Text-Editor | voller Text | Zellwert |
| **Manuell verändert** | wie belegt | wie belegt | wie belegt | 4px-Akzentpunkt oben links | wie belegt | zusätzlich "Manuell angepasst" | im Tooltip-Text enthalten |
| **Warnung** | wie belegt | 3px Warn-Kante links (inset) | wie belegt | "⚠" oben rechts (amber) | Bearbeitung möglich | konkrete Erklärung(en) aus der Planprüfung | Tooltip-Text |
| **Fehler** | wie belegt | 3px Fehler-Kante links (inset) | wie belegt | "⚠" oben rechts (rot) | Bearbeitung möglich; Speichern/Export mit Rückfrage-Gate | konkrete Erklärung(en) | Tooltip-Text |
| **Abwesenheit: Urlaub/Krank-Zeile** | neutral | Kategorie-Kante (1. Spalte) | Namen als **Outline-Chips** (gestrichelt, gedämpft) | – | wie Personen-Zelle | voller Inhalt | Zeilenkontext "Urlaub/Krank" + Namen |
| **Abwesenheit: Frei-Zeile** | neutral | Kategorie-Kante (1. Spalte) | Namen als Outline-Chips | – | wie Personen-Zelle | voller Inhalt | Zeilenkontext "Frei" + Namen |
| **Aktiver Tag (Spalte)** | 4% Akzent-Tönung | Header-Unterstreichung | – | – | – | – | Header trägt aktiven Zustand |
| **Gesperrt/Schreibgeschützt** | Abschnittszeile: neutrale Trennzeile mit Kategorie-Punkt; angepinnte Spalten: 5% Tönung + Kante | Kategorie-Kante | Label | Kategorie-Punkt | keine (nicht editierbar, Standard-Cursor) | – | Vollbreiten-Zeile bzw. Spaltentext |
| **Kopiert / Paste-Ziel** | AG-Grid-Standard (Range-Flash) | `flashCells()` bei Konflikt-Navigation | – | – | – | – | – |

## Abgrenzungen und bewusste Entscheidungen

- **Urlaub vs. Krankheit:** Die Datenstruktur kennt eine gemeinsame Zeile
  "Urlaub/Krank" (fachliche Kategorie aus der Excel-Vorlage) plus "Frei".
  Eine visuelle Trennung Urlaub↔Krankheit auf Zellebene ist daher nicht
  möglich, ohne die Datenstruktur zu ändern (ausdrücklich nicht Teil dieses
  Sprints). Die Unterscheidung Abwesenheit↔Dienst ist über die
  Outline-Chips klar; Urlaub/Krank↔Frei über die Zeilenbeschriftung.
- **"Kopiert"-Zustand:** Der Editor hat keine Zwischenablage-Markierung
  über AG-Grid-Standard hinaus; Kopieraktionen laufen über die
  CopyPanel-Dialoge (Tages-/Bereichskopie), die ihr Ziel explizit benennen -
  ein eigener visueller "Ziel eines Paste-Vorgangs"-Zustand entfällt.
- **Screenreader-Grenze:** AG Grid sagt den *Rohwert* der Zelle an, nicht
  die Chip-Struktur. Konflikt-/Manuell-Zustände stehen im Tooltip-Text
  (AG-Grid-Tooltip), sind aber nicht als `aria-description` je Zelle
  verdrahtet - dokumentierte Einschränkung (siehe SPRINT_3_RESULT.md,
  Accessibility).
- **Kein dauerhaftes "+" in leeren Zellen:** nur bei Hover/Fokus - ein
  Plus in ~150 leeren Zellen gleichzeitig würde die Fläche überladen
  (Phase 5.1 der Vorgabe).
