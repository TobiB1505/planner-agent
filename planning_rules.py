"""Erweiterbares Regelwerk für intelligente Dienstplan-Zuweisungen.

Die Regeln unterscheiden:
- harte Regeln: dürfen auch bei manueller Eingabe nicht verletzt werden;
- Empfehlungen: steuern automatische Vorschläge, bleiben manuell übersteuerbar.

Neue fachliche Hinweise von Tobi werden hier schrittweise als weitere Regeln ergänzt.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Iterable

RELIEF_REWARDS = {"Ausschlafen", "Barfrei"}

# Auf 8-Stunden-Verträgen angestellt: nur vormittags/nachmittags einsetzbar,
# nie abends (z.B. beim An-/Abreise-Dienst mit später Uhrzeit).
EIGHT_HOUR_CONTRACT_PEOPLE = {"Brigitte", "Manu"}
_EIGHT_HOUR_CONTRACT_CASEFOLDED = {name.casefold() for name in EIGHT_HOUR_CONTRACT_PEOPLE}
EXTRADIENSTE_PERSON_CATEGORIES = {"TT & Kicker wischen", "Süße Momente", "An + Abreise-Dienst"}
EVENING_CUTOFF_MINUTES = 17 * 60
TIME_RANGE_RE = re.compile(
    r"(?<!\d)(\d{1,2})[:.](\d{2})\s*(?:-|–|bis)\s*(\d{1,2})[:.](\d{2})(?!\d)",
    re.IGNORECASE,
)
SINGLE_TIME_RE = re.compile(r"(?<!\d)(\d{1,2})[:.](\d{2})(?!\d)")
# Volle-Stunden-Format ohne Doppelpunkt, wie es An-/Abreise-Dienst tatsächlich
# verwendet (z.B. "14-15Uhr", "10-11 Uhr").
HOUR_RANGE_RE = re.compile(r"(?<!\d)(\d{1,2})\s*-\s*(\d{1,2})\s*uhr\b", re.IGNORECASE)


def active_planning_rules() -> list[dict]:
    """Zentrale, UI-unabhängige Übersicht aller aktiven Planungslogiken."""
    return [
        {
            "id": "sport",
            "title": "Sportprogramm",
            "description": (
                "SPT wird bevorzugt. T&C wird nicht automatisch eingeplant, "
                "bleibt für Sonderfälle manuell auswählbar."
            ),
            "tone": "info",
        },
        {
            "id": "rehearsals",
            "title": "Proben & Zeitfenster",
            "description": (
                "Überschneidungen werden vermieden; Proben in zeitlicher Nähe "
                "verschlechtern eine Empfehlung."
            ),
            "tone": "info",
        },
        {
            "id": "show_deko",
            "title": "Deko an Showtagen",
            "description": (
                "Deko kann Kochdienste übernehmen, erhält wegen Bühnenauf- und "
                "abbau aber kein Ausschlafen oder Barfrei."
            ),
            "tone": "warning",
        },
        {
            "id": "show_cooking",
            "title": "Show-Teilnehmer beim Abendkochen",
            "description": (
                "Wer abends in der Show steht, wird für die Kochdienste am "
                "Abend nicht empfohlen - Ausnahmen bleiben möglich, es ist "
                "keine Sperre."
            ),
            "tone": "warning",
        },
        {
            "id": "extradienste_8h",
            "title": "8h-Verträge bei Extradiensten und Kochdienst",
            "description": (
                "Brigitte und Manu sind auf 8-Stunden-Verträgen angestellt und "
                "übernehmen keine Abenddienste: weder Extradienste am Abend "
                "(z.B. spätes An-/Abreise) noch den Abend-Kochdienst KP3. "
                "Vormittags und nachmittags bleibt beides möglich."
            ),
            "tone": "warning",
        },
        {
            "id": "relief",
            "title": "Entlastung",
            "description": (
                "Jeder MA erhält einmal Barfrei oder Ausschlafen. Späte Einsätze "
                "und viele Kochdienste erhöhen die Priorität."
            ),
            "tone": "info",
        },
        {
            "id": "previous_week_load",
            "title": "Belastung aus der Vorwoche",
            "description": (
                "Wer in der direkten Vorwoche überdurchschnittlich viele oder "
                "besonders belastende Dienste hatte, wird in der neuen Woche "
                "nach Möglichkeit etwas niedriger priorisiert."
            ),
            "tone": "info",
        },
        {
            "id": "special_bvb",
            "title": "Gäste vs. Robins BVB",
            "description": (
                "Freitag um 15:30 werden mindestens vier verschiedene MA benötigt."
            ),
            "tone": "info",
        },
        {
            "id": "departments",
            "title": "Abteilungslogik",
            "description": (
                "S&L wird beim Aperitif bevorzugt, KP3 vermeidet S&L und "
                "OPS/WP priorisiert Manager."
            ),
            "tone": "info",
        },
    ]


def is_relief_reward(category: str) -> bool:
    return (category or "").strip() in RELIEF_REWARDS


def is_guests_vs_robins_bvb(
    category: str,
    subcategory: str | None,
    date_iso: str | None = None,
) -> bool:
    """Erkennt den wöchentlichen BVB-Sondertermin am Freitag um 15:30 Uhr."""
    if (category or "").strip().casefold() != "sportprogramm":
        return False
    text = (subcategory or "").strip().casefold()
    has_slot = "15:30" in text and ("bvb" in text or "volleyball" in text)
    explicitly_named = "gäste" in text and "robins" in text
    is_friday = False
    if date_iso:
        try:
            is_friday = date.fromisoformat(date_iso).weekday() == 4
        except ValueError:
            pass
    return has_slot and (explicitly_named or is_friday)


def required_people(
    category: str,
    subcategory: str | None,
    date_iso: str | None = None,
) -> int:
    return 4 if is_guests_vs_robins_bvb(category, subcategory, date_iso) else 1


def department_tags(department: str | None) -> set[str]:
    raw = (department or "").casefold()
    compact = re.sub(r"[^a-z0-9&]+", " ", raw)
    tags: set[str] = set()
    if (
        "sportstainer" in compact
        or "sports trainer" in compact
        or re.search(r"\bspt\b", compact)
    ):
        tags.add("SPT")
    if (
        "s&l" in raw
        or "sound & light" in raw
        or "sound and light" in raw
        or "sound und light" in raw
    ):
        tags.add("S&L")
    if "manager" in compact:
        tags.add("MANAGER")
    if "deko" in compact or "decoration" in compact:
        tags.add("DEKO")
    if (
        "t&c" in raw
        or "choreo" in compact
        or "choreograf" in compact
        or "choreograph" in compact
    ):
        tags.add("T&C")
    return tags


def _is_evening_extradienste(category: str, subcategory: str | None) -> bool:
    if (category or "").strip() not in EXTRADIENSTE_PERSON_CATEGORIES:
        return False
    interval = service_interval(category, subcategory)
    return interval is not None and interval[0] >= EVENING_CUTOFF_MINUTES


def _rule_id(category: str, subcategory: str | None) -> str | None:
    category_norm = (category or "").casefold()
    subcategory_norm = (subcategory or "").casefold()
    if is_relief_reward(category):
        return "relief_reward"
    if _is_evening_extradienste(category, subcategory):
        return "extradienste_8h_evening"
    if category_norm == "aperitif":
        return "aperitif_sound_light"
    if is_guests_vs_robins_bvb(category, subcategory):
        return "sport_guests_vs_robins"
    if category_norm == "sportprogramm":
        return "sport_spt"
    if category_norm == "kochdienste" and subcategory_norm.startswith("kp3"):
        return "kp3_no_sound_light"
    if category_norm.replace("/", "+").replace(" ", "") in {"ops+wp", "opswp"}:
        return "ops_managers"
    return None


def person_decision(
    name: str,
    department: str | None,
    category: str,
    subcategory: str | None,
    *,
    automatic: bool,
) -> dict:
    """Bewertet eine Person für einen konkreten Dienst."""
    rule_id = _rule_id(category, subcategory)
    tags = department_tags(department)

    if rule_id == "relief_reward":
        return {
            "rule_id": rule_id,
            "allowed": True,
            "recommended": True,
            "message": (
                "Ausschlafen und Barfrei sind eine gemeinsame Entlastung. "
                "Jeder MA bekommt davon insgesamt genau 1x pro Woche."
            ),
        }
    if rule_id == "extradienste_8h_evening":
        allowed = name.strip().casefold() not in _EIGHT_HOUR_CONTRACT_CASEFOLDED
        return {
            "rule_id": rule_id,
            "allowed": allowed,
            "recommended": allowed,
            "message": (
                "Brigitte und Manu sind auf 8-Stunden-Verträgen angestellt und "
                "können abends keine Extradienste übernehmen."
            ),
        }
    if rule_id == "aperitif_sound_light":
        recommended = "S&L" in tags
        return {
            "rule_id": rule_id,
            "allowed": True,
            "recommended": recommended,
            "message": (
                "Beim Aperitif wird S&L bevorzugt, weil Sound & Light "
                "während des Künstlerprogramms vor Ort sein muss."
            ),
        }
    if rule_id == "sport_spt":
        recommended = "SPT" in tags
        return {
            "rule_id": rule_id,
            "allowed": recommended if automatic else True,
            "recommended": recommended,
            "message": (
                "Sportprogramm wird standardmäßig SPT zugewiesen. "
                "Andere Mitarbeiter können manuell ergänzt werden."
            ),
        }
    if rule_id == "sport_guests_vs_robins":
        recommended = "SPT" in tags
        # Weiche Planungsregel: T&C wird nicht automatisch für Sport eingesetzt,
        # bleibt aber für begründete Sonderfälle jederzeit manuell auswählbar.
        allowed = True if not automatic else "T&C" not in tags
        return {
            "rule_id": rule_id,
            "allowed": allowed,
            "recommended": recommended,
            "message": (
                "Gäste vs. Robins BVB braucht mindestens 4 Mitarbeiter. "
                "SPT wird bevorzugt; T&C wird nicht automatisch eingeplant, "
                "kann bei einem Sonderfall aber manuell gewählt werden."
            ),
        }
    if rule_id == "kp3_no_sound_light":
        is_8h_contract = name.strip().casefold() in _EIGHT_HOUR_CONTRACT_CASEFOLDED
        allowed = "S&L" not in tags and not is_8h_contract
        return {
            "rule_id": rule_id,
            "allowed": allowed,
            "recommended": allowed,
            "message": (
                "KP3 am Abend ist für S&L nicht möglich, weil S&L während des "
                "Abendprogramms gebraucht wird. Brigitte und Manu sind auf "
                "8-Stunden-Verträgen angestellt und übernehmen abends keine Dienste."
            ),
        }
    if rule_id == "ops_managers":
        allowed = "MANAGER" in tags
        return {
            "rule_id": rule_id,
            "allowed": allowed,
            "recommended": allowed,
            "message": "OPS/WP wird ausschließlich einem Manager zugewiesen.",
        }
    return {
        "rule_id": None,
        "allowed": True,
        "recommended": True,
        "message": None,
    }


def use_all_active_for_auto(category: str, subcategory: str | None) -> bool:
    """Abteilungsregeln ziehen ihren Kandidatenpool direkt aus dem aktiven Team."""
    return _rule_id(category, subcategory) in {
        "sport_spt", "sport_guests_vs_robins", "ops_managers",
        "aperitif_sound_light",
    }


def time_key(category: str, subcategory: str | None) -> str:
    """Schlüssel für zeitgleiche Dienste; verhindert echte Doppelbelegungen."""
    text = subcategory or ""
    match = re.search(r"(?<!\d)(\d{1,2})[:.](\d{2})(?!\d)", text)
    if match:
        return f"{int(match.group(1)):02d}:{match.group(2)}"
    # Ohne erkennbare Uhrzeit bleibt die bisherige Sicherheit erhalten:
    # dieselbe Kategorie wird am selben Tag nicht doppelt an eine Person vergeben.
    return f"KATEGORIE:{category.casefold()}"


def _clock_minutes(hour: str, minute: str) -> int:
    return int(hour) * 60 + int(minute)


def service_interval(
    category: str,
    subcategory: str | None,
) -> tuple[int, int] | None:
    """Liefert den realistischen Zeitslot eines Dienstes in Minuten.

    Ein Ende nach Mitternacht liegt über 1440. Für Sport gilt ohne explizites
    Ende eine Stunde, damit z. B. 15:30 Volleyball bis 16:30 blockiert.
    """
    category_text = (category or "").strip()
    slot_text = (subcategory or "").strip()
    text = f"{slot_text} {category_text}".strip()
    range_match = TIME_RANGE_RE.search(text)
    if range_match:
        start = _clock_minutes(range_match.group(1), range_match.group(2))
        end = _clock_minutes(range_match.group(3), range_match.group(4))
        if end <= start:
            end += 24 * 60
        return start, end

    hour_range_match = HOUR_RANGE_RE.search(text)
    if hour_range_match:
        start = _clock_minutes(hour_range_match.group(1), "00")
        end = _clock_minutes(hour_range_match.group(2), "00")
        if end <= start:
            end += 24 * 60
        return start, end

    start_match = SINGLE_TIME_RE.search(text)
    category_norm = category_text.casefold()
    if start_match:
        start = _clock_minutes(start_match.group(1), start_match.group(2))
        duration = 60
        if "süße momente" in category_norm:
            duration = 30
        return start, start + duration

    # Fachlich bekannte Zeiten, wenn die Uhrzeit nicht im Zeilennamen steckt.
    defaults = {
        "moderation + getränkedienst": (21 * 60 + 40, 24 * 60 + 30),
        "18 uhr leds": (18 * 60, 18 * 60 + 30),
        "18:00 saunaaufguss": (18 * 60, 19 * 60),
    }
    return defaults.get(category_norm)


def intervals_overlap(
    first: tuple[int, int],
    second: tuple[int, int],
) -> bool:
    """Prüft Überschneidungen, inklusive Einsätzen über Mitternacht."""
    first_variants = (first, (first[0] + 1440, first[1] + 1440))
    second_variants = (second, (second[0] + 1440, second[1] + 1440))
    return any(
        start_a < end_b and start_b < end_a
        for start_a, end_a in first_variants
        for start_b, end_b in second_variants
    )


def interval_gap_minutes(
    first: tuple[int, int],
    second: tuple[int, int],
) -> int:
    """Kleinster Abstand zweier Slots; 0 bedeutet Überschneidung."""
    if intervals_overlap(first, second):
        return 0
    gaps: list[int] = []
    for start_a, end_a in (first, (first[0] + 1440, first[1] + 1440)):
        for start_b, end_b in (second, (second[0] + 1440, second[1] + 1440)):
            if end_a <= start_b:
                gaps.append(start_b - end_a)
            elif end_b <= start_a:
                gaps.append(start_a - end_b)
    return min(gaps) if gaps else 24 * 60


def rehearsal_interval(start_time: str, end_time: str) -> tuple[int, int]:
    start_hour, start_minute = start_time.replace(".", ":").split(":", 1)
    end_hour, end_minute = end_time.replace(".", ":").split(":", 1)
    start = _clock_minutes(start_hour, start_minute)
    end = _clock_minutes(end_hour, end_minute)
    if end <= start:
        end += 24 * 60
    return start, end


def rehearsal_conflict_level(
    service: tuple[int, int] | None,
    rehearsal: tuple[int, int],
) -> int:
    """0=frei, 1=Probe bis 60 Min. entfernt, 2=bis 30 Min., 3=Überschneidung."""
    if service is None:
        return 0
    if intervals_overlap(service, rehearsal):
        return 3
    gap = interval_gap_minutes(service, rehearsal)
    if gap <= 30:
        return 2
    if gap <= 60:
        return 1
    return 0


def assignment_rule(
    people: Iterable[dict],
    category: str,
    subcategory: str | None,
) -> dict | None:
    """Frontend-Regel mit empfohlenen, erlaubten und gesperrten Namen."""
    rows = [dict(person) for person in people]
    decisions = {
        person["name"]: person_decision(
            person["name"],
            person.get("department"),
            category,
            subcategory,
            automatic=False,
        )
        for person in rows
    }
    rule_id = next((decision["rule_id"] for decision in decisions.values() if decision["rule_id"]), None)
    if not rule_id:
        return None

    auto_decisions = {
        person["name"]: person_decision(
            person["name"],
            person.get("department"),
            category,
            subcategory,
            automatic=True,
        )
        for person in rows
    }
    message = next(decision["message"] for decision in decisions.values() if decision["message"])
    allowed = [name for name, decision in decisions.items() if decision["allowed"]]
    blocked = [name for name, decision in decisions.items() if not decision["allowed"]]
    recommended = [
        name for name, decision in auto_decisions.items()
        if decision["allowed"] and decision["recommended"] and name in allowed
    ]
    return {
        "id": rule_id,
        "message": message,
        "recommended_people": recommended,
        "allowed_people": allowed,
        "blocked_people": blocked,
        "hard_rule": bool(blocked),
    }


def hard_violation(
    name: str,
    department: str | None,
    category: str,
    subcategory: str | None,
) -> str | None:
    decision = person_decision(
        name, department, category, subcategory, automatic=False
    )
    return decision["message"] if not decision["allowed"] else None
