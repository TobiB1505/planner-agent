"""Rotations-/Fairness-Auswertung über importierte Dienstpläne."""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

import pandas as pd

from . import db
from . import planning_rules
from . import rehearsal_plan
from . import template_spec
from . import util


def normalize_category(raw: str) -> str:
    cat = re.sub(r"^\d{1,2}:\d{2}\s*", "", raw)          # führende Uhrzeit
    cat = re.sub(r"\s*\([^)]*\)\s*$", "", cat)             # nachgestellte Klammer
    cat = cat.replace("/", " + ")
    cat = re.sub(r"\s+", " ", cat)                         # doppelte Leerzeichen
    return cat.strip()


# Kategorien, die keine Team-Rotation im eigentlichen Sinn sind (Abteilungen/Info/manuell,
# siehe template_spec.py - Tobis Zeilen-für-Zeile-Erklärung der echten Vorlage).
EXCLUDED_FROM_ROTATION = {normalize_category(name) for name in template_spec.non_person_categories()}
EXCLUDED_FROM_ROTATION |= {
    normalize_category(name) for name in template_spec.relief_reward_categories()
}


def load_assignments(conn) -> pd.DataFrame:
    rows = conn.execute(
        """SELECT a.date, a.category, a.subcategory, a.person_id, p.name AS person, a.raw_text,
                  w.start_date, w.end_date
           FROM assignments a
           LEFT JOIN people p ON a.person_id = p.id
           JOIN week_plans w ON a.week_plan_id = w.id"""
    ).fetchall()
    df = pd.DataFrame([dict(r) for r in rows])
    if df.empty:
        return df
    df["category_norm"] = df["category"].apply(normalize_category)
    return df


def _mentions_person(text: str | None, person: str) -> bool:
    return bool(
        re.search(
            rf"(?<!\w){re.escape(person.casefold())}(?!\w)",
            (text or "").casefold(),
        )
    )


def previous_week_workload(conn, current_start: date | str) -> dict:
    """Ermittelt die Belastung der direkten Kalender-Vorwoche.

    Die Kennzahl ist absichtlich ein weiches Fairnessgewicht. Normale Dienste zählen
    einfach, Kochdienste und späte Abenddienste etwas stärker. Entlastungen sowie
    reine Infofelder zählen nicht als Arbeit.
    """
    start = (
        datetime.strptime(current_start, "%Y-%m-%d").date()
        if isinstance(current_start, str)
        else current_start
    )
    previous_start = start - timedelta(days=7)
    previous_end = start - timedelta(days=1)
    week = conn.execute(
        """SELECT *
           FROM week_plans
           WHERE start_date <= ? AND end_date >= ?
           ORDER BY
             CASE WHEN start_date = ? THEN 0 ELSE 1 END,
             id DESC
           LIMIT 1""",
        (
            previous_end.isoformat(),
            previous_start.isoformat(),
            previous_start.isoformat(),
        ),
    ).fetchone()
    if week is None:
        return {"week": None, "people": {}, "average": 0.0}

    active_people = [
        dict(person) for person in db.get_all_people(conn, active_only=True)
    ]
    names = [person["name"] for person in active_people]
    services: Counter[str] = Counter()
    weighted: Counter[str] = Counter()
    cooking: Counter[str] = Counter()
    late_duties: Counter[str] = Counter()

    rows = conn.execute(
        """SELECT a.category, a.subcategory, a.raw_text, p.name AS person
           FROM assignments a
           LEFT JOIN people p ON p.id = a.person_id
           WHERE a.week_plan_id = ?""",
        (week["id"],),
    ).fetchall()
    for row in rows:
        category = normalize_category(row["category"])

        # Der NITE CLUB ist ein Infofeld und enthält den DJ deshalb meist im Freitext.
        if "NITE CLUB" in category.upper():
            for name in names:
                if _mentions_person(row["raw_text"], name):
                    services[name] += 1
                    late_duties[name] += 1
                    weighted[name] += 2.5
            continue

        person = row["person"]
        if not person or category in EXCLUDED_FROM_ROTATION:
            continue

        weight = 1.0
        if category == "Kochdienste":
            cooking[person] += 1
            weight = 1.35
            if (row["subcategory"] or "").strip().upper().startswith("KP3"):
                weight = 1.5
        if category == "Moderation + Getränkedienst":
            late_duties[person] += 1
            weight = 1.65

        services[person] += 1
        weighted[person] += weight

    average = (
        sum(weighted[name] for name in names) / len(names)
        if names
        else 0.0
    )
    high_threshold = average + max(1.5, average * 0.25)
    people = {
        name: {
            "services": services[name],
            "weighted_load": round(weighted[name], 2),
            "overload": round(max(0.0, weighted[name] - average), 2),
            "cooking": cooking[name],
            "late_duties": late_duties[name],
            "high": weighted[name] >= high_threshold,
        }
        for name in names
    }
    kw = week["kw"] or date.fromisoformat(week["start_date"]).isocalendar()[1]
    return {
        "week": {
            "id": week["id"],
            "kw": kw,
            "start_date": week["start_date"],
            "end_date": week["end_date"],
            "label": f"KW{kw} · {util.fmt_date_range(week['start_date'], week['end_date'])}",
        },
        "people": people,
        "average": round(average, 2),
    }


