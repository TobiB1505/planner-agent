# Backup & Restore — lokale SQLite-Datenbank

Sprint 1 (Production Hardening), Teil 3. Betrifft ausschließlich
`local_data/database/dienstplaene.db` (Mitarbeiter-, Planungs- und
Gedächtnisdaten). Implementiert in [backend/backup.py](../../backend/backup.py),
abgesichert durch [backend/tests/test_backup_restore.py](../../backend/tests/test_backup_restore.py)
(17 Tests).

---

## Warum nicht einfach `cp`?

```bash
cp dienstplaene.db backup.db     # NICHT verwenden
```

Während die Anwendung läuft, kann jederzeit eine Schreibtransaktion offen
sein (WAL-Modus, siehe AP3). Ein einfacher Datei-Kopiervorgang liest die
Hauptdatei und die separate `-wal`-Datei unabhängig voneinander — je nach
Zeitpunkt kann das Ergebnis halb geschriebene oder inkonsistente Daten
enthalten. `backend/backup.py` nutzt stattdessen SQLites `VACUUM INTO`: eine
transaktional konsistente Momentaufnahme, direkt von der Datenbank-Engine
erzeugt, ohne die laufende Anwendung zu blockieren oder zu sperren.

**Empirisch verifiziert** (siehe
`test_create_backup_works_while_a_concurrent_write_transaction_is_open` und
`test_create_backup_works_under_concurrent_real_requests`): ein Backup
gelingt korrekt, während eine zweite Verbindung parallel schreibt — die
unkommittete Zeile landet nicht im Backup, laufende Schreibvorgänge werden
nicht gestört.

---

## Backup erstellen

### Manuell

```bash
cd /pfad/zum/repo
source venv/bin/activate
python -m backend.backup
```

Ausgabe bei Erfolg:
```
Backup erfolgreich: local_data/backups/dienstplaene_2026-08-06_1430.db
```

Legt eine neue Datei unter `local_data/backups/` an, benannt nach dem
Muster `<name>_<JJJJ-MM-TT>_<HHMM>.db` (Minutenauflösung; bei mehreren
Backups innerhalb derselben Minute wird automatisch `_2`, `_3`, ... angehängt
statt eine bestehende Sicherung stillschweigend zu überschreiben).

### Aus Python/eigenen Skripten

```python
from backend.backup import create_backup, verify_backup

backup_path = create_backup()          # nutzt db.DATABASE_PATH / BACKUP_DIR
assert verify_backup(backup_path)
```

`create_backup()` akzeptiert optional `source_path`/`backup_dir` (z. B. für
Tests oder einen abweichenden Zielort) sowie `now` (für reproduzierbare
Dateinamen in Tests).

### Automatisierung (Cronjob)

Nicht Teil dieses Sprints (keine neue Infrastruktur/Automatisierung
vorgesehen), aber vorbereitet: ein Cronjob kann direkt
`python -m backend.backup` regelmäßig aufrufen, z. B. täglich:

```cron
0 3 * * * cd /pfad/zum/repo && venv/bin/python -m backend.backup >> local_data/backup.log 2>&1
```

Eine Rotation (alte Backups löschen) ist bewusst **nicht** implementiert -
das ist eine eigene, hier nicht angeforderte Entscheidung (Aufbewahrungsdauer
hängt von verfügbarem Speicherplatz und Anforderungen ab).

---

## Backup prüfen

```python
from backend.backup import verify_backup
verify_backup(backup_path)   # True/False
```

Führt `PRAGMA integrity_check` auf einer eigenen, rein lesenden Verbindung
gegen die Backup-Datei aus. Eine fehlende Datei liefert `False` (kein
Seiteneffekt — `sqlite3.connect()` würde eine fehlende Datei sonst
stillschweigend als leere, "gültige" Datenbank neu anlegen; `verify_backup`
prüft deshalb vorab explizit `exists()`).

Vorhandene Backups auflisten (neueste zuerst):

