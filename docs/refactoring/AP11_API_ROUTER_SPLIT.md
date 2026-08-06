# AP11 — FastAPI-Backend in Router aufteilen

Reines Move-Only-Refactoring: die 1.858 Zeilen große `backend/api.py` mit 59
Endpunkten aus 8 fachlich unterschiedlichen Bereichen wurde in
`backend/routers/*.py` aufgeteilt. `api.py` enthält jetzt nur noch
App-Erstellung, Middleware, Lifespan und Router-Registrierung (55 Zeilen).
Keine API-Pfade, HTTP-Methoden, Request-/Response-Modelle, Statuscodes,
Business- oder Datenbanklogik geändert — verifiziert per byte-identischem
OpenAPI-Schema vor/nach der Umstellung.

---

## Vorher

### Größe und Verantwortlichkeiten (Schritt 1)

`backend/api.py`: 1.858 Zeilen, 59 Endpunkte, 9 fachliche Bereiche in einer
Datei (Team, Weeks/Archiv, Dashboard, MA-Gedächtnis, Upload/Import,
Künstlerplan, Probenplan, Plan-Editor, Intelligence, Settings, System) plus
alle zugehörigen Pydantic-Modelle und privaten Hilfsfunktionen.

Vollständige Endpunkt-Tabelle (Route | Methode | Zielrouter):

| Bereich | Routen | Zielrouter |
|---|---|---|
| Team | `GET/POST /api/team`, `PUT/DELETE /api/team/{id}`, `GET /api/people/active` | `people.py` |
| Weeks/Archiv | `GET /api/weeks`, `GET/DELETE /api/weeks/{id}` | `plans.py` |
| Plan-Editor | `GET /api/plan/templates`, `POST /api/plan/free-suggestion`, `GET /api/plan/existing`, `POST /api/plan/generate`, `POST /api/plan/save`, `POST /api/xlsx/generate` | `plans.py` |
| Dashboard | `GET /api/dashboard/{overview,person-totals,category-matrix,department-activity,fairness-alerts,insights}`, `GET /api/planning-rules` | `dashboard.py` |
| MA-Gedächtnis | `GET /api/memory`, `GET /api/memory/{id}`, `PUT /api/memory/{id}/{show,free,task}` | `memory.py` |
| Upload/Import | `POST /api/upload/{pdf,xlsx/sheets,xlsx}`, `GET /api/known-department-tokens`, `POST /api/import/save` | `imports.py` |
| Künstlerplan | `POST /api/artist-plans/upload/sheets`, `POST /api/artist-plans/import`, `GET /api/artist-plans/empty`, `POST/GET /api/artist-plans`, `GET/DELETE /api/artist-plans/{id}`, `GET /api/artist-plans/{id}/export` | `imports.py` |
| Probenplan | `POST /api/rehearsal-plans/upload/sheets`, `POST /api/rehearsal-plans/import`, `POST/GET /api/rehearsal-plans`, `GET/DELETE /api/rehearsal-plans/{id}` | `imports.py` |
| Intelligence | `GET /api/intelligence/employees(/{id})`, `PUT/DELETE .../skills(/{id})`, `POST/DELETE .../memory(/{id})`, `POST /api/intelligence/{recommendations,plan-quality}`, `GET /api/intelligence/audit` | `intelligence.py` |
| Settings | `GET/PUT /api/settings/{key}` | `settings.py` |
| System | `GET /api/health`, `GET /api/system/diagnostics`, `POST /api/system/restart` | `system.py` |

### Probleme (Ausgangslage)

Eine Datei für 9 fachlich unabhängige Bereiche bedeutete: jede Änderung an
einem Bereich (z. B. Memory-Overrides) landete im selben Diff wie parallele
Änderungen an einem anderen Bereich (z. B. Intelligence) — jeder AP dieser
Session-Serie, der `api.py` anfasste (AP7, AP9, AP10), musste denselben
Datei-Kontext neu laden. Git-Merge-Konflikte zwischen zwei parallel an
unterschiedlichen Fachbereichen arbeitenden Änderungen waren strukturell
vorprogrammiert.

---

## Umsetzung

### Gemeinsame Abhängigkeiten (Schritt 2)

Geprüft wurden alle globalen Helfer/Modelle auf echte Mehrfachnutzung über
Bereichsgrenzen hinweg. Nur diese sechs landeten in `backend/routers/shared.py`:

