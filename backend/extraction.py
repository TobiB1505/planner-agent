"""Extracts structured Dienstplan-Daten aus einem PDF via Google Gemini."""
from __future__ import annotations

import os
from typing import Optional

from google import genai
from google.genai import types
from pydantic import BaseModel

from . import template_spec

MODEL = "gemini-flash-latest"


def _build_system_prompt() -> str:
    excluded = sorted(template_spec.content_labels())
    departments = sorted(template_spec.department_labels())
    excluded_list = ", ".join(f'"{name}"' for name in excluded)
    department_list = ", ".join(f'"{name}"' for name in departments)

    return f"""Du liest wöchentliche Entertainment-Dienstpläne eines Hotel-Teams aus PDFs.

Layout des Dokuments: Wochentage (Montag-Sonntag) stehen als Spalten, Aufgaben-Kategorien
(z.B. Urlaub/Krank, Frei, Tagesverantwortung, Meeting, OPS/WP, Show/Party, Moderation+Getränkedienst,
Ausschlafen, Kochdienste KP1/KP2/KP3, Sportprogramm-Einträge, Barfrei, Aperitif, Extradienste, MOD, ...)
stehen als Zeilen. Zellen enthalten oft mehrere durch Komma getrennte Namen, teils mit Uhrzeit
oder kurzer Zusatzinfo. Die genaue Bedeutung jeder Zeile ist in template_spec.py dokumentiert
(vom Team-Leiter selbst erklärt) - die folgenden Regeln sind daraus abgeleitet.

Extrahiere zwei Arten von Einträgen:

1. ABSENCES (nur aus Zeilen "Urlaub/Krank" bzw. "Frei"): eine Zeile pro Person pro Tag.
   type-Feld: "Urlaub", "Krank", "Frei" wenn eindeutig erkennbar, sonst wörtlich den Zeilennamen
   übernehmen (z.B. "Urlaub/Krank" wenn nicht unterscheidbar).

2. ASSIGNMENTS: alle übrigen Zeilen, die eine oder mehrere Personen einer konkreten Aufgabe an
   einem Tag zuordnen. Eine Zeile im Output pro Person (Zellen mit mehreren Namen aufsplitten).
   - category = der Zeilenname aus dem Dokument (z.B. "Moderation + Getränkedienst", "Kochdienste",
     "Sportprogramm").
   - subcategory = zusätzliche Info aus der Zelle, die keine Person ist: Uhrzeit, Sub-Slot
     (z.B. "KP1 7:50-10:00", "11:00 OPS", "10:30 Boccia"). Null wenn nichts davon vorhanden.
   - raw_text = die ursprüngliche Zellen-Formulierung zur Nachvollziehbarkeit.

Wichtige Regeln:
- Personennamen: entferne Klammerzusätze wie "(GT)", "(LIVE)" aus dem person-Feld (das sind
  Anmerkungen, keine Namensbestandteile) - falls relevant, in raw_text belassen.
- Folgende Kategorien/Zeilen komplett überspringen (keine assignments daraus erzeugen), auch wenn
  sie Personennamen/Text enthalten - das sind externe Künstler/DJ-Bookings, Kleidermotto, oder reine
  Info-/Notiz-Zeilen ohne feste Team-Rotation: {excluded_list}.
- Zeile "Aperitif": die Zelle enthält typischerweise 4 Teile gestapelt - Ort, Uhrzeit, externer
  Künstlername (oft mit "(LIVE)"-Zusatz), und danach den zuständigen internen Dienst/Abteilung
  (z.B. "S&L") oder ein konkretes Teammitglied. Überspringe Ort/Uhrzeit/Künstlername komplett,
  extrahiere NUR das, was danach als Dienst/Abteilung oder Person steht, als "person" für
  category="Aperitif".
- Die Zeilen {department_list} zeigen keinen Personennamen, sondern eine zuständige Abteilung
  (z.B. "S&L", "TC", "Deko") als Zellwert - trotzdem normal als "person"-Wert ausgeben
  (z.B. person="S&L"), das Tool erkennt Abteilungs-Kürzel selbst und behandelt sie separat, nicht
  als Einzelperson. Dasselbe gilt, wenn Abteilungs-Kürzel wie "S&L"/"SPT" in anderen Zeilen auftauchen
  (z.B. Kochdienste, Extradienste, An/Abreise-Dienst).
- Wenn eine Zelle leer ist oder "-" enthält, erzeuge keinen Eintrag.
- Datum immer als YYYY-MM-DD.
- Wenn nicht zweifelsfrei erkennbar, ob etwas ein Duty-Assignment ist: lieber trotzdem extrahieren
  (mit passendem raw_text) - ein Mensch prüft die Extraktion danach und korrigiert bei Bedarf."""


SYSTEM_PROMPT = _build_system_prompt()


class AssignmentItem(BaseModel):
    date: str
    category: str
    subcategory: Optional[str] = None
    person: str
    raw_text: Optional[str] = None


class AbsenceItem(BaseModel):
    date: str
    person: str
    type: str


class DienstplanExtraction(BaseModel):
    kw: Optional[int] = None
    start_date: str
    end_date: str
    assignments: list[AssignmentItem]
    absences: list[AbsenceItem]


def extract_dienstplan(pdf_bytes: bytes, api_key: str | None = None) -> dict:
    client = genai.Client(api_key=api_key or os.environ.get("GEMINI_API_KEY"))

    response = client.models.generate_content(
        model=MODEL,
        contents=[
            types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
            "Extrahiere diesen Dienstplan gemäß den Anweisungen.",
        ],
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_schema=DienstplanExtraction,
        ),
    )

    result: DienstplanExtraction = response.parsed
    if result is None:
        raise RuntimeError("Gemini hat keine gültige strukturierte Antwort zurückgegeben.")
    return result.model_dump()
