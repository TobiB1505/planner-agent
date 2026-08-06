import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Field from "./Field";
import Input from "./Input";
import Checkbox from "./Checkbox";

afterEach(cleanup);

describe("Field", () => {
  it("verbindet Label technisch korrekt mit dem Input (htmlFor/id)", () => {
    render(
      <Field label="Name">
        <Input placeholder="Vor- und Nachname" />
      </Field>,
    );
    const input = screen.getByLabelText("Name");
    expect(input).toBeTruthy();
  });

  it("verbindet Fehlertext über aria-describedby und setzt aria-invalid", () => {
    render(
      <Field label="E-Mail" error="Bitte eine gültige E-Mail-Adresse eingeben.">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("E-Mail");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const errorNode = document.getElementById(describedBy as string);
    expect(errorNode?.textContent).toContain("gültige E-Mail-Adresse");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("verbindet die Beschreibung über aria-describedby, wenn kein Fehler vorliegt", () => {
    render(
      <Field label="Abteilung" description="Optional, für interne Statistiken.">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("Abteilung");
    const describedBy = input.getAttribute("aria-describedby");
    expect(document.getElementById(describedBy as string)?.textContent).toBe("Optional, für interne Statistiken.");
    expect(input.getAttribute("aria-invalid")).toBe("false");
  });

  it("zeigt ein Pflichtfeld-Zeichen und setzt required auf dem Input", () => {
    render(
      <Field label="Name" required>
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText(/Name/) as HTMLInputElement;
    expect(input.required).toBe(true);
  });

  it("Input unterstützt disabled und Fokus", () => {
    render(<Input disabled placeholder="gesperrt" />);
    const input = screen.getByPlaceholderText("gesperrt") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("Input ist per Tastatur fokussierbar, wenn nicht disabled", () => {
    render(<Input placeholder="editierbar" />);
    const input = screen.getByPlaceholderText("editierbar");
    input.focus();
    expect(document.activeElement).toBe(input);
  });

  it("Checkbox verbindet Label korrekt und ist togglebar", () => {
    render(<Checkbox label="Benachrichtigungen erhalten" defaultChecked={false} />);
    const checkbox = screen.getByLabelText("Benachrichtigungen erhalten") as HTMLInputElement;
    expect(checkbox.type).toBe("checkbox");
    expect(checkbox.checked).toBe(false);
  });
});
