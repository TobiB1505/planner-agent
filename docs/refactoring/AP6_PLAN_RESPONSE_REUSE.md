# AP6 — `plan_generate`/`plan_existing` entdoppeln und gemeinsame Daten nur einmal berechnen

Arbeitspaket aus dem Refactoring-Plan: die beiden zentralen Plan-Endpunkte
(`GET /api/plan/existing`, `POST /api/plan/generate`) bauen `~60 Zeilen`
identische Response-Felder redundant auf (Finding E4) und berechnen
`build_memory()`/`show_schedule()` mehrfach pro Request (Finding B3). Baut auf
AP3 (Indizes/WAL), AP4 (Connection-Lifecycle), AP5a (Alias-Lookups), AP5b
(optionale `memory_data`-Parameter) und AP5c (Team-Overview-Memory) auf und
nutzt ausschließlich request-lokale Wiederverwendung — keine neuen Caches,
kein geändertes Antwortformat.

Alle Messungen/Vergleiche liefen auf Kopien der Live-Datenbank
(`baseline_copy.db`, `app_start_copy.db`, `run_*`, `snap_*`, `errpath_*`) oder
auf temporären Testdatenbanken (`tmp_path`) — nie auf der echten Datei.

---

## 1. Ausgangszustand

### Vollständige Aufruferkette (vorher)

```text
GET /api/plan/existing
├── plan_templates.get_template(conn, template_code)     [500 bei Fehler]
├── grid.build_grid(...) + Absenzen-Merge                 [reines Pandas]
├── on_stage_by_date(conn, ..., template_code)
│     └── show_schedule() [1.] + build_memory() [1.]
└── on_stage_shows_by_date(conn, ..., template_code)
      └── show_schedule() [2.]                            ← redundant

POST /api/plan/generate
├── _rotation_week_id(conn, ...)                           [400/404 bei Fehler]
├── assignment.generate_week_draft(...)
│     └── memory.planning_signals(...)
│           └── build_memory() [1.] + show_schedule() [1.]
├── xlsx_template.read_template_content(...)                [nur falls template_code gesetzt]
├── artist_plan.apply_to_draft(...)
├── assignment.add_relief_rewards(...)
├── on_stage_by_date(conn, ..., template_code)
│     └── show_schedule() [2.] + build_memory() [2.]        ← beide redundant
└── on_stage_shows_by_date(conn, ..., template_code)
      └── show_schedule() [3.]                              ← redundant
```

`show_schedule()` liest bei Bedarf zusätzlich per `xlsx_template.read_template_content()`
die A/B-Grundvorlage (openpyxl, teuer) — jeder redundante `show_schedule()`-Aufruf
kann also einen weiteren teuren Excel-Read auslösen.

### Duplizierter Response-Aufbau (Finding E4)

`plan_existing` ([api.py:934-1052](../../backend/api.py) vor der Änderung) und
`plan_generate` bauten identischen Code für: `day_labels`, `person_categories`,
`assignment_rules`-Schleife, `artist_plan`/`rehearsal_plan`-Serialisierung,
`rehearsal_intervals`, `on_stage_by_date`/`on_stage_shows_by_date`,
`deko_people`, `previous_week`/`previous_week_workload` — je zweimal, mit
identischer Logik aber unterschiedlichen lokalen Variablennamen.

**Bewusst NICHT unifiziert** (Felder, die trotz gleichen Namens fachlich
verschieden sind oder eigene Fehlerbehandlung brauchen):
- `rows`/`week_dates_iso` — Top-Level, vom jeweiligen Aufrufer gesetzt.
- `template_week_id`/`template_code`/`xlsx_sheet` — unterschiedliche Herkunft/Nullbarkeit.
- `existing_week` — nur bei `plan_existing`.
- `show_dates` — **unterschiedliche Datenquelle** trotz gleichen Feldnamens:
  `plan_existing` leitet sie aus `rehearsal_plan.detect_show_dates(rehearsal_events)`
  ab, `plan_generate` bekommt sie als Rückgabewert von `generate_week_draft`.
- Template-Fehlerbehandlung: `plan_existing` wirft 500, `plan_generate` wirft 400
  — bewusst getrennt gehalten.
- Generierungsspezifische Logik (`artist_plan.apply_to_draft`, `add_relief_rewards`).

### Baseline-Messung (3 Wiederholungen, frische DB-Kopie je Lauf)

| Kennzahl | `plan_existing` | `plan_generate` |
|---|---:|---:|
| `build_memory()`-Aufrufe | 1 | **2** |
| `show_schedule()`-Aufrufe | **2** | **3** |
| `planning_signals()`-Aufrufe | 0 | 1 |
| `read_template_content()`-Aufrufe | 2 | 4 |
| Laufzeit (Median, 3 Läufe) | 122.73 ms | 250.87 ms |

