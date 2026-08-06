# Preview-Smoke-Test

> **Status:** Ein echtes End-to-End-Smoke-Test gegen eine reale
> Vercel-Preview-Domain und einen echten Render-Backend-Service konnte in
> der Sitzung, die dieses Dokument erstellt hat, **nicht durchgeführt
> werden** - kein Netzwerkzugriff auf `vercel.com`/`api.render.com` aus der
> Sandbox (siehe `PREVIEW_DEPLOYMENT.md`). Stattdessen wurden (a) alle lokal
> möglichen Äquivalente ausgeführt und (b) eine vollständige Checkliste für
> den echten Browser-Test gegen die tatsächliche Preview-Domain
> zusammengestellt, die nach dem realen Deployment abzuarbeiten ist.

## Tatsächlich ausgeführte Tests (lokal)

| Test | Befehl | Ergebnis |
|---|---|---|
| Backend-Testsuite | `python -m pytest backend/tests -v` | **259 passed** (257 aus Sprint 1 + 2 neue für diesen Sprint) |
| Frontend-Lint | `npm run lint` | 0 Fehler, 1 vorbestehende Warnung (`plan-editor/page.tsx`, AP12-Datei, nicht angefasst) |
| Frontend-Unit-Tests | `npm run test` | 26 passed |
| Frontend-Build (lokaler Default) | `npm run build` | erfolgreich |
| Frontend-Build (produktionsartige URL) | `BACKEND_INTERNAL_URL=https://backend.example.invalid npm run build` | erfolgreich, kein Netzwerkzugriff auf die Beispieladresse (`.invalid`-TLD ist laut RFC 2606 nicht auflösbar; Build war trotzdem sofort fertig, kein Hänger/Timeout) |
| Suche nach hartcodierten Dev-Werten im Build-Output | `grep -rl "127.0.0.1\|localhost:8000\|/api/backend" .next/server .next/static` | siehe unten |
| Backend-Start in `APP_ENV=preview` (echter Subprozess) | `backend/tests/test_preview_mode_smoke.py` (Sprint 1) | bestanden - Health `ok`, Templates gefunden, Restart deaktiviert |
| **Persistenz über einen simulierten Redeploy** (neu, Schritt 7) | `backend/tests/test_preview_persistence.py` | bestanden - siehe Abschnitt unten |

### Fund: hartcodierte lokale Werte im Build-Output

Zwei kompilierte Server-Chunks enthalten den String `http://127.0.0.1:8000`:

```
.next/server/chunks/[root-of-the-server]__16kzu8z._.js
.next/server/chunks/[root-of-the-server]__1dof59_._.js
```

Beide stammen aus **`frontend/lib/backend-supervisor.ts`**
(`process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:8000"`), nicht aus
dem neuen `frontend/lib/backend-url.ts`-Helper. `backend-supervisor.ts` ist
der bereits in Sprint 1 als "cloud-unfähig, bewusst nicht angefasst"
dokumentierte lokale Backend-Watchdog (`/control/backend/status`,
`/control/backend/restart` - siehe `docs/deployment/ARCHITECTURE.md`).

**Bewertung:** unkritisch, aber dokumentationswürdig.
- Der Fallback greift nur, wenn `BACKEND_INTERNAL_URL` fehlt - in der
  Preview ist die Variable gesetzt (Pflicht, siehe `PREVIEW_DEPLOYMENT.md`),
  der Health-Check in `backend-supervisor.ts` würde also korrekt die echte
  Render-URL ansprechen.
- Der destruktivere Pfad (`spawnBackend()`, versucht einen lokalen
  Python-`.venv` zu finden) schlägt in einer Vercel-Serverless-Function
  **gefahrlos fehl** (`resolvePython()` findet keine `.venv`/`venv` unter
  `process.cwd()/..`, liefert `null`, Funktion antwortet mit einer
  kontrollierten Fehlermeldung statt einem Absturz).
- Kein `/api/backend`-Treffer im Build-Output (der frühere,
  in Sprint 1 entfernte `vercel.json`-Sonderpfad ist vollständig weg).

Kein Handlungsbedarf für dieses Arbeitspaket - beim echten Browser-Test
gegen die Vercel-Preview-Domain (Checkliste unten) zusätzlich verifizieren,
dass `/control/backend/restart` auf der Preview-Domain tatsächlich nur die
erwartete "keine lokale Umgebung gefunden"-Antwort liefert, nie einen
500er/Absturz.

### Persistenztest (Schritt 7) - Ergebnis

Simuliert lokal exakt den in Schritt 7 vorgeschriebenen Ablauf, weil der
echte Render-Redeploy nicht ausführbar war:

1. Backend in `APP_ENV=preview` mit leerem, temporärem `PLANNER_DATA_DIR`
   gestartet → `GET /api/team` liefert `[]`.
2. Synthetische Testperson (`"Preview Testperson"`, Abteilung `"QA"`) über
   `POST /api/team` angelegt, per `GET /api/team` zurückgelesen.
3. Prozess beendet (SIGTERM) - entspricht dem alten Prozess bei einem
   Render-Redeploy.
