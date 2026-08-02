"""Kompakter, personenbezogen sparsamer Änderungsverlauf für Dienstpläne."""
from __future__ import annotations

import json

ALLOWED_EVENT_TYPES = {
    "cell_changed",
    "recommendation_applied",
    "automation_applied",
    "undo",
    "redo",
    "plan_saved",
}


def compact_events(events: list[dict]) -> list[dict]:
    """Entfernt No-ops und begrenzt doppelte Zelländerungen auf relevante Werte."""
    result: list[dict] = []
    for event in events:
        event_type = event.get("event_type") or "cell_changed"
        if event_type not in ALLOWED_EVENT_TYPES:
            continue
        previous = event.get("previous_value")
        new = event.get("new_value")
        if event_type == "cell_changed" and previous == new:
            continue
        result.append({
            "event_type": event_type,
            "cause": event.get("cause") or "manual_edit",
            "cell_key": event.get("cell_key"),
            "previous_value": previous,
            "new_value": new,
            "metadata": event.get("metadata") or {},
        })
    return result[-250:]


def record_events(
    conn,
    *,
    week_plan_id: int | None,
    start_date: str,
    events: list[dict],
    user_name: str = "Planer",
) -> None:
    rows = compact_events(events)
    if not rows:
        return
    conn.executemany(
        """INSERT INTO plan_audit_log
               (week_plan_id, start_date, user_name, event_type, cause, cell_key,
                previous_value, new_value, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            (
                week_plan_id,
                start_date,
                user_name,
                row["event_type"],
                row["cause"],
                row["cell_key"],
                row["previous_value"],
                row["new_value"],
                json.dumps(row["metadata"], ensure_ascii=False),
            )
            for row in rows
        ],
    )


def record_plan_saved(conn, *, week_plan_id: int, start_date: str, assignments: int) -> None:
    record_events(
        conn,
        week_plan_id=week_plan_id,
        start_date=start_date,
        events=[{
            "event_type": "plan_saved",
            "cause": "manual_save",
            "new_value": f"{assignments} Zuweisungen",
            "metadata": {"assignment_count": assignments},
        }],
    )


def list_events(conn, *, week_plan_id: int | None = None, start_date: str | None = None, limit: int = 100) -> list[dict]:
    if week_plan_id is not None:
        rows = conn.execute(
            """SELECT * FROM plan_audit_log WHERE week_plan_id = ?
               ORDER BY id DESC LIMIT ?""",
            (week_plan_id, limit),
        ).fetchall()
    elif start_date:
        rows = conn.execute(
            """SELECT * FROM plan_audit_log WHERE start_date = ?
               ORDER BY id DESC LIMIT ?""",
            (start_date, limit),
        ).fetchall()
    else:
        return []
    result = []
    for row in rows:
        try:
            metadata = json.loads(row["metadata_json"] or "{}")
        except json.JSONDecodeError:
            metadata = {}
        result.append({
            "id": row["id"],
            "week_plan_id": row["week_plan_id"],
            "start_date": row["start_date"],
            "user": row["user_name"],
            "event_type": row["event_type"],
            "cause": row["cause"],
            "cell_key": row["cell_key"],
            "previous_value": row["previous_value"],
            "new_value": row["new_value"],
            "metadata": metadata,
            "created_at": row["created_at"],
        })
    return result