def overview_stats(conn) -> dict:
    weeks = conn.execute("SELECT COUNT(*) c, MIN(start_date) s, MAX(end_date) e FROM week_plans").fetchone()
    people = conn.execute("SELECT COUNT(*) c FROM people WHERE deleted = 0").fetchone()
    assignments = conn.execute("SELECT COUNT(*) c FROM assignments WHERE person_id IS NOT NULL").fetchone()
    return {
        "n_weeks": weeks["c"],
        "date_range": (weeks["s"], weeks["e"]) if weeks["s"] else (None, None),
        "n_people": people["c"],
        "n_assignments": assignments["c"],
    }


def person_totals(conn) -> pd.DataFrame:
    df = load_assignments(conn)
    if df.empty:
        return pd.DataFrame(columns=["person", "total", "last_active"])
    df = df[df["person"].notna() & ~df["category_norm"].isin(EXCLUDED_FROM_ROTATION)]
    if df.empty:
        return pd.DataFrame(columns=["person", "total", "last_active"])
    grouped = df.groupby("person").agg(total=("date", "count"), last_active=("date", "max"))
    return grouped.reset_index().sort_values("total", ascending=False)


def person_category_matrix(conn) -> pd.DataFrame:
    df = load_assignments(conn)
    if df.empty:
        return pd.DataFrame()
    df = df[df["person"].notna() & ~df["category_norm"].isin(EXCLUDED_FROM_ROTATION)]
    if df.empty:
        return pd.DataFrame()
    pivot = pd.pivot_table(
        df, index="person", columns="category_norm", values="date", aggfunc="count", fill_value=0
    )
    pivot["Gesamt"] = pivot.sum(axis=1)
    pivot = pivot.sort_values("Gesamt", ascending=False)
    cols = [c for c in pivot.columns if c != "Gesamt"]
    cols_sorted = pivot[cols].sum(axis=0).sort_values(ascending=False).index.tolist()
    return pivot[cols_sorted + ["Gesamt"]]


def last_active_per_category(conn) -> pd.DataFrame:
    """Für jede Person+Kategorie: Datum der letzten Zuteilung. Basis für Rotations-Vorschläge."""
    df = load_assignments(conn)
    if df.empty:
        return pd.DataFrame(columns=["person", "category_norm", "last_date"])
    df = df[df["person"].notna() & ~df["category_norm"].isin(EXCLUDED_FROM_ROTATION)]
    if df.empty:
        return pd.DataFrame(columns=["person", "category_norm", "last_date"])
    return df.groupby(["person", "category_norm"]).agg(last_date=("date", "max")).reset_index()


