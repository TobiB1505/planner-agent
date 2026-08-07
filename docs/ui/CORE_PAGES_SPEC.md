# Kernseiten – Struktur-Spezifikation (Stand nach Sprint 4)

Verbindliche Beschreibung, wie die acht Kernseiten aufgebaut sind und
welche Information wo (und nur dort) lebt. Ergänzt `DESIGN_SYSTEM.md`
(Komponenten) und `FEEDBACK_MATRIX.md` (Feedback-Verhalten). Baseline vor
der Migration: `CORE_PAGES_BASELINE.md`.

## 1. Gemeinsame Seitenstruktur

Jede Kernseite folgt demselben Grundriss:

1. **`ui/PageHeader`** – Titel, Untertitel, optional eine Primäraktion
   (z. B. „Planung öffnen", „MA hinzufügen", Import-Trigger) und
   Sekundäraktionen. Es gibt keinen zweiten Seitenkopf mehr; die alte
   `components/PageHeader.tsx` wurde entfernt.
2. **Seitenweite Meldungen** – ein `InlineStatus` direkt unter dem Kopf
   (Fehler `danger`, Hinweise `info`, Laden `loading`). Keine
   `.status`-Banner mehr (0 Treffer projektweit).
3. **Kennzahlen** (wo fachlich sinnvoll) – `MetricCard`-Zeile bzw. die
   bestehenden Übersichtskarten; jede Kennzahl genau einmal pro Seite.
4. **Inhaltspanels** – `panel`-Sektionen mit einem Abschnittskopf
   (Eyebrow, Titel, Beschreibung, optional Zähler-Badge).
5. **Leere Zustände** – `ui/EmptyState`; bei aktiven Filtern Variante
   `filtered` mit einer zurücksetzenden Primäraktion.
6. **Dialoge/Toasts** – `ConfirmDialog` für destruktive Aktionen,
   `useToast` für Erfolgsmeldungen (Details: `FEEDBACK_MATRIX.md`).

## 2. Dashboard – Informationsmatrix

Kernregel aus dem Sprint-4-Auftrag: **keine Information wird zwei- oder
dreifach angezeigt, es gibt genau eine Wochensteuerung, jedes Action-Item
führt zu einem Ziel.** Die Matrix legt fest, welcher Block der einzige
Ort für welche Information ist:

| Information | Einziger Ort | Bemerkung |
|---|---|---|
| Auswertungswoche (Auswahl) | Wochensteuerung neben dem PageHeader (Select + Pfeile) | einziges `<select>` der Seite |
| Wochenzeitraum (Datum) | PageHeader-Untertitel | vorher zusätzlich Hero-Karte + Command-Kopf |
| Planqualität (Score) | MetricCard „Planqualität" | vorher 3× (Chip, Donut, Ring) |
| Offene Signale (Anzahl) | MetricCard „Offene Signale" | Summe Qualitäts-Issues + Fairness-Alerts |
| Vorbereitung n/3 | MetricCard „Vorbereitung" + einklappbare Detailkarten | Detailkarten sind die Aktionsfläche (Links) |
| Showtage | MetricCard „Showtage" + Panel „Show- und Probentage" | Karte = Zahl, Panel = Detail; keine dritte Stelle |
| MA im Plan / Belastung | MetricCard „MA im Plan" + Panel „Team-Balance" | Panel enthält die Personen-Karten (einmalig) |
| Gedächtnis-Abdeckung | MetricCard „Gedächtnis-Profile" | vorher Coverage-Balken + Prozentwert doppelt |
| Handlungsbedarf | Panel „Was diese Woche Aufmerksamkeit braucht" | einziges Aktionszentrum; **alle** Items verlinkt |
| Letzte Änderungen | Panel „Letzte Änderungen" (Audit-Protokoll) | vorher 2× Audit-Feed |

Action-Item-Ziele: fehlender Künstler-/Probenplan → jeweilige Seite;
Dienstplan offen → `/plan-editor`; Qualitäts-, Fairness- und
Belastungs-Hinweise → `/plan-editor` (dort wird korrigiert).

Entfernt: `DashboardCommand` (433 Zeilen), `DashboardIntelligenceOverview`
(180 Zeilen), `dashboard-command.css` (275 Zeilen), Hero-Wochenkarte.

## 3. Team und MA-Gedächtnis – fachliche Trennung

- **Team** = Stammdaten + aktueller Status: anlegen, umbenennen,
  Abteilung, aktiv/inaktiv, löschen; Intelligence nur als *Status*
  (Datenstatus-Badge, Top-Skills, Planungshinweis) mit Absprung ins
  Profil.
