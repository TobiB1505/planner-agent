"""MA-Gedächtnis: was die Planung über jeden Mitarbeiter aus der Historie gelernt hat.

Drei Facetten, alle bei jedem Lesen frisch abgeleitet (nichts Abgeleitetes wird persistiert):
  - Show-Besetzung: in welchen Shows/Partys steht der MA (aus Probenplänen)
  - Frei-Muster:    an welchen Wochentagen hat der MA meistens frei (aus Abwesenheiten)
  - Aufgaben-Profil: welche Dienste übernimmt der MA oft/selten (aus Zuteilungen)

Tobis Korrekturen liegen getrennt davon in `person_memory_overrides` und werden erst beim
Zusammenführen angewandt (siehe `_merge`). Dadurch ist das Neu-Aufbauen der Probenplan-Tabellen
durch `db.upsert_rehearsal_plan` für das Gedächtnis folgenlos.

Wochentage folgen durchgehend der Python-Konvention 0 = Montag (wie `date.weekday()` und
`grid.WEEKDAY_NAMES_DE`). SQLites `strftime('%w')` ist 0 = Sonntag und wird hier bewusst nicht
verwendet.
"""
from __future__ import annotations

import json
import logging
import math
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from . import db
from . import grid
from . import plan_templates
from . import rehearsal_plan
from . import stats
from . import template_spec
from . import xlsx_template

logger = logging.getLogger(__name__)

# AP5b: Rückgabetyp von build_memory() - {"people": list[dict], "unmatched_rehearsal_names":
# list[dict], "meta": dict}. "people" ist bewusst eine nach (nicht aktiv, Name) sortierte LISTE,
# nicht nach person_id indiziert - memory_for_person() durchsucht sie linear. Kein TypedDict/keine
# Restrukturierung, um das bestehende Memory-Datenmodell nicht zu verändern (außerhalb des
# AP5b-Scopes). Rein lesend verwendet - keiner der untersuchten Aufrufer mutiert die Struktur.
MemoryData = dict[str, Any]

# --- Shows -------------------------------------------------------------------

# Show-Identität hängt am `show_code`, nicht am `activity`-Text: die Vorlage zersplittert
# eine Show in viele Strings ("New York, Opening" / "New York, Durchlauf" / "New York, Show"),
# der Code bleibt stabil. `activity` dient nur als Fallback bei leerem Code.
SHOWS: dict[str, dict] = {
    "MR": {"label": "Moulin Rouge", "kind": "show",
           "names": ["welcome to the moulin rouge", "moulin rouge"]},
    "NY": {"label": "New York", "kind": "show",
           "names": ["taste of new york", "new york"]},
    "ROR": {"label": "Royals of Rock", "kind": "show", "names": ["royals of rock"]},
    "TGS": {"label": "The Greatest Show", "kind": "show",
            "names": ["the greatest show", "greatest show"]},
    "WI": {"label": "What If", "kind": "show", "names": ["what if"]},
    "VE": {"label": "Viva Espana", "kind": "show",
           "names": ["viva espana", "viva españa"]},
    "FYS": {"label": "Paradise on Fire", "kind": "party",
            "names": ["paradise on fire", "fire your soul"]},
    "BN": {"label": "Black Night", "kind": "party", "names": ["black night"]},
    "WW": {"label": "Weiß-Weiß", "kind": "party",
           "names": ["weiss-weiss", "weiss weiss", "white night"]},
    "TCM": {"label": "TC Meeting", "kind": "other", "names": ["tc meeting"]},
}

# Partys zählen als Bühneneinsatz: wer bei Black Night oder Paradise on Fire auf der Bühne
# steht, kann genauso wenig um 19:00 kochen wie bei einer "echten" Show. `rehearsal_plan.
# is_show_event` schließt Partys aus, beantwortet aber die andere Frage (Showtag für Deko).
CAST_KINDS = {"show", "party"}

