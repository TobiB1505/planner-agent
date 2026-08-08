# Providerneutrales Image für das FastAPI-Backend (Railway, Render, Fly.io,
# jeder generische Container-Host). Build-Kontext ist ABSICHTLICH backend/
# selbst (nicht der Repo-Root) - siehe docs/deployment/BACKEND_CONTAINER.md:
#
#   docker build -t planner-agent-backend -f backend/Dockerfile backend
#
# Dadurch liegen .env, .git/ und frontend/ ausserhalb des Build-Kontexts und
# können gar nicht erst versehentlich mitkopiert werden - backend/.dockerignore
# schliesst zusätzlich Tests und Cache-Artefakte aus.
FROM python:3.11-slim

# Python 3.11 exakt wie in der CI (.github/workflows/ci.yml) - kein
# abweichender Stand zwischen lokaler Entwicklung, CI und Container. Angehoben
# von 3.9 mit der PostgreSQL-Migration: psycopg 3 und der mitgelieferte
# Connection Pool setzen einen aktuelleren Interpreter voraus, und 3.9 bekommt
# seit Oktober 2025 keine Sicherheitsupdates mehr.

WORKDIR /app

# Nur die Dependency-Deklaration zuerst kopieren, damit ein reiner
# Code-Commit (ohne neue Dependency) die pip-install-Layer aus dem
# Docker-Cache wiederverwenden kann.
COPY requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Restlicher Backend-Code + Excel-Grundvorlagen (backend/resources/) als
# Package "backend/" - "python -m backend.run_local" unten funktioniert
# dadurch identisch zur lokalen Aufrufkonvention aus dem Projektstamm
# (siehe README, backend/run_local.py). local_data/, .venv/, .env liegen
# ausserhalb dieses Kontexts und werden nie kopiert.
COPY . backend/

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    BACKEND_HOST=0.0.0.0 \
    PLANNER_DATA_DIR=/data

# /data ist seit der PostgreSQL-Migration NICHT mehr die Datenhaltung: die
# operative Datenbank hängt ausschließlich an DATABASE_URL (siehe
# backend/db.py, docs/database/SUPABASE_SETUP.md). Der Pfad muss weiterhin
# beschreibbar sein (Startvorprüfung, Diagnose, temporäre Verzeichnisse), aber
# nicht mehr persistent - siehe docs/database/POSTGRES_STORAGE_GAPS.md.
# Die VOLUME-Deklaration bleibt bewusst stehen, damit ein bestehendes Deployment
# mit gemounteter Disk unverändert weiterläuft; sie kann nach dem Cutover
# entfernt werden.
VOLUME ["/data"]

EXPOSE 8000

# Genau ein Uvicorn-Prozess (backend/run_local.py ruft uvicorn.run() ohne
# workers= auf). Das war unter SQLite technisch zwingend; mit PostgreSQL wäre
# Mehr-Prozess-Betrieb grundsätzlich möglich, wird hier aber bewusst NICHT
# eingeführt - jeder zusätzliche Prozess brächte einen eigenen Connection Pool
# und damit ein Vielfaches der Verbindungen gegen ein hartes Limit. Kein
# --reload (Entwickleroption, siehe BACKEND_RELOAD in .env.example). Port
# wird aus PORT (Plattform-Standard) oder BACKEND_PORT gelesen, Host ist
# oben fest auf 0.0.0.0 gesetzt (extern erreichbar, anders als der lokale
# 127.0.0.1-Default). Die Vorprüfung in run_local.py bricht den Start mit
# einer klaren Meldung ab, falls z.B. PLANNER_DATA_DIR in APP_ENV=production
# fehlt oder /data nicht beschreibbar ist.
CMD ["python", "-m", "backend.run_local"]
