# Supabase-Einrichtung für den Planner-Agenten

Diese Anleitung beschreibt, wie die PostgreSQL-Datenbank bereitgestellt und mit
dem Render-Backend verbunden wird.

> **Keine Zugangsdaten in dieser Datei, im Repository oder in einem Commit.**
> Alle Beispiele unten sind Platzhalter. Das echte Passwort und die echte
> Connection-URL leben ausschließlich in den Render Environment Variables bzw.
> in der lokalen, nicht versionierten `.env`.

Wichtige Abgrenzung: Supabase wird hier **ausschließlich als
PostgreSQL-Infrastruktur** verwendet. Die Anwendung kennt nur `DATABASE_URL`,
keine Supabase-spezifischen SDKs, keine Supabase Auth, kein Supabase Storage.
Sie läuft unverändert gegen jede beliebige PostgreSQL-Instanz - genau das prüft
die CI, die einen normalen `postgres:16`-Container verwendet.

---

## 1. Supabase-Projekt anlegen

1. Auf <https://supabase.com> anmelden und **New project** wählen.
2. Organisation auswählen bzw. anlegen.
3. Projektnamen vergeben, z.B. `planner-agent-preview`.

Empfehlung: **zwei getrennte Projekte** - eines für Preview, eines für
Production. Ein gemeinsames Projekt mit zwei Datenbanken ist möglich, macht
aber ein versehentliches Vertauschen der Connection-Strings deutlich
folgenreicher.

## 2. Region wählen

Die Region ist nach dem Anlegen **nicht mehr änderbar**.

Sie sollte so nah wie möglich an der Render-Region liegen: jede SQL-Anweisung
ist ein Netzwerk-Roundtrip, und die Anwendung setzt pro Request mehrere davon
ab (siehe `POSTGRES_PERFORMANCE.md`). Liegen Render und Supabase auf
verschiedenen Kontinenten, addieren sich pro Request schnell dreistellige
Millisekunden.

* Render `frankfurt` → Supabase `Central EU (Frankfurt)`
* Render `oregon` → Supabase `West US (Oregon)`

## 3. Database Password setzen

Beim Anlegen des Projekts wird ein Datenbankpasswort vergeben.

* Ein langes, zufälliges Passwort verwenden (Passwortmanager).
* **Nicht** in Slack, E-Mail, Issues oder Commits weitergeben.
* Supabase zeigt das Passwort nur einmal an. Es kann unter
  *Project Settings → Database → Reset database password* neu gesetzt werden;
  danach muss `DATABASE_URL` in Render aktualisiert werden.

Enthält das Passwort Sonderzeichen (`@`, `:`, `/`, `?`, `#`, `%`), müssen diese
in der URL prozentkodiert werden - sonst wird die URL falsch geparst. Am
einfachsten: ein Passwort ohne diese Zeichen wählen.

## 4. Verbindungsmethode wählen

Supabase bietet unter *Project Settings → Database → Connection string* mehrere
Varianten. Für einen langlebigen FastAPI-Prozess auf Render:

| Variante | Port | Für den Planner-Agenten |
| --- | --- | --- |
| **Direct connection** | 5432 | Nur, wenn der Render-Service eine IPv6-Route hat. Supabase liefert für Direct Connections heute primär IPv6; Render-Services haben nicht garantiert IPv6-Egress. |
| **Session pooler** (Supavisor) | 5432 | **Empfohlen.** IPv4-erreichbar, verhält sich wie eine normale PostgreSQL-Verbindung: Sessions, Prepared Statements und Transaktionen über mehrere Anweisungen funktionieren unverändert. |
| **Transaction pooler** (Supavisor) | 6543 | **Nicht verwenden.** Er gibt die Verbindung nach jeder Transaktion zurück und unterstützt keine Session-Features. Die Anwendung hält bewusst eine Transaktion über eine ganze fachliche Operation offen (AP10) und psycopg nutzt Prepared Statements - beides passt nicht dazu. |

**Konkrete Empfehlung: Session pooler (Port 5432).** Er löst das
IPv4/IPv6-Problem und ändert nichts an der Transaktionssemantik.

Der eigene Connection Pool der Anwendung (`psycopg_pool`, siehe `backend/db.py`)
bleibt trotzdem aktiv und wichtig: er begrenzt die Zahl gleichzeitiger
Verbindungen auf einen kleinen, kontrollierten Wert (Default max 5) und
verhindert, dass jeder Request eine neue Verbindung aufbaut. Zwei Pools
hintereinander sind hier kein Widerspruch - der lokale Pool begrenzt den
*Client*, Supavisor multiplext auf der *Server*-Seite.

