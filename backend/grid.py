"""Pivotiert Zuteilungs-Listen in eine Tage×Kategorien-Grid-Ansicht (wie im Original-Dienstplan) und zurück."""
from __future__ import annotations

import re

import pandas as pd

from . import planning_rules
from . import template_spec
from . import util

WEEKDAY_NAMES_DE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]


def _normalize_category_name(name: str) -> str:
    # führende Uhrzeit bzw. Uhrzeit-Spanne (z.B. "18:00 " oder "00:30-03:00 ")
    name = re.sub(r"^\d{1,2}[:.]\d{2}(\s*-\s*\d{1,2}[:.]\d{2})?[\s-]*", "", name)
    name = re.sub(r"\s+", " ", name.replace("/", " + "))
    return name.strip()


def _build_category_order() -> list[str]:
    """Reihenfolge aus template_spec.ROWS abgeleitet (Tobis Zeile-für-Zeile-Erklärung der
    echten Vorlage) - ALLE Zeilen außer Urlaub/Krank+Frei (die haben eigene ABSENCE_ROWS),
    auch Info-/Abteilungs-Zeilen (Specials, Show/Party, Abbauhilfe, ...) - die sind zwar nicht
    Teil der Fairness-Rotation, sollen aber im Plan sichtbar/ausfüllbar bleiben, nicht versteckt
    werden. Zeitschienen-Familien (Sportprogramm, Kochdienste) werden zu einer Sammel-Kategorie
    zusammengefasst, da unsere Extraktion/Statistik sie so gruppiert."""
    order: list[str] = []
    seen_families: set[str] = set()
    for name, spec in template_spec.ROWS.items():
        if spec["kind"] == template_spec.ABSENCE:
            continue
        family = spec.get("family")
        if family:
            if family in seen_families:
                continue
            seen_families.add(family)
            order.append(_normalize_category_name(family))
        else:
            order.append(_normalize_category_name(name))
    return order


CATEGORY_ORDER = _build_category_order()

# Kategorien, die echte MA-Rotationsdienste sind (für Namens-Vorschläge im Plan-Editor) -
# Info-/Abteilungs-/Manuell-Zeilen sind bewusst nicht enthalten, da dort Freitext gilt.
PERSON_CATEGORIES = {
    _normalize_category_name(spec.get("family") or name)
    for name, spec in template_spec.ROWS.items()
    if spec["kind"] == template_spec.PERSON
}

_CATEGORY_KINDS = {
    _normalize_category_name(spec.get("family") or name): spec["kind"]
    for name, spec in template_spec.ROWS.items()
}


def category_kind(category: str) -> str:
    """Liefert den Zeilentyp einer normalisierten Grid-Kategorie."""
    return _CATEGORY_KINDS.get(_normalize_category_name(category), template_spec.CONTENT)


ABSENCE_ROWS = ["Urlaub/Krank", "Frei"]

LABEL_COL = "Abschnitt"
SLOT_COL = "Zeile"
ROW_TYPE_COL = "_row_type"
CATEGORY_COL = "_category"
GROUP_LABEL_COL = "_group_label"
GROUP_COLOR_COL = "_group_color"
META_COLS = {
    LABEL_COL, SLOT_COL, ROW_TYPE_COL, CATEGORY_COL, GROUP_LABEL_COL, GROUP_COLOR_COL,
}
# AP9: zentrale Quelle in template_spec.py (Abteilungs-Kurzcodes + "keine
# Zuweisung"-Marker "-"/"KEINE"/"KEIN"/"NIEMAND") - vorher eine eigene, wertgleiche
# Kopie hier.
NON_PERSON_ASSIGNMENT_VALUES = template_spec.NON_PERSON_ASSIGNMENT_TOKENS


def is_non_person_assignment_value(value: str) -> bool:
    return value.strip().upper() in NON_PERSON_ASSIGNMENT_VALUES


def _build_layout_groups() -> dict[str, dict]:
    result: dict[str, dict] = {}
    for group in template_spec.LAYOUT_GROUPS:
        normalized = {
            **group,
            "categories": [_normalize_category_name(cat) for cat in group["categories"]],
        }
        for category in normalized["categories"]:
            result[category] = normalized
    return result


LAYOUT_GROUP_BY_CATEGORY = _build_layout_groups()