```python
from backend.backup import list_backups
list_backups()   # [Path('local_data/backups/dienstplaene_2026-08-06_1430.db'), ...]
```

---

## Wiederherstellen

```python
from backend.backup import restore_backup
restore_backup(backup_path)   # stellt an db.DATABASE_PATH wieder her
```

Oder mit explizitem Ziel:

```python
restore_backup(backup_path, target_path=some_other_path)
```

**Ablauf von `restore_backup()`:**

1. Prüft `verify_backup(backup_path)` — ein beschädigtes Backup wird
   **nicht** wiederhergestellt, die Funktion bricht mit `BackupError` ab,
   bevor irgendetwas am Ziel verändert wird.
2. Existiert am Zielort bereits eine Datenbank, wird sie zuerst nach
   `<name>.db.pre-restore` verschoben (nicht überschrieben/gelöscht) — ein
   fehlgeschlagener oder falscher Restore darf die zuvor funktionierende
   Datenbank nicht ersatzlos zerstören.
3. Das Backup wird an die Zielposition kopiert.
4. Verwaiste `-wal`/`-shm`-Dateien der vorherigen Datenbank am Zielort werden
   entfernt — sie gehören zur alten Hauptdatei und dürfen nicht mit den
   Seiten der wiederhergestellten Datei vermischt werden.

**Vor einem produktiven Restore:** Backend-Prozess stoppen (oder zumindest
sicherstellen, dass gerade kein Schreibvorgang läuft), erst danach
`restore_backup()` ausführen, danach den Prozess neu starten
(`POST /api/system/restart` oder `python -m backend.run_local`).

---

## Was passiert bei einem Fehler?

| Situation | Verhalten |
|---|---|
| Quelldatenbank fehlt beim Backup | `BackupError("Quelldatenbank nicht gefunden: ...")`, kein Backup-Versuch |
| Backup-Ordner nicht beschreibbar | `BackupError` mit der zugrunde liegenden `OSError`-Meldung |
| `VACUUM INTO` schlägt fehl (z. B. Datenträger voll) | Eine evtl. bereits teilweise geschriebene Zieldatei wird gelöscht, `BackupError` mit der SQLite-Fehlermeldung, Fehler wird geloggt (`logger.error`) |
| Backup-Datei fehlt beim Restore | `BackupError("Backup-Datei nicht gefunden: ...")`, Ziel bleibt unverändert |
| Backup-Datei ist beschädigt | `verify_backup()` schlägt fehl → `BackupError("... beschädigt, Restore abgebrochen")`, **kein** Restore-Versuch, Ziel bleibt unverändert |
| Restore-Kopiervorgang schlägt fehl (z. B. Datenträger voll) | `BackupError` mit der zugrunde liegenden `OSError`-Meldung; die zuvor gesicherte `.pre-restore`-Datei bleibt erhalten und kann manuell zurückbenannt werden |

In allen Fehlerfällen: keine stillschweigend verschluckten Exceptions, jede
Fehlermeldung ist auf Deutsch und nennt den konkreten Pfad/die konkrete
Ursache.

---

## Manuell getesteter Ablauf (Schritt 4)

Nachvollziehbar in
[backend/tests/test_backup_restore.py](../../backend/tests/test_backup_restore.py::test_full_backup_and_restore_cycle_after_database_is_destroyed):

1. Testdatenbank mit 4 Personen angelegt.
2. Backup erstellt, Integrität verifiziert (`ok`).
3. Quelldatei komplett gelöscht (`source.unlink()`).
4. `restore_backup(backup_path, source)` ausgeführt.
5. Alle 4 Personen sind exakt wie vorher in der wiederhergestellten
   Datenbank vorhanden.

Zusätzlich abgedeckt: Restore nach Beschädigung (statt Löschung),
Ablehnung eines beschädigten Backups, Sicherungskopie der überschriebenen
Datenbank, Entfernen verwaister WAL/SHM-Dateien, Backup während
gleichzeitiger Schreibzugriffe (simuliert und mit echten Threads).