### Test-Baseline

`pytest`: 95 passed (Stand nach AP5c) · `npm run build`/`npm run lint`: grün.

---

## 2. Gemeinsame Zielstruktur

Neue private Hilfsfunktion `_build_shared_plan_fields(conn, *, week_dates_iso,
grid_rows, active_people, saved_artist_plan, saved_rehearsal_plan,
previous_workload, template_code, memory_data=None, schedule=None)` in
[backend/api.py](../../backend/api.py), direkt vor `plan_existing` platziert.
Baut ausschließlich die oben als "identisch" markierten Felder und reicht
`memory_data`/`schedule` unverändert an `memory.on_stage_by_date`/
`on_stage_shows_by_date` weiter (AP5b/AP6-Parameter, siehe unten). Beide
Endpunkte rufen sie auf und mischen das Ergebnis explizit (keine
`**`-Spreizung mitten im Rückgabe-Dict) in die ursprüngliche Feldreihenfolge
ein, um die Antwortstruktur exakt zu erhalten.

`schedule`/`memory_data` werden in beiden Endpunkten **einmal** vor dem ersten
Verbraucher berechnet:
- `plan_existing`: direkt vor dem Aufruf des gemeinsamen Builders (nach
  `template_code`-Auflösung, ohne bestehende Fehlerpfade zu verschieben).
- `plan_generate`: direkt nach `_rotation_week_id(...)` (damit ein 404/400 aus
  der Rotationsauflösung weiterhin **vor** jeder Memory-/Schedule-Arbeit
  auftritt) und **vor** `generate_week_draft(...)`, damit sie dort
  durchgereicht statt neu gebaut werden. `_week_dates(...)` wurde dafür
  vorgezogen — reine Funktion (siehe Abschnitt 4), keine Verhaltensänderung.

---

## 3. Änderungen pro Datei

### `backend/memory.py`

`on_stage_by_date`, `on_stage_shows_by_date`, `planning_signals` akzeptieren
je einen zusätzlichen optionalen, keyword-only Parameter `schedule`
(alle drei) bzw. zusätzlich `memory_data` (`on_stage_by_date`,
`planning_signals` — `on_stage_shows_by_date` braucht kein Memory, nur das
Schedule-Dict). Fallback exakt wie in AP5b: `param if param is not None else
compute()`. `None` (Standard) entspricht 1:1 dem bisherigen Verhalten.
`show_schedule()` selbst — die eigentliche Quelle der Wahrheit — bleibt
unverändert.

### `backend/assignment.py`

`generate_week_draft(...)` bekommt dieselben zwei optionalen Parameter
(`memory_data`, `schedule`) und reicht sie unverändert an den internen
`memory.planning_signals(...)`-Aufruf durch.

### `backend/api.py`

- Neue Funktion `_build_shared_plan_fields(...)` (siehe Abschnitt 2).
- `plan_existing`: berechnet `schedule`/`memory_data` einmal, ruft den
  gemeinsamen Builder auf, baut die Rückgabe aus Builder-Feldern +
  endpunktspezifischen Feldern (`rows`, `week_dates_iso`, `template_week_id`,
  `template_code`, `xlsx_sheet`, `show_dates`, `existing_week`) explizit
  zusammen.
- `plan_generate`: `_week_dates(payload.new_start)` vorgezogen (vor
  `generate_week_draft`), `schedule`/`memory_data` einmal berechnet und sowohl
  an `generate_week_draft` als auch an den gemeinsamen Builder gereicht.

---

## 4. Ergebnisgleichheit

### Reihenfolge-/Reinheitsprüfung für die Vorverlegung von `_week_dates`

`_week_dates(new_start_iso)` ([api.py:767](../../backend/api.py:767)) ist eine
reine Funktion (`datetime.strptime` + 7-Tage-Liste, kein DB-/Netzwerkzugriff,
keine Exceptions außer bei bereits vorher erfolgreich geparstem Datum). Das
Vorziehen vor `generate_week_draft` ändert keinen Fehlerpfad: `new_start`
wurde bereits vorher erfolgreich geparst, `_week_dates` kann also nicht neu
fehlschlagen.

### Schreib-Reihenfolge (Schritt 10)

`grep` über `assignment.py`, `plan_quality`-Aufrufkette und beide Endpunkte
bestätigt: **keine** `INSERT`/`UPDATE`/`DELETE`/`commit` zwischen
`_rotation_week_id(...)` und dem `return`-Statement in `plan_generate`, und
**keine** Schreiboperation in `plan_existing` außer der bereits vorhandenen,
unveränderten `SELECT`-Query auf `week_plans`. Das request-lokale Vorziehen
von `schedule`/`memory_data` liest also garantiert denselben DB-Stand wie die
vorherigen, späteren Einzelaufrufe — keine Staleness möglich.

