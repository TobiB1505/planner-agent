"""Zentrale Spezifikation der echten Dienstplan-Vorlage – Zeile für Zeile von Tobi erklärt
(siehe Chat vom 30.07.2026). Einzige Quelle der Wahrheit für Extraktion, Excel-Generierung,
Grid-Anzeige und Statistik, damit die Kategorie-Klassifizierung nicht mehrfach/inkonsistent
in verschiedenen Dateien gepflegt wird.

kind-Werte:
  "absence"    – Urlaub/Krank/Frei, eigene Tabelle (nicht Teil von assignments)
  "person"     – Rotations-Dienst, wird einer Einzelperson zugeteilt, zählt in Fairness-Stats
  "department" – wird einer Abteilung zugeteilt (S&L, SPT, TC, Deko, ...), keine Einzelperson
  "content"    – Info/Booking, keine Zuteilung, wird nicht extrahiert
  "manual"     – wird erfasst, aber bewusst nie automatisch vorgeschlagen (MOD)
"""
from __future__ import annotations

ABSENCE = "absence"
PERSON = "person"
DEPARTMENT = "department"
CONTENT = "content"
MANUAL = "manual"

# Reihenfolge entspricht der echten Vorlage (Tobis Erklärung, in dieser Reihenfolge gegeben).
ROWS: dict[str, dict] = {
    "Urlaub/Krank": {
        "kind": ABSENCE,
        "note": "Zeigt MA die Urlaub haben oder krank sind.",
    },
    "Frei": {
        "kind": ABSENCE,
        "note": "Zeigt MA die diese Woche frei haben.",
        "quota_per_week": 2,
    },
    "Specials": {
        "kind": CONTENT,
        "note": "Besonderheiten der Woche, z.B. ein Blau-Weiß-Meeting oder Ankünfte/Abreisen neuer MA.",
    },
    "Tagesverantwortung": {
        "kind": PERSON,
        "note": "MA mit Verantwortung über den Tag, wenn Fanny oder Tobi (Chefs) nicht da sind oder frei haben.",
    },
    "Abbauhilfe": {
        "kind": DEPARTMENT,
        "note": "Welche Abteilung beim Abbau der Bühne unterstützt.",
    },
    "Meeting": {
        "kind": CONTENT,
        "note": "Uhrzeit, wann alle MA im Büro sein müssen (tägliches Team-Meeting).",
    },
    "OPS / WP": {
        "kind": PERSON,
        "note": "Welcher Manager ins operative Meeting mit Clubdirektion und anderen Abteilungen geht.",
    },
    "Show/Party": {
        "kind": CONTENT,
        "note": "Show oder Party des Abends, darunter der DJ des Abends.",
    },
    "Kleidermotto Tag": {
        "kind": CONTENT,
        "note": "Kleidermotto tagsüber.",
    },
    "Kleidermotto Abend": {
        "kind": CONTENT,
        "note": "Kleidermotto abends.",
    },
    "Moderation + Getränkedienst": {
        "kind": PERSON,
        "note": "MA der den Abend an-/abmoderiert und bis 00:30 bleiben muss; Getränkedienst = "
                "versorgt den DJ mit Getränken.",
    },
    "Ausschlafen": {
        "kind": PERSON,
        "note": "Entlastung/Belohnung: MA mit Dienstbeginn erst ab 12 Uhr. Ausschlafen und "
                "Barfrei zählen zusammen; jeder MA bekommt davon genau 1x pro Woche. "
                "Bevorzugt nach einem langen/späten Arbeitstag, z.B. NITE CLUB.",
        "fairness_group": "barfrei_ausschlafen",
        "relief_reward": True,
    },
    "Barfrei": {
        "kind": PERSON,
        "note": "Entlastung/Belohnung: MA der ab 21:40 nicht an die Bar muss. Ausschlafen und "
                "Barfrei zählen zusammen; jeder MA bekommt davon genau 1x pro Woche. "
                "Bevorzugt bei hoher Wochenbelastung oder vielen Kochdiensten.",
        "fairness_group": "barfrei_ausschlafen",
        "relief_reward": True,
    },
    "Mittagsgrill": {
        "kind": CONTENT,
        "note": "Welcher DJ beim Mittagsgrill spielt.",
    },
    "ChillOut Künstler": {
        "kind": CONTENT,
        "note": "Zelle: erst Ort, dann Uhrzeit, dann DJ/Künstler des Chillouts.",
    },
    "Aperitif": {
        "kind": PERSON,
        "note": "Zelle: Ort, Uhrzeit, Künstler, dann der MA mit Apero-Dienst (nur die MA-Zeile "
                "wird zugeteilt, der Künstler wird ignoriert). S&L-Mitarbeiter werden primär "
                "empfohlen, da Sound & Light während des Künstlerprogramms vor Ort sein muss.",
    },
    "KP1 7:50 - 10:00": {"kind": PERSON, "family": "Kochdienste", "note": "Kochdienst in diesem Zeitraum."},
    "KP2 12:00 - 14:00": {"kind": PERSON, "family": "Kochdienste", "note": "Kochdienst in diesem Zeitraum."},
    "KP3 19:00 - 21:15": {"kind": PERSON, "family": "Kochdienste", "note": "Kochdienst in diesem Zeitraum."},
    "10:30 Softsport": {
        "kind": PERSON, "family": "Sportprogramm", "cell_format": "activity | MA",
        "note": "Zeigt erst die Softsport-Art, nach dem Trennbalken den zugeteilten MA.",
    },
    "11:00 BVB": {
        "kind": PERSON, "family": "Sportprogramm",
        "note": "MA der Volleyball (BVB) hat.",
    },
    "15:30 Softsport": {
        "kind": PERSON, "family": "Sportprogramm", "cell_format": "activity | MA",
        "note": "Zeigt erst die Softsport-Art, nach dem Trennbalken den zugeteilten MA.",
    },
    "15:30 BVB": {"kind": PERSON, "family": "Sportprogramm", "note": "MA der Volleyball (BVB) hat."},
    "16:00 JeKaMi": {"kind": PERSON, "family": "Sportprogramm", "note": "MA der JeKaMi hat."},
    "17:00 Fußball": {"kind": PERSON, "family": "Sportprogramm", "note": "MA der Fußball hat."},
    "17:00 Fußball-Tennis": {"kind": PERSON, "family": "Sportprogramm", "note": "MA der Fußball-Tennis hat."},
    "TT & Kicker wischen": {
        "kind": PERSON,
        "note": "MA der die Tischtennisplatten und den Kicker wischen soll.",
    },
    "15:50 Süße Momente": {
        "kind": PERSON,
        "note": "Zeitbasierter Dienst (wie ein Kochdienst) - MA der diesen Dienst hat.",
    },
    "An/Abreise-Dienst": {
        "kind": PERSON,
        "note": "Zelle: erst Uhrzeit des Dienstes, danach der zugeteilte MA.",
    },
    "18 Uhr LEDs": {
        "kind": DEPARTMENT,
        "note": "Welche Abteilung die Akku-LEDs um 18 Uhr verteilt.",
    },
    "Aufbau": {
        "kind": CONTENT,
        "note": "Zeigt erst Uhrzeit, dann Ort/was aufgebaut wird - keine feste MA-Rotation "
                "(auch wenn in Altdaten gelegentlich Namen/Abteilungen auftauchen).",
    },
    "Abbau": {
        "kind": CONTENT,
        "note": "Zeigt erst Uhrzeit, dann Ort/was abgebaut wird - keine feste MA-Rotation.",
    },
    "Reminders": {
        "kind": CONTENT,
        "note": "Info-Zeile mit Reminders.",
    },
    "Nachmittag/Abend Extras": {
        "kind": CONTENT,
        "note": "Info-Zeile mit Besonderheiten am Nachmittag/Abend.",
    },
    "18:00 Saunaaufguss": {
        "kind": PERSON,
        "note": "MA der um 18 Uhr Saunaaufguss hat.",
    },
    "00:30-03:00 NITE CLUB": {
        "kind": CONTENT,
        "note": "Welcher DJ im Nite Club auflegt.",
    },
    "MOD": {
        "kind": MANUAL,
        "note": "Manager on Duty: Name + Abteilung. Bei Namensgleichheit (z.B. zwei MA namens "
                "Marco) aus dem Text allein nicht zuverlässig automatisch auflösbar - manuell pflegen.",
    },
}