Kleine Supabase-Pläne haben ein niedriges Verbindungslimit. Faustregel:

```
DATABASE_POOL_MAX_SIZE × Anzahl Render-Instanzen  <  Supabase-Verbindungslimit
```

Bei einer Render-Instanz und dem Default von 5 ist reichlich Luft.

## 5. Connection String erhalten

*Project Settings → Database → Connection string → URI* und dort den **Session
pooler** auswählen. Die URL hat diese Form (Platzhalter):

```
postgresql://postgres.PROJECTREF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres
```

SSL ist bei Supabase serverseitig erzwungen; libpq/psycopg handelt TLS
automatisch aus. Wer es explizit machen will, hängt `?sslmode=require` an.
`sslmode=disable` darf **niemals** gesetzt werden.

## 6. Migrationen ausführen

Das Schema entsteht ausschließlich über den Migrationsrunner - nie implizit aus
einem Request. Lokal, mit auf Supabase gesetzter `DATABASE_URL`:

```bash
python -c "from backend import db; db.initialize_database(); print(db.schema_version())"
```

Erwartete Ausgabe: `001`.

Der Aufruf ist idempotent: bereits angewendete Migrationen werden übersprungen.
Er läuft außerdem automatisch beim Start des Backends (FastAPI-Lifespan). Ein
Fehler bricht den App-Start bewusst ab, statt mit halbem Schema weiterzulaufen.

## 7. Render `DATABASE_URL` setzen

Im Render-Dashboard beim Backend-Service unter *Environment*:

| Variable | Wert |
| --- | --- |
| `DATABASE_URL` | Connection String aus Schritt 5 (**als Secret**) |
| `APP_ENV` | `preview` bzw. `production` |
| `SYSTEM_RESTART_ENABLED` | `0` |
| `PLANNER_DATA_DIR` | z.B. `/tmp/planner` – muss beschreibbar sein, **muss aber nicht mehr persistent sein** (siehe `POSTGRES_STORAGE_GAPS.md`) |
| `DATABASE_POOL_MAX_SIZE` | optional, Default 5 |

Eine bestehende persistente Disk wird für die Datenbank nicht mehr benötigt und
kann nach abgeschlossenem Cutover entfernt werden.

## 8. Connectivity testen

Nach dem Deploy:

```bash
curl -s https://<render-service>/api/health
```

Erwartete Antwort:

```json
{
  "status": "ok",
  "database": "connected",
  "database_path": "postgresql://aws-0-REGION.pooler.supabase.com:5432/postgres",
  "templates_ok": true,
  "data_dir_writable": true
}
```

`database_path` enthält bewusst **nur** Host, Port und Datenbanknamen - niemals
Benutzername oder Passwort.

Detaillierter:

```bash
curl -s https://<render-service>/api/system/diagnostics
```

Dort meldet `database.integrity_check` den Wert `ok`, sobald Verbindung UND
angewendete Schemaversion vorhanden sind.

Bei `"database": "error"` prüfen:

1. Ist `DATABASE_URL` gesetzt und vollständig (inkl. `:5432/postgres`)?
2. Wurde der Session pooler (nicht der Transaction pooler auf 6543) gewählt?
3. Enthält das Passwort unkodierte Sonderzeichen?
4. Ist das Supabase-Projekt pausiert? (Free-Tier-Projekte pausieren nach
   Inaktivität und müssen im Dashboard reaktiviert werden.)

---

## Was dieser Sprint bewusst NICHT einrichtet

* **Supabase Auth** – kein `auth.users`-Mapping, keine `app_users`, keine
  Rollen, keine JWT-Prüfung, kein Login/Logout. Folgt in einem eigenen Sprint.
* **Row Level Security** – bewusst **nicht** aktiviert. Das Backend verbindet
  sich serverseitig mit vollen Rechten; halbfertige Policies würden es
  unvorhersehbar blockieren. RLS wird gemeinsam mit Auth/RBAC geplant.
* **Supabase Storage** – nicht nötig, es gibt keine zu migrierenden Dateien
  (siehe `POSTGRES_STORAGE_GAPS.md`).
* **Direkter Datenbankzugriff aus dem Frontend** – React spricht weiterhin
  ausschließlich mit FastAPI. Der `anon key` wird nirgends verwendet.
