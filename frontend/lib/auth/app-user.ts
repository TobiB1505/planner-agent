// Serverseitiger Zugriff auf "wer ist angemeldet und mit welcher Rolle".
//
// Die Antwort kommt ausschliesslich von FastAPI (GET /api/auth/me) - nie aus
// einem Cookie, nie aus einem Token-Claim und nie aus einer direkten
// Supabase-Tabellenabfrage. Damit gibt es genau eine Quelle der Wahrheit für
// Rolle und person_id: die app_users-Tabelle hinter dem Backend.
//
// `cache()` von React sorgt dafür, dass ein Seitenaufbau das Backend höchstens
// einmal fragt, auch wenn Layout und Seite beide danach fragen.

import { cache } from "react";
import { resolveBackendUrl } from "@/lib/backend-url";
import { isAppRole, type AppUser } from "./roles";
import { getServerAccessToken } from "@/lib/supabase/server";

interface AuthMeResponse {
  user_id?: unknown;
  role?: unknown;
  person_id?: unknown;
  person_name?: unknown;
  email?: unknown;
}

function parseAppUser(payload: AuthMeResponse): AppUser | null {
  if (!isAppRole(payload.role) || typeof payload.user_id !== "string") return null;
  return {
    userId: payload.user_id,
    role: payload.role,
    personId: typeof payload.person_id === "number" ? payload.person_id : null,
    personName: typeof payload.person_name === "string" ? payload.person_name : null,
    email: typeof payload.email === "string" ? payload.email : null,
  };
}

/**
 * Der angemeldete Benutzer - oder null.
 *
 * null bedeutet immer dasselbe: "diese Anfrage hat keinen nutzbaren Zugang".
 * Ob das an einer fehlenden Session, einem abgelaufenen Token, einem
 * fehlenden app_users-Eintrag (403) oder einem nicht erreichbaren Backend
 * liegt, ist für das Routing unerheblich - in allen Fällen landet der
 * Benutzer auf /login und bekommt dort eine verständliche Meldung.
 */
export const getAppUser = cache(async (): Promise<AppUser | null> => {
  const token = await getServerAccessToken();
  if (!token) return null;

  try {
    const response = await fetch(`${resolveBackendUrl()}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      // Rolle und Zuordnung dürfen nie aus einem Cache kommen: eine
      // Deaktivierung muss beim nächsten Seitenaufruf wirken.
      cache: "no-store",
    });
    if (!response.ok) return null;
    return parseAppUser((await response.json()) as AuthMeResponse);
  } catch {
    // Backend nicht erreichbar - kein Grund, einen Stacktrace zu rendern.
    return null;
  }
});
