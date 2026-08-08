# Auth-Audit: Zustand vor dem Sprint

Bestandsaufnahme der Anwendung **vor** der Einführung von Authentifizierung
und Rollen. Grundlage für jede Einstufung in `ROLE_MATRIX.md`.

Stand der Bestandsaufnahme: Branch-Basis `b97f544`. Zum Zeitpunkt des
Sprint-Abschlusses wurde zusätzlich der inzwischen gemergte PostgreSQL-Stand
(`origin/main`, PR #21) eingearbeitet - siehe Abschnitt 1.

## 1. Die Datenbank: parallel laufende Migration

Der Sprint-Auftrag geht davon aus, dass die operative Datenbank bereits von
SQLite auf Supabase PostgreSQL migriert ist. Beim Start dieses Sprints war
das im Repository **noch nicht** der Fall - der Branch-Punkt `b97f544` war
durchgehend SQLite:

- `backend/db.py` begann mit `"""SQLite storage for extracted Dienstpläne."""`
  und arbeitete mit `sqlite3` (`sqlite3.connect`, `sqlite3.Row`,
  `PRAGMA journal_mode=WAL`).
- Das Schema entstand als ein `CREATE TABLE IF NOT EXISTS`-Skript
  (`db.SCHEMA`) plus additiver Spaltenprüfungen (`db._migrate()`).
- Kein Alembic, keine versionierten SQL-Migrationen, kein `psycopg` in
  `backend/requirements.txt`.
- Alle Router typisierten ihre Verbindung als `sqlite3.Connection`.

**Was tatsächlich passiert ist:** die Migration lief parallel in einem
eigenen Branch und wurde während dieses Sprints als PR #21
(`refactor(db): migrate planner persistence from sqlite to postgres`) nach
`main` gemergt. Der Auth-Sprint wurde daraufhin auf diesen Stand gehoben
(`git merge origin/main`) und vollständig darauf portiert:

- `app_users` ist jetzt eine **versionierte Migration** im bereits
  vorhandenen Runner: `backend/migrations/002_app_users.sql`. Kein zweites,
  paralleles Migrationssystem - die Tabelle folgt exakt den Konventionen von
  `001_initial_postgres.sql` (boolesche Flags als INTEGER, Zeitstempel als
  TEXT über `planner_now_text()`, IDs als BIGINT), damit sich kein
  Antwortformat ändert.
- Alle Auth-Abfragen nutzen `%s`-Platzhalter und `db.Connection` statt
  `sqlite3`; die Integritätsfehler kommen aus `psycopg.errors`.
- Die Auth-Testinfrastruktur läuft über das isolierte Testschema pro Test
  (`conftest._isolated_schema`) statt über eine temporäre SQLite-Datei.
- `app_users` steht bewusst **nicht** in `TABLES_IN_DEPENDENCY_ORDER`: diese
  Liste speist das einmalige SQLite-Übernahmetool, und dort hat eine Tabelle
  nichts zu suchen, die es in SQLite nie gab. Beim Leeren wird sie über
  `TRUNCATE ... CASCADE` trotzdem zuverlässig erfasst.

Bemerkenswert: die Token-Verifikation, das Rollenmodell, die Dependencies und
das gesamte Frontend waren von dieser Frage unberührt - portiert werden
mussten ausschliesslich die knapp 100 Zeilen Datenzugriff.

## 2. Architektur (vorher)

```
Browser
  │ relative /api/*
  ▼
Next.js 16 (App Router, Vercel)   ← rewrite /api/:path* → BACKEND_INTERNAL_URL
  ▼
FastAPI (Render/Container)
  ▼
SQLite (local_data/database/dienstplaene.db)   ← inzwischen PostgreSQL, siehe Abschnitt 1
```

- **Keine Authentifizierung an irgendeiner Stelle.** Kein Login, keine
  Sessions, keine Benutzer- oder Rollentabelle. Jeder, der die URL kennt,
  konnte jeden Endpunkt aufrufen - inklusive `POST /api/plan/save`,
  `DELETE /api/weeks/{id}` und `POST /api/system/restart`.
- **Keine Middleware** ausser CORS. Kein `middleware.ts`/`proxy.ts` im
  Frontend.
- **Dependency Injection** ist vorhanden und wird konsequent genutzt:
  `Depends(db.get_db_connection)` liefert genau eine Verbindung pro Request
  (AP4). Das ist der Anknüpfungspunkt für `get_current_user` - dieselbe
  Verbindung wird von FastAPI innerhalb eines Requests wiederverwendet, die
  Auth-Prüfung öffnet also keine zweite.

## 3. Backend-Bestandsaufnahme

### Router

| Datei | Endpunkte | Fachlicher Inhalt |
| --- | --- | --- |
| `routers/plans.py` | 9 | Dienstplan: Archiv, laden, erzeugen, speichern, löschen, Excel-Export |
| `routers/imports.py` | 19 | PDF-/Excel-Upload, Künstlerplan, Probenplan, Import speichern |
| `routers/intelligence.py` | 9 | Empfehlungen, Planqualität, Mitarbeiterprofile, Skills, Audit-Log |
| `routers/memory.py` | 5 | MA-Gedächtnis (Shows, freie Tage, Aufgabenaffinitäten) |
| `routers/dashboard.py` | 7 | Kennzahlen, Fairness, Planungsregeln |
| `routers/people.py` | 5 | Team-Verwaltung |
| `routers/settings.py` | 2 | Generischer Schlüssel/Wert-Speicher |
| `routers/system.py` | 3 | Health, Diagnose, Neustart |

Summe vorher: 59 Endpunkte, alle offen.

### Sicherheitsrelevante Auffälligkeiten (vorher)

1. **`POST /api/upload/pdf` akzeptierte `?api_key=`** als Query-Parameter
   (`def upload_pdf(file: UploadFile = File(...), api_key: Optional[str] = None)`).
   Ein Secret im Query-String landet in Browser-Historie, Referer-Headern
   und Access-Logs. → In diesem Sprint entfernt.
2. **`POST /api/system/restart`** führte `os.execv` aus - ohne jede
   Berechtigungsprüfung. Einzige Bremse war die Deployment-Sperre
   `SYSTEM_RESTART_ENABLED`. → Jetzt zusätzlich ADMIN; die Sperre bleibt
   unverändert bestehen (zwei unabhängige Schutzebenen).
3. **`GET /api/system/diagnostics`** gab Verzeichnisse, Schreibrechte,
   CORS-Origins, Host/Port und freien Speicher preis. → Jetzt ADMIN.
4. **`/api/settings/{key}`** ist ein generischer Schlüssel/Wert-Speicher mit
   frei wählbarem Schlüssel, lesend wie schreibend. → Jetzt ADMIN.
5. **Die Next.js-Route-Handler `/control/backend/status` und
   `/control/backend/restart`** starten einen Backend-Prozess bzw. lesen
   dessen Zustand - an FastAPI vorbei, unauthentifiziert. → Jetzt ADMIN,
   mit eigener Prüfung (`lib/auth/route-handler-guard.ts`).
6. **CORS** war bereits eng (`CORS_ORIGINS`, kein `*`), `allow_credentials`
   nicht gesetzt. → Unverändert übernommen, Begründung ergänzt.

### Datenmodell (relevanter Ausschnitt)

`people` ist die zentrale Personentabelle - Ziel der Verknüpfung mit
Auth-Benutzern:

```sql
CREATE TABLE people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    department TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    deleted INTEGER NOT NULL DEFAULT 0
);
```

Wichtig: `delete_person()` ist ein **Soft-Delete** (`active=0, deleted=1`),
kein `DELETE`. Historische Pläne bleiben vollständig. Das ist der Grund,
warum `DELETE /api/team/{person_id}` als PLANNER eingestuft wurde und nicht
als ADMIN.

Keine Tabelle enthielt Benutzer, Rollen oder Zugangsdaten.

## 4. Frontend-Bestandsaufnahme

- **Next.js 16**, App Router. Wichtig: In dieser Version heisst die frühere
  `middleware.ts` **`proxy.ts`** (siehe
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`).
  Der Hinweis in `frontend/AGENTS.md` ("This is NOT the Next.js you know")
  war hier zutreffend und wurde befolgt.
- **Alle Seiten sind Client Components** (`"use client"`), `app/layout.tsx`
  war eine synchrone Server Component ohne Datenzugriff.
- **`lib/api.ts`** ist bereits ein zentraler, typisierter Fetch-Wrapper mit
  einheitlicher Fehlerbehandlung - der richtige Ort, um den
  `Authorization`-Header genau einmal zu setzen. Drei Aufrufe gingen an
  `request()` vorbei (`exportArtistPlan`, `xlsxGenerate` - beides Blob-
  Downloads - sowie `ensureBackendRestarted` an die Next.js-eigene Route).
  Alle drei wurden angefasst.
- **Navigation**: `components/Sidebar.tsx` mit zwei festen Listen
  (Planung / Verwaltung), keinerlei Rollenbezug.
- **Environment**: `BACKEND_INTERNAL_URL` und `APP_ENV` sind bewusst
  serverseitig (kein `NEXT_PUBLIC_`); der Browser spricht nur relative
  `/api/*`-Pfade an. Dieses Prinzip wurde unverändert beibehalten - es kam
  kein `NEXT_PUBLIC_BACKEND_URL` hinzu.
- **Tests**: Vitest + jsdom + Testing Library, 13 Testdateien, kein
  globales Setup-File (`window.matchMedia` fehlt in jsdom und muss im Test
  gestellt werden).

## 5. Bestand an Tests (vorher)

Bei Sprint-Beginn 259 Backend-Tests, 100 Frontend-Tests, beide grün; nach
dem Merge des PostgreSQL-Stands 417 Backend-Tests. Relevante Eigenheiten für
die Auth-Einführung:

- `backend/tests/conftest.py` enthält autouse-Fixtures, die jeden Test
  isolieren und einen Zugriff auf eine Produktionsdatenbank verhindern
  (nach dem Merge: ein eigenes PostgreSQL-Schema pro Test). Beides bleibt
  unangetastet - die Auth-Fixtures kommen additiv dazu.
- Drei Testdateien starten einen **echten Backend-Prozess** und sprechen ihn
  über HTTP an (`test_preview_mode_smoke.py`,
  `test_preview_persistence.py`, `test_uvicorn_real_concurrency.py`). Für
  sie greifen `dependency_overrides` naturgemäss nicht - sie brauchen echte
  Tokens. Genau das tun sie jetzt (HS256-Testkonfiguration + echter
  `app_users`-Eintrag), womit die vollständige Auth-Kette nebenbei
  Ende-zu-Ende getestet wird.
- Drei Tests in `test_async_imports.py` benutzten `?api_key=test-key`.
  Durch das Entfernen des Parameters setzen sie den Key jetzt als
  Umgebungsvariable.
- CI lief bei Sprint-Beginn auf **Python 3.9**; der PostgreSQL-Merge hat sie
  auf 3.11 gehoben und eine `postgres:16`-Servicedatenbank ergänzt. Der
  Auth-Code hält sich trotzdem an die konservativere Schreibweise
  (`Optional[...]` statt `X | Y` in allem, was zur Laufzeit ausgewertet wird;
  `from __future__ import annotations` überall) - sie kostet nichts und
  bleibt auf beiden Versionen gültig.

## 6. Was der Sprint daraus gemacht hat

| Vorher | Nachher |
| --- | --- |
| 59 offene Endpunkte | 64 Endpunkte, davon 1 öffentlich (`/api/health`) |
| kein Benutzerbegriff | `app_users` (Rolle + Person je Supabase-Konto) |
| keine Rollen | `admin` / `planner` / `employee`, hierarchisch |
| Secret als Query-Parameter möglich | entfernt, nur noch serverseitige Umgebung |
| Systemneustart ohne Prüfung (2 Wege) | beide Wege ADMIN-pflichtig |
| Navigation für alle gleich | rollenabhängig, plus eigener Mitarbeiterbereich |
| kein Frontend-Routing-Schutz | `proxy.ts` + serverseitige Prüfung im Layout |
| 417 Backend-Tests (nach PostgreSQL-Merge) | 437 Backend-Tests, davon 66 zu Auth/RBAC |