# Ab wie vielen Probentagen ein Show-Eintrag als Planungssignal zählt. Einzelne Probentage
# (Fanny 1x ROR) sind eher Aushilfe als Besetzung und werden zwar angezeigt, wirken aber nicht.
MIN_APPEARANCES_FOR_SIGNAL = 2

# --- Frei-Muster -------------------------------------------------------------

MIN_FREI_DAYS = 6          # darunter ist kein Muster erkennbar
MIN_WEEKDAY_SHARE = 0.21   # ~1,5x Gleichverteilung (1/7)
MAX_TYPICAL_DAYS = 3

# --- Aufgaben-Profil ---------------------------------------------------------

MIN_TEAM_COUNT_FOR_AFFINITY = 8
MIN_PERSON_COUNT_FOR_AFFINITY = 2


def _clean_show_code(raw: object) -> str:
    """Die DB enthält neben leeren Codes wörtlich den Wert `""` (zwei Anführungszeichen)."""
    return str(raw or "").strip().strip('"').strip("'").strip().upper()


def show_identity(show_code: object, activity: object = "") -> dict | None:
    """-> {"key", "label", "kind"} oder None, wenn kein Show-Bezug erkennbar ist."""
    code = _clean_show_code(show_code)
    if code in SHOWS:
        return {"key": code, **{k: SHOWS[code][k] for k in ("label", "kind")}}
    return match_show_text(activity)


def match_show_text(text: object) -> dict | None:
    """Erkennt eine Show am Klartext, z.B. aus dem Künstlerplan ("Show: Moulin Rouge").

    Das "Show: "-Präfix ist bewusst kein Kriterium - "Black Night" steht ohne Präfix im
    Künstlerplan, hat aber eine echte Besetzung.
    """
    normalized = rehearsal_plan._norm(str(text or ""))
    if not normalized:
        return None
    normalized = normalized.replace("show:", " ").strip()
    if not normalized:
        return None
    best: tuple[int, str] | None = None
    for key, spec in SHOWS.items():
        for name in spec["names"]:
            if name in normalized and (best is None or len(name) > best[0]):
                best = (len(name), key)
    if best is None:
        return None
    key = best[1]
    return {"key": key, **{k: SHOWS[key][k] for k in ("label", "kind")}}


def _resolve_person_id(
    conn,
    stored_name: object,
    raw_name: object,
    person_lookup: db.PersonLookup | None = None,
) -> int | None:
    """Namen aus dem Probenplan auf eine person_id abbilden.

    Beide Wege sind nötig (Phase-0-Baseline): das gespeicherte `person_name` fängt den beim
    Import per difflib gematchten "Killian" -> Kilian, der Alias-Fallback fängt Sarah/Krissi
    (soft-gelöscht) sowie Tim und "Celina" -> Selina (echte Alias-Zeile).

    AP5a: nutzt bei Bedarf eine vorab geladene PersonLookup statt pro Aufruf eigene
    SQL-Queries auszuführen - Auflösungsreihenfolge und Ergebnis bleiben identisch
    zu find_person_by_alias() (siehe db.PersonLookup.resolve()).
    """
    for candidate in (stored_name, raw_name):
        if not candidate:
            continue
        if person_lookup is not None:
            entry = person_lookup.resolve(str(candidate))
            person_id = entry.person_id if entry else None
        else:
            person_id = db.find_person_by_alias(conn, str(candidate))
        if person_id is not None:
            return person_id
    return None


