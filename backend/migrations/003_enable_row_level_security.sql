-- 003_enable_row_level_security
--
-- Schliesst den Weg an der Anwendung vorbei.
--
-- Das Problem: sobald die Datenbank bei Supabase liegt, ist jede Tabelle im
-- Schema `public` automatisch auch über PostgREST erreichbar
-- (https://<projekt>.supabase.co/rest/v1/<tabelle>). Der dafür nötige
-- Publishable/anon Key ist kein Geheimnis - er steckt als
-- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY im ausgelieferten Frontend-Bundle.
--
-- Ohne RLS könnte damit jeder sämtliche Planungsdaten lesen UND schreiben -
-- einschliesslich app_users, also die eigene Rolle auf 'admin' setzen. Die
-- gesamte Rollenprüfung in FastAPI wäre damit wirkungslos, weil sie schlicht
-- umgangen würde.
--
-- Die Lösung ist hier bewusst RLS OHNE Policies:
--
--   * `anon` und `authenticated` (rolbypassrls = false) verlieren jeden
--     Zugriff. Genau das ist gewollt: das Frontend fragt Fachdaten nie direkt
--     bei Supabase ab, sondern ausschliesslich über FastAPI - eine Invariante
--     dieses Projekts, siehe docs/auth/AUTH_ARCHITECTURE.md.
--   * Das Backend verbindet sich über DATABASE_URL als Eigentümerrolle der
--     Tabellen (bei Supabase `postgres`, rolbypassrls = true). RLS berührt sie
--     nicht, die Anwendung merkt von dieser Migration nichts.
--
-- Deshalb steht hier auch KEIN `FORCE ROW LEVEL SECURITY`: das würde die
-- Eigentümerrolle einbeziehen und das Backend aussperren.
--
-- Policies werden bewusst keine angelegt. Der Supabase-Linter meldet das als
-- INFO ("RLS enabled, no policy") - hier ist es die Absicht, nicht ein
-- vergessener Schritt: es gibt keinen legitimen Direktzugriff, den eine
-- Policy erlauben müsste.
--
-- Für nicht-Supabase-Umgebungen (die CI fährt ein nacktes postgres:16) ist
-- diese Migration folgenlos: es gibt dort weder PostgREST noch die Rollen
-- anon/authenticated, und die Tests verbinden sich als Eigentümerrolle.

ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE people_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE week_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE artist_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE artist_plan_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE rehearsal_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE rehearsals ENABLE ROW LEVEL SECURITY;
ALTER TABLE rehearsal_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_memory_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_statistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

-- Zusätzlich: fester search_path für die beiden Hilfsfunktionen aus 001.
--
-- Ohne diese Festlegung bestimmt der search_path des jeweiligen Aufrufers,
-- welche `translate`/`to_char`/`now`-Implementierung gefunden wird. Wer
-- Objekte in einem früher durchsuchten Schema anlegen darf, könnte damit das
-- Verhalten einer Funktion verändern, die in Indexausdrücken steckt.
--
-- pg_catalog reicht aus, denn genau von dort stammen alle verwendeten
-- Funktionen. Die Semantik bleibt unverändert - wichtig, weil planner_nocase()
-- in funktionalen Indizes verwendet wird und eine echte Verhaltensänderung
-- diese Indizes stillschweigend falsch machen würde.
ALTER FUNCTION planner_nocase(text) SET search_path = pg_catalog;
ALTER FUNCTION planner_now_text() SET search_path = pg_catalog;
