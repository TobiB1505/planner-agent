# Environment-Profile

Drei Umgebungen: `local`, `preview`, `production`, gesteuert über `APP_ENV`.
Ohne gesetztes `APP_ENV` (weder Backend noch Frontend) gilt überall der
`local`-Standard - die bestehende lokale Nutzung (Startskripte, README)
funktioniert dadurch unverändert ohne Zusatzkonfiguration.

## Frontend-Variablen

| Variable | Zweck | Sichtbarkeit |
|---|---|---|
| `APP_ENV` | `local`/`preview`/`production` - steuert, ob `BACKEND_INTERNAL_URL` Pflicht ist (siehe unten) | serverseitig |
| `BACKEND_INTERNAL_URL` | Ziel-URL für den `/api/*`-Rewrite (`next.config.ts`) | serverseitig, **kein** `NEXT_PUBLIC_`-Präfix - nie im Browser-Bundle |

## Backend-Variablen

| Variable | Zweck |
|---|---|
| `APP_ENV` | `local`/`preview`/`production` - steuert `PLANNER_DATA_DIR`-Pflicht und `SYSTEM_RESTART_ENABLED`-Default |
| `PLANNER_DATA_DIR` | Laufzeitdatenordner (DB, Archiv, Uploads, Exporte, Backups). Lokal optional (Default `local_data/`), in Preview/Production Pflicht |
| `CORS_ORIGINS` | Kommaseparierte erlaubte Browser-Origins für direkte Backend-Anfragen (nicht für den same-origin-Rewrite relevant) |
| `GEMINI_API_KEY` | Google-Gemini-Key für KI-gestützte PDF-Extraktion (optional, Fallback ohne KI existiert) |
| `BACKEND_HOST` | Bind-Adresse (lokal `127.0.0.1`, Container `0.0.0.0` - siehe `backend/Dockerfile`) |
| `BACKEND_PORT` / `PORT` | Bind-Port - `PORT` (Plattform-Standard) geht `BACKEND_PORT` vor |
| `SYSTEM_RESTART_ENABLED` | `1`/`0` - steuert `POST /api/system/restart` (os.execv-Neustart). Ohne explizite Einstellung: aktiv nur bei `APP_ENV=local` |
| `BACKEND_RELOAD` | Nur lokale Entwicklung: `1` aktiviert Uvicorns Auto-Reload |

## Environment-Matrix

| Variable | Local | Preview | Production | Secret |
|---|---|---|---|---|
| `APP_ENV` | `local` (oder leer) | `preview` | `production` | nein |
| `BACKEND_INTERNAL_URL` | optional, Default `http://127.0.0.1:8000` | **Pflicht** (Preview-Backend-URL) | **Pflicht** (Production-Backend-URL) | nein (aber providerspezifisch, nicht in `.env.example` mit echtem Wert) |
| `PLANNER_DATA_DIR` | optional, Default `local_data/` | **Pflicht** (`/data`-Volume) | **Pflicht** (`/data`-Volume) | nein |
| `CORS_ORIGINS` | Default (`localhost:3000`) reicht | Preview-Frontend-Origin(s) | Production-Frontend-Origin(s) | nein |
| `GEMINI_API_KEY` | optional | optional | optional | **ja** |
| `SYSTEM_RESTART_ENABLED` | `1` (Default über `APP_ENV=local`) | `0` | `0` | nein |

Keine echten Secrets in `.env.example`/`frontend/.env.example` - beide Dateien
enthalten nur Platzhalter/Defaults, `GEMINI_API_KEY` bleibt in beiden Dateien
leer.

## Warum `APP_ENV` statt `VERCEL_ENV`/`NODE_ENV`

Vercel setzt automatisch `VERCEL_ENV` (`development`/`preview`/`production`)
und `NODE_ENV`; das Backend läuft aber nicht auf Vercel und hat keinen
Zugriff darauf. Ein einheitliches, providerneutrales `APP_ENV` auf beiden
Seiten (Frontend + Backend) vermeidet zwei unterschiedliche
Umgebungskonzepte für dieselbe logische Unterscheidung. Auf Vercel muss
`APP_ENV` explizit als Projekt-Environment-Variable gesetzt werden (nicht
automatisch von `VERCEL_ENV` abgeleitet) - in der Praxis reicht dafür meist
schon eine korrekt gesetzte `BACKEND_INTERNAL_URL` (siehe
`docs/deployment/VERCEL_FRONTEND.md`), da die Validierung an der gesetzten
URL selbst greift, nicht nur an `APP_ENV`.
