import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "./roles";

// Die /control/*-Handler laufen an FastAPI vorbei (sie müssen auch dann
// funktionieren, wenn das Backend abgestürzt ist). Genau deshalb dürfen sie
// nicht an der Rollenprüfung vorbeilaufen - das prüfen diese Tests.

let currentUser: AppUser | null = null;

vi.mock("./app-user", () => ({
  getAppUser: async () => currentUser,
}));

import { guardRouteHandler } from "./route-handler-guard";

function user(role: AppUser["role"]): AppUser {
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    role,
    personId: null,
    personName: null,
    email: null,
  };
}

beforeEach(() => {
  currentUser = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("guardRouteHandler", () => {
  it("lehnt ohne Anmeldung mit 401 ab", async () => {
    const denied = await guardRouteHandler("admin");
    expect(denied?.response.status).toBe(401);
  });

  it("lehnt einen Planer beim Admin-Handler mit 403 ab", async () => {
    currentUser = user("planner");

    const denied = await guardRouteHandler("admin");
    expect(denied?.response.status).toBe(403);
  });

  it("lehnt einen Mitarbeiter ab", async () => {
    currentUser = user("employee");

    expect((await guardRouteHandler("admin"))?.response.status).toBe(403);
    expect((await guardRouteHandler("planner"))?.response.status).toBe(403);
  });

  it("lässt einen Admin durch", async () => {
    currentUser = user("admin");

    expect(await guardRouteHandler("admin")).toBeNull();
  });

  it("gibt niemals interne Details preis", async () => {
    currentUser = user("planner");

    const denied = await guardRouteHandler("admin");
    const body = await denied!.response.json();
    expect(body).toEqual({
      ok: false,
      message: "Für diese Aktion fehlt die nötige Berechtigung.",
    });
  });
});
