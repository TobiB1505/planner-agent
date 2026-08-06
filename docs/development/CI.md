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

Erwartung: alle Tests grün, keine Verbindung zu `local_data/database/dienstplaene.db`
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
| `backend` | `ubuntu-latest`, Python 3.9 | Checkout → Dependencies installieren → `pytest backend/tests -v` |
| `frontend` | `ubuntu-latest`, Node 20 | Checkout → `npm ci` → `npm run lint` → `npm run test` → `npm run build` |

**Python 3.9** wurde bewusst gewählt, nicht die neueste Version — README.md
dokumentiert "entwickelt/getestet mit Python 3.9.6"; CI soll exakt den Stand
prüfen, der tatsächlich lokal verifiziert wurde. Ein Umstieg auf eine neuere
Python-Version ist eine eigene Entscheidung außerhalb dieses Sprints.

**Node 20 LTS** erfüllt die dokumentierte Mindestanforderung ("Node.js 18
oder neuer") mit einer auf GitHub Actions gut unterstützten Version.

---

## Benötigte Variablen

**Keine.** Die Pipeline braucht keine Secrets:

- `GEMINI_API_KEY` ist nirgends erforderlich — alle Tests, die Gemini-Aufrufe
  auslösen würden, mocken sie durchgehend per `monkeypatch`
  (`backend/tests/test_async_imports.py`).
- Es wird keine echte Datenbank verwendet — `local_data/database/` ist per
  `.gitignore` nie im Checkout enthalten, und jeder Test läuft ohnehin gegen
  eine isolierte, per `monkeypatch` umgeleitete Testdatenbank in `tmp_path`.
- Kein externer Dienst wird angesprochen.
- Keine Produktionsdaten sind erreichbar oder werden verändert.

---

## Typische Fehler

| Symptom | Ursache | Fix |
|---|---|---|
| `ImportError: cannot import name '...' from 'backend.api'` | Ein Test importiert eine Funktion, die inzwischen in einen Router verschoben wurde (siehe AP11) | Importpfad auf `backend.routers.<name>` anpassen |
| Backend-Job schlägt mit `AssertionError` in `_guard_against_real_database` fehl | Ein Test/Skript versucht, `db.DATABASE_PATH` nicht umzuleiten, bevor eine Connection geöffnet wird | `monkeypatch.setattr(db, "DATABASE_PATH", tmp_path / "...")` **vor** jedem `sqlite3.connect`/`TestClient(...)`-Aufruf setzen |
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