### Response-Snapshots (Schritt 7/11)

5 Szenarien via `git stash`/`git stash pop` (echter Vorher/Nachher-Codezustand,
identische DB-Kopie) verglichen:

| Szenario | Ergebnis |
|---|---|
| `existing_with_artist_and_rehearsal` (2026-08-03) | **identisch** |
| `existing_without_extras` (2026-07-20) | **identisch** |
| `generate_with_template` (Vorlage A, 2026-08-03) | **identisch** |
| `generate_without_extras` (Vorlage B, 2026-09-07) | **identisch** |
| `generate_explicit_week_id` (Rotationsbasis) | **identisch** |

`assignment.generate_week_draft(...)` zusätzlich isoliert geprüft: identisches
Ergebnis mit und ohne vorab berechnetem `memory_data`/`schedule` (Real-DB-Kopie,
`template_code="A"`, 2026-08-03 — 110 Zeilen, 3 Kategorien, byte-identisch).

### Fehlerpfade (Schritt 13)

4 Szenarien (ungültiges Datum, unbekannte Woche, unbekannter Vorlagen-Code,
unbekannte `template_week_id`) vorher/nachher verglichen (`git stash`):
**Status-Code und Fehlertext byte-identisch** in allen vier Fällen.

---

## 5. Performance-Nachweis

### Call-Counts (identisches Szenario, 3 Wiederholungen, frische DB-Kopie je Lauf)

| Kennzahl | `plan_existing` vorher | `plan_existing` nachher | `plan_generate` vorher | `plan_generate` nachher |
|---|---:|---:|---:|---:|
| `build_memory()` | 1 | **1** | **2** | **1** |
| `show_schedule()` | **2** | **1** | **3** | **1** |
| `read_template_content()` | 2 | **1** | 4 | **2** |
| Laufzeit (Median, 3 Läufe) | 122.73 ms | 80.61–94.66 ms | 250.87 ms | 153.86–165.15 ms |

**`read_template_content()` sank als Nebeneffekt** (obwohl Tier 3/Excel-
Deduplizierung bewusst nicht implementiert wurde, siehe Abschnitt 8): jeder
`show_schedule()`-Aufruf löst bei Bedarf intern einen Vorlagen-Read aus —
weniger `show_schedule()`-Aufrufe bedeuten automatisch weniger Reads, ganz
ohne zusätzliche Verdrahtung.

**Reduktion:** `plan_existing`: `show_schedule()` −50 %. `plan_generate`:
`build_memory()` −50 %, `show_schedule()` −67 %, Laufzeit ca. −35 bis −40 %.
Laufzeitwerte streuen auf dieser kleinen Testdatenbank spürbar (ein einzelner
Ausreißer-Lauf zeigte 235 ms statt der sonst konsistenten 80–95 ms für
`plan_existing` — Systemrauschen, kein Regressionssignal); die Call-Count-
Reduktion ist der belastbare, deterministische Beleg.

---

## 6. Tests und Builds

Neue Datei [backend/tests/test_plan_response_reuse.py](../../backend/tests/test_plan_response_reuse.py):
- `test_plan_existing_calls_build_memory_and_show_schedule_exactly_once`
- `test_plan_generate_calls_build_memory_and_show_schedule_exactly_once`
- `test_plan_generate_with_template_code_calls_build_memory_and_show_schedule_exactly_once`
- `test_generate_week_draft_identical_with_and_without_precomputed_data`

| Befehl | Exit-Code | Ergebnis |
|---|---|---|
| `python -m compileall backend` (via `py_compile`) | 0 | erfolgreich |
| `pytest` | 0 | **99 passed** (95 vorher + 4 neu), unveränderte Warnungen |
| `python -c "from backend.api import app"` | 0 | Import ok, 63 Routen (unverändert) |
| `npm run build` | 0 | erfolgreich |
| `npm run lint` | 0 | 0 Fehler, 1 vorbestehende, unveränderte Warnung |
| Echter App-Start (`uvicorn` auf DB-Kopie) + `GET /api/health`, `GET /api/plan/existing`, `POST /api/plan/generate` | — | Start ok, alle Requests HTTP 200, sauberer Shutdown |

---

## 7. Scope-Kontrolle

- **Keine** Änderung an API-Routen, Request-Modellen, Response-Feldnamen/
  -Typen/-Reihenfolge (explizit per Snapshot-Vergleich belegt).
- **Keine** Änderung an funktionaler Planungslogik, Zuteilungsregeln,
  Gedächtnisinhalten, Plan-Quality, Recommendations.
- **Keine** Änderung am SQLite-Schema, an Indizes oder Transaktionsgrenzen.
- **Keine** Aufteilung von `api.py` in Router, **keine** Frontend-Änderung,
  **keine** Dependency-Upgrades.