# Horizontale Obergruppen aus den verbundenen A:H-Zeilen der echten Excel-Grundvorlagen.
# `detail_label` bildet die kleine Folgezeile unter eigenständigen Infoblöcken ab
# (z.B. Aufbau -> WANN/WO oder MOD -> WER).
LAYOUT_GROUPS: list[dict] = [
    {
        "label": "Meetings",
        "categories": ["Meeting", "OPS / WP"],
        "color": "#FF0000",
    },
    {
        "label": "Abend-Entertainment",
        "categories": [
            "Show/Party",
            "Kleidermotto Tag",
            "Kleidermotto Abend",
            "Moderation + Getränkedienst",
            "Ausschlafen",
            "Barfrei",
        ],
        "color": "#95CA82",
    },
    {
        "label": "Tages-Entertainment",
        "categories": ["Mittagsgrill", "ChillOut Künstler", "Aperitif"],
        "color": "#C67EBD",
    },
    {
        "label": "Kochdienste",
        "categories": ["Kochdienste"],
        "color": "#FFFF00",
    },
    {
        "label": "Sportprogramm",
        "categories": ["Sportprogramm"],
        "color": "#00B0F0",
    },
    {
        "label": "Extradienste",
        "categories": [
            "TT & Kicker wischen",
            "15:50 Süße Momente",
            "An/Abreise-Dienst",
            "18 Uhr LEDs",
        ],
        "color": "#FFC000",
    },
    {
        "label": "Aufbau",
        "categories": ["Aufbau"],
        "detail_label": "WANN/WO",
        "color": "#F2AA84",
    },
    {
        "label": "Abbau",
        "categories": ["Abbau"],
        "detail_label": "WANN/WO",
        "color": "#E97132",
    },
    {
        "label": "Reminders",
        "categories": ["Reminders"],
        "detail_label": "WER/WANN/WO",
        "color": "#323232",
    },
    {
        "label": "Nachmittag/Abend Extras",
        "categories": ["Nachmittag/Abend Extras"],
        "detail_label": "WER/WANN/WO",
        "color": "#C9C9C9",
    },
    {
        "label": "18:00 Saunaaufguss",
        "categories": ["18:00 Saunaaufguss"],
        "detail_label": "WER",
        "color": "#A3DBBC",
    },
    {
        "label": "00:30-03:00 NITE CLUB",
        "categories": ["00:30-03:00 NITE CLUB"],
        "detail_label": "WER",
        "color": "#D169F1",
    },
    {
        "label": "MOD",
        "categories": ["MOD"],
        "detail_label": "WER",
        "color": "#555555",
    },
]

