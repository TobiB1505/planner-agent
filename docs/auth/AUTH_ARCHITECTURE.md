# Auth-Architektur

## Der Weg einer Anmeldung

```
Browser: /login
    │  E-Mail + Passwort
    ▼
Supabase Auth
    │  Session (Access Token + Refresh Token) in Cookies
    ▼
Next.js (Vercel)
    │  Authorization: Bearer <access token>
    ▼
FastAPI (Render)
    │  1. Signatur prüfen (JWKS des Projekts)
    │  2. Issuer, Audience, Ablauf prüfen
    │  3. sub  -> Supabase-User-UUID
    │  4. app_users-Zeile laden
    │  5. is_active prüfen
    │  6. Rolle + person_id bestimmen
    ▼
CurrentUser(user_id, role, person_id, email)
    │
    ▼
PostgreSQL / SQLite
```

Der entscheidende Satz dazu: **die Sicherheitsgrenze verläuft in FastAPI.**
Das Frontend entscheidet nur, was es anzeigt. Ein Redirect ist Komfort, ein
ausgeblendeter Button ist keine Berechtigung. Wer die Oberfläche umgeht und
direkt gegen die API spricht, bekommt exakt dieselben 401/403-Antworten -
das ist in `backend/tests/test_auth_rbac_matrix.py` festgeschrieben.

## Wer ist wofür zuständig

| Baustein | Zuständig für | Ausdrücklich NICHT zuständig für |
| --- | --- | --- |
| Supabase Auth | Benutzerkonten, Passwörter, Session, Token-Refresh | Rollen, Zuordnung zu Mitarbeitenden |
| `app_users` (eigene DB) | Rolle, Personenzuordnung, Sperre | Zugangsdaten jeder Art |
| FastAPI | Token-Verifikation, Rollenprüfung, Datenzugriff | Login/Logout |
| Next.js (`proxy.ts`) | Session auffrischen, Nicht-Angemeldete abfangen | Rollenentscheidungen (zu teuer, siehe unten) |
| Next.js (`app/layout.tsx`) | rollenabhängiges Routing der Oberfläche | Datenzugriff |

## Backend

### Token-Verifikation

`backend/auth/tokens.py`. Geprüft werden **Signatur, Issuer, Audience,
Ablauf** und die Pflicht-Claims `exp`, `sub`, `iss`. Ein Token ohne gültige
Signatur wird nie akzeptiert; `alg: none` wird abgelehnt.

Zwei Wege, sauber getrennt:

- **ES256/RS256** (Standard bei Supabase): der öffentliche Schlüssel kommt
  aus dem JWKS des Projekts.
- **HS256** (ältere Projekte mit symmetrischem JWT-Secret): nur wenn
  `SUPABASE_JWT_SECRET` gesetzt ist.

Die Trennung ist sicherheitsrelevant: ein HS256-Token wird nie gegen einen
JWKS-Schlüssel geprüft (Algorithm Confusion) und umgekehrt.

### JWKS-Caching

`backend/auth/jwks.py`. Die Schlüssel werden zwischengespeichert
(Standard: 10 Minuten), damit nicht jeder Request einen Netzwerkabruf
auslöst. Eine unbekannte `kid` löst einen gezielten Refresh aus
(Schlüsselrotation), aber höchstens alle 30 Sekunden - sonst könnte man mit
erfundenen `kid`-Werten beliebig viele Abrufe erzwingen.

Schlägt ein Refresh fehl, werden vorhandene Schlüssel weiterverwendet: ein
kurzer Supabase-Ausfall soll nicht die gesamte Anwendung aussperren. Liegen
noch gar keine Schlüssel vor, wird abgelehnt. Der Fallback betrifft nur die
Frage *wie alt* ein Schlüsselsatz sein darf - niemals die Frage, *ob*
geprüft wird.

### CurrentUser und Rollen-Dependencies

```python
@dataclass(frozen=True)
class CurrentUser:
    user_id: UUID
    role: AppRole          # admin | planner | employee
    person_id: int | None
    email: str | None
```

Rollen werden nicht in Routern ausformuliert, sondern angehängt:

```python
@router.post("/api/plan/save", dependencies=[Depends(require_planner)])
```

