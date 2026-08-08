import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Aufgabe 25: der Authorization-Header entsteht genau einmal, im API-Client.
// Diese Tests halten das fest - inklusive der Frage, was bei 401/403 passiert.

let token: string | null = "test-access-token";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
  getAccessToken: async () => token,
}));

import { ApiError, getTeam, healthCheck } from "./api";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
    blob: async () => new Blob(),
  } as unknown as Response;
}

function headerFrom(call: unknown[], name: string): string | undefined {
  const init = call[1] as RequestInit | undefined;
  return (init?.headers as Record<string, string> | undefined)?.[name];
}

beforeEach(() => {
  token = "test-access-token";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  // window.location.replace darf im Test nicht wirklich navigieren.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { pathname: "/team", search: "", replace: vi.fn() },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API-Client - Authorization", () => {
  it("hängt das aktuelle Access Token an jeden Aufruf", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await getTeam();

    expect(headerFrom(fetchMock.mock.calls[0], "Authorization")).toBe("Bearer test-access-token");
  });

  it("schickt ohne Session keinen Authorization-Header", async () => {
    token = null;
    fetchMock.mockResolvedValue(jsonResponse({ status: "ok" }));

    await healthCheck();

    expect(headerFrom(fetchMock.mock.calls[0], "Authorization")).toBeUndefined();
  });

  it("nutzt weiterhin relative /api-Pfade (keine Backend-URL im Browser)", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await getTeam();

    expect(fetchMock.mock.calls[0][0]).toBe("/api/team");
  });
});

describe("API-Client - abgelehnte Aufrufe", () => {
  it("führt bei 401 zurück zur Anmeldung und meldet eine abgelaufene Sitzung", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "Nicht angemeldet." }, 401));

    await expect(getTeam()).rejects.toMatchObject({
      status: 401,
      message: "Die Sitzung ist abgelaufen. Bitte erneut anmelden.",
    });
    expect(window.location.replace).toHaveBeenCalledWith("/login?redirectTo=%2Fteam");
  });

  it("meldet bei 403 fehlende Berechtigung, ohne umzuleiten", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "Kein Zugriff." }, 403));

    const error = await getTeam().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(403);
    expect((error as ApiError).message).toBe("Für diese Aktion fehlt die nötige Berechtigung.");
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  it("leitet auf der Login-Seite selbst nicht erneut um", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/login", search: "", replace: vi.fn() },
    });
    fetchMock.mockResolvedValue(jsonResponse({ detail: "Nicht angemeldet." }, 401));

    await expect(getTeam()).rejects.toBeInstanceOf(ApiError);
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  it("gibt fachliche Fehler weiterhin unverändert weiter", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "Woche wurde nicht gefunden." }, 404));

    await expect(getTeam()).rejects.toMatchObject({
      status: 404,
      message: "Woche wurde nicht gefunden.",
    });
  });
});
