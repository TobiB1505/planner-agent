-- Auth-Sprint: app_users (PostgreSQL / Supabase)
--
-- Verbindet einen Supabase-Auth-Benutzer mit einer Rolle und - optional -
-- mit einem Eintrag der people-Tabelle. Enthält bewusst KEINE Zugangsdaten:
-- Passwörter, Hashes, Salts und Reset-Tokens liegen ausschliesslich bei
-- Supabase Auth.
--
-- Ausführung: Supabase SQL Editor oder `supabase db push`.
-- Idempotent - ein zweiter Lauf ändert nichts.
--
-- Siehe backend/migrations/README.md zum Verhältnis dieser Datei zum
-- aktuell noch aktiven SQLite-Schema in backend/db.py.

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_users (
    -- Direkter Fremdschlüssel auf Supabase Auth. ON DELETE CASCADE: wird ein
    -- Auth-Benutzer in Supabase gelöscht, verschwindet auch seine
    -- Planner-Zuordnung - sonst bliebe eine Rolle ohne Konto zurück.
    user_id     uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,

    -- Nullable, und zwar bewusst: Admins und Planer sind nicht zwingend
    -- selbst Mitarbeitende im Dienstplan. ON DELETE RESTRICT: eine Person,
    -- an der ein Konto hängt, darf nicht einfach verschwinden.
    person_id   integer REFERENCES public.people (id) ON DELETE RESTRICT,

    role        text NOT NULL CHECK (role IN ('admin', 'planner', 'employee')),
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),

    -- Ein Mitarbeiterkonto ohne Person hätte keinen "meinen Dienstplan".
    CONSTRAINT app_users_employee_needs_person
        CHECK (role <> 'employee' OR person_id IS NOT NULL)
);

-- Eine Person gehört höchstens einem Konto. NULL zählt in PostgreSQL-UNIQUE
-- als verschieden, beliebig viele personlose Admin-/Planer-Konten bleiben
-- also möglich.
CREATE UNIQUE INDEX IF NOT EXISTS app_users_person_id_key
    ON public.app_users (person_id);

-- updated_at soll die Wahrheit sagen, auch wenn jemand direkt per SQL ändert.
CREATE OR REPLACE FUNCTION public.set_app_users_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_users_set_updated_at ON public.app_users;
CREATE TRIGGER app_users_set_updated_at
    BEFORE UPDATE ON public.app_users
    FOR EACH ROW
    EXECUTE FUNCTION public.set_app_users_updated_at();

-- Row Level Security: die Tabelle wird ausschliesslich vom FastAPI-Backend
-- gelesen und geschrieben (serverseitige Verbindung, kein PostgREST-Zugriff
-- aus dem Browser). RLS ohne Policies bedeutet: über die öffentliche
-- Supabase-API kommt niemand an diese Zeilen - auch nicht an die eigene.
-- Das ist beabsichtigt; die Rolle erfährt ein Client über GET /api/auth/me,
-- nie durch direktes Abfragen der Tabelle.
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

COMMIT;
