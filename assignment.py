"""Vorschlags-Generator für neue Wochenpläne (Phase 3)."""
from __future__ import annotations

import re
from collections import Counter
from datetime import date, datetime, timedelta

import db
import grid
import memory
import planning_rules
import rehearsal_plan
import stats


def _parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def _next_day(date_iso: str, week_dates: set[str]) -> str | None:
    next_date = (_parse_date(date_iso) + timedelta(days=1)).isoformat()
    return next_date if next_date in week_dates else None


def _text_mentions_person(text: str, person: str) -> bool:
    """Erkennt aktive MA auch in Freitexten wie 'DJ Patryk'."""
    return bool(
        re.search(
            rf"(?<!\w){re.escape(person.casefold())}(?!\w)",
            (text or "").casefold(),
        )
    )


def add_relief_rewards(
    draft: list[dict],
    active_people: list[dict],
    week_dates_iso: list[str],
    absent_by_date: dict[str, set[str]],
    show_dates: set[str] | None = None,
) -> list[dict]:
    """Vergibt genau eine gemeinsame Entlastung (Ausschlafen ODER Barfrei) pro MA.

    Ausschlafen wird nach späten Einsätzen bevorzugt. Barfrei honoriert vor allem viele
    Kochdienste bzw. eine hohe Wochen-/Tagesbelastung. Mehrere Namen dürfen in derselben
    Tageszelle stehen; das Grid fasst die einzelnen Datensätze automatisch zusammen.
    """
    week_dates = set(week_dates_iso)
    show_dates = show_dates or set()
    people = [p["name"] for p in active_people]
    department_by_person = {
        p["name"]: p.get("department") for p in active_people
    }
    work_load = Counter()
    cook_load = Counter()
    day_load: Counter[tuple[str, str]] = Counter()
    late_relief_days: dict[str, set[str]] = {name: set() for name in people}

    for row in draft:
        category = (row.get("category") or "").strip()
        person = (row.get("person") or "").strip()
        date_iso = row.get("date")
        if planning_rules.is_relief_reward(category):
            continue

        if person:
            work_load[person] += 1
            day_load[(person, date_iso)] += 1
            if category == "Kochdienste":
                cook_load[person] += 1
            if category == "Moderation + Getränkedienst":
                relief_day = _next_day(date_iso, week_dates)
                if relief_day:
                    late_relief_days.setdefault(person, set()).add(relief_day)

        if category == "NITE CLUB":
            relief_day = _next_day(date_iso, week_dates)
            if relief_day:
                raw_text = row.get("raw_text") or ""
                for name in people:
                    if _text_mentions_person(raw_text, name):
                        late_relief_days.setdefault(name, set()).add(relief_day)

    occupancy: Counter[tuple[str, str]] = Counter()
    rewards: list[dict] = []

    # Zuerst die Personen mit dem stärksten Entlastungsbedarf einplanen.
    ordered_people = sorted(
        people,
        key=lambda name: (
            bool(late_relief_days.get(name)),
            cook_load[name],
            work_load[name],
            name.casefold(),
        ),
        reverse=True,
    )

    for index, name in enumerate(ordered_people):
        available_dates = [
            day for day in week_dates_iso
            if name not in absent_by_date.get(day, set())
            and not (
                "DEKO" in planning_rules.department_tags(
                    department_by_person.get(name)
                )
                and day in show_dates
            )
        ]
        if not available_dates:
            continue

        late_days = [
            day for day in available_dates
            if day in late_relief_days.get(name, set())
        ]
        if late_days:
            category = "Ausschlafen"
            reward_date = min(
                late_days,
                key=lambda day: (
                    occupancy[(category, day)],
                    -day_load[(name, day)],
                    day,
                ),
            )
            reason = "Entlastung nach spätem Abenddienst"
        else:
            # Viele Kochdienste führen bevorzugt zu Barfrei. Bei allen anderen wird die
            # weniger belegte Entlastungszeile genutzt, damit beide Zeilen sinnvoll bleiben.
            if cook_load[name] > 0:
                category = "Barfrei"
            else:
                barfrei_count = sum(
                    occupancy[("Barfrei", day)] for day in week_dates_iso
                )
                ausschlafen_count = sum(
                    occupancy[("Ausschlafen", day)] for day in week_dates_iso
                )
                category = (
                    "Ausschlafen"
                    if ausschlafen_count < barfrei_count and index % 2 == 0
                    else "Barfrei"
                )
            reward_date = min(
                available_dates,
                key=lambda day: (
                    -day_load[(name, day)],
                    occupancy[(category, day)],
                    day,
                ),
            )
            reason = (
                "Entlastung nach mehreren Kochdiensten"
                if cook_load[name] > 1
                else "Entlastung nach Wochenbelastung"
            )

        occupancy[(category, reward_date)] += 1
        rewards.append({
            "date": reward_date,
            "category": category,
            "subcategory": None,
            "person": name,
            "raw_text": reason,
        })

    without_old_rewards = [
        row for row in draft
        if not planning_rules.is_relief_reward(row.get("category") or "")
    ]
    return [*without_old_rewards, *rewards]


