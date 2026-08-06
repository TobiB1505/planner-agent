# Preview-Deployment: Vercel-Frontend + Render-Backend

Konkrete, ausführbare Anleitung für die in `docs/deployment/ARCHITECTURE.md`
beschriebene Zielarchitektur, zugespitzt auf eine **geschützte
Preview-Umgebung** - ausdrücklich **kein** öffentliches Production-Deployment
(siehe `PREVIEW_SECURITY_LIMITS.md`).

> **Status dieses Dokuments:** Die hier beschriebenen Schritte konnten in der
> Sitzung, die dieses Dokument erstellt hat, **nicht end-to-end gegen echte
> Render-/Vercel-Konten ausgeführt werden** - die Ausführungsumgebung hatte
> weder Render-/Vercel-CLI-Zugangsdaten noch Netzwerkzugriff auf
> `api.render.com`/`vercel.com` (vom Sandbox-Netzwerk-Proxy mit
> `403`/`502` blockiert, verifiziert per `curl`). Alle Schritte unten sind
> deshalb als **manuelle Dashboard-Anleitung** formuliert, keine ausgeführten
> CLI-Kommandos. Was tatsächlich lokal verifiziert wurde, ist explizit als
> solches markiert. Domains/Tokens sind durchgehend Platzhalter.

## Reihenfolge der Deployments

1. **Backend zuerst** (Render) - das Frontend braucht dessen URL für
   `BACKEND_INTERNAL_URL`.
2. **Frontend danach** (Vercel) - Preview-Deployment, keine Production-Domain.
3. **CORS im Backend nachziehen**, sobald die Vercel-Preview-Domain bekannt
   ist (Henne-Ei: die Domain existiert erst nach Schritt 2).

## 1. Render: Web Service für das Backend

Render-Dashboard → New → Web Service → GitHub-Repository verbinden.

| Einstellung | Wert |
|---|---|
| Runtime | **Docker** (Dockerfile vorhanden: `backend/Dockerfile`) |
| Dockerfile Path | `backend/Dockerfile` |
| Docker Build Context | `backend` (nicht der Repo-Root - siehe Kommentar im Dockerfile und `docs/deployment/BACKEND_CONTAINER.md`) |
| Branch | `feature/deployment-readiness` |
| Instanzen | **genau 1** (kein Autoscaling, kein horizontales Skalieren - siehe `docs/deployment/ARCHITECTURE.md`, Abschnitt Datenhaltung) |
| Health Check Path | `/api/health` |

Uvicorn läuft über `backend/run_local.py` bereits als genau ein Prozess ohne
`--workers`/`--reload` (siehe `backend/Dockerfile`, `CMD ["python", "-m",
"backend.run_local"]`) - keine zusätzliche Render-Einstellung dafür nötig.

### Persistente Disk

Render-Dashboard → Service → Disks → Add Disk.

| Einstellung | Wert |
|---|---|
| Mount Path | `/data` |
| Größe | klein (Preview-Zweck) - Startwert genügt, keine Live-Datenmengen |

Env-Var setzen (siehe Tabelle unten): `PLANNER_DATA_DIR=/data`.

**Nach dem ersten erfolgreichen Start prüfen** (Render Shell oder
Diagnose-Endpunkt, siehe `PREVIEW_SMOKE_TEST.md`), dass unter `/data`
mindestens entstehen:

```
database/
archives/
uploads/
exports/
backups/
```

Diese fünf Ordner werden von `backend/config/paths.py:
ensure_runtime_directories()` beim Start angelegt (verifiziert durch
`backend/tests/test_paths.py: test_ensure_runtime_directories_creates_expected_folders`)
- kein manuelles Anlegen nötig, nur die Existenz nach dem ersten Start
gegenprüfen.

### Environment-Variablen (Render)

| Variable | Wert | Quelle |
|---|---|---|
| `APP_ENV` | `preview` | fest |
| `PLANNER_DATA_DIR` | `/data` | fest (Volume-Mount oben) |
| `SYSTEM_RESTART_ENABLED` | `0` | fest - kein `os.execv` in der Cloud (siehe `backend/routers/system.py: _restart_enabled()`) |
| `BACKEND_HOST` | `0.0.0.0` | fest - Dockerfile setzt dies bereits als Default, hier zur Klarheit trotzdem explizit |
| `PORT` | *(von Render automatisch gesetzt, nicht manuell konfigurieren)* | Render-Plattform-Standard - `backend/run_local.py: resolve_backend_port()` liest `PORT` vor `BACKEND_PORT` |
| `CORS_ORIGINS` | `<vercel-preview-domain-platzhalter>` | erst nach Schritt "Vercel-Projekt erstellen" bekannt, siehe unten |
| `GEMINI_API_KEY` | `<nur als Render Secret, nur falls PDF-Import getestet wird>` | **ausschließlich über Render-Dashboard/Secret-Verwaltung setzen** - nie in `.env.example`, nie im Dockerfile, nie in GitHub |

**Kein fester öffentlicher Port konfigurieren** - Render injiziert `PORT`,
der Prozess bindet automatisch darauf (siehe Tabelle).

## 2. Backend deployen und health-prüfen

Nach dem ersten Deploy: `GET https://<render-backend-domain>/api/health`
prüfen (Details/Erwartung: `PREVIEW_SMOKE_TEST.md`). Erst wenn das grün ist,
mit dem Frontend weitermachen.

## 3. Vercel: Projekt für das Frontend

Vercel-Dashboard → Add New → Project → dasselbe GitHub-Repository
importieren.

