# AP7 — Blockierende Upload- und Import-Endpunkte aus dem FastAPI-Event-Loop lösen

Arbeitspaket aus dem Refactoring-Plan: mehrere `async def`-Endpunkte riefen
direkt synchrone, potenziell lang laufende Arbeit auf (Gemini-Netzwerkcalls,
PyMuPDF-Parsing, openpyxl-Ladevorgänge) und blockierten damit den
FastAPI-/Starlette-Event-Loop für die Dauer des Imports — inklusive aller
parallelen Requests (`/api/health`, Sidebar-Status, Plan-Lesezugriffe).
Baut auf AP3–AP6 auf und verändert weder API-Verträge noch Importlogik,
Gemini-Prompts oder das SQLite-Schema.

Alle Messungen/Tests liefen ausschließlich gegen Kopien der Live-Datenbank
oder temporäre `tmp_path`-Testdatenbanken — nie auf der echten Datei. Externe
Dienste (Gemini) wurden in allen Tests gemockt, es wurden keine echten oder
kostenpflichtigen Netzwerkaufrufe ausgeführt.

---

## Vorher

### Betroffene Endpunkte (Schritt 1, vollständige Matrix)

| Route | Funktion | `async def`? | Blocking-Arbeit | Kategorie |
|---|---|---|---|---|
| `POST /api/upload/pdf` | `upload_pdf` | ja | `extract_dienstplan` → `genai.Client().generate_content` | 4 (Netzwerk) |
| `POST /api/upload/xlsx/sheets` | `upload_xlsx_sheets` | ja | `xlsx_template.list_week_sheets` → openpyxl | 3 (Datei/CPU) |
| `POST /api/upload/xlsx` | `upload_xlsx` | ja | `xlsx_template.extract_from_xlsx` → openpyxl | 3 |
| `POST /api/artist-plans/upload/sheets` | `artist_plan_upload_sheets` | ja | `artist_plan.list_sheets` → openpyxl | 3 |
| `POST /api/artist-plans/import` | `artist_plan_import` | ja | `artist_plan.extract_artist_plan` → openpyxl | 3 |
| `POST /api/rehearsal-plans/upload/sheets` | `rehearsal_plan_sheets` | ja | `rehearsal_plan.list_sheets` → openpyxl | 3 |
| `POST /api/rehearsal-plans/import` | `rehearsal_plan_import` | ja | `rehearsal_plan.extract_xlsx`/`extract_pdf_with_gemini` (fitz+Gemini)/`extract_pdf` (fitz) + DB-Read via `Depends` | 3+4+5 |

Repository-weite Suche (`async def`, `UploadFile`, `openpyxl`, `fitz`,
Gemini-Client-Aufrufe, `time.sleep`, synchrone HTTP-Clients) bestätigte: dies
sind **alle** `async def`-Routen im Projekt (neben `lifespan`, kein Endpunkt).
Alle sieben riefen in ihrem Rumpf ausschließlich `await file.read()` als
Async-Operation auf — keine weiteren zwingend asynchronen Schritte.

### Bisherige Ausführung im Event-Loop

Jeder der sieben Endpunkte lief als `async def` direkt im Event-Loop-Thread.
`extract_dienstplan`/`extract_pdf_with_gemini` erstellen dabei jeweils einen
neuen `genai.Client()` und führen einen synchronen, blockierenden
`generate_content(...)`-Call aus; openpyxl/`fitz.open(...)` blockieren beim
Parsen entsprechend der Dateigröße.

### Zusätzlich gefundene Ressourcenlecks (nicht AP7-verursacht, aber im Scope von Ziel 5)

- `xlsx_template.extract_from_xlsx`: Workbook wurde nie geschlossen.
- `artist_plan.list_sheets`, `artist_plan.extract_artist_plan`: Workbook wurde nie geschlossen.
- `xlsx_template.list_week_sheets`: `wb.close()` stand außerhalb von `try/finally` (Leak bei Exception).
- `rehearsal_plan.extract_pdf`: `document.close()` stand außerhalb von `try/finally`.
- `rehearsal_plan.extract_pdf_with_gemini`: `document.close()` unmittelbar nach `_pdf_year(document)`, aber ohne `try/finally` (Leak, falls `_pdf_year` selbst wirft).

### Responsivitätsmessung (Baseline, `git stash` auf Vorher-Codestand)

Künstlich verlangsamter Import (0.4s synchrones `time.sleep`, gemockter
Gemini-/Parser-Aufruf), paralleler `GET /api/health` währenddessen, 5
Wiederholungen je Szenario:

| Szenario | Health-Latenz (Median) | Import-Dauer (Median) |
|---|---:|---:|
| Health während PDF-Import | **356.6 ms** | 407.9 ms |
| Health während XLSX-Import | **365.7 ms** | 415.5 ms |

`/api/health` war praktisch komplett hinter dem Import blockiert — der
Event-Loop konnte den Health-Request erst bearbeiten, nachdem der
Import-Request abgeschlossen war.