- **Gedächtnis** = Inhalt des Gelernten: Shows/Partys bestätigen,
  Frei-Muster korrigieren, Aufgabenprofil auf-/abwerten.
- Die bewusste Überschneidung (beide zeigen Datenstatus-Badges) ist
  dokumentiert und gewollt: Team beantwortet „wie steht es um die
  Datenlage?", Gedächtnis „was genau wurde gelernt und wie korrigiere
  ich es?".

**Bearbeitungsmodell Team (unverändert beibehalten):** Auto-Save pro
Zeile bei Blur/Enter mit Zeilen-Feedback „Speichert …/Gespeichert/
Fehler"; Escape verwirft. Statuswechsel ist optimistisch mit Rollback
bei Fehler. Dieses Modell hat sich bewährt und wurde in Sprint 4 nur
um Toast-Erfolge (Anlegen, Statuswechsel) ergänzt, nicht ersetzt.

## 4. Künstlerplan und Probenplan – gemeinsames Muster

Beide Seiten teilen: `plan-source-workspace` (Import/Bibliothek mit
Mini-Schritten Quelle → Prüfen → Aktivieren), `PlanReviewHeader` mit
Aktiv-Status **und Dirty-Chip „Ungespeicherte Änderungen"**, WeekPicker
mit Remap-Logik, `useUnsavedChangesGuard`, ConfirmDialog fürs Löschen,
identisches Primärverb **„Für Dienstplan aktivieren"** bzw.
„Änderungen speichern". Grid (Künstlerplan, AG Grid) und Tabelle
(Probenplan, horizontal scrollbar ab ~1320px Inhaltbreite) bleiben
technisch unverändert.

## 5. Archiv

Liste + Detail: Suche, Filter (Alle/Importiert/Generiert),
`EmptyState (filtered)` mit „Filter zurücksetzen". Detailansicht zeigt
alle Zuweisungen bis 120 direkt; darüber macht „Alle N Zuweisungen
anzeigen (x weitere)" die Begrenzung sichtbar (C15 geschlossen).
Aktionen pro Woche: **„Im Editor öffnen"** (`/plan-editor?start=<ISO>`)
und „Woche löschen" (ConfirmDialog). Der Editor akzeptiert dafür den
`?start=`-Parameter und öffnet die Woche über denselben Pfad wie der
Wochenpicker (inkl. Archiv-Autoload; Woche ohne Plan → Wizard).

## 6. Planungslogik und System

Sprint-1-Piloten, in Sprint 4 vervollständigt: Planungslogik hat einen
„Erneut versuchen"-Button am Ladefehler; System pausiert das
5-Sekunden-Polling bei nicht sichtbarem Tab (sofortige Prüfung bei
Rückkehr), zeigt „Zuletzt geprüft HH:MM:SS Uhr" und beschreibt den
Polling-Zustand wahrheitsgemäß. Auto-Refresh-Präferenz bleibt über
`/api/settings` persistent.

## 7. Gemeinsame Tabellen-/Listenmuster (Phase 11 – Entscheidung)

Es wurde bewusst **keine** generische Tabellen-/Listenkomponente
gebaut: Die realen Listen (Team-Karten, Gedächtnis-Personen, Archiv-
Wochen, Probenplan-Tabelle, Workload-Karten) unterscheiden sich in
Struktur und Interaktion zu stark - eine Abstraktion hätte nur eine
dünne Hülle ohne echten Wiederverwendungswert ergeben (Auftrag:
„nur wenn 2-3 reale Verwendungen"). Wiederverwendet werden stattdessen
die kleineren Bausteine (EmptyState, InlineStatus, Badges, Karten).

## 8. Responsive-Regeln pro Seite (Kurzfassung)

| Seite | Desktop | ~1024–834 | ≤ ~680–560 |
|---|---|---|---|
| Dashboard | Metrics 3-spaltig, Panels 2-spaltig | Panels 1-spaltig | Metrics 2→1-spaltig, Kopf stapelt |
| Team | Kartengrid mehrspaltig | 2-spaltig | 1-spaltig, Aktionen unter Trennlinie |
| Gedächtnis | Liste + Detail nebeneinander | Detail unter Liste | KPI-Karten 1-spaltig |
| Archiv | Liste + Detail-Aside | Detail unter Liste | Kopf/Tools stapeln |
| Künstler-/Probenplan | volle Breite | horizontales Scrollen im Panel (dokumentiert akzeptiert) | ebenso |
| Planungslogik/System | Grids 3-/2-spaltig | 1–2-spaltig | 1-spaltig |

Geprüft ohne horizontales Seiten-Scrollen auf allen acht Seiten bei
1440/1280/1024/834/430/390/360 px.