| Einstellung | Wert |
|---|---|
| Framework Preset | Next.js |
| Root Directory | `frontend` |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Production Branch | **nicht** `feature/deployment-readiness` setzen - dieser Branch soll nur Preview-Deployments auslösen, siehe `docs/deployment/ARCHITECTURE.md` (kein Production-Promote in diesem Sprint) |
| Preview Deployments | aktiviert (Standard) für den Branch `feature/deployment-readiness` |

**Kein Production-Deployment promoten.**

### Environment-Variable (Vercel, nur Preview-Scope)

```
BACKEND_INTERNAL_URL=https://<render-backend-domain>
```

- **Kein `NEXT_PUBLIC_`-Präfix** - bleibt serverseitig (siehe
  `frontend/lib/backend-url.ts`, `frontend/next.config.ts`).
- **Kein abschließender `/api`-Pfad**: `next.config.ts` hängt `/api/:path*`
  bereits selbst an (`frontend/lib/backend-url.ts:
  backendRewriteDestination()`) - die Variable ist nur die Basis-URL
  (Schema + Host, z.B. `https://planner-agent-backend-preview.onrender.com`,
  hier als Platzhalter).
- **Keine doppelten Slashes**: abschließende Slashes werden zwar
  normalisiert (`resolveBackendUrl()` entfernt sie), sauberer ist trotzdem,
  sie gar nicht erst einzutragen.
- **Nur `https://`** in Preview/Production (`http://` würde von
  `resolveBackendUrl()` zwar technisch akzeptiert, ist aber für eine
  öffentlich erreichbare Render-URL falsch) - Render-Backends sind
  standardmäßig ohnehin nur über HTTPS erreichbar.
- Auf **Preview-Scope** setzen, nicht Production (Vercel-Environment-Variable
  pro Scope) - siehe `docs/deployment/VERCEL_FRONTEND.md`.

Wichtig: **vor** dem Setzen die tatsächliche Rewrite-Implementierung
geprüft (nicht nur angenommen) - `frontend/next.config.ts` importiert
`backendRewriteDestination` aus `frontend/lib/backend-url.ts`, welches
`resolveBackendUrl()` aufruft und daran genau einmal `/api/:path*` anhängt;
elf Tests in `frontend/lib/backend-url.test.ts` decken Normalisierung,
Protokoll-Validierung und das Preview/Production-Pflichtverhalten ab.

## 4. CORS im Backend nachziehen

Sobald die Vercel-Preview-Domain bekannt ist:

```
CORS_ORIGINS=https://<vercel-preview-domain>
```

**Vorher prüfen, ob das überhaupt nötig ist**: Der Browser spricht laut
`frontend/lib/api.ts` ausschließlich relative `/api/...`-Pfade an, die
Next.js serverseitig (same-origin für den Browser) an das Backend
weiterleitet (`frontend/next.config.ts` rewrites). Der Browser selbst stellt
in diesem Pfad **keine** Cross-Origin-Anfrage an Render - CORS greift nur,
falls das Backend direkt (nicht über den Rewrite) angesprochen wird, was in
der bestehenden Anwendung nirgends passiert (siehe Sprint 1,
`docs/deployment/ARCHITECTURE.md`).
`CORS_ORIGINS` trotzdem konkret auf die Vercel-Preview-Domain setzen (statt
nur auf dem lokalen Default zu belassen) ist dennoch sinnvoll, für den Fall,
dass jemand während der Entwicklung/Fehlersuche das Backend testweise direkt
aus dem Browser anspricht - **nicht** auf `*` setzen, **keine** pauschale
Freigabe aller `*.vercel.app`-Domains. Lokale Origins (`localhost:3000`,
`127.0.0.1:3000`) bleiben als Default in `backend/routers/shared.py:
_cors_origins()` erhalten, wenn `CORS_ORIGINS` nicht gesetzt ist - für die
Preview-Instanz wird die Variable aber bewusst explizit gesetzt.

## 5. Vercel Deployment Protection

Vercel-Dashboard → Projekt → Settings → Deployment Protection → **Vercel
Authentication** für Preview-Deployments aktivieren.

- Preview ist danach nicht mehr anonym öffentlich aufrufbar - nur
  angemeldete, berechtigte Vercel-Teammitglieder erhalten Zugriff.
- **Keine** Deployment-Protection-Ausnahme für die gesamte Preview-Domain
  einrichten (kein "Protection Bypass for Automation" mit breitem Scope).
- Das schützt **nur das Frontend**. Das Render-Backend bleibt davon
  unberührt - siehe `PREVIEW_SECURITY_LIMITS.md` für die Konsequenzen.

## Zusammenfassung: was in dieser Sitzung tatsächlich geprüft wurde

| Schritt | Status |
|---|---|
| Branch-Vorbereitung (`git fetch`/`rebase`/`diff --check`) | ✅ ausgeführt, siehe Abschlussbericht |
| Backend-Tests (`pytest`) | ✅ ausgeführt, 257 passed |
| Frontend Lint/Test/Build (inkl. `BACKEND_INTERNAL_URL`-Build) | ✅ ausgeführt, siehe Abschlussbericht |
| Build-Output nach `127.0.0.1`/`localhost:8000`/`/api/backend` durchsucht | ✅ ausgeführt, siehe `PREVIEW_SMOKE_TEST.md` |
| Render Web Service tatsächlich anlegen | ❌ nicht möglich (kein Netzwerkzugriff auf `api.render.com` aus der Sandbox) |
| Vercel-Projekt tatsächlich anlegen | ❌ nicht möglich (kein Netzwerkzugriff auf `vercel.com` aus der Sandbox) |
| Live-Health-Check gegen echte Render-URL | ❌ nicht möglich (keine echte URL existiert) |
| Live-Smoke-Test gegen echte Vercel-Preview-Domain | ❌ nicht möglich |
