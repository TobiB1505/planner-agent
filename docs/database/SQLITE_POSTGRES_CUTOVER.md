# Cutover-Plan: SQLite → PostgreSQL

Dieser Plan beschreibt den einmaligen Umstieg der operativen Datenhaltung.

> **Grundregel (Sprint-Punkt 42): Niemals zuerst mit der einzigen Live-Datei
> testen.** Der Probelauf mit einer Kopie ist kein optionaler Zwischenschritt,
> sondern Voraussetzung für Schritt 3.

---

## Voraussetzungen

- [ ] Supabase-Projekt eingerichtet, Connection String liegt vor
      (`SUPABASE_SETUP.md`, Schritte 1-5)
- [ ] Der zu deployende Git-Stand enthält die Migration
- [ ] `pg_dump`/`pg_restore` (PostgreSQL 16) lokal verfügbar
- [ ] Zugriff auf die aktuelle `local_data/database/dienstplaene.db` bzw. auf
      die Render-Disk, auf der sie liegt

---

## Phase 0 – Probelauf mit einer Kopie (PFLICHT, vor allem anderen)

1. **Kopie ziehen**, nicht die Originaldatei verwenden:

   ```bash
   python -m backend.backup   # legt eine konsistente Kopie unter local_data/backups/ ab
   ```

   Das Skript meldet dabei ausdrücklich, dass es die *alte SQLite-Datei*
   sichert - genau das ist hier gewollt.

2. **Wegwerf-Zieldatenbank** anlegen (zweites Supabase-Projekt, eine
   Preview-Instanz ohne echte Daten oder eine lokale PostgreSQL-Instanz).

3. Schema anwenden und Trockenlauf:

   ```bash
   export DATABASE_URL='postgresql://…'   # Wegwerf-Ziel
   python -c "from backend import db; db.initialize_database()"
   python -m backend.scripts.migrate_sqlite_to_postgres \
       --source local_data/backups/dienstplaene_<timestamp>.db --dry-run
   ```

   Der Dry Run schreibt nichts. Er muss `ERGEBNIS: PASS` melden. Bei
   `Keine Waisen in den Altdaten: FAIL` → **hier stoppen** und Phase 0b
   abarbeiten.

4. Echte Migration in das Wegwerf-Ziel:

   ```bash
   python -m backend.scripts.migrate_sqlite_to_postgres \
       --source local_data/backups/dienstplaene_<timestamp>.db
   ```

   Ausgabe prüfen: Zeilenzahlen SQLite == PostgreSQL, alle fachlichen
   Stichproben PASS, referenzielle Integrität PASS, Sequenzen PASS.

5. Backend gegen das Wegwerf-Ziel starten und den Smoke-Test aus Phase 3
   vollständig durchspielen. Erst wenn der grün ist, ist Phase 1 freigegeben.

### Phase 0b – falls der Dry Run Waisen meldet

Das Tool löscht nichts und bricht ab. Verwaiste Zeilen sind Altlasten aus der
Zeit, in der SQLite die Fremdschlüssel nie geprüft hat. Fachlich entscheiden:

* Zeile ist Müll → in einer **Kopie** der SQLite-Datei löschen, nie im Original
* Zeile ist fachlich relevant → den fehlenden Elterndatensatz wiederherstellen

Danach Phase 0 ab Schritt 3 wiederholen.

---

## Phase 1 – Änderungen stoppen und final sichern

1. **Änderungen an der SQLite-Datenbank kurz stoppen.** Absprechen, dass in
   diesem Zeitfenster niemand plant, importiert oder speichert. Wenn das
   Backend auf Render läuft: Service suspendieren, damit keine Schreibvorgänge
   mehr ankommen.

2. **Finale Sicherung** der Live-Datei:

   ```bash
   python -m backend.backup
   ```

   Die erzeugte Datei ist der Rollback-Anker. Sie zusätzlich von der
   Render-Disk herunterladen und außerhalb aufbewahren - eine Sicherung, die
   nur auf der Disk liegt, die man gerade abschafft, ist keine Sicherung.