def derive_show_cast(
    conn,
    person_lookup: db.PersonLookup | None = None,
) -> tuple[dict[int, dict[str, dict]], list[dict]]:
    """-> ({person_id: {show_key: {...}}}, unmatched_names).

    `appearances` zählt DISTINCT Probentage, nicht Probenzeilen - an einem Tag finden oft
    Durchlauf und Show als getrennte Zeilen statt.

    AP5a: löst Personen über eine einmalig geladene PersonLookup auf, statt pro
    rehearsal_people-Zeile eigene Alias-/Namensqueries auszuführen. Wird keine
    `person_lookup` übergeben, wird intern genau einmal eine geladen - bestehende
    Aufrufer (z.B. build_memory) funktionieren unverändert ohne den neuen Parameter.
    """
    lookup = person_lookup if person_lookup is not None else db.load_person_lookup(conn)
    rows = conn.execute(
        """SELECT rp.raw_name, rp.person_name, rp.role,
                  r.date, r.show_code, r.activity, r.rehearsal_plan_id
           FROM rehearsal_people rp
           JOIN rehearsals r ON r.id = rp.rehearsal_id"""
    ).fetchall()

    cast: dict[int, dict[str, dict]] = defaultdict(dict)
    unmatched: dict[str, int] = defaultdict(int)
    for row in rows:
        person_id = _resolve_person_id(conn, row["person_name"], row["raw_name"], lookup)
        if person_id is None:
            unmatched[str(row["raw_name"] or "").strip() or "?"] += 1
            continue
        show = show_identity(row["show_code"], row["activity"])
        if show is None or show["kind"] not in CAST_KINDS:
            continue
        entry = cast[person_id].setdefault(
            show["key"],
            {"show_key": show["key"], "label": show["label"], "kind": show["kind"],
             "_dates": set(), "_plans": set(), "roles": set()},
        )
        entry["_dates"].add(row["date"])
        entry["_plans"].add(row["rehearsal_plan_id"])
        if row["role"]:
            entry["roles"].add(row["role"])

    for entries in cast.values():
        for entry in entries.values():
            dates = entry.pop("_dates")
            plans = entry.pop("_plans")
            entry["appearances"] = len(dates)
            entry["weeks"] = len(plans)
            entry["last_date"] = max(dates)
            entry["roles"] = sorted(entry["roles"])
            entry["confidence"] = _show_confidence(entry["appearances"], entry["weeks"])

    unmatched_list = [
        {"raw_name": name, "count": count}
        for name, count in sorted(unmatched.items(), key=lambda kv: (-kv[1], kv[0]))
    ]
    return cast, unmatched_list


def _show_confidence(appearances: int, weeks: int) -> str:
    if appearances >= 3 and weeks >= 2:
        return "hoch"
    if appearances >= MIN_APPEARANCES_FOR_SIGNAL:
        return "mittel"
    return "niedrig"


def derive_free_pattern(conn) -> dict[int, dict]:
    """Typische Frei-Wochentage je Person (Python-Konvention 0 = Montag)."""
    rows = conn.execute(
        "SELECT person_id, date FROM absences WHERE typ = 'Frei' AND person_id IS NOT NULL"
    ).fetchall()

    counts: dict[int, list[int]] = defaultdict(lambda: [0] * 7)
    weeks: dict[int, set[str]] = defaultdict(set)
    for row in rows:
        try:
            day = date.fromisoformat(row["date"])
        except (TypeError, ValueError):
            continue
        counts[row["person_id"]][day.weekday()] += 1
        weeks[row["person_id"]].add(f"{day.isocalendar()[0]}-{day.isocalendar()[1]}")

    result: dict[int, dict] = {}
    for person_id, buckets in counts.items():
        total = sum(buckets)
        distribution = [
            {"weekday": index, "label": grid.WEEKDAY_NAMES_DE[index],
             "count": buckets[index], "share": (buckets[index] / total) if total else 0.0}
            for index in range(7)
        ]
        if total < MIN_FREI_DAYS:
            pattern, weekdays = "insufficient", []
        else:
            threshold = max(2, math.ceil(0.25 * total))
            qualified = [
                index for index in range(7)
                if buckets[index] >= threshold and buckets[index] / total >= MIN_WEEKDAY_SHARE
            ]
            qualified.sort(key=lambda index: (-buckets[index], index))
            weekdays = qualified[:MAX_TYPICAL_DAYS]
            pattern = "flat" if not weekdays else ("weak" if len(weekdays) == 1 else "clear")
        result[person_id] = {
            "total_free_days": total,
            "weeks_observed": len(weeks[person_id]),
            "distribution": distribution,
            "derived_weekdays": weekdays,
            "pattern": pattern,
        }
    return result


