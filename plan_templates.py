"""Feste Grundvorlagen für den Zwei-Wochen-Rhythmus des Entertainment-Programms.

Woche A basiert auf dem neuesten New-York-Plan, Woche B auf dem neuesten Espania-Plan.
Die Projektkopien enthalten jeweils nur das eine relevante Wochenblatt, behalten aber
sämtliche Formatierungen, verbundenen Zellen, Farben und Spaltenbreiten des Originals.
"""
from __future__ import annotations

from pathlib import Path

import openpyxl

import db

PROJECT_DIR = Path(__file__).parent
TEMPLATE_DIR = PROJECT_DIR / "templates"

# Tobis Rechner-Standard: nur verwendet, solange in `settings` kein eigener
# Pfad hinterlegt ist (siehe `build_template`). Erster Start / unveränderte
# Installationen verhalten sich dadurch weiterhin exakt wie zuvor.
DEFAULT_SOURCE_PATHS: dict[str, Path] = {
    "A": Path(
        "/Users/tobibayer/Desktop/Dienstplan-Archiv/"
        "DienstplanNEU_KW01_NewYork_2026.xlsx"
    ),
    "B": Path(
        "/Users/tobibayer/Desktop/Dienstplan-Archiv/"
        "DienstplanNEU_KW02_Espania_2026.xlsx"
    ),
}

TEMPLATES: dict[str, dict] = {
    "A": {
        "code": "A",
        "name": "Woche A",
        "program": "New York",
        "description": "New-York-Programm mit Taste of New York und Royals of Rock.",
        "parity": 1,
        "source_sheet": "KW31_27.07.-02.08",
        "path": TEMPLATE_DIR / "Woche_A_NewYork.xlsx",
        "sheet": "Woche A - New York",
    },
    "B": {
        "code": "B",
        "name": "Woche B",
        "program": "Espania",
        "description": "Espania-Programm mit What If, Viva Espana und Greatest Show.",
        "parity": 0,
        "source_sheet": "KW32_03.08.-09.08. ",
        "path": TEMPLATE_DIR / "Woche_B_Espania.xlsx",
        "sheet": "Woche B - Espania",
    },
}


def _source_path(conn, code: str) -> Path:
    default = DEFAULT_SOURCE_PATHS[code]
    value = db.get_setting(conn, f"template_{code.lower()}_source_path", default=str(default))
    return Path(value)


def build_template(conn, code: str, overwrite: bool = False) -> Path:
    spec = TEMPLATES[code]
    target: Path = spec["path"]
    if target.exists() and not overwrite:
        return target
    source = _source_path(conn, code)
    if not source.exists():
        raise FileNotFoundError(f"Grundvorlage nicht gefunden: {source}")

    TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)
    wb = openpyxl.load_workbook(source)
    source_sheet = spec["source_sheet"]
    if source_sheet not in wb.sheetnames:
        raise ValueError(f"Blatt '{source_sheet}' fehlt in {source.name}.")
    for ws in list(wb.worksheets):
        if ws.title != source_sheet:
            wb.remove(ws)
    wb[source_sheet].title = spec["sheet"]
    wb.save(target)
    wb.close()
    return target


def ensure_templates(conn) -> None:
    for code in TEMPLATES:
        build_template(conn, code)


def get_template(conn, code: str) -> dict:
    normalized = code.strip().upper()
    if normalized not in TEMPLATES:
        raise KeyError(f"Unbekannte Grundvorlage: {code}")
    ensure_templates(conn)
    return TEMPLATES[normalized]


def public_templates(conn) -> list[dict]:
    ensure_templates(conn)
    return [
        {
            "code": spec["code"],
            "name": spec["name"],
            "program": spec["program"],
            "description": spec["description"],
            "parity": spec["parity"],
            "path": str(spec["path"]),
            "sheet": spec["sheet"],
        }
        for spec in TEMPLATES.values()
    ]

