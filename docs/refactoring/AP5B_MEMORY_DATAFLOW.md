# AP5b — Bereits berechnetes Memory kontrolliert weiterreichen

Arbeitspaket aus dem Refactoring-Plan: unnötige Wiederholungen von
`build_memory()` innerhalb eines Request-/Funktionspfads vermeiden, indem
betroffene Funktionen optional bereits berechnete Memory-Daten entgegennehmen
können. Baut auf AP3 (Indizes/WAL), AP4 (Connection-Lifecycle) und AP5a
(gebündelte Alias-Lookups) auf und erhält alle drei unverändert. Keine
vollständige Optimierung von `build_team_overview` (AP5c), keine Änderung an
`plan_generate`/`plan_existing` (AP6), kein globaler oder requestübergreifender
Cache.

Alle Messungen/Vergleiche liefen auf Kopien der Live-Datenbank oder auf
temporären Testdatenbanken (`tmp_path`) — nie auf der echten Datei.

---

## Vorher

### Aufrufermatrix

| Funktion | Modul | direkter `build_memory`-Aufruf | Aufrufer | kann Memory erhalten? | Ergebnisformat |
|---|---|---:|---|---:|---|
| `build_memory` | `memory.py` | — (ist die Quelle) | `memory_for_person`, `on_stage_by_date`, `planning_signals`, `suggest_free_days`, `api.memory_overview`, `recommendation_engine._task_preferences`, `dashboard.dashboard_snapshot`, `plan_quality._preference_lookup` | n/a | `dict` (siehe Schritt 2) |
| `memory_for_person` | `memory.py` | ja (immer, vor AP5b) | `api.memory_person` (2×), `memory_engine.entries_for_person`, `employee_stats.calculate_employee_statistics` | **ja (neu)** | `dict \| None` |
| `entries_for_person` | `memory_engine.py` | indirekt via `memory_for_person` | `api.intelligence_employee_profile`, `upsert_manual_entry`, `delete_manual_entry`, `team_overview.build_team_overview` | **ja (neu)** | `list[dict]` |
| `calculate_employee_statistics` | `employee_stats.py` | indirekt via `memory_for_person` — **nur bei Cache-Miss** | `api.intelligence_employee_profile`, `team_overview.build_team_overview`, `upsert_skill` | **ja (neu)** | `dict` |
| `_preference_lookup` | `plan_quality.py` | ja (immer, vor AP5b) | `calculate_plan_quality` | **ja (neu)** | `dict[str, set[str]]` |
| `calculate_plan_quality` | `plan_quality.py` | indirekt via `_preference_lookup` | `api.intelligence_plan_quality`, `dashboard.dashboard_snapshot` | **ja (neu)** | `dict` |
| `_task_preferences` | `recommendation_engine.py` | ja (immer, vor AP5b) | `recommend` | **ja (neu)** | `dict[str, set[str]]` |
| `recommend` | `recommendation_engine.py` | indirekt via `_task_preferences` | `api.intelligence_recommendations` | nein (kein Wiederverwendungsbedarf gefunden, siehe unten) | `dict` |

**Kennzeichnung:**
1. Funktionen, die **immer** vollständiges Memory benötigen: `_preference_lookup`, `_task_preferences`, `on_stage_by_date`, `planning_signals`, `suggest_free_days`, `api.memory_overview`.
2. Funktionen, die nur **eine Person** daraus lesen: `memory_for_person` (linearer Scan über `["people"]`).
3. Funktionen mit **bestehendem Zugriff auf bereits berechnetes Memory im selben Pfad** (die eigentlichen Ziele dieses Pakets): `api.intelligence_employee_profile` (ruft `calculate_employee_statistics` UND `entries_for_person` für dieselbe Person), `dashboard.dashboard_snapshot` (ruft `calculate_plan_quality` UND direkt `build_memory` für `active_memory`).
4. Funktionen mit **unabhängigem Aufruf und kompatiblem Fallback**: alle fünf angepassten Funktionen behalten `memory_data=None` als Standard und damit exakt das bisherige Verhalten für jeden nicht angepassten Aufrufer.

