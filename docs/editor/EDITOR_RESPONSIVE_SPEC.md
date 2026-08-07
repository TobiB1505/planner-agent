# Dienstplan-Editor – Responsive-Spezifikation (Sprint 3)

## Breakpoints (tatsächlich im Code verwendete Werte)

| Grenze | Quelle | Wirkung |
|---|---|---|
| ≤900px Viewport | `viewPreferences.ts` (`NARROW_VIEWPORT_QUERY`) | Ohne gespeicherte Präferenz startet der Editor in der **Tagesansicht**; gespeicherte Wahl gewinnt immer |
| ≤900px Viewport | `plan-editor.css` | Toolbar **nicht mehr sticky** (fließt mit der Seite - mehrzeilig umgebrochen wäre sie ~300px hoch) |
| ≤1020px Viewport | `plan-editor.css` | Kopfkarte (Summary) einspaltig - Wochenpicker unter statt neben dem Titel |
| ≤760px Viewport | `plan-editor.css` | Tagesnavigation **sticky** (oben, mit Blur-Grund), Tagesaktionen untereinander, Konfliktpanel vollbreit |
| ≤680px Container (Toolbar) | `plan-editor.css` `@container` | Toolbar-Aktionen umbrechen frei; Speichern-Button wächst (`flex: 1 1 140px`); Kurz-Labels ("Optimieren", "Excel") |
| ≥910px | Grid-Mindestlayout (Bestand) | Wochen-Grid mit 7 Tagesspalten + 252px angepinnten Spalten sinnvoll nutzbar |

Die Werte weichen bewusst von den Beispielwerten der Vorgabe (768/1200) ab:
900px ist die real gemessene Grenze, unter der das Wochen-Grid mit seinen
Pflichtspalten unbenutzbar wird (Sprint-0-Baseline: "Grid benötigt ≥910px").

## Default-Ansicht je Gerät

| Viewport | Default | Wechsel möglich? |
|---|---|---|
| Desktop ≥901px | Woche | ja, SegmentedControl |
| Tablet quer (z.B. 1024×768) | Woche | ja |
| Tablet hoch (z.B. 834×1194) | **Tag** | ja - Woche bleibt wählbar (horizontales Scrollen im Grid) |
| Mobile (≤900px) | **Tag** | ja - bewusst nicht gesperrt |

Der Default greift nur, solange keine Präferenz gespeichert ist; jede
aktive Umschaltung wird gespeichert und gilt danach auf allen Geräten des
Browsers (Local Storage, `usePlanViewPreferences`).

## Toolbar-Verhalten

- ≥901px: sticky (top 10px), zwei Gruppen-Zeilen, dezenter Blur.
- ≤900px: in Flow (nicht sticky). Speichern bleibt erreichbar per Scroll
  nach oben und - auf Geräten mit Tastatur - Strg/Cmd+S. Undo/Redo
  zusätzlich über die Grid-/Systemgesten des Browsers nicht verfügbar,
  daher bewusst mit in der Toolbar belassen (kein Verstecken in Menüs).
- ≤680px Container: Labels verkürzen sich ("Excel", "Optimieren"),
  Aktionen umbrechen frei statt in starrem Raster (behebt die 390px-
  Überlappung aus der Baseline).

## Dialogverhalten

- ConfirmDialogs (GlassDialog, Sprint 1): zentriert; ≤640px unten
  angedockt (Bottom-Sheet-artig, `100dvh`-bewusst) - Foundation-Verhalten.
- PersonCellEditor: AG-Grid-Popup unter der Zelle (Wochenansicht) bzw.
  DayEntryEditor-Inline-Panel (Tagesansicht); Breite `min(280-420px,
  100vw - 24px)`.
- Konfliktpanel: rechtes Seitenpanel, ≤760px vollbreit.

## Grid-Mounting

Wochen-Grid und Tagesansicht bleiben **beide dauerhaft gemountet**
(CSS-Umschaltung) - unverändert aus Sprint 2 übernommen. Begründung
(`EDITOR_ARCHITECTURE.md` Abschnitt 13): Unmount verlöre AG Grids
eingebauten Undo-Stack und die Scrollposition; eine sichere Alternative
erfordert die Migration des Grid-Undo in den eigenen Aktions-Stack
(eigenständiger Folge-Task). Auf Mobile wird das Wochen-Grid dadurch zwar
gemountet, aber nicht gerendert-sichtbar; die gemessene Ladezeit blieb
gegenüber Sprint 2 unverändert (~0,9-1,0s bis Grid, Produktions-Build),
der Kompromiss ist dokumentiert statt versteckt.

## Tagesnavigation und Mobile-Aktionen

- Tagesnavigation (7 Kacheln, Status-Punkte): ≤760px sticky am oberen
  Rand mit Blur-Grund - primäre Orientierung beim Scrollen durch die
  Abschnitts-Karten.
- Tagesaktionen (Vortag übernehmen, aus anderem Tag, Bereich kopieren,
  Tag leeren): volle Breite untereinander, Touch-Ziele ≥40px Höhe.
- "+ Eintrag hinzufügen" in jeder unausgefüllten Zeile der Abschnitts-
  Karten: großes Touch-Ziel, öffnet den Inline-Editor.

## Touch-Ziele

Buttons/Chips der Toolbar ≥42px; Tageskacheln ≥44px; Abschnitts-Karten-
Einträge ≥40px; Segmented-Optionen 32px hoch aber ≥56px breit (Sprint-1-
Komponente, dokumentierte Abweichung nach unten bei der Höhe).

## Bekannte Einschränkungen

1. Das sticky Verhalten der Tagesnavigation endet bei >760px (dort ist
   die Toolbar sticky; zwei konkurrierende Sticky-Elemente übereinander
   wären instabil bei variabler Toolbar-Höhe).
2. Auf Mobile ist Speichern nicht dauerhaft fixiert (keine Bottom Action
   Bar in diesem Sprint) - bewusster Zuschnitt, siehe Toolbar-Verhalten;
   Kandidat für einen späteren Feinschliff, falls sich echter Bedarf
   zeigt.
3. Die Wochenansicht bleibt auf Mobile wählbar und scrollt dann
   horizontal - sie wird nicht künstlich gesperrt (operative Nutzer
   wollen gelegentlich die Wochenübersicht auch unterwegs prüfen).
4. `100dvh` betrifft nur Foundation-Dialoge; der Editor selbst scrollt im
   Standard-Layout (`main.app-main`), keine eigene Höhenrechnung.
