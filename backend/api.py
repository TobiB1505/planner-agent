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
from .routers import dashboard, imports, intelligence, memory, people, plans, settings, system
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
    yield


app = FastAPI(title="Planner-Agent API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(people.router)
app.include_router(plans.router)
app.include_router(imports.router)
app.include_router(intelligence.router)
app.include_router(memory.router)
app.include_router(dashboard.router)
app.include_router(settings.router)
app.include_router(system.router)
