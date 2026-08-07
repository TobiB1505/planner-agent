# Dienstplan-Editor – Visueller Vergleich (Sprint 3)

Vorher-Stand: siehe `EDITOR_VISUAL_BASELINE.md` (screenshot-gestützt
erhoben). Nachher-Stand: identische Szenarien nach dem Redesign erneut
geprüft (Playwright, 1440/834/390px, gleicher Testdatensatz). Screenshots
werden entsprechend der bestehenden Repository-Praxis (Sprint 0-2) nicht
committet; die Szenarien sind reproduzierbar beschrieben.

| # | Vorheriges Hauptproblem | Umgesetzte Lösung | Funktionale Begründung |
|---|---|---|---|
| 1 | Vollflächige Kategoriefarben (Gruppenbänder 14%, 1. Spalte 16%, 2. Spalte 9%, jede Tageszelle 6%) - Schachbrett-Excel-Optik | Tageszellen + 2. Spalte neutral; 1. Spalte 5% + 3px-Kante; Gruppenzeilen als neutrale Trennzeilen mit Kategorie-Punkt | Inhalt (wer arbeitet wann) statt Struktur (welche Kategorie) trägt jetzt den visuellen Vordergrund; Kategorien bleiben über Kante/Punkt/Label eindeutig zuordenbar |
| 2 | Zellen wirkten nicht bearbeitbar (`cursor: text`, keine Affordance) | Pointer-Cursor, Hover-Tönung, Plus-Symbol auf leeren Zellen bei Hover/Fokus | Häufigste Interaktion (Zelle öffnen) ist jetzt visuell eingeladen statt verleugnet |
| 3 | Personen als abgeschnittene Textwüste ("Greta Schulz Hanna…") | Chips: 1 voller Name / 2 Vornamen / `[Vorname] [+n]`, Abwesenheiten als Outline-Chips, Präfixe gedämpft | Belegung und Personenzahl sind ohne Öffnen der Zelle erfassbar; +n macht Verborgenes explizit statt es zu verschlucken |
| 4 | Mobile: Wochen-Grid als 390px-Default, Toolbar-Badges abgeschnitten, Save-Button überlappt | Tagesansicht als Mobile-Default (<900px), frei umbrechende Toolbar, sticky Tagesnavigation | Mobile Planung ist real möglich statt nur technisch vorhanden |
| 5 | Dreifache Wochenanzeige; Ansichtswechsel als eigene ~70px-Kartenzeile; Speichern nur Icon, Status-Badges gleich laut wie Aktionen | Wochenkontext nur im Kopf; Woche/Tag als SegmentedControl in der Toolbar; Speichern als einzige beschriftete Primäraktion; Status-Chips ohne farbige Rahmen | Aktionshierarchie entspricht der Nutzungshäufigkeit; ~80px vertikaler Raum zurückgewonnen |
| 6 | "Manuell bearbeitet" als unerklärter 4px-Punkt | Punkt bleibt (dezent), Tooltip ergänzt "Manuell angepasst" | Zustand ist erklärbar, ohne Warn-Markierungen zu übertönen |
| 7 | Aktive Tagesspalte als Rahmen-"Käfig" (Gradient + beidseitige Kanten) | ruhige 4%-Tönung + Header-Unterstreichung | Orientierung ohne Unruhe |
| 8 | Kopfkarte: Wochenpicker ragte bei 834px aus der Karte | Einspaltig ab 1020px | Tablet-Nutzbarkeit |

## Verbleibende visuelle Altlasten

1. **Erste Spalte bei sehr gesättigten Kategorien** (reines Rot der
   Meetings-Gruppe): auch 5% Tönung bleibt dort wahrnehmbar kräftiger als
   bei gedämpften Kategoriefarben - die Farbwerte selbst sind fachlich
   fixiert (Excel-Wiedererkennung) und wurden nicht angefasst.
2. **Tagesansicht-Karten** verwenden weiterhin volle Kategorie-Kanten in
   voller Sättigung (linke Rahmen der Abschnitts-Karten) - im Karten-
   Layout weniger störend, aber noch nicht auf das reduzierte Niveau der
   Wochenansicht angeglichen.
3. **Wizard-Schritte** (Erstellungs-Flow vor dem ersten Plan) wurden nicht
   umgestaltet - eigener Flow außerhalb des Grid-Redesigns.
4. **`.status`-Banner** unter dem Kopf (Erfolg/Fehler-Meldung) nutzt seit
   Sprint 2 InlineStatus, aber die Wizard-Restseiten verwenden noch die
   alten Klassen.
5. **AG-Grid-Fokusring** ist der Grid-eigene 1px-Inset - nicht identisch
   mit dem Sprint-1-`--shadow-focus`-Ring (bewusst: AG-Grid-intern).