def _derive_task_profile(
    df, person_ids_by_name: dict[str, int]
) -> tuple[dict[int, dict], list[str]]:
    """-> ({person_id: Profil}, alle je vorgekommenen Kategorien).

    Ersetzt bewusst `stats.person_category_matrix` + `stats.last_active_per_category`, damit
    `build_memory` mit einem einzigen `load_assignments`-Scan auskommt. Filter identisch zu
    `stats`, damit die Zahlen zum Dashboard passen. Die Kategorieliste wird mit zurückgegeben,
    damit auch Personen ganz ohne Historie ein vollständiges `never_done` bekommen.
    """
    empty: dict[int, dict] = {}
    if df is None or df.empty:
        return empty, []
    frame = df[df["person"].notna() & ~df["category_norm"].isin(stats.EXCLUDED_FROM_ROTATION)]
    if frame.empty:
        return empty, []

    grouped = (
        frame.groupby(["person", "category_norm"])
        .agg(count=("date", "size"), last_date=("date", "max"))
        .reset_index()
    )
    team_counts = grouped.groupby("category_norm")["count"].sum().to_dict()
    team_people = grouped.groupby("category_norm")["person"].nunique().to_dict()
    person_totals = grouped.groupby("person")["count"].sum().to_dict()
    all_categories = sorted(team_counts)

    result: dict[int, dict] = {}
    for person, group in grouped.groupby("person"):
        person_id = person_ids_by_name.get(person)
        if person_id is None:
            continue
        total = int(person_totals.get(person, 0))
        categories = []
        for _, row in group.sort_values("count", ascending=False).iterrows():
            category = row["category_norm"]
            count = int(row["count"])
            team_count = int(team_counts.get(category, 0))
            categories.append({
                "category": category,
                "count": count,
                "share": count / total if total else 0.0,
                "team_share": count / team_count if team_count else 0.0,
                "last_date": row["last_date"],
                "affinity": _affinity(count, team_count, int(team_people.get(category, 1))),
            })
        done = {item["category"] for item in categories}
        result[person_id] = {
            "total": total,
            "categories": categories,
            "never_done": [c for c in all_categories if c not in done],
        }
    return result, all_categories


def _affinity(count: int, team_count: int, people_in_category: int) -> float:
    """Wie stark weicht der Anteil dieser Person vom fairen Durchschnitt ab? -> [-1, +1].

    Bewusst konservativ: bei dünner Datenlage gar kein Signal, damit ein einzelner
    historischer Einsatz die Fairness-Rotation nicht verzerrt.
    """
    if team_count < MIN_TEAM_COUNT_FOR_AFFINITY or count < MIN_PERSON_COUNT_FOR_AFFINITY:
        return 0.0
    fair = team_count / max(1, people_in_category)
    if fair <= 0:
        return 0.0
    return max(-1.0, min(1.0, (count - fair) / (2 * fair)))


def _override_map(rows) -> dict[tuple[int, str, str], dict]:
    return {(r["person_id"], r["facet"], r["item_key"]): dict(r) for r in rows}


