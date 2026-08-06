import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Button from "./Button";

afterEach(cleanup);

describe("Button", () => {
  it("rendert die primary-Variante standardmäßig als <button type=\"button\">", () => {
    render(<Button>Speichern</Button>);
    const button = screen.getByRole("button", { name: "Speichern" });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.className).toContain("ui-btn--primary");
  });

  it("rendert alle Varianten mit der passenden Klasse", () => {
    const variants = ["primary", "secondary", "ghost", "danger", "outline"] as const;
    for (const variant of variants) {
      const { unmount } = render(<Button variant={variant}>{variant}</Button>);
      expect(screen.getByRole("button", { name: variant }).className).toContain(`ui-btn--${variant}`);
      unmount();
    }
  });

  it("ist im disabled-Zustand nicht klickbar", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Löschen
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Löschen" });
    expect(button).toHaveProperty("disabled", true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("blockiert Klicks und zeigt aria-busy im loading-Zustand, behält aber das Label im DOM (für Screenreader)", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Wird gespeichert
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button).toHaveProperty("disabled", true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button.textContent).toContain("Wird gespeichert");
  });

  it("ist per Tastatur fokussierbar (natives <button>)", () => {
    render(<Button>Fokus-Test</Button>);
    const button = screen.getByRole("button", { name: "Fokus-Test" });
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it("meldet fehlendes aria-label bei size=\"icon\" in der Entwicklungskonsole", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Button size="icon">×</Button>);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('size="icon"'));
    spy.mockRestore();
  });

  it("verlangt keine Warnung, wenn size=\"icon\" ein aria-label besitzt", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <Button size="icon" aria-label="Schließen">
        ×
      </Button>,
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("rendert als Next.js <Link>, wenn href gesetzt ist", () => {
    render(<Button href="/team">Zum Team</Button>);
    const link = screen.getByRole("link", { name: "Zum Team" });
    expect(link.getAttribute("href")).toBe("/team");
  });
});
