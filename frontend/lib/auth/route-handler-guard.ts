// Rollenprüfung für die Next.js-eigenen Route Handler unter /control/*.
//
// Diese Handler laufen NICHT über FastAPI - sie werden von Next.js selbst
// beantwortet, weil sie auch dann funktionieren müssen, wenn das Backend
// abgestürzt ist (siehe lib/backend-supervisor.ts). Genau deshalb greift für
// sie die zentrale Absicherung des Backends nicht, und sie brauchen eine
// eigene.
//
// Ohne diese Prüfung wäre POST /control/backend/restart ein unauthentifizierter
// Weg, einen Serverprozess neu zu starten - die Rollenprüfung an
// POST /api/system/restart liesse sich damit schlicht umgehen.
//
// Die Rolle kommt aus derselben Quelle wie überall sonst: GET /api/auth/me
// beim Backend. Ist das Backend nicht erreichbar (der Fall, für den es diese
// Handler gibt), gibt es keine belegbare Rolle - dann wird abgelehnt. Ein
// "im Zweifel erlauben" wäre hier besonders gefährlich, weil der Zweifel
// genau der Normalfall dieses Endpunkts ist.

import { NextResponse } from "next/server";
import { getAppUser } from "./app-user";
import { roleCovers, type AppRole } from "./roles";

export interface GuardFailure {
  response: NextResponse;
}

/**
 * Gibt null zurück, wenn der Aufruf erlaubt ist - sonst die fertige
 * Fehlerantwort. Statuscodes und Meldungen entsprechen dem Backend:
 * 401 ohne Anmeldung, 403 bei fehlender Rolle.
 */
export async function guardRouteHandler(required: AppRole): Promise<GuardFailure | null> {
  const user = await getAppUser();

  if (!user) {
    return {
      response: NextResponse.json(
        { ok: false, message: "Nicht angemeldet oder Sitzung ungültig." },
        { status: 401 },
      ),
    };
  }

  if (!roleCovers(user.role, required)) {
    return {
      response: NextResponse.json(
        { ok: false, message: "Für diese Aktion fehlt die nötige Berechtigung." },
        { status: 403 },
      ),
    };
  }

  return null;
}
