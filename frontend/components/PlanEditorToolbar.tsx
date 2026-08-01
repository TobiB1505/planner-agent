"use client";

import { useEffect, useRef, useState } from "react";

export type SaveState = "idle" | "saving" | "saved" | "error";

export interface PlanToolbarTool {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export default function PlanEditorToolbar({
  weekLabel,
  rowCount,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  saveState,
  isDirty,
  changeCount,
  lastSavedAt,
  saveError,
  onSave,
  saveLabel = "Änderungen speichern",
  onExport,
  exportDisabled,
  exportLabel = "Excel exportieren",
  busy,
  tools,
}: {
  weekLabel: string;
  rowCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  saveState: SaveState;
  isDirty: boolean;
  changeCount: number;
  lastSavedAt: Date | null;
  saveError: string;
  onSave: () => void;
  saveLabel?: string;
  onExport: () => void;
  exportDisabled?: boolean;
  exportLabel?: string;
  busy: boolean;
  tools: PlanToolbarTool[];
}) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!toolsOpen) return;
    function closeOnOutsideClick(event: MouseEvent) {
      if (!toolsRef.current?.contains(event.target as Node)) setToolsOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setToolsOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [toolsOpen]);

  const statusText = (() => {
    if (saveState === "saving") return "Änderungen werden gespeichert …";
    if (saveState === "error") return "Speichern fehlgeschlagen";
    if (isDirty) return `● ${changeCount} ungespeicherte ${changeCount === 1 ? "Änderung" : "Änderungen"}`;
    if (lastSavedAt) {
      const time = lastSavedAt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
      return `✓ Alle Änderungen gespeichert · ${time} Uhr`;
    }
    return "Keine ungespeicherten Änderungen";
  })();

  const statusTone = saveState === "error" ? "is-error" : isDirty ? "is-dirty" : "is-clean";

  return (
    <div className="plan-editor-toolbar" role="toolbar" aria-label="Dienstplan-Werkzeuge">
      <div className="plan-editor-toolbar-info">
        <span className="plan-editor-toolbar-week">{weekLabel}</span>
        <div className="plan-editor-toolbar-undo">
          <button
            type="button"
            className="btn-icon"
            onClick={onUndo}
            disabled={!canUndo}
            title="Rückgängig (Strg/Cmd+Z)"
            aria-label="Rückgängig"
          >
            ↶
          </button>
          <button
            type="button"
            className="btn-icon"
            onClick={onRedo}
            disabled={!canRedo}
            title="Wiederholen (Strg/Cmd+Umschalt+Z)"
            aria-label="Wiederholen"
          >
            ↷
          </button>
        </div>
        <span className={`plan-editor-save-status ${statusTone}`} role="status">
          {statusText}
        </span>
        {saveState === "error" && saveError && (
          <span className="plan-editor-save-error">{saveError}</span>
        )}
        <span className="plan-editor-toolbar-count">{rowCount} Planzeilen</span>
      </div>

      <div className="plan-editor-toolbar-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onSave}>
          {saveState === "saving" && <span className="spinner" />}
          {saveLabel}
        </button>
        <button type="button" className="btn" disabled={busy || exportDisabled} onClick={onExport}>
          {exportLabel}
        </button>
        {tools.length > 0 && (
          <div ref={toolsRef} className="plan-editor-tools-menu">
            <button
              type="button"
              className="btn"
              aria-haspopup="menu"
              aria-expanded={toolsOpen}
              onClick={() => setToolsOpen((current) => !current)}
            >
              Planungswerkzeuge <span aria-hidden="true">▾</span>
            </button>
            {toolsOpen && (
              <div role="menu" aria-label="Planungswerkzeuge">
                {tools.map((tool) => (
                  <button
                    key={tool.label}
                    type="button"
                    role="menuitem"
                    disabled={tool.disabled}
                    onClick={() => {
                      setToolsOpen(false);
                      tool.onClick();
                    }}
                  >
                    {tool.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
