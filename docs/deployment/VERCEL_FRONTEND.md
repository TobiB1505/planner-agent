# Vercel-Frontend-Deployment

## Projekt-Setup

1. Repository in Vercel importieren.
2. **Root Directory**: `frontend`
3. **Framework Preset**: Next.js (wird bei `Root Directory: frontend`
   automatisch erkannt).
4. **Install Command**: `npm ci` (Standard bei erkanntem `package-lock.json`,
   nicht `npm install` - reproduzierbar, siehe `frontend/package-lock.json`).
5. **Build Command**: `npm run build` (Standard).
6. Keine `vercel.json` nötig (siehe `docs/deployment/ARCHITECTURE.md`,
   Abschnitt "Vercel-Konfiguration") - die frühere Root-`vercel.json` wurde
   entfernt. Falls in Zukunft eine konkrete Einstellung fehlt, die Vercel
   nicht selbst erkennt: minimale `frontend/vercel.json`, nicht die
   Root-Ebene.

## Environment-Variable: `BACKEND_INTERNAL_URL`

- **Serverseitig, kein `NEXT_PUBLIC_`-Präfix** - wird nie an den Browser
  ausgeliefert (siehe `frontend/next.config.ts`, `frontend/lib/api.ts`).
- **Preview und Production getrennt setzen** (Vercel-Projekteinstellungen →
  Environment Variables → pro Environment-Scope einen eigenen Wert):
  - Production: URL der produktiv laufenden Backend-Instanz.
  - Preview: URL einer Preview-/Staging-Backend-Instanz (oder derselben
    Instanz wie Production, wenn (noch) keine getrennte Umgebung existiert -
    dann bewusst dokumentieren, dass Preview-Deployments echte Daten
    berühren).
- Fehlt die Variable in Preview/Production, **bricht der Build mit einer
  klaren Fehlermeldung ab** (`frontend/lib/backend-url.ts:
  BackendUrlConfigError`) - kein stiller Fallback auf `localhost`. Lokal
  (kein `APP_ENV` bzw. `APP_ENV=local`) bleibt der Default
  `http://127.0.0.1:8000` erhalten.
- Nur `http://` oder `https://`, keine abschließenden Slashes (werden
  normalisiert).

`APP_ENV` selbst muss auf Vercel nicht separat gesetzt werden, wenn
`BACKEND_INTERNAL_URL` für Preview/Production ohnehin gesetzt ist (siehe
`docs/deployment/ENVIRONMENTS.md`) - die Validierung greift bei gesetzter URL
unabhängig von `APP_ENV`.

## Deployment Protection

**Muss für Preview-Deployments aktiviert werden** (Vercel-Projekteinstellungen
→ Deployment Protection): das Backend hat in dieser Sprint-Stufe keine
Authentifizierung (siehe `docs/deployment/DEPLOYMENT_CHECKLIST.md`) - ein
öffentlich erreichbares Preview-Frontend würde damit ein ungeschütztes
Backend voll erreichbar machen.

## Nach dem Deployment: Health-/Smoke-Test

1. `GET https://<deployment-url>/api/health` → erwartet `200` mit
   `{"status": "ok", "database": "connected", "templates_ok": true,
   "data_dir_writable": true, ...}`.
2. Eine reale, lesende Route öffnen (z.B. `/team`) und prüfen, dass Daten
   vom externen Backend ankommen (Beweis, dass der Rewrite tatsächlich das
   richtige Backend erreicht, nicht nur, dass Next.js selbst antwortet).
3. `POST /api/system/restart` **nicht** routinemäßig gegen eine echte
   Instanz aufrufen, um den Restart-Gate zu "testen" - das ist bereits durch
   `backend/tests/test_system_restart_gating.py` und
   `backend/tests/test_preview_mode_smoke.py` automatisiert abgedeckt.
