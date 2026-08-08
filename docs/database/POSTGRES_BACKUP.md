# Backup-Strategie nach der PostgreSQL-Migration

## Warum das alte Backup nicht mehr gilt

Bis zur Migration sicherte `backend/backup.py` die lokale SQLite-Datei per
`VACUUM INTO`. Das war für eine Datei-Datenbank die richtige Wahl: eine
transaktional konsistente Momentaufnahme, direkt aus der SQLite-Engine, auch
während parallel geschrieben wurde.

`VACUUM INTO` ist eine reine SQLite-Anweisung. PostgreSQLs `VACUUM` ist etwas
komplett anderes (Speicherfreigabe/Statistiken) und kann keine Sicherungsdatei
erzeugen. Es gibt kein Äquivalent, das ein Anwendungsprozess aufrufen könnte -
und das ist auch richtig so: eine verwaltete Datenbank sichert sich nicht
selbst aus der Anwendung heraus.

**`backend/backup.py` wurde deshalb nicht gelöscht, sondern als deprecated
markiert.** Jeder Einstiegspunkt loggt eine deutliche Warnung, dass er die
*alte SQLite-Datei* sichert und **nicht** die operative Datenbank. Sein einzig
verbliebener Zweck ist die finale Sicherung vor dem Cutover und ein möglicher
Rollback auf den Stand davor (siehe `SQLITE_POSTGRES_CUTOVER.md`). Nach
abgeschlossenem Cutover kann das Modul entfallen.

---

## Ebene 1: Supabase-eigene Backups (Grundabsicherung)

Supabase sichert verwaltete PostgreSQL-Instanzen automatisch. Der Umfang hängt
vom Plan ab und ist im Dashboard unter *Database → Backups* einzusehen:

| Plan | Was verfügbar ist |
| --- | --- |
| Free | Keine garantierten automatischen Backups. **Für Produktivdaten nicht ausreichend** - Ebene 2 ist dann Pflicht. |
| Pro | Tägliche Backups mit begrenzter Aufbewahrung |
| Pro + PITR-Add-on | Point-in-Time Recovery, Wiederherstellung auf einen beliebigen Zeitpunkt |

**Zu tun (einmalig, im Dashboard, nicht im Code):**

1. *Database → Backups* öffnen und den tatsächlichen Stand prüfen.
2. Für echte Planungsdaten mindestens den Pro-Plan mit täglichen Backups
   verwenden; PITR aktivieren, wenn ein Datenverlust von bis zu 24 Stunden
   nicht akzeptabel ist.
3. Aufbewahrungsdauer notieren.

> Diese Ebene allein reicht nicht: sie schützt gegen Ausfall der Instanz, nicht
> gegen ein gelöschtes oder gesperrtes Supabase-Konto. Deshalb Ebene 2.

## Ebene 2: Eigener logischer Dump (anbieterunabhängig)

Ein `pg_dump` erzeugt eine vollständige, selbsttragende Kopie, die sich in
**jede** PostgreSQL-Instanz zurückspielen lässt - auch außerhalb von Supabase.
Genau das hält die Anwendung vom Anbieter unabhängig.

```bash
# Vollständiger Dump im komprimierten Custom-Format.
# DATABASE_URL aus der Umgebung, damit keine Zugangsdaten in der History landen.
pg_dump --format=custom --no-owner --no-privileges \
        --file="planner_$(date +%Y-%m-%d_%H%M).dump" \
        "$DATABASE_URL"
```

Wiederherstellen in eine **leere** Zieldatenbank:

```bash
pg_restore --no-owner --no-privileges --dbname="$TARGET_DATABASE_URL" \
           planner_2026-08-08_1200.dump
```

Hinweise:

* `--no-owner --no-privileges` vermeidet Fehler durch abweichende
  Rollennamen zwischen Quelle und Ziel.
* Die Dump-Datei enthält **alle** Planungsdaten und ist damit genauso
  schützenswert wie die Datenbank selbst: verschlüsselt ablegen, nicht ins
  Repository, nicht in einen öffentlichen Bucket.
* `pg_dump` braucht eine zur Serverversion passende Client-Version
  (PostgreSQL 16).

**Empfohlene Kadenz:**

| Wann | Was |
| --- | --- |
| Vor jedem Cutover / jeder Migration | Pflicht-Dump, siehe `SQLITE_POSTGRES_CUTOVER.md` |
| Vor jeder Schemamigration in Produktion | Pflicht-Dump |
| Wöchentlich | Routine-Dump, extern aufbewahrt |

Ein Dump, der nie zurückgespielt wurde, ist kein Backup. Mindestens einmal
einen `pg_restore` in eine Wegwerf-Datenbank ausführen und danach
`GET /api/health` sowie einen Plan-Reload prüfen.

## Ebene 3: Schema-Reproduzierbarkeit

Das Schema selbst hängt an keinem Backup: es entsteht reproduzierbar aus den
versionierten Dateien unter `backend/migrations/` und ist über die Tabelle
`schema_migrations` jederzeit nachvollziehbar. Eine leere Datenbank lässt sich
mit

```bash
python -c "from backend import db; db.initialize_database()"
```

in genau denselben Stand bringen. Ein Backup muss also nur **Daten** retten,
nicht die Struktur.

---

## Was ausdrücklich NICHT eingerichtet wurde

Der Sprint verlangt kein komplexes externes Backup-System, und es wurde keines
gebaut:

* Kein automatisierter Backup-Job im Backend-Prozess. Ein Web-Prozess ist der
  falsche Ort dafür (er skaliert, startet neu und hat kein persistentes
  Dateisystem mehr).
* Kein Cron-Service, kein Objektspeicher-Upload, keine Verschlüsselungs-
  Pipeline.

Beides ist ein bewusster Folge-Schritt, sobald echte Produktivdaten in Supabase
liegen. Bis dahin gilt: **Ebene 1 im Dashboard aktivieren und vor jedem
Eingriff einen Dump nach Ebene 2 ziehen.**

## Offener Punkt für die Produktivfreigabe

Solange auf dem Supabase-Free-Tier gearbeitet wird, gibt es **keine garantierten
automatischen Backups**. Vor der Freigabe echter Planungsdaten muss entweder ein
Plan mit täglichen Backups aktiv sein oder ein regelmäßiger, extern
aufbewahrter `pg_dump` etabliert werden. Dieser Punkt ist im Abschlussbericht
unter „Risiken" aufgeführt.