FAMILY_SLOT_LABELS = {
    "Kochdienste": [
        "KP1 7:50 - 10:00",
        "KP2 12:00 - 14:00",
        "KP3 19:00 - 21:15",
    ],
    "Sportprogramm": [
        "10:30 Softsport",
        "11:00 BVB",
        "15:30 Softsport",
        "15:30 BVB",
        "16:00 JeKaMi",
        "17:00 Fußball",
        "17:00 Fußball-Tennis",
    ],
}


def _category_sort_key(cat: str) -> tuple:
    try:
        return (0, CATEGORY_ORDER.index(cat))
    except ValueError:
        return (1, cat)


def slot_key(subcat: str) -> str:
    """Extrahiert eine stabile Zeitschienen-/Slot-Kennung aus einer Subkategorie, damit z.B.
    'Boccia' und 'Freegolf' am selben 10:30-Slot in dieselbe Zeile gruppiert werden."""
    subcat = subcat.strip()
    m = re.match(r"^(\d{1,2})[:.](\d{2})", subcat)
    if m:
        return f"{int(m.group(1)):02d}:{m.group(2)}"
    m = re.match(r"^(KP\d+)", subcat, re.IGNORECASE)
    if m:
        return m.group(1).upper()
    return subcat


def slot_key_for_category(category: str, subcat: str) -> str:
    """Ordnet Familien mit gleichzeitigen Unterzeilen eindeutig zu.

    Insbesondere dürfen 15:30 Softsport und 15:30 BVB nicht mehr in derselben
    Grid-/Excel-Zeile landen.
    """
    category = _normalize_category_name(category)
    text = (subcat or "").strip()
    lower = text.casefold()
    if category == "Kochdienste":
        match = re.match(r"^(KP[123])", text, re.IGNORECASE)
        if match:
            prefix = match.group(1).upper()
            return next(slot for slot in FAMILY_SLOT_LABELS[category] if slot.startswith(prefix))
    if category == "Sportprogramm":
        time_match = re.match(r"^(\d{1,2})[:.](\d{2})", text)
        time = f"{int(time_match.group(1)):02d}:{time_match.group(2)}" if time_match else ""
        if time == "10:30":
            return "10:30 Softsport"
        if time == "11:00":
            return "11:00 BVB"
        if time == "15:30":
            return "15:30 BVB" if ("bvb" in lower or "volleyball" in lower) else "15:30 Softsport"
        if time == "16:00":
            return "16:00 JeKaMi"
        if time == "17:00":
            return "17:00 Fußball-Tennis" if "tennis" in lower else "17:00 Fußball"
        for slot in FAMILY_SLOT_LABELS[category]:
            if slot.casefold() == lower:
                return slot
    return slot_key(text)


def _softsport_activity(subcat: str) -> str:
    activity = re.sub(r"^\d{1,2}[:.]\d{2}\s*", "", subcat or "").strip()
    activity = re.sub(r"^softsport\s*", "", activity, flags=re.IGNORECASE).strip()
    activity = re.sub(r"\s+[|I]\s*$", "", activity).strip()
    return activity


def format_person_assignment(category: str, subcategory: str | None, person: str) -> str:
    """Formatiert eine MA-Zuweisung so, wie sie im Grid und in Excel stehen soll."""
    category = _normalize_category_name(category)
    subcategory = (subcategory or "").strip()
    if category == "Sportprogramm":
        slot = slot_key_for_category(category, subcategory)
        if "Softsport" in slot:
            activity = _softsport_activity(subcategory)
            return f"{activity} | {person}" if activity else person
        return person
    if category == "Kochdienste":
        return person
    return f"{subcategory} | {person}" if subcategory else person


def slot_sort_key(slot: str, fallback_index: int) -> tuple:
    m = re.match(r"^(\d{1,2}):(\d{2})$", slot)
    if m:
        return (0, int(m.group(1)), int(m.group(2)))
    return (1, fallback_index, 0)