| Name | Genutzt von |
|---|---|
| `clean()` | plans, dashboard, memory, intelligence (19 Aufrufstellen) |
| `records()` | plans, dashboard |
| `_cors_origins()` | api.py (Middleware) + system.py (Diagnose-Feld `cors_origins`) |
| `_week_dates()` | plans, intelligence |
| `_grid_df_from_rows()` | plans, intelligence |
| `ImportAbsence` (Pydantic-Modell) | imports (`ImportSave`) + plans (`PlanGenerateRequest`, `FreeSuggestionRequest`) |

Alles andere (`_memory_response`, `_assignment_warnings`,
`_resolve_or_create`, `_resolve_with_choices`, `_archived_assignment_for_grid`,
`_build_shared_plan_fields`, `_rotation_week_id`, `_dir_diagnostic`,
`_intelligence_plan_data` u. a.) wird nur von einem einzigen Bereich
gebraucht und blieb bewusst lokal im jeweiligen Router — kein
`dependencies.py`-Sammelbecken für alles.

### Router-Struktur (Schritt 3-5)

```
backend/
├── api.py                 (55 Zeilen: App, Middleware, Lifespan, Router-Registrierung)
└── routers/
    ├── __init__.py
    ├── shared.py           (62 Zeilen: echte Cross-Domain-Helfer/Modelle)
    ├── people.py           (68 Zeilen, 5 Routen)
    ├── plans.py            (761 Zeilen, 9 Routen + Weeks/Archiv)
    ├── imports.py          (460 Zeilen, 19 Routen: Upload, Künstlerplan, Probenplan, Import-Save)
    ├── intelligence.py     (237 Zeilen, 9 Routen)
    ├── memory.py           (111 Zeilen, 5 Routen)
    ├── dashboard.py        (68 Zeilen, 7 Routen)
    ├── settings.py         (31 Zeilen, 2 Routen)
    └── system.py           (156 Zeilen, 3 Routen)
```

Jeder Router nutzt `router = APIRouter()` **ohne** `prefix`/`tags` — die
Pfade stehen bereits vollständig in jedem `@router.get(...)`-Decorator
(genau wie vorher bei `@app.get(...)`), ein zusätzlicher Prefix hätte sie
verdoppelt. `api.py` registriert alle acht Router unverändert über
`app.include_router(...)`.

### Zwei bewusste Abweichungen von der Beispielstruktur

- **`planning-rules` und `dashboard/insights` bleiben in `dashboard.py`**,
  nicht in einem separaten Intelligence-Topf: beide standen im Original
  bereits im selben `# ---------- Dashboard ----------`-Abschnitt
  bzw. tragen den `/api/dashboard/`-Pfadpräfix. Das erhält eine bereits
  bestehende Gruppierung, statt eine neue Kategorisierungsentscheidung zu
  treffen, die die Aufgabenstellung nicht verlangt.
- **Weeks/Archiv (`GET/DELETE /api/weeks...`) wandert zu `plans.py`**: kein
  eigener Bucket in der vorgegebenen Zielstruktur genannt, fachlich Teil der
  Planhistorie (`plan_existing` liest direkt aus `week_plans`).

### Endpunkte mechanisch verschoben (Schritt 4)

Jeder Endpunkt wurde 1:1 verschoben — Decorator, Parameter, Typen, Response,
Fehlerbehandlung und Code-Körper unverändert, nur `@app.` durch `@router.`
ersetzt. Keine Umbenennung, keine Vereinfachung, keine Zusammenfassung.
Einzige mechanisch unvermeidbare Nebenwirkung: der Modul-Logger in
`imports.py` heißt jetzt `backend.routers.imports` statt `backend.api`
(Python-Konvention `logging.getLogger(__name__)`) — rein kosmetisch für
Log-Zeilen, keine funktionale Änderung.

### Import-Zyklen (Schritt 6)

Router importieren ausschließlich `db`, Fachmodule (`grid`, `memory`,
`planning_rules`, ...) und `routers.shared` — nie `api.py` und nie
einen anderen Router. `api.py` importiert alle Router einmalig für
`include_router()`. Damit ist der einzige denkbare Zyklus (`api.py` →
Router → `api.py`) strukturell ausgeschlossen. Verifiziert:

```bash
python -c "import backend.api"     # ok, 63 Routes (59 + 4 FastAPI-intern)
python -m pyflakes backend/api.py backend/routers/*.py   # keine unbenutzten
                                                            # Imports, keine
                                                            # undefinierten Namen
```

