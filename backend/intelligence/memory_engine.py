"""Strukturiertes, nachvollziehbares Mitarbeitergedächtnis.

Automatische Einträge sind Projektionen echter Historie. Nur manuelle Hinweise
werden gespeichert; so bleibt jede Aussage rückverfolgbar und korrigierbar.
"""
from __future__ import annotations

import json
from datetime import date

from .. import memory


def _confidence_from_label(label: str | None) -> float:
    return {"hoch": 0.9, "mittel": 0.7, "niedrig": 0.45}.get(label or "", 0.5)


def _automatic_entries(person_memory: dict) -> list[dict]:
    entries: list[dict] = []
    for show in person_memory.get("shows", []):
        entries.append({
            "id": f"auto:show:{show['show_key']}",
            "type": "experience",
            "subject": f"show:{show['show_key']}",
            "value": {
                "label": show["label"],
                "kind": show["kind"],
                "appearances": show["appearances"],
                "counts_for_planning": show.get("counts_for_planning", False),
            },
            "confidence": _confidence_from_label(show.get("confidence")),
            "source": "historical_data",
            "source_date": show.get("last_date"),
            "editable": False,
            "note": f"{show['appearances']} Probentag(e) in {show.get('weeks', 0)} Woche(n)",
        })

    free = person_memory.get("free", {})
    if free.get("weekdays"):
        confidence = 0.82 if free.get("pattern") == "clear" else 0.62
        entries.append({
            "id": "auto:preference:free_weekdays",
            "type": "preference",
            "subject": "free_weekdays",
            "value": {"weekdays": free["weekdays"], "pattern": free.get("pattern")},
            "confidence": confidence,
            "source": "manual_override" if free.get("source") == "manuell" else "historical_data",
            "source_date": None,
            "editable": False,
            "note": f"Aus {free.get('total_free_days', 0)} dokumentierten freien Tagen",
        })

    for task in person_memory.get("tasks", []):
        affinity = float(task.get("affinity") or 0)
        if task.get("state") == "removed":
            continue
        if affinity <= 0 and task.get("state") not in {"added", "confirmed"}:
            continue
        count = int(task.get("count") or 0)
        confidence = min(0.95, 0.45 + min(count, 10) * 0.04 + max(0.0, affinity) * 0.2)
        entries.append({
            "id": f"auto:preference:task:{task['category']}",
            "type": "preference",
            "subject": f"task:{task['category']}",
            "value": "preferred",
            "confidence": round(confidence, 2),
            "source": "manual_override" if task.get("state") in {"added", "confirmed"} else "historical_data",
            "source_date": task.get("last_date"),
            "editable": False,
            "note": f"{count} historische Einsätze in dieser Kategorie",
        })
    return entries


def _manual_entries(conn, person_id: int) -> list[dict]:
    rows = conn.execute(
        """SELECT id, type, subject, value, confidence, source, source_date,
                  editable, note, updated_at
           FROM employee_memory WHERE person_id = ? ORDER BY updated_at DESC""",
        (person_id,),
    ).fetchall()
    result = []
    for row in rows:
        try:
            value = json.loads(row["value"])
        except json.JSONDecodeError:
            value = row["value"]
        result.append({
            "id": f"manual:{row['id']}",
            "type": row["type"],
            "subject": row["subject"],
            "value": value,
            "confidence": row["confidence"],
            "source": row["source"],
            "source_date": row["source_date"],
            "editable": bool(row["editable"]),
            "note": row["note"],
            "updated_at": row["updated_at"],
        })
    return result


def entries_for_person(conn, person_id: int) -> list[dict]:
    profile = memory.memory_for_person(conn, person_id)
    if profile is None:
        raise ValueError("Mitarbeiter wurde nicht gefunden.")
    entries = _manual_entries(conn, person_id) + _automatic_entries(profile)
    return sorted(
        entries,
        key=lambda item: (item["source"] != "manual", item["type"], item["subject"]),
    )


def upsert_manual_entry(
    conn,
    person_id: int,
    *,
    entry_type: str,
    subject: str,
    value,
    confidence: float = 1.0,
    note: str | None = None,
    source_date: str | None = None,
) -> list[dict]:
    if not 0 <= confidence <= 1:
        raise ValueError("Konfidenz muss zwischen 0 und 1 liegen.")
    conn.execute(
        """INSERT INTO employee_memory
               (person_id, type, subject, value, confidence, source, source_date, editable, note)
           VALUES (?, ?, ?, ?, ?, 'manual', ?, 1, ?)
           ON CONFLICT(person_id, type, subject, source) DO UPDATE SET
               value = excluded.value,
               confidence = excluded.confidence,
               source_date = excluded.source_date,
               note = excluded.note,
               updated_at = CURRENT_TIMESTAMP""",
        (
            person_id,
            entry_type.strip(),
            subject.strip(),
            json.dumps(value, ensure_ascii=False),
            confidence,
            source_date or date.today().isoformat(),
            note,
        ),
    )
    conn.commit()
    return entries_for_person(conn, person_id)


def delete_manual_entry(conn, person_id: int, entry_id: int) -> list[dict]:
    conn.execute(
        "DELETE FROM employee_memory WHERE id = ? AND person_id = ? AND source = 'manual'",
        (entry_id, person_id),
    )
    conn.commit()
    return entries_for_person(conn, person_id)
