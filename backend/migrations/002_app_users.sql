-- 002_app_users
--
-- Auth-Sprint: Verbindung zwischen einem Supabase-Auth-Benutzer und dem
-- Planner. Beantwortet genau eine Frage: "welche Rolle und welche Person
-- gehört zu dieser Auth-UUID?"
--
-- Bewusst NICHT enthalten: password, password_hash, salt, reset_token oder
-- irgendein anderes Zugangsdatum. Identität und Passwörter verwaltet
-- ausschliesslich Supabase Auth (siehe docs/auth/AUTH_ARCHITECTURE.md).
--
-- Konventionen dieser Migration folgen 001_initial_postgres.sql:
--   * Boolesche Flags bleiben INTEGER (0/1) - der Fachcode schreibt 1/0 und
--     liest bool(...); ein echtes boolean würde aus 1 in dict(row)-basierten
--     Antworten plötzlich true machen, also den API-Vertrag ändern.
--   * Zeitstempel bleiben TEXT über planner_now_text() - identisches Format
--     wie bei allen anderen created_at/updated_at-Spalten.

CREATE TABLE app_users (
    -- Die UUID aus Supabase auth.users. Bewusst KEIN Fremdschlüssel auf
    -- auth.users: dieses Schema muss auch gegen eine beliebige PostgreSQL-
    -- Instanz migrierbar sein (die CI nutzt ein nacktes postgres:16 ohne
    -- Supabase-Schemata, siehe .github/workflows/ci.yml). Die Anwendung ist
    -- damit nicht an den Anbieter gekoppelt - dieselbe Entscheidung, die
    -- schon für die CI-Datenbank getroffen wurde. Wer die Kopplung in einer
    -- reinen Supabase-Umgebung möchte, kann den FK dort nachträglich
    -- ergänzen; siehe docs/auth/SUPABASE_AUTH_SETUP.md.
    user_id uuid PRIMARY KEY,

    -- Nullable, und zwar bewusst: ein Admin oder Planer ist nicht zwingend
    -- selbst Mitarbeiter im Dienstplan (externe Leitung, Vertretung,
    -- Technik-Account). Ein Pflichtfeld würde erzwingen, für solche Konten
    -- Phantom-Personen anzulegen, die dann in Dienstplänen, Statistiken und
    -- Fairness-Auswertungen auftauchen.
    --
    -- ON DELETE RESTRICT wie bei den übrigen personenbezogenen Tabellen mit
    -- fachlicher Bedeutung: eine Person, an der ein Konto hängt, darf nicht
    -- stillschweigend verschwinden. (Der reguläre Weg ist ohnehin ein
    -- Soft-Delete über people.deleted.)
    person_id BIGINT REFERENCES people(id) ON DELETE RESTRICT,

    role TEXT NOT NULL CHECK (role IN ('admin', 'planner', 'employee')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT planner_now_text(),
    updated_at TEXT NOT NULL DEFAULT planner_now_text(),

    -- Ein Mitarbeiterkonto ohne Person hätte keinen "meinen Dienstplan" -
    -- dieser Zustand soll gar nicht erst entstehen können.
    CONSTRAINT app_users_employee_needs_person
        CHECK (role <> 'employee' OR person_id IS NOT NULL)
);

-- Eine Person gehört höchstens einem Konto, sonst wäre "wer ist dieser
-- Mitarbeiter" nicht mehr eindeutig beantwortbar. NULL zählt in einem
-- UNIQUE-Index als verschieden - beliebig viele personlose Admin-/
-- Planer-Konten bleiben also möglich.
CREATE UNIQUE INDEX app_users_person_id_key ON app_users (person_id);
