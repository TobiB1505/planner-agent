# Migrationen

## Ausgangslage (bitte zuerst lesen)

Der Sprint-Auftrag ging davon aus, dass die operative Datenbank bereits von
SQLite auf Supabase PostgreSQL migriert ist und ein PostgreSQL-Migrations-
system existiert. Im Repository-Stand, auf dem dieser Sprint aufsetzt, ist
das **nicht** der Fall:

- `backend/db.py` spricht durchgehend `sqlite3` (`create_connection()`,
  `sqlite3.Row`, `PRAGMA`-Konfiguration, WAL-Modus),
- das Schema wird als ein `CREATE TABLE IF NOT EXISTS`-Skript
  (`db.SCHEMA`) plus additive Spaltenprüfungen (`db._migrate()`) beim
  App-Start ausgeführt (AP4-Lifecycle),
- es gibt weder Alembic noch versionierte SQL-Migrationen,
- kein `psycopg`/`asyncpg` in `backend/requirements.txt`.

Daraus folgen zwei Entscheidungen für diesen Sprint:

1. **Ausführbar** ist `app_users` dort, wo das Schema tatsächlich entsteht:
   in `db.SCHEMA` (siehe Kommentar dort). Damit läuft die Tabelle auf jedem
   Stand mit, ohne dass ein zweites, paralleles Migrationssystem eingeführt
   wird - das wäre eine Architekturentscheidung weit über einen
   Auth-Sprint hinaus.
2. **Vorbereitet** für PostgreSQL ist `0001_app_users.sql`. Diese Datei
   enthält dieselbe Tabelle in PostgreSQL-Dialekt inklusive echtem
   `uuid`-Typ, Fremdschlüssel auf `auth.users` und Trigger für
   `updated_at`. Sie ist bewusst eigenständig lauffähig (Supabase SQL
   Editor oder `supabase db push`) und nicht an ein Framework gebunden.

Sobald die PostgreSQL-Migration des Gesamtprojekts stattfindet, ist
`0001_app_users.sql` die maßgebliche Definition und der SQLite-Block in
`db.SCHEMA` entfällt zusammen mit dem restlichen SQLite-Schema.

## Dateien

| Datei | Zweck |
| --- | --- |
| `0001_app_users.sql` | `app_users` in PostgreSQL/Supabase (Rolle + Person je Auth-Benutzer) |
