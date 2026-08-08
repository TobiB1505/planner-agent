# Supabase Auth einrichten

Schritt-für-Schritt-Anleitung. **Ohne Secrets** - hier stehen nur Namen von
Einstellungen und Variablen, nie deren Werte.

## 1. Auth aktivieren

Supabase-Dashboard → **Authentication**. Auth ist in jedem Supabase-Projekt
vorhanden und muss nicht installiert werden.

## 2. E-Mail/Passwort konfigurieren

**Authentication → Providers → Email**

- *Email* aktivieren.
- **"Allow new users to sign up" ausschalten.** Es gibt in dieser Anwendung
  keine öffentliche Registrierung; Konten legt die Administration an. Bleibt
  die Selbstregistrierung an, kann sich jede Person mit einer beliebigen
  E-Mail-Adresse ein Supabase-Konto anlegen. Zugriff auf Planungsdaten hätte
  sie dadurch zwar nicht (ohne `app_users`-Eintrag gibt es 403), aber offene
  Registrierung ist trotzdem nichts, was man ungewollt betreibt.
- Alle anderen Provider (Google, GitHub, ...) aus lassen - Social Logins
  sind nicht Teil dieser Anwendung.
- Magic Links werden nicht verwendet.

## 3. Redirect-URLs

**Authentication → URL Configuration**

- *Site URL*: die Produktions-URL des Frontends.
- *Redirect URLs*: zusätzlich die Vercel-Preview-Adressen und
  `http://localhost:3000` für die lokale Entwicklung.

Die Anmeldung selbst läuft über E-Mail/Passwort und braucht keinen
Redirect-Fluss. Die Einträge sind trotzdem nötig, damit Supabase spätere
Abläufe (z.B. ein Passwort-Reset über das Dashboard) korrekt zurückführt.

## 4. Schlüssel notieren

**Project Settings → API**

| Wert | Wohin |
| --- | --- |
| Project URL | Frontend **und** Backend |
| Publishable / anon key | **nur** Frontend |
| Service role key | **nirgendwohin** (siehe unten) |

Der Service-Role-Key wird von dieser Anwendung nicht verwendet. Die
Token-Verifikation läuft über das öffentliche JWKS des Projekts; ein
Schlüssel, der jede Zugriffsregel umgeht, wäre dafür unnötiges Risiko. Er
gehört niemals ins Frontend, nie in eine `NEXT_PUBLIC_*`-Variable, nie in
Logs und nie ins Repository.

## 5. Datenbank vorbereiten

Nichts manuell ausführen: `app_users` entsteht über die versionierte
Migration `backend/migrations/002_app_users.sql`, die der Migrationsrunner
beim Backend-Start anwendet (`db.initialize_database()`, siehe
`backend/migrations/__init__.py`). Der Stand ist über die Tabelle
`schema_migrations` nachvollziehbar.

Die allgemeine Einrichtung der Datenbank selbst - Projekt, `DATABASE_URL`,
Verbindungslimits - steht in `docs/database/SUPABASE_SETUP.md`; dieses
Dokument behandelt ausschliesslich Auth.

## 6. Environment-Variablen

### Vercel (Frontend)

**Project Settings → Environment Variables**, für Production *und* Preview:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Unverändert bleiben `APP_ENV` und `BACKEND_INTERNAL_URL` (serverseitig, ohne
`NEXT_PUBLIC_`). **Kein `NEXT_PUBLIC_BACKEND_URL`** - der Browser spricht
weiterhin ausschliesslich relative `/api/*`-Pfade an.

Nach dem Setzen der Variablen einmal neu deployen: `NEXT_PUBLIC_*`-Werte
werden zur Build-Zeit eingesetzt, nicht zur Laufzeit gelesen.

### Render (Backend)

**Environment**:

```
SUPABASE_URL
```

Optional, nur bei Bedarf:

| Variable | Wann |
| --- | --- |
| `SUPABASE_JWT_ISSUER` | Wenn der Issuer vom Standard `<SUPABASE_URL>/auth/v1` abweicht |
| `SUPABASE_JWT_AUDIENCE` | Wenn das Projekt nicht `authenticated` verwendet |
| `SUPABASE_JWT_SECRET` | Nur für ältere Projekte mit symmetrischem JWT-Secret (HS256) |
| `SUPABASE_JWKS_CACHE_SECONDS` | Abweichende Cache-Dauer für die Signaturschlüssel (Standard 600) |

Ohne diese Konfiguration startet das Backend zwar, lehnt aber jeden
geschützten Aufruf mit 401 ab (fail-closed) und protokolliert beim Start
eine entsprechende Warnung.

### Lokal

`.env` im Projektstamm (Backend) und `frontend/.env.local` (Frontend) - die
Vorlagen `.env.example` bzw. `frontend/.env.example` enthalten alle Namen
mit Erklärung. Beide Dateien sind über `.gitignore` ausgeschlossen und
gehören nie ins Repository.

## 7. Ersten Benutzer anlegen

**Authentication → Users → Add user**

- E-Mail und ein Passwort vergeben.
- *Auto Confirm User* aktivieren, damit kein Bestätigungslink nötig ist.
- Danach die **UID** des Benutzers kopieren - sie wird im nächsten Schritt
  gebraucht.

Der Benutzer kann sich ab jetzt anmelden, bekommt aber von jedem
geschützten Endpunkt 403: er ist in Supabase bekannt, im Planner jedoch
noch nicht freigeschaltet. Das ist beabsichtigt.

## 8. Admin-Bootstrap

Siehe `ADMIN_BOOTSTRAP.md`. Kurz:

```
python -m backend.scripts.create_admin --user-id <UID aus Schritt 7>
```

## 9. Prüfen

1. `/login` aufrufen, anmelden.
2. Als Admin: Dashboard erscheint, in der Navigation ist "System" sichtbar.
3. Abmelden → landet auf `/login`; ein Zurück-Klick führt nicht zurück in
   die Anwendung.
4. Ohne Anmeldung `/plan-editor` aufrufen → Weiterleitung auf `/login`.
5. Direkt gegen die API (ohne Token):
   `curl -i <backend>/api/team` → **401**.
   `curl -i <backend>/api/health` → **200**.

## Weitere Benutzer

Für jede weitere Person:

1. In Supabase unter **Authentication → Users** anlegen (Auto Confirm).
2. UID kopieren.
3. Als Admin freischalten - entweder über die API:

   ```
   POST /api/admin/app-users
   { "user_id": "<UID>", "role": "employee", "person_id": 42 }
   ```

   oder über das Bootstrap-Skript mit `--role`/`--person-id`.

`person_id` ist die ID aus der `people`-Tabelle (sichtbar in der
Team-Verwaltung). Für die Rolle `employee` ist sie Pflicht.

## Passwort vergessen

Passwörter verwaltet ausschliesslich Supabase. Ein Administrator kann im
Dashboard unter **Authentication → Users** ein neues Passwort setzen oder
eine Recovery-Mail auslösen. In dieser Anwendung gibt es dafür bewusst
keine eigene Oberfläche - eine selbstgebaute Passwortverwaltung wäre genau
die Art von Sicherheitsfunktion, die man nicht zweimal implementieren will.