# Fairness-Regeln, die das Dashboard aktiv prüft (siehe stats.fairness_alerts).
FAIRNESS_RULES = [
    {
        "id": "barfrei_ausschlafen",
        "categories": ["Barfrei", "Ausschlafen"],
        "min_per_week": 1,
        "max_per_week": 1,
        "description": (
            "Jeder aktive MA bekommt genau 1x Barfrei oder Ausschlafen pro Woche; "
            "Manu und Brigitte sind wegen ihres 8-Stunden-Vertrags ausgenommen."
        ),
    },
    {
        "id": "frei_quota",
        "is_absence": True,
        "absence_type": "Frei",
        "min_per_week": 2,
        "description": "Jeder aktive MA soll 2x Frei pro Woche haben.",
    },
]


def content_labels() -> set[str]:
    return {name for name, spec in ROWS.items() if spec["kind"] == CONTENT}


def department_labels() -> set[str]:
    return {name for name, spec in ROWS.items() if spec["kind"] == DEPARTMENT}


# AP9 - zentrale Quelle für Abteilungs-/Nicht-Personen-Kurzcodes, die in Plan-Zellen
# anstelle eines Personennamens stehen können (z.B. "WASPO" oder "-" statt "Tobi").
# Nicht zu verwechseln mit department_labels() oben: das sind die fachlichen
# Zeilen-/Kategorienamen der Vorlage (z.B. "Abbauhilfe"), DEPARTMENT_TOKENS hier sind die
# kurzen Zellwerte, die api.py, grid.py und xlsx_template.py bis AP9 je in einer eigenen,
# wertgleichen Kopie pflegten (KNOWN_DEPARTMENT_TOKENS / NON_PERSON_ASSIGNMENT_VALUES /
# DEPARTMENT_TOKENS) - eine einzige Quelle verhindert künftigen Drift zwischen ihnen.
DEPARTMENT_TOKENS: frozenset[str] = frozenset({
    "S&L", "SPT", "NM", "KÜCHE", "COCINA", "TC", "DEKO", "LIVE-ENT",
    "SPORTSTAINER", "MANAGER", "REQUI", "WASPO", "FO", "WFA", "SPA",
})

# "Keine Zuweisung"-Marker in einer Person-Zelle (z.B. eine leere Schicht, explizit als
# "-"/"keine" eingetragen) - fachlich etwas anderes als ein Abteilungs-Kurzcode, wird aber
# an denselben Stellen wie DEPARTMENT_TOKENS als "keine Einzelperson" behandelt (bisher nur
# in grid.py, dort Teil von NON_PERSON_ASSIGNMENT_VALUES).
SPECIAL_ASSIGNMENT_TOKENS: frozenset[str] = frozenset({"-", "KEINE", "KEIN", "NIEMAND"})

# Kombinierte Menge für Parser, die beide Fälle gleich behandeln (bisher grid.py:
# NON_PERSON_ASSIGNMENT_VALUES).
NON_PERSON_ASSIGNMENT_TOKENS: frozenset[str] = DEPARTMENT_TOKENS | SPECIAL_ASSIGNMENT_TOKENS


def person_categories() -> list[str]:
    """Reihenfolge wie in der echten Vorlage - Basis für grid.CATEGORY_ORDER."""
    return [name for name, spec in ROWS.items() if spec["kind"] in (PERSON, MANUAL)]


def non_person_categories() -> set[str]:
    """Alles, was nicht in die Fairness-Rotation zählt (department/content/manual)."""
    return {name for name, spec in ROWS.items() if spec["kind"] != PERSON}


def relief_reward_categories() -> set[str]:
    """Entlastungen, die einer Person zugeteilt werden, aber keine Arbeitsdienste sind."""
    return {name for name, spec in ROWS.items() if spec.get("relief_reward")}
