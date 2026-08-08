import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Der serverseitige Zugriff auf "wer ist angemeldet". Wichtig an diesen
// Tests: der Zustand wird bei jedem Seitenaufbau frisch beim Backend geholt
// (Aufgabe 39, "Auth-State nach Reload") - es gibt keinen Client-Zustand,
// der einen Reload überdauert, und keine Rolle aus einem Cookie.

let serverToken: string | null = "server-token";

vi.mock("@/lib/supabase/server", () => ({
  getServerAccessToken: async () => serverToken,
  createClient: async () => ({}),
}));

import { getAppUser } from "./app-user";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  serverToken = "server-token";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getAppUser", () => {
  it("fragt das Backend mit dem Access Token und liefert Rolle und Person", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        user_id: "11111111-1111-4111-8111-111111111111",
        role: "employee",
        person_id: 7,
        person_name: "Mara Beispiel",
        email: "mara@planner.invalid",
      }),
    );

    const user = await getAppUser();

    expect(user).toEqual({
      userId: "11111111-1111-4111-8111-111111111111",
      role: "employee",
      personId: 7,
      personName: "Mara Beispiel",
      email: "mara@planner.invalid",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/auth/me");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer server-token",
    });
    // Rolle und Sperrstatus dürfen nie aus einem Cache kommen.
    expect((init as RequestInit).cache).toBe("no-store");
  });

  it("liefert ohne Session null, ohne das Backend zu fragen", async () => {
    serverToken = null;

    expect(await getAppUser()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("liefert bei 403 null - ein gesperrtes Konto gilt als nicht angemeldet", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "Konto deaktiviert." }, 403));

    expect(await getAppUser()).toBeNull();
  });

  it("liefert bei 401 null", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "Nicht angemeldet." }, 401));

    expect(await getAppUser()).toBeNull();
  });

  it("liefert null statt eines Fehlers, wenn das Backend nicht erreichbar ist", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    expect(await getAppUser()).toBeNull();
  });

  it("akzeptiert keine unbekannte Rolle aus der Antwort", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ user_id: "11111111-1111-4111-8111-111111111111", role: "superadmin" }),
    );

    expect(await getAppUser()).toBeNull();
  });
});
