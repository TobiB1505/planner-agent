"""AP11 - echte, domänenübergreifende Helfer/Modelle mehrerer Router.

Nur Dinge, die tatsächlich von mehr als einem Router gebraucht werden, landen
hier (clean/records: plans+dashboard+memory+intelligence; _cors_origins:
api.py-Middleware + system.py; _week_dates/_grid_df_from_rows: plans+
intelligence; ImportAbsence: imports+plans). Alles, was nur ein Router
braucht, bleibt bewusst dort lokal.
"""
from __future__ import annotations

import math
import os
from datetime import datetime, timedelta
from typing import Any

import pandas as pd
from pydantic import BaseModel


def clean(obj):
    """NaN/NaT-sicher für JSON (pandas erzeugt NaN, das ist kein gültiges JSON)."""
    if isinstance(obj, float) and math.isnan(obj):
        return None
    if isinstance(obj, dict):
        return {k: clean(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean(v) for v in obj]
    return obj


def records(df: pd.DataFrame) -> list[dict]:
    if df.empty:
        return []
    return clean(df.to_dict(orient="records"))


def _cors_origins() -> list[str]:
    """Liest erlaubte lokale Origins aus CORS_ORIGINS (kommasepariert).

    Fällt ohne Einstellung auf die beiden lokalen Next.js-Dev-Adressen
    zurück - die Browser-Anfragen laufen im Normalbetrieb ohnehin same-origin
    über den next.config.ts-Rewrite, CORS greift nur bei direkter
    Backend-Ansprache während der lokalen Entwicklung.
    """
    raw = os.getenv("CORS_ORIGINS", "")
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    return origins or ["http://localhost:3000", "http://127.0.0.1:3000"]


def _week_dates(new_start_iso: str) -> list[str]:
    d = datetime.strptime(new_start_iso, "%Y-%m-%d").date()
    return [(d + timedelta(days=i)).isoformat() for i in range(7)]


def _grid_df_from_rows(rows: list[dict[str, Any]]) -> pd.DataFrame:
    return pd.DataFrame(rows)


class ImportAbsence(BaseModel):
    date: str
    person: str
    type: str