def category_candidates(conn) -> dict[str, list[str]]:
    """Für jede Kategorie: alle Personen, die sie historisch schon einmal übernommen haben."""
    df = load_assignments(conn)
    if df.empty:
        return {}
    df = df[df["person"].notna() & ~df["category_norm"].isin(EXCLUDED_FROM_ROTATION)]
    result = {}
    for cat, group in df.groupby("category_norm"):
        result[cat] = sorted(group["person"].unique().tolist())
    return result


def department_activity(conn) -> pd.DataFrame:
    """Zuteilungen ohne Person (Abteilungs-Marker wie S&L/SPT/NM)."""
    df = load_assignments(conn)
    if df.empty:
        return pd.DataFrame(columns=["raw_text", "count"])
    df = df[df["person"].isna()]
    if df.empty:
        return pd.DataFrame(columns=["raw_text", "count"])
    return df.groupby("raw_text").size().reset_index(name="count").sort_values("count", ascending=False)


def fairness_alerts(conn, week_plan_id: int) -> list[dict]:
    """Prüft template_spec.FAIRNESS_RULES für eine bestimmte Woche (z.B. mind. 1x Barfrei/
    Ausschlafen, 2x Frei) und gibt Verstöße pro aktiver Person zurück. Personen, die diese
    Woche komplett im Urlaub/krank waren, werden übersprungen (Quote nicht sinnvoll prüfbar)."""
    active_people = {p["name"] for p in db.get_all_people(conn, active_only=True)}

    assignment_rows = conn.execute(
        """SELECT a.category, p.name AS person FROM assignments a
           JOIN people p ON a.person_id = p.id
           WHERE a.week_plan_id = ?""",
        (week_plan_id,),
    ).fetchall()
    absence_rows = conn.execute(
        """SELECT ab.typ, p.name AS person FROM absences ab
           JOIN people p ON ab.person_id = p.id
           WHERE ab.week_plan_id = ?""",
        (week_plan_id,),
    ).fetchall()

    # Nur Personen prüfen, die diese Woche überhaupt irgendwo im Plan vorkommen - sonst würden
    # global aktive Personen fälschlich geflaggt, die diese Woche z.B. noch gar nicht dabei waren.
    people_in_week = {r["person"] for r in assignment_rows} | {r["person"] for r in absence_rows}
    active_people &= people_in_week

    assign_count: dict[str, dict[str, int]] = {}
    for r in assignment_rows:
        assign_count.setdefault(r["person"], {})
        assign_count[r["person"]][r["category"]] = assign_count[r["person"]].get(r["category"], 0) + 1

    absence_count: dict[str, dict[str, int]] = {}
    fully_absent: set[str] = set()
    for r in absence_rows:
        absence_count.setdefault(r["person"], {})
        absence_count[r["person"]][r["typ"]] = absence_count[r["person"]].get(r["typ"], 0) + 1
        if r["typ"] != "Frei":
            fully_absent.add(r["person"])

    alerts = []
    for person in sorted(active_people - fully_absent):
        for rule in template_spec.FAIRNESS_RULES:
            if rule.get("is_absence"):
                count = absence_count.get(person, {}).get(rule["absence_type"], 0)
                if count < rule["min_per_week"]:
                    alerts.append({
                        "person": person, "rule": rule["id"],
                        "message": f"{person}: nur {count}x {rule['absence_type']} (Ziel: {rule['min_per_week']}x)",
                    })
            else:
                count = sum(assign_count.get(person, {}).get(cat, 0) for cat in rule["categories"])
                if count < rule["min_per_week"]:
                    cats = " oder ".join(rule["categories"])
                    alerts.append({
                        "person": person, "rule": rule["id"],
                        "message": f"{person}: weder {cats} diese Woche",
                    })
                elif rule.get("max_per_week") is not None and count > rule["max_per_week"]:
                    alerts.append({
                        "person": person, "rule": rule["id"],
                        "message": (
                            f"{person}: {count}x Barfrei/Ausschlafen "
                            f"(Ziel: genau {rule['max_per_week']}x)"
                        ),
                    })
    return alerts


