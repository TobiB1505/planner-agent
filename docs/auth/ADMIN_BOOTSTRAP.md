# Admin-Bootstrap

Wie der erste Administrator entsteht - und warum er nicht von selbst
entsteht.

## Warum es keine Automatik gibt

Naheliegend wäre: "wenn noch kein Benutzer existiert, wird der erste Login
automatisch Admin". Genau das ist bewusst **nicht** umgesetzt. Ein solcher
Mechanismus ist ein Wettrennen: Wer sich als Erster anmeldet - versehentlich
oder absichtlich - übernimmt die Anwendung. Bei einer öffentlich
erreichbaren URL ist das kein theoretisches Risiko.

Stattdessen: der Benutzer wird kontrolliert in Supabase angelegt, und seine
UUID wird von Hand freigeschaltet.

## Voraussetzung

Ein Benutzer in Supabase (**Authentication → Users → Add user**, mit
*Auto Confirm*). Von dort die **UID** kopieren - eine UUID der Form
`8f14e45f-ceea-467a-9d7c-1c0a5f3c2b91`.

## Ausführen

Im Projektstamm, mit derselben Umgebung, mit der auch das Backend läuft -
entscheidend ist `DATABASE_URL`, denn das Skript schreibt in genau die
Datenbank, gegen die auch die Anwendung läuft:

```bash
python -m backend.scripts.create_admin --user-id <UID>
```

Ausgabe im Erfolgsfall:

```
Zuordnung angelegt: user_id=<UID>, Rolle=admin, person_id=-, aktiv=True
Bitte im Supabase-Dashboard gegenprüfen, dass genau diese UID existiert (Authentication -> Users).
```

### Optionen

| Option | Bedeutung |
| --- | --- |
| `--user-id` | **Pflicht.** UUID des Supabase-Benutzers. |
| `--role` | `admin` (Standard), `planner` oder `employee`. |
| `--person-id` | Zuordnung zu einem Eintrag der `people`-Tabelle. Für `employee` Pflicht. |
| `--force` | Eine bestehende Zuordnung überschreiben. |

### Beispiele

```bash
# Erster Administrator
python -m backend.scripts.create_admin --user-id 8f14e45f-...

# Administrator, der zugleich Mitarbeiter im Dienstplan ist
python -m backend.scripts.create_admin --user-id 8f14e45f-... --person-id 3

# Mitarbeiterkonto (person_id ist hier Pflicht)
python -m backend.scripts.create_admin --user-id 1b9d6bcd-... --role employee --person-id 12

# Bestehende Rolle bewusst ändern
python -m backend.scripts.create_admin --user-id 8f14e45f-... --role admin --force
```

## Sicherheitseigenschaften des Skripts

- **Läuft nur manuell.** Kein Modul der Anwendung importiert es; beim
  Serverstart passiert nichts. Ein Test prüft, dass `backend.api` das Skript
  nicht in die Importkette zieht.
- **Verlangt eine explizite UUID.** Keine Suche über E-Mail, kein "nimm den
  einzigen vorhandenen Benutzer". Ein Wert, der keine gültige UUID ist,
  bricht mit Exit-Code 2 ab, bevor irgendetwas geschrieben wird.
- **Überschreibt nichts stillschweigend.** Existiert bereits eine Zuordnung,
  bricht das Skript mit Exit-Code 1 ab und meldet die vorhandene Rolle.
  Ändern geht nur mit `--force`.
- **Prüft die Personenzuordnung.** Eine unbekannte `--person-id` führt zum
  Abbruch, nicht zu einer Zuordnung ins Leere.
- **Gibt keine Secrets aus.** Weder Keys noch Tokens noch
  Verbindungsdaten - nur, was geschrieben wurde.

Was das Skript **nicht** kann: prüfen, ob die UUID in Supabase wirklich
existiert. Dafür wäre der Service-Role-Key nötig, und den bewusst nicht zu
brauchen ist eine Designentscheidung (siehe `AUTH_ARCHITECTURE.md`). Eine
falsch abgetippte UUID erzeugt daher einen wirkungslosen Eintrag - deshalb
gibt das Skript zum Schluss aus, was es geschrieben hat, damit man es mit
dem Dashboard vergleichen kann.

## Exit-Codes

| Code | Bedeutung |
| --- | --- |
| 0 | Zuordnung angelegt oder aktualisiert. |
| 1 | Zuordnung existiert bereits, nichts geändert (`--force` fehlt). |
| 2 | Ungültige Eingabe (keine UUID, unbekannte Person, `employee` ohne Person). |

## Danach: weitere Konten

Ist der erste Admin freigeschaltet, braucht es das Skript nicht mehr. Über
die API (ADMIN):

```
GET    /api/admin/app-users
POST   /api/admin/app-users      { user_id, role, person_id?, is_active? }
PATCH  /api/admin/app-users/{user_id}   { role?, is_active?, person_id?, clear_person? }
DELETE /api/admin/app-users/{user_id}
```

Eine ausgebaute Verwaltungsoberfläche ist bewusst nicht Teil dieses Sprints.

## Konto sperren

`PATCH /api/admin/app-users/{user_id}` mit `{"is_active": false}`. Wirkt
sofort beim nächsten Request: `is_active` wird bei **jeder** Anfrage aus der
Datenbank gelesen, nicht aus dem Token. Ein bereits ausgegebenes,
technisch noch gültiges Access Token verliert damit seine Wirkung, ohne dass
man in Supabase etwas tun muss.

Ein Admin kann sich dabei nicht selbst aussperren: die eigene Admin-Rolle
lässt sich nicht entziehen, das eigene Konto nicht deaktivieren und nicht
entfernen.

Soll auch die Anmeldung selbst unmöglich werden, muss der Benutzer
zusätzlich in Supabase deaktiviert oder gelöscht werden - Konten leben dort,
nicht hier.
