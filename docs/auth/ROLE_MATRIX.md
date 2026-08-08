# API-Berechtigungsmatrix

Vollständige Liste **aller** FastAPI-Endpunkte mit ihrer Einstufung. Keine
Beispiele, keine Auslassungen - was hier nicht steht, existiert nicht.

Die Tabelle wird durch zwei Tests gegen die laufende Anwendung abgesichert
(`backend/tests/test_auth_endpoint_matrix.py`): einer vergleicht die
Klassifikationen mit dem tatsächlichen Dependency-Baum, einer stellt sicher,
dass kein Endpunkt ohne bewusste Einstufung dazukommt. Ein neuer Endpunkt
lässt die Testsuite rot werden, bis er hier und dort eingetragen ist.

## Stufen

| Stufe | Bedeutung |
| --- | --- |
| `PUBLIC` | Ohne Anmeldung erreichbar. |
| `AUTHENTICATED` | Jede gültige, aktive Anmeldung - unabhängig von der Rolle. |
| `EMPLOYEE` | Mitarbeitende und höher. |
| `PLANNER` | Planende und Administration. |
| `ADMIN` | Nur Administration. |

Die Rollen sind streng hierarchisch: **ADMIN > PLANNER > EMPLOYEE**. Ein
Admin erfüllt jede Employee-Anforderung, ein Planner jede Employee-, aber
keine Admin-Anforderung.

## Grundsätze dieser Einstufung

1. **Nicht nach HTTP-Methode.** `GET` heisst nicht "harmlos".
   `GET /api/dashboard/person-totals` liefert die Einsatzzahlen aller
   Mitarbeitenden, `GET /api/system/diagnostics` den Zustand des Servers -
   beides sind keine Employee-Daten, obwohl nur gelesen wird.
2. **So wenig wie nötig.** Employee bekommt in diesem Sprint genau die vier
   Leseendpunkte, die das kommende Employee-Portal braucht - nicht alles,
   was zufällig read-only ist.
3. **Schreiben ab PLANNER.** Kein `POST`/`PUT`/`PATCH`/`DELETE` steht
   unterhalb von PLANNER (per Test abgesichert).
4. **Konten und System nur ADMIN.**

## Vollständige Matrix