def build_grid(draft_rows: list[dict], week_dates_iso: list[str]) -> pd.DataFrame:
    """draft_rows: Liste von {date, category, subcategory, person, raw_text} (ISO-Daten).
    Baut eine Tabelle mit den Spalten 'Abschnitt' (Kategorie), 'Zeile' (Zeitschiene/Slot,
    leer wenn die Kategorie keine Unterteilung braucht) und je einer Spalte pro Wochentag.
    Kategorien mit mehreren unterschiedlichen Slots (z.B. Sportprogramm: 10:30, 11:00, 15:30, ...)
    werden auf mehrere Zeilen aufgeteilt, statt alles in eine Zelle zu quetschen."""
    day_labels = [util.fmt_date_short(d) for d in week_dates_iso]
    day_by_iso = dict(zip(week_dates_iso, day_labels))

    # Immer die komplette Vorlagen-Struktur zeigen (auch Info-/Abteilungs-Zeilen wie Show/Party,
    # Specials, Meeting, Abbauhilfe, ...), nicht nur Kategorien mit historischen Daten - Tobi soll
    # sie direkt im Plan sehen und ausfüllen können, auch ohne Fairness-Vorschlag.
    cats = sorted(set(CATEGORY_ORDER) | {r["category"] for r in draft_rows}, key=_category_sort_key)

    slot_order: dict[str, list[str]] = {}
    cell_lines: dict[tuple[str, str, str], list[str]] = {}

    for r in draft_rows:
        cat = r["category"]
        day = day_by_iso.get(r["date"], r["date"])
        person = (r.get("person") or "").strip()
        subcat = (r.get("subcategory") or "").strip()
        raw_text = (r.get("raw_text") or "").strip()
        special_bvb = planning_rules.is_guests_vs_robins_bvb(
            cat, subcat, r.get("date")
        )
        if person:
            line = format_person_assignment(cat, subcat, person)
        elif subcat:
            line = f"{subcat} |"
        elif raw_text and category_kind(cat) != template_spec.PERSON:
            line = raw_text
        else:
            continue

        # Aperitif enthält Ort, Uhrzeit und Künstler als mehrzeiligen Zell-Präfix.
        # Diese Inhalte sind keine eigene Unterzeile und bleiben deshalb in derselben Zeile.
        slot = (
            ""
            if cat == "Aperitif"
            else slot_key_for_category(cat, subcat) if subcat else ""
        )
        seen = slot_order.setdefault(cat, [])
        if slot not in seen:
            seen.append(slot)
        cell_key = (cat, slot, day)
        if special_bvb:
            existing = cell_lines.setdefault(cell_key, [])
            line = (
                f"(Gäste vs Robins BVB) | {person}"
                if not existing
                else person
            )
            existing.append(line)
        else:
            cell_lines.setdefault(cell_key, []).append(line)

    rows = []
    for label in ABSENCE_ROWS:
        row = {LABEL_COL: label, SLOT_COL: ""}
        for d in day_labels:
            row[d] = ""
        row.update({ROW_TYPE_COL: "data", CATEGORY_COL: label})
        rows.append(row)

    inserted_groups: set[str] = set()
    for cat in cats:
        layout_group = LAYOUT_GROUP_BY_CATEGORY.get(cat)
        if layout_group and layout_group["label"] not in inserted_groups:
            group_row = {LABEL_COL: "", SLOT_COL: ""}
            for d in day_labels:
                group_row[d] = ""
            group_row.update({
                ROW_TYPE_COL: "group",
                CATEGORY_COL: "",
                GROUP_LABEL_COL: layout_group["label"],
                GROUP_COLOR_COL: layout_group["color"],
            })
            rows.append(group_row)
            inserted_groups.add(layout_group["label"])

        found_slots = slot_order.get(cat) or []
        if cat in FAMILY_SLOT_LABELS:
            slots_sorted = [
                *FAMILY_SLOT_LABELS[cat],
                *(slot for slot in found_slots if slot not in FAMILY_SLOT_LABELS[cat]),
            ]
        else:
            slots = found_slots or [""]
            slots_sorted = sorted(slots, key=lambda s: slot_sort_key(s, slots.index(s)))
        for slot in slots_sorted:
            visible_label = (
                layout_group.get("detail_label", cat)
                if layout_group
                else cat
            )
            row = {LABEL_COL: visible_label, SLOT_COL: slot}
            for d in day_labels:
                row[d] = "\n".join(cell_lines.get((cat, slot, d), []))
            row.update({
                ROW_TYPE_COL: "data",
                CATEGORY_COL: cat,
                GROUP_LABEL_COL: layout_group["label"] if layout_group else None,
                GROUP_COLOR_COL: layout_group["color"] if layout_group else None,
            })
            rows.append(row)

    return pd.DataFrame(rows)