def generate_week_draft(
    conn,
    template_week_id: int,
    new_start: date,
    absent_by_date: dict[str, set[str]],
    *,
    template_code: str | None = None,
) -> tuple[list[dict], set[str]]:
    """Erzeugt einen Zuteilungs-Vorschlag für eine neue Woche, basierend auf einer
    Vorlagen-Woche (Struktur: welche Kategorien/Subkategorien an welchem Wochentag)
    und der historischen Rotations-Fairness (wer war zuletzt dran, wer ist verfügbar)."""
    template_rows = [dict(row) for row in db.get_assignments_for_week(conn, template_week_id)]
    template_week = next(w for w in db.get_week_plans(conn) if w["id"] == template_week_id)
    template_start = _parse_date(template_week["start_date"])

    last_active = stats.last_active_per_category(conn)
    # Arbeitskopie: wird während der Generierung laufend aktualisiert, damit eine Person
    # nicht für mehrere Slots derselben Kategorie in dieser Woche vorgeschlagen wird.
    last_active_lookup = {
        (row["person"], row["category_norm"]): row["last_date"] for _, row in last_active.iterrows()
    }
    active_people_rows = [dict(p) for p in db.get_all_people(conn, active_only=True)]
    active_people = {p["name"] for p in active_people_rows}
    department_by_person = {p["name"]: p.get("department") for p in active_people_rows}
    previous_workload = stats.previous_week_workload(conn, new_start)["people"]
    week_end = new_start + timedelta(days=6)
    show_dates = rehearsal_plan.detect_show_dates(
        [
            dict(row)
            for row in db.get_rehearsal_events(
                conn, new_start.isoformat(), week_end.isoformat()
            )
        ]
    )
    # Wer laut MA-Gedächtnis an dem Abend in der Show/Party steht. Weiche Regel:
    # sperrt niemanden, verschlechtert nur die Reihenfolge bei Abenddiensten.
    on_stage = memory.on_stage_by_date(
        conn, new_start.isoformat(), week_end.isoformat(), template_code
    )
    rehearsal_by_person_day: dict[tuple[str, str], list[tuple[int, int]]] = {}
    for rehearsal in db.get_rehearsal_intervals(
        conn, new_start.isoformat(), week_end.isoformat()
    ):
        if not rehearsal["person_name"]:
            continue
        rehearsal_by_person_day.setdefault(
            (rehearsal["person_name"], rehearsal["date"]), []
        ).append(
            planning_rules.rehearsal_interval(
                rehearsal["start_time"], rehearsal["end_time"]
            )
        )
    candidates_by_category = {
        cat: [p for p in people if p in active_people]
        for cat, people in stats.category_candidates(conn).items()
    }
    # Echte Zeitkonflikte werden blockiert; nicht zeitgleiche Dienste bleiben möglich.
    busy_by_day_time: dict[tuple[str, str], set[str]] = {}
    weekly_load: dict[str, int] = {name: 0 for name in active_people}
    weekly_category_load: dict[tuple[str, str], int] = {}

    # Historische Excel-Zellen können mehrere Personen enthalten. Beim normalen
    # Sportprogramm ist das kein Soll für die neue Woche: dort wird genau ein MA
    # vorgeschlagen. Nur "Gäste vs. Robins BVB" am Freitag braucht vier verschiedene MA.
    prepared_template_rows: list[dict] = []
    sport_groups: dict[tuple[str, str], list[dict]] = {}
    for row in template_rows:
        norm_cat = stats.normalize_category(row["category"])
        if norm_cat != "Sportprogramm":
            prepared_template_rows.append(row)
            continue
        slot = grid.slot_key_for_category(norm_cat, row.get("subcategory") or "")
        sport_groups.setdefault((row["date"], slot), []).append(row)

    for (_, slot), rows_for_slot in sport_groups.items():
        representative = dict(rows_for_slot[0])
        offset = (_parse_date(representative["date"]) - template_start).days
        target_date = (new_start + timedelta(days=offset)).isoformat()
        special_bvb = planning_rules.is_guests_vs_robins_bvb(
            "Sportprogramm", slot, target_date
        )
        if special_bvb:
            representative["subcategory"] = "15:30 Gäste vs Robins BVB"
        elif "Softsport" not in slot:
            # Historische Sondertexte (z. B. Gäste vs. Robins an einem anderen
            # Wochentag) dürfen nicht in einen normalen BVB-Slot weiterwandern.
            representative["subcategory"] = slot
        required = 4 if special_bvb else 1
        prepared_template_rows.extend(dict(representative) for _ in range(required))

    draft = []
    for row in prepared_template_rows:
        offset = (_parse_date(row["date"]) - template_start).days
        new_date = new_start + timedelta(days=offset)
        new_date_str = new_date.isoformat()
        norm_cat = stats.normalize_category(row["category"])

        # Barfrei/Ausschlafen sind keine Dienste. Sie werden erst nach allen echten
        # Zuweisungen belastungsabhängig als gemeinsame Wochen-Entlastung vergeben.
        if planning_rules.is_relief_reward(norm_cat):
            continue

        absent_today = absent_by_date.get(new_date_str, set())
        time_key = planning_rules.time_key(norm_cat, row["subcategory"])
        service_slot = planning_rules.service_interval(norm_cat, row["subcategory"])
        busy_key = (new_date_str, time_key)
        busy_today = busy_by_day_time.get(busy_key, set())
        base_candidates = (
            list(active_people)
            if planning_rules.use_all_active_for_auto(norm_cat, row["subcategory"])
            else candidates_by_category.get(norm_cat, [])
        )
        if norm_cat == "Kochdienste" and new_date_str in show_dates:
            base_candidates = list(dict.fromkeys([
                *base_candidates,
                *[
                    person
                    for person in active_people
                    if "DEKO" in planning_rules.department_tags(
                        department_by_person.get(person)
                    )
                ],
            ]))
        candidates = [
            p for p in base_candidates
            if p not in absent_today
            and p not in busy_today
            and planning_rules.person_decision(
                p,
                department_by_person.get(p),
                norm_cat,
                row["subcategory"],
                automatic=True,
            )["allowed"]
            and all(
                planning_rules.rehearsal_conflict_level(service_slot, rehearsal) < 3
                for rehearsal in rehearsal_by_person_day.get((p, new_date_str), [])
            )
        ]

        def stage_penalty(person: str) -> int:
            """1, wenn die Person an diesem Abend auf der Bühne steht. Nur Abenddienste."""
            if (
                service_slot is None
                or service_slot[0] < planning_rules.EVENING_CUTOFF_MINUTES
            ):
                return 0
            return 1 if person in on_stage.get(new_date_str, []) else 0

        def rehearsal_load(person: str) -> int:
            return max(
                (
                    planning_rules.rehearsal_conflict_level(service_slot, rehearsal)
                    for rehearsal in rehearsal_by_person_day.get(
                        (person, new_date_str), []
                    )
                ),
                default=0,
            )

        def fairness_load(person: str) -> float:
            previous = previous_workload.get(person, {})
            return (
                weekly_category_load.get((person, norm_cat), 0) * 90
                + weekly_load.get(person, 0) * 24
                + float(previous.get("overload", 0)) * 20
                + float(previous.get("weighted_load", 0)) * 3
            )

        candidates.sort(
            key=lambda p: (
                not planning_rules.person_decision(
                    p,
                    department_by_person.get(p),
                    norm_cat,
                    row["subcategory"],
                    automatic=True,
                )["recommended"],
                rehearsal_load(p),
                stage_penalty(p),
                fairness_load(p),
                last_active_lookup.get((p, norm_cat)) or "0000-00-00",
                p.casefold(),
            )
        )
        suggested = candidates[0] if candidates else None

        if suggested:
            last_active_lookup[(suggested, norm_cat)] = new_date_str
            busy_by_day_time.setdefault(busy_key, set()).add(suggested)
            weekly_load[suggested] = weekly_load.get(suggested, 0) + 1
            weekly_category_load[(suggested, norm_cat)] = (
                weekly_category_load.get((suggested, norm_cat), 0) + 1
            )

        draft.append({
            "date": new_date_str,
            "category": norm_cat,
            "subcategory": row["subcategory"],
            "person": suggested,
            "raw_text": f"Vorlage ({row['date']}): {row['person'] or row['raw_text'] or '-'}",
        })

    return draft, show_dates