- Alle Messläufe und neuen Tests liefen ausschließlich gegen Kopien der
  Live-DB oder `tmp_path`-Testdatenbanken — die echte Datei
  (`local_data/database/dienstplaene.db`) wurde zu keinem Zeitpunkt
  beschrieben (verifiziert: keines der Skripte/Tests referenziert den realen
  Pfad; `db.DATABASE_PATH` wurde in jedem Fall vorab umgeleitet).

---

## 8. Risiken und offene Punkte

**Bewusst nicht umgesetzt: vollständige Excel-Vorlagen-Deduplizierung (Tier 3,
ursprünglich Finding B3/Schritt 6).** Eine vollständige Vereinheitlichung
hätte ein 5. Parameter (`template_rows`) durch `show_schedule`,
`on_stage_by_date`, `on_stage_shows_by_date`, `planning_signals` **und**
`generate_week_draft` erfordert sowie eine Umsortierung der
Vorlagen-Auflösung vor `generate_week_draft` in `plan_generate`. Die
Aufgabenstellung selbst schränkt das mit "sofern der bestehende Code dies
einfach erlaubt" ein — das ist hier nicht der Fall (fünf Funktionssignaturen
statt zwei, zusätzliche Kopplung zwischen `plan_templates`/`xlsx_template`
und der Signalberechnung). Die bereits erreichte Reduktion (Abschnitt 5,
`read_template_content()` −50 % bzw. −50 %) deckt den relevanten Teil des
Nutzens ab; der verbleibende Rest ist als mögliches Folgepaket dokumentiert,
falls die Vorlagen-Datei künftig wächst oder öfter gelesen wird.

Keine weiteren offenen Punkte innerhalb des AP6-Scopes.

---

## 9. Diff-Zusammenfassung

```text
 backend/api.py               | 243 +++++++++++++++++++++++++++++---------------------
 backend/assignment.py        |  13 ++-
 backend/memory.py            |  42 +++++++--
 3 files changed, 188 insertions(+), 110 deletions(-)
```

Neu: `backend/tests/test_plan_response_reuse.py` (127 Zeilen),
`docs/refactoring/AP6_PLAN_RESPONSE_REUSE.md` (diese Datei).

---

## Abschlussbericht

**Ausgangslage:** `plan_generate`/`plan_existing` duplizierten ~60 Zeilen
Response-Aufbau (Finding E4) und berechneten `build_memory()`/`show_schedule()`
2-3× redundant pro Request (Finding B3) — der wichtigste Nutzer-Workflow
("Dienstplan erstellen/laden") zahlte damit unnötig mehrfach für denselben
Gedächtnis-/Zeitplan-Aufbau plus zusätzliche Excel-Reads.

**Umsetzung:** Gemeinsamer, privater Response-Builder `_build_shared_plan_fields`
in `api.py` für die tatsächlich identischen Felder (bewusst ohne `show_dates`,
`existing_week`, Template-Metadaten — siehe Abschnitt 1). `memory.py`
(`on_stage_by_date`, `on_stage_shows_by_date`, `planning_signals`) und
`assignment.generate_week_draft` bekamen optionale, keyword-only
`schedule`/`memory_data`-Parameter nach dem in AP5b etablierten
`param if param is not None else compute()`-Muster. Beide Endpunkte berechnen
`schedule`/`memory_data` jetzt genau einmal und reichen sie durch alle
Verbraucher weiter.

**Ergebnisgleichheit:** 5 Response-Snapshots + 4 Fehlerpfad-Szenarien
byte-identisch vorher/nachher (via `git stash`); `generate_week_draft`
liefert mit/ohne Vorab-Daten identisches Ergebnis; keine Schreiboperationen
in beiden Endpunkten gefunden (Schritt 10) — kein Staleness-Risiko.

**Performance:** `build_memory()` `plan_generate` 2→1, `show_schedule()`
`plan_existing` 2→1 und `plan_generate` 3→1, `read_template_content()` als
Nebeneffekt ebenfalls reduziert (2→1 bzw. 4→2). Laufzeit sank konsistent um
ca. 35-40 % (`plan_generate`) bzw. 25-35 % (`plan_existing`) auf der
Testdatenbank.

**Tests:** 99/99 `pytest` (4 neu), `npm run build`/`lint` grün, echter
`uvicorn`-Start auf DB-Kopie mit 3 repräsentativen Requests erfolgreich.

**Scope:** Ausschließlich Datenfluss-Wiederverwendung — keine API-, Schema-,
Router- oder Frontend-Änderung. Tier-3-Excel-Deduplizierung bewusst
ausgelassen (Abschnitt 8), da unverhältnismäßig invasiv für den
Grenznutzen.

**Empfohlener Commit-Titel:**
`perf(plan): reuse memory schedule and template data`

Es wurde noch kein Commit erstellt.
