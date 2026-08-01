"""SQLite storage for extracted Dienstpläne."""
from __future__ import annotations

import sqlite3

from .config.paths import DATABASE_PATH, ensure_runtime_directories

SCHEMA = """
CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    department TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS people_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id),
    alias TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS week_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kw INTEGER,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    source_pdf TEXT,
    imported_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_plan_id INTEGER NOT NULL REFERENCES week_plans(id),
    date TEXT NOT NULL,
    category TEXT NOT NULL,
    subcategory TEXT,
    person_id INTEGER REFERENCES people(id),
    raw_text TEXT
);

CREATE TABLE IF NOT EXISTS absences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_plan_id INTEGER NOT NULL REFERENCES week_plans(id),
    date TEXT NOT NULL,
    person_id INTEGER REFERENCES people(id),
    typ TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS artist_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_date TEXT NOT NULL UNIQUE,
    end_date TEXT NOT NULL,
    source_filename TEXT,
    sheet_name TEXT,
    imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS artist_plan_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artist_plan_id INTEGER NOT NULL REFERENCES artist_plans(id),
    date TEXT NOT NULL,
    field_key TEXT NOT NULL,
    content TEXT,
    UNIQUE(artist_plan_id, date, field_key)
);

CREATE TABLE IF NOT EXISTS rehearsal_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_date TEXT NOT NULL UNIQUE,
    end_date TEXT NOT NULL,
    source_filename TEXT,
    imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rehearsals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rehearsal_plan_id INTEGER NOT NULL REFERENCES rehearsal_plans(id),
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    location TEXT,
    activity TEXT NOT NULL,
    show_code TEXT,
    participants_raw TEXT,
    choreographer_raw TEXT,
    end_inferred INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rehearsal_people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rehearsal_id INTEGER NOT NULL REFERENCES rehearsals(id),
    raw_name TEXT NOT NULL,
    person_name TEXT,
    role TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL
);

-- Tobis Korrekturen am MA-Gedächtnis. Bewusst getrennt von allen abgeleiteten Daten:
-- das Gedächtnis wird bei jedem Lesen neu gerechnet, nur diese Tabelle wird gespeichert.
-- Dadurch überlebt eine Korrektur auch das Neu-Aufbauen der Probenplan-Tabellen beim
-- Re-Import. Schlüssel ist person_id (nie ein Name), damit Umbenennen/Soft-Delete nichts
-- verliert.
CREATE TABLE IF NOT EXISTS person_memory_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id),
    facet TEXT NOT NULL,        -- 'show' | 'free' | 'task'
    item_key TEXT NOT NULL,     -- show: Show-Code | free: 'weekdays' | task: normalisierte Kategorie
    state TEXT NOT NULL,        -- 'confirmed' | 'removed' | 'added' | 'pinned'
    value TEXT,                 -- JSON, nur für 'pinned' bzw. Zusatzinfos
    note TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(person_id, facet, item_key)
);
"""


def _migrate(conn):
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(people)").fetchall()}
    if "department" not in cols:
        conn.execute("ALTER TABLE people ADD COLUMN department TEXT")
    if "active" not in cols:
        conn.execute("ALTER TABLE people ADD COLUMN active INTEGER NOT NULL DEFAULT 1")
    if "deleted" not in cols:
        conn.execute("ALTER TABLE people ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0")
    conn.commit()


def get_conn():
    ensure_runtime_directories()
    conn = sqlite3.connect(str(DATABASE_PATH))
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    _migrate(conn)
    return conn


def get_all_people(conn, active_only: bool = False):
    query = "SELECT * FROM people WHERE deleted = 0"
    if active_only:
        query += " AND active = 1"
    query += " ORDER BY name"
    return conn.execute(query).fetchall()


def update_person(conn, person_id: int, name: str, department: str | None, active: bool):
    conn.execute(
        "UPDATE people SET name = ?, department = ?, active = ? WHERE id = ?",
        (name, department, 1 if active else 0, person_id),
    )
    conn.commit()


def delete_person(conn, person_id: int):
    """Entfernt eine Person aus dem Mitarbeiterpool, behält sie aber für historische Pläne."""
    conn.execute(
        "UPDATE people SET active = 0, deleted = 1 WHERE id = ?",
        (person_id,),
    )
    conn.commit()


def find_person_by_alias(conn, alias: str):
    row = conn.execute(
        "SELECT person_id FROM people_aliases WHERE alias = ? COLLATE NOCASE", (alias,)
    ).fetchone()
    if row:
        return row["person_id"]
    row = conn.execute(
        "SELECT id FROM people WHERE name = ? COLLATE NOCASE", (alias,)
    ).fetchone()
    return row["id"] if row else None