def _merge_shows(person_id, derived: dict[str, dict], overrides) -> tuple[list[dict], list[dict]]:
    """abgeleitet ∪ ergänzt − entfernt. `removed` bleibt klebrig, damit eine wachsende
    Ableitung nichts still wiederbelebt - der Eintrag taucht stattdessen mit aktuellem
    Zählerstand in `removed_shows` auf."""
    active: list[dict] = []
    removed: list[dict] = []
    keys = set(derived) | {
        key for (pid, facet, key) in overrides if pid == person_id and facet == "show"
    }
    for key in sorted(keys):
        spec = SHOWS.get(key, {"label": key, "kind": "show"})
        base = derived.get(key)
        entry = dict(base) if base else {
            "show_key": key, "label": spec["label"], "kind": spec["kind"],
            "appearances": 0, "weeks": 0, "last_date": None, "roles": [],
            "confidence": "niedrig",
        }
        override = overrides.get((person_id, "show", key))
        state = override["state"] if override else None
        entry["overridden"] = state is not None
        if state == "removed":
            entry["source"] = "entfernt"
            removed.append(entry)
            continue
        if state == "confirmed":
            entry["source"] = "bestätigt"
            entry["confidence"] = "bestätigt"
        elif state == "added":
            entry["source"] = "ergänzt" if base is None else "bestätigt"
            entry["confidence"] = "bestätigt"
        else:
            entry["source"] = "abgeleitet"
        # Nur belastbare oder bestätigte Einträge wirken in der Planung.
        entry["counts_for_planning"] = (
            entry["confidence"] == "bestätigt"
            or entry["appearances"] >= MIN_APPEARANCES_FOR_SIGNAL
        )
        active.append(entry)
    active.sort(key=lambda e: (-e["appearances"], e["label"]))
    return active, removed


def _merge_free(person_id, derived: dict | None, overrides) -> dict:
    base = derived or {
        "total_free_days": 0, "weeks_observed": 0, "derived_weekdays": [],
        "pattern": "insufficient",
        "distribution": [
            {"weekday": i, "label": grid.WEEKDAY_NAMES_DE[i], "count": 0, "share": 0.0}
            for i in range(7)
        ],
    }
    result = dict(base)
    override = overrides.get((person_id, "free", "weekdays"))
    if override and override["state"] == "pinned":
        try:
            pinned = json.loads(override["value"] or "{}").get("weekdays", [])
        except (TypeError, ValueError):
            pinned = []
        # Eine leere Liste ist ein gültiger Pin ("kein festes Muster") und muss von
        # "kein Override vorhanden" unterscheidbar bleiben - daher eigene Pin-Zeile.
        result["weekdays"] = [int(day) for day in pinned if 0 <= int(day) <= 6]
        result["source"] = "manuell"
    else:
        result["weekdays"] = list(base["derived_weekdays"])
        result["source"] = "abgeleitet"
    return result


def _merge_tasks(person_id, derived: dict | None, overrides, all_categories: list[str]) -> dict:
    # Ohne jede Historie (Kaltstart, z.B. Dylana) sind alle Kategorien "noch nie gemacht" -
    # genau diese Liste ist der einzige Hebel, so jemanden überhaupt einplanbar zu machen.
    base = derived or {"total": 0, "categories": [], "never_done": list(all_categories)}
    categories = [dict(item) for item in base["categories"]]
    by_category = {item["category"]: item for item in categories}
    for item in categories:
        item["state"] = "derived"
        item["level"] = None
    added: list[dict] = []
    for (pid, facet, key), override in overrides.items():
        if pid != person_id or facet != "task":
            continue
        try:
            level = json.loads(override["value"] or "{}").get("level")
        except (TypeError, ValueError):
            level = None
        if key in by_category:
            by_category[key]["state"] = override["state"]
            by_category[key]["level"] = level
        elif override["state"] == "added":
            added.append({
                "category": key, "count": 0, "share": 0.0, "team_share": 0.0,
                "last_date": None, "affinity": 0.0, "state": "added", "level": level,
            })
    categories.extend(added)
    added_keys = {item["category"] for item in added}
    return {
        "total": base["total"],
        "categories": categories,
        "never_done": [c for c in base["never_done"] if c not in added_keys],
    }


