import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import ConfirmDialog from "./ConfirmDialog";

afterEach(cleanup);

function Harness({ onConfirm, onDismiss }: { onConfirm: () => void; onDismiss: () => void }) {
  return (
    <>
      <button type="button">Auslöser</button>
      <ConfirmDialog
        open
        title="Mitarbeiter endgültig löschen?"
        description={<p>Die Person wird aus der Teamverwaltung entfernt.</p>}
        onDismiss={onDismiss}
        actions={[
          { label: "Abbrechen", variant: "default", autoFocus: true, onClick: onDismiss },
          { label: "Löschen", variant: "danger", onClick: onConfirm },
        ]}
      />
    </>
  );
}

describe("ConfirmDialog", () => {
  it("rendert Titel und Beschreibung mit korrekter Dialog-Semantik", () => {
    render(<ConfirmDialog open title="Titel" description="Beschreibung" onDismiss={() => {}} actions={[]} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("Titel")).toBeTruthy();
    expect(screen.getByText("Beschreibung")).toBeTruthy();
  });

  it("rendert nichts, wenn open=false", () => {
    render(<ConfirmDialog open={false} title="Titel" description="Beschreibung" onDismiss={() => {}} actions={[]} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("fokussiert die als autoFocus markierte (sichere) Aktion beim Öffnen, nicht die destruktive", async () => {
    render(<Harness onConfirm={() => {}} onDismiss={() => {}} />);
    await act(async () => {});
    expect(document.activeElement?.textContent).toBe("Abbrechen");
  });

  it("ruft onDismiss bei Escape auf", () => {
    const onDismiss = vi.fn();
    render(<Harness onConfirm={() => {}} onDismiss={onDismiss} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("ruft die jeweilige onClick-Aktion bei Bestätigen/Abbrechen auf", () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    render(<Harness onConfirm={onConfirm} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("schließt bei Klick auf den Backdrop", () => {
    const onDismiss = vi.fn();
    render(<Harness onConfirm={() => {}} onDismiss={onDismiss} />);
    const backdrop = document.querySelector(".ui-dialog-backdrop");
    expect(backdrop).toBeTruthy();
    fireEvent.mouseDown(backdrop as Element, { target: backdrop });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("gibt den Fokus nach dem Schließen an den Auslöser zurück", async () => {
    function ToggleHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Öffnen
          </button>
          <ConfirmDialog
            open={open}
            title="Titel"
            description="Beschreibung"
            onDismiss={() => setOpen(false)}
            actions={[{ label: "Schließen", variant: "default", autoFocus: true, onClick: () => setOpen(false) }]}
          />
        </>
      );
    }
    render(<ToggleHarness />);
    const trigger = screen.getByRole("button", { name: "Öffnen" });
    await act(async () => {
      trigger.focus();
      trigger.click();
    });
    expect(document.activeElement?.textContent).toBe("Schließen");
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    await act(async () => {});
    expect(document.activeElement).toBe(trigger);
  });

  it("deaktivierte Aktionen (z.B. während Laden) sind nicht klickbar", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Titel"
        description="Beschreibung"
        onDismiss={() => {}}
        actions={[{ label: "Löscht …", variant: "danger", disabled: true, onClick: onConfirm }]}
      />,
    );
    const button = screen.getByRole("button", { name: "Löscht …" });
    expect(button).toHaveProperty("disabled", true);
    fireEvent.click(button);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