def create_person(conn, name: str, department: str | None = None) -> int:
    existing = conn.execute(
        "SELECT id, deleted FROM people WHERE name = ? COLLATE NOCASE",
        (name,),
    ).fetchone()
    if existing and existing["deleted"]:
        conn.execute(
            "UPDATE people SET department = ?, active = 1, deleted = 0 WHERE id = ?",
            (department, existing["id"]),
        )
        conn.commit()
        return existing["id"]
    cur = conn.execute(
        "INSERT INTO people (name, department, active, deleted) VALUES (?, ?, 1, 0)",
        (name, department),
    )
    conn.commit()
    return cur.lastrowid


def add_alias(conn, person_id: int, alias: str):
    conn.execute(
        "INSERT OR IGNORE INTO people_aliases (person_id, alias) VALUES (?, ?)",
        (person_id, alias),
    )
    conn.commit()


def insert_week_plan(conn, kw, start_date, end_date, source_pdf) -> int:
    cur = conn.execute(
        "INSERT INTO week_plans (kw, start_date, end_date, source_pdf) VALUES (?, ?, ?, ?)",
        (kw, start_date, end_date, source_pdf),
    )
    conn.commit()
    return cur.lastrowid


def insert_assignment(conn, week_plan_id, date, category, subcategory, person_id, raw_text):
    conn.execute(
        """INSERT INTO assignments (week_plan_id, date, category, subcategory, person_id, raw_text)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (week_plan_id, date, category, subcategory, person_id, raw_text),
    )


def insert_absence(conn, week_plan_id, date, person_id, typ):
    conn.execute(
        "INSERT INTO absences (week_plan_id, date, person_id, typ) VALUES (?, ?, ?, ?)",
        (week_plan_id, date, person_id, typ),
    )


def get_week_plans(conn):
    return conn.execute(
        """SELECT wp.*,
                  (SELECT COUNT(*) FROM assignments a
                   WHERE a.week_plan_id = wp.id) AS assignment_count,
                  (SELECT COUNT(*) FROM absences ab
                   WHERE ab.week_plan_id = wp.id) AS absence_count
           FROM week_plans wp
           ORDER BY wp.start_date DESC, wp.id DESC"""
    ).fetchall()


def get_assignments_for_week(conn, week_plan_id):
    return conn.execute(
        """SELECT a.date, a.category, a.subcategory, p.name AS person, a.raw_text
           FROM assignments a LEFT JOIN people p ON a.person_id = p.id
           WHERE a.week_plan_id = ? ORDER BY a.date, a.category""",
        (week_plan_id,),
    ).fetchall()


def get_absences_for_week(conn, week_plan_id):
    return conn.execute(
        """SELECT ab.date, p.name AS person, ab.typ
           FROM absences ab LEFT JOIN people p ON ab.person_id = p.id
           WHERE ab.week_plan_id = ? ORDER BY ab.date""",
        (week_plan_id,),
    ).fetchall()


def delete_week_plan(conn, week_plan_id):
    conn.execute("DELETE FROM assignments WHERE week_plan_id = ?", (week_plan_id,))
    conn.execute("DELETE FROM absences WHERE week_plan_id = ?", (week_plan_id,))
    conn.execute("DELETE FROM week_plans WHERE id = ?", (week_plan_id,))
    conn.commit()


def get_setting(conn, key: str, default: str | None = None) -> str | None:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(conn, key: str, value: str):
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
    conn.commit()


def get_memory_overrides(conn, person_id: int | None = None):
    if person_id is None:
        return conn.execute(
            "SELECT * FROM person_memory_overrides ORDER BY person_id, facet, item_key"
        ).fetchall()
    return conn.execute(
        "SELECT * FROM person_memory_overrides WHERE person_id = ? ORDER BY facet, item_key",
        (person_id,),
    ).fetchall()


def set_memory_override(
    conn,
    person_id: int,
    facet: str,
    item_key: str,
    state: str,
    value: str | None = None,
    note: str | None = None,
):
    conn.execute(
        """INSERT INTO person_memory_overrides (person_id, facet, item_key, state, value, note)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(person_id, facet, item_key) DO UPDATE SET
               state = excluded.state,
               value = excluded.value,
               note = excluded.note,
               updated_at = CURRENT_TIMESTAMP""",
        (person_id, facet, item_key, state, value, note),
    )
    conn.commit()


def clear_memory_override(conn, person_id: int, facet: str, item_key: str):
    conn.execute(
        "DELETE FROM person_memory_overrides WHERE person_id = ? AND facet = ? AND item_key = ?",
        (person_id, facet, item_key),
    )
    conn.commit()


def clear_memory_overrides_for_person(conn, person_id: int, facet: str | None = None):
    if facet is None:
        conn.execute("DELETE FROM person_memory_overrides WHERE person_id = ?", (person_id,))
    else:
        conn.execute(
            "DELETE FROM person_memory_overrides WHERE person_id = ? AND facet = ?",
            (person_id, facet),
        )
    conn.commit()


def upsert_artist_plan(
    conn,
    start_date: str,
    end_date: str,
    source_filename: str | None,
    sheet_name: str | None,
    entries: list[dict],
) -> int:
    conn.execute(
        """INSERT INTO artist_plans
               (start_date, end_date, source_filename, sheet_name)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(start_date) DO UPDATE SET
               end_date = excluded.end_date,
               source_filename = excluded.source_filename,
               sheet_name = excluded.sheet_name,
               updated_at = CURRENT_TIMESTAMP""",
        (start_date, end_date, source_filename, sheet_name),
    )
    row = conn.execute(
        "SELECT id FROM artist_plans WHERE start_date = ?", (start_date,)
    ).fetchone()
    artist_plan_id = row["id"]
    conn.execute(
        "DELETE FROM artist_plan_entries WHERE artist_plan_id = ?",
        (artist_plan_id,),
    )
    conn.executemany(
        """INSERT INTO artist_plan_entries
               (artist_plan_id, date, field_key, content)
           VALUES (?, ?, ?, ?)""",
        [
            (
                artist_plan_id,
                entry["date"],
                entry["field_key"],
                entry.get("content") or "",
            )
            for entry in entries
        ],
    )
    conn.commit()
    return artist_plan_id


def get_artist_plans(conn):
    return conn.execute(
        """SELECT ap.*,
                  COUNT(CASE WHEN TRIM(COALESCE(e.content, '')) <> '' THEN 1 END) AS filled_entries
           FROM artist_plans ap
           LEFT JOIN artist_plan_entries e ON e.artist_plan_id = ap.id
           GROUP BY ap.id
           ORDER BY ap.start_date DESC"""
    ).fetchall()


def get_artist_plan(conn, artist_plan_id: int):
    return conn.execute(
        "SELECT * FROM artist_plans WHERE id = ?", (artist_plan_id,)
    ).fetchone()


def get_artist_plan_by_start(conn, start_date: str):
    return conn.execute(
        "SELECT * FROM artist_plans WHERE start_date = ?", (start_date,)
    ).fetchone()


def get_artist_plan_entries(conn, artist_plan_id: int):
    return conn.execute(
        """SELECT date, field_key, content
           FROM artist_plan_entries
           WHERE artist_plan_id = ?
           ORDER BY date, field_key""",
        (artist_plan_id,),
    ).fetchall()


def delete_artist_plan(conn, artist_plan_id: int):
    conn.execute(
        "DELETE FROM artist_plan_entries WHERE artist_plan_id = ?",
        (artist_plan_id,),
    )
    conn.execute("DELETE FROM artist_plans WHERE id = ?", (artist_plan_id,))
    conn.commit()


def upsert_rehearsal_plan(
    conn,
    start_date: str,
    end_date: str,
    source_filename: str | None,
    rehearsals: list[dict],
) -> int:
    conn.execute(
        """INSERT INTO rehearsal_plans (start_date, end_date, source_filename)
           VALUES (?, ?, ?)
           ON CONFLICT(start_date) DO UPDATE SET
               end_date = excluded.end_date,
               source_filename = excluded.source_filename,
               updated_at = CURRENT_TIMESTAMP""",
        (start_date, end_date, source_filename),
    )
    plan_row = conn.execute(
        "SELECT id FROM rehearsal_plans WHERE start_date = ?", (start_date,)
    ).fetchone()
    plan_id = plan_row["id"]
    rehearsal_ids = [
        row["id"]
        for row in conn.execute(
            "SELECT id FROM rehearsals WHERE rehearsal_plan_id = ?", (plan_id,)
        ).fetchall()
    ]
    if rehearsal_ids:
        placeholders = ",".join("?" for _ in rehearsal_ids)
        conn.execute(
            f"DELETE FROM rehearsal_people WHERE rehearsal_id IN ({placeholders})",
            rehearsal_ids,
        )
    conn.execute("DELETE FROM rehearsals WHERE rehearsal_plan_id = ?", (plan_id,))

    for rehearsal in rehearsals:
        cursor = conn.execute(
            """INSERT INTO rehearsals
                   (rehearsal_plan_id, date, start_time, end_time, location, activity,
                    show_code, participants_raw, choreographer_raw, end_inferred)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                plan_id,
                rehearsal["date"],
                rehearsal["start_time"],
                rehearsal["end_time"],
                rehearsal.get("location"),
                rehearsal["activity"],
                rehearsal.get("show_code"),
                rehearsal.get("participants_raw"),
                rehearsal.get("choreographer_raw"),
                1 if rehearsal.get("end_inferred") else 0,
            ),
        )
        rehearsal_id = cursor.lastrowid
        conn.executemany(
            """INSERT INTO rehearsal_people
                   (rehearsal_id, raw_name, person_name, role, start_time, end_time)
               VALUES (?, ?, ?, ?, ?, ?)""",
            [
                (
                    rehearsal_id,
                    person["raw_name"],
                    person.get("person_name"),
                    person["role"],
                    person["start_time"],
                    person["end_time"],
                )
                for person in rehearsal.get("people", [])
            ],
        )
    conn.commit()
    return plan_id


