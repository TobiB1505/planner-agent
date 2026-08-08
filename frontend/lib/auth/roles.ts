// Rollenmodell des Frontends - die Spiegelung von backend/auth/models.py.
//
// Zur Klarstellung: das hier ist Anzeige- und Navigationslogik, keine
// Sicherheitsgrenze. Wer eine Rolle im Browser manipuliert, sieht höchstens
// eine andere Navigation - jeder Datenzugriff läuft trotzdem durch FastAPI,
// das die Rolle unabhängig aus der Datenbank liest.

export const APP_ROLES = ["employee", "planner", "admin"] as const;

export type AppRole = (typeof APP_ROLES)[number];

const ROLE_RANK: Record<AppRole, number> = {
  employee: 1,
  planner: 2,
  admin: 3,
};

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}

/** ADMIN > PLANNER > EMPLOYEE - dieselbe Rangfolge wie im Backend. */
export function roleCovers(role: AppRole, required: AppRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

export interface AppUser {
  userId: string;
  role: AppRole;
  personId: number | null;
  personName: string | null;
  email: string | null;
}
