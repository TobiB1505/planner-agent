export type SaveState = "idle" | "saving" | "saved" | "error";

export interface SaveStatusInfo {
  text: string;
  tone: "is-clean" | "is-dirty" | "is-error";
}

export function formatSaveStatus({
  saveState,
  isDirty,
}: {
  saveState: SaveState;
  isDirty: boolean;
}): SaveStatusInfo {
  if (saveState === "error") {
    return { text: "Speichern fehlgeschlagen", tone: "is-error" };
  }
  return {
    text: isDirty ? "Ungespeicherte Änderungen" : "Gespeichert",
    tone: isDirty ? "is-dirty" : "is-clean",
  };
}