| Route | Methode | Funktion | Daten | Rolle |
| --- | --- | --- | --- | --- |
| `/api/health` | GET | Liveness-/Readiness-Prüfung | Booleans zu DB, Vorlagen, Schreibrechten; projektrelativer DB-Pfad | **PUBLIC** |
| `/api/auth/me` | GET | Eigenes Profil (Rolle, Person) | user_id, role, person_id, person_name, email des Aufrufers | **AUTHENTICATED** |
| `/api/artist-plans` | GET | Künstlerpläne auflisten | Zeitraum, Quelldatei, Anzahl gefüllter Felder | **EMPLOYEE** |
| `/api/artist-plans/{artist_plan_id}` | GET | Künstlerplan lesen | Inhalte des Künstlerplans einer Woche | **EMPLOYEE** |
| `/api/rehearsal-plans` | GET | Probenpläne auflisten | Zeitraum, Quelldatei, Anzahl Proben | **EMPLOYEE** |
| `/api/rehearsal-plans/{rehearsal_plan_id}` | GET | Probenplan lesen | Proben mit Zeit, Ort, Beteiligten | **EMPLOYEE** |
| `/api/weeks` | GET | Archiv der Dienstplanwochen | Alle Wochen mit Anzahl Zuweisungen/Abwesenheiten | **PLANNER** |
| `/api/weeks/{week_id}` | GET | Dienstplanwoche lesen | Vollständiger Wochenplan aller Mitarbeitenden | **PLANNER** |
| `/api/weeks/{week_id}` | DELETE | Dienstplanwoche löschen | Entfernt Woche samt Zuweisungen und Abwesenheiten | **PLANNER** |
| `/api/plan/templates` | GET | Wochenvorlagen auflisten | Vorlagencodes (Woche A/B) | **PLANNER** |
| `/api/plan/existing` | GET | Gespeicherten Plan zum Bearbeiten laden | Vollständiges Planungsraster inkl. Warnungen | **PLANNER** |
| `/api/plan/free-suggestion` | POST | Vorschlag für freie Tage | Abwesenheits- und Mustervorschläge je Person | **PLANNER** |
| `/api/plan/generate` | POST | Dienstplan erzeugen | Erzeugtes Planungsraster | **PLANNER** |
| `/api/plan/save` | POST | Dienstplan speichern | Schreibt Zuweisungen, Abwesenheiten, Audit-Einträge | **PLANNER** |
| `/api/xlsx/generate` | POST | Dienstplan als Excel exportieren | Excel-Datei aus der Programmvorlage | **PLANNER** |
| `/api/planning-rules` | GET | Aktive Planungsregeln | Regelbeschreibungen der Planungslogik | **PLANNER** |
| `/api/team` | GET | Team auflisten | Alle Personen inkl. Abteilung und Einsatzsumme | **PLANNER** |
| `/api/team` | POST | Person anlegen | Neue Person im Planungsumfang | **PLANNER** |
| `/api/team/{person_id}` | PUT | Person bearbeiten | Name, Abteilung, aktiv/inaktiv | **PLANNER** |
| `/api/team/{person_id}` | DELETE | Person aus dem Pool nehmen | Soft-Delete (`active=0, deleted=1`), historische Pläne bleiben | **PLANNER** |
| `/api/people/active` | GET | Aktive Personen (Namen) | Namensliste für die Planungsmasken | **PLANNER** |
| `/api/dashboard/overview` | GET | Kennzahlen-Übersicht | Aggregierte Zahlen über alle Wochen | **PLANNER** |
| `/api/dashboard/person-totals` | GET | Einsätze je Person | Einsatzsummen aller Mitarbeitenden | **PLANNER** |
| `/api/dashboard/category-matrix` | GET | Person × Kategorie | Verteilung der Dienstarten je Person | **PLANNER** |
| `/api/dashboard/department-activity` | GET | Abteilungsauslastung | Aggregation je Abteilung | **PLANNER** |
| `/api/dashboard/fairness-alerts` | GET | Fairness-Warnungen | Auffällige Über-/Unterlastung einzelner Personen | **PLANNER** |
| `/api/dashboard/insights` | GET | Wochenauswertung | Auslastung, Show-Tage, Bereitschaftsstand | **PLANNER** |
| `/api/memory` | GET | MA-Gedächtnis (alle) | Abgeleitete Einschätzungen zu allen Personen | **PLANNER** |
| `/api/memory/{person_id}` | GET | MA-Gedächtnis (eine Person) | Shows, freie Tage, Aufgabenaffinitäten | **PLANNER** |
| `/api/memory/{person_id}/show/{show_key}` | PUT | Show-Zuordnung korrigieren | Manueller Override im Gedächtnis | **PLANNER** |
| `/api/memory/{person_id}/free` | PUT | Freie Tage festpinnen | Manueller Override im Gedächtnis | **PLANNER** |
| `/api/memory/{person_id}/task` | PUT | Aufgabenaffinität korrigieren | Manueller Override im Gedächtnis | **PLANNER** |
| `/api/intelligence/employees` | GET | Mitarbeiterübersicht | Profile, Skills, Statistiken aller Personen | **PLANNER** |
| `/api/intelligence/employees/{person_id}` | GET | Mitarbeiterprofil | Skills, Historie, abgeleitete Merkmale | **PLANNER** |
| `/api/intelligence/employees/{person_id}/skills` | PUT | Fähigkeit setzen | Schreibt `employee_skills` | **PLANNER** |
| `/api/intelligence/employees/{person_id}/skills/{skill_id}` | DELETE | Fähigkeit entfernen | Löscht einen Skill-Eintrag | **PLANNER** |
| `/api/intelligence/employees/{person_id}/memory` | POST | Gedächtniseintrag anlegen | Schreibt `employee_memory` | **PLANNER** |
| `/api/intelligence/employees/{person_id}/memory/{entry_id}` | DELETE | Gedächtniseintrag löschen | Löscht einen Eintrag | **PLANNER** |
| `/api/intelligence/recommendations` | POST | Besetzungsempfehlungen | Bewertete Personenvorschläge je Zelle | **PLANNER** |
| `/api/intelligence/plan-quality` | POST | Planqualität bewerten | Qualitätsbewertung eines Planentwurfs | **PLANNER** |
| `/api/intelligence/audit` | GET | Änderungsprotokoll der Planung | Wer hat wann welche Planzelle geändert | **PLANNER** |
| `/api/upload/pdf` | POST | Dienstplan-PDF auslesen | Extrahierter Planentwurf (Gemini/Fallback) | **PLANNER** |
| `/api/upload/xlsx/sheets` | POST | Excel-Blätter auflisten | Blattnamen der hochgeladenen Datei | **PLANNER** |
| `/api/upload/xlsx` | POST | Dienstplan-Excel auslesen | Extrahierter Planentwurf | **PLANNER** |
| `/api/known-department-tokens` | GET | Bekannte Abteilungskürzel | Statische Tokenliste für den Import | **PLANNER** |
| `/api/import/save` | POST | Import übernehmen | Schreibt Woche, Zuweisungen, Abwesenheiten, Aliasse | **PLANNER** |
| `/api/artist-plans/upload/sheets` | POST | Künstlerplan-Blätter auflisten | Blattnamen der hochgeladenen Datei | **PLANNER** |
| `/api/artist-plans/import` | POST | Künstlerplan einlesen | Extrahierter Künstlerplan | **PLANNER** |
| `/api/artist-plans/empty` | GET | Leeres Künstlerplan-Raster | Vorlage für eine neue Woche | **PLANNER** |
| `/api/artist-plans` | POST | Künstlerplan speichern | Schreibt Künstlerplan und Einträge | **PLANNER** |
| `/api/artist-plans/{artist_plan_id}` | DELETE | Künstlerplan löschen | Entfernt Plan samt Einträgen | **PLANNER** |
| `/api/artist-plans/{artist_plan_id}/export` | GET | Künstlerplan als Excel | Excel-Datei aus der Programmvorlage | **PLANNER** |
| `/api/rehearsal-plans/upload/sheets` | POST | Probenplan-Blätter auflisten | Blattnamen der hochgeladenen Datei | **PLANNER** |
| `/api/rehearsal-plans/import` | POST | Probenplan einlesen | Extrahierter Probenplan | **PLANNER** |
| `/api/rehearsal-plans` | POST | Probenplan speichern | Schreibt Probenplan, Proben, Beteiligte | **PLANNER** |
| `/api/rehearsal-plans/{rehearsal_plan_id}` | DELETE | Probenplan löschen | Entfernt Plan samt Proben | **PLANNER** |
| `/api/system/diagnostics` | GET | Systemdiagnose | Verzeichnisse, Schreibrechte, CORS-Origins, Host/Port, Speicher | **ADMIN** |
| `/api/system/restart` | POST | Backend neu starten | Prozessneustart (zusätzlich durch `SYSTEM_RESTART_ENABLED` begrenzt) | **ADMIN** |
| `/api/settings/{key}` | GET | Einstellung lesen | Beliebiger Schlüssel aus `settings`, u.a. Vorlagenpfade | **ADMIN** |
| `/api/settings/{key}` | PUT | Einstellung schreiben | Beliebiger Schlüssel aus `settings` | **ADMIN** |
| `/api/admin/app-users` | GET | Konten auflisten | Alle Zuordnungen Auth-Benutzer → Rolle/Person | **ADMIN** |
| `/api/admin/app-users` | POST | Konto freischalten | Legt eine Zuordnung an | **ADMIN** |
| `/api/admin/app-users/{user_id}` | PATCH | Rolle/Status/Person ändern | Ändert eine Zuordnung | **ADMIN** |
| `/api/admin/app-users/{user_id}` | DELETE | Zuordnung entfernen | Entfernt nur die Planner-Zuordnung, nicht das Supabase-Konto | **ADMIN** |

