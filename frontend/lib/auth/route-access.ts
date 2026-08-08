// Welche Rolle darf welche Seite sehen - als reine Funktion, ohne Next.js,
// ohne Netzwerk, ohne React. Dadurch ist die komplette Routing-Matrix
// testbar (siehe route-access.test.ts), und proxy.ts wie app/layout.tsx
// treffen garantiert dieselbe Entscheidung.
//
// Wichtig zur Einordnung: das ist UX, keine Autorisierung. Ein Redirect
// verhindert nur, dass jemand in einer Oberfläche landet, die für ihn nicht
// gedacht ist. Die eigentliche Sperre sitzt in FastAPI und antwortet mit
// 403, egal was das Frontend tut (siehe docs/auth/AUTH_ARCHITECTURE.md).

import { roleCovers, type AppRole } from "./roles";

/**
 * Header, über den proxy.ts den angefragten Pfad an die Server Components
 * weitergibt. Steht hier statt in proxy.ts, damit app/layout.tsx die
 * Konstante importieren kann, ohne den Proxy samt Supabase-Client in sein
 * Bundle zu ziehen.
 */
export const PATHNAME_HEADER = "x-planner-pathname";

export const LOGIN_PATH = "/login";
export const EMPLOYEE_HOME = "/employee";
export const PLANNER_HOME = "/dashboard";

/** Zielseite direkt nach dem Anmelden, je nach Rolle. */
export function homePathForRole(role: AppRole): string {
  return role === "employee" ? EMPLOYEE_HOME : PLANNER_HOME;
}

type Access = "public" | AppRole;

interface RouteRule {
  prefix: string;
  access: Access;
}

// Reihenfolge egal - es gewinnt immer die längste passende Regel.
//
// Bewusst enthalten sind auch /artist-plan und /rehearsal-plan: das sind die
// *Bearbeitungsseiten* (Import, Speichern, Export) und damit Planner-Sache.
// Die Nur-Lese-Sicht auf dieselben Inhalte bekommt das Employee-Portal im
// nächsten Sprint unter /employee/... - mit eigenen, gefilterten Daten.
const ROUTE_RULES: RouteRule[] = [
  { prefix: LOGIN_PATH, access: "public" },

  { prefix: EMPLOYEE_HOME, access: "employee" },

  { prefix: PLANNER_HOME, access: "planner" },
  { prefix: "/plan-editor", access: "planner" },
  { prefix: "/artist-plan", access: "planner" },
  { prefix: "/rehearsal-plan", access: "planner" },
  { prefix: "/team", access: "planner" },
  { prefix: "/gedaechtnis", access: "planner" },
  { prefix: "/planning-logic", access: "planner" },
  { prefix: "/archiv", access: "planner" },

  // Systemverwaltung inkl. Backend-Neustart und Diagnose.
  { prefix: "/system", access: "admin" },
];

// Alles, was keiner Regel entspricht (inkl. "/" und künftiger, noch nicht
// eingetragener Seiten), gilt als Planungsbereich. Fail-closed in die
// strengere Richtung: eine neue Seite ist im Zweifel nicht für Employees
// sichtbar, statt versehentlich offen zu stehen.
const DEFAULT_ACCESS: Access = "planner";

export function requiredAccessFor(pathname: string): Access {
  let match: RouteRule | null = null;
  for (const rule of ROUTE_RULES) {
    if (pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)) {
      if (!match || rule.prefix.length > match.prefix.length) {
        match = rule;
      }
    }
  }
  return match ? match.access : DEFAULT_ACCESS;
}

export type RouteDecision = { type: "allow" } | { type: "redirect"; to: string };

export interface RouteAccessInput {
  pathname: string;
  /** null = nicht angemeldet bzw. Rolle (noch) unbekannt. */
  role: AppRole | null;
}

export function resolveRouteAccess({ pathname, role }: RouteAccessInput): RouteDecision {
  const required = requiredAccessFor(pathname);

  if (required === "public") {
    // Wer angemeldet ist, hat auf der Login-Seite nichts mehr verloren -
    // sonst wirkt ein "zurück" nach dem Anmelden wie ein Abmelden.
    if (role && pathname.startsWith(LOGIN_PATH)) {
      return { type: "redirect", to: homePathForRole(role) };
    }
    return { type: "allow" };
  }

  if (!role) {
    const redirectTo = encodeURIComponent(pathname);
    return { type: "redirect", to: `${LOGIN_PATH}?redirectTo=${redirectTo}` };
  }

  if (roleCovers(role, required)) {
    return { type: "allow" };
  }

  // Bekannte Rolle, aber zu wenig Rechte: zurück auf die eigene Startseite,
  // nicht auf /login - der Benutzer ist ja angemeldet.
  return { type: "redirect", to: homePathForRole(role) };
}

/**
 * Prüft ein `redirectTo` aus der Query, bevor damit weitergeleitet wird.
 * Nur eigene, absolute Pfade sind erlaubt - kein "//example.com" und kein
 * "https://..." (Open-Redirect).
 */
export function safeRedirectTarget(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (raw.startsWith(LOGIN_PATH)) return fallback;
  return raw;
}
