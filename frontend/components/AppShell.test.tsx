import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AppUser } from "@/lib/auth/roles";

// Aufgabe 30 (rollenabhängige Navigation) und Aufgabe 11 (Logout) an der
// tatsächlich gerenderten Oberfläche - nicht an einer Hilfsfunktion.

const signOut = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();
let pathname = "/dashboard";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace, refresh }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut } }),
  getAccessToken: async () => null,
}));

import AppShell from "./AppShell";
import { AuthProvider } from "./auth/AuthProvider";

function user(role: AppUser["role"], overrides: Partial<AppUser> = {}): AppUser {
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    role,
    personId: role === "employee" ? 7 : null,
    personName: role === "employee" ? "Mara Beispiel" : null,
    email: `${role}@planner.invalid`,
    ...overrides,
  };
}

function renderShell(appUser: AppUser | null) {
  return render(
    <AuthProvider initialUser={appUser}>
      <AppShell>
        <p>Seiteninhalt</p>
      </AppShell>
    </AuthProvider>,
  );
}

function navLabels(): string[] {
  return Array.from(document.querySelectorAll(".sidebar-link-label")).map(
    (element) => element.textContent ?? "",
  );
}

beforeEach(() => {
  // jsdom kennt matchMedia nicht; die Planner-Sidebar nutzt es für den
  // PWA-Installationshinweis und für die eingeklappte Darstellung.
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  signOut.mockReset().mockResolvedValue({ error: null });
  replace.mockReset();
  refresh.mockReset();
  pathname = "/dashboard";
});

afterEach(cleanup);

describe("AppShell - Navigation nach Rolle", () => {
  it("zeigt einem Admin die vollständige Navigation inklusive System", () => {
    renderShell(user("admin"));
    const labels = navLabels();

    expect(labels).toContain("Dashboard");
    expect(labels).toContain("Dienstplan erstellen");
    expect(labels).toContain("Team");
    expect(labels).toContain("System");
  });

  it("blendet einem Planer die Systemverwaltung aus", () => {
    renderShell(user("planner"));
    const labels = navLabels();

    expect(labels).toContain("Dashboard");
    expect(labels).toContain("Archiv");
    expect(labels).not.toContain("System");
  });

  it("zeigt im Mitarbeiterbereich nur die Employee-Navigation", () => {
    pathname = "/employee";
    renderShell(user("employee"));
    const labels = navLabels();

    expect(labels).toContain("Meine Übersicht");
    expect(labels).toContain("Mein Dienstplan");
    expect(labels).toContain("Künstlerplan");
    expect(labels).toContain("Probenplan");
    // Kein einziger Planungs- oder Verwaltungseintrag.
    for (const forbidden of ["Dienstplan erstellen", "Team", "MA-Gedächtnis", "Archiv", "System"]) {
      expect(labels).not.toContain(forbidden);
    }
  });

  it("markiert noch nicht gebaute Employee-Bereiche als nicht anklickbar", () => {
    pathname = "/employee";
    renderShell(user("employee"));

    const upcoming = document.querySelectorAll(".sidebar-link.is-upcoming");
    expect(upcoming.length).toBe(3);
    for (const element of Array.from(upcoming)) {
      expect(element.getAttribute("aria-disabled")).toBe("true");
      expect(element.tagName).not.toBe("A");
    }
  });

  it("rendert die Login-Seite ohne jede Navigation", () => {
    pathname = "/login";
    renderShell(null);

    expect(document.querySelector(".app-sidebar")).toBeNull();
    expect(screen.getByText("Seiteninhalt")).toBeTruthy();
  });
});

describe("AppShell - Abmelden", () => {
  it("beendet die Supabase-Session und leitet auf /login", async () => {
    renderShell(user("planner"));

    fireEvent.click(screen.getByRole("button", { name: /Abmelden/ }));

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    // replace statt push: die geschützte Seite darf nicht per Zurück-Button
    // aus dem Client-Cache zurückkommen.
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    // refresh() verwirft zusätzlich den serverseitig gerenderten Inhalt.
    expect(refresh).toHaveBeenCalled();
  });

  it("meldet auch dann lokal ab, wenn Supabase nicht erreichbar ist", async () => {
    signOut.mockRejectedValue(new Error("offline"));
    renderShell(user("admin"));

    fireEvent.click(screen.getByRole("button", { name: /Abmelden/ }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("ist auch im Mitarbeiterbereich vorhanden", async () => {
    pathname = "/employee";
    renderShell(user("employee"));

    fireEvent.click(screen.getByRole("button", { name: /Abmelden/ }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });
});
