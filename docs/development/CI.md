# CI — automatische Qualitätsprüfung

Sprint 1 (Production Hardening): `.github/workflows/ci.yml` prüft Backend
und Frontend bei jedem Push auf `main` und bei jedem Pull Request, in zwei
unabhängigen Jobs (ein Fehler in einem Bereich verschleiert nicht, ob der
andere grün ist).

---

## Lokaler Testlauf

### Backend

```bash
cd /pfad/zum/repo
python3 -m venv venv          # einmalig
source venv/bin/activate
pip install -r backend/requirements.txt
python -m pytest backend/tests -v
```

Erwartung: alle Tests grün. Jeder Test läuft in einem eigenen, frisch
migrierten PostgreSQL-Schema; der Guard in `backend/tests/conftest.py` bricht
die Suite ab, wenn `TEST_DATABASE_URL` auf eine gehostete oder
produktionsartige Datenbank zeigt.
(die autouse-Guard-Fixture in `backend/tests/conftest.py` lässt jeden Test
fehlschlagen, der versucht, die echte lokale Datenbank zu öffnen).

### Frontend

```bash
cd frontend
npm ci
npm run lint
npm run test    # vitest
npm run build
```

`npm run build` braucht kein laufendes Backend — `next.config.ts` löst die
Rewrite-Regel erst zur Laufzeit auf, nicht beim Build.

---

## CI-Ablauf

`.github/workflows/ci.yml`, ausgelöst bei `push` auf `main` und bei jedem
`pull_request`:

| Job | Runner | Schritte |
|---|---|---|
| `backend` | `ubuntu-latest`, Python 3.11, Service `postgres:16` | Checkout → Dependencies installieren → `pytest backend/tests -v` |
| `frontend` | `ubuntu-latest`, Node 20 | Checkout → `npm ci` → `npm run lint` → `npm run test` → `npm run build` |

**Python 3.11** seit der PostgreSQL-Migration. Vorher lief die CI bewusst auf
3.9, weil README.md damals "entwickelt/getestet mit Python 3.9.6"
dokumentierte. Das ist überholt: `psycopg[binary]>=3.1` setzt eine neuere
Version voraus, und 3.9 bekommt seit Oktober 2025 keine Sicherheitsupdates
mehr. README.md nennt entsprechend 3.11 als Mindestanforderung.

**`postgres:16` als Service-Container.** Die Testsuite läuft seit der
Migration gegen eine echte PostgreSQL-Instanz (ein eigenes Schema pro Test,
siehe `backend/tests/conftest.py`). Bewusst das offizielle `postgres`-Image
und kein Supabase-spezifischer Dienst: Supabase *stellt* PostgreSQL bereit,
die Anwendung *nutzt* PostgreSQL - sie darf technisch nicht an den Anbieter
gekoppelt sein. Deshalb braucht die CI auch keinerlei Supabase-Zugangsdaten.

**Node 20 LTS** erfüllt die dokumentierte Mindestanforderung ("Node.js 20.9
oder neuer") mit einer auf GitHub Actions gut unterstützten Version.

---

## Benötigte Variablen

**Keine Secrets.** Der Workflow setzt zwar vier Umgebungsvariablen, aber
keine davon ist geheim:

| Variable | Wert | Warum unkritisch |
|---|---|---|
| `TEST_DATABASE_URL` / `DATABASE_URL` | `postgresql://postgres:postgres@127.0.0.1:5432/planner_test` | Wegwerf-Dienst im selben Runner, nur über localhost erreichbar |
| `ENVIRONMENT` / `APP_ENV` | `test` | Wird vom Guard in `conftest.py` verlangt |

- `GEMINI_API_KEY` ist nirgends erforderlich — alle Tests, die Gemini-Aufrufe
  auslösen würden, mocken sie durchgehend per `monkeypatch`
  (`backend/tests/test_async_imports.py`).
- **Keine Supabase-Zugangsdaten.** Die Auth-Tests signieren ihre Tokens selbst
  (`backend/tests/auth_helpers.py`) und setzen die nötigen
  `SUPABASE_*`-Variablen im Test per `monkeypatch`
  (`backend/tests/test_auth_jwt.py`) bzw. für die Subprozess-Tests über
  `auth_helpers.apply_auth_env()`. Der asymmetrische JWKS-Pfad wird mit einem
  im Test erzeugten Schlüsselpaar und gemocktem Abruf geprüft. Es geht nie
  eine Anfrage an ein echtes Supabase-Projekt.
- Die Datenbank ist eine leere Wegwerfinstanz. Zusätzlich verweigert der
  Guard in `backend/tests/conftest.py` jede `TEST_DATABASE_URL`, die auf
  einen gehosteten Dienst zeigt oder deren Datenbankname nicht `test`
  enthält.
- Keine Produktionsdaten sind erreichbar oder werden verändert.

---

## Typische Fehler

| Symptom | Ursache | Fix |
|---|---|---|
| `ImportError: cannot import name '...' from 'backend.api'` | Ein Test importiert eine Funktion, die inzwischen in einen Router verschoben wurde (siehe AP11) | Importpfad auf `backend.routers.<name>` anpassen |
| Backend-Job bricht mit `RuntimeError` aus `_guard_test_database_url` ab | `TEST_DATABASE_URL` zeigt auf einen gehosteten Dienst oder eine produktionsartige Datenbank | Eine eigene Testdatenbank verwenden, deren Name `test` enthält (z.B. `planner_test`) |
| Backend-Job bricht mit "PostgreSQL-Testdatenbank ist nicht erreichbar" ab | Der `postgres`-Service ist nicht hochgekommen | Health-Check des Service-Containers im Workflow prüfen; lokal eine PostgreSQL-Instanz starten |
| `npm run lint` meldet neue Fehler | Ungenutzte Importe/Variablen, siehe ESLint-Ausgabe | Direkt beheben — Warnungen (kein Fehler) lassen den Job trotzdem grün durchlaufen, `error`-Level bricht ab |
| `npm run build` schlägt mit TypeScript-Fehlern fehl | `next build` führt eine vollständige Typprüfung aus | Fehlermeldung zeigt Datei+Zeile; lokal reproduzierbar mit `npm run build` |
| Frontend-Job: `npm ci` schlägt fehl | `package-lock.json` und `package.json` sind nicht synchron | Lokal `npm install` ausführen, `package-lock.json` committen |
| Backend-Job langsam/hängt bei `test_uvicorn_real_concurrency.py` | Ein echter uvicorn-Subprozess wird gestartet - kann bei Port-Konflikten scheitern | Läuft in CI isoliert (freier Port wird dynamisch ermittelt), lokal ggf. andere Prozesse auf 8000/3000 vorher stoppen |

---

## Warum zwei getrennte Jobs statt einem?

Ein einzelner sequenzieller Job hätte bei einem Frontend-Fehler nie zum
Backend-Test-Schritt geführt (oder umgekehrt) — man wüsste nicht, ob der
jeweils andere Bereich überhaupt noch grün ist. Mit zwei parallelen Jobs
zeigt die GitHub-UI beide Ergebnisse unabhängig voneinander an.