Damit ist die Berechtigung eines Endpunkts an einer Stelle sichtbar und
maschinell auslesbar - `backend/tests/test_auth_endpoint_matrix.py` liest
den Dependency-Baum der App aus und vergleicht ihn mit der kuratierten
Matrix. Ein neuer Endpunkt ohne Einstufung lässt die Testsuite scheitern.

### Statuscodes

| Situation | Antwort |
| --- | --- |
| Kein `Authorization`-Header | 401 (+ `WWW-Authenticate: Bearer`) |
| Ungültiges/kaputtes Token | 401 |
| Abgelaufenes Token | 401 |
| Falscher Issuer oder falsche Audience | 401 |
| Auth nicht konfiguriert | 401 |
| Gültiges Token, kein `app_users`-Eintrag | 403 |
| `is_active = false` | 403 |
| Rolle reicht nicht aus | 403 |

Alle 401-Fälle teilen sich denselben Antworttext ("Nicht angemeldet oder
Sitzung ungültig."). Ob ein Token abgelaufen, falsch signiert oder für ein
fremdes Projekt ausgestellt war, erfährt der Aufrufer bewusst nicht. Kein
PyJWT-Text, kein Stacktrace, kein Claim landet in einer Antwort.

Der Unterschied zwischen 401 und 403 ist inhaltlich gemeint: 401 heisst
"wer bist du?", 403 heisst "ich weiss, wer du bist - das darfst du nicht".
Ein authentifizierter Benutzer ohne Freischaltung bekommt deshalb 403.

### Fail-closed

Ohne konfigurierte Supabase-Verbindung lässt sich kein Token verifizieren -
dann antwortet jeder geschützte Endpunkt mit 401. Es gibt **keinen Schalter,
der die Prüfung abschaltet**. Beim Start wird eine Warnung protokolliert
(nur die Namen der fehlenden Variablen, nie Werte).

## Frontend

### Session

`@supabase/ssr` mit **Cookie-Sessions**, nicht `localStorage`. Nur so sehen
Server Components, `proxy.ts` und der Browser denselben Anmeldezustand, und
nur so überlebt eine Anmeldung ein Neuladen der Seite serverseitig. Die
Cookie-Flags (`HttpOnly`, `Secure`, `SameSite`) setzt die
Supabase-SSR-Integration; es gibt keine selbstgebaute Cookie-Logik.

### Zwei Stufen, bewusst getrennt

1. **`proxy.ts`** (in Next.js 16 der neue Name für Middleware): frischt die
   Session auf und schickt Nicht-Angemeldete auf `/login`. Mehr nicht - der
   Proxy läuft bei jeder Navigation und sogar bei Prefetches, und die
   Next.js-Dokumentation rät dort ausdrücklich von Datenbank-/Backend-
   Abfragen ab.
2. **`app/layout.tsx`** (Server Component): holt Rolle und Person einmal pro
   Seitenaufbau über `GET /api/auth/me` und entscheidet mit denselben Regeln
   (`lib/auth/route-access.ts`), ob die Seite angezeigt oder umgeleitet
   wird - serverseitig, bevor irgendetwas gerendert wird.

Beide Stufen benutzen dieselbe reine Funktion `resolveRouteAccess()`, die
vollständig getestet ist (`lib/auth/route-access.test.ts`).

### Token an der API

Genau eine Stelle hängt den `Authorization`-Header an: `lib/api.ts`. Keine
Komponente baut ihn selbst. Die beiden Datei-Downloads (Excel-Export)
benutzen aus technischen Gründen `fetch` direkt, holen sich den Header aber
über dieselbe Hilfsfunktion.

Bei `401` leitet der API-Client auf `/login` um (mit Rücksprungziel), bei
`403` zeigt er eine einheitliche Meldung. Die Backend-Meldung wird in beiden
Fällen nicht durchgereicht.

### Keine Backend-URL im Browser

Unverändert: der Browser spricht ausschliesslich relative `/api/*`-Pfade an,
die Next.js serverseitig an FastAPI weiterleitet. Es gibt weiterhin kein
`NEXT_PUBLIC_BACKEND_URL`. Ebenso unverändert: **keine direkte
Supabase-Fachdatenabfrage aus React** - Supabase wird im Frontend
ausschliesslich für die Anmeldung verwendet, alle Fachdaten kommen über
FastAPI.

## Datenmodell

Siehe `backend/migrations/0001_app_users.sql` (PostgreSQL) und den
`app_users`-Block in `backend/db.py` (aktuelles SQLite-Schema).

```
auth.users (Supabase)
    │ UUID
    ▼
app_users
    ├── user_id     PRIMARY KEY, = auth.users.id
    ├── person_id   → people.id, NULLABLE
    ├── role        admin | planner | employee
    ├── is_active
    ├── created_at
    └── updated_at
```

### Warum `person_id` nullable ist

Bewusste Entscheidung, mit Einschränkung:

- **Nullable**, weil ein Admin oder Planer nicht zwingend selbst
  Mitarbeiter im Dienstplan ist (externe Leitung, Vertretung,
  Technik-Account). Ein Pflichtfeld würde erzwingen, für solche Konten
  Phantom-Personen in der `people`-Tabelle anzulegen - die dann in
  Dienstplänen, Statistiken und Fairness-Auswertungen auftauchen würden.
- **Für `employee` trotzdem Pflicht**, erzwungen per CHECK-Constraint
  (`role <> 'employee' OR person_id IS NOT NULL`). Ein Mitarbeiterkonto
  ohne Person hätte keinen "meinen Dienstplan" - dieser Zustand soll gar
  nicht erst entstehen können.
- **Höchstens ein Konto je Person**, erzwungen über einen UNIQUE-Index auf
  `person_id`. NULL zählt dabei als verschieden, personlose Admin-/
  Planer-Konten bleiben also beliebig oft möglich.

### Keine Zugangsdaten in der Planner-Datenbank

`app_users` enthält kein `password`, `password_hash`, `salt` oder
`reset_token` - abgesichert durch einen Test, der die Spaltenliste prüft.
Alles, was zur Identität gehört, liegt allein in Supabase Auth.

### Kein Auto-Provisioning

Existiert zu einer gültigen Supabase-Identität keine `app_users`-Zeile,
wird der Zugriff mit 403 abgelehnt - es wird **nichts automatisch
angelegt** und keine Standardrolle vergeben. Freischalten ist ein
bewusster Vorgang (siehe `ADMIN_BOOTSTRAP.md`).

## API-Vertragsänderungen in diesem Sprint

1. **`POST /api/upload/pdf`: Query-Parameter `?api_key=` entfernt.**
   Ein Secret im Query-String landet in Browser-Historie, Referer-Headern
   und Proxy-/Access-Logs; dagegen hilft keine Rollenprüfung. Der
   Gemini-Key kommt jetzt ausschliesslich aus der serverseitigen
   Umgebungsvariable `GEMINI_API_KEY`. Ein trotzdem mitgeschicktes
   `?api_key=...` wird ignoriert (kein 422) - bestehende Aufrufer
   funktionieren weiter, nur eben mit dem Server-Key. Betroffen im
   Frontend: `uploadPdf(file)` hat keinen zweiten Parameter mehr.
2. **Alle Endpunkte ausser `GET /api/health` verlangen jetzt einen
   `Authorization: Bearer`-Header.** Pfade, Methoden, Request- und
   Response-Formate bleiben unverändert; das OpenAPI-Schema wurde nur um
   das Security-Schema `SupabaseAccessToken` ergänzt (per Test abgesichert).
3. **`GET /control/backend/status` und `POST /control/backend/restart`**
   (Next.js-eigene Route Handler, nicht FastAPI) verlangen jetzt die Rolle
   `admin`. Ohne diese Prüfung wären sie ein unauthentifizierter Weg,
   einen Serverprozess neu zu starten.

## Logging

Protokolliert werden Auth-Fehler mit Methode, Pfad, Fehlerklasse und einem
kurzen internen Grund. **Nicht** protokolliert werden: Access Tokens,
`Authorization`-Header, Claims, Passwörter, Supabase-Keys. Ein Test prüft
das für den Erfolgs- wie den Fehlerfall.

## CORS

Unverändert eng: nur die konfigurierten Origins aus `CORS_ORIGINS`, niemals
`*`. `allow_credentials` bleibt aus - das Token reist als Header, nicht als
Cookie, und der Browser spricht ohnehin same-origin über den Next.js-Rewrite.
Damit kann die gefährliche Kombination "weite Origins mit Credentials" gar
nicht entstehen.
