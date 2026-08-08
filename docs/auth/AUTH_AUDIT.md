# Auth-Audit: Zustand vor dem Sprint

Bestandsaufnahme der Anwendung **vor** der Einführung von Authentifizierung
und Rollen. Grundlage für jede Einstufung in `ROLE_MATRIX.md`.

Stand: Branch-Basis `claude/supabase-auth-rbac-i5tnsx` (Merge-Commit
`b97f544`).

## 1. Abweichung von der Sprint-Annahme: die Datenbank

Der Sprint-Auftrag geht davon aus, dass die operative Datenbank bereits von
SQLite auf Supabase PostgreSQL migriert ist und ein
PostgreSQL-Migrationssystem existiert. **Im vorliegenden Repository-Stand
ist das nicht der Fall.** Belege:

- `backend/db.py` beginnt mit `"""SQLite storage for extracted Dienstpläne."""`
  und arbeitet durchgehend mit `sqlite3` (`sqlite3.connect`, `sqlite3.Row`,
  `PRAGMA journal_mode=WAL`, `busy_timeout`).
- Das Schema entsteht als ein `CREATE TABLE IF NOT EXISTS`-Skript
  (`db.SCHEMA`) plus additiver Spaltenprüfungen (`db._migrate()`), ausgeführt
  einmalig beim App-Start (`api.py`, Lifespan).
- Kein Alembic, keine versionierten SQL-Migrationen, kein
  `psycopg`/`asyncpg` in `backend/requirements.txt`.
- Alle Router typisieren ihre Verbindung als `sqlite3.Connection`.
- Die Dokumentation nennt die PostgreSQL-Migration ausdrücklich als offenen
  Punkt (`docs/deployment/ARCHITECTURE.md`: "Eine PostgreSQL-Migration ist
  bewusst **nicht** Teil dieses Sprints";
  `docs/release/DEPLOYMENT_HANDOFF.md`).

**Konsequenz für diesen Sprint** (getroffene Annahme, nicht stillschweigend
umgangen):

- `app_users` entsteht dort, wo das Schema tatsächlich entsteht - im
  bestehenden Mechanismus in `backend/db.py`. Damit ist die Tabelle sofort
  wirksam, ohne ein zweites, paralleles Migrationssystem einzuführen (das
  wäre eine Architekturentscheidung weit über einen Auth-Sprint hinaus).
- Zusätzlich liegt die PostgreSQL-Fassung als eigenständig ausführbare
  Migration bereit: `backend/migrations/0001_app_users.sql` (echter
  `uuid`-Typ, FK auf `auth.users`, `updated_at`-Trigger, RLS aktiviert).
  Sie ist bei der Migration des Gesamtprojekts die maßgebliche Definition.
- Alles andere in diesem Sprint - Token-Verifikation, Rollen, Dependencies,
  Frontend - ist von der Frage SQLite/PostgreSQL unabhängig.

## 2. Architektur (vorher)

```
Browser
  │ relative /api/*
  ▼
Next.js 16 (App Router, Vercel)   ← rewrite /api/:path* → BACKEND_INTERNAL_URL
  ▼
FastAPI (Render/Container)
  ▼
SQLite (local_data/database/dienstplaene.db)
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

259 Backend-Tests, 100 Frontend-Tests, beide grün. Relevante Eigenheiten
für die Auth-Einführung:

- `backend/tests/conftest.py` enthält eine autouse-Fixture, die **jeden**
  Zugriff auf die echte lokale Datenbank verhindert. Bleibt unangetastet.
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
- CI läuft auf **Python 3.9** (`.github/workflows/ci.yml`), lokal ist 3.11
  installiert. Der neue Code hält sich deshalb an 3.9-taugliche Syntax
  (`Optional[...]` statt `X | Y` in allem, was zur Laufzeit ausgewertet
  wird; `from __future__ import annotations` überall).

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