3. Prüfsumme notieren:

   ```bash
   sha256sum local_data/backups/dienstplaene_<timestamp>.db
   ```

---

## Phase 2 – Migration in die Zieldatenbank

4. Schema in der echten Zieldatenbank anwenden:

   ```bash
   export DATABASE_URL='postgresql://…'   # ECHTES Ziel
   python -c "from backend import db; db.initialize_database(); print(db.schema_version())"
   ```

   Erwartet: `001`.

5. Dry Run gegen das echte Ziel (schreibt nichts):

   ```bash
   python -m backend.scripts.migrate_sqlite_to_postgres \
       --source local_data/backups/dienstplaene_<timestamp>.db --dry-run
   ```

6. Migration ausführen:

   ```bash
   python -m backend.scripts.migrate_sqlite_to_postgres \
       --source local_data/backups/dienstplaene_<timestamp>.db
   ```

   Das Tool bricht ab, wenn das Ziel nicht leer ist. `--allow-non-empty`
   **nur** bewusst und nach erneuter Sicherung verwenden - es löscht den
   vorhandenen Zielinhalt.

---

## Phase 3 – Count- und Integritätsprüfungen

7. Die Ausgabe des Tools ist der Prüfbericht. Alle Zeilen müssen `PASS` sein:

   - [ ] Zeilenzahl je Tabelle: SQLite == PostgreSQL (alle 17 Tabellen)
   - [ ] Stichprobe Aliase (gleiche Aliasse für dieselbe Person)
   - [ ] Stichprobe Zuweisungen (gleiche Zuweisungen derselben KW)
   - [ ] Stichprobe Probenteilnehmer (gleiche Personen derselben Probe)
   - [ ] Stichprobe Abwesenheiten (Urlaub/Frei/krank vollständig)
   - [ ] Stichprobe Gedächtnis-Overrides (manuelle Korrekturen erhalten)
   - [ ] Referenzielle Integrität: keine Waisen
   - [ ] Sequenzen: `setval >= MAX(id)` für jede Tabelle

8. Zusätzlich manuell gegenprüfen, dass ein neuer Datensatz keine ID-Kollision
   auslöst:

   ```bash
   python -c "
   from backend import db
   c = db.get_conn()
   print('MAX(id):', c.execute('SELECT MAX(id) AS m FROM people').fetchone()['m'])
   pid = db.create_person(c, 'Cutover-Probe')
   print('neue ID:', pid)
   c.rollback(); c.close()"
   ```

   Die neue ID muss über `MAX(id)` liegen. Der `rollback()` verwirft die
   Testperson wieder.

---

## Phase 4 – Render umstellen

9. Im Render-Dashboard beim Backend-Service setzen:

   | Variable | Wert |
   | --- | --- |
   | `DATABASE_URL` | Connection String (**Secret**, nie im Repo) |
   | `APP_ENV` | `preview` bzw. `production` |
   | `SYSTEM_RESTART_ENABLED` | `0` |
   | `PLANNER_DATA_DIR` | beschreibbarer Pfad, muss nicht mehr persistent sein |

10. Deploy des migrierten Git-Stands auslösen. Der Lifespan-Start wendet offene
    Migrationen an; schlägt das fehl, startet der Service bewusst nicht.

---

## Phase 5 – Smoke Test

11. Erreichbarkeit:

    ```bash
    curl -s https://<service>/api/health
    curl -s https://<service>/api/system/diagnostics
    ```

    `status: ok`, `database: connected`, `integrity_check: ok`.
    `database_path` darf **keine** Zugangsdaten enthalten.