4. **Neuer** Prozess mit **demselben** `PLANNER_DATA_DIR`, neuem Port
   gestartet (entspricht dem neuen Prozess/Port nach einem Redeploy).
5. `GET /api/team` liefert weiterhin genau die eine Testperson mit
   identischer ID.

**Ergebnis: bestanden.** Zusätzlich verifiziert: `python -m backend.backup`
legt die Backup-Datei tatsächlich unter `$PLANNER_DATA_DIR/backups/` ab
(nicht im Prozessspeicher oder einem temporären Pfad), und `exports/`
enthält nach einem Export-Vorgang keine liegen gebliebenen
Zwischendateien (siehe `docs/deployment/STORAGE_INVENTORY.md`).

**Was das lokal NICHT beweist**: dass Render's `/data`-Volume selbst über
einen echten Redeploy hinweg persistent bleibt (das ist eine
Plattform-Garantie, keine Anwendungseigenschaft) - nur, dass die Anwendung
korrekt liest/schreibt, sofern der Pfad tatsächlich erhalten bleibt. Das
technische Volume-Verhalten selbst muss beim echten Deployment einmal
verifiziert werden (Checkliste unten, Abschnitt "Redeploy-/Persistenztest").

## Checkliste für den echten Browser-Test (nach dem realen Deployment)

Auszuführen über die **geschützte** Vercel-Preview-Domain (Deployment
Protection aktiv, siehe `PREVIEW_DEPLOYMENT.md`), ausschließlich mit
synthetischen Daten.

### System

- [ ] Dashboard lädt
- [ ] Healthstatus wird angezeigt
- [ ] keine Mixed-Content-Fehler (Browser-Konsole)
- [ ] keine CORS-Fehler (Browser-Konsole)
- [ ] keine Rewrite-Schleife (Netzwerk-Tab: `/api/...`-Requests beantworten in einem Hop, nicht mehrfach umgeleitet)
- [ ] keine 502-/504-Fehler

### Personen (nur synthetisch!)

- [ ] synthetische Person anlegen (z.B. "Preview Testperson")
- [ ] Person bearbeiten
- [ ] Person deaktivieren
- [ ] Daten nach Reload weiterhin vorhanden

### Plan

- [ ] Testwoche auswählen
- [ ] Testplan erzeugen
- [ ] Zelle bearbeiten
- [ ] speichern
- [ ] Seite neu laden - Plan weiterhin vorhanden
- [ ] Export erzeugen (Download funktioniert, Datei öffnet sich)

### Intelligence

- [ ] Plan-Quality ausführen
- [ ] Empfehlungen öffnen
- [ ] keine Timeout-/Connection-Fehler

### Import (nur synthetisch!)

- [ ] kleine, synthetische XLSX-Datei importieren
- [ ] kleine, synthetische PDF-Datei **nur** testen, falls ein
      Preview-`GEMINI_API_KEY` gesetzt ist - **keine echten
      Mitarbeiterdaten** an Gemini senden

### Systemaktionen

- [ ] `POST /api/system/restart` liefert `restart_disabled` (nicht
      `restarting`) - `SYSTEM_RESTART_ENABLED=0` greift
- [ ] `GET /api/system/diagnostics` zeigt keine Secrets, keine vollständigen
      internen Pfade (relative Pfade wie in `backend/tests/test_api.py`
      geprüft)

### Redeploy-/Persistenztest (Schritt 15)

- [ ] IDs der synthetischen Testdaten notiert
- [ ] neues Render-Deployment derselben Version ausgelöst
- [ ] Backend startet, Health wird grün
- [ ] SQLite-Daten bestehen weiter (Testperson mit notierter ID lesbar)
- [ ] Archiv-/Backup-Dateien bestehen weiter
- [ ] kurze Downtime während des Backend-Redeploys dokumentiert (Render
      Web Services sind währenddessen kurzzeitig nicht erreichbar - keine
      Zero-Downtime-Garantie auf dem verwendeten Plan)
- [ ] neues Vercel-Preview-Deployment ausgelöst
- [ ] Frontend verbindet sich weiterhin mit demselben Backend
- [ ] keine Environment-Variable ging verloren (`BACKEND_INTERNAL_URL` noch gesetzt)

## Bekannte Fehler / Einschränkungen

- Die vorbestehende ESLint-Warnung in `frontend/app/plan-editor/page.tsx`
  (`lastSavedAt` unbenutzt) ist eine AP12-Datei und wurde nicht angefasst -
  kein Blocker für die Preview.
- `frontend/lib/backend-supervisor.ts`/`/control/backend/*` bleiben im
  Vercel-Bundle vorhanden (siehe oben), funktionieren dort aber nicht und
  sollen es auch nicht - reines lokales Entwicklungswerkzeug.
- Kein echter Docker-Image-Build verifiziert (Netzwerkblock beim
  Registry-Pull, siehe `docs/deployment/BACKEND_CONTAINER.md`) - Render baut
  das Image selbst beim ersten Deploy, das ist der erste echte Test dieses
  Pfads.