### Rückgabewert von `build_memory()`

```python
{
    "people": list[dict],                # sortiert nach (nicht aktiv, Name.casefold())
    "unmatched_rehearsal_names": list[dict],
    "meta": {"rehearsal_weeks": int, "duty_weeks": int},
}
```

- **Python-Typ:** `dict[str, Any]` — kein `TypedDict`/keine Restrukturierung (Scope-Vorgabe: Datenmodell unverändert).
- **Personenschlüssel:** `"people"` ist eine **Liste**, nicht nach `person_id` indiziert — `memory_for_person` durchsucht sie linear (`for entry in resolved["people"]: if entry["person_id"] == person_id`).
- **Reihenfolge:** stabil sortiert, nicht aktive Personen zuletzt, dann alphabetisch (casefold).
- **Mutabilität:** repository-weite Suche über alle sechs geänderten Dateien nach Mutationsmustern (`[...] = `, `.pop(`, `del `) ergab **keinen** Treffer außerhalb reiner Lesezugriffe — kein Aufrufer verändert die Struktur. Deshalb: **keine** defensive Kopie eingeführt.

### Baseline-Testergebnisse (vor AP5b, identisch zum AP5a-Endstand)

`pytest`: 75 passed · `npm run build`/`npm run lint`: grün.

### Bestehende Call-Counts (kalter Statistik-Cache, Kopie der Live-DB)

| Pfad | `build_memory()`-Aufrufe |
|---|---:|
| `GET /api/intelligence/employees/{id}` (Profil) | **2** (1× `calculate_employee_statistics`, 1× `entries_for_person`) |
| `GET /api/dashboard/insights` (`dashboard_snapshot`) | **2** (1× `calculate_plan_quality`, 1× direkt für `active_memory`) |
| `POST /api/intelligence/plan-quality` | 1 |
| `POST /api/intelligence/recommendations` | 1 |
| `memory_for_person(conn, id)` einzeln | 1 |

---

## Umsetzung

### Verwendeter Memory-Typ

```python
# backend/memory.py
MemoryData = dict[str, Any]
```

Type Alias statt neuer Klasse — vermeidet unnötige Abstraktion und
Kopieraufwand, dokumentiert aber präzise per Docstring, was die Struktur
enthält (siehe oben).

### Neue optionale Parameter (alle keyword-only, Default `None`)

| Funktion | neuer Parameter | Fallback-Zeile |
|---|---|---|
| `memory.memory_for_person` | `memory_data: MemoryData \| None = None` | `resolved = memory_data if memory_data is not None else build_memory(conn)` |
| `memory_engine.entries_for_person` | `memory_data: memory.MemoryData \| None = None` | reicht durch an `memory.memory_for_person(conn, person_id, memory_data=memory_data)` |
| `employee_stats.calculate_employee_statistics` | `memory_data: memory.MemoryData \| None = None` | reicht durch an `memory.memory_for_person(...)`, nur auf dem Cache-Miss-Pfad erreicht |
| `plan_quality._preference_lookup` | `memory_data: memory.MemoryData \| None = None` | `resolved = memory_data if memory_data is not None else memory.build_memory(conn)` |
| `plan_quality.calculate_plan_quality` | `memory_data: memory.MemoryData \| None = None` | reicht durch an `_preference_lookup(conn, memory_data=memory_data)` |
| `recommendation_engine._task_preferences` | `memory_data: memory.MemoryData \| None = None` | `built = memory_data if memory_data is not None else memory.build_memory(conn)` |

Durchgehend **`memory_data if memory_data is not None else ...`**, nie
`memory_data or ...` — eine leere, aber explizit übergebene Struktur
(`{"people": [], ...}`) ist dadurch von „nichts übergeben" unterscheidbar und
löst bewusst **keinen** Fallback aus (Test:
`test_memory_for_person_empty_structure_is_not_treated_as_none`).