### Test-Baseline

`pytest`: 99 passed (Stand nach AP6) · `npm run build`/`npm run lint`: grün.

---

## Umsetzung

### Strategie pro Route

Für alle sieben Endpunkte: **Option A** — Umstellung von `async def` auf
`def`. Begründung: keiner der Endpunkte enthält einen zwingend asynchronen
Schritt außer `await file.read()`; FastAPI führt normale `def`-Path-Operationen
automatisch im Threadpool aus (dasselbe, bereits in AP4–AP6 etablierte Muster
wie bei `plan_save`, `plan_existing`, `plan_generate`). Eine gezielte
`asyncio.to_thread`/`run_in_threadpool`-Auslagerung einzelner Abschnitte war
nicht nötig, da die Endpunkte ohnehin vollständig synchron sind.

### Upload-Datei-Behandlung

`await file.read()` → `file.file.read()` (Schritt 3, wie im Aufgaben-Beispiel
für Option A vorgesehen). `file.file` ist Starlettes `SpooledTemporaryFile` -
ein synchroner, dateiähnlicher Stream; der Lesevorgang liefert denselben
vollständigen Byte-Inhalt wie zuvor `await file.read()` (erster Read auf dem
Stream, keine doppelte Kopie, keine Race Condition, da das UploadFile-Objekt
ausschließlich innerhalb des einen Worker-Threads verwendet wird, der die
gesamte Endpunkt-Funktion ausführt).

### Gemini-Verarbeitung

`extract_dienstplan` (PDF-Import) und `rehearsal_plan.extract_pdf_with_gemini`
(Probenplan-Import) bleiben unverändert — Prompt, Modell, Response-Schema,
Retry-/Fallback-Verhalten (`rehearsal_plan_import`s Try/Except mit lokalem
Fallback bei Gemini-Fehler) sind exakt erhalten. Da der komplette Endpunkt
jetzt im Threadpool läuft, läuft der synchrone Gemini-Call automatisch
mit — keine gezielte `to_thread`-Auslagerung nötig, keine neue
Parallelisierung mehrerer Gemini-Aufrufe, kein neuer Cache.

### PyMuPDF-/openpyxl-Verarbeitung

Läuft jetzt ebenfalls automatisch im Threadpool (Teil des `def`-Endpunkts).
Zusätzlich wurden die in „Vorher" gelisteten Ressourcenlecks behoben — alle
Workbook-/Dokument-Objekte werden jetzt in `try/finally` geöffnet und
garantiert geschlossen, auch wenn das Parsing eine Exception wirft:
- `xlsx_template.extract_from_xlsx`, `xlsx_template.list_week_sheets`
- `artist_plan.list_sheets`, `artist_plan.extract_artist_plan`
- `rehearsal_plan.extract_pdf`, `rehearsal_plan.extract_pdf_with_gemini`

Parsing-Ergebnisse, Fehlerbehandlung und Optionen (`data_only`, `read_only`)
sind dabei unverändert — es wurde ausschließlich die Ressourcenbereinigung
ergänzt, keine Parser-Logik geändert.

### Connection- und Thread-Grenzen

Nur `rehearsal_plan_import` nutzt `Depends(db.get_db_connection)`.
`db.get_db_connection` ist ein einfacher synchroner Generator (AP4). Bei
einer `def`-Route führt FastAPI Dependency-Auflösung und Endpunkt-Body als
**eine Einheit** im selben Threadpool-Worker aus — identisch zum bereits
etablierten Muster von `plan_save`/`plan_existing`/`plan_generate`. Die
Connection wird also nie zwischen Threads geteilt, `check_same_thread` wurde
nicht angefasst.

### Ressourcenfreigabe

Siehe „PyMuPDF-/openpyxl-Verarbeitung" oben. Die Upload-Datei selbst wird wie
zuvor vom FastAPI-/Starlette-Request-Lifecycle geschlossen — unverändert
gegenüber dem Async-Pfad, da dieses Verhalten framework-seitig ist und nicht
von `async def` vs. `def` abhängt.

### Thread-Sicherheit (Schritt 11)

Untersucht: `genai.Client` (in `extraction.py` und `rehearsal_plan.py` jeweils
**pro Aufruf neu erstellt**, keine geteilte Instanz), openpyxl/`fitz`-Objekte
(pro Aufruf neu erstellt, nie modulweit gehalten), alle Modulkonstanten in
`extraction.py`, `rehearsal_plan.py`, `artist_plan.py`, `xlsx_template.py`
(ausschließlich unveränderliche Strings/Sets/Listen, zur Importzeit einmalig
gebaut, nie zur Laufzeit mutiert). **Kein gemeinsamer veränderlicher globaler
Zustand gefunden** — kein Lock eingeführt.

---

## Nachher

### Responsivitätsmessung (identisches Szenario, AP7-Codestand, 5 Wiederholungen)

