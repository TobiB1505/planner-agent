import { describe, expect, it } from "vitest";
import {
  EMPLOYEE_HOME,
  LOGIN_PATH,
  PLANNER_HOME,
  homePathForRole,
  requiredAccessFor,
  resolveRouteAccess,
  safeRedirectTarget,
} from "./route-access";

// Die komplette Routing-Matrix aus Aufgabe 27/31 - als Tabelle, damit ein
// neuer Bereich nicht versehentlich für die falsche Rolle offensteht.
// resolveRouteAccess() ist die einzige Stelle, an der proxy.ts und
// app/layout.tsx ihre Entscheidung herholen; was hier grün ist, gilt an
// beiden Stellen.

describe("requiredAccessFor", () => {
  it("stuft die Planungsseiten als Planner-Bereich ein", () => {
    for (const path of [
      "/dashboard",
      "/plan-editor",
      "/artist-plan",
      "/rehearsal-plan",
      "/team",
      "/gedaechtnis",
      "/planning-logic",
      "/archiv",
    ]) {
      expect(requiredAccessFor(path)).toBe("planner");
    }
  });

  it("stuft die Systemverwaltung als Admin-Bereich ein", () => {
    expect(requiredAccessFor("/system")).toBe("admin");
  });

  it("erkennt Unterseiten über den Präfix", () => {
    expect(requiredAccessFor("/plan-editor/2026-08-03")).toBe("planner");
    expect(requiredAccessFor("/employee/dienstplan")).toBe("employee");
  });

  it("behandelt unbekannte Seiten als Planungsbereich (fail-closed)", () => {
    expect(requiredAccessFor("/eine-neue-seite")).toBe("planner");
    expect(requiredAccessFor("/")).toBe("planner");
  });

  it("lässt nur die Login-Seite öffentlich", () => {
    expect(requiredAccessFor(LOGIN_PATH)).toBe("public");
  });
});

describe("resolveRouteAccess - nicht angemeldet", () => {
  it("leitet geschützte Seiten auf /login mit Rücksprungziel", () => {
    const decision = resolveRouteAccess({ pathname: "/plan-editor", role: null });
    expect(decision).toEqual({
      type: "redirect",
      to: "/login?redirectTo=%2Fplan-editor",
    });
  });

  it("lässt die Login-Seite selbst zu", () => {
    expect(resolveRouteAccess({ pathname: LOGIN_PATH, role: null })).toEqual({ type: "allow" });
  });
});

describe("resolveRouteAccess - Employee", () => {
  it("darf den eigenen Bereich sehen", () => {
    expect(resolveRouteAccess({ pathname: EMPLOYEE_HOME, role: "employee" })).toEqual({
      type: "allow",
    });
  });

  it.each([
    "/plan-editor",
    "/dashboard",
    "/team",
    "/archiv",
    "/gedaechtnis",
    "/planning-logic",
    "/artist-plan",
    "/rehearsal-plan",
    "/system",
  ])("wird von %s auf die Mitarbeiter-Startseite umgeleitet", (path) => {
    expect(resolveRouteAccess({ pathname: path, role: "employee" })).toEqual({
      type: "redirect",
      to: EMPLOYEE_HOME,
    });
  });
});

describe("resolveRouteAccess - Planner", () => {
  it("darf den gesamten Planungsbereich sehen", () => {
    for (const path of ["/dashboard", "/plan-editor", "/team", "/archiv"]) {
      expect(resolveRouteAccess({ pathname: path, role: "planner" })).toEqual({ type: "allow" });
    }
  });

  it("darf auch Employee-Bereiche sehen (Rollen sind hierarchisch)", () => {
    expect(resolveRouteAccess({ pathname: EMPLOYEE_HOME, role: "planner" })).toEqual({
      type: "allow",
    });
  });

  it("wird von der Systemverwaltung auf das Dashboard umgeleitet", () => {
    expect(resolveRouteAccess({ pathname: "/system", role: "planner" })).toEqual({
      type: "redirect",
      to: PLANNER_HOME,
    });
  });
});

describe("resolveRouteAccess - Admin", () => {
  it.each(["/system", "/dashboard", "/plan-editor", EMPLOYEE_HOME])(
    "darf %s sehen",
    (path) => {
      expect(resolveRouteAccess({ pathname: path, role: "admin" })).toEqual({ type: "allow" });
    },
  );
});

describe("resolveRouteAccess - bereits angemeldet auf /login", () => {
  it("schickt Planner und Admin auf das Dashboard", () => {
    expect(resolveRouteAccess({ pathname: LOGIN_PATH, role: "planner" })).toEqual({
      type: "redirect",
      to: PLANNER_HOME,
    });
    expect(resolveRouteAccess({ pathname: LOGIN_PATH, role: "admin" })).toEqual({
      type: "redirect",
      to: PLANNER_HOME,
    });
  });

  it("schickt Mitarbeitende in den Mitarbeiterbereich", () => {
    expect(resolveRouteAccess({ pathname: LOGIN_PATH, role: "employee" })).toEqual({
      type: "redirect",
      to: EMPLOYEE_HOME,
    });
  });
});

describe("homePathForRole", () => {
  it("liefert je Rolle die passende Startseite", () => {
    expect(homePathForRole("employee")).toBe(EMPLOYEE_HOME);
    expect(homePathForRole("planner")).toBe(PLANNER_HOME);
    expect(homePathForRole("admin")).toBe(PLANNER_HOME);
  });
});

describe("safeRedirectTarget", () => {
  it("akzeptiert eigene Pfade", () => {
    expect(safeRedirectTarget("/team", PLANNER_HOME)).toBe("/team");
  });

  it("weist fremde Ziele ab (Open Redirect)", () => {
    expect(safeRedirectTarget("https://example.com", PLANNER_HOME)).toBe(PLANNER_HOME);
    expect(safeRedirectTarget("//example.com", PLANNER_HOME)).toBe(PLANNER_HOME);
    expect(safeRedirectTarget("javascript:alert(1)", PLANNER_HOME)).toBe(PLANNER_HOME);
  });

  it("führt nicht zurück auf die Login-Seite", () => {
    expect(safeRedirectTarget("/login?redirectTo=%2Fteam", PLANNER_HOME)).toBe(PLANNER_HOME);
  });

  it("nutzt den Fallback ohne Angabe", () => {
    expect(safeRedirectTarget(null, PLANNER_HOME)).toBe(PLANNER_HOME);
    expect(safeRedirectTarget("", PLANNER_HOME)).toBe(PLANNER_HOME);
  });
});