`recommend()` selbst erhält **keinen** neuen Parameter — es gibt im
Recommendation-Pfad nur eine einzige Stelle (`_task_preferences`), die Memory
benötigt; ein zusätzlicher Parameter auf `recommend()` hätte keinen
Wiederverwendungsnutzen und wäre reine Spekulation gewesen.

### Datenfluss je Funktionskette (die zwei tatsächlich behobenen Doppelaufrufe)

**`api.intelligence_employee_profile`** (`GET /api/intelligence/employees/{person_id}`):

```python
memory_data = memory.build_memory(conn)  # einmal
statistics = employee_stats.calculate_employee_statistics(..., memory_data=memory_data)
structured_memory = memory_engine.entries_for_person(conn, person_id, memory_data=memory_data)
```

Da `entries_for_person` **immer** Memory benötigt (kein Cache), entsteht durch
das Vorziehen **kein** zusätzlicher Aufwand im Cache-Hit-Fall (dort bleibt
`memory_data` beim Statistik-Aufruf schlicht ungenutzt) — reduziert nur den
echten Cache-Miss-Fall von 2 auf 1 Aufruf.

**`dashboard.dashboard_snapshot`**:

```python
memory_data = memory.build_memory(conn)  # einmal, vor calculate_plan_quality
quality = plan_quality.calculate_plan_quality(..., memory_data=memory_data)
active_memory = [p for p in memory_data["people"] if p["person_id"] in active_ids]
```

Vorher rief `calculate_plan_quality` (über `_preference_lookup`) selbst einmal
`build_memory` auf, und `dashboard_snapshot` direkt danach ein zweites Mal für
`active_memory` — beide ohne Schreiboperation dazwischen, identische
Datenbasis, gleicher synchroner Pfad (Schritt-9-Kriterien erfüllt).

### Bewusst nicht geänderte Pfade (dokumentiert, nicht umgesetzt)