def build_memory(conn) -> dict:
    """Vollständiges Gedächtnis aller Personen. Genau EIN load_assignments-Scan."""
    people = [dict(row) for row in db.get_all_people(conn)]
    person_ids_by_name = {person["name"]: person["id"] for person in people}

    df = stats.load_assignments(conn)
    tasks, all_categories = _derive_task_profile(df, person_ids_by_name)
    free = derive_free_pattern(conn)
    cast, unmatched = derive_show_cast(conn)
    overrides = _override_map(db.get_memory_overrides(conn))

    rehearsal_weeks = conn.execute("SELECT COUNT(*) AS c FROM rehearsal_plans").fetchone()["c"]
    duty_weeks = conn.execute("SELECT COUNT(*) AS c FROM week_plans").fetchone()["c"]

    entries = []
    for person in people:
        person_id = person["id"]
        shows, removed_shows = _merge_shows(person_id, cast.get(person_id, {}), overrides)
        task_block = _merge_tasks(person_id, tasks.get(person_id), overrides, all_categories)
        entries.append({
            "person_id": person_id,
            "person": person["name"],
            "department": person["department"],
            "active": bool(person["active"]),
            "shows": shows,
            "removed_shows": removed_shows,
            "free": _merge_free(person_id, free.get(person_id), overrides),
            "tasks": task_block["categories"],
            "never_done": task_block["never_done"],
            "data_quality": {
                "assignments": task_block["total"],
                "duty_weeks": duty_weeks,
                "rehearsal_weeks": rehearsal_weeks,
                "cold_start": task_block["total"] == 0,
            },
        })
    entries.sort(key=lambda item: (not item["active"], item["person"].casefold()))
    return {
        "people": entries,
        "unmatched_rehearsal_names": unmatched,
        "meta": {"rehearsal_weeks": rehearsal_weeks, "duty_weeks": duty_weeks},
    }


def show_schedule(
    conn,
    start_iso: str,
    end_iso: str,
    template_code: str | None = None,
) -> dict[str, dict]:
    """Welche Show/Party läuft an welchem Abend? -> {datum: {"shows": [...], "source": ...}}

    Erste nichtleere Quelle je Datum gewinnt:
      1. Probenplan  - am genauesten, existiert aber nur für importierte Wochen
      2. Künstlerplan (`evening_program`) - das Arbeitspferd, pflegt Tobi selbst
      3. A/B-Grundvorlage (Zeile "Show + Party") - Rückfall ohne Künstlerplan
    Unbekannte Programmnamen ("Flashback", "DJ") liefern bewusst kein Signal.
    """
    schedule: dict[str, dict] = {}

    for row in db.get_rehearsal_events(conn, start_iso, end_iso):
        item = dict(row)
        if (item.get("start_time") or "") < "20:00":
            continue
        show = show_identity(item.get("show_code"), item.get("activity"))
        if show is None or show["kind"] not in CAST_KINDS:
            continue
        entry = schedule.setdefault(item["date"], {"shows": [], "source": "probenplan"})
        if not any(s["key"] == show["key"] for s in entry["shows"]):
            entry["shows"].append(show)

    artist_plan_row = db.get_artist_plan_by_start(conn, start_iso)
    if artist_plan_row is not None:
        for entry_row in db.get_artist_plan_entries(conn, artist_plan_row["id"]):
            item = dict(entry_row)
            if item.get("field_key") != "evening_program" or item["date"] in schedule:
                continue
            show = match_show_text(item.get("content"))
            if show is None or show["kind"] not in CAST_KINDS:
                continue
            schedule[item["date"]] = {"shows": [show], "source": "kuenstlerplan"}

    if template_code:
        missing = {iso for iso in _dates_between(start_iso, end_iso) if iso not in schedule}
        if missing:
            try:
                template = plan_templates.get_template(conn, template_code)
                start = date.fromisoformat(start_iso)
                for row in xlsx_template.read_template_content(
                    str(template["path"]), template["sheet"], start
                ):
                    if row.get("date") not in missing:
                        continue
                    if stats.normalize_category(row.get("category") or "") != "Show + Party":
                        continue
                    show = match_show_text(row.get("raw_text"))
                    if show is None or show["kind"] not in CAST_KINDS:
                        continue
                    schedule[row["date"]] = {"shows": [show], "source": "vorlage"}
            except (KeyError, FileNotFoundError, ValueError) as exc:
                # Fehlende/defekte Vorlage darf die Planung nicht blockieren - dann
                # gibt es für diese Tage eben kein Show-Signal.
                logger.warning("Show-Zeitplan aus Vorlage %s nicht lesbar: %s", template_code, exc)

    return schedule


