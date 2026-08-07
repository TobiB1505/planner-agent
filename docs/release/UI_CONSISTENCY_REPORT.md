# UI-Konsistenzbericht (Sprint 5, Phase 8/9)

Systematischer Sweep über PageHeader, Buttons, Cards, Dialoge, Badges,
Toasts, Formfelder, Filter, Tabellen/Listen, Section Headers, Toolbars,
Empty States, Warnungen und Fehler - programmatisch (Greps über alle
TSX/CSS) plus Sichtprüfung der neun Kernseiten. Jede Abweichung ist als
FIXED, ACCEPTED_EXCEPTION oder DEFERRED markiert.

## 1. Konsistenzfragen – Antworten

| Frage | Befund | Status |
|---|---|---|
| Gleiche Aktionen gleich benannt? | „Speichern"/„Änderungen speichern", „Für Dienstplan aktivieren" (beide Planseiten, seit Sprint 4), „Erneut versuchen", „Filter zurücksetzen", „Abbrechen" durchgängig | FIXED (Sprint 4/5) |
| „Speichern" überall gleiche Bedeutung? | Ja: persistiert den aktuellen Stand; Auto-Save (Team-Zeilen) ist als solches beschriftet („Änderungen … speichern automatisch") | OK |
| Destruktive Aktionen gleich dargestellt? | Immer ConfirmDialog (danger), Bestätigung immer „Endgültig löschen", Abbrechen initial fokussiert; 0× `window.confirm` | OK |
| Dialog-Titel der Löschbestätigungen | Variieren zwischen „X löschen?" und „X endgültig löschen?" – die Endgültigkeit steht überall in Beschreibung + Aktion | ACCEPTED_EXCEPTION: Titelvarianz ohne Missverständnisrisiko; Vereinheitlichung wäre reine Kosmetik |
| Primäraktionen gleich priorisiert? | Eine Primäraktion pro Kopf (PageHeader/PlanReviewHeader/Hero), Sekundäres zurückgenommen | OK |
| Gleiche Statusfarben gleich verwendet? | `--status-*`-Token + Command-Theme-Overrides; Sprint-5-Fix hob die letzten dunklen Chip-Texte auf die Token-Farben | FIXED |
| Page Header gleich aufgebaut? | `ui/PageHeader` auf allen 9 Seiten + Editor-Wizard; alte Komponente gelöscht | FIXED (Sprint 4) |
| Gleiche Abstände? | Token-basiert in ui-Primitives; Seiten-CSS nutzt historische px-Werte konsistent pro Seite | ACCEPTED_EXCEPTION: px-Werte pro Seite einheitlich; Token-Vollmigration ist mechanische Folgearbeit ohne sichtbaren Effekt |
| Noch Legacy-Buttons? | ~18 `.btn`-Verwendungen (Planseiten, Editor-Wizard/-Navigation, Karten-Aktionen) neben `ui/Button` | DEFERRED: rein mechanischer Tausch; identische Optik über gemeinsame Tokens, kein Nutzerunterschied |
| Noch alte Card-Klassen? | Seitenspezifische `*card*`-Klassen (team-, archive-, memory-, dashboard-) | ACCEPTED_EXCEPTION: bewusste Sprint-4-Entscheidung (CORE_PAGES_SPEC §7) – Strukturen zu unterschiedlich für eine generische Karte |
| Native Confirm-Dialoge? | 0 | FIXED (Sprint 1) |
| Konkurrierende Toastsysteme? | 1 zentraler ToastProvider | FIXED (Sprint 1) |
| Alte `.status`-Banner? | 0 (letzter in Sprint 4 migriert) | FIXED |
| Zwei Spinner-Implementierungen | `.spinner` (Alt) und `ui-btn`-Spinner koexistieren, optisch gleichwertig | DEFERRED: mit der `.btn`-Migration zusammenlegen |
| `PlanningRulesPanel`-Leerzustand | nutzt noch `.dashboard-empty`-Klasse statt `ui/EmptyState` | DEFERRED: funktional vollständig (Text + Filter-Reset vorhanden), reiner Klassentausch |

## 2. Copy und Terminologie (Phase 9)

Programmatischer Scan über alle UI-Strings:

- **Keine englischen Aktions-/Fehlertexte** („Retry", „Submit", „Fetch
  failed", „Loading…"): 0 Treffer.
- **Keine Backend-Enums im sichtbaren Text:** der einzige Kandidat
  (`show.confidence` im Gedächtnis) liefert bereits deutsche Werte
  („niedrig/mittel/hoch/bestätigt"); Datenstatus wird über
  `dataStatusLabel()` übersetzt („Datenbereit/Lernt/Neu").
- **API-Fehler:** zentral über `lib/api.ts` - Backend-Detail-Texte
  (deutsch aus FastAPI), „Das lokale Backend ist nicht erreichbar…"
  bei Netzwerkfehlern, Sprint-5-Härtung für Validierungsfehler
  („Ungültige Eingabe – bitte die Angaben prüfen." statt
  `[object Object]`). Keine rohen Python-/SQLite-Fehler im UI.
- **Verben:** Speichern/Aktivieren/Löschen/Abbrechen/Erneut versuchen/
  Zurücksetzen konsistent (Sprint-4-Vereinheitlichung bestätigt).

## 3. Console-Sweep (Phase 11)

- **Production:** alle 9 Kernseiten ohne Errors/Warnings/Pageerrors
  (Playwright-Protokoll, Erstladen + networkidle).
- **Development:** Interaktionspass auf dem Editor (Ansicht Woche/Tag,
  Dichtewechsel, Zellbearbeitung, Undo, Wochenwechsel) ohne Meldungen;
  alle übrigen Seiten liefen während der Sprint-Prüfungen durchgehend
  mit Konsolen-Monitoring - keine reproduzierbaren Meldungen.
- Einzige bekannte dev-only Erscheinung: das `nextjs-portal`-Overlay
  taucht in Fokus-Ketten der Dev-Umgebung auf (nicht in Produktion).
- Keine Unterdrückung von console.error/warn im Code.
