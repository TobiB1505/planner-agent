import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Supabase und der Next.js-Router werden ersetzt - geprüft wird das
// Verhalten des Formulars, nicht die Bibliothek dahinter.
const signInWithPassword = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();
let configured = true;

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithPassword } }),
  getAccessToken: async () => null,
}));

vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => configured,
  requireSupabaseConfig: () => ({ url: "https://x.invalid", publishableKey: "key" }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));

import LoginForm from "./LoginForm";

function fillIn(email = "planer@planner.invalid", password = "geheim") {
  fireEvent.change(screen.getByLabelText(/E-Mail/), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/Passwort/), { target: { value: password } });
}

beforeEach(() => {
  signInWithPassword.mockReset();
  replace.mockReset();
  refresh.mockReset();
  configured = true;
});

afterEach(cleanup);

describe("LoginForm", () => {
  it("meldet mit E-Mail und Passwort an und leitet auf die Startseite weiter", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    render(<LoginForm redirectTo={null} />);

    fillIn();
    fireEvent.click(screen.getByRole("button", { name: /Anmelden/ }));

    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledTimes(1));
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "planer@planner.invalid",
      password: "geheim",
    });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    // refresh() ist nötig, damit das Layout die Rolle serverseitig neu lädt
    // und Mitarbeitende von dort auf /employee weitergeleitet werden.
    expect(refresh).toHaveBeenCalled();
  });

  it("berücksichtigt ein sicheres Rücksprungziel", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    render(<LoginForm redirectTo="/team" />);

    fillIn();
    fireEvent.click(screen.getByRole("button", { name: /Anmelden/ }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/team"));
  });

  it("ignoriert ein fremdes Rücksprungziel", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    render(<LoginForm redirectTo="https://example.com" />);

    fillIn();
    fireEvent.click(screen.getByRole("button", { name: /Anmelden/ }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("zeigt bei falschen Zugangsdaten eine Fehlermeldung und leitet nicht weiter", async () => {
    signInWithPassword.mockResolvedValue({
      error: { status: 400, message: "Invalid login credentials" },
    });
    render(<LoginForm redirectTo={null} />);

    fillIn("planer@planner.invalid", "falsch");
    fireEvent.click(screen.getByRole("button", { name: /Anmelden/ }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("E-Mail oder Passwort ist nicht korrekt.");
    // Die Originalmeldung von Supabase wird bewusst nicht durchgereicht.
    expect(alert.textContent).not.toContain("Invalid login credentials");
    expect(replace).not.toHaveBeenCalled();
  });

  it("unterscheidet Serverprobleme von falschen Zugangsdaten", async () => {
    signInWithPassword.mockResolvedValue({ error: { status: 500, message: "boom" } });
    render(<LoginForm redirectTo={null} />);

    fillIn();
    fireEvent.click(screen.getByRole("button", { name: /Anmelden/ }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("gerade nicht erreichbar");
  });

  it("zeigt während der Anmeldung einen Ladezustand und verhindert Doppelklicks", async () => {
    let resolveSignIn: (value: { error: null }) => void = () => {};
    signInWithPassword.mockReturnValue(
      new Promise((resolve) => {
        resolveSignIn = resolve;
      }),
    );
    render(<LoginForm redirectTo={null} />);

    fillIn();
    const button = screen.getByRole("button", { name: /Anmelden/ });
    fireEvent.click(button);

    await waitFor(() => expect(button.getAttribute("aria-busy")).toBe("true"));
    fireEvent.click(button);
    expect(signInWithPassword).toHaveBeenCalledTimes(1);

    resolveSignIn({ error: null });
    await waitFor(() => expect(replace).toHaveBeenCalled());
  });

  it("weist ohne Supabase-Konfiguration deutlich darauf hin", () => {
    configured = false;
    render(<LoginForm redirectTo={null} />);

    expect(screen.getByRole("alert").textContent).toContain("noch nicht eingerichtet");
    expect((screen.getByRole("button", { name: /Anmelden/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("bietet keine Registrierung, keinen Magic Link und keine Social Logins an", () => {
    render(<LoginForm redirectTo={null} />);
    const text = document.body.textContent ?? "";
    for (const forbidden of ["Registrieren", "Magic", "Google", "Konto erstellen"]) {
      expect(text).not.toContain(forbidden);
    }
  });
});
