# Deployment-Handoff (Übergabe an die Deployment-Phase)

Dieses Dokument führt **keine** Deployment-Änderungen durch. Es
beschreibt aus Frontend-Sicht, was der nächste Projektabschnitt
wissen muss. Stand: Abschluss Sprint 5
(UI READY FOR PRODUCTION, siehe `SPRINT_5_RESULT.md`).

## 1. Frontend

| Thema | Stand |
|---|---|
| Build-Befehl | `npm run build` (in `frontend/`; Next 16.2.12, Turbopack) |
| Start-Befehl | `npm run start` (= `next start`; Port über `-p`, Standard 3000) |
| Dev-Befehl | `npm run dev` |
| Node-Anforderung | Node 20+ (getestet mit 22) |
| Environment Variables | **`BACKEND_INTERNAL_URL`** (serverseitig, nicht `NEXT_PUBLIC_`): Ziel des `/api/:path*`-Rewrites, Default `http://127.0.0.1:8000`. Weitere Variablen existieren nicht. |
| Backend Base URL | Der Browser spricht ausschließlich die eigene Origin an (relative `/api/...`-Pfade); der Next-Server proxyt per Rewrite an `BACKEND_INTERNAL_URL`. CORS ist dadurch im Standard-Setup kein Thema zwischen Browser und Backend. |
| Statische Ausgabe | Kein `output: export` - die App braucht den Next-Server (Rewrites, `/control`-Routen). |
| Vercel-relevant | 1) Der Rewrite braucht ein von Vercel aus erreichbares Backend (`BACKEND_INTERNAL_URL` als Env setzen). 2) Die Routen `app/control/backend/{status,restart}` starten/prüfen einen **lokalen** Backend-Prozess (Spawn) - in einer Serverless-Umgebung funktionslos; die System-Seite zeigt Neustart-Fehler dann als Fehlermeldung an. Für ein Cloud-Deployment deaktivieren/ersetzen. 3) Idle-Prefetch lädt ~3,2 MB Chunks (inkl. 2× AG Grid) - CDN-Caching greift, optional `prefetch={false}` auf den Grid-Routen erwägen. |

## 2. Backend-Abhängigkeiten (aus Frontend-Sicht)

**Benötigte API-Bereiche** (alle unter `/api`, vollständige Aufrufer
in `frontend/lib/api.ts`):

`/health` · `/weeks` (+Detail/Delete) · `/plan/{generate,save,
existing,templates,free-suggestion}` · `/xlsx/generate` (Dienstplan-
Export) · `/import/save` + `/xlsx`-Uploads (Alt-Import) · `/team` ·
`/memory` (+Show-/Frei-/Aufgaben-Mutationen) · `/intelligence/*`
(employees, recommendations, plan-quality, audit) · `/artist-plans`
(+upload/export) · `/rehearsal-plans` (+upload) · `/dashboard/*`
(insights, fairness-alerts u. a.) · `/planning-rules` ·
`/system/{diagnostics,restart}` · `/settings/{key}` ·
`/known-department-tokens` · `/people/active`.

**Erwartete Persistenz:** dauerhafte Datenbank hinter diesen
Endpunkten (lokal SQLite unter `local_data/database/`), dazu
Dateiablagen für Vorlagen/Uploads/Exporte (`local_data/...`) - die
System-Seite zeigt deren Pfade/Schreibbarkeit über
`/system/diagnostics` an.

**Healthchecks:** Frontend nutzt `GET /api/health` (System-Seite
pollt alle 5 s bei sichtbarem Tab; Dashboard/Editoren nur implizit
über ihre Datenaufrufe).

**Fehlerzustände, die das Frontend verarbeitet:** Netzwerk-/
Verbindungsfehler → „Das lokale Backend ist nicht erreichbar…";
5xx ohne FastAPI-`detail` → gleiche Meldung; FastAPI-`detail`-String
→ wird direkt angezeigt (Texte müssen nutzertauglich deutsch sein!);
`detail`-Objektliste (422) → „Ungültige Eingabe…"; AbortError →
still ignoriert. Kein Auth-/Berechtigungs-Handling vorhanden (es
gibt keine Authentifizierung - siehe §3).

## 3. Kritische offene Deployment-Themen (nicht in Sprint 5 umgesetzt)

| Thema | Status/Entscheidungsbedarf |
|---|---|
| SQLite vs. PostgreSQL | SQLite ist Single-File/Single-Writer - für Cloud-Betrieb Migrationsentscheidung nötig (PostgreSQL/Supabase), inkl. Datenübernahme aus `local_data/database/`. |
| Supabase / Render / Vercel | Zielplattform ungeklärt; Frontend ist Vercel-tauglich (mit §1-Einschränkungen), Backend (FastAPI) braucht eigenen Host (z. B. Render) oder Container. |
| CORS | Im Rewrite-Modell unnötig; wird das Frontend je direkt gegen ein fremdes Backend-Origin gebaut, müssen CORS-Origins im Backend konfiguriert werden (`/system/diagnostics` zeigt sie an). |
| Secrets | Aktuell keine Frontend-Secrets. Gemini-Key für den Probenplan-PDF-Import liegt im Backend - Secret-Management der Zielplattform klären. |
| Authentifizierung | Nicht vorhanden. Vor einem öffentlich erreichbaren Deployment zwingend zu entscheiden (die App geht heute von einem vertrauenswürdigen lokalen Einzelnutzer aus). |
| Datenbankmigration/Backups | Kein Migrations-/Backup-Konzept über die lokale Dateiablage hinaus. |
| Produktions-Logging | Frontend loggt Fehler nur in die Browser-Konsole (Error-Boundary `console.error`); kein Reporting-Dienst angebunden. |
| Healthchecks/Monitoring | `/api/health` existiert; Plattform-Healthchecks und Alerts sind einzurichten. |
| Deployment Smoke Tests | Die Sprint-5-Playwright-Strecken (Regression A/B, Prod-Smoke) sind reproduzierbar dokumentiert, aber nicht als versionierte CI-Suite abgelegt - Kandidat für die Deployment-Phase. |
| `/control`-Routen | Lokale Prozesssteuerung (Backend-Neustart) - im Cloud-Betrieb ersetzen oder abschalten (§1). |
| Next 16.3-Update | Behebt die drei transitiven npm-audit-Findings (postcss/sharp) - als erster Schritt der nächsten Phase empfohlen. |