def week_insights(conn, week_plan_id: int) -> dict:
    """Handlungsorientierte Kennzahlen für eine konkrete Planungswoche."""
    week = conn.execute(
        "SELECT * FROM week_plans WHERE id = ?", (week_plan_id,)
    ).fetchone()
    if week is None:
        raise ValueError("Dienstplan-Woche wurde nicht gefunden.")

    assignments = conn.execute(
        """SELECT a.date, a.category, a.subcategory, p.name AS person,
                  p.department
           FROM assignments a
           LEFT JOIN people p ON p.id = a.person_id
           WHERE a.week_plan_id = ?
           ORDER BY a.date, a.id""",
        (week_plan_id,),
    ).fetchall()
    absences = conn.execute(
        """SELECT ab.date, ab.typ, p.name AS person, p.department
           FROM absences ab
           JOIN people p ON p.id = ab.person_id
           WHERE ab.week_plan_id = ?
           ORDER BY ab.date, ab.id""",
        (week_plan_id,),
    ).fetchall()

    people: dict[str, dict] = {}

    def person_row(name: str, department: str | None) -> dict:
        return people.setdefault(name, {
            "person": name,
            "department": department,
            "services": 0,
            "cooking": 0,
            "sport": 0,
            "late_duties": 0,
            "relief": 0,
            "free_dates": set(),
            "absence_dates": set(),
        })

    for assignment_row in assignments:
        name = assignment_row["person"]
        if not name:
            continue
        item = person_row(name, assignment_row["department"])
        category = normalize_category(assignment_row["category"])
        if category in {
            normalize_category(name)
            for name in template_spec.relief_reward_categories()
        }:
            item["relief"] += 1
            continue
        if category in EXCLUDED_FROM_ROTATION:
            continue
        item["services"] += 1
        if category == "Kochdienste":
            item["cooking"] += 1
        if category == "Sportprogramm":
            item["sport"] += 1
        if category in {"Moderation + Getränkedienst", "NITE CLUB"}:
            item["late_duties"] += 1

    for absence_row in absences:
        item = person_row(absence_row["person"], absence_row["department"])
        if absence_row["typ"] == "Frei":
            item["free_dates"].add(absence_row["date"])
        else:
            item["absence_dates"].add(absence_row["date"])

    service_values = [item["services"] for item in people.values()]
    average_services = (
        sum(service_values) / len(service_values) if service_values else 0
    )
    workload = []
    for item in people.values():
        services = item["services"]
        if item["absence_dates"]:
            status = "balanced"
        elif services >= average_services + 2:
            status = "high"
        elif services <= max(average_services - 2, 0):
            status = "low"
        else:
            status = "balanced"
        workload.append({
            **{key: value for key, value in item.items()
               if key not in {"free_dates", "absence_dates"}},
            "free_days": len(item["free_dates"]),
            "absence_days": len(item["absence_dates"]),
            "status": status,
        })
    workload.sort(key=lambda item: (-item["services"], item["person"].casefold()))

    active_people = [dict(row) for row in db.get_all_people(conn, active_only=True)]
    department_summary: dict[str, dict] = {}
    scheduled_by_department: dict[str, set[str]] = defaultdict(set)
    services_by_department: dict[str, int] = defaultdict(int)
    for person in active_people:
        department = (person.get("department") or "Ohne Abteilung").strip()
        department_summary.setdefault(department, {
            "department": department,
            "active_people": 0,
            "scheduled_people": 0,
            "services": 0,
        })
        department_summary[department]["active_people"] += 1
    for item in workload:
        department = (item.get("department") or "Ohne Abteilung").strip()
        scheduled_by_department[department].add(item["person"])
        services_by_department[department] += item["services"]
        department_summary.setdefault(department, {
            "department": department,
            "active_people": 0,
            "scheduled_people": 0,
            "services": 0,
        })
    for department, item in department_summary.items():
        item["scheduled_people"] = len(scheduled_by_department[department])
        item["services"] = services_by_department[department]
    departments = sorted(
        department_summary.values(),
        key=lambda item: (-item["services"], item["department"].casefold()),
    )

    selected_start = week["start_date"]
    selected_end = week["end_date"]
    planning_periods = [
        dict(row)
        for row in conn.execute(
            """SELECT start_date, end_date FROM artist_plans
               UNION
               SELECT start_date, end_date FROM rehearsal_plans
               ORDER BY start_date"""
        ).fetchall()
    ]
    today_iso = date.today().isoformat()
    if planning_periods:
        current = [
            period for period in planning_periods
            if period["start_date"] <= today_iso <= period["end_date"]
        ]
        upcoming = [
            period for period in planning_periods
            if period["start_date"] > today_iso
        ]
        if current:
            planning_period = max(current, key=lambda item: item["start_date"])
        elif upcoming:
            planning_period = min(upcoming, key=lambda item: item["start_date"])
        else:
            planning_period = max(
                planning_periods, key=lambda item: item["start_date"]
            )
        planning_start = planning_period["start_date"]
        planning_end = planning_period["end_date"]
    else:
        planning_start = selected_start
        planning_end = selected_end

    artist = db.get_artist_plan_by_start(conn, planning_start)
    rehearsal = db.get_rehearsal_plan_by_start(conn, planning_start)
    planning_duty_week = conn.execute(
        """SELECT id FROM week_plans
           WHERE start_date = ?
           ORDER BY imported_at DESC, id DESC
           LIMIT 1""",
        (planning_start,),
    ).fetchone()
    planning_assignment_count = 0
    if planning_duty_week is not None:
        planning_assignment_count = conn.execute(
            """SELECT COUNT(*) AS count
               FROM assignments
               WHERE week_plan_id = ? AND person_id IS NOT NULL""",
            (planning_duty_week["id"],),
        ).fetchone()["count"]
    rehearsal_events = [
        dict(row)
        for row in db.get_rehearsal_events(
            conn, planning_start, planning_end
        )
    ]
    show_dates = rehearsal_plan.detect_show_dates(rehearsal_events)
    events_by_date: dict[str, list[dict]] = defaultdict(list)
    for event in rehearsal_events:
        events_by_date[event["date"]].append(event)
    show_days = []
    for show_date in sorted(show_dates):
        events = events_by_date[show_date]
        shows = []
        for event in events:
            if not rehearsal_plan.is_show_event(event):
                continue
            activity = event["activity"]
            if activity not in shows:
                shows.append(activity)
        show_days.append({
            "date": show_date,
            "shows": shows,
            "rehearsal_count": len(events),
        })

    label = (
        f"KW{week['kw'] or date.fromisoformat(selected_start).isocalendar()[1]} · "
        f"{util.fmt_date_range(selected_start, selected_end)}"
    )
    return {
        "week": {
            "id": week["id"],
            "label": label,
            "start_date": selected_start,
            "end_date": selected_end,
        },
        "planning_week": {
            "start_date": planning_start,
            "end_date": planning_end,
            "label": (
                f"KW{date.fromisoformat(planning_start).isocalendar()[1]} · "
                f"{util.fmt_date_range(planning_start, planning_end)}"
            ),
        },
        "readiness": {
            "artist_plan": artist is not None,
            "rehearsal_plan": rehearsal is not None,
            "duty_plan": planning_duty_week is not None,
            "rehearsal_count": len(rehearsal_events),
            "assignment_count": planning_assignment_count,
        },
        "show_days": show_days,
        "workload": workload,
        "departments": departments,
        "rules": planning_rules.active_planning_rules(),
    }
