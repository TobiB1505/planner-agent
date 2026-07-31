"""Gemeinsame Formatierungs-Helfer."""
from __future__ import annotations

from datetime import date, datetime

WEEKDAYS_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]


def fmt_date(iso_str: str | None, with_weekday: bool = False) -> str:
    """YYYY-MM-DD -> DD.MM.YYYY (optional mit Wochentag-Kürzel)."""
    if not iso_str:
        return ""
    d = datetime.strptime(iso_str, "%Y-%m-%d").date()
    result = d.strftime("%d.%m.%Y")
    if with_weekday:
        result = f"{WEEKDAYS_DE[d.weekday()]} {result}"
    return result


def fmt_date_short(iso_str: str | None) -> str:
    """YYYY-MM-DD -> DD.MM."""
    if not iso_str:
        return ""
    d = datetime.strptime(iso_str, "%Y-%m-%d").date()
    return f"{WEEKDAYS_DE[d.weekday()]} {d.strftime('%d.%m.')}"


def fmt_date_range(start_iso: str, end_iso: str) -> str:
    return f"{fmt_date(start_iso)} – {fmt_date(end_iso)}"


def parse_de_date(de_str: str) -> date:
    """DD.MM.YYYY -> date."""
    return datetime.strptime(de_str, "%d.%m.%Y").date()
