# Deployment-Architektur (Sprint: Deployment-Readiness)

## Zielbild

```
Browser
   │
   ▼
Vercel – Next.js Frontend  (Root Directory: frontend, Framework: Next.js)
   │
   │ relative /api/* Requests (nie eine absolute Backend-URL im Browser)
   ▼
serverseitiger Next.js-Rewrite (frontend/next.config.ts, frontend/lib/backend-url.ts)
   │
   ▼
extern betriebenes FastAPI-Backend (Container, providerneutral: Railway/Render/Fly.io/...)
   │
   └── persistenter Datenspeicher über PLANNER_DATA_DIR (SQLite-DB + Backups)
```

Der Browser kennt die Backend-URL nie - er spricht ausschließlich relative
`/api/...`-Pfade an (`frontend/lib/api.ts`). Der Next.js-Server löst
`BACKEND_INTERNAL_URL` serverseitig auf und leitet weiter (`rewrites()` in
`next.config.ts`). Diese Trennung bestand bereits vor diesem Sprint und
bleibt unverändert - der Sprint macht die Auflösung nur produktionssicher
(siehe `docs/deployment/VERCEL_FRONTEND.md`).

## Warum extern und nicht als Vercel-Funktion

FastAPI läuft nicht als Vercel-Function, weil:

- Vercel-Functions sind zustandslos und kurzlebig - eine SQLite-Datei
  braucht dagegen einen langlebigen Prozess mit stabilem Dateisystemzugriff.
- Das Backend nutzt PyMuPDF (`fitz`) für PDF-Extraktion und pandas/openpyxl
  für Excel-Verarbeitung - native Abhängigkeiten, die in einem regulären
  Container unkomplizierter sind als in einer Serverless-Function-Umgebung.
- Ein einzelner, langlebiger Uvicorn-Prozess passt besser zu SQLite (keine
  parallelen Schreibprozesse, siehe unten) als viele kurzlebige,
  potenziell parallele Function-Invocations.

## Grenzen dieser ersten Deployment-Stufe

Dieser Sprint schafft eine **reproduzierbare Preview-/Deployment-Grundlage**,
ausdrücklich **kein** produktionsreifes öffentliches Deployment:

- **SQLite bleibt** - funktioniert nur mit genau einer Backend-Instanz, kein
  horizontales Skalieren. Siehe "Datenhaltung" unten.
- **Keine Authentifizierung/Autorisierung** - jede erreichbare Instanz ist
  für jeden mit Netzwerkzugriff voll nutz- und admin-bar. Siehe
  `docs/deployment/DEPLOYMENT_CHECKLIST.md` (Abschnitt Sicherheitsblocker).
- **Kein Blob-Storage** - nicht nötig, siehe `STORAGE_INVENTORY.md` (Uploads/
  Exporte sind bereits in-memory bzw. ephemeres Tempfile, kein Objektspeicher
  erforderlich).
- **Kein Monitoring/Alerting** über die Plattform-Basics hinaus.
- Die Anwendung kann technisch nicht beweisen, dass ein gemountetes Volume
  tatsächlich persistent ist (siehe `docs/deployment/BACKEND_CONTAINER.md`)
  - das bleibt Verantwortung der Hosting-Plattform/Konfiguration.

## Datenhaltung: SQLite bleibt (befristet)

SQLite ist für diese Stufe zulässig, solange:

- nur eine Backend-Instanz läuft (kein horizontales Skalieren, kein
  Multi-Region-Betrieb),
- `PLANNER_DATA_DIR` auf ein tatsächlich persistentes Volume zeigt,
- Backup (`python -m backend.backup`) und Restore (`backend/backup.py:
  restore_backup()`) dokumentiert und getestet sind (siehe
  `docs/deployment/BACKEND_CONTAINER.md`).

Eine PostgreSQL-Migration ist bewusst **nicht** Teil dieses Sprints.

## Vercel-Konfiguration: was entfernt wurde und warum

Der bisherige Root-`vercel.json` deklarierte ein `services`-Schema
(`frontend`+`backend` als eigene Vercel-"Services") mit einem
`/api/backend/*`-Sonderpfad-Rewrite auf einen nie real konfigurierten
Backend-Service. Das war aus mehreren Gründen falsch für die Zielarchitektur:

1. Das Frontend ruft `/api/backend/*` nirgends auf (`frontend/lib/api.ts`
   verwendet ausschließlich `/api/*`) - der Sonderpfad war funktionslos.
2. Die Zielarchitektur betreibt das Backend **extern** (Railway/Render/
   Fly.io), nicht als Vercel-Service - das `services.backend`-Objekt
   suggerierte eine Architektur, die nie existierte.
3. Dieses Multi-Service-Schema ist für ein normales Vercel-Projekt mit
   `Root Directory: frontend` schlicht nicht nötig und stand im Verdacht,
   zum zuvor beobachteten Vercel-Deployment-Fehler beigetragen zu haben
   (Next.js' File-Tracer + ein nicht-standardmäßiges Root-Schema).

Die Datei wurde ersatzlos entfernt. `Root Directory: frontend` ist eine
Vercel-**Projekteinstellung** (im Dashboard bzw. via `vercel.json` *innerhalb*
von `frontend/`, falls dort je eine konkrete Einstellung nötig wird) - dafür
ist keine Root-`vercel.json` erforderlich. Details:
`docs/deployment/VERCEL_FRONTEND.md`.