| Szenario | Health-Latenz (Median) | Import-Dauer (Median) |
|---|---:|---:|
| Health während PDF-Import | **4.7 ms** | 408.0 ms |
| Health während XLSX-Import | **2.6 ms** | 417.3 ms |

**Reduktion Health-Latenz:** PDF −98,7 % (356,6 ms → 4,7 ms), XLSX −99,3 %
(365,7 ms → 2,6 ms). Die Import-Gesamtdauer blieb wie erwartet nahezu
unverändert (407,9 ms → 408,0 ms bzw. 415,5 ms → 417,3 ms) — Ziel war
Responsivität paralleler Requests, keine schnellere Einzel-Import-Dauer.

**Messaufbau:** `TestClient` (FastAPI/Starlette) mit echter Thread-Nebenläufigkeit
(Import-Request in einem `threading.Thread`, Health-Request im Hauptthread
währenddessen), künstlich verlangsamter Mock (`time.sleep(0.4)`) anstelle des
echten Gemini-/Parser-Aufrufs, 5 Wiederholungen je Szenario auf frischer
DB-Kopie. **Grenzen der Aussagekraft:** `TestClient` nutzt einen
Portal-basierten ASGI-Transport mit begrenztem Threadpool — für sehr viele
gleichzeitige Requests (nicht Teil dieses Tests) könnte reale
Threadpool-Erschöpfung ein Faktor werden; das ist unverändert gegenüber
anderen bereits synchronen Endpunkten (`plan_save` etc.) und kein neues
AP7-Risiko. Schwankungen zwischen Wiederholungen lagen im
Millisekundenbereich (Health: 1,8–5,6 ms nachher, 351,9–367,3 ms vorher).

### Ergebnisvergleich (Schritt 9)

Alle vier Importpfade wurden mit gemockten externen Diensten getestet:
- **PDF-Import**: identische Response bei Erfolg (mocked Gemini-Ergebnis
  durchgereicht), identischer 400 bei fehlendem API-Key, identischer 500 mit
  `"Extraktion fehlgeschlagen: ..."` bei Gemini-Fehler.
- **Probenplan-Import**: identischer 400 bei falscher Dateiendung,
  identisches Gemini-Erfolgsergebnis, identischer lokaler Fallback (inkl.
  Warnhinweis) bei simuliertem Gemini-Fehler.
- **XLSX-Import**: identischer 500 mit `"Einlesen fehlgeschlagen: ..."` bei
  ungültiger Datei, identische Sheet-Liste bei gültiger Datei.
- **Artist-Plan-Import**: identischer 400 mit
  `"...kein gültiges Wochen-Startdatum gefunden."` bei fehlendem Startdatum,
  identische Feldstruktur (Tage/Labels/Sheet-Name) bei gültigem Workbook.

### Testergebnisse

Neue Datei [backend/tests/test_async_imports.py](../../backend/tests/test_async_imports.py)
(18 Tests): 2 Responsivitätstests (Schritt 8), 12 Ergebnisgleichheits-/
Fehlerpfadtests (Schritt 9), 4 Ressourcenfreigabetests inkl. Exception-Pfad
(Schritt 10).

| Befehl | Exit-Code | Ergebnis |
|---|---|---|
| `python -m compileall` (via `py_compile`) | 0 | erfolgreich |
| `pytest` | 0 | **117 passed** (99 vorher + 18 neu) |
| `python -c "from backend.api import app"` | 0 | Import ok, 63 Routen (unverändert) |
| `npm run build` | 0 | erfolgreich |
| `npm run lint` | 0 | 0 Fehler, 1 vorbestehende, unveränderte Warnung |
| Echter App-Start (`uvicorn` auf DB-Kopie) + `GET /api/health`, `POST /api/upload/pdf` (gemockt), `POST /api/upload/xlsx/sheets` (ungültige Datei) | — | Start ok, alle Requests mit erwartetem Status, sauberer Shutdown |

### Bekannte Thread-Safety-Risiken

Keine im Code gefundenen Risiken (siehe „Thread-Sicherheit" oben). Als
generisches Restrisiko bleibt: PyMuPDF (MuPDF-C-Bibliothek) ist laut
Dokumentation sicher, wenn jeder Thread ausschließlich eigene
`Document`-Objekte verwendet (hier immer der Fall — kein `Document` wird
zwischen Requests geteilt). Kein Bibliotheks-Thread-Safety-Problem bekannt,
das über diese Nutzungsweise hinausgeht.

### Bewusst nicht veränderte Importlogik

Keine Änderung an: Extraktionsregeln, Gemini-Prompts/-Modell/-Response-Schema,
Parser-Logik (Zeilen-/Kategorie-Erkennung, Datumsableitung), Validierungs-
oder Fehlermeldungstexten (bis auf technisch identische Wortlaute), API-Pfaden,
Request-/Response-Modellen.
