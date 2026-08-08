"""FastAPI-Backend - wrappt die bestehende Python-Logik (db/stats/assignment/xlsx_template/
extraction/template_spec) als REST-API für das neue Next.js-Frontend.

AP11: enthält nur noch App-Erstellung, Middleware, Lifespan und Router-
Registrierung. Die eigentlichen Endpunkte liegen fachlich aufgeteilt unter
backend/routers/ (Move-Only-Refactoring, keine Verhaltensänderung - siehe
docs/refactoring/AP11_API_ROUTER_SPLIT.md)."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .auth.config import load_auth_settings
from .routers import (
    admin_users,
    auth,
    dashboard,
    imports,
    intelligence,
    memory,
    people,
    plans,
    settings,
    system,
)
from .routers.shared import _cors_origins

load_dotenv()

logger = logging.getLogger(__name__)
if not logging.getLogger().handlers:
    logging.basicConfig(level=logging.INFO)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Führt die einmalige DB-Initialisierung (Schema, Migration, Laufzeitordner)
    genau einmal beim Start dieses App-Prozesses aus (AP4 - Verbindungs-/Schema-
    Lifecycle). Schlägt initialize_database() fehl, wird die Exception nicht
    abgefangen - ein fehlgeschlagener DB-Start soll den App-Start sichtbar
    verhindern, statt eine scheinbar laufende App ohne nutzbare Datenbank zu
    hinterlassen."""
    db.initialize_database()
    _warn_if_auth_unconfigured()
    yield


def _warn_if_auth_unconfigured() -> None:
    """Auth-Sprint: macht eine fehlende Supabase-Konfiguration beim Start
    sichtbar - ohne den Start abzubrechen und ohne die Prüfung abzuschalten.

    Das Verhalten ist fail-closed: ohne JWKS-URL bzw. JWT-Secret lässt sich
    kein Token verifizieren, also antwortet jeder geschützte Endpunkt mit
    401. Ein leises "dann eben ohne Auth" gibt es bewusst nicht. Der Log
    enthält nur die Namen der fehlenden Variablen, nie deren Werte.
    """
    auth_settings = load_auth_settings()
    if not auth_settings.is_configured:
        logger.warning(
            "Supabase-Auth ist nicht konfiguriert (SUPABASE_URL bzw. "
            "SUPABASE_JWT_ISSUER fehlen). Alle geschützten Endpunkte "
            "antworten mit 401, /api/health bleibt erreichbar. Siehe "
            "docs/auth/SUPABASE_AUTH_SETUP.md."
        )


app = FastAPI(title="Planner-Agent API", lifespan=lifespan)

# allow_credentials bleibt bewusst aus (Standard: False): der Browser spricht
# im Normalbetrieb ausschliesslich same-origin über den Next.js-Rewrite, und
# das Access Token reist als Authorization-Header, nicht als Cookie. Damit
# gibt es keinen Grund, Cross-Origin-Credentials zu erlauben - und die
# Kombination "allow_credentials=True mit weiten Origins" kann gar nicht erst
# entstehen. _cors_origins() listet weiterhin nur die konkret konfigurierten
# Entwicklungs-Origins, nie "*".
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(admin_users.router)
app.include_router(people.router)
app.include_router(plans.router)
app.include_router(imports.router)
app.include_router(intelligence.router)
app.include_router(memory.router)
app.include_router(dashboard.router)
app.include_router(settings.router)
app.include_router(system.router)
