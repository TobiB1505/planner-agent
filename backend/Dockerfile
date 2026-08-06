# Providerneutrales Image für das FastAPI-Backend (Railway, Render, Fly.io,
# jeder generische Container-Host). Build-Kontext ist ABSICHTLICH backend/
# selbst (nicht der Repo-Root) - siehe docs/deployment/BACKEND_CONTAINER.md:
#
#   docker build -t planner-agent-backend -f backend/Dockerfile backend
#
# Dadurch liegen .env, .git/ und frontend/ ausserhalb des Build-Kontexts und
# können gar nicht erst versehentlich mitkopiert werden - backend/.dockerignore
# schliesst zusätzlich Tests und Cache-Artefakte aus.
FROM python:3.9-slim

# Python 3.9 exakt wie in README.md/CI dokumentiert - kein abweichender Stand
# zwischen lokaler Entwicklung, CI und Container.

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

# Persistentes Volume für SQLite-Datenbank, Archiv und Backups - siehe
# docs/deployment/BACKEND_CONTAINER.md. Das Image/der Container kann nicht
# technisch beweisen, dass /data tatsächlich auf einen persistenten
# Datenträger gemountet ist - das ist Aufgabe der Hosting-Plattform.
VOLUME ["/data"]

EXPOSE 8000

# Genau ein Uvicorn-Prozess (backend/run_local.py ruft uvicorn.run() ohne
# workers= auf - SQLite verträgt keine parallelen Schreibprozesse), kein
# --reload (Entwickleroption, siehe BACKEND_RELOAD in .env.example). Port
# wird aus PORT (Plattform-Standard) oder BACKEND_PORT gelesen, Host ist
# oben fest auf 0.0.0.0 gesetzt (extern erreichbar, anders als der lokale
# 127.0.0.1-Default). Die Vorprüfung in run_local.py bricht den Start mit
# einer klaren Meldung ab, falls z.B. PLANNER_DATA_DIR in APP_ENV=production
# fehlt oder /data nicht beschreibbar ist.
CMD ["python", "-m", "backend.run_local"]