def parse_grid(grid_df: pd.DataFrame, day_iso_by_label: dict[str, str]) -> tuple[list[dict], list[dict]]:
    """Zerlegt die editierte Grid-DataFrame zurück in (assignments, absences)."""
    assignments: list[dict] = []
    absences: list[dict] = []
    day_cols = [c for c in grid_df.columns if c not in META_COLS]

    for _, row in grid_df.iterrows():
        if str(row.get(ROW_TYPE_COL) or "") == "group":
            continue
        cat = str(row.get(CATEGORY_COL) or row.get(LABEL_COL) or "").strip()
        if not cat:
            continue

        for day_label in day_cols:
            iso = day_iso_by_label.get(day_label)
            cell = row[day_label]
            cell = "" if pd.isna(cell) else str(cell)
            if not iso or not cell.strip():
                continue

            if cat in ABSENCE_ROWS:
                typ = "Urlaub/Krank" if cat == "Urlaub/Krank" else "Frei"
                for name in cell.replace("\n", ",").split(","):
                    name = name.strip()
                    if name:
                        absences.append({"date": iso, "person": name, "type": typ})
                continue

            if category_kind(cat) != template_spec.PERSON:
                text = cell.strip()
                if text:
                    assignments.append({
                        "date": iso,
                        "category": cat,
                        "subcategory": str(row.get(SLOT_COL) or "").strip() or None,
                        "person": None,
                        "raw_text": text,
                    })
                continue

            if cat == "Aperitif" and "|" in cell:
                lines = [line.strip() for line in cell.splitlines() if line.strip()]
                first_delimiter = next(
                    (index for index, line in enumerate(lines) if "|" in line),
                    -1,
                )
                if first_delimiter >= 0:
                    delimiter_line = lines[first_delimiter]
                    left, right = delimiter_line.rsplit("|", 1)
                    subcat = "\n".join([
                        *lines[:first_delimiter],
                        left.strip(),
                    ]).strip() or None
                    names = [right.strip()]
                    for line in lines[first_delimiter + 1:]:
                        names.append(
                            line.rsplit("|", 1)[-1].strip()
                            if "|" in line
                            else line
                        )
                    added_assignment = False
                    for name in ",".join(names).split(","):
                        name = name.strip()
                        if name:
                            assignments.append({
                                "date": iso,
                                "category": cat,
                                "subcategory": subcat,
                                "person": None if is_non_person_assignment_value(name) else name,
                                "raw_text": cell.strip(),
                            })
                            added_assignment = True
                    if not added_assignment and subcat:
                        assignments.append({
                            "date": iso,
                            "category": cat,
                            "subcategory": subcat,
                            "person": None,
                            "raw_text": cell.strip(),
                        })
                    continue

            for line in cell.splitlines():
                line = line.strip()
                if not line:
                    continue
                row_slot = str(row.get(SLOT_COL) or "").strip()
                special_bvb = planning_rules.is_guests_vs_robins_bvb(
                    cat, row_slot, iso
                ) or ("gäste" in cell.casefold() and "robins" in cell.casefold())
                subcat = (
                    "15:30 Gäste vs Robins BVB"
                    if special_bvb
                    else row_slot or None
                )
                person_part = line
                if " | " in line:
                    left, right = line.split(" | ", 1)
                    left = left.strip()
                    person_part = right.strip()
                    if special_bvb:
                        subcat = "15:30 Gäste vs Robins BVB"
                    elif cat == "Sportprogramm" and row_slot and "Softsport" in row_slot:
                        time = row_slot.split(" ", 1)[0]
                        subcat = f"{time} {left}".strip()
                    else:
                        subcat = left or subcat
                elif line.endswith("|"):
                    subcat, person_part = line[:-1].strip() or subcat, ""
                for name in person_part.split(","):
                    name = name.strip()
                    if name:
                        assignments.append({
                            "date": iso, "category": cat, "subcategory": subcat,
                            "person": None if is_non_person_assignment_value(name) else name,
                            "raw_text": line,
                        })
    return assignments, absences