def _dates_between(start_iso: str, end_iso: str) -> list[str]:
    try:
        start = date.fromisoformat(start_iso)
        end = date.fromisoformat(end_iso)
    except (TypeError, ValueError):
        return []
    return [(start + timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]


def _on_stage_from_memory(schedule: dict[str, dict], entries: list[dict]) -> dict[str, list[str]]:
    cast_by_show: dict[str, set[str]] = defaultdict(set)
    for person in entries:
        if not person["active"]:
            continue
        for show in person["shows"]:
            if show["counts_for_planning"]:
                cast_by_show[show["show_key"]].add(person["person"])
    result: dict[str, list[str]] = {}
    for iso, entry in schedule.items():
        names: set[str] = set()
        for show in entry["shows"]:
            names |= cast_by_show.get(show["key"], set())
        if names:
            result[iso] = sorted(names)
    return result


def on_stage_by_date(
    conn,
    start_iso: str,
    end_iso: str,
    template_code: str | None = None,
    *,
    schedule: dict[str, dict] | None = None,
    memory_data: MemoryData | None = None,
) -> dict[str, list[str]]:
    """{datum: [MA-Namen]} - wer laut Gedächtnis an dem Abend auf der Bühne steht.

    AP6: nutzt bereits berechnete `schedule`/`memory_data`, wenn übergeben, statt
    show_schedule()/build_memory() erneut aufzurufen - `None` (Standard) entspricht
    exakt dem bisherigen Verhalten.
    """
    resolved_schedule = (
        schedule if schedule is not None else show_schedule(conn, start_iso, end_iso, template_code)
    )
    if not resolved_schedule:
        return {}
    resolved_memory = memory_data if memory_data is not None else build_memory(conn)
    return _on_stage_from_memory(resolved_schedule, resolved_memory["people"])


def on_stage_shows_by_date(
    conn,
    start_iso: str,
    end_iso: str,
    template_code: str | None = None,
    *,
    schedule: dict[str, dict] | None = None,
) -> dict[str, list[str]]:
    """{datum: [Show-/Party-Name, ...]} - für Konflikttexte im Plan-Editor.

    Liefert nur die menschenlesbaren Namen (z.B. "Taste of New York"), keine
    Personen - die Namen kommen bereits aus derselben `show_schedule`-Quelle,
    die auch `on_stage_by_date` speist.

    AP6: nutzt eine bereits berechnete `schedule`, wenn übergeben, statt
    show_schedule() erneut aufzurufen - `None` (Standard) entspricht exakt dem
    bisherigen Verhalten.
    """
    resolved_schedule = (
        schedule if schedule is not None else show_schedule(conn, start_iso, end_iso, template_code)
    )
    return {iso: [show["label"] for show in entry["shows"]] for iso, entry in resolved_schedule.items()}


def planning_signals(
    conn,
    start_iso: str,
    end_iso: str,
    template_code: str | None = None,
    *,
    schedule: dict[str, dict] | None = None,
    memory_data: MemoryData | None = None,
) -> dict:
    """Alle Gedächtnis-Signale für die Plangenerierung - mit EINEM build_memory-Durchlauf.

    -> {"on_stage_by_date": {datum: [Namen]},
        "affinity": {(Name, Kategorie): float in [-1,+1]},
        "task_added":   {Kategorie: [Namen]},   # manuell zugetraut (Kaltstart-Hebel)
        "task_removed": {Kategorie: [Namen]}}   # manuell "selten einplanen"

    AP6: nutzt bereits berechnete `schedule`/`memory_data`, wenn übergeben - `None`
    (Standard) entspricht exakt dem bisherigen Verhalten.
    """
    resolved_memory = memory_data if memory_data is not None else build_memory(conn)
    entries = resolved_memory["people"]
    schedule = schedule if schedule is not None else show_schedule(conn, start_iso, end_iso, template_code)

    affinity: dict[tuple[str, str], float] = {}
    task_added: dict[str, list[str]] = defaultdict(list)
    task_removed: dict[str, list[str]] = defaultdict(list)
    for person in entries:
        if not person["active"]:
            continue
        name = person["person"]
        for task in person["tasks"]:
            category = task["category"]
            affinity[(name, category)] = float(task.get("affinity") or 0.0)
            if task["state"] == "added":
                task_added[category].append(name)
            elif task["state"] == "removed":
                task_removed[category].append(name)

    return {
        "on_stage_by_date": _on_stage_from_memory(schedule, entries) if schedule else {},
        "affinity": affinity,
        "task_added": dict(task_added),
        "task_removed": dict(task_removed),
    }


def _free_quota() -> int:
    for rule in template_spec.FAIRNESS_RULES:
        if rule.get("is_absence") and rule.get("absence_type") == "Frei":
            return int(rule.get("min_per_week", 2))
    return 2


def suggest_free_days(conn, week_dates_iso: list[str], existing_absences: list[dict]) -> dict:
    """Schlägt je MA die üblichen Frei-Tage für die Zielwoche vor.

    Bewusst nur ein Vorschlag: der Aufrufer trägt ihn ein, nichts wird automatisch gesetzt.
    Wer kein erkennbares Muster hat, landet in `needs_manual` statt geraten zu werden.
    """
    quota = _free_quota()
    date_by_weekday: dict[int, str] = {}
    for iso in week_dates_iso:
        try:
            date_by_weekday[date.fromisoformat(iso).weekday()] = iso
        except (TypeError, ValueError):
            continue

    # Jede vorhandene Abwesenheit blockt den Tag (Frei genauso wie Urlaub/Krank);
    # nur "Frei" zählt gegen die Wochenquote.
    blocked: dict[str, set[str]] = defaultdict(set)
    free_count: dict[str, int] = defaultdict(int)
    for absence in existing_absences or []:
        person = str(absence.get("person") or "").strip().casefold()
        if not person:
            continue
        blocked[person].add(absence.get("date"))
        if str(absence.get("type") or "").strip() == "Frei":
            free_count[person] += 1

    suggestions: list[dict] = []
    needs_manual: list[str] = []
    for person in build_memory(conn)["people"]:
        if not person["active"]:
            continue
        key = person["person"].casefold()
        free = person["free"]
        if not free["weekdays"]:
            # flat/insufficient bzw. bewusst leerer Pin -> nicht raten
            needs_manual.append(person["person"])
            continue
        open_slots = quota - free_count.get(key, 0)
        if open_slots <= 0:
            continue
        dates = [
            date_by_weekday[weekday]
            for weekday in free["weekdays"]
            if weekday in date_by_weekday and date_by_weekday[weekday] not in blocked.get(key, set())
        ][:open_slots]
        if not dates:
            continue
        suggestions.append({
            "person": person["person"],
            "person_id": person["person_id"],
            "dates": dates,
            "weekdays": free["weekdays"],
            "pattern": free["pattern"],
            "source": free["source"],
        })
    return {"quota": quota, "suggestions": suggestions, "needs_manual": needs_manual}


def memory_for_person(
    conn,
    person_id: int,
    *,
    memory_data: MemoryData | None = None,
) -> dict | None:
    """AP5b: nutzt bereits berechnetes Memory, wenn übergeben, statt erneut
    build_memory() aufzurufen. `memory_data=None` (Standard) entspricht exakt dem
    bisherigen Verhalten. Eine leere, aber übergebene Struktur (z.B. {"people": []})
    ist explizit ungleich `None` und löst deshalb bewusst KEINEN Fallback aus."""
    resolved = memory_data if memory_data is not None else build_memory(conn)
    for entry in resolved["people"]:
        if entry["person_id"] == person_id:
            return entry
    return None
