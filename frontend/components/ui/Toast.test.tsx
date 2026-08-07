import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider, useToast } from "./Toast";

function Trigger() {
  const { toast } = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        toast({ title: "Gespeichert", description: "Änderungen wurden übernommen.", variant: "success" })
      }
    >
      Speichern
    </button>
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ToastProvider/useToast", () => {
  it("zeigt einen erstellten Toast mit Titel und Beschreibung an", async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await flush(); // Mount-Gate (useSyncExternalStore) wirksam werden lassen
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(screen.getByText("Gespeichert")).toBeTruthy();
    expect(screen.getByText("Änderungen wurden übernommen.")).toBeTruthy();
  });

  it("schließt einen Toast über den Schließen-Button manuell", async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(screen.getByText("Gespeichert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Meldung schließen" }));
    expect(screen.queryByText("Gespeichert")).toBeNull();
  });

  it("entfernt einen Toast automatisch nach der Standarddauer", async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(screen.getByText("Gespeichert")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(3300);
    });
    expect(screen.queryByText("Gespeichert")).toBeNull();
  });

  it("dedupliziert identische Meldungen innerhalb des Zeitfensters", async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await flush();
    const button = screen.getByRole("button", { name: "Speichern" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.getAllByText("Gespeichert")).toHaveLength(1);
  });

  it("rendert alle Varianten mit passender Klasse", async () => {
    function MultiTrigger() {
      const { toast } = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            toast({ title: "Info", variant: "info" });
            toast({ title: "Warnung", variant: "warning" });
            toast({ title: "Fehler", variant: "error" });
            toast({ title: "Lädt", variant: "loading" });
          }}
        >
          Auslösen
        </button>
      );
    }
    render(
      <ToastProvider>
        <MultiTrigger />
      </ToastProvider>,
    );
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Auslösen" }));
    expect(document.querySelector(".ui-toast--info")).toBeTruthy();
    expect(document.querySelector(".ui-toast--warning")).toBeTruthy();
    expect(document.querySelector(".ui-toast--error")).toBeTruthy();
    expect(document.querySelector(".ui-toast--loading")).toBeTruthy();
  });

  it("begrenzt die sichtbare Anzahl gleichzeitiger Toasts", async () => {
    function ManyTrigger() {
      const { toast } = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            for (let i = 0; i < 6; i += 1) {
              toast({ title: `Meldung ${i}`, variant: "info" });
            }
          }}
        >
          Viele auslösen
        </button>
      );
    }
    render(
      <ToastProvider>
        <ManyTrigger />
      </ToastProvider>,
    );
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Viele auslösen" }));
    expect(document.querySelectorAll(".ui-toast").length).toBeLessThanOrEqual(4);
  });

  it("pausiert das Auto-Dismiss bei Hover", async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    const toastEl = document.querySelector(".ui-toast") as Element;
    fireEvent.mouseEnter(toastEl);
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText("Gespeichert")).toBeTruthy();
    fireEvent.mouseLeave(toastEl);
    await act(async () => {
      vi.advanceTimersByTime(3300);
    });
    expect(screen.queryByText("Gespeichert")).toBeNull();
  });

  it("wirft eine verständliche Fehlermeldung, wenn useToast() ohne Provider aufgerufen wird", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Trigger />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});