## Begründungen für die Grenzfälle

Diese Einstufungen sind bewusst getroffen worden und nicht aus der
HTTP-Methode abgeleitet:

- **`DELETE /api/team/{person_id}` ist PLANNER, nicht ADMIN.** Der Endpunkt
  löscht nichts, sondern setzt `active=0, deleted=1`; historische Pläne
  bleiben vollständig erhalten. Das Verwalten des Planungsumfangs ist laut
  Rollenmodell ausdrücklich Planner-Aufgabe. Konten werden davon nicht
  berührt - die verwaltet ausschliesslich `/api/admin/app-users`.
- **`/api/settings/{key}` ist ADMIN, auch lesend.** Es ist ein generischer
  Schlüssel/Wert-Speicher: der Aufrufer bestimmt den Schlüssel, nicht der
  Server. Ein "nur harmlose Schlüssel"-Leserecht gibt es technisch nicht.
  Einziger Aufrufer im Frontend ist die Systemseite, die ohnehin ADMIN ist.
- **`/api/dashboard/*`, `/api/memory/*` und `/api/intelligence/*` sind
  PLANNER, obwohl grösstenteils lesend.** Sie liefern Einschätzungen und
  Kennzahlen *über andere Mitarbeitende*. Für eine Employee-Ansicht ist das
  zu viel, unabhängig davon, dass nichts geschrieben wird.