- **`team_overview.build_team_overview`**: ruft pro Person sowohl
  `calculate_employee_statistics` als auch `entries_for_person` auf — beide
  bauen bislang unabhängig Memory neu auf (bis zu ~2× pro Person, also bis zu
  82 Aufrufe für 41 Personen). Das ist der mit Abstand größte verbleibende
  Posten, aber explizit **AP5c vorbehalten** („keine vollständige
  Optimierung von `build_team_overview`") — hier nicht angefasst. Die in
  diesem Paket neu geschaffenen optionalen `memory_data`-Parameter an
  `calculate_employee_statistics`/`entries_for_person` sind genau die
  Grundlage, die AP5c zum Beheben braucht (Ziel 5 dieses Pakets).
- **`plan_generate`/`plan_existing`**: rufen `memory.on_stage_by_date` UND
  `memory.on_stage_shows_by_date` auf (Ersteres selbst mit eigenem
  `build_memory`-Aufruf), `plan_generate` zusätzlich über
  `assignment.generate_week_draft` → `memory.planning_signals` (noch ein
  `build_memory`-Aufruf) — bis zu 2 Aufrufe pro `plan_generate`-Request.
  Explizit **AP6 vorbehalten** („Änderungen an `plan_generate` oder
  `plan_existing` – diese gehören zu AP6") — hier nicht angefasst,
  ausschließlich dokumentiert als Folgepaket.
- **`upsert_manual_entry`/`delete_manual_entry`**: rufen `entries_for_person`
  nur einmal auf (nach einem Schreibvorgang auf einer anderen Tabelle,
  `employee_memory`, die `build_memory()` gar nicht beeinflusst) — kein
  Doppelaufruf vorhanden, keine Änderung nötig.

---

## Nachher

### `build_memory()`-Aufrufe pro Pfad (kalter Statistik-Cache, identische Kopie der Live-DB)

| Pfad | Vorher | Nachher |
|---|---:|---:|
| `memory_for_person(conn, id)` mit externem Memory | 1 | **0** |
| `GET /api/intelligence/employees/{id}` (Profil) | 2 | **1** |
| `GET /api/dashboard/insights` (`dashboard_snapshot`) | 2 | **1** |
| `POST /api/intelligence/plan-quality` | 1 | 1 (unverändert, jetzt regressionsgeschützt) |
| `POST /api/intelligence/recommendations` | 1 | 1 (unverändert, jetzt regressionsgeschützt) |

### Laufzeitvergleich (kalter Cache, dieselbe Kopie der Live-DB, indikativ)

| Pfad | Vorher | Nachher |
|---|---:|---:|
| `GET /api/intelligence/employees/{id}` | 57.5 ms | 45.6 ms |
| `GET /api/dashboard/insights` | 41.4 ms | 24.9 ms |
| `POST /api/intelligence/plan-quality` | 19.6 ms | 20.2 ms (Rauschen, unverändert) |
| `POST /api/intelligence/recommendations` | 19.5 ms | 19.7 ms (Rauschen, unverändert) |

*Grenzen der Messung:* kleine Live-Datenbasis (41 Personen), Einzelmessung
ohne Wiederholung — die Millisekunden-Werte sind indikativ, nicht
hochpräzise. Die belastbare, strukturell garantierte Eigenschaft ist die
**Aufrufzahl** (2→1 bzw. 1→0), nicht die absolute Millisekundenzahl.

### API-Snapshot-Vergleich (Schritt 13)

13 Endpunkt-Antworten verglichen (5× `GET /api/memory/{id}`, 5× `GET
/api/intelligence/employees/{id}`, 1× `GET /api/dashboard/insights`, 1× `POST
/api/intelligence/plan-quality`, 1× `POST /api/intelligence/recommendations`)
zwischen dem Stand vor AP5b (`git stash`) und danach, auf derselben Kopie der
Live-Datenbank: **13/13 JSON-Antworten byte-identisch** (nach
`sort_keys`-Normalisierung). Keine Abweichung zu dokumentieren.

### Ergebnisgleichheit (Unit-Tests)

`backend/tests/test_memory_dataflow.py` (15 Tests):
`memory_for_person` (ohne/mit Memory, unbekannte Person, leere Struktur, 0
zusätzliche Aufrufe), `entries_for_person` (Äquivalenz, 0 zusätzliche
Aufrufe), `calculate_employee_statistics` (Äquivalenz, Cache-Verhalten
unverändert, 0 zusätzliche Aufrufe bei Cache-Miss), Plan-Quality (Äquivalenz,
`dashboard_snapshot` = 1 Aufruf statt 2), Recommendations
(`_task_preferences`-Äquivalenz, `recommend` ≤ 1 Aufruf), sowie der
end-to-end reproduzierte, behobene Doppelaufruf aus
`intelligence_employee_profile` (0 zusätzliche Aufrufe bei gemeinsam
genutztem Memory).

### Vollständige Testergebnisse

| Befehl | Exit-Code | Ergebnis |
|---|---|---|
| `python -m compileall backend` | 0 | erfolgreich |
| `pytest` | 0 | **90 passed** (75 vorher + 15 neu), 9 unveränderte unabhängige Warnungen |
| `python -c "from backend.api import app"` | 0 | Import ok, 63 Routen |
| `npm run build` | 0 | erfolgreich, 1 vorbestehende unabhängige Warnung |
| `npm run lint` | 0 | 0 Fehler, 1 vorbestehende Warnung |
| `python -m backend.run_local` + repräsentative Requests | — | Start ok; `plan/save`, `plan-quality`, `recommendations`, `memory/{id}` — alle wie erwartet, keine Fehler im Log |
| Python-Type-Check | — | kein Type-Checker (mypy/pyright) im Projekt konfiguriert — unverändert seit AP4/AP5a |

### Offene Folgearbeiten

- **AP5c** (angekündigt): `build_team_overview` pro Person nur noch einmal
  Memory aufbauen statt bis zu 2× — mit den in AP5b geschaffenen optionalen
  Parametern direkt umsetzbar.
- **AP6**: `plan_generate`/`plan_existing` bündeln ihre mehrfachen
  `build_memory`-Aufrufe (`planning_signals`, `on_stage_by_date`,
  `on_stage_shows_by_date`) noch nicht — hier dokumentiert, nicht umgesetzt.