---

## Nachher

### OpenAPI-Vergleich (Schritt 7)

`app.openapi()` vor und nach der Umstellung als JSON gespeichert und per
`diff` verglichen (sortierte Keys, identische Formatierung):

```
diff openapi_before.json openapi_after.json
→ keine Ausgabe (byte-identisch)
```

Alle Pfade, HTTP-Methoden, Parameter, Request-/Response-Schemas sind exakt
gleich geblieben. Tags waren vorher wie nachher nirgends gesetzt.

### Tests (Schritt 8)

`pytest` (3× hintereinander): **217 passed**, stabil, ~4,5 s pro Lauf.

Zwei bestehende Testdateien mussten wegen der neuen Modulstruktur angepasst
werden — reine Importpfad-Korrekturen, keine Assertion geändert:

| Datei | Änderung | Grund |
|---|---|---|
| `test_planning_rules_isolated.py` | `from backend.api import _assignment_warnings` → `from backend.routers.plans import _assignment_warnings` | Funktion liegt jetzt in `plans.py` |
| `test_person_lookup.py` | `api._resolve_or_create`/`api._assignment_warnings` → `plans._resolve_or_create`/`plans._assignment_warnings` | dito |
| `test_async_imports.py` | `monkeypatch.setattr(api, "extract_dienstplan", ...)` → `monkeypatch.setattr(imports_router, "extract_dienstplan", ...)` (3 Stellen) | `extract_dienstplan` wird jetzt in `imports.py` importiert und aufgerufen, nicht mehr in `api.py` |

Alle anderen Tests (u. a. `test_transaction_boundaries.py` mit seinen
`app.dependency_overrides`-basierten Fehlerinjektionstests aus AP10) liefen
unverändert durch — sie nutzen ausschließlich `api.app`/`db.*`, die von der
Umstellung nicht betroffen sind.

**API-Smoke-Tests** (zusätzlich zu pytest, gegen eine isolierte
Testdatenbank über den echten `TestClient`): 15 GET/PUT/POST-Aufrufe über
alle 8 Router (Health, Diagnose, Team, Weeks, Templates, Dashboard,
Planning-Rules, Memory, Department-Tokens, Artist-/Rehearsal-Plans,
Settings) — alle `< 500`. Zusätzlich ein voller Workflow-Test:
`plan/save` → `plan/existing` → `intelligence/employees` →
`intelligence/plan-quality` → `xlsx/generate` → `import/save` — alle `200`.

### Manueller Workflow (Schritt 9)

Gegen den echten lokalen Backend-Prozess (per `/api/system/restart` auf den
neuen Router-Code umgestellt) und das laufende Frontend im Browser
verifiziert:

- **Dashboard**: lädt Planqualität, Team-Balance, Entscheidungsbedarf mit
  echten Daten (`/api/dashboard/insights`, `/api/dashboard/fairness-alerts`).
- **Team**: 18 aktive Mitarbeiter mit Intelligence-Kennzahlen
  (`/api/team`, `/api/intelligence/employees`).
- **Dienstplan erstellen**: KW 32 lädt vollständig
  (`/api/plan/existing`), Planqualität 59/100 und 3 Konflikte korrekt
  berechnet (`/api/intelligence/plan-quality`) — beides live per
  Netzwerk-Log bestätigt.
- **System**: Diagnose zeigt „Backend: Erreichbar", „Datenbank: Verbunden",
  korrekte Laufzeit seit dem Neustart, alle Vorlagen/Ordner „Bereit"
  (`/api/system/diagnostics`).

Keine sichtbare Verhaltensänderung, keine neuen Konsolenfehler (ein
vorbestehender React-`useEffect`-Warnhinweis stammt aus einer unabhängigen,
zeitgleich laufenden Frontend-Änderung außerhalb von AP11 und wurde nicht
angefasst).

### Verbleibende Struktur

`plans.py` (761 Zeilen) und `imports.py` (460 Zeilen) sind die größten
Router, weil ihre Bereiche im Original bereits die meisten und am engsten
zusammenhängenden Endpunkte hatten (`_build_shared_plan_fields` verbindet
z. B. `plan_existing`/`plan_generate` untrennbar). Eine weitere Aufteilung
dieser beiden würde über reines Verschieben hinausgehen und war nicht
Teil dieses Arbeitspakets.