- **`GET /api/artist-plans/{id}/export` ist PLANNER, obwohl `GET`.** Der
  Endpunkt erzeugt eine Datei aus der Programmvorlage; das ist eine
  Planungsausgabe, kein Lesezugriff.
- **`/api/health` ist als einziger Endpunkt PUBLIC.** Render und Vercel
  fragen ihn ohne Anmeldung ab; ein 401 würde als "Dienst kaputt" gewertet
  und einen Neustart-Loop auslösen. Die Antwort enthält nur Booleans und
  einen projektrelativen Pfad - keine Secrets, keine Hostnamen, keine
  Stacktraces.
- **`/api/weeks` und `/api/plan/existing` bleiben PLANNER**, obwohl ein
  Mitarbeiter "seinen" Dienstplan sehen soll. Diese Endpunkte liefern den
  vollständigen Plan aller Personen. Die Employee-Sicht bekommt im
  Employee-Portal-Sprint eigene, auf `person_id` gefilterte Endpunkte.

## Frontend-Routen

Ergänzend zur API - die Oberfläche folgt derselben Einteilung
(`frontend/lib/auth/route-access.ts`). **Das ist Benutzerführung, keine
Sicherheitsgrenze**: jede dieser Seiten holt ihre Daten über die oben
aufgeführten Endpunkte, und die prüfen unabhängig.

| Pfad | Rolle | Verhalten bei zu geringer Rolle |
| --- | --- | --- |
| `/login` | öffentlich | Angemeldete werden auf ihre Startseite geleitet |
| `/employee`, `/employee/...` | EMPLOYEE | - |
| `/dashboard`, `/plan-editor`, `/artist-plan`, `/rehearsal-plan`, `/team`, `/gedaechtnis`, `/planning-logic`, `/archiv` | PLANNER | Employee → `/employee` |
| `/system` | ADMIN | Planner → `/dashboard`, Employee → `/employee` |
| unbekannte Pfade | PLANNER (fail-closed) | Employee → `/employee` |
| `/control/backend/status`, `/control/backend/restart` (Next.js-Route-Handler) | ADMIN | 401 ohne Anmeldung, 403 ohne Rolle |