12. Fachlich, im Browser:

    - [ ] Team-Seite zeigt alle Mitarbeiter (Anzahl wie vorher)
    - [ ] Archiv zeigt alle Wochen mit korrekten Zähler-Werten
    - [ ] Eine bestehende Woche im Plan-Editor laden - Inhalt unverändert
    - [ ] Plan bearbeiten und speichern
    - [ ] Seite neu laden - Änderung ist da
    - [ ] Probenplan-Detail öffnen
    - [ ] Abwesenheiten einer Woche prüfen
    - [ ] Dashboard: Empfehlungen und Plan-Qualität werden berechnet
    - [ ] MA-Gedächtnis: manuelle Korrekturen sind erhalten
    - [ ] Excel-Export erzeugt eine gültige Datei

13. **Redeploy-Persistenz:** in Render einen Redeploy auslösen und Schritt 12
    stichprobenartig wiederholen. Alle Daten müssen unverändert da sein - das
    ist der Nachweis, dass keine persistente Disk mehr nötig ist.

---

## Phase 6 – Freigabe

14. Freigabe erteilen, wenn Phase 3 und Phase 5 vollständig grün sind.
15. Persistente Render-Disk erst **nach** einer Karenzzeit (Empfehlung: eine
    Woche stabiler Betrieb) entfernen - solange sie existiert, bleibt der
    Rollback-Weg kurz.
16. Die finale SQLite-Sicherung aus Phase 1 dauerhaft aufbewahren.
17. Backup-Strategie nach `POSTGRES_BACKUP.md` aktivieren.

---

## Rollback

**Wichtig und ehrlich: es gibt keinen Dual-Betrieb.**

Nach der Migration enthält der Code keinen SQLite-Pfad mehr. `DATABASE_URL`
zurückzusetzen genügt deshalb **nicht** - der Code kann die SQLite-Datei gar
nicht mehr öffnen. Jede gegenteilige Aussage wäre falsche Sicherheit.

Der Rollback läuft ausschließlich über den vorherigen Git-Stand plus die
SQLite-Sicherung:

1. Änderungen am neuen System stoppen (Service suspendieren).
2. In Render auf den letzten Commit **vor** der Migration deployen
   (`b97f544` bzw. den letzten Stand vor `refactor(db): migrate planner
   persistence from sqlite to postgres`).
3. Persistente Disk wieder mounten und `PLANNER_DATA_DIR` darauf zeigen lassen.
4. Die finale SQLite-Sicherung aus Phase 1 zurückspielen:

   ```bash
   python -c "
   from pathlib import Path
   from backend import backup
   backup.restore_backup(Path('<pfad-zur-sicherung>.db'))"
   ```

   `restore_backup()` prüft die Integrität vor dem Kopieren und legt eine
   vorhandene Zieldatei vorher als `.pre-restore` beiseite.
5. `DATABASE_URL` in Render entfernen (der alte Stand kennt sie nicht).
6. Smoke Test nach Phase 5 gegen den alten Stand.

### Was ein Rollback kostet

Alle Änderungen, die zwischen dem Cutover und dem Rollback in PostgreSQL
entstanden sind, gehen verloren - die SQLite-Sicherung ist auf dem Stand von
Phase 1. Deshalb:

* Das Cutover-Zeitfenster kurz halten.
* Nach dem Cutover früh entscheiden, ob es bleibt.
* Vor einem Rollback **immer** zusätzlich einen `pg_dump` des aktuellen
  PostgreSQL-Stands ziehen (`POSTGRES_BACKUP.md`), damit die zwischenzeitlichen
  Daten nicht unwiederbringlich verloren sind, sondern später nachgezogen
  werden können.

### Rollback-Fenster

Der Rollback-Weg bleibt nur so lange offen, wie

* der Git-Stand vor der Migration deploybar ist (immer der Fall) **und**
* die SQLite-Sicherung existiert (dauerhaft aufbewahren) **und**
* eine persistente Disk verfügbar ist (bis sie in Phase 6 entfernt wird).

Nach Entfernen der Disk ist ein Rollback weiterhin möglich, erfordert aber das
Neuanlegen einer Disk - also mehr Zeit. Das ist bei der Freigabeentscheidung zu
berücksichtigen.