def get_rehearsal_plans(conn):
    return conn.execute(
        """SELECT rp.*, COUNT(r.id) AS rehearsal_count
           FROM rehearsal_plans rp
           LEFT JOIN rehearsals r ON r.rehearsal_plan_id = rp.id
           GROUP BY rp.id
           ORDER BY rp.start_date DESC"""
    ).fetchall()


def get_rehearsal_plan(conn, rehearsal_plan_id: int):
    return conn.execute(
        "SELECT * FROM rehearsal_plans WHERE id = ?", (rehearsal_plan_id,)
    ).fetchone()


def get_rehearsal_plan_by_start(conn, start_date: str):
    return conn.execute(
        "SELECT * FROM rehearsal_plans WHERE start_date = ?", (start_date,)
    ).fetchone()


def get_rehearsals(conn, rehearsal_plan_id: int):
    rows = conn.execute(
        """SELECT * FROM rehearsals
           WHERE rehearsal_plan_id = ?
           ORDER BY date, start_time, id""",
        (rehearsal_plan_id,),
    ).fetchall()
    result = []
    for row in rows:
        item = dict(row)
        item["end_inferred"] = bool(item["end_inferred"])
        item["people"] = [
            dict(person)
            for person in conn.execute(
                """SELECT raw_name, person_name, role, start_time, end_time
                   FROM rehearsal_people
                   WHERE rehearsal_id = ?
                   ORDER BY role, id""",
                (row["id"],),
            ).fetchall()
        ]
        result.append(item)
    return result


