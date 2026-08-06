# Deployment-Checkliste

## Vor dem ersten Deployment

- [ ] Vercel-Projekt: Root Directory `frontend`, Framework Next.js (siehe `VERCEL_FRONTEND.md`)
- [ ] `BACKEND_INTERNAL_URL` in Vercel für Preview UND Production gesetzt (getrennte Werte)
- [ ] Vercel Deployment Protection für Preview aktiviert
- [ ] Backend-Image gebaut und **in einer Umgebung mit Docker-Hub-Zugriff** verifiziert (siehe `BACKEND_CONTAINER.md` - in diesem Sprint nur statisch geprüft, siehe dort)
- [ ] Backend-Container: `PLANNER_DATA_DIR=/data`, `APP_ENV=production`, `SYSTEM_RESTART_ENABLED=0`, `/data` auf echtes persistentes Volume gemountet
- [ ] `PORT`/`BACKEND_PORT` beim Provider korrekt verdrahtet
- [ ] Health-Check-URL beim Provider: `GET /api/health`
- [ ] Backup (`python -m backend.backup`) einmal manuell gegen die produktive Instanz verifiziert, Restore-Pfad (`restore_backup()`) dokumentiert gelesen
- [ ] `GEMINI_API_KEY` (falls verwendet) als Secret, nicht im Klartext gesetzt

## Sicherheitsblocker (dieser Sprint führt KEINE Authentifizierung ein)

Diese Liste ist der Grund, warum ein öffentliches Production-Deployment
**No-Go** bleibt, bis sie abgearbeitet ist:

| Blocker | Betroffen | Risiko |
|---|---|---|
| Keine Authentifizierung | gesamte API | Jeder mit Netzwerkzugriff kann lesen/schreiben |
| Keine Rollen/Autorisierung | gesamte API | Keine Unterscheidung zwischen "darf lesen" und "darf löschen/ändern" |
| Destruktive Routen ungeschützt | `DELETE /api/team/{id}`, `DELETE /api/weeks/{id}`, `DELETE /api/artist-plans/{id}`, `DELETE /api/rehearsal-plans/{id}`, `POST /api/system/restart` | Datenverlust/Störung durch jeden Aufrufer |
| Systemdiagnose ungeschützt | `GET /api/system/diagnostics` | Gibt Pfad-Struktur, Host/Port, CORS-Konfiguration, Plattenplatz preis - für einen unauthentifizierten Endpunkt zu viel Information |
| API-Key als Query-Parameter | `POST /api/upload/pdf?api_key=...` (`frontend/lib/api.ts: uploadPdf`) | Query-Parameter landen in Server-/Proxy-/Browser-Logs; ist hier der optionale Gemini-Key des Nutzers, kein System-Secret, aber dennoch ein Leak-Risiko |
| Rohfehlertexte möglich | Alle Endpunkte, die `HTTPException(..., str(exc))` verwenden (z.B. `routers/imports.py`, `routers/plans.py`) | Exception-Text kann interne Details enthalten; `/api/health` selbst ist geprüft sauber (siehe `backend/tests/test_api.py`), nicht aber jeder Fehlerpfad der Fach-Endpunkte |
| Personenbezogene Daten bei Gemini-Verarbeitung | `POST /api/upload/pdf` mit `GEMINI_API_KEY` gesetzt | Hochgeladene Dienstplan-PDFs (Namen, Zeiten) werden an die Google-Gemini-API übertragen, wenn ein Key konfiguriert ist - vertraglich/datenschutzrechtlich zu klären, bevor ein Deployment mit echten Personendaten öffentlich läuft |

**Für Preview-Deployments**: Vercel Deployment Protection ist deshalb
Pflicht (siehe oben), nicht optional - sie ist der einzige Schutzmechanismus
vor diesen Blockern, solange keine Authentifizierung existiert.

## Go/No-Go-Bewertung

| Szenario | Bewertung | Begründung |
|---|---|---|
| Lokales Deployment (Startskripte, `local_data/`) | **Go** | Unverändertes, seit langem verifiziertes Verhalten; kein Netzwerkrisiko außerhalb `localhost` |
| Geschütztes Preview-Deployment (Vercel Deployment Protection aktiv, Backend nur intern/Team erreichbar) | **Go** | Sicherheitsblocker bleiben bestehen, sind aber durch Zugriffsschutz auf Plattformebene abgedeckt |
| Internes Production-Deployment (nur firmen-/teamintern erreichbar, z.B. VPN/IP-Allowlist) | **Bedingtes Go** | Nur, wenn der Netzwerkzugriff selbst bereits wie eine Authentifizierungsgrenze wirkt (z.B. VPN-only); ohne das: No-Go |
| Öffentliches Production-Deployment (frei erreichbar im Internet) | **No-Go** | Bleibt No-Go, bis Authentifizierung/Autorisierung existiert - siehe Sicherheitsblocker oben. Dieser Sprint führt das bewusst nicht ein |

## Verbleibende Blocker (nicht erschöpfend, siehe auch oben)

- Auth/Rollen: nicht vorhanden - größter Blocker für öffentliches Production.
- API-Key in Query-Parametern (`uploadPdf`): sollte perspektivisch auf Header/Body verlagert werden.
- PostgreSQL-Migration: nicht Teil dieses Sprints, wird nötig, sobald horizontal skaliert werden soll.
- Blob Storage: aktuell nicht nötig (siehe `STORAGE_INVENTORY.md`), erst relevant, falls Uploads/Exporte künftig tatsächlich persistiert werden.
- Multi-Instanz-Betrieb: durch SQLite ausgeschlossen, bis auf PostgreSQL migriert wird.
- Monitoring/Alerting: nur die Plattform-Basics (Health-Check, Logs) - kein dediziertes APM/Error-Tracking angebunden.
- Öffentliche Diagnose-Endpunkte: `/api/system/diagnostics` bleibt unauthentifiziert, siehe Sicherheitsblocker-Tabelle.