def get_rehearsal_intervals(conn, start_date: str, end_date: str):
    return conn.execute(
        """SELECT p.person_name, r.date, p.start_time, p.end_time,
                  p.role, r.activity, r.show_code
           FROM rehearsal_people p
           JOIN rehearsals r ON r.id = p.rehearsal_id
           WHERE p.person_name IS NOT NULL
             AND r.date BETWEEN ? AND ?
           ORDER BY r.date, p.start_time, p.person_name""",
        (start_date, end_date),
    ).fetchall()


def get_rehearsal_events(conn, start_date: str, end_date: str):
    return conn.execute(
        """SELECT date, start_time, end_time, activity, show_code
           FROM rehearsals
           WHERE date BETWEEN ? AND ?
           ORDER BY date, start_time, id""",
        (start_date, end_date),
    ).fetchall()


def delete_rehearsal_plan(conn, rehearsal_plan_id: int):
    rehearsal_ids = [
        row["id"]
        for row in conn.execute(
            "SELECT id FROM rehearsals WHERE rehearsal_plan_id = ?",
            (rehearsal_plan_id,),
        ).fetchall()
    ]
    if rehearsal_ids:
        placeholders = ",".join("?" for _ in rehearsal_ids)
        conn.execute(
            f"DELETE FROM rehearsal_people WHERE rehearsal_id IN ({placeholders})",
            rehearsal_ids,
        )
    conn.execute(
        "DELETE FROM rehearsals WHERE rehearsal_plan_id = ?",
        (rehearsal_plan_id,),
    )
    conn.execute(
        "DELETE FROM rehearsal_plans WHERE id = ?",
        (rehearsal_plan_id,),
    )
    conn.commit()
